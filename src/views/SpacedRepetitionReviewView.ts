import { ItemView, Notice, Setting, WorkspaceLeaf } from 'obsidian';
import type GptFreeTextGeneratorPlugin from '../main';
import { VIEW_TYPE_SPACED_REPETITION_REVIEW } from '../constants';
import { DueQuestionRecord } from '../utils/spacedRepetition/SpacedRepetitionDatabase';
import { AnswerCheckerResult, ExactAnswerField, ReviewGrade } from '../types/spacedRepetition';
import { matchesExactAnswerField, normalizeExactAnswer, normalizeExactAnswerField } from '../utils/spacedRepetition/ExactAnswerMatcher';

export interface SpacedRepetitionReviewMode {
  title: string;
  includeNotDue: boolean;
  noteId?: string | null;
  studySetId?: string | null;
}

export class SpacedRepetitionReviewView extends ItemView {
  private plugin: GptFreeTextGeneratorPlugin;
  private dueCards: DueQuestionRecord[] = [];
  private currentCard: DueQuestionRecord | null = null;
  private answerRevealed = false;
  private userAnswer = '';
  private fieldAnswers: Record<string, string> = {};
  private checkerResult: AnswerCheckerResult | null = null;
  private checkingAnswer = false;
  private sessionReviewed = 0;
  private cardStartedAt = Date.now();
  private reviewMode: SpacedRepetitionReviewMode = {
    title: 'Due Review',
    includeNotDue: false,
  };
  private keyHandler = (event: KeyboardEvent) => this.handleKey(event);

  constructor(leaf: WorkspaceLeaf, plugin: GptFreeTextGeneratorPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_SPACED_REPETITION_REVIEW;
  }

  getDisplayText(): string {
    return 'Spaced Repetition Review';
  }

  async onOpen(): Promise<void> {
    this.contentEl.addClass('spaced-repetition-review-view');
    window.addEventListener('keydown', this.keyHandler);
    await this.loadNextCard();
  }

  async onClose(): Promise<void> {
    window.removeEventListener('keydown', this.keyHandler);
    this.contentEl.empty();
  }

  private async loadDueCards(): Promise<void> {
    const database = await this.plugin.services.ensureSpacedRepetitionDatabase();
    this.dueCards = database.getReviewQuestions({
      now: new Date(),
      limit: this.plugin.settings.spacedRepetition.maxReviewCardsPerSession,
      includeNotDue: this.reviewMode.includeNotDue,
      noteId: this.reviewMode.noteId,
      studySetId: this.reviewMode.studySetId,
    });
  }

  async setReviewMode(mode: SpacedRepetitionReviewMode): Promise<void> {
    this.reviewMode = mode;
    this.dueCards = [];
    this.currentCard = null;
    this.sessionReviewed = 0;
    await this.loadNextCard();
  }

  private async loadNextCard(): Promise<void> {
    if (this.dueCards.length === 0) {
      await this.loadDueCards();
    }

    this.currentCard = this.dueCards.shift() ?? null;
    this.answerRevealed = false;
    this.userAnswer = '';
    this.fieldAnswers = {};
    this.checkerResult = null;
    this.checkingAnswer = false;
    this.cardStartedAt = Date.now();
    this.render();
  }

  private render(): void {
    const container = this.contentEl;
    container.empty();

    const header = container.createDiv({ cls: 'spaced-repetition-review-header' });
    header.createEl('h2', { text: this.reviewMode.title });
    header.createSpan({
      text: `${this.sessionReviewed} reviewed`,
      cls: 'spaced-repetition-review-count',
    });

    if (!this.currentCard) {
      this.renderEmptyState(container);
      return;
    }

    const card = container.createDiv({ cls: 'spaced-repetition-review-card' });
    if (this.currentCard.questionName) {
      card.createEl('div', {
        text: this.currentCard.questionName,
        cls: 'spaced-repetition-card-label',
      });
    }

    this.renderCardContext(card);

    card.createEl('div', {
      text: this.currentCard.questionText,
      cls: 'spaced-repetition-question-text',
    });

    this.renderAnswerInput(card);

    if (this.answerRevealed) {
      card.createEl('div', {
        text: this.currentCard.answerText ?? '',
        cls: 'spaced-repetition-answer-text',
      });
      this.renderCheckerResult(card);
      this.renderGradeButtons(card);
    } else {
      new Setting(card)
        .addButton((button) => {
          button
            .setButtonText('Reveal Answer')
            .setCta()
            .onClick(() => {
              this.answerRevealed = true;
              this.render();
            });
        })
        .addButton((button) => {
          button
            .setButtonText(this.checkingAnswer ? 'Checking...' : 'Check With Ollama')
            .setDisabled(this.checkingAnswer || this.currentCard?.questionType !== 'typed_llm_checked')
            .onClick(() => this.checkAnswerWithOllama());
        })
        .addButton((button) => {
          button
            .setButtonText('Skip')
            .onClick(() => this.loadNextCard());
        });
    }

    this.renderCardManagementButtons(card);
  }

  private renderEmptyState(container: HTMLElement): void {
    const empty = container.createDiv({ cls: 'spaced-repetition-empty-state' });
    empty.createEl('h3', { text: 'No due cards' });
    empty.createEl('p', { text: this.reviewMode.includeNotDue ? 'No cards matched this cram session.' : 'Add manual questions from a note or wait until scheduled cards become due.' });

    new Setting(empty)
      .addButton((button) => {
        button
          .setButtonText('Refresh')
          .onClick(async () => {
            this.dueCards = [];
            await this.loadNextCard();
          });
      });
  }

  private renderCardContext(container: HTMLElement): void {
    if (!this.currentCard) {
      return;
    }

    const parts = [
      this.getStringMetadata(this.currentCard.metadata, 'deckName'),
      this.getStringMetadata(this.currentCard.metadata, 'sourceContext'),
      this.getStringMetadata(this.currentCard.metadata, 'sourcePath'),
    ].filter((part): part is string => Boolean(part));

    if (!parts.length) {
      return;
    }

    container.createEl('div', {
      text: parts.join(' > '),
      cls: 'spaced-repetition-card-context',
    });
  }

  private renderAnswerInput(container: HTMLElement): void {
    if (!this.currentCard) {
      return;
    }

    if (this.currentCard.questionType === 'typed_exact' || this.currentCard.questionType === 'typed_llm_checked') {
      const input = container.createEl('input', {
        type: 'text',
        cls: 'spaced-repetition-answer-input',
        attr: { placeholder: 'Type answer, then reveal/check' },
      });
      input.value = this.userAnswer;
      input.addEventListener('input', () => {
        this.userAnswer = input.value;
      });
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && this.currentCard?.questionType === 'typed_llm_checked' && !this.answerRevealed) {
          event.preventDefault();
          this.checkAnswerWithOllama();
        }
      });

      if (this.currentCard.questionType === 'typed_exact' && this.answerRevealed) {
        const normalizedUser = normalizeExactAnswer(this.userAnswer);
        const normalizedExpected = normalizeExactAnswer(this.currentCard.answerText ?? '');
        container.createEl('div', {
          text: normalizedUser === normalizedExpected ? 'Exact match' : 'Different from expected answer',
          cls: normalizedUser === normalizedExpected ? 'spaced-repetition-match-ok' : 'spaced-repetition-match-different',
        });
      }
    }

    if (this.currentCard.questionType === 'typed_fields_exact') {
      const fields = this.getExactFields(this.currentCard.metadata);
      const fieldContainer = container.createDiv({ cls: 'spaced-repetition-field-inputs' });
      for (const field of fields) {
        const row = fieldContainer.createDiv({ cls: 'spaced-repetition-field-row' });
        row.createEl('label', { text: field.label, cls: 'spaced-repetition-field-label' });
        const input = row.createEl('input', {
          type: 'text',
          cls: 'spaced-repetition-answer-input spaced-repetition-field-input',
          attr: { placeholder: field.placeholder || 'Type exact value' },
        });
        input.value = this.fieldAnswers[field.id] ?? '';
        input.addEventListener('input', () => {
          this.fieldAnswers[field.id] = input.value;
        });

        if (this.answerRevealed) {
          const isMatch = matchesExactAnswerField(this.fieldAnswers[field.id] ?? '', field);
          row.createEl('div', {
            text: isMatch ? 'Match' : `Expected: ${field.answer}`,
            cls: isMatch ? 'spaced-repetition-match-ok' : 'spaced-repetition-match-different',
          });
        }
      }
    }

    if (this.currentCard.questionType === 'multiple_choice' && this.currentCard.choices?.length) {
      const choices = container.createEl('ol', { cls: 'spaced-repetition-choices' });
      for (const choice of this.currentCard.choices) {
        choices.createEl('li', { text: choice });
      }
    }
  }

  private renderCheckerResult(container: HTMLElement): void {
    if (!this.checkerResult) {
      return;
    }

    const result = container.createDiv({
      cls: this.checkerResult.isAcceptable
        ? 'spaced-repetition-checker-result spaced-repetition-checker-ok'
        : 'spaced-repetition-checker-result spaced-repetition-checker-warning',
    });
    result.createEl('div', {
      text: this.checkerResult.isAcceptable ? 'Ollama check: acceptable' : 'Ollama check: needs work',
      cls: 'spaced-repetition-checker-title',
    });
    result.createEl('div', {
      text: `Confidence: ${Math.round(this.checkerResult.confidence * 100)}%`,
      cls: 'spaced-repetition-checker-confidence',
    });
    result.createEl('div', {
      text: this.checkerResult.feedback,
      cls: 'spaced-repetition-checker-feedback',
    });

    if (this.checkerResult.correctedAnswer) {
      result.createEl('div', {
        text: `Suggested answer: ${this.checkerResult.correctedAnswer}`,
        cls: 'spaced-repetition-checker-corrected',
      });
    }
  }

  private async checkAnswerWithOllama(): Promise<void> {
    if (!this.currentCard || this.currentCard.questionType !== 'typed_llm_checked') {
      return;
    }

    if (!this.userAnswer.trim()) {
      new Notice('Type an answer first');
      return;
    }

    try {
      this.checkingAnswer = true;
      this.render();

      this.checkerResult = await this.plugin.services.answerChecker.checkWithOllama({
        questionText: this.currentCard.questionText,
        expectedAnswer: this.currentCard.answerText ?? '',
        userAnswer: this.userAnswer,
        rubric: this.getRubric(this.currentCard.metadata),
        model: this.plugin.settings.ollamaTextModel || 'gemma4:31b-cloud',
      });
      this.answerRevealed = true;
    } catch (error) {
      console.error('Failed to check answer with Ollama:', error);
      new Notice(`Failed to check answer: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      this.checkingAnswer = false;
      this.render();
    }
  }

  private renderGradeButtons(container: HTMLElement): void {
    const gradeContainer = container.createDiv({ cls: 'spaced-repetition-grade-buttons' });
    const labels: Record<ReviewGrade, string> = {
      0: '0 Again',
      1: '1 Barely',
      2: '2 Partial',
      3: '3 Good',
      4: '4 Easy',
    };

    ([0, 1, 2, 3, 4] as ReviewGrade[]).forEach((grade) => {
      const button = gradeContainer.createEl('button', {
        text: labels[grade],
        cls: `spaced-repetition-grade-button spaced-repetition-grade-${grade}`,
      });
      button.addEventListener('click', () => this.gradeCurrentCard(grade));
    });

    const laterButton = gradeContainer.createEl('button', {
      text: 'Later Today',
      cls: 'spaced-repetition-grade-button spaced-repetition-grade-later',
    });
    laterButton.addEventListener('click', () => this.gradeCurrentCardLaterToday());
  }

  private renderCardManagementButtons(container: HTMLElement): void {
    const actions = container.createDiv({ cls: 'spaced-repetition-card-management' });

    actions.createEl('button', {
      text: 'Bury Tomorrow',
      cls: 'spaced-repetition-card-management-button',
    }).addEventListener('click', () => this.buryCurrentCardUntilTomorrow());

    actions.createEl('button', {
      text: 'Suspend',
      cls: 'spaced-repetition-card-management-button spaced-repetition-card-management-danger',
    }).addEventListener('click', () => this.suspendCurrentCard());
  }

  private async gradeCurrentCard(grade: ReviewGrade): Promise<void> {
    if (!this.currentCard) {
      return;
    }

    try {
      const database = await this.plugin.services.ensureSpacedRepetitionDatabase();
      const previousState = database.getQuestionReviewState(this.currentCard.id);
      const scheduled = this.plugin.services.spacedRepetitionScheduler.scheduleReview(previousState, grade, new Date());

      await database.recordReview(
        {
          questionId: this.currentCard.id,
          grade,
          userAnswer: this.getRecordedUserAnswer(),
          checkerResult: this.checkerResult as unknown as Record<string, unknown> | null,
          elapsedMs: Date.now() - this.cardStartedAt,
        },
        scheduled
      );

      this.sessionReviewed += 1;
      await this.loadNextCard();
    } catch (error) {
      console.error('Failed to grade review card:', error);
      new Notice(`Failed to grade review card: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async gradeCurrentCardLaterToday(): Promise<void> {
    if (!this.currentCard) {
      return;
    }

    try {
      const database = await this.plugin.services.ensureSpacedRepetitionDatabase();
      const previousState = database.getQuestionReviewState(this.currentCard.id);
      const scheduled = this.plugin.services.spacedRepetitionScheduler.scheduleLaterToday(previousState, new Date());

      await database.recordReview(
        {
          questionId: this.currentCard.id,
          grade: 1,
          userAnswer: this.getRecordedUserAnswer(),
          checkerResult: this.checkerResult as unknown as Record<string, unknown> | null,
          elapsedMs: Date.now() - this.cardStartedAt,
        },
        scheduled
      );

      this.sessionReviewed += 1;
      await this.loadNextCard();
    } catch (error) {
      console.error('Failed to schedule review card for later today:', error);
      new Notice(`Failed to schedule card: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async buryCurrentCardUntilTomorrow(): Promise<void> {
    if (!this.currentCard) {
      return;
    }

    try {
      const database = await this.plugin.services.ensureSpacedRepetitionDatabase();
      await database.updateQuestionDueState({
        questionId: this.currentCard.id,
        nextRepeatAt: this.getTomorrowMorningIso(),
        shouldReask: false,
        reaskAfterCount: 0,
      });

      new Notice('Card buried until tomorrow');
      await this.loadNextCard();
    } catch (error) {
      console.error('Failed to bury review card:', error);
      new Notice(`Failed to bury card: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async suspendCurrentCard(): Promise<void> {
    if (!this.currentCard) {
      return;
    }

    try {
      const database = await this.plugin.services.ensureSpacedRepetitionDatabase();
      await database.setQuestionEnabled(this.currentCard.id, false);

      new Notice('Card suspended');
      await this.loadNextCard();
    } catch (error) {
      console.error('Failed to suspend review card:', error);
      new Notice(`Failed to suspend card: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private handleKey(event: KeyboardEvent): void {
    if (!this.currentCard || !(this.leaf as any).view || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
      return;
    }

    if (event.key === ' ' && !this.answerRevealed) {
      event.preventDefault();
      this.answerRevealed = true;
      this.render();
    }

    if (this.answerRevealed && ['0', '1', '2', '3', '4'].includes(event.key)) {
      event.preventDefault();
      this.gradeCurrentCard(Number(event.key) as ReviewGrade);
    }

    if (this.answerRevealed && event.key.toLowerCase() === 'l') {
      event.preventDefault();
      this.gradeCurrentCardLaterToday();
    }

    if (event.key.toLowerCase() === 'b') {
      event.preventDefault();
      this.buryCurrentCardUntilTomorrow();
    }

    if (event.key.toLowerCase() === 's') {
      event.preventDefault();
      this.suspendCurrentCard();
    }
  }

  private getTomorrowMorningIso(): string {
    const next = new Date();
    next.setDate(next.getDate() + 1);
    next.setHours(6, 0, 0, 0);
    return next.toISOString();
  }

  private getExactFields(metadata: Record<string, unknown>): ExactAnswerField[] {
    const raw = metadata.exactFields;
    if (!Array.isArray(raw)) {
      return [];
    }

    return raw
      .map((item, index) => normalizeExactAnswerField(item, index))
      .filter((field): field is ExactAnswerField => field !== null);
  }

  private getRecordedUserAnswer(): string | null {
    if (this.currentCard?.questionType === 'typed_fields_exact') {
      return JSON.stringify(this.fieldAnswers);
    }

    return this.userAnswer || null;
  }

  private getRubric(metadata: Record<string, unknown>): string | null {
    const rubric = metadata.rubric ?? metadata.answerRubric ?? metadata.checkRubric;
    return typeof rubric === 'string' && rubric.trim() ? rubric.trim() : null;
  }

  private getStringMetadata(metadata: Record<string, unknown>, key: string): string | null {
    const value = metadata[key];
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }
}
