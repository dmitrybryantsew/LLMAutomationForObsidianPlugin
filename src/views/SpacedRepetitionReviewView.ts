import { ItemView, Notice, Setting, WorkspaceLeaf } from 'obsidian';
import type GptFreeTextGeneratorPlugin from '../main';
import { VIEW_TYPE_SPACED_REPETITION_REVIEW } from '../constants';
import { DueQuestionRecord } from '../utils/spacedRepetition/SpacedRepetitionDatabase';
import { ReviewGrade } from '../types/spacedRepetition';

export class SpacedRepetitionReviewView extends ItemView {
  private plugin: GptFreeTextGeneratorPlugin;
  private dueCards: DueQuestionRecord[] = [];
  private currentCard: DueQuestionRecord | null = null;
  private answerRevealed = false;
  private userAnswer = '';
  private sessionReviewed = 0;
  private cardStartedAt = Date.now();
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
    this.dueCards = database.getDueQuestions(new Date(), this.plugin.settings.spacedRepetition.maxReviewCardsPerSession);
  }

  private async loadNextCard(): Promise<void> {
    if (this.dueCards.length === 0) {
      await this.loadDueCards();
    }

    this.currentCard = this.dueCards.shift() ?? null;
    this.answerRevealed = false;
    this.userAnswer = '';
    this.cardStartedAt = Date.now();
    this.render();
  }

  private render(): void {
    const container = this.contentEl;
    container.empty();

    const header = container.createDiv({ cls: 'spaced-repetition-review-header' });
    header.createEl('h2', { text: 'Review' });
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
            .setButtonText('Skip')
            .onClick(() => this.loadNextCard());
        });
    }
  }

  private renderEmptyState(container: HTMLElement): void {
    const empty = container.createDiv({ cls: 'spaced-repetition-empty-state' });
    empty.createEl('h3', { text: 'No due cards' });
    empty.createEl('p', { text: 'Add manual questions from a note or wait until scheduled cards become due.' });

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

  private renderAnswerInput(container: HTMLElement): void {
    if (!this.currentCard) {
      return;
    }

    if (this.currentCard.questionType === 'typed_exact') {
      const input = container.createEl('input', {
        type: 'text',
        cls: 'spaced-repetition-answer-input',
        attr: { placeholder: 'Type answer, then reveal/check' },
      });
      input.value = this.userAnswer;
      input.addEventListener('input', () => {
        this.userAnswer = input.value;
      });

      if (this.answerRevealed) {
        const normalizedUser = this.normalizeAnswer(this.userAnswer);
        const normalizedExpected = this.normalizeAnswer(this.currentCard.answerText ?? '');
        container.createEl('div', {
          text: normalizedUser === normalizedExpected ? 'Exact match' : 'Different from expected answer',
          cls: normalizedUser === normalizedExpected ? 'spaced-repetition-match-ok' : 'spaced-repetition-match-different',
        });
      }
    }

    if (this.currentCard.questionType === 'multiple_choice' && this.currentCard.choices?.length) {
      const choices = container.createEl('ol', { cls: 'spaced-repetition-choices' });
      for (const choice of this.currentCard.choices) {
        choices.createEl('li', { text: choice });
      }
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
          userAnswer: this.userAnswer || null,
          checkerResult: null,
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
  }

  private normalizeAnswer(value: string): string {
    return value.trim().toLowerCase().replace(/\s+/g, ' ');
  }
}
