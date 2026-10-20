import { App, Modal, Notice, Setting } from 'obsidian';
import type GptFreeTextGeneratorPlugin from '../main';
import { exportFlashcards, FlashcardExportFormat } from '../utils/spacedRepetition/FlashcardExport';
import { CardManagementRecord } from '../utils/spacedRepetition/SpacedRepetitionDatabase';
import { SpacedRepetitionStudySetRecord } from '../types/spacedRepetition';

export class ExportFlashcardsModal extends Modal {
  private plugin: GptFreeTextGeneratorPlugin;
  private format: FlashcardExportFormat;
  private selectedStudySetId = '__all__';
  private includeArchived = false;
  private studySets: SpacedRepetitionStudySetRecord[] = [];
  private totalCardsCount = 0;
  private exporting = false;

  constructor(app: App, plugin: GptFreeTextGeneratorPlugin, defaultFormat: FlashcardExportFormat = 'json') {
    super(app);
    this.plugin = plugin;
    this.format = defaultFormat;
  }

  async onOpen(): Promise<void> {
    this.modalEl.addClass('llm-automation-export-modal');
    this.modalEl.style.width = '540px';
    this.modalEl.style.maxWidth = '90vw';

    try {
      const database = await this.plugin.services.ensureSpacedRepetitionDatabase();
      this.studySets = database.getStudySets().filter((s) => s.enabled);
      const allCards = database.getCardsForManagement({ limit: 10000 });
      this.totalCardsCount = allCards.length;
    } catch (err) {
      console.warn('Failed to load study sets for export:', err);
    }

    this.render();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl('h2', { text: `Export Flashcards (${this.format.toUpperCase()})` });

    // 1. Format Selection
    new Setting(contentEl)
      .setName('Export Format')
      .setDesc('Choose between JSON (full fidelity) or Markdown (readable text).')
      .addDropdown((dropdown) => {
        dropdown
          .addOption('json', 'JSON (Full fidelity, all card types & metadata)')
          .addOption('markdown', 'Markdown (Human-readable document)')
          .setValue(this.format)
          .onChange((val) => {
            this.format = val as FlashcardExportFormat;
          });
      });

    // 2. Scope Selection (All vs Specific Deck)
    const scopeOptions: Record<string, string> = {
      __all__: `All Decks (${this.totalCardsCount} cards total)`,
    };
    for (const set of this.studySets) {
      scopeOptions[set.id] = set.name;
    }

    new Setting(contentEl)
      .setName('Deck / Scope')
      .setDesc('Export all cards or a specific study set.')
      .addDropdown((dropdown) => {
        dropdown
          .addOptions(scopeOptions)
          .setValue(this.selectedStudySetId)
          .onChange((val) => {
            this.selectedStudySetId = val;
          });
      });

    // 3. Include Archived
    new Setting(contentEl)
      .setName('Include Archived')
      .setDesc('Export archived/suspended cards as well.')
      .addToggle((toggle) => {
        toggle.setValue(this.includeArchived).onChange((val) => {
          this.includeArchived = val;
        });
      });

    // 4. Action Buttons
    const actionRow = contentEl.createDiv({ cls: 'llm-automation-export-actions' });
    actionRow.style.display = 'flex';
    actionRow.style.justifyContent = 'flex-end';
    actionRow.style.gap = '8px';
    actionRow.style.marginTop = '20px';

    const cancelBtn = actionRow.createEl('button', {
      text: 'Cancel',
      cls: 'llm-automation-btn llm-automation-btn-secondary',
    });
    cancelBtn.addEventListener('click', () => this.close());

    const exportBtn = actionRow.createEl('button', {
      text: this.exporting ? 'Exporting...' : `Export ${this.format.toUpperCase()}`,
      cls: 'llm-automation-btn llm-automation-btn-primary mod-cta',
    });
    exportBtn.disabled = this.exporting || this.totalCardsCount === 0;
    exportBtn.addEventListener('click', () => void this.handleExport());
  }

  private async handleExport(): Promise<void> {
    try {
      this.exporting = true;
      this.render();

      const database = await this.plugin.services.ensureSpacedRepetitionDatabase();
      const studySetId = this.selectedStudySetId === '__all__' ? undefined : this.selectedStudySetId;
      const selectedSet = this.studySets.find((s) => s.id === this.selectedStudySetId);

      const cards: CardManagementRecord[] = database.getCardsForManagement({
        studySetId,
        archived: this.includeArchived ? undefined : false,
        limit: 10000,
      });

      if (cards.length === 0) {
        new Notice('No cards matched the selected scope.');
        return;
      }

      const result = await exportFlashcards(this.app, this.plugin, cards, this.format, {
        label: selectedSet ? selectedSet.name : 'all',
        openFile: true,
      });

      if (result) {
        this.close();
      }
    } catch (err) {
      console.error('Export failed:', err);
      new Notice(`Export failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      this.exporting = false;
    }
  }
}
