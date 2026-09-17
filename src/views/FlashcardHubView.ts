import { ItemView, Notice, Setting, WorkspaceLeaf } from 'obsidian';
import type GptFreeTextGeneratorPlugin from '../main';
import {
  VIEW_TYPE_FLASHCARD_HUB,
  VIEW_TYPE_FLASHCARD_GENERATION,
  VIEW_TYPE_SPACED_REPETITION_CARD_MANAGEMENT,
} from '../constants';
import { CardManagementRecord, ReviewStats, StudySetReviewStats } from '../utils/spacedRepetition/SpacedRepetitionDatabase';
import { exportFlashcards } from '../utils/spacedRepetition/FlashcardExport';
import { SpacedRepetitionManualQuestionModal } from '../modals/SpacedRepetitionManualQuestionModal';
import { NotePickerModal } from '../modals/NotePickerModal';

const HUB_SHORTCUTS: Array<{ keys: string; label: string }> = [
  { keys: 'R', label: 'Review due' },
  { keys: 'C', label: 'Cram all' },
  { keys: 'A', label: 'Add question' },
  { keys: 'G', label: 'Generate' },
  { keys: 'B', label: 'From book' },
  { keys: 'M', label: 'Manage cards' },
  { keys: 'D', label: 'Manage decks' },
  { keys: 'S', label: 'Settings' },
  { keys: 'E', label: 'Export MD' },
  { keys: 'Shift+E', label: 'Export JSON' },
  { keys: 'X', label: 'Exit' },
];

/**
 * Mnemosyne-style flashcard home screen. Opened (and closed) by the
 * "Toggle Flashcard UI" command which switches the whole Obsidian window
 * into a distraction-free study mode.
 */
export class FlashcardHubView extends ItemView {
  private plugin: GptFreeTextGeneratorPlugin;
  private loading = false;
  private totalDue = 0;
  private totalCards = 0;
  private ungroupedDue = 0;
  private ungroupedTotal = 0;
  private deckStats: StudySetReviewStats[] = [];
  private reviewStats: ReviewStats | null = null;

  /** Deck currently opened in the manage sub-page, null = home screen. */
  private editingDeckId: string | null = null;
  private draftDeckName = '';
  private draftDeckDescription = '';

  /** Cards of the deck shown in the manage sub-page. */
  private deckCards: CardManagementRecord[] = [];

  /** Which page was last painted: 'home', 'deck', or null (never painted). */
  private lastRenderedPage: 'home' | 'deck' | null = null;

  /** Timestamp of the last completed refresh (ms epoch). */
  private lastRefreshCompletedAt = 0;

  /** Inline create-deck form state. */
  private creatingDeck = false;
  private draftNewDeckName = '';
  private draftNewDeckDescription = '';

  /** Bulk move state on the deck manage page. */
  private selectedCardIds = new Set<string>();
  private deckBulkMoveTargetId = '';

  private keyHandler = (event: KeyboardEvent) => this.handleKey(event);

  constructor(leaf: WorkspaceLeaf, plugin: GptFreeTextGeneratorPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_FLASHCARD_HUB;
  }

  getDisplayText(): string {
    return 'Flashcard Hub';
  }

  getIcon(): string {
    return 'library';
  }

  async onOpen(): Promise<void> {
    this.contentEl.addClass('llm-automation-flashcard-hub-view');
    window.addEventListener('keydown', this.keyHandler);
    this.registerEvent(this.app.workspace.on('active-leaf-change', (leaf) => {
      if (leaf === this.leaf) {
        // Skip refresh if one just completed (quick hub<->review round-trips).
        if (Date.now() - this.lastRefreshCompletedAt < 1500) {
          return;
        }
        void this.refresh();
      }
    }));
    await this.refresh();
  }

  async onClose(): Promise<void> {
    window.removeEventListener('keydown', this.keyHandler);
    this.contentEl.empty();
    this.plugin.handleFlashcardHubClosed();
  }

  async refresh(): Promise<void> {
    // Prevent concurrent refreshes (e.g. keyboard shortcut racing leaf-change).
    if (this.loading) {
      return;
    }

    try {
      this.loading = true;

      // Paint an immediate skeleton ONLY when switching pages (home <-> deck
      // manage); otherwise keep the live DOM so clicks are never swallowed
      // mid-refresh. Data is repainted once, after the queries complete.
      const targetPage: 'home' | 'deck' = this.editingDeckId ? 'deck' : 'home';
      if (this.lastRenderedPage !== targetPage) {
        this.render();
      }

      const database = await this.plugin.services.ensureSpacedRepetitionDatabase();
      const now = new Date();
      this.totalDue = database.countReviewQuestions({ now });
      this.totalCards = database.countReviewQuestions({ now, includeNotDue: true });
      this.ungroupedDue = database.countReviewQuestions({ now, studySetId: null });
      this.ungroupedTotal = database.countReviewQuestions({ now, studySetId: null, includeNotDue: true });
      this.deckStats = database.getStudySetReviewStats(now);
      this.reviewStats = database.getReviewStats(now);

      if (this.editingDeckId) {
        this.deckCards = database.getCardsForManagement({
          studySetId: this.editingDeckId,
          limit: 100,
        });
      } else {
        this.deckCards = [];
      }
    } catch (error) {
      console.error('Failed to load flashcard hub stats:', error);
      new Notice(`Failed to load flashcard stats: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      this.loading = false;
      this.lastRefreshCompletedAt = Date.now();
      this.render();
    }
  }

  private render(): void {
    const container = this.contentEl;
    container.empty();
    this.lastRenderedPage = this.editingDeckId ? 'deck' : 'home';

    const shell = container.createDiv({ cls: 'llm-automation-flashcard-hub-container' });

    const topbar = shell.createDiv({ cls: 'llm-automation-flashcard-hub-topbar' });
    const title = topbar.createDiv({ cls: 'llm-automation-flashcard-hub-title' });
    title.createEl('h1', { text: this.editingDeckId ? 'Manage Deck' : 'Flashcards' });
    topbar.createEl('button', {
      text: '← Study Hub',
      cls: 'llm-automation-btn llm-automation-btn-secondary',
    }).addEventListener('click', () => {
      void this.plugin.activateStudyHub();
    });
    topbar.createEl('button', {
      text: 'Exit Flashcard UI',
      cls: 'llm-automation-btn llm-automation-btn-secondary llm-automation-flashcard-hub-exit',
    }).addEventListener('click', () => {
      void this.plugin.toggleFlashcardUi();
    });

    if (this.editingDeckId) {
      this.renderDeckManagePage(shell);
      return;
    }

    this.renderHero(shell);
    this.renderQuickActions(shell);
    if (this.creatingDeck) {
      this.renderNewDeckForm(shell);
    }
    this.renderShortcutHints(shell);
    this.renderMetrics(shell);
    this.renderForecast(shell);
    this.renderDeckList(shell);
  }

  // ------------------------------------------------------------------
  // Home screen
  // ------------------------------------------------------------------

  private renderHero(container: HTMLElement): void {
    const hero = container.createDiv({ cls: 'llm-automation-flashcard-hub-hero' });

    if (this.loading) {
      hero.createEl('div', { text: 'Loading...', cls: 'llm-automation-flashcard-hub-status' });
      return;
    }

    if (this.totalDue > 0) {
      hero.createEl('div', {
        text: `You have ${this.totalDue} card${this.totalDue === 1 ? '' : 's'} to review.`,
        cls: 'llm-automation-flashcard-hub-status',
      });
    } else if (this.totalCards > 0) {
      hero.createEl('div', {
        text: 'No cards are due right now. Nice work.',
        cls: 'llm-automation-flashcard-hub-status',
      });
    } else {
      hero.createEl('div', {
        text: 'No cards yet. Generate flashcards from a note to get started.',
        cls: 'llm-automation-flashcard-hub-status',
      });
    }

    hero.createEl('div', {
      text: `${this.totalCards} card${this.totalCards === 1 ? '' : 's'} in collection`,
      cls: 'llm-automation-flashcard-hub-substatus',
    });

    const start = hero.createEl('button', {
      text: this.totalDue > 0 ? 'Start Reviewing' : 'Cram All Cards',
      cls: 'llm-automation-btn llm-automation-btn-primary llm-automation-flashcard-hub-start',
    });
    start.disabled = this.totalCards === 0;
    start.addEventListener('click', () => {
      if (this.totalDue > 0) {
        void this.plugin.activateReviewView({ title: 'Due Review', includeNotDue: false });
      } else {
        void this.plugin.activateReviewView({ title: 'Cram: All Cards', includeNotDue: true });
      }
    });
  }

  private renderQuickActions(container: HTMLElement): void {
    const actions = container.createDiv({ cls: 'llm-automation-flashcard-hub-actions' });
    this.addQuickAction(actions, 'Review Due (R)', this.totalDue > 0, () =>
      this.plugin.activateReviewView({ title: 'Due Review', includeNotDue: false }));
    this.addQuickAction(actions, 'Cram All (C)', this.totalCards > 0, () =>
      this.plugin.activateReviewView({ title: 'Cram: All Cards', includeNotDue: true }));
    this.addQuickAction(actions, 'Add Manual Question (A)', true, () => this.openManualQuestionModal());
    this.addQuickAction(actions, 'Generate Flashcards (G)', true, () =>
      this.plugin.activateView(VIEW_TYPE_FLASHCARD_GENERATION));
    this.addQuickAction(actions, 'Flashcards from Book (B)', true, () =>
      this.plugin.openFlashcardsFromBookModal());
    this.addQuickAction(actions, 'Manage Cards (M)', true, () =>
      this.plugin.activateView(VIEW_TYPE_SPACED_REPETITION_CARD_MANAGEMENT));
    this.addQuickAction(actions, 'New Deck', true, () => this.openNewDeckForm());
    this.addQuickAction(actions, 'Plugin Settings (S)', true, () => this.openPluginSettings());
    this.addQuickAction(actions, 'Export MD (E)', true, () => this.exportAllCards('markdown'));
    this.addQuickAction(actions, 'Export JSON (Shift+E)', true, () => this.exportAllCards('json'));
    this.addQuickAction(actions, 'Refresh', true, () => this.refresh());
  }

  /** Opens the inline "create deck" form on the home page. */
  private openNewDeckForm(): void {
    this.creatingDeck = true;
    this.draftNewDeckName = '';
    this.draftNewDeckDescription = '';
    this.render();
  }

  private closeNewDeckForm(): void {
    this.creatingDeck = false;
    this.render();
  }

  private async createDeck(): Promise<void> {
    if (!this.draftNewDeckName.trim()) {
      new Notice('Deck name cannot be empty');
      return;
    }

    try {
      const database = await this.plugin.services.ensureSpacedRepetitionDatabase();
      const studySetId = await database.createStudySet({
        name: this.draftNewDeckName,
        description: this.draftNewDeckDescription || null,
        sourceType: 'manual',
        sourceRule: { type: 'manual' },
        tags: ['flashcards'],
      });
      this.creatingDeck = false;
      new Notice(`Deck "${this.draftNewDeckName.trim()}" created`);
      await this.refresh();
      this.openDeckManagePage(studySetId);
    } catch (error) {
      console.error('Failed to create deck:', error);
      new Notice(`Failed to create deck: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /** Inline "create deck" form shown on the hub home page. */
  private renderNewDeckForm(container: HTMLElement): void {
    const form = container.createDiv({ cls: 'llm-automation-flashcard-hub-deck-edit llm-automation-flashcard-hub-new-deck' });
    form.createEl('h3', { text: 'New Deck' });

    new Setting(form)
      .setName('Deck name')
      .addText((text) => text
        .setPlaceholder('e.g. C# / LINQ / BCL')
        .setValue(this.draftNewDeckName)
        .onChange((value) => {
          this.draftNewDeckName = value;
        }));

    const description = form.createEl('textarea', {
      cls: 'llm-automation-flashcard-hub-deck-edit-description',
      attr: { rows: '3', placeholder: 'Optional deck description' },
    });
    description.value = this.draftNewDeckDescription;
    description.addEventListener('input', () => {
      this.draftNewDeckDescription = description.value;
    });

    const actions = form.createDiv({ cls: 'llm-automation-flashcard-hub-deck-actions' });
    actions.createEl('button', {
      text: 'Create Deck',
      cls: 'llm-automation-btn llm-automation-btn-primary',
    }).addEventListener('click', () => {
      void this.createDeck();
    });
    actions.createEl('button', {
      text: 'Cancel',
      cls: 'llm-automation-btn llm-automation-btn-secondary',
    }).addEventListener('click', () => this.closeNewDeckForm());
  }

  private renderShortcutHints(container: HTMLElement): void {    const hints = container.createDiv({ cls: 'llm-automation-flashcard-hub-shortcuts' });
    hints.createEl('span', {
      text: 'Shortcuts',
      cls: 'llm-automation-flashcard-hub-shortcuts-label',
    });
    for (const shortcut of HUB_SHORTCUTS) {
      const item = hints.createSpan({ cls: 'llm-automation-flashcard-hub-shortcut' });
      const kbd = item.createEl('kbd', { text: shortcut.keys });
      kbd.setAttribute('aria-hidden', 'true');
      item.createEl('span', { text: shortcut.label });
    }
  }

  private addQuickAction(
    container: HTMLElement,
    label: string,
    enabled: boolean,
    handler: () => void | Promise<void>,
  ): void {
    const button = container.createEl('button', {
      text: label,
      cls: 'llm-automation-btn llm-automation-btn-secondary',
    });
    button.disabled = !enabled;
    button.addEventListener('click', () => {
      void handler();
    });
  }

  private renderMetrics(container: HTMLElement): void {
    if (!this.reviewStats) {
      return;
    }

    const metrics = container.createDiv({ cls: 'llm-automation-flashcard-hub-metrics' });
    this.renderMetric(metrics, 'Due now', String(this.totalDue));
    this.renderMetric(metrics, 'Reviewed today', String(this.reviewStats.reviewedToday));
    this.renderMetric(metrics, 'Last 7 days', String(this.reviewStats.reviewedLast7Days));
    this.renderMetric(metrics, 'Lapses 30d', String(this.reviewStats.lapsesLast30Days));
  }

  private renderMetric(container: HTMLElement, label: string, value: string): void {
    const metric = container.createDiv({ cls: 'llm-automation-flashcard-hub-metric' });
    metric.createEl('div', { text: value, cls: 'llm-automation-flashcard-hub-metric-value' });
    metric.createEl('div', { text: label, cls: 'llm-automation-flashcard-hub-metric-label' });
  }

  private renderForecast(container: HTMLElement): void {
    if (!this.reviewStats || this.reviewStats.dueForecast.length === 0) {
      return;
    }

    const forecast = container.createDiv({ cls: 'llm-automation-flashcard-hub-forecast' });
    forecast.createEl('span', {
      text: 'Due forecast:',
      cls: 'llm-automation-flashcard-hub-forecast-label',
    });
    forecast.createEl('span', {
      text: this.reviewStats.dueForecast
        .map((day) => `${this.formatShortDate(day.date)}: ${day.dueCount}`)
        .join('  |  '),
    });
  }

  private renderDeckList(container: HTMLElement): void {
    const section = container.createDiv({ cls: 'llm-automation-flashcard-hub-decks' });
    section.createEl('h2', { text: 'Decks' });

    if (this.deckStats.length === 0 && this.ungroupedTotal === 0) {
      section.createEl('p', {
        text: 'No decks yet. Create one from the flashcard generation panel.',
        cls: 'llm-automation-flashcard-hub-muted',
      });
      return;
    }

    for (const deck of this.deckStats) {
      this.renderDeckRow(section, {
        studySetId: deck.studySetId,
        title: deck.name,
        enabled: deck.enabled,
        dueCount: deck.dueCount,
        totalCount: deck.totalCount,
        suspendedCount: deck.suspendedCount,
        archivedCount: deck.archivedCount,
      });
    }

    if (this.ungroupedTotal > 0) {
      this.renderDeckRow(section, {
        studySetId: null,
        title: 'Ungrouped Cards',
        enabled: true,
        dueCount: this.ungroupedDue,
        totalCount: this.ungroupedTotal,
        suspendedCount: undefined,
        archivedCount: undefined,
      });
    }
  }

  private renderDeckRow(container: HTMLElement, row: {
    studySetId: string | null;
    title: string;
    enabled: boolean;
    dueCount: number;
    totalCount: number;
    suspendedCount?: number;
    archivedCount?: number;
  }): void {
    const card = container.createDiv({
      cls: row.enabled
        ? 'llm-automation-flashcard-hub-deck-row'
        : 'llm-automation-flashcard-hub-deck-row llm-automation-flashcard-hub-deck-row-disabled',
    });

    const body = card.createDiv({ cls: 'llm-automation-flashcard-hub-deck-body' });
    body.createEl('div', {
      text: row.enabled ? row.title : `${row.title} (disabled)`,
      cls: 'llm-automation-flashcard-hub-deck-title',
    });

    const parts = [`${row.dueCount} due`, `${row.totalCount} total`];
    if (row.suspendedCount !== undefined) {
      parts.push(`${row.suspendedCount} suspended`);
    }
    if (row.archivedCount !== undefined) {
      parts.push(`${row.archivedCount} archived`);
    }
    body.createEl('div', {
      text: parts.join(' / '),
      cls: 'llm-automation-flashcard-hub-deck-counts',
    });

    const actions = card.createDiv({ cls: 'llm-automation-flashcard-hub-deck-actions' });

    if (row.studySetId) {
      const manageButton = actions.createEl('button', {
        text: 'Manage Deck',
        cls: 'llm-automation-btn llm-automation-btn-secondary',
      });
      manageButton.disabled = false;
      manageButton.addEventListener('click', () => this.openDeckManagePage(row.studySetId as string));

      const deleteButton = actions.createEl('button', {
        text: 'Delete',
        cls: 'llm-automation-btn llm-automation-btn-danger',
      });
      const totalCards = row.totalCount + (row.suspendedCount ?? 0) + (row.archivedCount ?? 0);
      deleteButton.addEventListener('click', () => {
        void this.deleteDeck(row.studySetId as string, row.title, totalCards);
      });
    }

    const reviewButton = actions.createEl('button', {
      text: 'Review',
      cls: 'llm-automation-btn llm-automation-btn-secondary',
    });
    reviewButton.disabled = row.dueCount === 0 || !row.enabled;
    reviewButton.addEventListener('click', () => {
      void this.plugin.activateReviewView({
        title: `Review: ${row.title}`,
        includeNotDue: false,
        studySetId: row.studySetId,
      });
    });

    const cramButton = actions.createEl('button', {
      text: 'Cram',
      cls: 'llm-automation-btn llm-automation-btn-secondary',
    });
    cramButton.disabled = row.totalCount === 0 || !row.enabled;
    cramButton.addEventListener('click', () => {
      void this.plugin.activateReviewView({
        title: `Cram: ${row.title}`,
        includeNotDue: true,
        studySetId: row.studySetId,
      });
    });
  }

  // ------------------------------------------------------------------
  // Deck manage sub-page (classic deck browser features)
  // ------------------------------------------------------------------

  private openDeckManagePage(studySetId: string): void {
    this.editingDeckId = studySetId;
    const deck = this.deckStats.find((entry) => entry.studySetId === studySetId);
    this.draftDeckName = deck?.name ?? '';
    this.draftDeckDescription = deck?.description ?? '';
    this.deckCards = [];
    void this.refresh();
  }

  private closeDeckManagePage(): void {
    this.editingDeckId = null;
    this.draftDeckName = '';
    this.draftDeckDescription = '';
    this.deckCards = [];
    this.selectedCardIds.clear();
    this.deckBulkMoveTargetId = '';
    void this.refresh();
  }

  private renderDeckManagePage(container: HTMLElement): void {
    const deck = this.deckStats.find((entry) => entry.studySetId === this.editingDeckId);
    if (!deck) {
      container.createEl('p', { text: 'Deck not found.' });
      container.createEl('button', { text: 'Back to Hub' })
        .addEventListener('click', () => this.closeDeckManagePage());
      return;
    }

    const back = container.createDiv({ cls: 'llm-automation-flashcard-hub-back-row' });
    back.createEl('button', { text: '← Back to Hub', cls: 'llm-automation-btn llm-automation-btn-secondary' })
      .addEventListener('click', () => this.closeDeckManagePage());

    const section = container.createDiv({ cls: 'llm-automation-flashcard-hub-deck-manage' });
    section.createEl('h2', { text: deck.name });

    const counts = [
      `${deck.dueCount} due`,
      `${deck.totalCount} reviewable`,
      `${deck.suspendedCount} suspended`,
      `${deck.archivedCount} archived`,
    ];
    section.createEl('div', {
      text: counts.join(' | '),
      cls: 'llm-automation-flashcard-hub-deck-counts',
    });

    if (deck.description) {
      section.createEl('div', {
        text: deck.description,
        cls: 'llm-automation-flashcard-hub-muted',
      });
    }

    // --- Edit form (name + description) ---
    const form = section.createDiv({ cls: 'llm-automation-flashcard-hub-deck-edit' });
    new Setting(form)
      .setName('Deck name')
      .addText((text) => text
        .setValue(this.draftDeckName)
        .onChange((value) => {
          this.draftDeckName = value;
        }));

    const description = form.createEl('textarea', {
      cls: 'llm-automation-flashcard-hub-deck-edit-description',
      attr: { rows: '3', placeholder: 'Optional deck description' },
    });
    description.value = this.draftDeckDescription;
    description.addEventListener('input', () => {
      this.draftDeckDescription = description.value;
    });

    const formActions = form.createDiv({ cls: 'llm-automation-flashcard-hub-deck-actions' });
    formActions.createEl('button', { text: 'Save Deck', cls: 'llm-automation-btn llm-automation-btn-primary' })
      .addEventListener('click', () => this.saveDeck(deck.studySetId));

    // --- Deck level actions ---
    const actions = section.createDiv({ cls: 'llm-automation-flashcard-hub-actions' });
    this.addQuickAction(actions, 'Review Due', deck.dueCount > 0 && deck.enabled, () =>
      this.plugin.activateReviewView({
        title: `Review: ${deck.name}`,
        includeNotDue: false,
        studySetId: deck.studySetId,
      }));
    this.addQuickAction(actions, 'Cram Deck', deck.totalCount > 0 && deck.enabled, () =>
      this.plugin.activateReviewView({
        title: `Cram: ${deck.name}`,
        includeNotDue: true,
        studySetId: deck.studySetId,
      }));
    this.addQuickAction(actions, deck.enabled ? 'Disable Deck' : 'Enable Deck', true, () =>
      this.setDeckEnabled(deck.studySetId, !deck.enabled));
    this.addQuickAction(actions, 'Export Deck (MD)', this.deckCards.length > 0, () =>
      this.exportDeckCards(deck.name, 'markdown'));
    this.addQuickAction(actions, 'Export Deck (JSON)', this.deckCards.length > 0, () =>
      this.exportDeckCards(deck.name, 'json'));

    const totalDeckCards = deck.totalCount + deck.suspendedCount + deck.archivedCount;
    const deleteButton = actions.createEl('button', {
      text: 'Delete Deck',
      cls: 'llm-automation-btn llm-automation-btn-danger',
    });
    deleteButton.addEventListener('click', () => this.deleteDeck(deck.studySetId, deck.name, totalDeckCards));

    // --- Deck card list (first 100) with bulk move-out ---
    const listSection = section.createDiv({ cls: 'llm-automation-flashcard-hub-deck-cards' });
    listSection.createEl('h3', { text: `Cards (${this.deckCards.length}${this.deckCards.length >= 100 ? '+' : ''})` });

    if (this.loading) {
      listSection.createEl('p', { text: 'Loading...', cls: 'llm-automation-flashcard-hub-muted' });
      return;
    }

    if (this.deckCards.length === 0) {
      listSection.createEl('p', {
        text: 'No cards in this deck yet.',
        cls: 'llm-automation-flashcard-hub-muted',
      });
      return;
    }

    this.renderDeckCardBulkBar(listSection, deck);

    for (const cardRecord of this.deckCards) {
      const row = listSection.createDiv({
        cls: 'llm-automation-flashcard-hub-deck-card-row'
          + (this.selectedCardIds.has(cardRecord.id) ? ' llm-automation-flashcard-hub-deck-card-row-selected' : ''),
      });

      const select = row.createEl('input', {
        type: 'checkbox',
        cls: 'llm-automation-flashcard-hub-deck-card-select',
        attr: { 'aria-label': `Select card: ${cardRecord.questionName || cardRecord.questionText.slice(0, 60)}` },
      });
      select.checked = this.selectedCardIds.has(cardRecord.id);
      select.addEventListener('change', () => {
        if (select.checked) {
          this.selectedCardIds.add(cardRecord.id);
        } else {
          this.selectedCardIds.delete(cardRecord.id);
        }
        row.toggleClass('llm-automation-flashcard-hub-deck-card-row-selected', select.checked);
      });

      row.createEl('div', {
        text: cardRecord.questionName || cardRecord.questionText,
        cls: 'llm-automation-flashcard-hub-deck-card-title',
      });
      row.createEl('div', {
        text: [
          cardRecord.questionType,
          cardRecord.enabled ? 'enabled' : 'suspended',
          cardRecord.archivedAt ? 'archived' : null,
          `due ${this.formatShortDateTime(cardRecord.nextRepeatAt)}`,
        ].filter(Boolean).join(' | '),
        cls: 'llm-automation-flashcard-hub-deck-counts',
      });
    }
  }

  /** Bulk bar for the deck manage page: select + move cards OUT of this deck. */
  private renderDeckCardBulkBar(container: HTMLElement, deck: StudySetReviewStats): void {
    const bar = container.createDiv({ cls: 'llm-automation-flashcard-hub-bulk-bar' });

    const selectAllLabel = bar.createEl('label', { cls: 'llm-automation-flashcard-hub-bulk-toggle' });
    const selectAll = selectAllLabel.createEl('input', { type: 'checkbox' });
    selectAll.checked = this.deckCards.length > 0 && this.deckCards.every((card) => this.selectedCardIds.has(card.id));
    selectAll.addEventListener('change', () => {
      if (selectAll.checked) {
        for (const card of this.deckCards) {
          this.selectedCardIds.add(card.id);
        }
      } else {
        this.selectedCardIds.clear();
      }
      this.render();
    });
    selectAllLabel.createSpan({ text: 'Select all' });

    if (this.selectedCardIds.size === 0) {
      bar.createSpan({
        text: 'Check cards to move them to another deck',
        cls: 'llm-automation-flashcard-hub-muted',
      });
      return;
    }

    bar.createSpan({
      text: `${this.selectedCardIds.size} selected`,
      cls: 'llm-automation-flashcard-hub-bulk-count',
    });

    const moveControl = bar.createDiv({ cls: 'llm-automation-flashcard-hub-bulk-move' });
    const deckSelect = moveControl.createEl('select', { cls: 'dropdown' });
    deckSelect.createEl('option', { text: 'Move to deck...', attr: { value: '' } });
    deckSelect.createEl('option', { text: 'No deck', attr: { value: '__none__' } });
    for (const otherDeck of this.deckStats) {
      if (otherDeck.studySetId === deck.studySetId) {
        continue;
      }
      deckSelect.createEl('option', { text: otherDeck.name, attr: { value: otherDeck.studySetId } });
    }
    deckSelect.value = this.deckBulkMoveTargetId;
    deckSelect.addEventListener('change', () => {
      this.deckBulkMoveTargetId = deckSelect.value;
    });

    moveControl.createEl('button', {
      text: 'Move',
      cls: 'llm-automation-btn llm-automation-btn-primary',
    }).addEventListener('click', () => void this.moveSelectedDeckCards());

    moveControl.createEl('button', {
      text: 'Clear selection',
      cls: 'llm-automation-btn llm-automation-btn-secondary',
    }).addEventListener('click', () => {
      this.selectedCardIds.clear();
      this.deckBulkMoveTargetId = '';
      this.render();
    });
  }

  private async moveSelectedDeckCards(): Promise<void> {
    if (this.selectedCardIds.size === 0) {
      return;
    }

    if (!this.deckBulkMoveTargetId) {
      new Notice('Choose a deck to move the selected cards to');
      return;
    }

    const targetStudySetId = this.deckBulkMoveTargetId === '__none__' ? null : this.deckBulkMoveTargetId;
    const targetName = targetStudySetId
      ? this.deckStats.find((entry) => entry.studySetId === targetStudySetId)?.name ?? 'deck'
      : 'No deck';

    try {
      const database = await this.plugin.services.ensureSpacedRepetitionDatabase();
      const { movedCount, skippedIds } = await database.moveQuestionsToStudySet(
        Array.from(this.selectedCardIds),
        targetStudySetId,
      );

      if (skippedIds.length > 0) {
        new Notice(`Moved ${movedCount} card(s) to ${targetName}; ${skippedIds.length} could not be moved`);
      } else {
        new Notice(`Moved ${movedCount} card(s) to ${targetName}`);
      }

      this.selectedCardIds.clear();
      this.deckBulkMoveTargetId = '';
      await this.refresh();
    } catch (error) {
      console.error('Failed to move selected cards:', error);
      new Notice(`Failed to move cards: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
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
      new Notice('Deck updated');
      await this.refresh();
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
      await this.refresh();
    } catch (error) {
      console.error('Failed to update deck enabled state:', error);
      new Notice(`Failed to update deck: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async deleteDeck(studySetId: string, name: string, totalCards?: number): Promise<void> {
    const cardCount = totalCards ?? (this.deckCards.length > 0 ? this.deckCards.length : 0);
    const confirmMessage = cardCount > 0
      ? `Delete deck "${name}" and all ${cardCount} card(s) in it? This action cannot be undone.`
      : `Delete empty deck "${name}"?`;

    if (!window.confirm(confirmMessage)) {
      return;
    }

    try {
      const database = await this.plugin.services.ensureSpacedRepetitionDatabase();
      await database.deleteStudySet(studySetId);
      new Notice(`Deck "${name}" deleted`);
      if (this.editingDeckId === studySetId) {
        this.closeDeckManagePage();
      } else {
        await this.refresh();
      }
    } catch (error) {
      console.error('Failed to delete deck:', error);
      new Notice(`Failed to delete deck: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // ------------------------------------------------------------------
  // Actions
  // ------------------------------------------------------------------

  private openManualQuestionModal(): void {
    const activeFile = this.app.workspace.getActiveFile();
    if (activeFile) {
      new SpacedRepetitionManualQuestionModal(this.app, this.plugin, activeFile).open();
      return;
    }

    // In focus mode there is usually no active note; pick one explicitly.
    new NotePickerModal(this.app, (file) => {
      new SpacedRepetitionManualQuestionModal(this.app, this.plugin, file).open();
    }).open();
  }

  private openPluginSettings(): void {
    this.plugin.openPluginSettings();
  }

  private async exportAllCards(format: 'markdown' | 'json'): Promise<void> {
    try {
      const database = await this.plugin.services.ensureSpacedRepetitionDatabase();
      const cards = database.getCardsForManagement({ limit: 10000 });
      await exportFlashcards(this.app, this.plugin, cards, format, { openFile: false });
    } catch (error) {
      console.error('Failed to export flashcards:', error);
      new Notice(`Failed to export cards: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async exportDeckCards(deckName: string, format: 'markdown' | 'json'): Promise<void> {
    try {
      await exportFlashcards(this.app, this.plugin, this.deckCards, format, {
        openFile: false,
        label: deckName,
      });
    } catch (error) {
      console.error('Failed to export deck flashcards:', error);
      new Notice(`Failed to export cards: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // ------------------------------------------------------------------
  // Keyboard shortcuts
  // ------------------------------------------------------------------

  private handleKey(event: KeyboardEvent): void {
    // Only act when the hub is the active view.
    if (this.app.workspace.activeLeaf?.view !== this) {
      return;
    }

    if (event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }

    const target = event.target as HTMLElement | null;
    if (target instanceof HTMLInputElement
      || target instanceof HTMLTextAreaElement
      || target instanceof HTMLSelectElement
      || (target instanceof HTMLElement && target.isContentEditable)) {
      return;
    }

    if (this.editingDeckId) {
      this.handleKeyDeckPage(event);
      return;
    }

    const key = event.key.toLowerCase();
    if (event.key === 'Escape') {
      event.preventDefault();
      void this.plugin.toggleFlashcardUi();
      return;
    }

    if (key === 'r') {
      event.preventDefault();
      void this.plugin.activateReviewView({ title: 'Due Review', includeNotDue: false });
      return;
    }

    if (key === 'c') {
      event.preventDefault();
      void this.plugin.activateReviewView({ title: 'Cram: All Cards', includeNotDue: true });
      return;
    }

    if (key === 'a') {
      event.preventDefault();
      this.openManualQuestionModal();
      return;
    }

    if (key === 'g') {
      event.preventDefault();
      void this.plugin.activateView(VIEW_TYPE_FLASHCARD_GENERATION);
      return;
    }

    if (key === 'b') {
      event.preventDefault();
      this.plugin.openFlashcardsFromBookModal();
      return;
    }

    if (key === 'm') {
      event.preventDefault();
      void this.plugin.activateView(VIEW_TYPE_SPACED_REPETITION_CARD_MANAGEMENT);
      return;
    }

    if (key === 'd') {
      event.preventDefault();
      const firstDeck = this.deckStats.find((deck) => deck.enabled) ?? this.deckStats[0];
      if (firstDeck) {
        this.openDeckManagePage(firstDeck.studySetId);
      } else {
        new Notice('No decks to manage');
      }
      return;
    }

    if (key === 's') {
      event.preventDefault();
      this.openPluginSettings();
      return;
    }

    if (key === 'e') {
      event.preventDefault();
      void this.exportAllCards(event.shiftKey ? 'json' : 'markdown');
      return;
    }

    if (key === 'x') {
      event.preventDefault();
      void this.plugin.toggleFlashcardUi();
    }
  }

  private handleKeyDeckPage(event: KeyboardEvent): void {
    if (event.key === 'Escape' || event.key === 'Backspace') {
      event.preventDefault();
      this.closeDeckManagePage();
    }
  }

  // ------------------------------------------------------------------
  // Formatting helpers
  // ------------------------------------------------------------------

  private formatShortDate(value: string): string {
    const date = new Date(`${value}T00:00:00`);
    if (Number.isNaN(date.getTime())) {
      return value;
    }

    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  private formatShortDateTime(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }

    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
}
