import { ItemView, Notice, Setting, WorkspaceLeaf } from 'obsidian';
import type GptFreeTextGeneratorPlugin from '../main';
import { VIEW_TYPE_SPACED_REPETITION_CARD_MANAGEMENT, VIEW_TYPE_SPACED_REPETITION_DECK_BROWSER } from '../constants';
import { ReviewStats, StudySetReviewStats } from '../utils/spacedRepetition/SpacedRepetitionDatabase';

export class SpacedRepetitionDeckBrowserView extends ItemView {
  private plugin: GptFreeTextGeneratorPlugin;
  private loading = false;
  private totalDue = 0;
  private totalCards = 0;
  private ungroupedDue = 0;
  private ungroupedTotal = 0;
  private deckStats: StudySetReviewStats[] = [];
  private reviewStats: ReviewStats | null = null;
  private editingDeckId: string | null = null;
  private draftDeckName = '';
  private draftDeckDescription = '';

  constructor(leaf: WorkspaceLeaf, plugin: GptFreeTextGeneratorPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_SPACED_REPETITION_DECK_BROWSER;
  }

  getDisplayText(): string {
    return 'Flashcard Decks';
  }

  async onOpen(): Promise<void> {
    this.contentEl.addClass('spaced-repetition-deck-browser-view');
    await this.loadDecks();
  }

  async onClose(): Promise<void> {
    this.contentEl.empty();
  }

  private async loadDecks(): Promise<void> {
    try {
      this.loading = true;
      this.render();
      const database = await this.plugin.services.ensureSpacedRepetitionDatabase();
      const now = new Date();
      this.totalDue = database.countReviewQuestions({ now });
      this.totalCards = database.countReviewQuestions({ now, includeNotDue: true });
      this.ungroupedDue = database.countReviewQuestions({ now, studySetId: null });
      this.ungroupedTotal = database.countReviewQuestions({ now, studySetId: null, includeNotDue: true });
      this.deckStats = database.getStudySetReviewStats(now);
      this.reviewStats = database.getReviewStats(now);
    } catch (error) {
      console.error('Failed to load flashcard decks:', error);
      new Notice(`Failed to load decks: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      this.loading = false;
      this.render();
    }
  }

  private render(): void {
    const container = this.contentEl;
    container.empty();

    const header = container.createDiv({ cls: 'spaced-repetition-deck-browser-header' });
    header.createEl('h2', { text: 'Flashcard Decks' });
    header.createEl('div', {
      text: this.loading ? 'Loading...' : `${this.totalDue} due / ${this.totalCards} total`,
      cls: 'spaced-repetition-deck-browser-summary',
    });

    new Setting(container)
      .addButton((button) => button
        .setButtonText('Review Due')
        .setCta()
        .setDisabled(this.totalDue === 0)
        .onClick(() => this.plugin.activateReviewView({
          title: 'Due Review',
          includeNotDue: false,
        })))
      .addButton((button) => button
        .setButtonText('Cram All')
        .setDisabled(this.totalCards === 0)
        .onClick(() => this.plugin.activateReviewView({
          title: 'Cram: All Cards',
          includeNotDue: true,
        })))
      .addButton((button) => button
        .setButtonText('Manage Cards')
        .onClick(() => this.plugin.activateView(VIEW_TYPE_SPACED_REPETITION_CARD_MANAGEMENT)))
      .addButton((button) => button
        .setButtonText('Refresh')
        .onClick(() => this.loadDecks()));

    this.renderReviewStats(container);
    this.renderUngrouped(container);
    this.renderDecks(container);
  }

  private renderReviewStats(container: HTMLElement): void {
    if (!this.reviewStats) {
      return;
    }

    const stats = this.reviewStats;
    const section = container.createDiv({ cls: 'spaced-repetition-stats-section' });
    section.createEl('h3', { text: 'Review Stats' });

    const metrics = section.createDiv({ cls: 'spaced-repetition-stats-metrics' });
    this.renderMetric(metrics, 'Today', String(stats.reviewedToday));
    this.renderMetric(metrics, '7 days', String(stats.reviewedLast7Days));
    this.renderMetric(metrics, 'Lapses 30d', String(stats.lapsesLast30Days));
    this.renderMetric(metrics, 'Due now', String(this.totalDue));

    const panels = section.createDiv({ cls: 'spaced-repetition-stats-panels' });
    const grades = panels.createDiv({ cls: 'spaced-repetition-stats-panel' });
    grades.createEl('div', { text: 'Grades 30d', cls: 'spaced-repetition-stats-panel-title' });
    grades.createEl('div', {
      text: stats.gradeDistributionLast30Days
        .map((item) => `${item.grade}: ${item.count}`)
        .join(' | '),
      cls: 'spaced-repetition-stats-text',
    });

    const forecast = panels.createDiv({ cls: 'spaced-repetition-stats-panel' });
    forecast.createEl('div', { text: 'Due Forecast', cls: 'spaced-repetition-stats-panel-title' });
    forecast.createEl('div', {
      text: stats.dueForecast.map((item) => `${this.formatShortDate(item.date)}: ${item.dueCount}`).join(' | '),
      cls: 'spaced-repetition-stats-text',
    });

    const hard = panels.createDiv({ cls: 'spaced-repetition-stats-panel spaced-repetition-stats-panel-wide' });
    hard.createEl('div', { text: 'Hardest Cards', cls: 'spaced-repetition-stats-panel-title' });
    if (!stats.hardestCards.length) {
      hard.createEl('div', { text: 'No reviewed cards yet.', cls: 'spaced-repetition-stats-text' });
      return;
    }

    const list = hard.createEl('ol', { cls: 'spaced-repetition-hardest-list' });
    for (const card of stats.hardestCards) {
      const label = card.questionName || card.questionText;
      const item = list.createEl('li');
      item.createEl('span', {
        text: `${this.truncate(label, 90)} (${card.lapseCount} lapses, avg ${card.averageGrade.toFixed(1)}, ${card.reviewCount} reviews)`,
      });
    }
  }

  private renderMetric(container: HTMLElement, label: string, value: string): void {
    const metric = container.createDiv({ cls: 'spaced-repetition-stats-metric' });
    metric.createEl('div', { text: value, cls: 'spaced-repetition-stats-metric-value' });
    metric.createEl('div', { text: label, cls: 'spaced-repetition-stats-metric-label' });
  }

  private renderUngrouped(container: HTMLElement): void {
    if (this.ungroupedTotal === 0) {
      return;
    }

    const section = container.createDiv({ cls: 'spaced-repetition-deck-list-section' });
    section.createEl('h3', { text: 'No Deck' });
    this.renderDeckRow(section, {
      title: 'Ungrouped Cards',
      description: 'Cards linked directly to notes without a deck.',
      dueCount: this.ungroupedDue,
      totalCount: this.ungroupedTotal,
      review: () => this.plugin.activateReviewView({
        title: 'Review: Ungrouped',
        includeNotDue: false,
        studySetId: null,
      }),
      cram: () => this.plugin.activateReviewView({
        title: 'Cram: Ungrouped',
        includeNotDue: true,
        studySetId: null,
      }),
    });
  }

  private renderDecks(container: HTMLElement): void {
    const section = container.createDiv({ cls: 'spaced-repetition-deck-list-section' });
    section.createEl('h3', { text: 'Decks' });

    if (this.deckStats.length === 0) {
      section.createEl('p', { text: 'No decks yet. Create one from the flashcard generation panel.' });
      return;
    }

    for (const deck of this.deckStats) {
      this.renderDeckRow(section, {
        studySetId: deck.studySetId,
        title: deck.name,
        description: deck.description ?? '',
        enabled: deck.enabled,
        dueCount: deck.dueCount,
        totalCount: deck.totalCount,
        suspendedCount: deck.suspendedCount,
        archivedCount: deck.archivedCount,
        review: () => this.plugin.activateReviewView({
          title: `Review: ${deck.name}`,
          includeNotDue: false,
          studySetId: deck.studySetId,
        }),
        cram: () => this.plugin.activateReviewView({
          title: `Cram: ${deck.name}`,
          includeNotDue: true,
          studySetId: deck.studySetId,
        }),
      });
    }
  }

  private renderDeckRow(container: HTMLElement, row: {
    studySetId?: string;
    title: string;
    description: string;
    enabled?: boolean;
    dueCount: number;
    totalCount: number;
    suspendedCount?: number;
    archivedCount?: number;
    review: () => void | Promise<void>;
    cram: () => void | Promise<void>;
  }): void {
    const card = container.createDiv({
      cls: row.enabled === false
        ? 'spaced-repetition-deck-card spaced-repetition-deck-card-disabled'
        : 'spaced-repetition-deck-card',
    });
    const body = card.createDiv({ cls: 'spaced-repetition-deck-card-body' });

    if (row.studySetId && this.editingDeckId === row.studySetId) {
      this.renderDeckEditForm(body, row.studySetId);
    } else {
      body.createEl('div', {
        text: row.enabled === false ? `${row.title} (disabled)` : row.title,
        cls: 'spaced-repetition-deck-card-title',
      });
      body.createEl('div', {
        text: row.description || `${row.dueCount} due / ${row.totalCount} reviewable`,
        cls: 'spaced-repetition-deck-card-description',
      });
      const parts = [
        `${row.dueCount} due`,
        `${row.totalCount} reviewable`,
        `${row.suspendedCount ?? 0} suspended`,
        `${row.archivedCount ?? 0} archived`,
      ];
      body.createEl('div', {
        text: parts.join(' | '),
        cls: 'spaced-repetition-deck-card-counts',
      });
    }

    const actions = card.createDiv({ cls: 'spaced-repetition-deck-card-actions' });
    const reviewButton = actions.createEl('button', { text: 'Review Due' });
    reviewButton.disabled = row.dueCount === 0 || row.enabled === false;
    reviewButton.addEventListener('click', () => row.review());

    const cramButton = actions.createEl('button', { text: 'Cram' });
    cramButton.disabled = row.totalCount === 0 || row.enabled === false;
    cramButton.addEventListener('click', () => row.cram());

    if (!row.studySetId) {
      return;
    }

    actions.createEl('button', { text: this.editingDeckId === row.studySetId ? 'Close Edit' : 'Edit' })
      .addEventListener('click', () => {
        if (this.editingDeckId === row.studySetId) {
          this.editingDeckId = null;
        } else {
          this.startEditingDeck(row);
        }
        this.render();
      });

    actions.createEl('button', { text: row.enabled === false ? 'Enable' : 'Disable' })
      .addEventListener('click', () => this.setDeckEnabled(row.studySetId as string, row.enabled === false));

    const deleteButton = actions.createEl('button', { text: 'Delete Empty' });
    deleteButton.disabled = (row.totalCount + (row.suspendedCount ?? 0) + (row.archivedCount ?? 0)) > 0;
    deleteButton.addEventListener('click', () => this.deleteEmptyDeck(row.studySetId as string, row.title));
  }

  private renderDeckEditForm(container: HTMLElement, studySetId: string): void {
    const form = container.createDiv({ cls: 'spaced-repetition-deck-edit' });
    new Setting(form)
      .setName('Deck name')
      .addText((text) => text
        .setValue(this.draftDeckName)
        .onChange((value) => {
          this.draftDeckName = value;
        }));

    const description = form.createEl('textarea', {
      cls: 'spaced-repetition-deck-edit-description',
      attr: { rows: '3', placeholder: 'Optional deck description' },
    });
    description.value = this.draftDeckDescription;
    description.addEventListener('input', () => {
      this.draftDeckDescription = description.value;
    });

    const actions = form.createDiv({ cls: 'spaced-repetition-deck-card-actions' });
    actions.createEl('button', { text: 'Save Deck' })
      .addEventListener('click', () => this.saveDeck(studySetId));
    actions.createEl('button', { text: 'Cancel' })
      .addEventListener('click', () => {
        this.editingDeckId = null;
        this.render();
      });
  }

  private startEditingDeck(row: { studySetId?: string; title: string; description: string }): void {
    if (!row.studySetId) {
      return;
    }

    this.editingDeckId = row.studySetId;
    this.draftDeckName = row.title;
    this.draftDeckDescription = row.description;
  }

  private async saveDeck(studySetId: string): Promise<void> {
    if (!this.draftDeckName.trim()) {
      new Notice('Deck name cannot be empty');
      return;
    }

    try {
      const database = await this.plugin.services.ensureSpacedRepetitionDatabase();
      await database.updateStudySet({
        studySetId,
        name: this.draftDeckName,
        description: this.draftDeckDescription,
      });
      this.editingDeckId = null;
      new Notice('Deck updated');
      await this.loadDecks();
    } catch (error) {
      console.error('Failed to update deck:', error);
      new Notice(`Failed to update deck: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async setDeckEnabled(studySetId: string, enabled: boolean): Promise<void> {
    try {
      const database = await this.plugin.services.ensureSpacedRepetitionDatabase();
      await database.setStudySetEnabled(studySetId, enabled);
      new Notice(enabled ? 'Deck enabled' : 'Deck disabled');
      await this.loadDecks();
    } catch (error) {
      console.error('Failed to update deck enabled state:', error);
      new Notice(`Failed to update deck: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async deleteEmptyDeck(studySetId: string, name: string): Promise<void> {
    if (!window.confirm(`Delete empty deck "${name}"?`)) {
      return;
    }

    try {
      const database = await this.plugin.services.ensureSpacedRepetitionDatabase();
      await database.deleteEmptyStudySet(studySetId);
      new Notice('Empty deck deleted');
      await this.loadDecks();
    } catch (error) {
      console.error('Failed to delete empty deck:', error);
      new Notice(`Failed to delete deck: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private formatShortDate(value: string): string {
    const date = new Date(`${value}T00:00:00`);
    if (Number.isNaN(date.getTime())) {
      return value;
    }

    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  private truncate(value: string, maxLength: number): string {
    if (value.length <= maxLength) {
      return value;
    }

    return `${value.slice(0, maxLength - 1)}...`;
  }
}
