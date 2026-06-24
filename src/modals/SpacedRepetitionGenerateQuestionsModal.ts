import { App, Modal, Notice, Setting, TFile } from 'obsidian';
import type GptFreeTextGeneratorPlugin from '../main';
import { QuestionType } from '../types/spacedRepetition';
import { TextProviderId, TEXT_PROVIDER_LABELS } from '../types/providers';

export class SpacedRepetitionGenerateQuestionsModal extends Modal {
  private plugin: GptFreeTextGeneratorPlugin;
  private sourceFile: TFile;
  private model: string;
  private provider: TextProviderId;
  private questionCount = 8;
  private includeSelfCheck = true;
  private includeTypedExact = true;
  private includeTypedFieldsExact = false;
  private includeMultipleChoice = false;
  private includeLlmChecked = false;
  private additionalInstructions = '';
  private isGenerating = false;

  constructor(app: App, plugin: GptFreeTextGeneratorPlugin, sourceFile: TFile) {
    super(app);
    this.plugin = plugin;
    this.sourceFile = sourceFile;
    this.provider = plugin.settings.spacedRepetitionGenerationProvider as TextProviderId
      || plugin.settings.defaultLLMProvider as TextProviderId;
    this.model = plugin.settings.spacedRepetitionGenerationModel
      || this.getDefaultModelForProvider(this.provider);
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
      .setName('Provider')
      .addDropdown((dropdown) => {
        dropdown
          .addOptions(TEXT_PROVIDER_LABELS)
          .setValue(this.provider)
          .onChange(async (value) => {
            const newProvider = value as TextProviderId;
            this.provider = newProvider;
            this.plugin.settings.spacedRepetitionGenerationProvider = newProvider;
            this.model = this.getDefaultModelForProvider(newProvider);
            await this.plugin.saveSettings();
            this.onOpen();
          });
      });

    new Setting(contentEl)
      .setName('Model')
      .addDropdown((dropdown) => {
        dropdown
          .addOptions(this.getModelOptionsForProvider(this.provider))
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
      .setName('Typed exact fields')
      .setDesc('Generates structured exact fields for syntax/function-call recall.')
      .addToggle((toggle) => toggle.setValue(this.includeTypedFieldsExact).onChange((value) => {
        this.includeTypedFieldsExact = value;
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
    new Notice(`Generating review questions with ${TEXT_PROVIDER_LABELS[this.provider]}...`);

    try {
      this.plugin.settings.spacedRepetition.enabled = true;
      this.plugin.settings.spacedRepetitionGenerationProvider = this.provider;
      this.plugin.settings.spacedRepetitionGenerationModel = this.model;
      await this.plugin.saveSettings();

      const noteContent = await this.app.vault.read(this.sourceFile);
      const database = await this.plugin.services.ensureSpacedRepetitionDatabase();
      const noteId = await database.upsertNoteFromFile(this.sourceFile, this.createContentHash(noteContent));
      const generatedQuestions = await this.plugin.services.spacedRepetitionGenerator.generateQuestionsForNote({
        file: this.sourceFile,
        noteContent,
        provider: this.provider,
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
    if (this.includeTypedFieldsExact) types.push('typed_fields_exact');
    if (this.includeMultipleChoice) types.push('multiple_choice');
    if (this.includeLlmChecked) types.push('typed_llm_checked');
    return types;
  }

  private getDefaultModelForProvider(provider: TextProviderId): string {
    switch (provider) {
      case 'openrouter':
        return this.plugin.settings.openrouterTextModel || 'openrouter/deepseek/deepseek-r1:free';
      case 'chutes':
        return this.plugin.settings.chutesTextModel || 'deepseek-ai/DeepSeek-V3.2-Speciale-TEE';
      case 'zai':
        return this.plugin.settings.zaiTextModel || 'glm-4.6';
      case 'ollama':
        return this.plugin.settings.ollamaTextModel || 'gemma4:31b-cloud';
      case 'proxy':
        return this.plugin.settings.proxyTextModel || 'nim:nvidia/nemotron-3-nano-omni-30b-a3b-reasoning';
      default:
        return this.plugin.settings.defaultTextModel || 'gpt-4o';
    }
  }

  private getModelOptionsForProvider(provider: TextProviderId): Record<string, string> {
    switch (provider) {
      case 'openrouter': {
        const models = this.plugin.settings.openRouterModels?.length
          ? this.plugin.settings.openRouterModels
          : [this.getDefaultModelForProvider('openrouter')];
        return models.reduce((acc: Record<string, string>, id) => {
          const name = this.plugin.settings.openRouterModels?.find(m => m === id) || id;
          acc[id] = name;
          return acc;
        }, {});
      }
      case 'chutes':
        return {
          'deepseek-ai/DeepSeek-V3.2-Speciale-TEE': 'DeepSeek V3.2 Speciale',
        };
      case 'zai':
        return {
          'glm-4.6': 'GLM 4.6',
          'glm-4.7': 'GLM 4.7',
        };
      case 'ollama': {
        const models = this.plugin.settings.ollamaModels?.length
          ? this.plugin.settings.ollamaModels
          : [this.getDefaultModelForProvider('ollama')];
        return models.reduce((acc: Record<string, string>, model) => {
          acc[model] = model;
          return acc;
        }, {});
      }
      case 'proxy': {
        const models = this.plugin.settings.proxyModels?.length
          ? this.plugin.settings.proxyModels
          : [this.getDefaultModelForProvider('proxy')];
        return models.reduce((acc: Record<string, string>, model) => {
          acc[model] = model;
          return acc;
        }, {});
      }
      default:
        return { [this.getDefaultModelForProvider(provider)]: this.getDefaultModelForProvider(provider) };
    }
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
