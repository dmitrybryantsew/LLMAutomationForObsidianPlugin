import { App, Modal, TFile, MarkdownView, Editor, ButtonComponent, Notice, TextAreaComponent } from 'obsidian';
import type GptFreeTextGeneratorPlugin from '../main';
import { VaultFileSelectorModal } from './VaultFileSelectorModal';
import { ErrorHandler } from '../utils/ErrorHandler';
import { FileContext, TextGenerationOptions } from '../types/openrouter';
import { PdfHelper } from '../utils/PdfHelper';

/**
 * QuickQueryModal - Contextual Learning Assistant
 * 
 * Allows users to query an LLM directly from within an active note using a modal.
 * Automatically aggregates context from the active note and all files linked within it
 * ("mentioned files") to answer questions without leaving the editor.
 */
export class QuickQueryModal extends Modal {
    // Dependencies
    private plugin: GptFreeTextGeneratorPlugin;
    
    // State
    private activeFile: TFile | null;
    private contextFiles: Set<TFile> = new Set();
    private prompt: string = "";
    private isProcessing: boolean = false;
    private includeCurrentNote: boolean = true;
    private generatedResponse: string = "";
    
    // UI References
    private fileListContainer!: HTMLElement;
    private outputArea!: HTMLElement;
    private promptInput!: TextAreaComponent;
    private generateButton!: ButtonComponent;
    private insertButton!: ButtonComponent;
    private appendButton!: ButtonComponent;
    private toggleContainer!: HTMLElement;

    constructor(app: App, plugin: GptFreeTextGeneratorPlugin) {
        super(app);
        this.plugin = plugin;
        this.activeFile = app.workspace.getActiveFile();
        
        // Validate active file
        if (!this.activeFile) {
            new Notice('No active file. Please open a note first.');
            this.close();
            return;
        }
        
        this.modalEl.addClass('quick-query-modal');
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();

        // Header
        contentEl.createEl('h2', { text: 'Quick Context Query' });

        // Prompt Section
        this.buildPromptSection(contentEl);

        // Context Controls Section
        this.buildContextSection(contentEl);

        // Output Preview Section
        this.buildOutputSection(contentEl);

        // Action Buttons Section
        this.buildActionButtons(contentEl);
    }

    /**
     * Build the prompt input section
     */
    private buildPromptSection(container: HTMLElement): void {
        const promptHeader = container.createEl('div', { cls: 'section-header' });
        promptHeader.setText('Your Question');

        this.promptInput = new TextAreaComponent(container);
        this.promptInput
            .setPlaceholder('Ask about this note\'s connections...')
            .setValue(this.prompt)
            .onChange((value) => {
                this.prompt = value;
            });
        
        this.promptInput.inputEl.addClass('prompt-textarea');
        this.promptInput.inputEl.rows = 5;
    }

    /**
     * Build the context controls section
     */
    private buildContextSection(container: HTMLElement): void {
        const contextHeader = container.createEl('div', { cls: 'section-header' });
        contextHeader.setText('Context Files');

        // Context chips container
        this.fileListContainer = container.createEl('div', { cls: 'context-chips-container' });
        this.refreshFileList();

        // Smart context actions
        const actionsContainer = container.createEl('div', { cls: 'smart-context-actions' });

        // Add File button
        new ButtonComponent(actionsContainer)
            .setButtonText('Add File')
            .setCta()
            .onClick(() => {
                this.openFileSelector();
            });

        // Include Mentioned Files button
        new ButtonComponent(actionsContainer)
            .setButtonText('Include Mentioned Files')
            .onClick(() => {
                this.addMentionedFiles();
            });

        // Toggle for including current note content
        this.toggleContainer = container.createEl('div', { cls: 'toggle-container' });
        this.toggleContainer.createSpan({ text: 'Include Current Note Content: ' });
        
        const toggle = this.toggleContainer.createEl('input', { type: 'checkbox' });
        toggle.checked = this.includeCurrentNote;
        toggle.addEventListener('change', (e) => {
            this.includeCurrentNote = (e.target as HTMLInputElement).checked;
        });
    }

    /**
     * Build the output preview section
     */
    private buildOutputSection(container: HTMLElement): void {
        const outputHeader = container.createEl('div', { cls: 'section-header' });
        outputHeader.setText('Response');

        this.outputArea = container.createEl('div', { 
            cls: 'query-result-preview empty',
            text: 'Response will appear here after generation...'
        });
    }

    /**
     * Build the action buttons section
     */
    private buildActionButtons(container: HTMLElement): void {
        const buttonsContainer = container.createEl('div', { cls: 'action-buttons' });

        // Generate button
        this.generateButton = new ButtonComponent(buttonsContainer);
        this.generateButton
            .setButtonText('Generate')
            .setCta()
            .onClick(() => {
                this.handleGenerate();
            });

        // Insert at Cursor button (hidden initially)
        this.insertButton = new ButtonComponent(buttonsContainer);
        this.insertButton
            .setButtonText('Insert at Cursor')
            .onClick(() => {
                this.handleInsertAtCursor();
            });
        this.insertButton.buttonEl.style.display = 'none';

        // Append to Note button (hidden initially)
        this.appendButton = new ButtonComponent(buttonsContainer);
        this.appendButton
            .setButtonText('Append to Note')
            .onClick(() => {
                this.handleAppendToNote();
            });
        this.appendButton.buttonEl.style.display = 'none';
    }

    /**
     * Open file selector modal to add files manually
     */
    private openFileSelector(): void {
        new VaultFileSelectorModal(this.app, (file: TFile) => {
            // Prevent duplicates using Set
            if (!this.contextFiles.has(file)) {
                this.contextFiles.add(file);
                this.refreshFileList();
            } else {
                new Notice('File already in context');
            }
        }).open();
    }

    /**
     * Add mentioned files from the active note
     * Uses Obsidian's Metadata Cache to extract links and embeds
     */
    private addMentionedFiles(): void {
        if (!this.activeFile) {
            return;
        }

        try {
            // Get file cache from Obsidian's metadata cache
            const cache = this.app.metadataCache.getFileCache(this.activeFile);
            
            if (!cache) {
                new Notice('No links found in this note');
                return;
            }

            let addedCount = 0;
            const maxFiles = 20; // Limit to prevent context window overflow

            // Process links
            if (cache.links) {
                for (const link of cache.links) {
                    if (addedCount >= maxFiles) break;

                    // Resolve link to TFile object
                    const linkedFile = this.app.metadataCache.getFirstLinkpathDest(
                        link.link,
                        this.activeFile.path
                    );

                    // Add if valid, is markdown or PDF, and not already in context
                    if (linkedFile && 
                        (linkedFile.extension === 'md' || linkedFile.extension === 'pdf') && 
                        !this.contextFiles.has(linkedFile)) {
                        this.contextFiles.add(linkedFile);
                        addedCount++;
                    }
                }
            }

            // Process embeds (transclusions)
            if (cache.embeds) {
                for (const embed of cache.embeds) {
                    if (addedCount >= maxFiles) break;

                    const embeddedFile = this.app.metadataCache.getFirstLinkpathDest(
                        embed.link,
                        this.activeFile.path
                    );

                    if (embeddedFile && 
                        (embeddedFile.extension === 'md' || embeddedFile.extension === 'pdf') && 
                        !this.contextFiles.has(embeddedFile)) {
                        this.contextFiles.add(embeddedFile);
                        addedCount++;
                    }
                }
            }

            // Refresh UI
            this.refreshFileList();

            // Show notification
            if (addedCount > 0) {
                new Notice(`Added ${addedCount} file(s) from links`);
            } else {
                new Notice('No new markdown files found in links');
            }

        } catch (error) {
            ErrorHandler.handleError(error, 'FILE_OPERATION', {
                operation: 'addMentionedFiles',
                filePath: this.activeFile.path
            });
        }
    }

    /**
     * Refresh the file list display with current context files
     */
    private refreshFileList(): void {
        this.fileListContainer.empty();

        if (this.contextFiles.size === 0) {
            this.fileListContainer.createEl('div', { 
                cls: 'context-empty-message',
                text: 'No context files selected' 
            });
            return;
        }

        // Create chips for each file
        this.contextFiles.forEach((file) => {
            const chip = this.fileListContainer.createEl('div', { cls: 'context-chip' });

            // File name
            const nameSpan = chip.createEl('span', { 
                cls: 'context-chip-name',
                text: file.basename 
            });

            // Remove button
            const removeBtn = chip.createEl('div', { 
                cls: 'context-chip-remove',
                text: '×' 
            });
            removeBtn.addEventListener('click', () => {
                this.contextFiles.delete(file);
                this.refreshFileList();
            });
        });
    }

    /**
     * Handle the generate button click
     * Reads file contents and calls LLM service
     */
    private async handleGenerate(): Promise<void> {
        if (this.isProcessing) {
            return;
        }

        // Validate prompt
        if (!this.prompt.trim()) {
            new Notice('Please enter a question');
            return;
        }

        // Validate LLM client
        const client = this.plugin.services.llmClientService.getClient();
        if (!client) {
            new Notice('LLM client not initialized. Please check your settings.');
            return;
        }

        this.isProcessing = true;
        this.generateButton.setButtonText('Generating...');
        this.generateButton.setDisabled(true);
        this.outputArea.empty();
        this.outputArea.addClass('empty');
        this.outputArea.setText('Generating response...');
        this.insertButton.buttonEl.style.display = 'none';
        this.appendButton.buttonEl.style.display = 'none';

        try {
            // Build file contexts
            const fileContexts: FileContext[] = [];

            // Add active note content if toggled
            if (this.includeCurrentNote && this.activeFile) {
                try {
                    const activeNoteContent = await this.app.vault.read(this.activeFile);
                    fileContexts.push({
                        path: this.activeFile.path,
                        name: this.activeFile.basename,
                        content: activeNoteContent
                    });
                } catch (error) {
                    ErrorHandler.handleError(error, 'FILE_OPERATION', {
                        operation: 'readActiveNote',
                        filePath: this.activeFile.path
                    });
                }
            }

            // Add context files content
            for (const file of this.contextFiles) {
                try {
                    let content: string;
                    
                    if (file.extension === 'pdf') {
                        // Use PdfHelper for PDF files
                        const pdfHelper = new PdfHelper(this.app);
                        content = await pdfHelper.extractText(file);
                    } else {
                        // Read markdown files directly
                        content = await this.app.vault.read(file);
                    }
                    
                    fileContexts.push({
                        path: file.path,
                        name: file.basename,
                        content: content
                    });
                } catch (error) {
                    ErrorHandler.handleError(error, 'FILE_OPERATION', {
                        operation: 'readContextFile',
                        filePath: file.path
                    });
                }
            }

            // Build the message with prompt engineering
            const systemInstruction = 'Analyze the provided context files to answer the user request. Highlight connections between the documents.';
            const message = `${systemInstruction}\n\n${this.prompt}`;

            // Prepare generation options
            const options: TextGenerationOptions = {
                model: this.plugin.settings.openrouterTextModel || this.plugin.settings.defaultTextModel,
                message: message,
                files: fileContexts.length > 0 ? fileContexts : undefined,
                temperature: 0.7,
                maxTokens: 2000,
                language: this.plugin.settings.defaultLanguage
            };

            // Call LLM service
            const response = await client.generateText(options);

            // Store and display response
            this.generatedResponse = response.output;
            this.outputArea.empty();
            this.outputArea.removeClass('empty');
            this.outputArea.setText(this.generatedResponse);

            // Show action buttons
            this.insertButton.buttonEl.style.display = 'inline-block';
            this.appendButton.buttonEl.style.display = 'inline-block';

            new Notice('Response generated successfully');

        } catch (error) {
            ErrorHandler.handleError(error, 'API_GENERATE_ERROR', {
                operation: 'generateText',
                contextFilesCount: this.contextFiles.size,
                includeCurrentNote: this.includeCurrentNote
            });
            
            this.outputArea.empty();
            this.outputArea.removeClass('empty');
            this.outputArea.createEl('div', { 
                text: 'Failed to generate response. Please check the console for details.' 
            });
        } finally {
            this.isProcessing = false;
            this.generateButton.setButtonText('Generate');
            this.generateButton.setDisabled(false);
        }
    }

    /**
     * Insert the generated response at the cursor position
     */
    private handleInsertAtCursor(): void {
        if (!this.generatedResponse) {
            new Notice('No response to insert');
            return;
        }

        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!activeView) {
            new Notice('No active markdown view');
            return;
        }

        try {
            const editor = activeView.editor;
            editor.replaceSelection(this.generatedResponse);
            new Notice('Response inserted at cursor');
            this.close();
        } catch (error) {
            ErrorHandler.handleError(error, 'FILE_OPERATION', {
                operation: 'insertAtCursor'
            });
        }
    }

    /**
     * Append the generated response to the active note
     */
    private handleAppendToNote(): void {
        if (!this.generatedResponse) {
            new Notice('No response to append');
            return;
        }

        if (!this.activeFile) {
            new Notice('No active file');
            return;
        }

        try {
            const textToAppend = `\n\n${this.generatedResponse}`;
            this.app.vault.append(this.activeFile, textToAppend);
            new Notice('Response appended to note');
            this.close();
        } catch (error) {
            ErrorHandler.handleError(error, 'FILE_OPERATION', {
                operation: 'appendToNote',
                filePath: this.activeFile.path
            });
        }
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
