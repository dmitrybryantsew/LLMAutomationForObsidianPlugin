import { App, Modal, Notice, Setting, TFile } from 'obsidian';
import type GptFreeTextGeneratorPlugin from '../main';
import { QuestionType } from '../types/spacedRepetition';

export class SpacedRepetitionGenerateQuestionsModal extends Modal {
  private plugin: GptFreeTextGeneratorPlugin;
  private sourceFile: TFile;
  private model: string;
  private questionCount = 8;
  private includeSelfCheck = true;
  private includeTypedExact = true;
  private includeMultipleChoice = false;
  private includeLlmChecked = false;
  private additionalInstructions = '';
  private isGenerating = false;

  constructor(app: App, plugin: GptFreeTextGeneratorPlugin, sourceFile: TFile) {
    super(app);
    this.plugin = plugin;
    this.sourceFile = sourceFile;
    this.model = plugin.settings.ollamaTextModel || 'gemma4:31b-cloud';
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    this.modalEl.addClass('spaced-repetition-generate-questions-modal');

    contentEl.createEl('h2', { text: 'Generate Review Questions' });
    contentEl.createEl('p', {
      text: this.sourceFile.path,
      cls: 'spaced-repetition-source-path',
    });

    new Setting(contentEl)
      .setName('Ollama Model')
      .setDesc('Used through the configured Ollama base URL.')
      .addDropdown((dropdown) => {
        const models = this.getOllamaModelOptions();
        dropdown
          .addOptions(models)
          .setValue(this.model)
          .onChange((value) => {
            this.model = value;
          });
      });

    new Setting(contentEl)
      .setName('Question Count')
      .addText((text) => {
        text
          .setValue(String(this.questionCount))
          .onChange((value) => {
            const parsed = parseInt(value, 10);
            if (!Number.isNaN(parsed) && parsed > 0) {
              this.questionCount = Math.min(parsed, 30);
            }
          });
      });

    contentEl.createEl('h3', { text: 'Question Types' });

    new Setting(contentEl)
      .setName('Self-check')
      .addToggle((toggle) => toggle.setValue(this.includeSelfCheck).onChange((value) => {
        this.includeSelfCheck = value;
      }));

    new Setting(contentEl)
      .setName('Typed exact')
      .addToggle((toggle) => toggle.setValue(this.includeTypedExact).onChange((value) => {
        this.includeTypedExact = value;
      }));

    new Setting(contentEl)
      .setName('Multiple choice')
      .addToggle((toggle) => toggle.setValue(this.includeMultipleChoice).onChange((value) => {
        this.includeMultipleChoice = value;
      }));

    new Setting(contentEl)
      .setName('LLM-checked typed')
      .setDesc('Generated now, checked during review in a later phase.')
      .addToggle((toggle) => toggle.setValue(this.includeLlmChecked).onChange((value) => {
        this.includeLlmChecked = value;
      }));

    new Setting(contentEl)
      .setName('Additional Instructions')
      .addTextArea((text) => {
        text
          .setPlaceholder('Focus on definitions, common mistakes, code details...')
          .setValue(this.additionalInstructions)
          .onChange((value) => {
            this.additionalInstructions = value;
          });
        text.inputEl.rows = 4;
      });

    new Setting(contentEl)
      .addButton((button) => {
        button
          .setButtonText('Generate And Save')
          .setCta()
          .onClick(() => this.generateAndSave());
      })
      .addButton((button) => {
        button
          .setButtonText('Cancel')
          .onClick(() => this.close());
      });
  }

  private async generateAndSave(): Promise<void> {
    if (this.isGenerating) {
      return;
    }

    const questionTypes = this.getSelectedQuestionTypes();
    if (questionTypes.length === 0) {
      new Notice('Select at least one question type');
      return;
    }

    this.isGenerating = true;
    new Notice('Generating review questions with Ollama...');

    try {
      this.plugin.settings.spacedRepetition.enabled = true;
      this.plugin.settings.defaultLLMProvider = 'ollama';
      this.plugin.settings.ollamaTextModel = this.model;
      await this.plugin.saveSettings();

      const noteContent = await this.app.vault.read(this.sourceFile);
      const database = await this.plugin.services.ensureSpacedRepetitionDatabase();
      const noteId = await database.upsertNoteFromFile(this.sourceFile, this.createContentHash(noteContent));
      const generatedQuestions = await this.plugin.services.spacedRepetitionGenerator.generateQuestionsForNote({
        file: this.sourceFile,
        noteContent,
        model: this.model,
        questionCount: this.questionCount,
        questionTypes,
        additionalInstructions: this.additionalInstructions,
        outputLanguage: this.plugin.settings.defaultOutputLanguage || 'english',
      });

      const questionIds = await database.createQuestions(generatedQuestions.map((question) => ({
        ...question,
        noteId,
      })));

      for (let index = 0; index < questionIds.length; index += 1) {
        const source = generatedQuestions[index]?.source;
        await database.recordQuestionSources(questionIds[index], [
          {
            noteId,
            sourceLabel: this.sourceFile.basename,
            sourceExcerpt: source?.sourceExcerpt,
          },
        ]);
      }

      new Notice(`Saved ${questionIds.length} review question(s)`);
      this.close();
    } catch (error) {
      console.error('Failed to generate spaced repetition questions:', error);
      new Notice(`Failed to generate questions: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      this.isGenerating = false;
    }
  }

  private getSelectedQuestionTypes(): QuestionType[] {
    const types: QuestionType[] = [];
    if (this.includeSelfCheck) types.push('self_check');
    if (this.includeTypedExact) types.push('typed_exact');
    if (this.includeMultipleChoice) types.push('multiple_choice');
    if (this.includeLlmChecked) types.push('typed_llm_checked');
    return types;
  }

  private getOllamaModelOptions(): Record<string, string> {
    const models = this.plugin.settings.ollamaModels?.length
      ? this.plugin.settings.ollamaModels
      : [this.model || 'gemma4:31b-cloud'];

    return models.reduce((acc: Record<string, string>, model) => {
      acc[model] = model;
      return acc;
    }, {});
  }

  private createContentHash(content: string): string {
    let hash = 0;
    for (let index = 0; index < content.length; index += 1) {
      hash = ((hash << 5) - hash + content.charCodeAt(index)) | 0;
    }

    return `simple_${Math.abs(hash).toString(16)}_${content.length}`;
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
