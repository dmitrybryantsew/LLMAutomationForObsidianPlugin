import { ItemView, Notice, TFile, WorkspaceLeaf, normalizePath, setIcon } from 'obsidian';
import type GptFreeTextGeneratorPlugin from '../main';
import {
  VIEW_TYPE_STUDY_HUB,
  VIEW_TYPE_FLASHCARD_HUB,
  VIEW_TYPE_CODING_EXERCISES,
  VIEW_TYPE_QUIZ_HUB,
  VIEW_TYPE_SPACED_REPETITION_NOTE_CHAT,
  VIEW_TYPE_FLASHCARD_GENERATION,
} from '../constants';
import { ReviewStats, StudySetReviewStats } from '../utils/spacedRepetition/SpacedRepetitionDatabase';
import { SpacedRepetitionManualQuestionModal } from '../modals/SpacedRepetitionManualQuestionModal';
import { NotePickerModal } from '../modals/NotePickerModal';
import { QuizGeneratorModal } from '../modals/QuizGeneratorModal';
import { QuickQueryModal } from '../modals/QuickQueryModal';
import { AddDomainModal } from '../modals/AddDomainModal';
import { AddTopicModal } from '../modals/AddTopicModal';
import { AddContentModal } from '../modals/AddContentModal';

export interface StudyHubRecentItem {
  id: string;
  title: string;
  type: 'flashcard' | 'quiz' | 'coding' | 'path';
  detail: string;
  timestamp?: string;
  file?: TFile;
}

const STUDY_SHORTCUTS: Array<{ keys: string; label: string }> = [
  { keys: 'R', label: 'Review due' },
  { keys: 'C', label: 'Cram cards' },
  { keys: 'F', label: 'Flashcard Hub' },
  { keys: 'Q', label: 'Quiz Hub' },
  { keys: 'E', label: 'Coding Practice' },
  { keys: 'P', label: 'Study Path' },
  { keys: 'T', label: 'Note Chat' },
  { keys: 'S', label: 'Settings' },
  { keys: 'Esc', label: 'Toggle Focus' },
];

/**
 * Top-level master Study Hub view.
 * Unifies Flashcards & Spaced Repetition, Coding Exercises, Quizzes,
 * Study Paths, Knowledge Taxonomy, and Note Chat into one mission control dashboard.
 */
export class StudyHubView extends ItemView {
  private plugin: GptFreeTextGeneratorPlugin;
  private loading = false;
  private lastRefreshCompletedAt = 0;

  // Flashcards & Spaced Repetition Stats
  private totalDue = 0;
  private totalCards = 0;
  private deckStats: StudySetReviewStats[] = [];
  private reviewStats: ReviewStats | null = null;

  // Quizzes Stats
  private quizFiles: TFile[] = [];

  // Coding Exercises Stats
  private codingFiles: TFile[] = [];
  private bclExerciseCount = 0;

  // Study Path & Roadmap
  private hasStudyPathMarkdown = false;
  private hasStudyPathCanvas = false;
  private studySourceCount = 0;

  // Knowledge Taxonomy (Path Structure)
  private domainCount = 0;
  private subjectCount = 0;
  private topicCount = 0;

  // Recent Activity
  private recentItems: StudyHubRecentItem[] = [];

  private keyHandler = (event: KeyboardEvent) => this.handleKey(event);

  constructor(leaf: WorkspaceLeaf, plugin: GptFreeTextGeneratorPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_STUDY_HUB;
  }

  getDisplayText(): string {
    return 'Study Hub';
  }

  getIcon(): string {
    return 'graduation-cap';
  }

  async onOpen(): Promise<void> {
    this.contentEl.addClass('llm-automation-study-hub-view');
    window.addEventListener('keydown', this.keyHandler);

    this.registerEvent(
      this.app.workspace.on('active-leaf-change', (leaf) => {
        if (leaf === this.leaf) {
          if (Date.now() - this.lastRefreshCompletedAt < 1500) {
            return;
          }
          void this.refresh();
        }
      })
    );

    await this.refresh();
  }

  async onClose(): Promise<void> {
    window.removeEventListener('keydown', this.keyHandler);
    this.contentEl.empty();
    this.plugin.handleStudyHubClosed();
  }

  private handleKey(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
      return;
    }

    if (event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }

    if (event.key === 'Escape' && this.plugin.isStudyFocusActive()) {
      event.preventDefault();
      void this.plugin.toggleStudyFocus();
      return;
    }

    const key = event.key.toUpperCase();
    switch (key) {
      case 'R':
        event.preventDefault();
        if (this.totalDue > 0) {
          void this.plugin.activateReviewView({ title: 'Due Review', includeNotDue: false });
        } else {
          new Notice('No cards are currently due for review.');
        }
        break;
      case 'C':
        event.preventDefault();
        if (this.totalCards > 0) {
          void this.plugin.activateReviewView({ title: 'Cram: All Cards', includeNotDue: true });
        } else {
          new Notice('No cards available in collection.');
        }
        break;
      case 'F':
        event.preventDefault();
        void this.openFlashcardHub();
        break;
      case 'Q':
        event.preventDefault();
        void this.openQuizHub();
        break;
      case 'E':
        event.preventDefault();
        void this.plugin.activateView(VIEW_TYPE_CODING_EXERCISES);
        break;
      case 'P':
        event.preventDefault();
        void this.openStudyPathCanvas();
        break;
      case 'T':
        event.preventDefault();
        void this.plugin.activateView(VIEW_TYPE_SPACED_REPETITION_NOTE_CHAT);
        break;
      case 'S':
        event.preventDefault();
        this.openPluginSettings();
        break;
    }
  }

  async refresh(): Promise<void> {
    if (this.loading) {
      return;
    }

    try {
      this.loading = true;

      // 1. Spaced Repetition Stats
      try {
        const database = await this.plugin.services.ensureSpacedRepetitionDatabase();
        const now = new Date();
        this.totalDue = database.countReviewQuestions({ now });
        this.totalCards = database.countReviewQuestions({ now, includeNotDue: true });
        this.deckStats = database.getStudySetReviewStats(now);
        this.reviewStats = database.getReviewStats(now);
      } catch (error) {
        console.warn('StudyHub: failed to query SpacedRepetitionDatabase:', error);
      }

      // 2. Quizzes in Vault
      try {
        const quizFolder = normalizePath(this.plugin.settings.quizFolder || 'Quizzes');
        this.quizFiles = this.app.vault
          .getMarkdownFiles()
          .filter((f) => f.path.startsWith(quizFolder + '/') || f.path === quizFolder);
      } catch (error) {
        console.warn('StudyHub: failed to scan quizzes:', error);
      }

      // 3. Coding Exercises in Vault & BCL
      try {
        const codingFolder = normalizePath(this.plugin.settings.codingExercisesFolder || 'Coding Exercises');
        this.codingFiles = this.app.vault
          .getMarkdownFiles()
          .filter((f) => f.path.startsWith(codingFolder + '/') || f.path === codingFolder);

        if (this.plugin.settings.studyAssistantRootPath) {
          const entries = await this.plugin.services.studyAssistantImporter.listExercises();
          this.bclExerciseCount = entries.length;
        } else {
          this.bclExerciseCount = 0;
        }
      } catch (error) {
        console.warn('StudyHub: failed to scan coding exercises:', error);
      }

      // 4. Study Path & Roadmaps
      try {
        const mdPath = normalizePath(this.plugin.settings.studyPathMarkdownPath || 'WikiSynthesis/Study/Plans/CSharp/Generated CSharp Study Path.md');
        const canvasPath = normalizePath(this.plugin.settings.studyPathCanvasPath || 'WikiSynthesis/Study/Plans/CSharp/Generated CSharp Study Path.canvas');
        this.hasStudyPathMarkdown = this.app.vault.getAbstractFileByPath(mdPath) instanceof TFile;
        this.hasStudyPathCanvas = this.app.vault.getAbstractFileByPath(canvasPath) instanceof TFile;
        this.studySourceCount = this.plugin.settings.studySourceGroups.filter((g) => g.enabled).length;
      } catch (error) {
        console.warn('StudyHub: failed to check study path files:', error);
      }

      // 5. Knowledge Taxonomy
      try {
        const structure = await this.plugin.services.pathManager.loadStructure();
        const domains = structure?.structure?.domains ?? [];
        this.domainCount = domains.length;
        let subjects = 0;
        let topics = 0;
        for (const d of domains) {
          subjects += (d.subjects ?? []).length;
          for (const s of d.subjects ?? []) {
            topics += (s.topics ?? []).length;
          }
        }
        this.subjectCount = subjects;
        this.topicCount = topics;
      } catch (error) {
        console.warn('StudyHub: failed to load path structure:', error);
      }

      // 6. Aggregate Recent Items
      this.recentItems = this.collectRecentItems();
    } catch (error) {
      console.error('Failed to load Study Hub data:', error);
      new Notice(`Failed to refresh Study Hub: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      this.loading = false;
      this.lastRefreshCompletedAt = Date.now();
      this.render();
    }
  }

  private collectRecentItems(): StudyHubRecentItem[] {
    const items: StudyHubRecentItem[] = [];

    // Add recent quiz notes (sorted by mtime desc)
    const sortedQuizzes = [...this.quizFiles]
      .sort((a, b) => b.stat.mtime - a.stat.mtime)
      .slice(0, 3);
    for (const file of sortedQuizzes) {
      items.push({
        id: `quiz-${file.path}`,
        title: file.basename,
        type: 'quiz',
        detail: `Quiz · Modified ${this.formatTimeAgo(file.stat.mtime)}`,
        file,
      });
    }

    // Add recent coding notes (sorted by mtime desc)
    const sortedCoding = [...this.codingFiles]
      .sort((a, b) => b.stat.mtime - a.stat.mtime)
      .slice(0, 3);
    for (const file of sortedCoding) {
      items.push({
        id: `coding-${file.path}`,
        title: file.basename,
        type: 'coding',
        detail: `Coding Exercise · Modified ${this.formatTimeAgo(file.stat.mtime)}`,
        file,
      });
    }

    return items;
  }

  public render(): void {
    const container = this.contentEl;
    container.empty();

    const shell = container.createDiv({ cls: 'llm-automation-study-hub-container' });

    this.renderTopBar(shell);
    this.renderHero(shell);
    this.renderShortcutHints(shell);
    this.renderModulesGrid(shell);
    this.renderRecentActivity(shell);
  }

  // ------------------------------------------------------------------
  // UI Sections
  // ------------------------------------------------------------------

  private renderTopBar(container: HTMLElement): void {
    const topbar = container.createDiv({ cls: 'llm-automation-study-hub-topbar' });

    const titleGroup = topbar.createDiv({ cls: 'llm-automation-study-hub-title-group' });
    titleGroup.createEl('h1', { text: 'Study Hub' });
    titleGroup.createSpan({ cls: 'llm-automation-study-hub-version-badge', text: 'Central' });

    const actions = topbar.createDiv({ cls: 'llm-automation-study-hub-topbar-actions' });

    const isFocused = this.plugin.isStudyFocusActive();
    const focusButton = actions.createEl('button', {
      text: isFocused ? 'Exit Focus (Esc)' : 'Focus Mode',
      cls: `llm-automation-btn llm-automation-btn-secondary${isFocused ? ' is-active' : ''}`,
    });
    focusButton.addEventListener('click', () => {
      void this.plugin.toggleStudyFocus();
    });

    const refreshButton = actions.createEl('button', {
      text: 'Refresh',
      cls: 'llm-automation-btn llm-automation-btn-secondary',
    });
    refreshButton.addEventListener('click', () => void this.refresh());

    const settingsButton = actions.createEl('button', {
      text: 'Settings',
      cls: 'llm-automation-btn llm-automation-btn-secondary',
    });
    settingsButton.addEventListener('click', () => this.openPluginSettings());
  }

  private renderHero(container: HTMLElement): void {
    const hero = container.createDiv({ cls: 'llm-automation-study-hub-hero' });

    const heroMain = hero.createDiv({ cls: 'llm-automation-study-hub-hero-main' });
    const greeting = heroMain.createDiv({ cls: 'llm-automation-study-hub-hero-greeting' });
    greeting.createEl('h2', { text: "Today's Study Center" });

    let statusText = '';
    if (this.totalDue > 0) {
      statusText = `You have ${this.totalDue} flashcard${this.totalDue === 1 ? '' : 's'} ready for review.`;
    } else if (this.totalCards > 0) {
      statusText = 'All flashcard reviews are up to date! Great momentum.';
    } else {
      statusText = 'Welcome! Generate flashcards, quizzes, or code exercises to begin.';
    }
    heroMain.createEl('p', { text: statusText, cls: 'llm-automation-study-hub-hero-status' });

    const statsRow = heroMain.createDiv({ cls: 'llm-automation-study-hub-hero-stats' });
    this.renderHeroStat(statsRow, String(this.totalDue), 'Due Cards');
    this.renderHeroStat(statsRow, String(this.totalCards), 'Total Cards');
    this.renderHeroStat(statsRow, String(this.quizFiles.length), 'Quizzes');
    this.renderHeroStat(statsRow, String(this.codingFiles.length), 'Code Exercises');
    if (this.reviewStats) {
      this.renderHeroStat(statsRow, String(this.reviewStats.reviewedToday), 'Reviewed Today');
    }

    const ctaGroup = hero.createDiv({ cls: 'llm-automation-study-hub-hero-cta' });
    const reviewBtn = ctaGroup.createEl('button', {
      text: this.totalDue > 0 ? `Review Due (${this.totalDue})` : 'Start Cram Session',
      cls: 'llm-automation-btn llm-automation-btn-primary llm-automation-study-hub-hero-primary-btn',
    });
    reviewBtn.disabled = this.totalCards === 0;
    reviewBtn.addEventListener('click', () => {
      if (this.totalDue > 0) {
        void this.plugin.activateReviewView({ title: 'Due Review', includeNotDue: false });
      } else {
        void this.plugin.activateReviewView({ title: 'Cram: All Cards', includeNotDue: true });
      }
    });

    const flashcardHubBtn = ctaGroup.createEl('button', {
      text: 'Flashcard Hub',
      cls: 'llm-automation-btn llm-automation-btn-secondary',
    });
    flashcardHubBtn.addEventListener('click', () => void this.openFlashcardHub());

    const quizHubBtn = ctaGroup.createEl('button', {
      text: 'Quiz Hub',
      cls: 'llm-automation-btn llm-automation-btn-secondary',
    });
    quizHubBtn.addEventListener('click', () => void this.openQuizHub());
  }

  private renderHeroStat(container: HTMLElement, value: string, label: string): void {
    const statEl = container.createDiv({ cls: 'llm-automation-study-hub-hero-stat-card' });
    statEl.createDiv({ text: value, cls: 'llm-automation-study-hub-hero-stat-val' });
    statEl.createDiv({ text: label, cls: 'llm-automation-study-hub-hero-stat-lbl' });
  }

  private renderShortcutHints(container: HTMLElement): void {
    const hints = container.createDiv({ cls: 'llm-automation-flashcard-hub-shortcuts' });
    hints.createEl('span', {
      text: 'Shortcuts',
      cls: 'llm-automation-flashcard-hub-shortcuts-label',
    });
    for (const shortcut of STUDY_SHORTCUTS) {
      const item = hints.createSpan({ cls: 'llm-automation-flashcard-hub-shortcut' });
      const kbd = item.createEl('kbd', { text: shortcut.keys });
      kbd.setAttribute('aria-hidden', 'true');
      item.createEl('span', { text: shortcut.label });
    }
  }

  private renderModulesGrid(container: HTMLElement): void {
    const section = container.createDiv({ cls: 'llm-automation-study-hub-modules-section' });
    section.createEl('h2', { text: 'Study Modules & Sub-Hubs' });

    const grid = section.createDiv({ cls: 'llm-automation-study-hub-grid' });

    // Module 1: Flashcards & Spaced Repetition
    this.renderModuleCard(grid, {
      icon: 'library',
      title: 'Flashcards & Spaced Repetition',
      subtitle: 'Mnemosyne-style SRS review, deck management, and AI card generation',
      badge: `${this.totalDue} Due / ${this.totalCards} Total`,
      details: [
        `${this.deckStats.length} Decks active`,
        this.reviewStats ? `${this.reviewStats.reviewedLast7Days} reviews in 7 days` : null,
      ].filter(Boolean) as string[],
      primaryAction: {
        label: 'Open Flashcard Hub',
        handler: () => this.openFlashcardHub(),
      },
      secondaryActions: [
        {
          label: 'Review Due',
          enabled: this.totalDue > 0,
          handler: () => this.plugin.activateReviewView({ title: 'Due Review', includeNotDue: false }),
        },
        {
          label: 'Generate Cards',
          enabled: true,
          handler: () => this.plugin.activateView(VIEW_TYPE_FLASHCARD_GENERATION),
        },
        {
          label: 'Add Card',
          enabled: true,
          handler: () => this.openManualQuestionModal(),
        },
      ],
    });

    // Module 2: Quizzes & Self-Assessment
    this.renderModuleCard(grid, {
      icon: 'check-square',
      title: 'Quizzes & Self-Assessment',
      subtitle: 'Interactive quiz testing, vault quiz notes, and knowledge checks',
      badge: `${this.quizFiles.length} Quizzes in Vault`,
      details: [
        `Stored in folder: ${this.plugin.settings.quizFolder || 'Quizzes'}`,
        'Interactive runner & missed question export',
      ],
      primaryAction: {
        label: 'Open Quiz Hub',
        handler: () => this.openQuizHub(),
      },
      secondaryActions: [
        {
          label: 'Generate Quiz from Context',
          enabled: true,
          handler: () => new QuizGeneratorModal(this.app, this.plugin).open(),
        },
      ],
    });

    // Module 3: Coding Exercises & LINQPad Runner
    this.renderModuleCard(grid, {
      icon: 'code',
      title: 'Coding Exercises & C# Runner',
      subtitle: 'Interactive C# programming with local LPRun compile/run testing',
      badge: `${this.codingFiles.length} Saved · ${this.bclExerciseCount} BCL catalog`,
      details: [
        `Local runner: ${this.plugin.settings.allowLocalCodeExecution ? 'Enabled' : 'Disabled'}`,
        `Provider: ${this.plugin.settings.codingExerciseProvider}`,
      ],
      primaryAction: {
        label: 'Open Coding Practice',
        handler: () => this.plugin.activateView(VIEW_TYPE_CODING_EXERCISES),
      },
      secondaryActions: [
        {
          label: 'Open Settings',
          enabled: true,
          handler: () => this.openPluginSettings(),
        },
      ],
    });

    // Module 4: Study Paths & Roadmaps
    this.renderModuleCard(grid, {
      icon: 'map',
      title: 'Study Paths & Roadmaps',
      subtitle: 'Visual Obsidian Canvas roadmaps and structured multi-stage curricula',
      badge: this.hasStudyPathCanvas ? 'Canvas Available' : 'Not Yet Generated',
      details: [
        `${this.studySourceCount} Study source group(s) configured`,
        this.hasStudyPathMarkdown ? 'Markdown plan generated' : 'Markdown plan pending',
      ],
      primaryAction: {
        label: this.hasStudyPathCanvas ? 'Open Canvas Roadmap' : 'Generate Study Path',
        handler: () => {
          if (this.hasStudyPathCanvas) {
            void this.openStudyPathCanvas();
          } else {
            void this.generateStudyPath();
          }
        },
      },
      secondaryActions: [
        {
          label: 'Scan Sources',
          enabled: true,
          handler: () => this.scanStudySources(),
        },
        {
          label: 'Regenerate Path',
          enabled: true,
          handler: () => this.generateStudyPath(),
        },
      ],
    });

    // Module 5: Knowledge Taxonomy (Path Structure)
    this.renderModuleCard(grid, {
      icon: 'folder-tree',
      title: 'Knowledge Domain Taxonomy',
      subtitle: 'Domain → Subject → Topic → Series → Author → Content hierarchy',
      badge: `${this.domainCount} Domains · ${this.subjectCount} Subjects · ${this.topicCount} Topics`,
      details: [
        'Curriculum and concept organization tree',
        'Automatic backup and index management',
      ],
      primaryAction: {
        label: 'Add Domain',
        handler: () => new AddDomainModal(this.app, this.plugin).open(),
      },
      secondaryActions: [
        {
          label: 'Add Topic',
          enabled: this.domainCount > 0,
          handler: () => new AddTopicModal(this.app, this.plugin).open(),
        },
        {
          label: 'Link Content',
          enabled: this.topicCount > 0,
          handler: () => new AddContentModal(this.app, this.plugin).open(),
        },
      ],
    });

    // Module 6: AI Study Tutor & Grounded Search
    this.renderModuleCard(grid, {
      icon: 'messages-square',
      title: 'AI Note Chat & Tutor',
      subtitle: 'Interactive note tutor with grounded retrieval across notes and codebases',
      badge: `Provider: ${this.plugin.settings.noteChatProvider}`,
      details: [
        `Model: ${this.plugin.settings.noteChatModel || 'Default'}`,
        'Supports attached code, PDFs, and conversation history',
      ],
      primaryAction: {
        label: 'Open Note Chat',
        handler: () => this.plugin.activateView(VIEW_TYPE_SPACED_REPETITION_NOTE_CHAT),
      },
      secondaryActions: [
        {
          label: 'Quick Query',
          enabled: true,
          handler: () => new QuickQueryModal(this.app, this.plugin).open(),
        },
      ],
    });
  }

  private renderModuleCard(container: HTMLElement, config: {
    icon: string;
    title: string;
    subtitle: string;
    badge: string;
    details: string[];
    primaryAction: { label: string; handler: () => void | Promise<void> };
    secondaryActions?: Array<{ label: string; enabled: boolean; handler: () => void | Promise<void> }>;
  }): void {
    const card = container.createDiv({ cls: 'llm-automation-study-hub-card' });

    const cardHeader = card.createDiv({ cls: 'llm-automation-study-hub-card-header' });
    const titleArea = cardHeader.createDiv({ cls: 'llm-automation-study-hub-card-title-area' });
    const iconSpan = titleArea.createSpan({ cls: 'llm-automation-study-hub-card-icon' });
    setIcon(iconSpan, config.icon);
    titleArea.createEl('h3', { text: config.title });

    cardHeader.createSpan({ cls: 'llm-automation-study-hub-card-badge', text: config.badge });

    card.createEl('p', { text: config.subtitle, cls: 'llm-automation-study-hub-card-subtitle' });

    const detailsList = card.createEl('ul', { cls: 'llm-automation-study-hub-card-details' });
    for (const d of config.details) {
      detailsList.createEl('li', { text: d });
    }

    const actions = card.createDiv({ cls: 'llm-automation-study-hub-card-actions' });
    const primaryBtn = actions.createEl('button', {
      text: config.primaryAction.label,
      cls: 'llm-automation-btn llm-automation-btn-primary',
    });
    primaryBtn.addEventListener('click', () => void config.primaryAction.handler());

    if (config.secondaryActions) {
      for (const sa of config.secondaryActions) {
        const secBtn = actions.createEl('button', {
          text: sa.label,
          cls: 'llm-automation-btn llm-automation-btn-secondary',
        });
        secBtn.disabled = !sa.enabled;
        secBtn.addEventListener('click', () => void sa.handler());
      }
    }
  }

  private renderRecentActivity(container: HTMLElement): void {
    if (this.recentItems.length === 0) {
      return;
    }

    const section = container.createDiv({ cls: 'llm-automation-study-hub-recent-section' });
    section.createEl('h2', { text: 'Recent Study Material' });

    const list = section.createDiv({ cls: 'llm-automation-study-hub-recent-list' });

    for (const item of this.recentItems) {
      const row = list.createDiv({ cls: 'llm-automation-study-hub-recent-row' });
      const info = row.createDiv({ cls: 'llm-automation-study-hub-recent-info' });
      info.createDiv({ text: item.title, cls: 'llm-automation-study-hub-recent-title' });
      info.createDiv({ text: item.detail, cls: 'llm-automation-study-hub-recent-detail' });

      const actions = row.createDiv({ cls: 'llm-automation-study-hub-recent-actions' });
      if (item.file) {
        const openBtn = actions.createEl('button', {
          text: 'Open Note',
          cls: 'llm-automation-btn llm-automation-btn-secondary',
        });
        openBtn.addEventListener('click', () => {
          if (item.file) {
            void this.app.workspace.getLeaf(false).openFile(item.file);
          }
        });
      }
    }
  }

  // ------------------------------------------------------------------
  // Actions & Navigation
  // ------------------------------------------------------------------

  private async openFlashcardHub(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_FLASHCARD_HUB);
    if (existing.length > 0) {
      this.app.workspace.revealLeaf(existing[0]);
      return;
    }
    const leaf = this.app.workspace.getLeaf('tab');
    await leaf.setViewState({
      type: VIEW_TYPE_FLASHCARD_HUB,
      active: true,
    });
    this.app.workspace.revealLeaf(leaf);
  }

  private async openQuizHub(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_QUIZ_HUB);
    if (existing.length > 0) {
      this.app.workspace.revealLeaf(existing[0]);
      return;
    }
    const leaf = this.app.workspace.getLeaf('tab');
    await leaf.setViewState({
      type: VIEW_TYPE_QUIZ_HUB,
      active: true,
    });
    this.app.workspace.revealLeaf(leaf);
  }

  private async openStudyPathCanvas(): Promise<void> {
    const canvasPath = normalizePath(this.plugin.settings.studyPathCanvasPath || 'WikiSynthesis/Study/Plans/CSharp/Generated CSharp Study Path.canvas');
    const file = this.app.vault.getAbstractFileByPath(canvasPath);
    if (file instanceof TFile) {
      await this.app.workspace.getLeaf(false).openFile(file);
    } else {
      new Notice('No study path canvas found. Click "Generate Study Path" first.');
    }
  }

  private async scanStudySources(): Promise<void> {
    try {
      new Notice('Scanning study source library...');
      const result = await this.plugin.services.studySourceLibrary.scan();
      const file = await this.plugin.services.studySourceLibrary.createOrUpdateInventoryNote(result);
      await this.app.workspace.getLeaf(false).openFile(file);
      new Notice(`Scanned ${result.includedFiles}/${result.totalFiles} files (~${result.includedEstimatedTokens} tokens).`);
      await this.refresh();
    } catch (error) {
      new Notice(`Scan failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async generateStudyPath(): Promise<void> {
    try {
      new Notice('Generating C# Study Path (this may take a minute)...');
      const result = await this.plugin.services.studyPathGenerator.generateCSharpStudyPath();
      const canvasFile = this.app.vault.getAbstractFileByPath(result.canvasPath);
      if (canvasFile instanceof TFile) {
        await this.app.workspace.getLeaf(false).openFile(canvasFile);
      }
      new Notice(`Study path generated with ${result.plan.stages.length} stages.`);
      await this.refresh();
    } catch (error) {
      new Notice(`Generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private openManualQuestionModal(): void {
    const activeFile = this.app.workspace.getActiveFile();
    if (activeFile) {
      new SpacedRepetitionManualQuestionModal(this.app, this.plugin, activeFile).open();
      return;
    }

    new NotePickerModal(this.app, (file) => {
      new SpacedRepetitionManualQuestionModal(this.app, this.plugin, file).open();
    }).open();
  }

  private openPluginSettings(): void {
    const settingApp = this.app as unknown as {
      setting?: { open: () => void; openTabById: (id: string) => void };
    };
    if (settingApp.setting?.openTabById) {
      settingApp.setting.open();
      settingApp.setting.openTabById(this.plugin.manifest.id);
    } else {
      new Notice('Open Settings via Settings icon in Obsidian sidebar');
    }
  }

  private formatTimeAgo(timestampMs: number): string {
    const diffSec = Math.floor((Date.now() - timestampMs) / 1000);
    if (diffSec < 60) return 'just now';
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHour = Math.floor(diffMin / 60);
    if (diffHour < 24) return `${diffHour}h ago`;
    const diffDay = Math.floor(diffHour / 24);
    return `${diffDay}d ago`;
  }
}
