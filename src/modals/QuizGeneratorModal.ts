/**
 * QuizGeneratorModal - Study Quiz Generation
 * 
 * Provides a modal interface for generating study quizzes with customizable parameters.
 * Supports context from markdown and PDF files, with hierarchical folder structure
 * for organizing quizzes by source note.
 */

import { App, Modal, TFile, MarkdownView, Editor, ButtonComponent, Notice, TextAreaComponent, TextComponent, SliderComponent } from 'obsidian';
import type GptFreeTextGeneratorPlugin from '../main';
import { VaultFileSelectorModal } from './VaultFileSelectorModal';
import { ErrorHandler } from '../utils/ErrorHandler';
import { FileContext, TextGenerationOptions } from '../types/openrouter';
import { PdfHelper } from '../utils/PdfHelper';

export class QuizGeneratorModal extends Modal {
    // Dependencies
    private plugin: GptFreeTextGeneratorPlugin;
    
    // State
    private difficulty: 'Easy' | 'Medium' | 'Hard' = 'Medium';
    private questionCount: number = 5;
    private contextFiles: Set<TFile> = new Set();
    private topicTheme: string = "General";
    private additionalInstructions: string = "";
    private includeCurrentNote: boolean = false;
    private isProcessing: boolean = false;
    private activeFile: TFile | null;
    
    // UI References
    private fileListContainer!: HTMLElement;
    private generateButton!: ButtonComponent;

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
        
        this.modalEl.addClass('quiz-generator-modal');
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();

        // Header
        contentEl.createEl('h2', { text: 'Generate Study Quiz' });

        // Context Section
        this.buildContextSection(contentEl);

        // Configuration Section
        this.buildConfigurationSection(contentEl);

        // Action Buttons Section
        this.buildActionButtons(contentEl);
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

        // Toggle for including current note content
        const toggleContainer = container.createEl('div', { cls: 'toggle-container' });
        toggleContainer.createSpan({ text: 'Include Current Note: ' });
        
        const toggle = toggleContainer.createEl('input', { type: 'checkbox' });
        toggle.checked = this.includeCurrentNote;
        toggle.addEventListener('change', (e) => {
            this.includeCurrentNote = (e.target as HTMLInputElement).checked;
        });

        // Add File button
        new ButtonComponent(actionsContainer)
            .setButtonText('Add Context File')
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
    }

    /**
     * Build the configuration section
     */
    private buildConfigurationSection(container: HTMLElement): void {
        const configHeader = container.createEl('div', { cls: 'section-header' });
        configHeader.setText('Quiz Configuration');

        // Topic/Theme Input
        const topicContainer = container.createEl('div', { cls: 'config-item' });
        topicContainer.createEl('label', { text: 'Topic/Theme:', cls: 'config-label' });
        const topicInput = new TextComponent(topicContainer);
        topicInput
            .setPlaceholder('General')
            .setValue(this.topicTheme)
            .onChange((value) => {
                this.topicTheme = value || "General";
            });

        // Difficulty Dropdown
        const difficultyContainer = container.createEl('div', { cls: 'config-item' });
        difficultyContainer.createEl('label', { text: 'Difficulty:', cls: 'config-label' });
        const difficultySelect = difficultyContainer.createEl('select', { cls: 'config-select' });
        ['Easy', 'Medium', 'Hard'].forEach((level) => {
            const option = difficultySelect.createEl('option', { value: level, text: level });
            if (level === this.difficulty) {
                option.selected = true;
            }
        });
        difficultySelect.addEventListener('change', (e) => {
            this.difficulty = (e.target as HTMLSelectElement).value as 'Easy' | 'Medium' | 'Hard';
        });

        // Question Count Slider
        const countContainer = container.createEl('div', { cls: 'config-item' });
        countContainer.createEl('label', { text: `Question Count: ${this.questionCount}`, cls: 'config-label' });
        const countSlider = new SliderComponent(countContainer);
        countSlider
            .setLimits(1, 20, 1)
            .setValue(this.questionCount)
            .setDynamicTooltip()
            .onChange((value) => {
                this.questionCount = value;
                countContainer.querySelector('label')!.textContent = `Question Count: ${value}`;
            });

        // Additional Instructions TextArea
        const instructionsContainer = container.createEl('div', { cls: 'config-item' });
        instructionsContainer.createEl('label', { text: 'Additional Instructions:', cls: 'config-label' });
        const instructionsInput = new TextAreaComponent(instructionsContainer);
        instructionsInput
            .setPlaceholder('e.g., Focus on dates, Multiple choice only...')
            .setValue(this.additionalInstructions)
            .onChange((value) => {
                this.additionalInstructions = value;
            });
        instructionsInput.inputEl.rows = 3;
    }

    /**
     * Build the action buttons section
     */
    private buildActionButtons(container: HTMLElement): void {
        const buttonsContainer = container.createEl('div', { cls: 'action-buttons' });

        // Generate button
        this.generateButton = new ButtonComponent(buttonsContainer);
        this.generateButton
            .setButtonText('Generate Quiz')
            .setCta()
            .onClick(() => {
                this.handleGenerate();
            });
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
                new Notice('No new files found in links');
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

            // File name with extension indicator
            const nameSpan = chip.createEl('span', { 
                cls: 'context-chip-name',
                text: `${file.basename}.${file.extension}` 
            });
            
            // Add PDF indicator for PDF files
            if (file.extension === 'pdf') {
                const pdfIndicator = chip.createEl('span', { 
                    cls: 'context-chip-pdf',
                    text: 'PDF' 
                });
            }

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
     * Reads file contents, calls LLM service, and saves the quiz
     */
    private async handleGenerate(): Promise<void> {
        if (this.isProcessing) {
            return;
        }

        // Validate LLM client
        const client = this.plugin.services.llmClientService.getClient();
        if (!client) {
            new Notice('LLM client not initialized. Please check your settings.');
            return;
        }

        // Validate inputs
        if (!this.topicTheme.trim()) {
            new Notice('Please enter a topic/theme');
            return;
        }

        if (this.questionCount < 1 || this.questionCount > 20) {
            new Notice('Question count must be between 1 and 20');
            return;
        }

        this.isProcessing = true;
        this.generateButton.setButtonText('Generating...');
        this.generateButton.setDisabled(true);

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
            const pdfHelper = new PdfHelper(this.app);
            for (const file of this.contextFiles) {
                try {
                    let content: string;
                    
                    if (file.extension === 'pdf') {
                        // Use PdfHelper for PDF files
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

            // Build the prompt
            const systemInstruction = 'You are an educational assistant designed to test knowledge. Generate a quiz based on the provided context.';
            const userPrompt = `Generate a ${this.questionCount}-question quiz. Difficulty: ${this.difficulty}. Topic: ${this.topicTheme}. ${this.additionalInstructions ? `Additional Instructions: ${this.additionalInstructions}` : ''} Format: Markdown, with questions first, and answers hidden in a collapsible callout at the very bottom.`;
            
            const message = `${systemInstruction}\n\n${userPrompt}`;

            // Prepare generation options
            const options: TextGenerationOptions = {
                model: this.plugin.settings.openrouterTextModel || this.plugin.settings.defaultTextModel,
                message: message,
                files: fileContexts.length > 0 ? fileContexts : undefined,
                temperature: 0.7,
                maxTokens: 3000,
                language: this.plugin.settings.defaultLanguage
            };

            // Call LLM service
            const response = await client.generateText(options);

            // Save quiz to file
            await this.saveQuiz(response.output);

            new Notice('Quiz generated successfully!');

        } catch (error) {
            ErrorHandler.handleError(error, 'API_GENERATE_ERROR', {
                operation: 'generateQuiz',
                topic: this.topicTheme,
                difficulty: this.difficulty,
                questionCount: this.questionCount
            });
            
            new Notice('Failed to generate quiz. Please check the console for details.');
        } finally {
            this.isProcessing = false;
            this.generateButton.setButtonText('Generate Quiz');
            this.generateButton.setDisabled(false);
        }
    }

    /**
     * Save the generated quiz to a file with hierarchical folder structure
     */
    private async saveQuiz(content: string): Promise<void> {
        if (!this.activeFile) {
            throw new Error('No active file');
        }

        try {
            // Get quiz folder from settings
            const quizFolder = this.plugin.settings.quizFolder || 'Quizzes';
            
            // Create folder structure: QuizFolder/NoteName/
            const subfolderName = this.activeFile.basename;
            const subfolderPath = `${quizFolder}/${subfolderName}`;
            
            // Ensure subfolder exists
            if (!await this.app.vault.adapter.exists(subfolderPath)) {
                await this.app.vault.createFolder(subfolderPath);
            }

            // Determine filename with incremental naming
            const filename = await this.resolveFilename(subfolderPath, this.topicTheme);

            // Create frontmatter
            const now = new Date();
            const created = now.toISOString().slice(0, 16).replace('T', ' ');
            const frontmatter = `---
type: quiz
source_note: [[${this.activeFile.basename}]]
created: ${created}
difficulty: ${this.difficulty}
topic: ${this.topicTheme}
---
`;

            // Build content with link back to source
            const sourceLink = `[[${this.activeFile.basename}]]`;
            const fullContent = `${frontmatter}\n\n${sourceLink}\n\n${content}`;

            // Create the file
            const filePath = `${subfolderPath}/${filename}`;
            await this.app.vault.create(filePath, fullContent);

            // Insert wikilink to active note
            this.insertQuizLink(filePath, filename);

        } catch (error) {
            ErrorHandler.handleError(error, 'FILE_OPERATION', {
                operation: 'saveQuiz',
                topic: this.topicTheme
            });
            throw error;
        }
    }

    /**
     * Resolve filename with incremental naming to avoid conflicts
     * @param folderPath - Path to the folder
     * @param baseName - Base name for the file
     * @returns Resolved filename
     */
    private async resolveFilename(folderPath: string, baseName: string): Promise<string> {
        let filename = `${baseName}.md`;
        let counter = 1;

        while (await this.app.vault.adapter.exists(`${folderPath}/${filename}`)) {
            filename = `${baseName}_${counter}.md`;
            counter++;
        }

        return filename;
    }

    /**
     * Insert a wikilink to the quiz in the active note
     * @param quizFilePath - Path to the quiz file
     * @param quizFilename - Name of the quiz file
     */
    private insertQuizLink(quizFilePath: string, quizFilename: string): void {
        if (!this.activeFile) {
            return;
        }

        try {
            const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
            if (!activeView) {
                new Notice('No active markdown view');
                return;
            }

            // Create wikilink with display text
            const displayName = `Quiz: ${this.topicTheme} (${this.difficulty})`;
            const wikilink = `[[${quizFilePath}|${displayName}]]`;

            const editor = activeView.editor;
            
            // Check if there's a cursor position
            const cursor = editor.getCursor();
            if (cursor && cursor.line >= 0) {
                // Insert at cursor position
                editor.replaceSelection(`\n\n${wikilink}`);
            } else {
                // Append to end of file
                const fileContent = editor.getValue();
                const textToAppend = `\n\n${wikilink}`;
                editor.setValue(fileContent + textToAppend);
            }

            new Notice('Quiz link inserted into note');

        } catch (error) {
            ErrorHandler.handleError(error, 'FILE_OPERATION', {
                operation: 'insertQuizLink',
                filePath: this.activeFile.path
            });
        }
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
