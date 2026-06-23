import { ItemView, Notice, Setting, TFile, WorkspaceLeaf } from 'obsidian';
import type GptFreeTextGeneratorPlugin from '../main';
import { VIEW_TYPE_FLASHCARD_GENERATION } from '../constants';
import { GeneratedSpacedRepetitionQuestion } from '../utils/spacedRepetition/SpacedRepetitionGenerator';
import { QuestionType, SpacedRepetitionStudySetRecord } from '../types/spacedRepetition';
import { TextProviderId } from '../types/providers';
import { SpacedRepetitionEditCardModal } from '../modals/SpacedRepetitionEditCardModal';

export class FlashcardGenerationView extends ItemView {
  private plugin: GptFreeTextGeneratorPlugin;
  private sourceFile: TFile | null = null;
  private context = '';
  private prompt = 'Create durable review cards that test understanding, distinctions, edge cases, and common mistakes. Avoid trivial wording recall.';
  private questionCount = 8;
  private includeSelfCheck = true;
  private includeTypedExact = true;
  private includeTypedFieldsExact = false;
  private includeMultipleChoice = false;
  private includeLlmChecked = false;
  private studySets: SpacedRepetitionStudySetRecord[] = [];
  private selectedStudySetId = '';
  private newDeckName = '';
  private isGenerating = false;
  private generatedQuestions: GeneratedSpacedRepetitionQuestion[] = [];
  private excludedIndices: Set<number> = new Set();

  constructor(leaf: WorkspaceLeaf, plugin: GptFreeTextGeneratorPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_FLASHCARD_GENERATION;
  }

  getDisplayText(): string {
    return 'Flashcard Generator';
  }

  async onOpen(): Promise<void> {
    this.contentEl.addClass('flashcard-generation-view');
    await this.loadActiveNoteContext();
    await this.loadStudySets();
    this.render();
  }

  async onClose(): Promise<void> {
    this.contentEl.empty();
  }

  private render(): void {
    const container = this.contentEl;
    container.empty();

    const header = container.createDiv({ cls: 'flashcard-generation-header' });
    header.createEl('h2', { text: 'Flashcards' });
    header.createEl('div', {
      text: this.sourceFile ? this.sourceFile.path : 'Pasted context',
      cls: 'flashcard-generation-source',
    });

    this.renderModelControls(container);
    this.renderDeckControls(container);
    this.renderGenerationControls(container);
    this.renderContextControls(container);
    this.renderActions(container);
    this.renderPreview(container);
  }

  private renderDeckControls(container: HTMLElement): void {
    container.createEl('h3', { text: 'Deck' });

    new Setting(container)
      .setName('Save To Deck')
      .setDesc('Optional study set for generated cards.')
      .addDropdown((dropdown) => {
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

    new Setting(container)
      .setName('New Deck Name')
      .setDesc('If filled, this creates a new deck and saves cards there.')
      .addText((text) => text
        .setPlaceholder('C# / LINQ / BCL')
        .setValue(this.newDeckName)
        .onChange((value) => {
          this.newDeckName = value.trim();
        }));
  }

  private renderModelControls(container: HTMLElement): void {
    container.createEl('h3', { text: 'Model' });

    new Setting(container)
      .setName('Provider')
      .addDropdown((dropdown) => {
        dropdown
          .addOptions({
            openrouter: 'OpenRouter',
            chutes: 'Chutes',
            zai: 'ZAI',
            ollama: 'Ollama',
            proxy: 'OpenAI Proxy',
          })
          .setValue(this.plugin.settings.flashcardGenerationProvider)
          .onChange(async (value) => {
            const provider = value as TextProviderId;
            this.plugin.settings.flashcardGenerationProvider = provider;
            this.plugin.settings.flashcardGenerationModel = this.getDefaultModelForProvider(provider);
            await this.plugin.saveSettings();
            this.render();
          });
      });

    new Setting(container)
      .setName('Model')
      .addDropdown((dropdown) => {
        dropdown
          .addOptions(this.getModelOptions(this.plugin.settings.flashcardGenerationProvider))
          .setValue(this.plugin.settings.flashcardGenerationModel)
          .onChange(async (value) => {
            this.plugin.settings.flashcardGenerationModel = value;
            await this.plugin.saveSettings();
          });
      });
  }

  private renderGenerationControls(container: HTMLElement): void {
    container.createEl('h3', { text: 'Card Shape' });

    new Setting(container)
      .setName('Question Count')
      .addText((text) => text
        .setValue(String(this.questionCount))
        .onChange((value) => {
          const parsed = parseInt(value, 10);
          if (!Number.isNaN(parsed) && parsed > 0) {
            this.questionCount = Math.min(parsed, 40);
          }
        }));

    new Setting(container)
      .setName('Self-check')
      .addToggle((toggle) => toggle.setValue(this.includeSelfCheck).onChange((value) => {
        this.includeSelfCheck = value;
      }));

    new Setting(container)
      .setName('Typed exact')
      .addToggle((toggle) => toggle.setValue(this.includeTypedExact).onChange((value) => {
        this.includeTypedExact = value;
      }));

    new Setting(container)
      .setName('Typed exact fields')
      .setDesc('Use for exact syntax pieces such as method name, parameters, flags, or function call parts.')
      .addToggle((toggle) => toggle.setValue(this.includeTypedFieldsExact).onChange((value) => {
        this.includeTypedFieldsExact = value;
      }));

    new Setting(container)
      .setName('Multiple choice')
      .addToggle((toggle) => toggle.setValue(this.includeMultipleChoice).onChange((value) => {
        this.includeMultipleChoice = value;
      }));

    new Setting(container)
      .setName('LLM-checked typed')
      .addToggle((toggle) => toggle.setValue(this.includeLlmChecked).onChange((value) => {
        this.includeLlmChecked = value;
      }));
  }

  private renderContextControls(container: HTMLElement): void {
    container.createEl('h3', { text: 'Context And Prompt' });

    new Setting(container)
      .setName('Prompt')
      .addTextArea((text) => {
        text.setValue(this.prompt).onChange((value) => {
          this.prompt = value;
        });
        text.inputEl.rows = 5;
      });

    new Setting(container)
      .setName('Context')
      .addTextArea((text) => {
        text.setValue(this.context).onChange((value) => {
          this.context = value;
        });
        text.inputEl.rows = 14;
        text.inputEl.addClass('flashcard-generation-context-input');
      });
  }

  private renderActions(container: HTMLElement): void {
    new Setting(container)
      .addButton((button) => button
        .setButtonText('Load Active Note')
        .onClick(async () => {
          await this.loadActiveNoteContext();
          this.generatedQuestions = [];
          this.render();
        }))
      .addButton((button) => button
        .setButtonText(this.isGenerating ? 'Generating...' : 'Generate Preview')
        .setDisabled(this.isGenerating)
        .setCta()
        .onClick(() => this.generatePreview()))
      .addButton((button) => button
        .setButtonText('Save Generated')
        .setDisabled(this.generatedQuestions.length === 0 || this.isGenerating)
        .onClick(() => this.saveGeneratedQuestions()));
  }

  private renderPreview(container: HTMLElement): void {
    const preview = container.createDiv({ cls: 'flashcard-generation-preview' });
    preview.createEl('h3', { text: `Preview (${this.generatedQuestions.length})` });

    if (this.generatedQuestions.length === 0) {
      preview.createEl('p', { text: 'No generated cards yet.' });
      return;
    }

    for (let index = 0; index < this.generatedQuestions.length; index += 1) {
      const question = this.generatedQuestions[index];
      const isExcluded = this.excludedIndices.has(index);
      const card = preview.createDiv({
        cls: `flashcard-generation-preview-card${isExcluded ? ' flashcard-generation-preview-card-excluded' : ''}`,
      });

      const header = card.createDiv({ cls: 'flashcard-generation-preview-header' });
      header.createEl('div', { text: question.questionName ?? question.questionType, cls: 'flashcard-generation-preview-label' });

      const actions = header.createDiv({ cls: 'flashcard-generation-preview-actions' });

      // Edit button
      actions.createEl('button', { text: 'Edit', cls: 'mod-cta' }).addEventListener('click', () => {
        this.editCard(index);
      });

      // Exclude toggle button
      const excludeBtn = actions.createEl('button', {
        text: isExcluded ? 'Include' : 'Exclude',
        cls: isExcluded ? 'mod-warning' : '',
      });
      excludeBtn.addEventListener('click', () => {
        if (this.excludedIndices.has(index)) {
          this.excludedIndices.delete(index);
        } else {
          this.excludedIndices.add(index);
        }
        this.render();
      });

      // Regenerate single card button
      actions.createEl('button', { text: 'Regenerate' }).addEventListener('click', () => {
        this.regenerateSingleCard(index);
      });

      card.createEl('div', { text: question.questionText, cls: 'flashcard-generation-preview-question' });
      card.createEl('div', { text: question.answerText ?? '', cls: 'flashcard-generation-preview-answer' });
      if (question.choices) {
        const choicesEl = card.createEl('ul', { cls: 'flashcard-generation-preview-choices' });
        for (const choice of question.choices) {
          choicesEl.createEl('li', { text: choice });
        }
      }
      const fields = this.getExactFieldPreview(question.metadata);
      if (fields.length) {
        const fieldList = card.createEl('ul', { cls: 'flashcard-generation-preview-fields' });
        for (const field of fields) {
          fieldList.createEl('li', { text: `${field.label}: ${field.answer}` });
        }
      }
    }
  }

  private async generatePreview(): Promise<void> {
    const questionTypes = this.getSelectedQuestionTypes();
    if (questionTypes.length === 0) {
      new Notice('Select at least one card type');
      return;
    }

    if (!this.context.trim()) {
      new Notice('Add context first');
      return;
    }

    try {
      this.isGenerating = true;
      this.render();
      const file = this.sourceFile ?? ({ path: 'Pasted Flashcard Context.md', basename: 'Pasted Flashcard Context' } as TFile);
      this.generatedQuestions = await this.plugin.services.spacedRepetitionGenerator.generateQuestionsForNote({
        file,
        noteContent: this.context,
        provider: this.plugin.settings.flashcardGenerationProvider,
        model: this.plugin.settings.flashcardGenerationModel,
        questionCount: this.questionCount,
        questionTypes,
        additionalInstructions: this.prompt,
        outputLanguage: this.plugin.settings.defaultOutputLanguage || 'english',
        temperature: this.plugin.settings.flashcardGenerationTemperature,
        maxTokens: this.plugin.settings.flashcardGenerationMaxTokens,
      });
      new Notice(`Generated ${this.generatedQuestions.length} card(s)`);
    } catch (error) {
      console.error('Failed to generate flashcards:', error);
      new Notice(`Failed to generate flashcards: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      this.isGenerating = false;
      this.render();
    }
  }

  private async saveGeneratedQuestions(): Promise<void> {
    if (this.generatedQuestions.length === 0) {
      return;
    }

    try {
      this.plugin.settings.spacedRepetition.enabled = true;
      await this.plugin.saveSettings();
      const database = await this.plugin.services.ensureSpacedRepetitionDatabase();

      let noteId: string | null = null;
      let studySetId: string | null = null;
      let deckName: string | null = null;
      if (this.sourceFile) {
        noteId = await database.upsertNoteFromFile(this.sourceFile, this.createContentHash(this.context));
      }

      if (this.newDeckName) {
        studySetId = await database.createStudySet({
          name: this.newDeckName,
          sourceType: 'manual',
          sourceRule: {
            type: this.sourceFile ? 'generated-from-note' : 'pasted-context',
            sourcePath: this.sourceFile?.path ?? null,
          },
          tags: ['flashcards'],
        });
        deckName = this.newDeckName;
        this.newDeckName = '';
        await this.loadStudySets();
      } else if (this.selectedStudySetId) {
        studySetId = this.selectedStudySetId;
        deckName = this.studySets.find((set) => set.id === studySetId)?.name ?? null;
      } else if (!this.sourceFile) {
        studySetId = await database.createStudySet({
          name: `Pasted flashcards ${new Date().toLocaleString()}`,
          sourceType: 'manual',
          sourceRule: { type: 'pasted-context' },
          tags: ['flashcards'],
        });
        deckName = 'Pasted flashcards';
      }

      if (studySetId && noteId) {
        await database.setStudySetNotes(studySetId, [noteId]);
      }

      const questionsToSave = this.generatedQuestions.filter((_, index) => !this.excludedIndices.has(index));
      if (questionsToSave.length === 0) {
        new Notice('All cards are excluded — nothing to save');
        return;
      }

      const questionIds = await database.createQuestions(questionsToSave.map((question) => ({
        ...question,
        noteId,
        studySetId,
        metadata: {
          ...(question.metadata ?? {}),
          generatedBy: 'flashcard-generation-panel',
          provider: this.plugin.settings.flashcardGenerationProvider,
          model: this.plugin.settings.flashcardGenerationModel,
          deckName,
          sourcePath: this.sourceFile?.path ?? null,
          sourceContext: this.sourceFile ? this.sourceFile.basename : 'Pasted context',
        },
      })));

      if (noteId) {
        for (let index = 0; index < questionIds.length; index += 1) {
          await database.recordQuestionSources(questionIds[index], [
            {
              noteId,
              sourceLabel: this.sourceFile?.basename,
              sourceExcerpt: this.generatedQuestions[index]?.source?.sourceExcerpt,
            },
          ]);
        }
      }

      new Notice(`Saved ${questionIds.length} card(s) to spaced repetition`);
      this.generatedQuestions = [];
      this.excludedIndices.clear();
      this.render();
    } catch (error) {
      console.error('Failed to save generated flashcards:', error);
      new Notice(`Failed to save flashcards: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async loadStudySets(): Promise<void> {
    try {
      const database = await this.plugin.services.ensureSpacedRepetitionDatabase();
      this.studySets = database.getStudySets().filter((set) => set.enabled);
    } catch {
      this.studySets = [];
    }
  }

  private async loadActiveNoteContext(): Promise<void> {
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile) {
      this.sourceFile = null;
      return;
    }

    this.sourceFile = activeFile;
    this.context = await this.app.vault.read(activeFile);
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

  private getExactFieldPreview(metadata?: Record<string, unknown>): Array<{ label: string; answer: string }> {
    const raw = metadata?.exactFields;
    if (!Array.isArray(raw)) {
      return [];
    }

    return raw.flatMap((item) => {
      if (!item || typeof item !== 'object') {
        return [];
      }
      const field = item as Record<string, unknown>;
      const label = typeof field.label === 'string' ? field.label.trim() : '';
      const answer = typeof field.answer === 'string' ? field.answer.trim() : '';
      return label && answer ? [{ label, answer }] : [];
    });
  }

  private getDefaultModelForProvider(provider: TextProviderId): string {
    switch (provider) {
      case 'openrouter': return this.plugin.settings.openrouterTextModel || this.plugin.settings.defaultTextModel;
      case 'chutes': return this.plugin.settings.chutesTextModel || 'deepseek-ai/DeepSeek-V3.2-Speciale-TEE';
      case 'zai': return this.plugin.settings.zaiTextModel || 'glm-4.6';
      case 'proxy': return this.plugin.settings.proxyTextModel || 'nim:nvidia/nemotron-3-nano-omni-30b-a3b-reasoning';
      case 'ollama':
      default:
        return this.plugin.settings.ollamaTextModel || 'gemma4:31b-cloud';
    }
  }

  private getModelOptions(provider: TextProviderId): Record<string, string> {
    if (provider === 'openrouter' && this.plugin.settings.openRouterModels?.length) {
      return this.plugin.settings.openRouterModels.reduce((acc: Record<string, string>, model) => {
        acc[model.id] = model.name;
        return acc;
      }, {});
    }

    const modelLists: Record<TextProviderId, string[]> = {
      openrouter: [this.getDefaultModelForProvider('openrouter')],
      chutes: [this.getDefaultModelForProvider('chutes')],
      zai: [this.getDefaultModelForProvider('zai')],
      ollama: this.plugin.settings.ollamaModels?.length ? this.plugin.settings.ollamaModels : [this.getDefaultModelForProvider('ollama')],
      proxy: this.plugin.settings.proxyModels?.length ? this.plugin.settings.proxyModels : [this.getDefaultModelForProvider('proxy')],
    };

    return modelLists[provider].reduce((acc: Record<string, string>, model) => {
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

  private editCard(index: number): void {
    const question = this.generatedQuestions[index];
    const editModal = new SpacedRepetitionEditCardModal(
      this.app,
      question,
      async (updated) => {
        this.generatedQuestions[index] = updated;
        this.excludedIndices.delete(index);
        this.render();
      },
    );
    editModal.open();
  }

  private async regenerateSingleCard(index: number): Promise<void> {
    const questionTypes = [this.generatedQuestions[index].questionType];
    try {
      this.isGenerating = true;
      this.render();
      const file = this.sourceFile ?? ({ path: 'Pasted Flashcard Context.md', basename: 'Pasted Flashcard Context' } as TFile);
      const newQuestions = await this.plugin.services.spacedRepetitionGenerator.generateQuestionsForNote({
        file,
        noteContent: this.context,
        provider: this.plugin.settings.flashcardGenerationProvider,
        model: this.plugin.settings.flashcardGenerationModel,
        questionCount: 1,
        questionTypes,
        additionalInstructions: this.prompt,
        outputLanguage: this.plugin.settings.defaultOutputLanguage || 'english',
        temperature: this.plugin.settings.flashcardGenerationTemperature,
        maxTokens: this.plugin.settings.flashcardGenerationMaxTokens,
      });
      if (newQuestions.length > 0) {
        this.generatedQuestions[index] = newQuestions[0];
        new Notice('Card regenerated');
      } else {
        new Notice('Regeneration returned no valid card');
      }
    } catch (error) {
      console.error('Failed to regenerate card:', error);
      new Notice(`Regeneration failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      this.isGenerating = false;
      this.render();
    }
  }
}
