import { App, Modal, Notice, Setting, TFile } from 'obsidian';
import type GptFreeTextGeneratorPlugin from '../main';
import { AnswerCheckMode, ExactAnswerField, QuestionType, SpacedRepetitionStudySetRecord } from '../types/spacedRepetition';
import { parseExactAnswerFieldsText } from '../utils/spacedRepetition/ExactAnswerMatcher';

export class SpacedRepetitionManualQuestionModal extends Modal {
  private plugin: GptFreeTextGeneratorPlugin;
  private sourceFile: TFile;
  private questionName = '';
  private questionText = '';
  private answerText = '';
  private questionType: QuestionType = 'self_check';
  private answerCheckMode: AnswerCheckMode = 'self';
  private studySets: SpacedRepetitionStudySetRecord[] = [];
  private selectedStudySetId = '';
  private newDeckName = '';
  private choiceTexts = ['', '', '', ''];
  private correctChoiceIndex = 0;
  private keepOpenAfterSave = false;

  constructor(app: App, plugin: GptFreeTextGeneratorPlugin, sourceFile: TFile) {
    super(app);
    this.plugin = plugin;
    this.sourceFile = sourceFile;
  }

  async onOpen(): Promise<void> {
    const { contentEl } = this;
    contentEl.empty();
    this.modalEl.addClass('spaced-repetition-manual-question-modal');

    contentEl.createEl('h2', { text: 'Add Review Question' });
    contentEl.createEl('p', {
      text: this.sourceFile.path,
      cls: 'spaced-repetition-source-path',
    });

    await this.loadStudySets();
    this.render();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private async loadStudySets(): Promise<void> {
    const database = await this.plugin.services.ensureSpacedRepetitionDatabase();
    this.studySets = database.getStudySets().filter((set) => set.enabled);
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();

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
            if (this.questionType === 'multiple_choice') {
              this.answerCheckMode = 'self';
            }
            this.render();
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

    if (this.questionType === 'multiple_choice') {
      contentEl.createEl('h4', { text: 'Choices (mark the correct one)' });
      for (let i = 0; i < 4; i += 1) {
        new Setting(contentEl)
          .addText((text) => {
            text
              .setPlaceholder(`Choice ${i + 1}`)
              .setValue(this.choiceTexts[i])
              .onChange((value) => {
                this.choiceTexts[i] = value;
              });
          })
          .addToggle((toggle) => {
            toggle
              .setValue(this.correctChoiceIndex === i)
              .onChange((value) => {
                if (value) {
                  this.correctChoiceIndex = i;
                }
              });
          });
      }
    } else {
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
    }

    // Deck / Study Set selector
    const deckSetting = new Setting(contentEl)
      .setName('Deck')
      .setDesc('Which deck to add this question to.');

    if (this.studySets.length > 0) {
      deckSetting.addDropdown((dropdown) => {
        dropdown.addOption('', 'No deck');
        for (const set of this.studySets) {
          dropdown.addOption(set.id, set.name);
        }
        dropdown
          .setValue(this.selectedStudySetId)
          .onChange((value) => {
            this.selectedStudySetId = value;
          });
      });
    } else {
      deckSetting.setDesc('No decks available. Create one below or generate cards first.');
    }

    new Setting(contentEl)
      .setName('New Deck Name')
      .setDesc('Create a new deck for this question.')
      .addText((text) => {
        text
          .setPlaceholder('My Deck')
          .setValue(this.newDeckName)
          .onChange((value) => {
            this.newDeckName = value.trim();
          });
      });

    new Setting(contentEl)
      .setName('Keep Open')
      .setDesc('Stay open to add another question after saving.')
      .addToggle((toggle) => {
        toggle.setValue(this.keepOpenAfterSave).onChange((value) => {
          this.keepOpenAfterSave = value;
        });
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

    if (this.questionType === 'multiple_choice') {
      const filledChoices = this.choiceTexts.filter((c) => c.trim());
      if (filledChoices.length < 2) {
        new Notice('Multiple choice needs at least 2 filled choices');
        return;
      }
      if (!this.choiceTexts[this.correctChoiceIndex]?.trim()) {
        new Notice('The correct choice cannot be empty');
        return;
      }
    } else if (!this.answerText.trim()) {
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

      let studySetId: string | null = this.selectedStudySetId || null;
      let deckName: string | null = null;

      if (this.newDeckName) {
        const newSetId = await database.createStudySet({
          name: this.newDeckName,
          sourceType: 'manual',
          sourceRule: {},
          tags: [],
        });
        studySetId = newSetId;
        this.selectedStudySetId = newSetId;  // persist so Keep Open assigns to the new deck
        deckName = this.newDeckName;
        this.newDeckName = '';
      } else if (studySetId) {
        deckName = this.studySets.find((set) => set.id === studySetId)?.name ?? null;
      }

      const metadata: Record<string, unknown> = this.questionType === 'typed_fields_exact'
        ? { exactFields }
        : {};
      if (deckName) {
        metadata.deckName = deckName;
      }

      const choices = this.questionType === 'multiple_choice'
        ? this.choiceTexts.filter((c) => c.trim())
        : null;
      const answerText = this.questionType === 'multiple_choice'
        ? this.choiceTexts[this.correctChoiceIndex]?.trim() || ''
        : this.answerText.trim();

      await database.createQuestions([
        {
          noteId,
          studySetId,
          questionName: this.questionName.trim() || null,
          questionText: this.questionText.trim(),
          questionType: this.questionType,
          answerText,
          choices,
          answerCheckMode: this.answerCheckMode,
          metadata,
        },
      ]);

      new Notice('Review question saved');

      if (this.keepOpenAfterSave) {
        this.questionName = '';
        this.questionText = '';
        this.answerText = '';
        this.choiceTexts = ['', '', '', ''];
        this.correctChoiceIndex = 0;
        await this.loadStudySets();
        this.render();
      } else {
        this.close();
      }
    } catch (error) {
      console.error('Failed to save review question:', error);
      new Notice(`Failed to save review question: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private parseExactFields(value: string): ExactAnswerField[] {
    return parseExactAnswerFieldsText(value);
  }
}
