import { App, Modal, Notice, Setting, setIcon } from 'obsidian';
import type GptFreeTextGeneratorPlugin from '../main';
import {
  ObsidianSpacedRepetitionImporter,
  OsrScanResult,
  OsrDeckSummary,
} from '../utils/spacedRepetition/ObsidianSpacedRepetitionImporter';
import { ParsedOsrCard } from '../utils/spacedRepetition/ObsidianSpacedRepetitionParser';

export class ImportObsidianSpacedRepetitionModal extends Modal {
  private plugin: GptFreeTextGeneratorPlugin;
  private importer: ObsidianSpacedRepetitionImporter;

  private scanResult: OsrScanResult | null = null;
  private scanning = false;
  private importing = false;

  private selectedDeckTag = '';
  private batchSize = 5; // default to safe small batch
  private customStudySetName = '';
  private previewCards: ParsedOsrCard[] = [];

  constructor(app: App, plugin: GptFreeTextGeneratorPlugin) {
    super(app);
    this.plugin = plugin;
    this.importer = new ObsidianSpacedRepetitionImporter(app, plugin);
  }

  async onOpen(): Promise<void> {
    this.modalEl.addClass('llm-automation-osr-import-modal');
    this.modalEl.style.width = '760px';
    this.modalEl.style.maxWidth = '95vw';

    this.renderLoading('Scanning vault for Spaced Repetition plugin decks...');
    await this.scanVault();
    this.render();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private renderLoading(message: string): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h2', { text: 'Import from Spaced Repetition Plugin' });
    const p = contentEl.createEl('p', { text: message, cls: 'llm-automation-loading-text' });
    p.style.color = 'var(--text-muted)';
    p.style.fontStyle = 'italic';
  }

  private async scanVault(): Promise<void> {
    try {
      this.scanning = true;
      this.scanResult = await this.importer.scanVaultDecks();
      if (this.scanResult.decks.length > 0) {
        // Pick smallest deck first or first deck by default
        const smallest = [...this.scanResult.decks].sort((a, b) => a.totalCards - b.totalCards)[0];
        this.selectedDeckTag = smallest?.deckTag ?? this.scanResult.decks[0].deckTag;
        this.customStudySetName = `OSR: ${this.selectedDeckTag}`;
        await this.loadPreviewCards();
      }
    } catch (err) {
      console.error('Failed to scan vault for OSR cards:', err);
      new Notice(`Failed to scan for cards: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      this.scanning = false;
    }
  }

  private async loadPreviewCards(): Promise<void> {
    if (!this.selectedDeckTag) {
      this.previewCards = [];
      return;
    }

    const limit = this.batchSize === 0 ? undefined : this.batchSize;
    this.previewCards = await this.importer.loadCardsForDeck(this.selectedDeckTag, {
      limit,
    });
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl('h2', { text: 'Import from Spaced Repetition Plugin' });

    const banner = contentEl.createDiv({ cls: 'llm-automation-import-banner' });
    banner.style.padding = '10px 14px';
    banner.style.marginBottom = '16px';
    banner.style.background = 'var(--background-secondary)';
    banner.style.border = '1px solid var(--background-modifier-border)';
    banner.style.borderRadius = '6px';
    banner.style.fontSize = '0.9rem';

    if (!this.scanResult || this.scanResult.decks.length === 0) {
      banner.setText('No cards found matching configured deck tags (#flashcards, #CSharpFlashcards, #German, etc.).');
      return;
    }

    banner.createEl('p', {
      text: `Found ${this.scanResult.totalCards.toLocaleString()} total cards across ${this.scanResult.decks.length} deck(s) in your vault. Testing in small batches is recommended.`,
    });

    // Form controls
    const controls = contentEl.createDiv({ cls: 'llm-automation-import-controls' });

    // 1. Deck Selector
    const deckOptions: Record<string, string> = {};
    for (const d of this.scanResult.decks) {
      deckOptions[d.deckTag] = `${d.deckTag} (${d.totalCards} cards · ${d.dueCards} due · ${d.newCards} new)`;
    }

    new Setting(controls)
      .setName('Source Deck')
      .setDesc('Select the Spaced Repetition deck tag to import.')
      .addDropdown((dropdown) => {
        dropdown
          .addOptions(deckOptions)
          .setValue(this.selectedDeckTag)
          .onChange(async (val) => {
            this.selectedDeckTag = val;
            this.customStudySetName = `OSR: ${val}`;
            await this.loadPreviewCards();
            this.render();
          });
      });

    // 2. Batch Size
    new Setting(controls)
      .setName('Batch Size')
      .setDesc('Number of cards to import in this batch.')
      .addDropdown((dropdown) => {
        dropdown
          .addOptions({
            '5': '5 cards (Small test batch)',
            '10': '10 cards',
            '20': '20 cards',
            '50': '50 cards',
            '100': '100 cards',
            '0': 'All cards in deck',
          })
          .setValue(String(this.batchSize))
          .onChange(async (val) => {
            this.batchSize = parseInt(val, 10);
            await this.loadPreviewCards();
            this.render();
          });
      });

    // 3. Target Study Set Name
    new Setting(controls)
      .setName('Target Study Set Name')
      .setDesc('Name of the Study Set to create or add cards into in our database.')
      .addText((text) => {
        text
          .setValue(this.customStudySetName)
          .onChange((val) => {
            this.customStudySetName = val.trim();
          });
      });

    // Action buttons
    const actionRow = contentEl.createDiv({ cls: 'llm-automation-import-actions' });
    actionRow.style.display = 'flex';
    actionRow.style.justifyContent = 'space-between';
    actionRow.style.alignItems = 'center';
    actionRow.style.marginTop = '16px';
    actionRow.style.marginBottom = '16px';

    const cardCountInfo = actionRow.createSpan({ cls: 'llm-automation-preview-count' });
    cardCountInfo.style.fontWeight = '600';
    cardCountInfo.setText(`Previewing ${this.previewCards.length} card${this.previewCards.length === 1 ? '' : 's'}:`);

    const rightButtons = actionRow.createDiv();
    rightButtons.style.display = 'flex';
    rightButtons.style.gap = '8px';

    const rescanBtn = rightButtons.createEl('button', {
      text: 'Rescan Vault',
      cls: 'llm-automation-btn llm-automation-btn-secondary',
    });
    rescanBtn.addEventListener('click', async () => {
      this.renderLoading('Rescanning vault...');
      await this.scanVault();
      this.render();
    });

    const importBtn = rightButtons.createEl('button', {
      text: this.importing ? 'Importing...' : `Import ${this.previewCards.length} Cards`,
      cls: 'llm-automation-btn llm-automation-btn-primary mod-cta',
    });
    importBtn.disabled = this.importing || this.previewCards.length === 0;
    importBtn.addEventListener('click', () => void this.handleImport());

    // Preview Table
    this.renderPreviewTable(contentEl);
  }

  private renderPreviewTable(container: HTMLElement): void {
    const previewContainer = container.createDiv({ cls: 'llm-automation-preview-container' });
    previewContainer.style.maxHeight = '280px';
    previewContainer.style.overflowY = 'auto';
    previewContainer.style.border = '1px solid var(--background-modifier-border)';
    previewContainer.style.borderRadius = '6px';
    previewContainer.style.background = 'var(--background-primary)';
    previewContainer.style.padding = '8px';

    if (this.previewCards.length === 0) {
      const empty = previewContainer.createDiv({ text: 'No cards found in selected batch.' });
      empty.style.color = 'var(--text-muted)';
      empty.style.padding = '12px';
      empty.style.textAlign = 'center';
      return;
    }

    for (let idx = 0; idx < this.previewCards.length; idx++) {
      const card = this.previewCards[idx];
      const row = previewContainer.createDiv({ cls: 'llm-automation-preview-card' });
      row.style.borderBottom = '1px solid var(--background-modifier-border)';
      row.style.padding = '8px 10px';
      row.style.display = 'flex';
      row.style.flexDirection = 'column';
      row.style.gap = '4px';

      const rowHeader = row.createDiv();
      rowHeader.style.display = 'flex';
      rowHeader.style.justifyContent = 'space-between';
      rowHeader.style.alignItems = 'center';
      rowHeader.style.fontSize = '0.75rem';

      const typeBadge = rowHeader.createSpan({ text: `#${idx + 1} · ${card.cardStyle.toUpperCase()}` });
      typeBadge.style.fontWeight = '600';
      typeBadge.style.color = 'var(--text-accent)';

      let scheduleText = 'New card';
      let scheduleColor = 'var(--color-blue, #2196f3)';
      if (card.schedule && !card.schedule.isNew) {
        scheduleText = `Due: ${card.schedule.dueDateStr} · Int: ${card.schedule.intervalDays}d · Ease: ${Math.round(card.schedule.ease * 100)}%`;
        scheduleColor = 'var(--color-green, #48bb78)';
      }
      const schedBadge = rowHeader.createSpan({ text: scheduleText });
      schedBadge.style.color = scheduleColor;
      schedBadge.style.fontWeight = '600';

      const qEl = row.createDiv({ text: `Q: ${card.questionText}` });
      qEl.style.fontSize = '0.88rem';
      qEl.style.fontWeight = '500';

      const aEl = row.createDiv({ text: `A: ${card.answerText}` });
      aEl.style.fontSize = '0.85rem';
      aEl.style.color = 'var(--text-muted)';

      const fileInfo = row.createDiv({
        text: `${card.sourceFilePath.split('/').pop()} : line ${card.sourceLineNumber}`,
      });
      fileInfo.style.fontSize = '0.72rem';
      fileInfo.style.color = 'var(--text-faint)';
    }
  }

  private async handleImport(): Promise<void> {
    if (this.previewCards.length === 0) return;

    try {
      this.importing = true;
      this.render();

      const result = await this.importer.importBatch(this.previewCards, {
        customStudySetName: this.customStudySetName || `OSR: ${this.selectedDeckTag}`,
      });

      new Notice(
        `Successfully imported ${result.importedCount} card(s) into Study Set "${result.studySetName}"!`
      );

      this.close();

      // Open or reveal Flashcard Hub to show imported cards
      void this.plugin.activateView('llm-automation-flashcard-hub');
    } catch (err) {
      console.error('Import batch failed:', err);
      new Notice(`Import failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      this.importing = false;
    }
  }
}
