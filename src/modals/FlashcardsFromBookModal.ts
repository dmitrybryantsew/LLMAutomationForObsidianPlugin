import { App, Modal, Notice, Setting, TFile } from 'obsidian';
import type GptFreeTextGeneratorPlugin from '../main';
import { TextProviderId } from '../types/providers';
import { QuestionType, SpacedRepetitionStudySetRecord } from '../types/spacedRepetition';
import {
  CompanionClient,
  CompanionPdfChapter,
  CompanionPdfFile,
  CompanionPdfInfo,
  CompanionPdfPage,
  CompanionPdfParagraph,
} from '../retrieval/CompanionClient';
import { GeneratedSpacedRepetitionQuestion, ExtractedConcept } from '../utils/spacedRepetition/SpacedRepetitionGenerator';
import { isThinkingModel, modelLabel, sortModelsByThinking } from '../utils/modelFilters';

const CARD_MODELS_LANGUAGES: Record<string, string> = {
  english: 'English',
  russian: 'Russian',
};

/** A chunk of the book to generate cards from. */
interface BookUnit {
  label: string;
  startPage: number;
  endPage: number;
  topLevelLabel: string | null;
}

const PAGES_PER_CHUNK = 20;

/**
 * "Flashcards from Book" modal: picks an external (allowlisted) PDF via the
 * companion service, selects chapters or a page range, and generates spaced
 * repetition cards unit-by-unit with configurable book/cards language and
 * question count.
 */
export class FlashcardsFromBookModal extends Modal {
  private plugin: GptFreeTextGeneratorPlugin;

  // Book selection
  private sourceRootId = '';
  private sourceRoots: Array<{ id: string; path: string }> = [];
  private books: CompanionPdfFile[] = [];
  private selectedBookRelPath = '';
  private bookInfo: CompanionPdfInfo | null = null;
  private loadingBook = false;

  // Unit selection
  private mode: 'chapters' | 'pages' = 'chapters';
  private chapters: CompanionPdfChapter[] = [];
  private selectedChapterTitles = new Set<string>();
  private manualStartPage = 1;
  private manualEndPage = 10;

  // Generation options
  private bookLanguage = 'en';
  private cardsLanguage = 'english';
  private questionCount = 8;
  private includeSelfCheck = true;
  private includeTypedExact = true;
  private includeTypedFieldsExact = false;
  private includeMultipleChoice = false;
  private includeLlmChecked = false;
  private studySets: SpacedRepetitionStudySetRecord[] = [];
  private selectedStudySetId = '';
  private newDeckName = '';

  // Generation state
  private isGenerating = false;
  private generated: GeneratedSpacedRepetitionQuestion[] = [];
  private generationLog: string[] = [];
  private previewUnitIndex = -1;
  private failedUnitLabels = new Set<string>();

  constructor(app: App, plugin: GptFreeTextGeneratorPlugin) {
    super(app);
    this.plugin = plugin;
    this.modalEl.addClass('flashcards-from-book-modal');
  }

  async onOpen(): Promise<void> {
    this.contentEl.empty();
    await this.loadSourceRoots();
    await this.loadStudySets();
    this.render();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private get companion(): CompanionClient {
    const client = this.plugin.services.companionClient;
    if (!client) {
      throw new Error('Companion service is not enabled (check Retrieval settings)');
    }
    return client;
  }

  private async loadSourceRoots(): Promise<void> {
    try {
      const client = this.plugin.services.companionClient;
      if (!client) {
        return;
      }
      const status = await client.checkStatus(true);
      if (!status?.running) {
        new Notice('Companion service is not running');
        return;
      }
      if (!client.supportsPdf()) {
        new Notice('Companion does not support PDFs — update the companion service (protocol 0.2.0)');
        return;
      }
      const roots = await client.getSources();
      this.sourceRoots = roots.map((root) => ({ id: root.id, path: root.path }));
      if (this.sourceRoots.length > 0) {
        this.sourceRootId = this.sourceRoots[0].id;
        await this.loadBooks();
      }
    } catch (error) {
      console.error('Failed to load companion sources:', error);
      new Notice(`Failed to load companion sources: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async loadBooks(): Promise<void> {
    const root = this.sourceRoots.find((entry) => entry.id === this.sourceRootId);
    if (!root) {
      this.books = [];
      return;
    }

    try {
      this.loadingBook = true;
      this.render();
      this.books = await this.companion.listPdfs(root.path);
      this.selectedBookRelPath = '';
      this.bookInfo = null;
      this.chapters = [];
      this.selectedChapterTitles.clear();
    } catch (error) {
      console.error('Failed to list PDFs:', error);
      new Notice(`Failed to list PDFs: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      this.loadingBook = false;
      this.render();
    }
  }

  private async loadBookInfo(): Promise<void> {
    const root = this.sourceRoots.find((entry) => entry.id === this.sourceRootId);
    if (!root || !this.selectedBookRelPath) {
      return;
    }

    const pdfPath = `${root.path}/${this.selectedBookRelPath}`.replace(/\\/g, '/');
    try {
      this.loadingBook = true;
      this.render();
      const bookInfo = await this.companion.getPdfInfo(pdfPath);
      this.bookInfo = bookInfo;
      this.chapters = bookInfo.chapters;
      if (this.chapters.length > 0) {
        this.mode = 'chapters';
        this.selectedChapterTitles = new Set(this.chapters.filter((c) => c.level === 0).map((c) => c.title));
      } else {
        this.mode = 'pages';
      }
      this.manualStartPage = 1;
      this.manualEndPage = Math.min(10, bookInfo.pageCount);
    } catch (error) {
      console.error('Failed to load PDF info:', error);
      new Notice(`Failed to read PDF: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      this.loadingBook = false;
      this.render();
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

  // ------------------------------------------------------------------
  // Rendering
  // ------------------------------------------------------------------

  private render(): void {
    const container = this.contentEl;
    container.empty();

    this.renderSourceSection(container);
    if (!this.sourceRoots.length) {
      this.renderNoSourcesHint(container);
      return;
    }

    if (!this.selectedBookRelPath) {
      this.renderBookList(container);
      return;
    }

    this.renderBookHeader(container);
    this.renderUnitSelection(container);
    this.renderModelControls(container);
    this.renderGenerationOptions(container);
    this.renderActions(container);
    this.renderPreview(container);
  }

  private renderSourceSection(container: HTMLElement): void {
    const section = container.createDiv({ cls: 'flashcards-from-book-section' });
    section.createEl('h3', { text: 'Book Source (companion)' });

    new Setting(section)
      .setName('Allowlisted root')
      .setDesc('Books folder registered in the companion allowlist.')
      .addDropdown((dropdown) => {
        dropdown.addOption('', 'Choose source...');
        for (const root of this.sourceRoots) {
          dropdown.addOption(root.id, root.path);
        }
        dropdown
          .setValue(this.sourceRootId)
          .onChange(async (value) => {
            this.sourceRootId = value;
            await this.loadBooks();
          });
      })
      .addButton((button) => button
        .setButtonText('Refresh')
        .onClick(() => this.loadSourceRoots()));
  }

  private renderNoSourcesHint(container: HTMLElement): void {
    const hint = container.createDiv({ cls: 'flashcards-from-book-hint' });
    hint.createEl('p', {
      text: 'No companion sources are allowlisted yet. Add your books folder in Settings → Knowledge Retrieval → Companion sources, then reopen this modal.',
    });
  }

  private renderBookList(container: HTMLElement): void {
    const section = container.createDiv({ cls: 'flashcards-from-book-section' });
    section.createEl('h3', { text: 'Choose Book' });

    if (this.loadingBook) {
      section.createEl('p', { text: 'Loading books...' });
      return;
    }

    if (this.books.length === 0) {
      section.createEl('p', { text: 'No PDF files found in this source root.' });
      return;
    }

    const list = section.createDiv({ cls: 'flashcards-from-book-list' });
    for (const book of this.books) {
      const row = list.createDiv({ cls: 'flashcards-from-book-row' });
      const title = row.createDiv({ cls: 'flashcards-from-book-row-title' });
      title.setText(book.relativePath);
      row.createDiv({
        text: `${this.formatBytes(book.bytes)}`,
        cls: 'flashcards-from-book-row-meta',
      });
      row.createEl('button', { text: 'Open' })
        .addEventListener('click', () => {
          this.selectedBookRelPath = book.relativePath;
          void this.loadBookInfo();
        });
    }
  }

  private renderBookHeader(container: HTMLElement): void {
    const header = container.createDiv({ cls: 'flashcards-from-book-header' });
    header.createEl('h3', { text: this.selectedBookRelPath });

    const meta: string[] = [];
    if (this.bookInfo) {
      meta.push(`${this.bookInfo.pageCount} pages`);
      meta.push(this.bookInfo.hasOutline ? `${this.chapters.length} chapters in outline` : 'no outline (page mode only)');
    }
    if (meta.length) {
      header.createEl('div', { text: meta.join(' | '), cls: 'flashcards-from-book-row-meta' });
    }

    new Setting(header)
      .addButton((button) => button
        .setButtonText('Change Book')
        .onClick(() => {
          this.selectedBookRelPath = '';
          this.bookInfo = null;
          this.chapters = [];
          this.generated = [];
          this.generationLog = [];
          this.render();
        }));
  }

  private renderUnitSelection(container: HTMLElement): void {
    const section = container.createDiv({ cls: 'flashcards-from-book-section' });
    section.createEl('h3', { text: 'What To Learn' });

    const modeSetting = new Setting(section)
      .setName('Selection mode')
      .setDesc('Chapters come from the embedded PDF outline; page range is manual.');

    if (!this.bookInfo?.hasOutline) {
      modeSetting.setDesc('This book has no embedded outline — page range only.');
    }

    modeSetting.addDropdown((dropdown) => {
      dropdown
        .addOption('chapters', 'By chapters')
        .addOption('pages', 'By page range')
        .setValue(this.bookInfo?.hasOutline ? this.mode : 'pages')
        .setDisabled(!this.bookInfo?.hasOutline)
        .onChange((value) => {
          this.mode = value as 'chapters' | 'pages';
          this.render();
        });
    });

    if (this.mode === 'chapters' && this.bookInfo?.hasOutline) {
      const listControls = section.createDiv({ cls: 'flashcards-from-book-chapter-controls' });
      const selectedCount = this.chapters.filter((c) => this.selectedChapterTitles.has(c.title)).length;
      listControls.createSpan({
        text: `${selectedCount}/${this.chapters.length} selected`,
        cls: 'flashcards-from-book-row-meta',
      });
      listControls.createEl('button', { text: 'Select All', cls: 'llm-automation-btn llm-automation-btn-secondary' })
        .addEventListener('click', () => {
          for (const chapter of this.chapters) {
            this.selectedChapterTitles.add(chapter.title);
          }
          this.render();
        });
      listControls.createEl('button', { text: 'Deselect All', cls: 'llm-automation-btn llm-automation-btn-secondary' })
        .addEventListener('click', () => {
          this.selectedChapterTitles.clear();
          this.render();
        });
      listControls.createEl('button', { text: 'Top Level Only', cls: 'llm-automation-btn llm-automation-btn-secondary' })
        .addEventListener('click', () => {
          this.selectedChapterTitles = new Set(this.chapters.filter((c) => c.level === 0).map((c) => c.title));
          this.render();
        });

      const list = section.createDiv({ cls: 'flashcards-from-book-chapters' });
      for (const chapter of this.chapters) {
        const row = list.createDiv({
          cls: 'flashcards-from-book-chapter-row'
            + (this.selectedChapterTitles.has(chapter.title) ? ' flashcards-from-book-chapter-selected' : ''),
        });
        row.style.paddingLeft = `${8 + chapter.level * 16}px`;

        const checkbox = row.createEl('input', { type: 'checkbox' });
        checkbox.checked = this.selectedChapterTitles.has(chapter.title);
        checkbox.addEventListener('change', () => {
          if (checkbox.checked) {
            this.selectedChapterTitles.add(chapter.title);
          } else {
            this.selectedChapterTitles.delete(chapter.title);
          }
          row.toggleClass('flashcards-from-book-chapter-selected', checkbox.checked);
        });

        row.createSpan({
          text: chapter.title,
          cls: 'flashcards-from-book-chapter-title',
        });
        row.createSpan({
          text: `p. ${chapter.startPage}–${chapter.endPage}`,
          cls: 'flashcards-from-book-row-meta',
        });
      }
      return;
    }

    const root = this.sourceRoots.find((entry) => entry.id === this.sourceRootId);
    new Setting(section)
      .setName('Start page')
      .addText((text) => text
        .setValue(String(this.manualStartPage))
        .onChange((value) => {
          const parsed = parseInt(value, 10);
          if (!Number.isNaN(parsed) && parsed >= 1) {
            this.manualStartPage = parsed;
          }
        }));

    new Setting(section)
      .setName('End page')
      .setDesc(this.bookInfo ? `1–${this.bookInfo.pageCount}` : '')
      .addText((text) => text
        .setValue(String(this.manualEndPage))
        .onChange((value) => {
          const parsed = parseInt(value, 10);
          if (!Number.isNaN(parsed) && parsed >= 1) {
            this.manualEndPage = parsed;
          }
        }));

    // Avoid unused warning; root path used when generating units.
    void root;
  }

  private renderModelControls(container: HTMLElement): void {
    const section = container.createDiv({ cls: 'flashcards-from-book-section' });
    section.createEl('h3', { text: 'Model' });

    new Setting(section)
      .setName('Provider')
      .addDropdown((dropdown) => {
        dropdown
          .addOptions({
            openrouter: 'OpenRouter',
            chutes: 'Chutes',
            zai: 'ZAI',
            ollama: 'Ollama',
            proxy: 'OpenAI Proxy',
            qwengate: 'QwenGate',
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

    const modelSetting = new Setting(section)
      .setName('Model')
      .setDesc(isThinkingModel(this.plugin.settings.flashcardGenerationModel)
        ? 'Thinking model selected — slower, and it may burn output tokens on hidden reasoning. JSON is extracted from the final answer only.'
        : '');
    modelSetting.addDropdown((dropdown) => {
        dropdown
          .addOptions(this.getModelOptions(this.plugin.settings.flashcardGenerationProvider))
          .setValue(this.plugin.settings.flashcardGenerationModel)
          .onChange(async (value) => {
            this.plugin.settings.flashcardGenerationModel = value;
            await this.plugin.saveSettings();
            this.render();
          });
      });
  }

  private getDefaultModelForProvider(provider: TextProviderId): string {
    switch (provider) {
      case 'openrouter': return this.plugin.settings.openrouterTextModel || this.plugin.settings.defaultTextModel;
      case 'chutes': return this.plugin.settings.chutesTextModel || 'deepseek-ai/DeepSeek-V3.2-Speciale-TEE';
      case 'zai': return this.plugin.settings.zaiTextModel || 'glm-4.6';
      case 'proxy': return this.plugin.settings.proxyTextModel || 'nim:nvidia/nemotron-3-nano-omni-30b-a3b-reasoning';
      case 'qwengate': return this.plugin.settings.qwengateTextModel || 'qwen3.7-plus';
      case 'ollama':
      default:
        return this.plugin.settings.ollamaTextModel || 'gemma4:31b-cloud';
    }
  }

  private getModelOptions(provider: TextProviderId): Record<string, string> {
    if (provider === 'openrouter' && this.plugin.settings.openRouterModels?.length) {
      const sorted = [...this.plugin.settings.openRouterModels].sort(
        (a, b) => (Number(isThinkingModel(a.id)) - Number(isThinkingModel(b.id))) || a.name.localeCompare(b.name),
      );
      return sorted.reduce((acc: Record<string, string>, model) => {
        acc[model.id] = modelLabel(model.id, model.name);
        return acc;
      }, {});
    }

    const modelLists: Record<TextProviderId, string[]> = {
      openrouter: [this.getDefaultModelForProvider('openrouter')],
      chutes: [this.getDefaultModelForProvider('chutes')],
      zai: [this.getDefaultModelForProvider('zai')],
      ollama: this.plugin.settings.ollamaModels?.length ? this.plugin.settings.ollamaModels : [this.getDefaultModelForProvider('ollama')],
      proxy: this.plugin.settings.proxyModels?.length ? this.plugin.settings.proxyModels : [this.getDefaultModelForProvider('proxy')],
      qwengate: this.plugin.settings.qwengateModels?.length ? this.plugin.settings.qwengateModels : [this.getDefaultModelForProvider('qwengate')],
    };

    return sortModelsByThinking(modelLists[provider]).reduce((acc: Record<string, string>, model) => {
      acc[model] = modelLabel(model);
      return acc;
    }, {});
  }

  private renderGenerationOptions(container: HTMLElement): void {
    const section = container.createDiv({ cls: 'flashcards-from-book-section' });
    section.createEl('h3', { text: 'Cards' });

    new Setting(section)
      .setName('Book language')
      .setDesc('Language of the source text (helps the model).')
      .addDropdown((dropdown) => {
        dropdown
          .addOption('en', 'English')
          .addOption('ru', 'Russian')
          .setValue(this.bookLanguage)
          .onChange((value) => {
            this.bookLanguage = value;
          });
      });

    new Setting(section)
      .setName('Cards language')
      .setDesc('Language the questions and answers are written in.')
      .addDropdown((dropdown) => {
        for (const [code, name] of Object.entries(CARD_MODELS_LANGUAGES)) {
          dropdown.addOption(code, name);
        }
        dropdown
          .setValue(this.cardsLanguage)
          .onChange((value) => {
            this.cardsLanguage = value;
          });
      });

    new Setting(section)
      .setName('Questions per chapter / 20 pages')
      .addText((text) => text
        .setValue(String(this.questionCount))
        .onChange((value) => {
          const parsed = parseInt(value, 10);
          if (!Number.isNaN(parsed) && parsed > 0) {
            this.questionCount = Math.min(parsed, 40);
          }
        }));

    const typesSetting = new Setting(section).setName('Card types').setDesc('What kinds of questions to generate.');
    this.renderTypeToggles(typesSetting);

    new Setting(section)
      .setName('Save To Deck')
      .setDesc('Optional deck for the generated cards.')
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

    new Setting(section)
      .setName('New Deck Name')
      .setDesc('If filled, creates a new deck (e.g. the book title).')
      .addText((text) => text
        .setPlaceholder(this.deckSuggestion())
        .setValue(this.newDeckName)
        .onChange((value) => {
          this.newDeckName = value.trim();
        }));
  }

  private renderTypeToggles(setting: Setting): void {
    setting
      .addToggle((toggle) => toggle
        .setTooltip('Self-check')
        .setValue(this.includeSelfCheck)
        .onChange((value) => {
          this.includeSelfCheck = value;
        }))
      .addToggle((toggle) => toggle
        .setTooltip('Typed exact')
        .setValue(this.includeTypedExact)
        .onChange((value) => {
          this.includeTypedExact = value;
        }))
      .addToggle((toggle) => toggle
        .setTooltip('Typed exact fields')
        .setValue(this.includeTypedFieldsExact)
        .onChange((value) => {
          this.includeTypedFieldsExact = value;
        }))
      .addToggle((toggle) => toggle
        .setTooltip('Multiple choice')
        .setValue(this.includeMultipleChoice)
        .onChange((value) => {
          this.includeMultipleChoice = value;
        }))
      .addToggle((toggle) => toggle
        .setTooltip('LLM-checked typed')
        .setValue(this.includeLlmChecked)
        .onChange((value) => {
          this.includeLlmChecked = value;
        }));
  }

  private renderActions(container: HTMLElement): void {
    new Setting(container)
      .addButton((button) => button
        .setButtonText(this.isGenerating ? 'Generating...' : 'Generate Flashcards')
        .setCta()
        .setDisabled(this.isGenerating)
        .onClick(() => this.generate()))
      .addButton((button) => button
        .setButtonText(`Retry Failed Units (${this.failedUnitLabels.size})`)
        .setDisabled(this.failedUnitLabels.size === 0 || this.isGenerating)
        .onClick(() => this.generate(true)))
      .addButton((button) => button
        .setButtonText('Save To Spaced Repetition')
        .setDisabled(this.generated.length === 0 || this.isGenerating)
        .onClick(() => this.saveGenerated()));
  }

  private renderPreview(container: HTMLElement): void {
    if (this.generationLog.length === 0 && this.generated.length === 0) {
      return;
    }

    const preview = container.createDiv({ cls: 'flashcards-from-book-preview' });
    preview.createEl('h3', { text: `Preview (${this.generated.length} cards)` });

    for (const line of this.generationLog) {
      preview.createEl('div', {
        text: line,
        cls: 'flashcards-from-book-row-meta',
      });
    }

    const shown = this.generated.slice(0, 30);
    for (const question of shown) {
      const card = preview.createDiv({ cls: 'flashcards-from-book-preview-card' });
      const header = card.createEl('div', { cls: 'flashcards-from-book-row-meta' });
      header.textContent = [
        question.questionName ?? question.questionType,
        question.topLevelLabel ? `§ ${question.topLevelLabel}` : null,
        question.sectionLabel ? `${question.sectionLabel}` : null,
        question.paragraphIndex != null ? `¶${question.paragraphIndex}` : null,
      ].filter(Boolean).join(' · ');
      card.createEl('div', { text: question.questionText });
      card.createEl('div', { text: question.answerText ?? '', cls: 'flashcards-from-book-row-meta' });
    }
    if (this.generated.length > shown.length) {
      preview.createEl('p', { text: `...and ${this.generated.length - shown.length} more` });
    }
  }

  // ------------------------------------------------------------------
  // Generation
  // ------------------------------------------------------------------

  private buildUnits(): BookUnit[] {
    if (this.mode === 'chapters' && this.chapters.length > 0) {
      return this.chapters
        .filter((chapter) => this.selectedChapterTitles.has(chapter.title))
        .map((chapter) => ({
          label: chapter.title,
          startPage: chapter.startPage,
          endPage: chapter.endPage,
          topLevelLabel: this.findTopLevelAncestor(chapter),
        }));
    }

    const start = Math.max(1, this.manualStartPage);
    const end = Math.max(start, this.manualEndPage);
    const units: BookUnit[] = [];
    for (let page = start; page <= end; page += PAGES_PER_CHUNK) {
      const chunkEnd = Math.min(page + PAGES_PER_CHUNK - 1, end);
      units.push({
        label: `Pages ${page}–${chunkEnd}`,
        startPage: page,
        endPage: chunkEnd,
        topLevelLabel: this.findTopLevelByPage(page),
      });
    }
    return units;
  }

  /** Find the level-0 chapter that contains the given sub-chapter. */
  private findTopLevelAncestor(chapter: CompanionPdfChapter): string | null {
    if (chapter.level === 0) {
      return chapter.title;
    }
    const ancestors = this.chapters
      .filter((c) => c.level === 0 && c.startPage <= chapter.startPage && c.endPage >= chapter.endPage)
      .sort((a, b) => b.startPage - a.startPage);
    return ancestors.length > 0 ? ancestors[0].title : null;
  }

  /** Find the level-0 chapter whose page range contains the given page. */
  private findTopLevelByPage(page: number): string | null {
    const containing = this.chapters
      .filter((c) => c.level === 0 && c.startPage <= page && c.endPage >= page)
      .sort((a, b) => b.startPage - a.startPage);
    return containing.length > 0 ? containing[0].title : null;
  }

  private async generate(retryFailedOnly = false): Promise<void> {
    const root = this.sourceRoots.find((entry) => entry.id === this.sourceRootId);
    if (!root || !this.selectedBookRelPath || !this.bookInfo) {
      new Notice('Choose a book first');
      return;
    }

    const questionTypes = this.getSelectedQuestionTypes();
    if (questionTypes.length === 0) {
      new Notice('Select at least one card type');
      return;
    }

    const allUnits = this.buildUnits();
    if (allUnits.length === 0) {
      new Notice('Nothing selected — pick chapters or set a page range');
      return;
    }

    const units = retryFailedOnly
      ? allUnits.filter((unit) => this.failedUnitLabels.has(unit.label))
      : allUnits;
    if (units.length === 0) {
      new Notice('No failed units to retry');
      return;
    }

    const pdfPath = `${root.path}/${this.selectedBookRelPath}`.replace(/\\/g, '/');
    const fakeFile = {
      path: this.selectedBookRelPath,
      basename: this.selectedBookRelPath.replace(/\.pdf$/i, ''),
    } as TFile;

    this.isGenerating = true;
    if (!retryFailedOnly) {
      this.generated = [];
      this.generationLog = [];
      this.previewUnitIndex = -1;
    } else {
      for (const unit of units) {
        this.failedUnitLabels.delete(unit.label);
        this.generationLog.push(`Retrying ${unit.label}...`);
      }
    }
    this.render();

    try {
      this.plugin.settings.spacedRepetition.enabled = true;
      await this.plugin.saveSettings();

      for (let index = 0; index < units.length; index += 1) {
        const unit = units[index];
        this.generationLog.push(`Reading ${unit.label}...`);
        this.render();

        const paragraphs: CompanionPdfParagraph[] = await this.companion.getPdfParagraphs(pdfPath, unit.startPage, unit.endPage);
        const unitText = paragraphs
          .map((p) => p.text)
          .join('\n\n')
          .trim();

        if (!unitText) {
          this.generationLog.push(`${unit.label}: no extractable text (scanned PDF? skipped)`);
          continue;
        }

        // Dedup support: query existing cards for this book + top-level unit.
        let existingQuestions: string[] = [];
        let cachedConcepts: ExtractedConcept[] | undefined;
        try {
          const database = await this.plugin.services.ensureSpacedRepetitionDatabase();
          existingQuestions = database.getExistingQuestionTexts(pdfPath, unit.label);
          if (existingQuestions.length > 0) {
            this.generationLog.push(`${unit.label}: ${existingQuestions.length} existing cards found (dedup mode)`);
            this.render();
          }

          // Concept cache: reuse if the unit text hasn't changed.
          const unitKey = `${unit.label}|${unit.startPage}-${unit.endPage}`;
          const textHash = await this.hashText(unitText);
          const cached = database.getCachedConcepts(pdfPath, unitKey, textHash);
          if (cached && cached.length > 0) {
            cachedConcepts = cached as ExtractedConcept[];
            this.generationLog.push(`${unit.label}: reusing ${cachedConcepts.length} cached concepts`);
            this.render();
          }
        } catch (dbError) {
          console.warn('[FlashcardsFromBookModal] Dedup/cache lookup failed, continuing without:', dbError);
        }

        this.generationLog.push(`Generating cards for ${unit.label}...`);
        this.render();

        try {
          const paragraphContext = paragraphs.map((p, i) => ({ index: i, page: p.page, text: p.text }));
          const { questions, concepts: extractedConcepts, conceptsFromCache } = await this.plugin.services.spacedRepetitionGenerator.generateQuestionsForNote({
            file: fakeFile,
            noteContent: unitText,
            provider: this.plugin.settings.flashcardGenerationProvider,
            model: this.plugin.settings.flashcardGenerationModel,
            questionCount: this.questionCount,
            questionTypes,
            additionalInstructions: this.buildUnitInstructions(unit),
            outputLanguage: this.cardsLanguage,
            temperature: this.plugin.settings.flashcardGenerationTemperature,
            maxTokens: this.plugin.settings.flashcardGenerationMaxTokens,
            twoPass: this.plugin.settings.flashcardTwoPassGeneration,
            stripThinking: this.plugin.settings.flashcardStripThinking,
            existingQuestions,
            cachedConcepts,
            paragraphs: paragraphContext,
            onProgress: (stage) => {
              this.generationLog.push(`${unit.label}: ${stage}`);
              this.render();
            },
          });

          // Cache freshly extracted concepts for reuse on subsequent runs.
          if (this.plugin.settings.flashcardTwoPassGeneration && !conceptsFromCache && extractedConcepts.length > 0) {
            try {
              const database = await this.plugin.services.ensureSpacedRepetitionDatabase();
              const unitKey = `${unit.label}|${unit.startPage}-${unit.endPage}`;
              const textHash = await this.hashText(unitText);
              database.cacheConcepts(pdfPath, unitKey, textHash, extractedConcepts);
            } catch (cacheError) {
              console.warn('[FlashcardsFromBookModal] Concept caching failed:', cacheError);
            }
          }

          for (const question of questions) {
            const paraIdx = question.sourceParagraphIndex ?? null;
            const para = paraIdx != null && paraIdx >= 0 && paraIdx < paragraphs.length ? paragraphs[paraIdx] : null;
            question.metadata = {
              ...(question.metadata ?? {}),
              bookPath: pdfPath,
              bookName: fakeFile.basename,
              pages: `${unit.startPage}-${unit.endPage}`,
              sourceLabel: `${fakeFile.basename} — ${unit.label} (p. ${unit.startPage}–${unit.endPage})`,
              sourceExcerpt: question.source?.sourceExcerpt,
              bookLanguage: this.bookLanguage,
              generatedBy: 'flashcards-from-book',
              sourceParagraphIndex: paraIdx,
            };
            question.bookPath = pdfPath;
            question.bookName = fakeFile.basename;
            question.topLevelLabel = unit.topLevelLabel;
            question.topLevelPageStart = unit.startPage;
            question.topLevelPageEnd = unit.endPage;
            question.sectionLabel = unit.label;
            question.paragraphIndex = paraIdx;
            question.paragraphPage = para?.page ?? null;
            this.generated.push(question);
          }
          this.generationLog.push(`${unit.label}: ${questions.length} cards`);
        } catch (unitError) {
          console.error(`Book flashcard generation failed for ${unit.label}:`, unitError);
          this.failedUnitLabels.add(unit.label);
          this.generationLog.push(`${unit.label}: FAILED — ${unitError instanceof Error ? unitError.message : 'Unknown error'}`);
        }
        this.render();
      }

      const failedCount = units.filter((unit) => this.failedUnitLabels.has(unit.label)).length;
      if (this.generated.length === 0 && failedCount > 0) {
        new Notice(`All attempted unit(s) failed — last error: ${this.generationLog[this.generationLog.length - 1]}`);
      } else if (failedCount > 0) {
        new Notice(`Generated ${this.generated.length} card(s); ${failedCount} unit(s) failed — use Retry Failed Units`);
      } else {
        new Notice(`Generated ${this.generated.length} card(s) from ${units.length} unit(s)`);
      }
    } catch (error) {
      console.error('Book flashcard generation failed:', error);
      new Notice(`Generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      this.isGenerating = false;
      this.render();
    }
  }

  private buildUnitInstructions(unit: BookUnit): string {
    return [
      `The source text is an excerpt from the book "${this.selectedBookRelPath}" (${unit.label}, pages ${unit.startPage}-${unit.endPage}).`,
      `The book is written in ${this.bookLanguage === 'ru' ? 'Russian' : 'English'}.`,
      'Focus on the material contained in this excerpt only.',
    ].join(' ');
  }

  private async saveGenerated(): Promise<void> {
    if (this.generated.length === 0) {
      return;
    }

    try {
      const database = await this.plugin.services.ensureSpacedRepetitionDatabase();

      let studySetId: string | null = this.selectedStudySetId || null;
      if (this.newDeckName) {
        studySetId = await database.createStudySet({
          name: this.newDeckName,
          sourceType: 'manual',
          sourceRule: { type: 'book', sourcePath: this.selectedBookRelPath },
          tags: ['flashcards', 'book'],
        });
      }

      const questionIds = await database.createQuestions(
        this.generated.map((question) => ({
          ...question,
          studySetId,
          metadata: {
            ...(question.metadata ?? {}),
            deckName: studySetId ? this.deckSuggestion() : undefined,
          },
        })),
      );

      new Notice(`Saved ${questionIds.length} card(s)`);
      this.generated = [];
      this.generationLog = [];
      this.render();
    } catch (error) {
      console.error('Failed to save book flashcards:', error);
      new Notice(`Failed to save cards: ${error instanceof Error ? error.message : 'Unknown error'}`);
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

  private deckSuggestion(): string {
    return this.selectedBookRelPath.replace(/\.pdf$/i, '') || 'Book deck';
  }

  private formatBytes(bytes: number): string {
    if (bytes > 1024 * 1024) {
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }
    return `${Math.round(bytes / 1024)} KB`;
  }

  private async hashText(text: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    if (typeof crypto !== 'undefined' && crypto.subtle) {
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
    }
    let hash = 0;
    for (let i = 0; i < data.length; i++) {
      hash = ((hash << 5) - hash + data[i]) | 0;
    }
    return String(hash);
  }
}
