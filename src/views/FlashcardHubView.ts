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
  { keys: 'G', label: 'AI Generate' },
  { keys: 'B', label: 'From book' },
  { keys: 'M', label: 'Browse cards' },
  { keys: 'N', label: 'New deck' },
  { keys: 'F', label: 'Filter decks' },
  { keys: 'D', label: 'Manage deck' },
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

  /** Filter & search state for the deck list */
  private deckSearchQuery = '';
  private deckFilterMode: 'all' | 'due' | 'active' = 'all';
  private deckSortOrder: 'due-desc' | 'name-asc' | 'total-desc' = 'due-desc';
  private activeDeckMenuId: string | null = null;

  /** Search query for cards within the manage sub-page */
  private deckCardSearchQuery = '';

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
    this.contentEl.addEventListener('click', (e) => {
      if (this.activeDeckMenuId) {
        const target = e.target as HTMLElement | null;
        if (!target?.closest('.llm-automation-flashcard-hub-deck-menu-wrapper')) {
          this.activeDeckMenuId = null;
          this.render();
        }
      }
    });
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
    const titleGroup = topbar.createDiv({ cls: 'llm-automation-flashcard-hub-title-group' });
    const title = titleGroup.createDiv({ cls: 'llm-automation-flashcard-hub-title' });
    title.createEl('h1', { text: this.editingDeckId ? 'Manage Deck' : 'Flashcards' });
    if (!this.editingDeckId && this.totalCards > 0) {
      titleGroup.createSpan({
        text: `${this.totalCards} cards`,
        cls: 'llm-automation-badge llm-automation-badge-muted',
      });
    }

    const topbarActions = topbar.createDiv({ cls: 'llm-automation-flashcard-hub-topbar-actions' });
    topbarActions.createEl('button', {
      text: '← Study Hub',
      cls: 'llm-automation-btn llm-automation-btn-secondary',
    }).addEventListener('click', () => {
      void this.plugin.activateStudyHub();
    });
    topbarActions.createEl('button', {
      text: 'Exit Focus (Esc)',
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
    this.renderMetrics(shell);
    this.renderForecast(shell);
    this.renderDeckList(shell);
    this.renderShortcutHints(shell);
  }

  // ------------------------------------------------------------------
  // Home screen
  // ------------------------------------------------------------------

  private renderHero(container: HTMLElement): void {
    const hero = container.createDiv({ cls: 'llm-automation-flashcard-hub-hero' });

    if (this.loading) {
      hero.createEl('div', { text: 'Loading flashcard statistics...', cls: 'llm-automation-flashcard-hub-status' });
      return;
    }

    const header = hero.createDiv({ cls: 'llm-automation-flashcard-hub-hero-header' });
    if (this.totalDue > 0) {
      header.createEl('div', {
        text: `You have ${this.totalDue} card${this.totalDue === 1 ? '' : 's'} due for review`,
        cls: 'llm-automation-flashcard-hub-status',
      });
    } else if (this.totalCards > 0) {
      header.createEl('div', {
        text: 'All caught up! 🎉 No cards are due right now.',
        cls: 'llm-automation-flashcard-hub-status',
      });
    } else {
      header.createEl('div', {
        text: 'Your flashcard collection is empty.',
        cls: 'llm-automation-flashcard-hub-status',
      });
    }

    const todayReviewed = this.reviewStats?.reviewedToday ?? 0;
    const subtextParts = [`${this.totalCards} card${this.totalCards === 1 ? '' : 's'} total`];
    if (todayReviewed > 0) {
      subtextParts.push(`🔥 ${todayReviewed} reviewed today`);
    }
    subtextParts.push(`${this.deckStats.length} active deck${this.deckStats.length === 1 ? '' : 's'}`);

    hero.createEl('div', {
      text: subtextParts.join(' • '),
      cls: 'llm-automation-flashcard-hub-substatus',
    });

    const ctaRow = hero.createDiv({ cls: 'llm-automation-flashcard-hub-hero-ctas' });
    if (this.totalDue > 0) {
      const start = ctaRow.createEl('button', {
        text: `Start Due Review (${this.totalDue}) [R]`,
        cls: 'llm-automation-btn llm-automation-btn-primary llm-automation-flashcard-hub-start',
      });
      start.addEventListener('click', () => {
        void this.plugin.activateReviewView({ title: 'Due Review', includeNotDue: false });
      });

      const cram = ctaRow.createEl('button', {
        text: 'Cram All Cards [C]',
        cls: 'llm-automation-btn llm-automation-btn-secondary',
      });
      cram.addEventListener('click', () => {
        void this.plugin.activateReviewView({ title: 'Cram: All Cards', includeNotDue: true });
      });
    } else if (this.totalCards > 0) {
      const cram = ctaRow.createEl('button', {
        text: 'Cram All Cards [C]',
        cls: 'llm-automation-btn llm-automation-btn-primary llm-automation-flashcard-hub-start',
      });
      cram.addEventListener('click', () => {
        void this.plugin.activateReviewView({ title: 'Cram: All Cards', includeNotDue: true });
      });
    } else {
      const addFirst = ctaRow.createEl('button', {
        text: '+ Add First Card [A]',
        cls: 'llm-automation-btn llm-automation-btn-primary llm-automation-flashcard-hub-start',
      });
      addFirst.addEventListener('click', () => this.openManualQuestionModal());

      const genFirst = ctaRow.createEl('button', {
        text: '✨ Generate Flashcards [G]',
        cls: 'llm-automation-btn llm-automation-btn-secondary',
      });
      genFirst.addEventListener('click', () => void this.plugin.activateView(VIEW_TYPE_FLASHCARD_GENERATION));
    }
  }

  private renderQuickActions(container: HTMLElement): void {
    const toolbar = container.createDiv({ cls: 'llm-automation-flashcard-hub-toolbar' });

    // Primary Creation & Card Management Group
    const mainGroup = toolbar.createDiv({ cls: 'llm-automation-flashcard-hub-toolbar-group' });
    this.addQuickAction(mainGroup, '+ Add Question (A)', true, () => this.openManualQuestionModal());
    this.addQuickAction(mainGroup, '✨ AI Generate (G)', true, () =>
      this.plugin.activateView(VIEW_TYPE_FLASHCARD_GENERATION));
    this.addQuickAction(mainGroup, '📖 From Book (B)', true, () =>
      this.plugin.openFlashcardsFromBookModal());
    this.addQuickAction(mainGroup, '🗂 Browse Cards (M)', true, () =>
      this.plugin.activateView(VIEW_TYPE_SPACED_REPETITION_CARD_MANAGEMENT));
    this.addQuickAction(mainGroup, '➕ New Deck (N)', true, () => this.openNewDeckForm());

    // Utility & Settings Group
    const auxGroup = toolbar.createDiv({ cls: 'llm-automation-flashcard-hub-toolbar-group is-aux' });
    this.addQuickAction(auxGroup, 'Export MD (E)', this.totalCards > 0, () => this.exportAllCards('markdown'));
    this.addQuickAction(auxGroup, 'Export JSON (Shift+E)', this.totalCards > 0, () => this.exportAllCards('json'));
    this.addQuickAction(auxGroup, 'Settings (S)', true, () => this.openPluginSettings());
    this.addQuickAction(auxGroup, '↻ Refresh', true, () => this.refresh());
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

  private renderShortcutHints(container: HTMLElement): void {
    const hints = container.createDiv({ cls: 'llm-automation-flashcard-hub-shortcuts' });
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
    this.renderMetric(metrics, 'Due now', String(this.totalDue), this.totalDue > 0 ? 'is-due' : '');
    this.renderMetric(metrics, 'Reviewed today', `${this.reviewStats.reviewedToday} 🔥`);
    this.renderMetric(metrics, 'Last 7 days', String(this.reviewStats.reviewedLast7Days));

    const totalGraded = this.reviewStats.gradeDistributionLast30Days.reduce((acc, g) => acc + g.count, 0);
    const passedGraded = this.reviewStats.gradeDistributionLast30Days
      .filter((g) => g.grade >= 3)
      .reduce((acc, g) => acc + g.count, 0);

    if (totalGraded > 0) {
      const retentionRate = Math.round((passedGraded / totalGraded) * 100);
      this.renderMetric(metrics, '30d Retention', `${retentionRate}%`, retentionRate >= 80 ? 'is-good' : '');
    } else {
      this.renderMetric(metrics, '30d Lapses', String(this.reviewStats.lapsesLast30Days));
    }
  }

  private renderMetric(container: HTMLElement, label: string, value: string, modifier = ''): void {
    const metric = container.createDiv({
      cls: `llm-automation-flashcard-hub-metric${modifier ? ` ${modifier}` : ''}`,
    });
    metric.createEl('div', { text: value, cls: 'llm-automation-flashcard-hub-metric-value' });
    metric.createEl('div', { text: label, cls: 'llm-automation-flashcard-hub-metric-label' });
  }

  private renderForecast(container: HTMLElement): void {
    if (!this.reviewStats || this.reviewStats.dueForecast.length === 0) {
      return;
    }

    const card = container.createDiv({ cls: 'llm-automation-flashcard-hub-forecast-card' });
    const header = card.createDiv({ cls: 'llm-automation-flashcard-hub-forecast-header' });
    header.createEl('span', { text: '7-Day Due Forecast', cls: 'llm-automation-flashcard-hub-forecast-title' });

    const totalUpcoming = this.reviewStats.dueForecast.reduce((sum, d) => sum + d.dueCount, 0);
    header.createEl('span', {
      text: `${totalUpcoming} card${totalUpcoming === 1 ? '' : 's'} due next 7 days`,
      cls: 'llm-automation-flashcard-hub-muted',
    });

    const maxDue = Math.max(...this.reviewStats.dueForecast.map((d) => d.dueCount), 8);
    const chart = card.createDiv({ cls: 'llm-automation-flashcard-hub-forecast-chart' });

    this.reviewStats.dueForecast.forEach((day, index) => {
      const col = chart.createDiv({
        cls: `llm-automation-flashcard-hub-forecast-col${index === 0 ? ' is-today' : ''}`,
      });
      col.setAttribute('title', `${day.dueCount} card${day.dueCount === 1 ? '' : 's'} due on ${day.date}`);

      col.createEl('span', {
        text: String(day.dueCount),
        cls: 'llm-automation-flashcard-hub-forecast-count',
      });

      const barTrack = col.createDiv({ cls: 'llm-automation-flashcard-hub-forecast-bar-track' });
      const fillHeightPercent = Math.min(100, Math.max(day.dueCount > 0 ? 12 : 0, Math.round((day.dueCount / maxDue) * 100)));
      const barFill = barTrack.createDiv({ cls: 'llm-automation-flashcard-hub-forecast-bar-fill' });
      barFill.style.height = `${fillHeightPercent}%`;

      col.createEl('span', {
        text: index === 0 ? 'Today' : this.formatDayOfWeek(day.date),
        cls: 'llm-automation-flashcard-hub-forecast-day',
      });

      col.createEl('span', {
        text: this.formatShortDate(day.date),
        cls: 'llm-automation-flashcard-hub-forecast-date',
      });
    });
  }

  private renderDeckList(container: HTMLElement): void {
    const section = container.createDiv({ cls: 'llm-automation-flashcard-hub-decks' });

    // Filter and sort deck stats in-memory
    let filteredDecks = [...this.deckStats];

    if (this.deckSearchQuery.trim()) {
      const q = this.deckSearchQuery.trim().toLowerCase();
      filteredDecks = filteredDecks.filter((d) =>
        d.name.toLowerCase().includes(q) || (d.description && d.description.toLowerCase().includes(q))
      );
    }

    if (this.deckFilterMode === 'due') {
      filteredDecks = filteredDecks.filter((d) => d.dueCount > 0);
    } else if (this.deckFilterMode === 'active') {
      filteredDecks = filteredDecks.filter((d) => d.enabled);
    }

    if (this.deckSortOrder === 'due-desc') {
      filteredDecks.sort((a, b) => b.dueCount - a.dueCount || b.totalCount - a.totalCount);
    } else if (this.deckSortOrder === 'name-asc') {
      filteredDecks.sort((a, b) => a.name.localeCompare(b.name));
    } else if (this.deckSortOrder === 'total-desc') {
      filteredDecks.sort((a, b) => b.totalCount - a.totalCount);
    }

    const dueDeckCount = this.deckStats.filter((d) => d.dueCount > 0).length;

    // Header toolbar
    const toolbar = section.createDiv({ cls: 'llm-automation-flashcard-hub-decks-toolbar' });
    const headerTitle = toolbar.createDiv({ cls: 'llm-automation-flashcard-hub-decks-heading' });
    headerTitle.createEl('h2', { text: `Decks (${this.deckStats.length})` });

    const controls = toolbar.createDiv({ cls: 'llm-automation-flashcard-hub-decks-controls' });

    // Search input
    const searchInput = controls.createEl('input', {
      type: 'search',
      cls: 'llm-automation-input llm-automation-flashcard-hub-deck-search',
      attr: { placeholder: 'Filter decks (F)...' },
    });
    searchInput.value = this.deckSearchQuery;
    searchInput.addEventListener('input', () => {
      this.deckSearchQuery = searchInput.value;
      this.render();
    });

    // Filter pills
    const filterPills = controls.createDiv({ cls: 'llm-automation-flashcard-hub-filter-pills' });

    const allPill = filterPills.createEl('button', {
      text: `All (${this.deckStats.length})`,
      cls: `llm-automation-btn llm-automation-btn-secondary llm-automation-pill${this.deckFilterMode === 'all' ? ' is-active' : ''}`,
    });
    allPill.addEventListener('click', () => {
      this.deckFilterMode = 'all';
      this.render();
    });

    const duePill = filterPills.createEl('button', {
      text: `Due (${dueDeckCount})`,
      cls: `llm-automation-btn llm-automation-btn-secondary llm-automation-pill${this.deckFilterMode === 'due' ? ' is-active' : ''}`,
    });
    duePill.addEventListener('click', () => {
      this.deckFilterMode = 'due';
      this.render();
    });

    // Sort select
    const sortSelect = controls.createEl('select', { cls: 'dropdown' });
    sortSelect.createEl('option', { text: 'Sort: Most Due', attr: { value: 'due-desc' } });
    sortSelect.createEl('option', { text: 'Sort: Name (A-Z)', attr: { value: 'name-asc' } });
    sortSelect.createEl('option', { text: 'Sort: Total Cards', attr: { value: 'total-desc' } });
    sortSelect.value = this.deckSortOrder;
    sortSelect.addEventListener('change', () => {
      this.deckSortOrder = sortSelect.value as any;
      this.render();
    });

    if (this.deckStats.length === 0 && this.ungroupedTotal === 0) {
      section.createEl('p', {
        text: 'No decks yet. Create one or generate cards from notes to get started.',
        cls: 'llm-automation-flashcard-hub-muted',
      });
      return;
    }

    if (filteredDecks.length === 0 && this.deckStats.length > 0) {
      const emptySearch = section.createDiv({ cls: 'llm-automation-flashcard-hub-empty-search' });
      emptySearch.createEl('p', {
        text: `No decks match "${this.deckSearchQuery}".`,
        cls: 'llm-automation-flashcard-hub-muted',
      });
      emptySearch.createEl('button', {
        text: 'Clear Filter',
        cls: 'llm-automation-btn llm-automation-btn-secondary',
      }).addEventListener('click', () => {
        this.deckSearchQuery = '';
        this.deckFilterMode = 'all';
        this.render();
      });
      return;
    }

    const deckGrid = section.createDiv({ cls: 'llm-automation-flashcard-hub-deck-grid' });
    for (const deck of filteredDecks) {
      this.renderDeckRow(deckGrid, {
        studySetId: deck.studySetId,
        title: deck.name,
        description: deck.description,
        enabled: deck.enabled,
        dueCount: deck.dueCount,
        totalCount: deck.totalCount,
        suspendedCount: deck.suspendedCount,
        archivedCount: deck.archivedCount,
      });
    }

    if (this.ungroupedTotal > 0 && this.deckFilterMode !== 'due' || (this.deckFilterMode === 'due' && this.ungroupedDue > 0)) {
      this.renderDeckRow(deckGrid, {
        studySetId: null,
        title: 'Ungrouped Cards',
        description: 'Cards not assigned to any specific deck',
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
    description?: string | null;
    enabled: boolean;
    dueCount: number;
    totalCount: number;
    suspendedCount?: number;
    archivedCount?: number;
  }): void {
    const card = container.createDiv({
      cls: 'llm-automation-flashcard-hub-deck-card'
        + (row.enabled ? '' : ' is-disabled')
        + (row.dueCount > 0 ? ' has-due' : ''),
    });

    // --- Header Row ---
    const header = card.createDiv({ cls: 'llm-automation-flashcard-hub-deck-header' });
    const titleGroup = header.createDiv({ cls: 'llm-automation-flashcard-hub-deck-title-group' });
    titleGroup.createSpan({
      text: row.studySetId ? '📚' : '🗃️',
      cls: 'llm-automation-flashcard-hub-deck-icon',
    });
    titleGroup.createEl('span', {
      text: row.title,
      cls: 'llm-automation-flashcard-hub-deck-title',
    });
    if (!row.enabled) {
      titleGroup.createSpan({ text: 'disabled', cls: 'llm-automation-badge llm-automation-badge-muted' });
    }

    const badges = header.createDiv({ cls: 'llm-automation-flashcard-hub-deck-badges' });
    if (row.dueCount > 0) {
      badges.createSpan({
        text: `🔥 ${row.dueCount} due`,
        cls: 'llm-automation-badge llm-automation-badge-due',
      });
    } else {
      badges.createSpan({
        text: '✓ 0 due',
        cls: 'llm-automation-badge llm-automation-badge-done',
      });
    }

    // Optional description
    if (row.description) {
      card.createDiv({
        text: row.description,
        cls: 'llm-automation-flashcard-hub-deck-desc',
      });
    }

    // --- Progress Bar ---
    const progressSection = card.createDiv({ cls: 'llm-automation-flashcard-hub-deck-progress-section' });
    const progressBar = progressSection.createDiv({ cls: 'llm-automation-flashcard-hub-deck-progress-bar' });

    const safeTotal = Math.max(row.totalCount, 1);
    const scheduledCount = Math.max(0, row.totalCount - row.dueCount);
    const learnedPercent = Math.round((scheduledCount / safeTotal) * 100);
    const duePercent = Math.round((row.dueCount / safeTotal) * 100);

    if (row.totalCount > 0) {
      const learnedFill = progressBar.createDiv({ cls: 'progress-fill is-learned' });
      learnedFill.style.width = `${learnedPercent}%`;
      learnedFill.setAttribute('title', `${scheduledCount} up to date`);

      const dueFill = progressBar.createDiv({ cls: 'progress-fill is-due' });
      dueFill.style.width = `${duePercent}%`;
      dueFill.setAttribute('title', `${row.dueCount} due`);
    }

    const countsRow = progressSection.createDiv({ cls: 'llm-automation-flashcard-hub-deck-counts' });
    const parts = [
      `${row.dueCount} due`,
      `${scheduledCount} scheduled`,
      `${row.totalCount} total`,
    ];
    if (row.suspendedCount !== undefined && row.suspendedCount > 0) {
      parts.push(`${row.suspendedCount} suspended`);
    }
    if (row.archivedCount !== undefined && row.archivedCount > 0) {
      parts.push(`${row.archivedCount} archived`);
    }
    countsRow.createSpan({ text: parts.join(' • ') });

    // --- Action Footer ---
    const footer = card.createDiv({ cls: 'llm-automation-flashcard-hub-deck-footer' });
    const leftActions = footer.createDiv({ cls: 'llm-automation-flashcard-hub-deck-main-actions' });

    if (row.dueCount > 0 && row.enabled) {
      const reviewBtn = leftActions.createEl('button', {
        text: `Review (${row.dueCount})`,
        cls: 'llm-automation-btn llm-automation-btn-primary',
      });
      reviewBtn.addEventListener('click', () => {
        void this.plugin.activateReviewView({
          title: `Review: ${row.title}`,
          includeNotDue: false,
          studySetId: row.studySetId,
        });
      });
    }

    const cramBtn = leftActions.createEl('button', {
      text: row.dueCount > 0 ? 'Cram' : 'Cram Deck',
      cls: 'llm-automation-btn llm-automation-btn-secondary',
    });
    cramBtn.disabled = row.totalCount === 0 || !row.enabled;
    cramBtn.addEventListener('click', () => {
      void this.plugin.activateReviewView({
        title: `Cram: ${row.title}`,
        includeNotDue: true,
        studySetId: row.studySetId,
      });
    });

    if (row.studySetId) {
      const manageBtn = leftActions.createEl('button', {
        text: 'Manage Deck',
        cls: 'llm-automation-btn llm-automation-btn-secondary',
      });
      manageBtn.addEventListener('click', () => this.openDeckManagePage(row.studySetId as string));
    }

    // Context / Overflow menu on the right
    if (row.studySetId) {
      const isMenuOpen = this.activeDeckMenuId === row.studySetId;
      const menuWrapper = footer.createDiv({ cls: 'llm-automation-flashcard-hub-deck-menu-wrapper' });
      const menuBtn = menuWrapper.createEl('button', {
        text: '···',
        cls: `llm-automation-btn llm-automation-btn-secondary llm-automation-flashcard-hub-menu-trigger${isMenuOpen ? ' is-active' : ''}`,
        attr: { 'aria-label': 'Deck options' },
      });
      menuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.activeDeckMenuId = isMenuOpen ? null : row.studySetId;
        this.render();
      });

      if (isMenuOpen) {
        const menuDropdown = menuWrapper.createDiv({ cls: 'llm-automation-flashcard-hub-deck-dropdown' });

        // Toggle Enabled
        const toggleEnableBtn = menuDropdown.createEl('button', {
          text: row.enabled ? 'Disable Deck' : 'Enable Deck',
          cls: 'llm-automation-dropdown-item',
        });
        toggleEnableBtn.addEventListener('click', () => {
          this.activeDeckMenuId = null;
          void this.setDeckEnabled(row.studySetId as string, !row.enabled);
        });

        // Export MD
        const exportMdBtn = menuDropdown.createEl('button', {
          text: 'Export (Markdown)',
          cls: 'llm-automation-dropdown-item',
        });
        exportMdBtn.disabled = row.totalCount === 0;
        exportMdBtn.addEventListener('click', () => {
          this.activeDeckMenuId = null;
          void this.exportDeckCards(row.title, 'markdown');
        });

        // Export JSON
        const exportJsonBtn = menuDropdown.createEl('button', {
          text: 'Export (JSON)',
          cls: 'llm-automation-dropdown-item',
        });
        exportJsonBtn.disabled = row.totalCount === 0;
        exportJsonBtn.addEventListener('click', () => {
          this.activeDeckMenuId = null;
          void this.exportDeckCards(row.title, 'json');
        });

        // Delete Deck
        const deleteBtn = menuDropdown.createEl('button', {
          text: 'Delete Deck...',
          cls: 'llm-automation-dropdown-item is-danger',
        });
        const totalCards = row.totalCount + (row.suspendedCount ?? 0) + (row.archivedCount ?? 0);
        deleteBtn.addEventListener('click', () => {
          this.activeDeckMenuId = null;
          void this.deleteDeck(row.studySetId as string, row.title, totalCards);
        });
      }
    }
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
    this.deckCardSearchQuery = '';
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

    // --- Deck card list (first 100) with bulk move-out and search ---
    const listSection = section.createDiv({ cls: 'llm-automation-flashcard-hub-deck-cards' });
    const listHeader = listSection.createDiv({ cls: 'llm-automation-flashcard-hub-deck-cards-header' });
    listHeader.createEl('h3', { text: `Cards (${this.deckCards.length}${this.deckCards.length >= 100 ? '+' : ''})` });

    if (this.deckCards.length > 0) {
      const cardSearch = listHeader.createEl('input', {
        type: 'search',
        cls: 'llm-automation-input llm-automation-flashcard-hub-card-search',
        attr: { placeholder: 'Search cards in deck...' },
      });
      cardSearch.value = this.deckCardSearchQuery;
      cardSearch.addEventListener('input', () => {
        this.deckCardSearchQuery = cardSearch.value;
        this.render();
      });
    }

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

    const q = this.deckCardSearchQuery.trim().toLowerCase();
    const visibleCards = q
      ? this.deckCards.filter((c) =>
          (c.questionText && c.questionText.toLowerCase().includes(q)) ||
          (c.questionName && c.questionName.toLowerCase().includes(q)) ||
          (c.answerText && c.answerText.toLowerCase().includes(q))
        )
      : this.deckCards;

    if (visibleCards.length === 0 && this.deckCards.length > 0) {
      listSection.createEl('p', {
        text: `No cards match "${this.deckCardSearchQuery}".`,
        cls: 'llm-automation-flashcard-hub-muted',
      });
      return;
    }

    this.renderDeckCardBulkBar(listSection, deck);

    for (const cardRecord of visibleCards) {
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

      const cardBody = row.createDiv({ cls: 'llm-automation-flashcard-hub-deck-card-content' });
      cardBody.createEl('div', {
        text: cardRecord.questionName || cardRecord.questionText,
        cls: 'llm-automation-flashcard-hub-deck-card-title',
      });
      if (cardRecord.answerText) {
        const cleanAnswer = cardRecord.answerText.replace(/\s+/g, ' ').trim();
        cardBody.createEl('div', {
          text: `A: ${cleanAnswer.length > 90 ? cleanAnswer.slice(0, 90) + '...' : cleanAnswer}`,
          cls: 'llm-automation-flashcard-hub-deck-card-answer-snippet',
        });
      }

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

    if (key === 'n') {
      event.preventDefault();
      this.openNewDeckForm();
      return;
    }

    if (key === 'f') {
      event.preventDefault();
      const searchEl = this.contentEl.querySelector<HTMLInputElement>('.llm-automation-flashcard-hub-deck-search');
      searchEl?.focus();
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

  private formatDayOfWeek(dateStr: string): string {
    const d = new Date(`${dateStr}T00:00:00`);
    if (Number.isNaN(d.getTime())) return dateStr;
    const now = new Date();
    if (d.toDateString() === now.toDateString()) return 'Today';
    return d.toLocaleDateString(undefined, { weekday: 'short' });
  }

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
