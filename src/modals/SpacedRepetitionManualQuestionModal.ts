import { App, Modal, Notice, Setting, TFile } from 'obsidian';
import type GptFreeTextGeneratorPlugin from '../main';
import { AnswerCheckMode, ExactAnswerField, QuestionType } from '../types/spacedRepetition';
import { parseExactAnswerFieldsText } from '../utils/spacedRepetition/ExactAnswerMatcher';

export class SpacedRepetitionManualQuestionModal extends Modal {
  private plugin: GptFreeTextGeneratorPlugin;
  private sourceFile: TFile;
  private questionName = '';
  private questionText = '';
  private answerText = '';
  private questionType: QuestionType = 'self_check';
  private answerCheckMode: AnswerCheckMode = 'self';

  constructor(app: App, plugin: GptFreeTextGeneratorPlugin, sourceFile: TFile) {
    super(app);
    this.plugin = plugin;
    this.sourceFile = sourceFile;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    this.modalEl.addClass('spaced-repetition-manual-question-modal');

    contentEl.createEl('h2', { text: 'Add Review Question' });
    contentEl.createEl('p', {
      text: this.sourceFile.path,
      cls: 'spaced-repetition-source-path',
    });

    new Setting(contentEl)
      .setName('Question Name')
      .setDesc('Optional short label for finding this card later.')
      .addText((text) => {
        text
          .setPlaceholder('Main definition')
          .setValue(this.questionName)
          .onChange((value) => {
            this.questionName = value;
          });
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
          });
      });

    new Setting(contentEl)
      .setName('Question')
      .addTextArea((text) => {
        text
          .setPlaceholder('What should I remember?')
          .setValue(this.questionText)
          .onChange((value) => {
            this.questionText = value;
          });
        text.inputEl.rows = 4;
      });

    new Setting(contentEl)
      .setName('Answer')
      .setDesc('For typed exact fields, use one Label::Answer per line. Add optional JSON settings after a second ::.')
      .addTextArea((text) => {
        text
          .setPlaceholder('Expected answer')
          .setValue(this.answerText)
          .onChange((value) => {
            this.answerText = value;
          });
        text.inputEl.rows = 4;
      });

    new Setting(contentEl)
      .addButton((button) => {
        button
          .setButtonText('Save Question')
          .setCta()
          .onClick(() => this.saveQuestion());
      })
      .addButton((button) => {
        button
          .setButtonText('Cancel')
          .onClick(() => this.close());
      });
  }

  private async saveQuestion(): Promise<void> {
    if (!this.questionText.trim()) {
      new Notice('Question text is required');
      return;
    }

    if (!this.answerText.trim()) {
      new Notice('Answer text is required');
      return;
    }

    const exactFields = this.questionType === 'typed_fields_exact'
      ? this.parseExactFields(this.answerText)
      : [];
    if (this.questionType === 'typed_fields_exact' && exactFields.length === 0) {
      new Notice('Add at least one exact field as Label::Answer');
      return;
    }

    try {
      this.plugin.settings.spacedRepetition.enabled = true;
      await this.plugin.saveSettings();

      const database = await this.plugin.services.ensureSpacedRepetitionDatabase();
      const noteId = await database.upsertNoteFromFile(this.sourceFile);
      const metadata = this.questionType === 'typed_fields_exact'
        ? { exactFields }
        : {};
      await database.createQuestions([
        {
          noteId,
          questionName: this.questionName.trim() || null,
          questionText: this.questionText.trim(),
          questionType: this.questionType,
          answerText: this.answerText.trim(),
          answerCheckMode: this.answerCheckMode,
          metadata,
        },
      ]);

      new Notice('Review question saved');
      this.close();
    } catch (error) {
      console.error('Failed to save review question:', error);
      new Notice(`Failed to save review question: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private parseExactFields(value: string): ExactAnswerField[] {
    return parseExactAnswerFieldsText(value);
  }
}
