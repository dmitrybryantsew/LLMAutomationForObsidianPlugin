/**
 * @deprecated Superseded by the database-backed flashcard pipeline (SpacedRepetitionDatabase,
 * FlashcardGenerationView, SpacedRepetitionManualQuestionModal, SpacedRepetitionCardManagementView).
 * Kept temporarily so the one-time migration command can still parse files this class's format
 * produced. Safe to delete once migration tooling is no longer needed by any supported upgrade path.
 */

/**
 * FlashcardGeneratorModal - Deep Flashcard Generation
 * 
 * Provides a modal interface for generating high-quality flashcards using an iterative LLM approach.
 * Supports context from markdown and PDF files, with hierarchical folder structure
 * for organizing flashcards by source note and deck.
 */

import { App, Modal, TFile, MarkdownView, Editor, ButtonComponent, Notice, TextAreaComponent, TextComponent, SliderComponent } from 'obsidian';
import type GptFreeTextGeneratorPlugin from '../main';
import { VaultFileSelectorModal } from './VaultFileSelectorModal';
import { ErrorHandler } from '../utils/ErrorHandler';
import { FileContext } from '../types/openrouter';
import { PdfHelper } from '../utils/PdfHelper';
import { FlashcardManager, CardStyle, Difficulty } from '../utils/FlashcardManager';

export class FlashcardGeneratorModal extends Modal {
    // Dependencies
    private plugin: GptFreeTextGeneratorPlugin;
    
    // State
    private difficulty: Difficulty = 'Recall';
    private cardCount: number = 5;
    private cardStyle: CardStyle = 'basic';
    private contextFiles: Set<TFile> = new Set();
    private deckName: string = "General";
    private additionalInstructions: string = "";
    private includeCurrentNote: boolean = false;
    private isProcessing: boolean = false;
    private activeFile: TFile | null;
    private existingDecks: string[] = [];
    private selectedDeck: string = '';
    private createNewDeck: boolean = false;
    
    // UI References
    private fileListContainer!: HTMLElement;
    private generateButton!: ButtonComponent;
    private deckNameInput!: TextComponent;
    private deckSelectContainer!: HTMLElement;
    private progressContainer!: HTMLElement;
    private progressBar!: HTMLElement;
    private progressText!: HTMLElement;
    private postActionContainer!: HTMLElement;

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
        
        this.modalEl.addClass('flashcard-generator-modal');
    }

    async onOpen() {
        const { contentEl } = this;
        contentEl.empty();

        // Header
        contentEl.createEl('h2', { text: 'Generate Flashcards' });

        // Context Section
        this.buildContextSection(contentEl);

        // Target Deck Selection Section
        await this.buildDeckSelectionSection(contentEl);

        // Configuration Section
        this.buildConfigurationSection(contentEl);

        // Progress Section (hidden initially)
        this.buildProgressSection(contentEl);

        // Post-Action Section (hidden initially)
        this.buildPostActionSection(contentEl);

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
     * Build the deck selection section
     */
    private async buildDeckSelectionSection(container: HTMLElement): Promise<void> {
        const deckHeader = container.createEl('div', { cls: 'section-header' });
        deckHeader.setText('Target Deck');

        const deckContainer = container.createEl('div', { cls: 'config-item' });

        // Get existing decks for current note
        if (this.activeFile) {
            this.existingDecks = await this.plugin.services.flashcardManager.getDecksForNote(this.activeFile.basename);
        }

        // Create dropdown container
        this.deckSelectContainer = deckContainer.createEl('div', { cls: 'deck-select-container' });

        // Create select element
        const deckSelect = this.deckSelectContainer.createEl('select', { cls: 'config-select' });

        // Add existing decks
        this.existingDecks.forEach((deck) => {
            const option = deckSelect.createEl('option', { value: deck, text: deck });
            if (deck === this.selectedDeck) {
                option.selected = true;
            }
        });

        // Add "Create New" option
        const createNewOption = deckSelect.createEl('option', { value: '__new__', text: '+ Create New Deck' });
        if (this.createNewDeck) {
            createNewOption.selected = true;
        }

        // Handle selection change
        deckSelect.addEventListener('change', (e) => {
            const value = (e.target as HTMLSelectElement).value;
            if (value === '__new__') {
                this.createNewDeck = true;
                this.deckNameInput.inputEl.style.display = 'block';
            } else {
                this.createNewDeck = false;
                this.selectedDeck = value;
                this.deckNameInput.inputEl.style.display = 'none';
            }
        });

        // Create deck name input (hidden initially)
        const nameInputContainer = deckContainer.createEl('div', { cls: 'config-item' });
        nameInputContainer.createEl('label', { text: 'Deck Name:', cls: 'config-label' });
        this.deckNameInput = new TextComponent(nameInputContainer);
        this.deckNameInput
            .setPlaceholder('General')
            .setValue(this.deckName)
            .onChange((value) => {
                this.deckName = value || "General";
            });

        // Hide input if not creating new deck
        if (!this.createNewDeck && this.existingDecks.length > 0) {
            this.deckNameInput.inputEl.style.display = 'none';
        }
    }

    /**
     * Build the configuration section
     */
    private buildConfigurationSection(container: HTMLElement): void {
        const configHeader = container.createEl('div', { cls: 'section-header' });
        configHeader.setText('Flashcard Configuration');

        // Card Count Slider
        const countContainer = container.createEl('div', { cls: 'config-item' });
        countContainer.createEl('label', { text: `Card Count: ${this.cardCount}`, cls: 'config-label' });
        const countSlider = new SliderComponent(countContainer);
        countSlider
            .setLimits(1, 20, 1)
            .setValue(this.cardCount)
            .setDynamicTooltip()
            .onChange((value) => {
                this.cardCount = value;
                countContainer.querySelector('label')!.textContent = `Card Count: ${value}`;
            });

        // Difficulty Dropdown
        const difficultyContainer = container.createEl('div', { cls: 'config-item' });
        difficultyContainer.createEl('label', { text: 'Difficulty:', cls: 'config-label' });
        const difficultySelect = difficultyContainer.createEl('select', { cls: 'config-select' });
        ['Recall', 'Analysis', 'Application'].forEach((level) => {
            const option = difficultySelect.createEl('option', { value: level, text: level });
            if (level === this.difficulty) {
                option.selected = true;
            }
        });
        difficultySelect.addEventListener('change', (e) => {
            this.difficulty = (e.target as HTMLSelectElement).value as Difficulty;
        });

        // Card Style Dropdown
        const styleContainer = container.createEl('div', { cls: 'config-item' });
        styleContainer.createEl('label', { text: 'Card Style:', cls: 'config-label' });
        const styleSelect = styleContainer.createEl('select', { cls: 'config-select' });
        const styles: { value: CardStyle; label: string }[] = [
            { value: 'basic', label: 'Basic (Q::A)' },
            { value: 'cloze', label: 'Cloze Deletion ({c1::answer})' },
            { value: 'multiline', label: 'Multi-line' }
        ];
        styles.forEach((style) => {
            const option = styleSelect.createEl('option', { value: style.value, text: style.label });
            if (style.value === this.cardStyle) {
                option.selected = true;
            }
        });
        styleSelect.addEventListener('change', (e) => {
            this.cardStyle = (e.target as HTMLSelectElement).value as CardStyle;
        });

        // Additional Instructions TextArea
        const instructionsContainer = container.createEl('div', { cls: 'config-item' });
        instructionsContainer.createEl('label', { text: 'Additional Instructions:', cls: 'config-label' });
        const instructionsInput = new TextAreaComponent(instructionsContainer);
        instructionsInput
            .setPlaceholder('e.g., Focus on dates, Use analogies in answers...')
            .setValue(this.additionalInstructions)
            .onChange((value) => {
                this.additionalInstructions = value;
            });
        instructionsInput.inputEl.rows = 3;
    }

    /**
     * Build the progress section (hidden initially)
     */
    private buildProgressSection(container: HTMLElement): void {
        this.progressContainer = container.createEl('div', { cls: 'progress-section' });
        this.progressContainer.style.display = 'none';

        const progressLabel = this.progressContainer.createEl('div', { cls: 'progress-label' });
        progressLabel.textContent = 'Generating flashcards...';

        this.progressBar = this.progressContainer.createEl('div', { cls: 'progress-bar' });
        const progressFill = this.progressBar.createEl('div', { cls: 'progress-fill' });
        progressFill.style.width = '0%';

        this.progressText = this.progressContainer.createEl('div', { cls: 'progress-text' });
        this.progressText.textContent = '';
    }

    /**
     * Build the post-action section (hidden initially)
     */
    private buildPostActionSection(container: HTMLElement): void {
        this.postActionContainer = container.createEl('div', { cls: 'post-action-section' });
        this.postActionContainer.style.display = 'none';

        const successMessage = this.postActionContainer.createEl('div', { cls: 'success-message' });
        successMessage.textContent = 'Flashcards generated successfully!';

        const buttonsContainer = this.postActionContainer.createEl('div', { cls: 'post-action-buttons' });

        new ButtonComponent(buttonsContainer)
            .setButtonText('Open Deck')
            .setCta()
            .onClick(() => {
                this.openGeneratedDeck();
            });

        new ButtonComponent(buttonsContainer)
            .setButtonText('Close')
            .onClick(() => {
                this.close();
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
            .setButtonText('Generate Flashcards')
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
     * Reads file contents, calls FlashcardManager, and saves the flashcards
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
        if (!this.activeFile) {
            new Notice('No active file');
            return;
        }

        if (this.cardCount < 1 || this.cardCount > 20) {
            new Notice('Card count must be between 1 and 20');
            return;
        }

        // Determine deck name
        const finalDeckName = this.createNewDeck ? this.deckName : this.selectedDeck;
        if (!finalDeckName.trim()) {
            new Notice('Please enter a deck name');
            return;
        }

        this.isProcessing = true;
        this.generateButton.setButtonText('Generating...');
        this.generateButton.setDisabled(true);

        // Show progress section
        this.progressContainer.style.display = 'block';
        this.postActionContainer.style.display = 'none';

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

            // Combine all context into a single string
            const combinedContext = fileContexts
                .map(fc => `Source: ${fc.name}\n${fc.content}`)
                .join('\n\n---\n\n');

            // Generate flashcards
            const cards = await this.plugin.services.flashcardManager.generateCardBatch({
                context: combinedContext,
                count: this.cardCount,
                instructions: this.additionalInstructions,
                difficulty: this.difficulty,
                cardStyle: this.cardStyle,
                sourceNote: this.activeFile.basename,
                onProgress: (current, total) => {
                    this.updateProgress(current, total);
                }
            });

            // Save flashcards
            const filePath = await this.plugin.services.flashcardManager.saveFlashcards(
                this.activeFile.basename,
                finalDeckName,
                cards
            );

            // Insert link to deck in active note
            this.insertDeckLink(filePath, finalDeckName);

            // Show success message
            new Notice(`Generated ${cards.length} flashcard(s) successfully!`);

            // Show post-action section
            this.progressContainer.style.display = 'none';
            this.postActionContainer.style.display = 'block';
            this.generateButton.setButtonText('Generate Flashcards');
            this.generateButton.setDisabled(false);

        } catch (error) {
            ErrorHandler.handleError(error, 'API_GENERATE_ERROR', {
                operation: 'generateFlashcards',
                deckName: finalDeckName,
                difficulty: this.difficulty,
                cardCount: this.cardCount
            });
            
            new Notice('Failed to generate flashcards. Please check console for details.');
            this.progressContainer.style.display = 'none';
            this.generateButton.setButtonText('Generate Flashcards');
            this.generateButton.setDisabled(false);
        } finally {
            this.isProcessing = false;
        }
    }

    /**
     * Update progress bar
     */
    private updateProgress(current: number, total: number): void {
        const percentage = Math.round((current / total) * 100);
        const progressFill = this.progressBar.querySelector('.progress-fill') as HTMLElement;
        if (progressFill) {
            progressFill.style.width = `${percentage}%`;
        }
        this.progressText.textContent = `Generating card ${current}/${total}...`;
    }

    /**
     * Insert a wikilink to the deck in the active note
     */
    private insertDeckLink(deckFilePath: string, deckName: string): void {
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
            const displayName = `Flashcards: ${deckName}`;
            const wikilink = `[[${deckFilePath}|${displayName}]]`;

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

            new Notice('Deck link inserted into note');

        } catch (error) {
            ErrorHandler.handleError(error, 'FILE_OPERATION', {
                operation: 'insertDeckLink',
                filePath: this.activeFile.path
            });
        }
    }

    /**
     * Open the generated deck file
     */
    private openGeneratedDeck(): void {
        if (!this.activeFile) {
            return;
        }

        const finalDeckName = this.createNewDeck ? this.deckName : this.selectedDeck;
        const flashcardFolder = this.plugin.settings.flashcardFolder || 'Flashcards';
        const deckFilePath = `${flashcardFolder}/${this.activeFile.basename}/${finalDeckName}.md`;

        const deckFile = this.app.vault.getAbstractFileByPath(deckFilePath);
        if (deckFile) {
            this.app.workspace.openLinkText(deckFilePath, '');
        } else {
            new Notice('Deck file not found');
        }
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
