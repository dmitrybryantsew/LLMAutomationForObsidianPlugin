import { App, Modal, TFile, MarkdownView, Editor, ButtonComponent, Notice, TextAreaComponent, Setting, DropdownComponent } from 'obsidian';
import type GptFreeTextGeneratorPlugin from '../main';
import { VaultFileSelectorModal } from './VaultFileSelectorModal';
import { ErrorHandler } from '../utils/ErrorHandler';
import { FileContext, TextGenerationOptions } from '../types/openrouter';
import { PdfHelper } from '../utils/PdfHelper';
import { EvidenceItem, EvidencePack, SearchHit, SearchRequest } from '../types/retrieval';
import {
  GROUNDED_ANSWER_INSTRUCTION,
  formatEvidenceFileContextName,
  formatEvidenceForModel,
} from '../retrieval/EvidencePackBuilder';

type QuickQueryScope = 'current-note' | 'linked-notes' | 'indexed-knowledge-base' | 'selected-folders';

export interface QuickQueryModalOptions {
  /**
   * Initial scope. Defaults to 'current-note' to preserve the legacy flow.
   */
  mode?: QuickQueryScope;
  /**
   * Pre-seeded query (used when hand-off from SearchKnowledgeModal).
   */
  preselectedQuery?: string;
  /**
   * Pre-seeded, already-retrieved hits to use as evidence without re-running search.
   * Only used when mode === 'indexed-knowledge-base'.
   */
  preselectedHits?: SearchHit[];
}

/**
 * QuickQueryModal - Contextual Learning Assistant
 *
 * Allows users to query an LLM directly from within an active note using a modal.
 * Automatically aggregates context from the active note and all files linked within it
 * ("mentioned files") to answer questions without leaving the editor.
 *
 * Scopes:
 *  - current-note: legacy behaviour (active note + manually selected files)
 *  - linked-notes: legacy behaviour (mentioned files)
 *  - indexed-knowledge-base: retrieval-augmented; builds an EvidencePack and grounds the answer
 *  - selected-folders: retrieval over a folder prefix (falls back to indexed-knowledge-base logic)
 */
export class QuickQueryModal extends Modal {
    // Dependencies
    private plugin: GptFreeTextGeneratorPlugin;
    private readonly options: QuickQueryModalOptions;

    // State
    private activeFile: TFile | null;
    private contextFiles: Set<TFile> = new Set();
    private prompt: string = "";
    private isProcessing: boolean = false;
    private includeCurrentNote: boolean = true;
    private includeManualFilesWithRetrieval: boolean = false;
    private queryScope: QuickQueryScope;
    private folderPrefix: string = '';
    private generatedResponse: string = "";

    // Retrieval state
    private retrievedHits: SearchHit[] = [];
    private selectedHitIds = new Set<string>();
    private lastEvidencePack: EvidencePack | null = null;

    // UI References
    private fileListContainer!: HTMLElement;
    private outputArea!: HTMLElement;
    private promptInput!: TextAreaComponent;
    private generateButton!: ButtonComponent;
    private insertButton!: ButtonComponent;
    private appendButton!: ButtonComponent;
    private toggleContainer!: HTMLElement;
    private scopeDropdown!: DropdownComponent;
    private sourcesContainer!: HTMLElement;
    private previewSourcesButton!: ButtonComponent;
    private retrievalControlsContainer!: HTMLElement;

    constructor(app: App, plugin: GptFreeTextGeneratorPlugin, options?: QuickQueryModalOptions) {
        super(app);
        this.plugin = plugin;
        this.options = options ?? {};
        this.queryScope = this.options.mode ?? 'current-note';
        this.activeFile = app.workspace.getActiveFile();

        if (this.options.preselectedQuery) {
            this.prompt = this.options.preselectedQuery;
        }
        if (this.options.preselectedHits?.length) {
            this.retrievedHits = this.options.preselectedHits;
            this.selectedHitIds = new Set(this.retrievedHits.map((hit) => hit.id));
        }

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

        // Scope dropdown: controls whether retrieval is used.
        const scopeSetting = new Setting(container)
            .setName('Scope')
            .setDesc('Choose where to look for evidence. "Indexed knowledge base" uses retrieval + grounding.');
        this.scopeDropdown = new DropdownComponent(scopeSetting.controlEl);
        this.scopeDropdown.addOptions({
            'current-note': 'Current note + selected files',
            'linked-notes': 'Linked notes',
            'indexed-knowledge-base': 'Indexed knowledge base',
            'selected-folders': 'Selected folders (indexed)',
        });
        this.scopeDropdown.setValue(this.queryScope);
        this.scopeDropdown.onChange((value) => {
            this.queryScope = value as QuickQueryScope;
            this.refreshRetrievalControlsVisibility();
        });

        // Folder prefix (only relevant for 'selected-folders').
        this.retrievalControlsContainer = container.createEl('div', { cls: 'retrieval-controls' });
        new Setting(this.retrievalControlsContainer)
            .setName('Folder prefix')
            .setDesc('Restrict retrieval to paths starting with this prefix.')
            .addText((text) =>
                text
                    .setPlaceholder('e.g. Networking/')
                    .onChange((value) => {
                        this.folderPrefix = value.trim();
                    })
            );

        // Preview sources button.
        this.previewSourcesButton = new ButtonComponent(this.retrievalControlsContainer);
        this.previewSourcesButton
            .setButtonText('Preview sources')
            .setTooltip('Run retrieval now and show candidate chunks before generating.')
            .onClick(() => {
                void this.runRetrievalPreview();
            });

        // Sources list (populated after a preview or hand-off).
        this.sourcesContainer = this.retrievalControlsContainer.createEl('div', { cls: 'quick-query-sources empty' });
        this.sourcesContainer.createEl('div', {
            cls: 'context-empty-message',
            text: 'Click "Preview sources" to retrieve candidates.',
        });

        // Toggle: include manually selected files in addition to retrieved evidence.
        const includeManual = this.retrievalControlsContainer.createEl('div', { cls: 'toggle-container' });
        includeManual.createSpan({ text: 'Include manually selected files too: ' });
        const manualToggle = includeManual.createEl('input', { type: 'checkbox' });
        manualToggle.checked = this.includeManualFilesWithRetrieval;
        manualToggle.addEventListener('change', (e) => {
            this.includeManualFilesWithRetrieval = (e.target as HTMLInputElement).checked;
        });

        this.refreshRetrievalControlsVisibility();
        this.renderSources();

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

    private refreshRetrievalControlsVisibility(): void {
        const isRetrieval = this.queryScope === 'indexed-knowledge-base' || this.queryScope === 'selected-folders';
        this.retrievalControlsContainer.style.display = isRetrieval ? '' : 'none';
    }

    private renderSources(): void {
        this.sourcesContainer.empty();
        if (this.retrievedHits.length === 0) {
            this.sourcesContainer.addClass('empty');
            this.sourcesContainer.createEl('div', {
                cls: 'context-empty-message',
                text: 'Click "Preview sources" to retrieve candidates.',
            });
            return;
        }
        this.sourcesContainer.removeClass('empty');

        for (const hit of this.retrievedHits) {
            const card = this.sourcesContainer.createEl('div', { cls: 'quick-query-source-card' });

            const checkbox = card.createEl('input', { type: 'checkbox' });
            checkbox.checked = this.selectedHitIds.has(hit.id);
            checkbox.addEventListener('change', () => {
                if (checkbox.checked) {
                    this.selectedHitIds.add(hit.id);
                } else {
                    this.selectedHitIds.delete(hit.id);
                }
            });

            const titleArea = card.createEl('div', { cls: 'quick-query-source-title' });
            titleArea.createEl('span', { cls: 'quick-query-source-basename', text: hit.basename });
            const heading = hit.headingPath.length > 0 ? hit.headingPath.join(' > ') : '(preamble)';
            titleArea.createEl('span', { cls: 'quick-query-source-heading', text: heading });

            const meta = card.createEl('div', { cls: 'quick-query-source-meta' });
            meta.createEl('span', { text: hit.path });
            meta.createEl('span', { text: `Lines ${hit.startLine}-${hit.endLine}` });
            meta.createEl('span', { text: `score ${hit.finalScore.toFixed(3)}` });
            if (hit.matchReasons.length > 0) {
                meta.createEl('span', { cls: 'quick-query-source-reasons', text: hit.matchReasons.join(', ') });
            }

            const openBtn = card.createEl('button', { cls: 'quick-query-source-open' });
            openBtn.setText('Open');
            openBtn.addEventListener('click', () => {
                void this.openSourceHit(hit);
            });
        }
    }

    private async openSourceHit(hit: SearchHit): Promise<void> {
        const file = this.app.vault.getAbstractFileByPath(hit.path);
        if (!(file instanceof TFile)) {
            new Notice(`Could not find file: ${hit.path}.`);
            return;
        }
        await this.app.workspace.openLinkText(hit.path, '', false);
    }

    private async runRetrievalPreview(): Promise<void> {
        const service = this.plugin.services.retrievalService;
        if (!service) {
            new Notice('Retrieval is not initialized. Enable it in Settings → Knowledge Retrieval.');
            return;
        }
        const query = this.prompt.trim();
        if (!query) {
            new Notice('Enter a question first.');
            return;
        }
        const request: SearchRequest = {
            query,
            folderPrefix: this.queryScope === 'selected-folders' ? this.folderPrefix || undefined : undefined,
            includeCurrentNotePath: this.activeFile?.path,
            limit: this.plugin.settings.retrieval.defaultResultLimit,
        };
        try {
            this.previewSourcesButton.setButtonText('Searching...').setDisabled(true);
            this.retrievedHits = await service.search(request);
            this.selectedHitIds = new Set(this.retrievedHits.map((hit) => hit.id));
            this.renderSources();
            if (this.retrievedHits.length === 0) {
                new Notice('No results found in the indexed sources.');
            }
        } catch (error) {
            ErrorHandler.handleError(error, 'FILE_OPERATION', { operation: 'retrievalPreview' });
        } finally {
            this.previewSourcesButton.setButtonText('Preview sources').setDisabled(false);
        }
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

        const isRetrievalScope = this.queryScope === 'indexed-knowledge-base' || this.queryScope === 'selected-folders';

        this.isProcessing = true;
        this.generateButton.setButtonText('Generating...');
        this.generateButton.setDisabled(true);
        this.outputArea.empty();
        this.outputArea.addClass('empty');
        this.outputArea.setText('Generating response...');
        this.insertButton.buttonEl.style.display = 'none';
        this.appendButton.buttonEl.style.display = 'none';
        this.lastEvidencePack = null;

        try {
            const fileContexts: FileContext[] = [];
            let systemInstruction = 'Analyze the provided context files to answer the user request. Highlight connections between the documents.';
            let temperature = 0.7;
            let evidencePack: EvidencePack | null = null;

            if (isRetrievalScope) {
                const retrievalService = this.plugin.services.retrievalService;
                if (!retrievalService) {
                    new Notice('Retrieval is not initialized. Enable it in Settings → Knowledge Retrieval.');
                    return;
                }

                // If the user pre-selected hits (hand-off or preview), reuse them; otherwise run search now.
                let hits = this.retrievedHits;
                if (hits.length === 0) {
                    const request: SearchRequest = {
                        query: this.prompt.trim(),
                        folderPrefix: this.queryScope === 'selected-folders' ? this.folderPrefix || undefined : undefined,
                        includeCurrentNotePath: this.activeFile?.path,
                        limit: this.plugin.settings.retrieval.defaultResultLimit,
                    };
                    hits = await retrievalService.search(request);
                    this.retrievedHits = hits;
                    this.selectedHitIds = new Set(hits.map((hit) => hit.id));
                    this.renderSources();
                }

                // Filter to user-selected hits only.
                const selectedHits = hits.filter((hit) => this.selectedHitIds.has(hit.id));
                if (selectedHits.length === 0) {
                    new Notice('No sources selected. Click "Preview sources" and select at least one chunk.');
                    return;
                }

                evidencePack = this.buildEvidencePackFromHits(selectedHits);
                this.lastEvidencePack = evidencePack;

                for (const item of evidencePack.items) {
                    fileContexts.push({
                        path: item.path,
                        name: formatEvidenceFileContextName(item),
                        content: formatEvidenceForModel(item),
                    });
                }

                systemInstruction = GROUNDED_ANSWER_INSTRUCTION;
                temperature = 0.3;

                // Optionally include manually selected files alongside the evidence pack.
                if (this.includeManualFilesWithRetrieval) {
                    await this.appendManualFileContexts(fileContexts);
                }

                // Optionally include the active note too (clearly marked as non-evidence).
                if (this.includeCurrentNote && this.activeFile) {
                    try {
                        const activeNoteContent = await this.app.vault.read(this.activeFile);
                        fileContexts.push({
                            path: this.activeFile.path,
                            name: `[Active note] ${this.activeFile.basename}`,
                            content: activeNoteContent,
                        });
                    } catch (error) {
                        ErrorHandler.handleError(error, 'FILE_OPERATION', {
                            operation: 'readActiveNote',
                            filePath: this.activeFile.path
                        });
                    }
                }
            } else {
                // Legacy manual-context path: active note + manually selected files.
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

                await this.appendManualFileContexts(fileContexts);

                if (this.queryScope === 'linked-notes') {
                    // Make sure mentioned files are present in the context set before reading.
                    this.addMentionedFiles();
                    await this.appendManualFileContexts(fileContexts, /* skipAlreadyAdded */ true);
                }
            }

            // Build the message with prompt engineering
            const message = `${systemInstruction}\n\n${this.prompt}`;

            // Prepare generation options
            const options: TextGenerationOptions = {
                model: this.plugin.settings.openrouterTextModel || this.plugin.settings.defaultTextModel,
                message: message,
                files: fileContexts.length > 0 ? fileContexts : undefined,
                temperature,
                maxTokens: 2000,
                language: this.plugin.settings.defaultLanguage
            };

            // Call LLM service
            const response = await client.generateText(options);

            // Append a Sources section parsed only from the known evidence-pack IDs.
            let display = response.output;
            if (evidencePack && evidencePack.items.length > 0) {
                const sourcesSection = this.renderSourcesSection(evidencePack);
                if (sourcesSection) {
                    display = `${response.output}\n\n${sourcesSection}`;
                }
            }

            // Store and display response
            this.generatedResponse = display;
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
                includeCurrentNote: this.includeCurrentNote,
                scope: this.queryScope,
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
     * Build an EvidencePack from a pre-filtered list of selected hits.
     * Stable citation IDs (S1, S2, ...) are assigned in rank order.
     */
    private buildEvidencePackFromHits(hits: SearchHit[]): EvidencePack {
        const items: EvidenceItem[] = hits.map((hit, index) => ({
            ...hit,
            citationId: `S${index + 1}`,
            estimatedTokens: Math.ceil(hit.text.length / 4),
        }));
        const totalEstimatedTokens = items.reduce((sum, item) => sum + item.estimatedTokens, 0);
        return {
            query: this.prompt.trim(),
            items,
            totalEstimatedTokens,
            omittedHitCount: 0,
        };
    }

    /**
     * Read each manually selected file and append it to the file contexts list.
     * @param skipAlreadyAdded when true, only add files not already represented
     *   in fileContexts (used by the 'linked-notes' scope to avoid duplicates).
     */
    private async appendManualFileContexts(
        fileContexts: FileContext[],
        skipAlreadyAdded = false
    ): Promise<void> {
        const existingPaths = new Set(fileContexts.map((ctx) => ctx.path));
        for (const file of this.contextFiles) {
            if (skipAlreadyAdded && existingPaths.has(file.path)) {
                continue;
            }
            try {
                let content: string;
                if (file.extension === 'pdf') {
                    const pdfHelper = new PdfHelper(this.app);
                    content = await pdfHelper.extractText(file);
                } else {
                    content = await this.app.vault.read(file);
                }
                fileContexts.push({
                    path: file.path,
                    name: file.basename,
                    content,
                });
            } catch (error) {
                ErrorHandler.handleError(error, 'FILE_OPERATION', {
                    operation: 'readContextFile',
                    filePath: file.path
                });
            }
        }
    }

    /**
     * Render a "Sources" section using only the known evidence-pack citation IDs.
     * Never parses free-form model text for paths.
     */
    private renderSourcesSection(pack: EvidencePack): string {
        if (pack.items.length === 0) {
            return '';
        }
        const lines = ['**Sources:**'];
        for (const item of pack.items) {
            const heading = item.headingPath.length > 0 ? item.headingPath.join(' > ') : '(preamble)';
            const link = this.buildSourceLink(item.path, heading);
            lines.push(`- [${item.citationId}] ${link} (lines ${item.startLine}-${item.endLine})`);
        }
        return lines.join('\n');
    }

    /**
     * Build an Obsidian link that opens the source note. We prefer the wiki-link
     * form `[[path#Heading]]` because Obsidian resolves it inside the editor.
     */
    private buildSourceLink(path: string, heading: string): string {
        if (!heading || heading === '(preamble)') {
            return `[[${path}]]`;
        }
        // Escape pipes inside the heading to avoid breaking the wiki-link alias syntax.
        const safeHeading = heading.replace(/\|/g, '\\|');
        return `[[${path}#${safeHeading}]]`;
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
