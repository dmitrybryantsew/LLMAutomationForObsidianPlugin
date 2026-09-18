import { ItemView, Notice, TFile, WorkspaceLeaf, normalizePath, setIcon } from 'obsidian';
import type GptFreeTextGeneratorPlugin from '../main';
import {
  VIEW_TYPE_QUIZ_HUB,
  VIEW_TYPE_STUDY_HUB,
  VIEW_TYPE_FLASHCARD_HUB,
} from '../constants';
import { QuizGeneratorModal } from '../modals/QuizGeneratorModal';
import { SpacedRepetitionQuestionInput } from '../types/spacedRepetition';
import { parseQuizMarkdown, ParsedQuiz, ParsedQuizQuestion } from '../utils/quizParser';

export interface QuizHubItem extends ParsedQuiz {
  file: TFile;
}

export class QuizHubView extends ItemView {
  private plugin: GptFreeTextGeneratorPlugin;
  private loading = false;
  private quizzes: QuizHubItem[] = [];
  private searchQuery = '';

  // Runner state
  private activeQuiz: QuizHubItem | null = null;
  private currentQuestionIndex = 0;
  private selectedChoice: string | null = null;
  private answerRevealed = false;
  private quizCompleted = false;

  private keyHandler = (event: KeyboardEvent) => this.handleKey(event);

  constructor(leaf: WorkspaceLeaf, plugin: GptFreeTextGeneratorPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_QUIZ_HUB;
  }

  getDisplayText(): string {
    return this.activeQuiz ? `Quiz: ${this.activeQuiz.title}` : 'Quiz Hub';
  }

  getIcon(): string {
    return 'check-square';
  }

  async onOpen(): Promise<void> {
    this.contentEl.addClass('llm-automation-quiz-hub-view');
    window.addEventListener('keydown', this.keyHandler);
    await this.refresh();
  }

  async onClose(): Promise<void> {
    window.removeEventListener('keydown', this.keyHandler);
    this.contentEl.empty();
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
      this.plugin.exitStudyFocus();
      return;
    }
  }

  async refresh(): Promise<void> {
    if (this.loading) return;

    try {
      this.loading = true;
      const quizFolder = normalizePath(this.plugin.settings.quizFolder || 'Quizzes');
      const files = this.app.vault
        .getMarkdownFiles()
        .filter((f) => f.path.startsWith(quizFolder + '/') || f.path === quizFolder)
        .sort((a, b) => b.stat.mtime - a.stat.mtime);

      const parsedList: QuizHubItem[] = [];
      for (const file of files) {
        try {
          const content = await this.app.vault.read(file);
          const parsed = parseQuizMarkdown(file.basename, file.path, content);
          parsedList.push({ ...parsed, file });
        } catch (err) {
          console.warn(`Failed to parse quiz file ${file.path}:`, err);
        }
      }

      this.quizzes = parsedList;
    } catch (error) {
      console.error('Failed to load quizzes:', error);
      new Notice(`Failed to load quizzes: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      this.loading = false;
      this.render();
    }
  }

  // ------------------------------------------------------------------
  // Render Main Hub vs. Runner
  // ------------------------------------------------------------------

  public render(): void {
    const container = this.contentEl;
    container.empty();

    const shell = container.createDiv({ cls: 'llm-automation-quiz-hub-container' });

    if (this.activeQuiz) {
      this.renderRunner(shell);
    } else {
      this.renderHub(shell);
    }
  }

  // ------------------------------------------------------------------
  // Hub List View
  // ------------------------------------------------------------------

  private renderHub(container: HTMLElement): void {
    // Topbar
    const topbar = container.createDiv({ cls: 'llm-automation-quiz-hub-topbar' });
    const leftArea = topbar.createDiv({ cls: 'llm-automation-quiz-hub-title-group' });

    const backBtn = leftArea.createEl('button', {
      text: '← Study Hub',
      cls: 'llm-automation-btn llm-automation-btn-secondary',
    });
    backBtn.addEventListener('click', () => void this.openStudyHub());

    leftArea.createEl('h1', { text: 'Quiz Hub' });

    const rightActions = topbar.createDiv({ cls: 'llm-automation-quiz-hub-topbar-actions' });

    if (this.plugin.isStudyFocusActive()) {
      const exitFocusBtn = rightActions.createEl('button', {
        text: 'Exit Focus (Esc)',
        cls: 'llm-automation-btn llm-automation-btn-secondary is-active',
      });
      exitFocusBtn.addEventListener('click', () => {
        this.plugin.exitStudyFocus();
      });
    }

    const newQuizBtn = rightActions.createEl('button', {
      text: 'New Quiz',
      cls: 'llm-automation-btn llm-automation-btn-primary',
    });
    newQuizBtn.addEventListener('click', () => {
      new QuizGeneratorModal(this.app, this.plugin).open();
    });

    const refreshBtn = rightActions.createEl('button', {
      text: 'Refresh',
      cls: 'llm-automation-btn llm-automation-btn-secondary',
    });
    refreshBtn.addEventListener('click', () => void this.refresh());

    // Search & Filter
    const searchBar = container.createDiv({ cls: 'llm-automation-quiz-hub-search-bar' });
    const searchInput = searchBar.createEl('input', {
      type: 'text',
      placeholder: 'Search quizzes by title, topic, or difficulty...',
      cls: 'llm-automation-quiz-hub-search-input',
    });
    searchInput.value = this.searchQuery;
    searchInput.addEventListener('input', () => {
      this.searchQuery = searchInput.value.toLowerCase();
      this.renderQuizList(listContainer);
    });

    // List container
    const listContainer = container.createDiv({ cls: 'llm-automation-quiz-hub-list' });
    this.renderQuizList(listContainer);
  }

  private renderQuizList(container: HTMLElement): void {
    container.empty();

    const filtered = this.quizzes.filter((q) => {
      if (!this.searchQuery) return true;
      return (
        q.title.toLowerCase().includes(this.searchQuery) ||
        q.topic.toLowerCase().includes(this.searchQuery) ||
        q.difficulty.toLowerCase().includes(this.searchQuery)
      );
    });

    if (filtered.length === 0) {
      container.createEl('div', {
        text: this.searchQuery
          ? 'No quizzes matched your search.'
          : 'No quizzes found in vault. Click "New Quiz" to generate one from a note.',
        cls: 'llm-automation-quiz-hub-empty',
      });
      return;
    }

    for (const quiz of filtered) {
      const card = container.createDiv({ cls: 'llm-automation-quiz-card' });

      const header = card.createDiv({ cls: 'llm-automation-quiz-card-header' });
      const titleArea = header.createDiv({ cls: 'llm-automation-quiz-card-title-area' });
      titleArea.createEl('h3', { text: quiz.title });

      const meta = header.createDiv({ cls: 'llm-automation-quiz-card-meta' });
      meta.createSpan({ cls: 'llm-automation-quiz-badge', text: quiz.difficulty });
      meta.createSpan({
        cls: 'llm-automation-quiz-badge llm-automation-quiz-badge-count',
        text: `${quiz.questions.length} Question${quiz.questions.length === 1 ? '' : 's'}`,
      });

      const body = card.createDiv({ cls: 'llm-automation-quiz-card-body' });
      body.createEl('p', {
        text: `Topic: ${quiz.topic} · Path: ${quiz.filePath}`,
        cls: 'llm-automation-quiz-card-path',
      });

      const actions = card.createDiv({ cls: 'llm-automation-quiz-card-actions' });
      const takeBtn = actions.createEl('button', {
        text: 'Take Quiz',
        cls: 'llm-automation-btn llm-automation-btn-primary',
      });
      takeBtn.disabled = quiz.questions.length === 0;
      takeBtn.addEventListener('click', () => this.startQuizRunner(quiz));

      const openNoteBtn = actions.createEl('button', {
        text: 'View Note',
        cls: 'llm-automation-btn llm-automation-btn-secondary',
      });
      openNoteBtn.addEventListener('click', () => {
        void this.app.workspace.getLeaf(false).openFile(quiz.file);
      });
    }
  }

  // ------------------------------------------------------------------
  // Interactive Quiz Runner
  // ------------------------------------------------------------------

  private startQuizRunner(quiz: QuizHubItem): void {
    this.activeQuiz = quiz;
    this.currentQuestionIndex = 0;
    this.selectedChoice = null;
    this.answerRevealed = false;
    this.quizCompleted = false;

    // Reset user answers
    for (const q of quiz.questions) {
      q.userAnswer = undefined;
      q.isCorrect = undefined;
    }

    this.render();
  }

  private exitQuizRunner(): void {
    this.activeQuiz = null;
    this.render();
  }

  private renderRunner(container: HTMLElement): void {
    if (!this.activeQuiz) return;

    const quiz = this.activeQuiz;
    const runnerEl = container.createDiv({ cls: 'llm-automation-quiz-runner' });

    // Header
    const header = runnerEl.createDiv({ cls: 'llm-automation-quiz-runner-header' });
    const backBtn = header.createEl('button', {
      text: '← Back to Quiz List',
      cls: 'llm-automation-btn llm-automation-btn-secondary',
    });
    backBtn.addEventListener('click', () => this.exitQuizRunner());

    header.createEl('h2', { text: quiz.title });

    if (this.plugin.isStudyFocusActive()) {
      const exitFocusBtn = header.createEl('button', {
        text: 'Exit Focus (Esc)',
        cls: 'llm-automation-btn llm-automation-btn-secondary is-active',
      });
      exitFocusBtn.style.marginLeft = 'auto';
      exitFocusBtn.addEventListener('click', () => {
        this.plugin.exitStudyFocus();
      });
    }

    if (this.quizCompleted) {
      this.renderQuizResults(runnerEl);
      return;
    }

    // Progress Bar
    const progress = runnerEl.createDiv({ cls: 'llm-automation-quiz-runner-progress' });
    const percent = Math.round(((this.currentQuestionIndex + 1) / quiz.questions.length) * 100);
    progress.createDiv({
      text: `Question ${this.currentQuestionIndex + 1} of ${quiz.questions.length} (${percent}%)`,
      cls: 'llm-automation-quiz-progress-text',
    });
    const progressBar = progress.createDiv({ cls: 'llm-automation-quiz-progress-bar' });
    progressBar.createDiv({
      cls: 'llm-automation-quiz-progress-fill',
      attr: { style: `width: ${percent}%;` },
    });

    const currentQ = quiz.questions[this.currentQuestionIndex];
    if (!currentQ) {
      this.quizCompleted = true;
      this.render();
      return;
    }

    // Question Card
    const card = runnerEl.createDiv({ cls: 'llm-automation-quiz-question-card' });
    card.createEl('h3', {
      text: `${currentQ.number}. ${currentQ.questionText}`,
      cls: 'llm-automation-quiz-question-title',
    });

    // Choices
    const choicesContainer = card.createDiv({ cls: 'llm-automation-quiz-choices' });
    if (currentQ.choices.length > 0) {
      for (const choice of currentQ.choices) {
        const isSelected = this.selectedChoice === choice.key;
        let choiceCls = 'llm-automation-quiz-choice-btn';
        if (isSelected) choiceCls += ' selected';

        if (this.answerRevealed) {
          if (choice.key === currentQ.correctAnswerKey) {
            choiceCls += ' correct';
          } else if (isSelected && choice.key !== currentQ.correctAnswerKey) {
            choiceCls += ' incorrect';
          }
        }

        const btn = choicesContainer.createEl('button', {
          cls: choiceCls,
        });
        btn.createSpan({ cls: 'llm-automation-quiz-choice-key', text: choice.key });
        btn.createSpan({ cls: 'llm-automation-quiz-choice-text', text: choice.text });

        if (!this.answerRevealed) {
          btn.addEventListener('click', () => {
            this.selectedChoice = choice.key;
            this.render();
          });
        }
      }
    } else {
      // Self-check question if no explicit choices
      card.createEl('p', {
        text: 'Think of your answer, then click "Reveal Answer" to check.',
        cls: 'llm-automation-quiz-self-check-prompt',
      });
    }

    // Explanation Area (Revealed)
    if (this.answerRevealed) {
      const explanationBox = card.createDiv({ cls: 'llm-automation-quiz-explanation-box' });
      const isCorrect = this.selectedChoice === currentQ.correctAnswerKey;
      explanationBox.createEl('div', {
        text: isCorrect ? '✓ Correct!' : `✗ Incorrect. Correct answer: ${currentQ.correctAnswerKey}`,
        cls: isCorrect ? 'llm-automation-quiz-feedback-correct' : 'llm-automation-quiz-feedback-incorrect',
      });
      if (currentQ.explanation) {
        explanationBox.createEl('p', {
          text: currentQ.explanation,
          cls: 'llm-automation-quiz-explanation-text',
        });
      }
    }

    // Controls
    const controls = runnerEl.createDiv({ cls: 'llm-automation-quiz-runner-controls' });

    if (!this.answerRevealed) {
      const checkBtn = controls.createEl('button', {
        text: currentQ.choices.length > 0 ? 'Check Answer' : 'Reveal Answer',
        cls: 'llm-automation-btn llm-automation-btn-primary',
      });
      checkBtn.disabled = currentQ.choices.length > 0 && !this.selectedChoice;
      checkBtn.addEventListener('click', () => {
        this.answerRevealed = true;
        currentQ.userAnswer = this.selectedChoice || '';
        currentQ.isCorrect = currentQ.choices.length > 0
          ? this.selectedChoice === currentQ.correctAnswerKey
          : true;
        this.render();
      });
    } else {
      const isLast = this.currentQuestionIndex >= quiz.questions.length - 1;
      const nextBtn = controls.createEl('button', {
        text: isLast ? 'Finish Quiz' : 'Next Question →',
        cls: 'llm-automation-btn llm-automation-btn-primary',
      });
      nextBtn.addEventListener('click', () => {
        if (isLast) {
          this.quizCompleted = true;
        } else {
          this.currentQuestionIndex++;
          this.selectedChoice = null;
          this.answerRevealed = false;
        }
        this.render();
      });
    }
  }

  private renderQuizResults(container: HTMLElement): void {
    if (!this.activeQuiz) return;

    const quiz = this.activeQuiz;
    const resultsBox = container.createDiv({ cls: 'llm-automation-quiz-results-box' });
    resultsBox.createEl('h2', { text: 'Quiz Completed!' });

    const total = quiz.questions.length;
    const correctCount = quiz.questions.filter((q) => q.isCorrect).length;
    const percentage = Math.round((correctCount / total) * 100);

    const scoreCard = resultsBox.createDiv({ cls: 'llm-automation-quiz-score-card' });
    scoreCard.createDiv({ text: `${percentage}%`, cls: 'llm-automation-quiz-score-val' });
    scoreCard.createDiv({ text: `${correctCount} of ${total} correct`, cls: 'llm-automation-quiz-score-lbl' });

    const missed = quiz.questions.filter((q) => q.isCorrect === false);

    const actions = resultsBox.createDiv({ cls: 'llm-automation-quiz-results-actions' });

    if (missed.length > 0) {
      const exportCardsBtn = actions.createEl('button', {
        text: `Export ${missed.length} Missed Question${missed.length === 1 ? '' : 's'} to Flashcards`,
        cls: 'llm-automation-btn llm-automation-btn-primary',
      });
      exportCardsBtn.addEventListener('click', () => void this.exportMissedToFlashcards(missed, quiz));
    }

    const retakeBtn = actions.createEl('button', {
      text: 'Retake Quiz',
      cls: 'llm-automation-btn llm-automation-btn-secondary',
    });
    retakeBtn.addEventListener('click', () => this.startQuizRunner(quiz));

    const exitBtn = actions.createEl('button', {
      text: 'Exit to Quiz List',
      cls: 'llm-automation-btn llm-automation-btn-secondary',
    });
    exitBtn.addEventListener('click', () => this.exitQuizRunner());
  }

  private async exportMissedToFlashcards(missed: ParsedQuizQuestion[], quiz: QuizHubItem): Promise<void> {
    try {
      const database = await this.plugin.services.ensureSpacedRepetitionDatabase();

      // Find or create a study set for this quiz
      let studySetId: string | null = null;
      const sets = database.getStudySets();
      const existingSet = sets.find((s) => s.name.toLowerCase() === `quiz: ${quiz.topic.toLowerCase()}`);
      if (existingSet) {
        studySetId = existingSet.id;
      } else {
        studySetId = await database.createStudySet({
          name: `Quiz: ${quiz.topic}`,
          description: `Auto-generated flashcards from missed questions in quiz ${quiz.title}`,
          sourceType: 'manual',
          sourceRule: { type: 'manual' },
          tags: ['quiz', quiz.topic.toLowerCase()],
        });
      }

      const cardInputs: SpacedRepetitionQuestionInput[] = missed.map((q) => {
        const answerText = q.explanation
          ? `${q.correctAnswerKey}: ${q.explanation}`
          : q.choices.find((c) => c.key === q.correctAnswerKey)?.text || q.correctAnswerKey;

        return {
          studySetId,
          questionName: `${quiz.topic} Q${q.number}`,
          questionText: q.questionText,
          questionType: q.choices.length > 0 ? 'multiple_choice' : 'self_check',
          answerText,
          choices: q.choices.length > 0 ? q.choices.map((c) => `${c.key}) ${c.text}`) : undefined,
          answerCheckMode: q.choices.length > 0 ? 'exact' : 'self',
          metadata: {
            sourceQuizPath: quiz.filePath,
            quizQuestionNumber: q.number,
            difficulty: quiz.difficulty,
          },
        };
      });

      const ids = await database.createQuestions(cardInputs);
      new Notice(`Successfully exported ${ids.length} missed question(s) to Flashcard Deck "${quiz.topic}"!`);
    } catch (error) {
      console.error('Failed to export missed questions to flashcards:', error);
      new Notice(`Failed to export: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async openStudyHub(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_STUDY_HUB);
    if (existing.length > 0) {
      this.app.workspace.revealLeaf(existing[0]);
      return;
    }
    const leaf = this.app.workspace.getLeaf('tab');
    await leaf.setViewState({
      type: VIEW_TYPE_STUDY_HUB,
      active: true,
    });
    this.app.workspace.revealLeaf(leaf);
  }
}
