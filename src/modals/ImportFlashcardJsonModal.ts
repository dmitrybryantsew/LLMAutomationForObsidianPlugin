import { App, Modal, Notice, Setting, TFile } from 'obsidian';
import type GptFreeTextGeneratorPlugin from '../main';
import {
  JsonImportParseResult,
  ParsedJsonCard,
  SpacedRepetitionJsonImporter,
} from '../utils/spacedRepetition/SpacedRepetitionJsonImporter';
import { CardManagementRecord } from '../utils/spacedRepetition/SpacedRepetitionDatabase';

export class ImportFlashcardJsonModal extends Modal {
  private plugin: GptFreeTextGeneratorPlugin;
  private importer: SpacedRepetitionJsonImporter;

  private inputMode: 'paste' | 'file' = 'paste';
  private jsonText = '';
  private selectedFilePath = '';
  private availableJsonFiles: string[] = [];

  private customStudySetName = '';
  private skipDuplicates = true;
  private linkActiveNote = false;
  private activeNotePath = '';

  private parseResult: JsonImportParseResult | null = null;
  private existingCards: CardManagementRecord[] = [];
  private importing = false;

  constructor(app: App, plugin: GptFreeTextGeneratorPlugin) {
    super(app);
    this.plugin = plugin;
    this.importer = new SpacedRepetitionJsonImporter(app, plugin);
  }

  async onOpen(): Promise<void> {
    this.modalEl.addClass('llm-automation-json-import-modal');
    this.modalEl.style.width = '780px';
    this.modalEl.style.maxWidth = '95vw';

    // Check active note
    const activeFile = this.app.workspace.getActiveFile();
    if (activeFile && activeFile.extension === 'md') {
      this.activeNotePath = activeFile.path;
      this.linkActiveNote = true;
    }

    // Load available .json files from vault
    this.availableJsonFiles = this.app.vault
      .getFiles()
      .filter((f) => f.extension === 'json' && !f.path.startsWith('.obsidian/'))
      .map((f) => f.path);

    if (this.availableJsonFiles.length > 0) {
      this.selectedFilePath = this.availableJsonFiles[0];
    }

    // Pre-load existing cards for fast duplicate detection
    try {
      const database = await this.plugin.services.ensureSpacedRepetitionDatabase();
      this.existingCards = database.getCardsForManagement({ limit: 10000 });
    } catch (err) {
      console.warn('Could not load existing cards for deduplication:', err);
    }

    this.render();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl('h2', { text: 'Import Flashcards from JSON' });

    const banner = contentEl.createDiv({ cls: 'llm-automation-import-banner' });
    banner.style.padding = '10px 14px';
    banner.style.marginBottom = '16px';
    banner.style.background = 'var(--background-secondary)';
    banner.style.border = '1px solid var(--background-modifier-border)';
    banner.style.borderRadius = '6px';
    banner.style.fontSize = '0.88rem';
    banner.setText(
      'Import cards with full fidelity: Multiple Choice, Typed Exact, Typed Fields, Self-Check, and LLM-checked cards with rubrics.'
    );

    // 1. Input Mode Selector
    new Setting(contentEl)
      .setName('Source')
      .setDesc('Paste JSON directly or choose a JSON file from your vault.')
      .addDropdown((dropdown) => {
        dropdown
          .addOption('paste', 'Paste JSON / Clipboard')
          .addOption('file', 'Choose Vault .json File')
          .setValue(this.inputMode)
          .onChange(async (val) => {
            this.inputMode = val as 'paste' | 'file';
            this.parseResult = null;
            if (this.inputMode === 'file' && this.selectedFilePath) {
              await this.loadFileContent();
            }
            this.render();
          });
      });

    // 2. Input Controls depending on mode
    if (this.inputMode === 'paste') {
      const textSetting = new Setting(contentEl)
        .setName('JSON Content')
        .setDesc('Paste LLM JSON or card export JSON here.');

      textSetting.controlEl.style.width = '100%';
      textSetting.infoEl.style.marginBottom = '8px';

      const textarea = textSetting.controlEl.createEl('textarea', {
        cls: 'llm-automation-json-input',
        attr: {
          placeholder: '{\n  "deckName": "My Deck",\n  "questions": [\n    {\n      "questionType": "multiple_choice",\n      "questionText": "Question?",\n      "choices": ["A", "B", "C", "D"],\n      "answerText": "A"\n    }\n  ]\n}',
          rows: '7',
        },
      });
      textarea.style.width = '100%';
      textarea.style.fontFamily = 'var(--font-monospace)';
      textarea.style.fontSize = '0.82rem';
      textarea.style.resize = 'vertical';
      textarea.value = this.jsonText;

      textarea.addEventListener('input', () => {
        this.jsonText = textarea.value;
      });
    } else {
      if (this.availableJsonFiles.length === 0) {
        const noFilesEl = contentEl.createDiv({ text: 'No .json files found in your vault.' });
        noFilesEl.style.color = 'var(--text-muted)';
        noFilesEl.style.padding = '10px';
      } else {
        const fileOptions: Record<string, string> = {};
        for (const path of this.availableJsonFiles) {
          fileOptions[path] = path;
        }

        new Setting(contentEl)
          .setName('Vault File')
          .setDesc('Select the .json file to import.')
          .addDropdown((dropdown) => {
            dropdown
              .addOptions(fileOptions)
              .setValue(this.selectedFilePath)
              .onChange(async (val) => {
                this.selectedFilePath = val;
                await this.loadFileContent();
                this.handleParse();
                this.render();
              });
          });
      }
    }

    // 3. Options
    new Setting(contentEl)
      .setName('Target Study Set Name')
      .setDesc('Leave blank to use the deck name detected in the JSON.')
      .addText((text) => {
        text
          .setPlaceholder(this.parseResult?.deckName || 'Imported JSON Cards')
          .setValue(this.customStudySetName)
          .onChange((val) => {
            this.customStudySetName = val.trim();
          });
      });

    new Setting(contentEl)
      .setName('Skip Duplicate Cards')
      .setDesc('Avoid re-importing questions that already exist in your database.')
      .addToggle((toggle) => {
        toggle.setValue(this.skipDuplicates).onChange((val) => {
          this.skipDuplicates = val;
          this.renderPreviewTable(contentEl);
        });
      });

    if (this.activeNotePath) {
      new Setting(contentEl)
        .setName('Link to Active Note')
        .setDesc(`Link imported cards to "${this.activeNotePath.split('/').pop()}".`)
        .addToggle((toggle) => {
          toggle.setValue(this.linkActiveNote).onChange((val) => {
            this.linkActiveNote = val;
          });
        });
    }

    // 4. Action Row (Parse/Preview & Import)
    const actionRow = contentEl.createDiv({ cls: 'llm-automation-import-actions' });
    actionRow.style.display = 'flex';
    actionRow.style.justifyContent = 'space-between';
    actionRow.style.alignItems = 'center';
    actionRow.style.marginTop = '16px';
    actionRow.style.marginBottom = '12px';

    const parseBtn = actionRow.createEl('button', {
      text: 'Parse & Preview',
      cls: 'llm-automation-btn llm-automation-btn-secondary',
    });
    parseBtn.addEventListener('click', () => {
      this.handleParse();
      this.render();
    });

    const readyCards = this.parseResult
      ? (this.skipDuplicates ? this.parseResult.cards.filter((c) => !c.isDuplicate) : this.parseResult.cards)
      : [];

    const importBtn = actionRow.createEl('button', {
      text: this.importing ? 'Importing...' : `Import ${readyCards.length} Card${readyCards.length === 1 ? '' : 's'}`,
      cls: 'llm-automation-btn llm-automation-btn-primary mod-cta',
    });
    importBtn.disabled = this.importing || readyCards.length === 0;
    importBtn.addEventListener('click', () => void this.handleImport());

    // 5. Preview Table & Summary
    this.renderPreviewTable(contentEl);
  }

  private async loadFileContent(): Promise<void> {
    if (!this.selectedFilePath) return;
    try {
      const file = this.app.vault.getAbstractFileByPath(this.selectedFilePath);
      if (file instanceof TFile) {
        this.jsonText = await this.app.vault.read(file);
      }
    } catch (err) {
      new Notice(`Failed to read file: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  }

  private handleParse(): void {
    if (!this.jsonText.trim()) {
      new Notice('Please paste JSON text or select a file first');
      this.parseResult = null;
      return;
    }

    this.parseResult = this.importer.parseJsonContent(this.jsonText, this.existingCards);
    if (!this.parseResult.success) {
      new Notice(`Parse error: ${this.parseResult.errors.join('; ')}`);
    } else {
      if (this.parseResult.deckName && !this.customStudySetName) {
        this.customStudySetName = this.parseResult.deckName;
      }
    }
  }

  private renderPreviewTable(container: HTMLElement): void {
    if (!this.parseResult) {
      return;
    }

    const summaryBox = container.createDiv({ cls: 'llm-automation-preview-summary' });
    summaryBox.style.marginBottom = '10px';
    summaryBox.style.display = 'flex';
    summaryBox.style.flexWrap = 'wrap';
    summaryBox.style.gap = '8px';
    summaryBox.style.alignItems = 'center';

    if (this.parseResult.errors.length > 0) {
      const errBox = summaryBox.createDiv({ cls: 'llm-automation-error-banner' });
      errBox.style.color = 'var(--text-error)';
      errBox.setText(this.parseResult.errors.join('; '));
      return;
    }

    const totalBadge = summaryBox.createSpan();
    totalBadge.style.fontWeight = '600';
    totalBadge.setText(`Total Parsed: ${this.parseResult.totalParsed}`);

    for (const [type, count] of Object.entries(this.parseResult.cardTypeCounts)) {
      const badge = summaryBox.createSpan({ cls: 'badge' });
      badge.style.padding = '2px 8px';
      badge.style.borderRadius = '12px';
      badge.style.fontSize = '0.78rem';
      badge.style.background = 'var(--background-secondary-alt)';
      badge.style.border = '1px solid var(--background-modifier-border)';
      badge.setText(`${type}: ${count}`);
    }

    if (this.parseResult.duplicateCount > 0) {
      const dupBadge = summaryBox.createSpan();
      dupBadge.style.padding = '2px 8px';
      dupBadge.style.borderRadius = '12px';
      dupBadge.style.fontSize = '0.78rem';
      dupBadge.style.color = 'var(--text-warning, #e6a23c)';
      dupBadge.style.fontWeight = '600';
      dupBadge.setText(`⚠️ ${this.parseResult.duplicateCount} duplicate${this.parseResult.duplicateCount === 1 ? '' : 's'} (${this.skipDuplicates ? 'will skip' : 'will import'})`);
    }

    const previewContainer = container.createDiv({ cls: 'llm-automation-preview-container' });
    previewContainer.style.maxHeight = '280px';
    previewContainer.style.overflowY = 'auto';
    previewContainer.style.border = '1px solid var(--background-modifier-border)';
    previewContainer.style.borderRadius = '6px';
    previewContainer.style.background = 'var(--background-primary)';
    previewContainer.style.padding = '8px';

    const cardsToShow = this.parseResult.cards;

    for (let idx = 0; idx < cardsToShow.length; idx++) {
      const card = cardsToShow[idx];
      const row = previewContainer.createDiv({ cls: 'llm-automation-preview-card' });
      row.style.borderBottom = '1px solid var(--background-modifier-border)';
      row.style.padding = '8px 10px';
      row.style.display = 'flex';
      row.style.flexDirection = 'column';
      row.style.gap = '4px';

      if (card.isDuplicate && this.skipDuplicates) {
        row.style.opacity = '0.45';
      }

      const rowHeader = row.createDiv();
      rowHeader.style.display = 'flex';
      rowHeader.style.justifyContent = 'space-between';
      rowHeader.style.alignItems = 'center';
      rowHeader.style.fontSize = '0.75rem';

      const leftBadge = rowHeader.createSpan({
        text: `#${idx + 1} · ${card.questionType.toUpperCase()}${card.questionName ? ` · ${card.questionName}` : ''}`,
      });
      leftBadge.style.fontWeight = '600';
      leftBadge.style.color = 'var(--text-accent)';

      if (card.isDuplicate) {
        const dupTag = rowHeader.createSpan({ text: 'Duplicate' });
        dupTag.style.color = 'var(--text-warning, #e6a23c)';
        dupTag.style.fontWeight = '600';
      } else if (card.initialSchedule) {
        const schedTag = rowHeader.createSpan({
          text: `Int: ${card.initialSchedule.intervalDays ?? 0}d · Ease: ${card.initialSchedule.ease ?? 2.5}`,
        });
        schedTag.style.color = 'var(--color-green, #48bb78)';
      }

      const qEl = row.createDiv({ text: `Q: ${card.questionText}` });
      qEl.style.fontSize = '0.88rem';
      qEl.style.fontWeight = '500';

      if (card.questionType === 'multiple_choice' && card.choices?.length) {
        const choiceBox = row.createDiv();
        choiceBox.style.fontSize = '0.82rem';
        choiceBox.style.color = 'var(--text-muted)';
        choiceBox.style.paddingLeft = '8px';
        for (const ch of card.choices) {
          const isCorrect = ch.trim().toLowerCase() === (card.answerText ?? '').trim().toLowerCase();
          const chLine = choiceBox.createDiv();
          chLine.setText(`${isCorrect ? '✓ ' : '• '} ${ch}`);
          if (isCorrect) chLine.style.fontWeight = '600';
        }
      } else if (card.questionType === 'typed_fields_exact' && Array.isArray(card.metadata.exactFields)) {
        const fieldsBox = row.createDiv();
        fieldsBox.style.fontSize = '0.82rem';
        fieldsBox.style.color = 'var(--text-muted)';
        fieldsBox.style.paddingLeft = '8px';
        for (const f of card.metadata.exactFields as any[]) {
          fieldsBox.createDiv({
            text: `${f.label}: ${f.answer}${f.aliases?.length ? ` (aliases: ${f.aliases.join(', ')})` : ''}`,
          });
        }
      } else if (card.answerText) {
        const aEl = row.createDiv({ text: `A: ${card.answerText}` });
        aEl.style.fontSize = '0.85rem';
        aEl.style.color = 'var(--text-muted)';
      }
    }
  }

  private async handleImport(): Promise<void> {
    if (!this.parseResult || this.parseResult.cards.length === 0) return;

    try {
      this.importing = true;
      this.render();

      const result = await this.importer.importParsedBatch(this.parseResult.cards, {
        customStudySetName: this.customStudySetName || this.parseResult.deckName || 'Imported JSON Cards',
        skipDuplicates: this.skipDuplicates,
        activeNotePath: this.linkActiveNote ? this.activeNotePath : null,
      });

      new Notice(
        `Successfully imported ${result.importedCount} card(s) into Study Set "${result.studySetName}"!` +
          (result.skippedCount > 0 ? ` (${result.skippedCount} duplicates skipped)` : '')
      );

      this.close();

      // Open or reveal Flashcard Hub to show imported cards
      void this.plugin.activateView('llm-automation-flashcard-hub');
    } catch (err) {
      console.error('Import JSON batch failed:', err);
      new Notice(`Import failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      this.importing = false;
    }
  }
}
