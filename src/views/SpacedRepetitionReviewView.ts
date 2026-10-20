import { ItemView, Notice, Setting, WorkspaceLeaf } from 'obsidian';
import type GptFreeTextGeneratorPlugin from '../main';
import { VIEW_TYPE_SPACED_REPETITION_REVIEW } from '../constants';
import { DueQuestionRecord } from '../utils/spacedRepetition/SpacedRepetitionDatabase';
import { AnswerCheckerResult, ExactAnswerField, ReviewGrade } from '../types/spacedRepetition';
import { matchesExactAnswerField, normalizeExactAnswer, normalizeExactAnswerField } from '../utils/spacedRepetition/ExactAnswerMatcher';
import { shuffleReviewCards } from '../utils/spacedRepetition/SpacedRepetitionScheduler';
import { computeCharDiff, renderDiffToElement } from '../utils/spacedRepetition/DiffHelper';

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
  private selectedChoiceIndex: number | null = null;
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
    const randomize = this.plugin.settings.spacedRepetition.randomizeCardOrder ?? true;
    const cards = database.getReviewQuestions({
      now: new Date(),
      limit: this.plugin.settings.spacedRepetition.maxReviewCardsPerSession,
      includeNotDue: this.reviewMode.includeNotDue,
      noteId: this.reviewMode.noteId,
      studySetId: this.reviewMode.studySetId,
      randomize,
    });
    this.dueCards = randomize ? shuffleReviewCards(cards) : cards;
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
    this.selectedChoiceIndex = null;
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

    if (this.plugin.isFlashcardUiActive()) {
      header.createEl('button', {
        text: 'Back to Hub',
        cls: 'llm-automation-btn llm-automation-btn-secondary spaced-repetition-back-to-hub',
        attr: { 'aria-label': 'Return to the flashcard hub' },
      }).addEventListener('click', () => {
        void this.plugin.returnToFlashcardHub();
      });
    }

    if (this.dueCards.length > 1) {
      header.createEl('button', {
        text: 'Shuffle',
        cls: 'llm-automation-btn llm-automation-btn-secondary spaced-repetition-shuffle-btn',
        attr: { 'aria-label': 'Shuffle remaining cards in queue' },
      }).addEventListener('click', () => {
        this.dueCards = shuffleReviewCards(this.dueCards);
        new Notice('Remaining cards shuffled');
      });
    }

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

    if (this.answerRevealed || this.checkingAnswer) {
      if (this.answerRevealed) {
        card.createEl('div', {
          text: this.currentCard.answerText ?? '',
          cls: 'spaced-repetition-answer-text',
        });
      }
      this.renderCheckerResult(card);
      if (this.answerRevealed) {
        this.renderGradeButtons(card);
      }
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
    this.renderKeyboardHints(card);
  }

  private renderEmptyState(container: HTMLElement): void {
    const empty = container.createDiv({ cls: 'spaced-repetition-empty-state' });

    const emoji = empty.createDiv({ cls: 'spaced-repetition-empty-emoji' });
    emoji.textContent = '✓';
    emoji.setAttribute('aria-hidden', 'true');

    empty.createEl('h3', { text: this.reviewMode.includeNotDue ? 'No cards matched' : 'All caught up!' });
    empty.createEl('p', {
      text: this.reviewMode.includeNotDue
        ? 'No cards matched this cram session. Try different filters or generate new cards.'
        : 'Nothing is due right now. Come back later or start a cram session to review ahead.',
      cls: 'spaced-repetition-empty-hint',
    });

    new Setting(empty)
      .addButton((button) => {
        button
          .setButtonText('Refresh')
          .onClick(async () => {
            this.dueCards = [];
            await this.loadNextCard();
          });
        button.buttonEl.addClass('llm-automation-btn', 'llm-automation-btn-secondary');
      })
      .addButton((button) => {
        button
          .setButtonText('Cram All')
          .onClick(() => this.plugin.activateReviewView({
            title: 'Cram: All Cards',
            includeNotDue: true,
          }));
        button.buttonEl.addClass('llm-automation-btn', 'llm-automation-btn-secondary');
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

    if (this.currentCard.questionType === 'typed_exact') {
      const inputWrapper = container.createDiv({ cls: 'spaced-repetition-input-wrapper' });
      const input = inputWrapper.createEl('input', {
        type: 'text',
        cls: 'spaced-repetition-answer-input spaced-repetition-answer-input-mono',
        attr: { placeholder: 'Type exact answer, then press Enter or Reveal' },
      });
      input.value = this.userAnswer;
      input.addEventListener('input', () => {
        this.userAnswer = input.value;
      });
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !this.answerRevealed) {
          event.preventDefault();
          this.answerRevealed = true;
          this.render();
        }
      });

      if (!this.answerRevealed) {
        setTimeout(() => input.focus(), 30);
      } else {
        input.disabled = true;
        const normalizedUser = normalizeExactAnswer(this.userAnswer);
        const normalizedExpected = normalizeExactAnswer(this.currentCard.answerText ?? '');
        const isMatch = normalizedUser === normalizedExpected;
        input.addClass(isMatch ? 'spaced-repetition-input-valid' : 'spaced-repetition-input-invalid');

        const resultBanner = container.createDiv({
          cls: `spaced-repetition-diff-result ${isMatch ? 'spaced-repetition-match-ok' : 'spaced-repetition-match-different'}`,
        });

        if (isMatch) {
          resultBanner.createSpan({ text: '✓ Exact match', cls: 'spaced-repetition-match-badge' });
        } else {
          resultBanner.createSpan({ text: '✗ Different from expected', cls: 'spaced-repetition-match-badge' });
          const diffBox = resultBanner.createDiv({ cls: 'spaced-repetition-diff-box' });
          diffBox.createDiv({ text: 'Detailed difference:', cls: 'spaced-repetition-diff-label' });
          const chunks = computeCharDiff(this.userAnswer, this.currentCard.answerText ?? '');
          renderDiffToElement(diffBox, chunks);
          diffBox.createDiv({
            text: 'Legend: Green = matched, Red strikethrough = extra typed, Yellow wavy = missing expected',
            cls: 'spaced-repetition-diff-legend',
          });
        }
      }
    }

    if (this.currentCard.questionType === 'typed_fields_exact') {
      const fields = this.getExactFields(this.currentCard.metadata);
      const fieldContainer = container.createDiv({ cls: 'spaced-repetition-field-inputs' });
      const fieldInputs: HTMLInputElement[] = [];

      if (this.answerRevealed) {
        let matchedFieldsCount = 0;
        for (const field of fields) {
          if (matchesExactAnswerField(this.fieldAnswers[field.id] ?? '', field)) {
            matchedFieldsCount++;
          }
        }
        const scoreBanner = fieldContainer.createDiv({
          cls: `spaced-repetition-fields-score ${matchedFieldsCount === fields.length ? 'spaced-repetition-match-ok' : 'spaced-repetition-match-different'}`,
        });
        scoreBanner.createSpan({
          text: `${matchedFieldsCount} / ${fields.length} fields correct`,
          cls: 'spaced-repetition-score-badge',
        });
      }

      fields.forEach((field, index) => {
        const row = fieldContainer.createDiv({ cls: 'spaced-repetition-field-row' });
        const labelRow = row.createDiv({ cls: 'spaced-repetition-field-label-row' });
        labelRow.createEl('label', { text: field.label, cls: 'spaced-repetition-field-label' });

        const input = row.createEl('input', {
          type: 'text',
          cls: 'spaced-repetition-answer-input spaced-repetition-field-input spaced-repetition-answer-input-mono',
          attr: { placeholder: field.placeholder || `Type ${field.label}` },
        });
        input.value = this.fieldAnswers[field.id] ?? '';
        fieldInputs.push(input);

        input.addEventListener('input', () => {
          this.fieldAnswers[field.id] = input.value;
        });

        input.addEventListener('keydown', (event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            if (index < fields.length - 1) {
              fieldInputs[index + 1]?.focus();
            } else if (!this.answerRevealed) {
              this.answerRevealed = true;
              this.render();
            }
          }
        });

        if (this.answerRevealed) {
          input.disabled = true;
          const isMatch = matchesExactAnswerField(this.fieldAnswers[field.id] ?? '', field);
          input.addClass(isMatch ? 'spaced-repetition-input-valid' : 'spaced-repetition-input-invalid');

          const statusEl = row.createDiv({ cls: 'spaced-repetition-field-status' });
          if (isMatch) {
            statusEl.createSpan({ text: '✓ Match', cls: 'spaced-repetition-match-ok' });
          } else {
            statusEl.createSpan({ text: '✗ Expected: ', cls: 'spaced-repetition-match-different' });
            statusEl.createEl('code', { text: field.answer, cls: 'spaced-repetition-expected-code' });
            if (this.fieldAnswers[field.id]?.trim()) {
              const diffLine = statusEl.createDiv({ cls: 'spaced-repetition-field-diff' });
              renderDiffToElement(diffLine, computeCharDiff(this.fieldAnswers[field.id], field.answer));
            }
          }
        }
      });

      if (!this.answerRevealed && fieldInputs.length > 0) {
        setTimeout(() => fieldInputs[0]?.focus(), 30);
      }
    }

    if (this.currentCard.questionType === 'typed_llm_checked') {
      const textareaWrapper = container.createDiv({ cls: 'spaced-repetition-textarea-wrapper' });
      const textarea = textareaWrapper.createEl('textarea', {
        cls: 'spaced-repetition-answer-input spaced-repetition-answer-textarea',
        attr: {
          placeholder: 'Type your explanation or response here...\n(Press Ctrl+Enter or Cmd+Enter to evaluate with Ollama)',
          rows: '3',
        },
      });
      textarea.value = this.userAnswer;
      textarea.addEventListener('input', () => {
        this.userAnswer = textarea.value;
      });

      textarea.addEventListener('keydown', (event) => {
        if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !this.answerRevealed && !this.checkingAnswer) {
          event.preventDefault();
          this.checkAnswerWithOllama();
        }
      });

      if (!this.answerRevealed && !this.checkingAnswer) {
        setTimeout(() => textarea.focus(), 30);
      } else if (this.answerRevealed) {
        textarea.disabled = true;
      }
    }

    if (this.currentCard.questionType === 'multiple_choice' && this.currentCard.choices?.length) {
      const choicesContainer = container.createDiv({ cls: 'spaced-repetition-choices-list' });
      const optionLetters = ['A', 'B', 'C', 'D', 'E', 'F'];
      const expectedAnswerText = (this.currentCard.answerText ?? '').trim().toLowerCase();

      this.currentCard.choices.forEach((choice, index) => {
        const letter = optionLetters[index] ?? String(index + 1);
        const isSelected = this.selectedChoiceIndex === index;
        const normalizedChoice = choice.trim().toLowerCase();
        const isCorrectChoice = normalizedChoice === expectedAnswerText;

        const choiceCard = choicesContainer.createDiv({
          cls: 'spaced-repetition-choice-card',
        });

        if (!this.answerRevealed) {
          if (isSelected) {
            choiceCard.addClass('spaced-repetition-choice-selected');
          }
          choiceCard.addEventListener('click', () => {
            this.selectedChoiceIndex = index;
            this.render();
          });
        } else {
          choiceCard.addClass('spaced-repetition-choice-revealed');
          if (isCorrectChoice) {
            choiceCard.addClass('spaced-repetition-choice-correct');
          } else if (isSelected) {
            choiceCard.addClass('spaced-repetition-choice-incorrect');
          } else {
            choiceCard.addClass('spaced-repetition-choice-dimmed');
          }
        }

        choiceCard.createSpan({
          text: letter,
          cls: 'spaced-repetition-choice-key',
        });

        choiceCard.createSpan({
          text: choice,
          cls: 'spaced-repetition-choice-text',
        });

        if (this.answerRevealed) {
          if (isCorrectChoice) {
            choiceCard.createSpan({
              text: '✓ Correct',
              cls: 'spaced-repetition-choice-badge spaced-repetition-choice-badge-correct',
            });
          } else if (isSelected) {
            choiceCard.createSpan({
              text: '✗ Selected',
              cls: 'spaced-repetition-choice-badge spaced-repetition-choice-badge-incorrect',
            });
          }
        }
      });
    }
  }

  private renderCheckerResult(container: HTMLElement): void {
    if (this.checkingAnswer) {
      const loading = container.createDiv({ cls: 'spaced-repetition-checker-loading' });
      loading.createSpan({ cls: 'spaced-repetition-spinner' });
      loading.createSpan({ text: 'Evaluating your answer with Ollama...', cls: 'spaced-repetition-loading-text' });
      return;
    }

    if (!this.checkerResult) {
      return;
    }

    const isAcceptable = this.checkerResult.isAcceptable;
    const resultCard = container.createDiv({
      cls: `spaced-repetition-checker-result ${isAcceptable ? 'spaced-repetition-checker-ok' : 'spaced-repetition-checker-warning'}`,
    });

    const header = resultCard.createDiv({ cls: 'spaced-repetition-checker-header' });
    header.createSpan({
      text: isAcceptable ? '✓ Ollama: Acceptable' : '⚠ Ollama: Needs Work',
      cls: 'spaced-repetition-checker-title',
    });

    const confidencePct = Math.round(this.checkerResult.confidence * 100);
    header.createSpan({
      text: `${confidencePct}% confidence`,
      cls: `spaced-repetition-confidence-badge ${confidencePct >= 70 ? 'confidence-high' : 'confidence-medium'}`,
    });

    const barContainer = resultCard.createDiv({ cls: 'spaced-repetition-confidence-bar' });
    const fill = barContainer.createDiv({ cls: 'spaced-repetition-confidence-fill' });
    fill.style.width = `${Math.max(5, Math.min(100, confidencePct))}%`;
    if (!isAcceptable) fill.addClass('confidence-warning');

    resultCard.createDiv({
      text: this.checkerResult.feedback,
      cls: 'spaced-repetition-checker-feedback',
    });

    if (this.checkerResult.correctedAnswer) {
      const correctedBox = resultCard.createDiv({ cls: 'spaced-repetition-checker-corrected' });
      correctedBox.createEl('div', { text: 'Suggested Answer / Key Points:', cls: 'spaced-repetition-corrected-label' });
      correctedBox.createEl('div', { text: this.checkerResult.correctedAnswer, cls: 'spaced-repetition-corrected-text' });
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
      cls: 'llm-automation-btn llm-automation-btn-muted spaced-repetition-card-management-button',
    }).addEventListener('click', () => this.buryCurrentCardUntilTomorrow());

    actions.createEl('button', {
      text: 'Suspend',
      cls: 'llm-automation-btn llm-automation-btn-muted spaced-repetition-card-management-button spaced-repetition-card-management-danger',
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
    if (!this.currentCard) {
      return;
    }

    if (this.app.workspace.activeLeaf?.view !== this) {
      return;
    }

    if (event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }

    const target = event.target as HTMLElement | null;
    if (target instanceof HTMLInputElement
      || target instanceof HTMLTextAreaElement
      || (target instanceof HTMLElement && target.isContentEditable)) {
      return;
    }

    // Multiple choice option selection with 1-4 or A-D
    if (!this.answerRevealed && this.currentCard.questionType === 'multiple_choice' && this.currentCard.choices?.length) {
      const num = parseInt(event.key, 10);
      if (!Number.isNaN(num) && num >= 1 && num <= this.currentCard.choices.length) {
        event.preventDefault();
        this.selectedChoiceIndex = num - 1;
        this.render();
        return;
      }
      const charCode = event.key.toUpperCase().charCodeAt(0);
      if (event.key.length === 1 && charCode >= 65 && charCode < 65 + this.currentCard.choices.length) {
        event.preventDefault();
        this.selectedChoiceIndex = charCode - 65;
        this.render();
        return;
      }
    }

    if ((event.key === ' ' || event.key === 'Enter') && !this.answerRevealed) {
      event.preventDefault();
      this.answerRevealed = true;
      this.render();
      return;
    }

    if (this.answerRevealed && ['0', '1', '2', '3', '4'].includes(event.key)) {
      event.preventDefault();
      this.gradeCurrentCard(Number(event.key) as ReviewGrade);
      return;
    }

    if (this.answerRevealed && event.key.toLowerCase() === 'l') {
      event.preventDefault();
      this.gradeCurrentCardLaterToday();
      return;
    }

    if (event.key.toLowerCase() === 'b') {
      event.preventDefault();
      this.buryCurrentCardUntilTomorrow();
      return;
    }

    if (event.key.toLowerCase() === 's') {
      event.preventDefault();
      this.suspendCurrentCard();
      return;
    }
  }

  private renderKeyboardHints(container: HTMLElement): void {
    if (!this.currentCard) {
      return;
    }

    const footer = container.createDiv({ cls: 'spaced-repetition-shortcuts-hint' });

    if (!this.answerRevealed) {
      if (this.currentCard.questionType === 'multiple_choice') {
        footer.setText('[1–4 / A–D] Select Option  •  [Space / Enter] Reveal Answer  •  [S] Suspend  •  [B] Bury');
      } else if (this.currentCard.questionType === 'typed_exact') {
        footer.setText('[Enter] Reveal & Compare  •  [S] Suspend  •  [B] Bury');
      } else if (this.currentCard.questionType === 'typed_fields_exact') {
        footer.setText('[Tab / Enter] Next Field  •  [Enter on last] Reveal  •  [S] Suspend  •  [B] Bury');
      } else if (this.currentCard.questionType === 'typed_llm_checked') {
        footer.setText('[Ctrl+Enter] Evaluate with Ollama  •  [Space] Reveal  •  [S] Suspend  •  [B] Bury');
      } else {
        footer.setText('[Space / Enter] Reveal Answer  •  [S] Suspend  •  [B] Bury');
      }
    } else {
      footer.setText('[0] Again  •  [1] Barely  •  [2] Partial  •  [3] Good  •  [4] Easy  •  [L] Later Today');
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
    if (this.currentCard?.questionType === 'multiple_choice' && this.selectedChoiceIndex !== null && this.currentCard.choices) {
      return this.currentCard.choices[this.selectedChoiceIndex] ?? null;
    }

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
