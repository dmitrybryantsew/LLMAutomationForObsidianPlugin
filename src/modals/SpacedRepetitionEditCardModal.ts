import { App, Modal, Notice, Setting } from 'obsidian';
import { GeneratedSpacedRepetitionQuestion } from '../utils/spacedRepetition/SpacedRepetitionGenerator';
import { AnswerCheckMode, ExactAnswerField, QuestionType } from '../types/spacedRepetition';
import { parseExactAnswerFieldsText } from '../utils/spacedRepetition/ExactAnswerMatcher';

export class SpacedRepetitionEditCardModal extends Modal {
  private question: GeneratedSpacedRepetitionQuestion;
  private onSave: (updated: GeneratedSpacedRepetitionQuestion) => Promise<void>;
  private questionName: string;
  private questionText: string;
  private answerText: string;
  private questionType: QuestionType;
  private answerCheckMode: AnswerCheckMode;
  private choiceTexts: string[];
  private correctChoiceIndex: number;

  constructor(
    app: App,
    question: GeneratedSpacedRepetitionQuestion,
    onSave: (updated: GeneratedSpacedRepetitionQuestion) => Promise<void>,
  ) {
    super(app);
    this.question = question;
    this.onSave = onSave;
    this.questionName = question.questionName || '';
    this.questionText = question.questionText;
    this.answerText = question.answerText || '';
    this.questionType = question.questionType;
    this.answerCheckMode = question.answerCheckMode;
    this.choiceTexts = question.choices ? [...question.choices, ...Array(4 - question.choices.length).fill('')].slice(0, 4) : ['', '', '', ''];
    this.correctChoiceIndex = 0;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    this.modalEl.addClass('spaced-repetition-edit-card-modal');

    contentEl.createEl('h2', { text: 'Edit Card' });

    new Setting(contentEl)
      .setName('Question Name')
      .addText((text) => {
        text
          .setValue(this.questionName)
          .onChange((value) => { this.questionName = value; });
      });

    new Setting(contentEl)
      .setName('Question Type')
      .addDropdown((dropdown) => {
        dropdown
          .addOptions({
            self_check: 'Self-check',
            typed_exact: 'Typed exact',
            typed_fields_exact: 'Typed exact fields',
            multiple_choice: 'Multiple choice',
          })
          .setValue(this.questionType)
          .onChange((value) => {
            this.questionType = value as QuestionType;
            this.answerCheckMode = this.questionType === 'typed_exact' || this.questionType === 'typed_fields_exact' ? 'exact' : 'self';
            this.render();
          });
      });

    new Setting(contentEl)
      .setName('Question')
      .addTextArea((text) => {
        text
          .setValue(this.questionText)
          .onChange((value) => { this.questionText = value; });
        text.inputEl.rows = 3;
      });

    if (this.questionType === 'multiple_choice') {
      contentEl.createEl('h4', { text: 'Choices' });
      for (let i = 0; i < 4; i += 1) {
        new Setting(contentEl)
          .addText((text) => {
            text
              .setPlaceholder(`Choice ${i + 1}`)
              .setValue(this.choiceTexts[i])
              .onChange((value) => { this.choiceTexts[i] = value; });
          })
          .addToggle((toggle) => {
            toggle
              .setValue(this.correctChoiceIndex === i)
              .onChange((value) => { if (value) this.correctChoiceIndex = i; });
          });
      }
    } else {
      new Setting(contentEl)
        .setName('Answer')
        .addTextArea((text) => {
          text
            .setValue(this.answerText)
            .onChange((value) => { this.answerText = value; });
          text.inputEl.rows = 3;
        });
    }

    new Setting(contentEl)
      .addButton((button) => {
        button
          .setButtonText('Save Changes')
          .setCta()
          .onClick(() => this.saveChanges());
      })
      .addButton((button) => {
        button
          .setButtonText('Cancel')
          .onClick(() => this.close());
      });
  }

  private render(): void {
    this.onOpen();
  }

  private async saveChanges(): Promise<void> {
    if (!this.questionText.trim()) {
      new Notice('Question text is required');
      return;
    }

    let answerText = '';
    let choices: string[] | null = null;

    if (this.questionType === 'multiple_choice') {
      const filled = this.choiceTexts.filter((c) => c.trim());
      if (filled.length < 2) {
        new Notice('Multiple choice needs at least 2 filled choices');
        return;
      }
      if (!this.choiceTexts[this.correctChoiceIndex]?.trim()) {
        new Notice('The correct choice cannot be empty');
        return;
      }
      choices = this.choiceTexts.filter((c) => c.trim());
      answerText = this.choiceTexts[this.correctChoiceIndex]?.trim() || '';
    } else {
      if (!this.answerText.trim()) {
        new Notice('Answer text is required');
        return;
      }
      answerText = this.answerText.trim();
    }

    const exactFields: ExactAnswerField[] | undefined = this.questionType === 'typed_fields_exact'
      ? parseExactAnswerFieldsText(this.answerText)
      : undefined;
    if (this.questionType === 'typed_fields_exact' && (!exactFields || exactFields.length === 0)) {
      new Notice('Add at least one exact field as Label::Answer');
      return;
    }

    const updated: GeneratedSpacedRepetitionQuestion = {
      ...this.question,
      questionName: this.questionName.trim() || null,
      questionText: this.questionText.trim(),
      answerText,
      questionType: this.questionType,
      answerCheckMode: this.answerCheckMode,
      choices,
      metadata: {
        ...(this.question.metadata ?? {}),
        ...(exactFields ? { exactFields } : {}),
      },
    };

    await this.onSave(updated);
    this.close();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
