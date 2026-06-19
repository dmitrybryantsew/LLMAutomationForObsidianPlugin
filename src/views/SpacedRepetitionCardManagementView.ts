import { ItemView, Notice, Setting, WorkspaceLeaf, normalizePath } from 'obsidian';
import type GptFreeTextGeneratorPlugin from '../main';
import { VIEW_TYPE_SPACED_REPETITION_CARD_MANAGEMENT } from '../constants';
import { CardManagementRecord } from '../utils/spacedRepetition/SpacedRepetitionDatabase';
import { ExactAnswerField, SpacedRepetitionStudySetRecord } from '../types/spacedRepetition';
import {
  formatExactAnswerFieldLine,
  normalizeExactAnswerField,
  parseExactAnswerFieldsText,
} from '../utils/spacedRepetition/ExactAnswerMatcher';
import {
  FlashcardDuplicateGroup,
  chooseDuplicateKeeper,
  findFlashcardDuplicateGroups,
} from '../utils/spacedRepetition/FlashcardDedupe';

type CardStatusFilter = 'available' | 'enabled' | 'suspended' | 'archived' | 'all';

const QUESTION_TYPES = [
  'multiple_choice',
  'typed_exact',
  'typed_fields_exact',
  'typed_llm_checked',
  'self_check',
];

export class SpacedRepetitionCardManagementView extends ItemView {
  private plugin: GptFreeTextGeneratorPlugin;
  private cards: CardManagementRecord[] = [];
  private studySets: SpacedRepetitionStudySetRecord[] = [];
  private loading = false;
  private search = '';
  private statusFilter: CardStatusFilter = 'available';
  private deckFilter = '';
  private typeFilter = '';
  private editingCardId: string | null = null;
  private draftQuestionName = '';
  private draftQuestionText = '';
  private draftAnswerText = '';
  private draftExactFieldsText = '';
  private draftStudySetId = '__none__';
  private duplicateGroups: FlashcardDuplicateGroup<CardManagementRecord>[] = [];

  constructor(leaf: WorkspaceLeaf, plugin: GptFreeTextGeneratorPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_SPACED_REPETITION_CARD_MANAGEMENT;
  }

  getDisplayText(): string {
    return 'Flashcard Cards';
  }

  async onOpen(): Promise<void> {
    this.contentEl.addClass('spaced-repetition-card-management-view');
    await this.loadCards();
  }

  async onClose(): Promise<void> {
    this.contentEl.empty();
  }

  private async loadCards(): Promise<void> {
    try {
      this.loading = true;
      this.render();

      const database = await this.plugin.services.ensureSpacedRepetitionDatabase();
      this.studySets = database.getStudySets();
      this.cards = database.getCardsForManagement({
        search: this.search,
        enabled: this.getEnabledFilter(),
        archived: this.getArchivedFilter(),
        studySetId: this.getDeckFilter(),
        questionType: this.typeFilter || null,
        limit: 300,
      });
    } catch (error) {
      console.error('Failed to load flashcards:', error);
      new Notice(`Failed to load cards: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      this.loading = false;
      this.render();
    }
  }

  private render(): void {
    const container = this.contentEl;
    container.empty();

    const header = container.createDiv({ cls: 'spaced-repetition-card-management-header' });
    header.createEl('h2', { text: 'Flashcard Cards' });
    header.createEl('div', {
      text: this.loading ? 'Loading...' : `${this.cards.length} shown`,
      cls: 'spaced-repetition-card-management-summary',
    });

    this.renderFilters(container);
    this.renderDuplicateGroups(container);

    const list = container.createDiv({ cls: 'spaced-repetition-card-management-list' });
    if (!this.cards.length) {
      list.createEl('p', { text: 'No cards matched the current filters.' });
      return;
    }

    for (const card of this.cards) {
      this.renderCard(list, card);
    }
  }

  private renderFilters(container: HTMLElement): void {
    const filters = container.createDiv({ cls: 'spaced-repetition-card-management-filters' });

    new Setting(filters)
      .setName('Search')
      .addText((text) => {
        text
          .setPlaceholder('Question, answer, note, deck')
          .setValue(this.search)
          .onChange((value) => {
            this.search = value;
          });
        text.inputEl.addEventListener('keydown', (event) => {
          if (event.key === 'Enter') {
            this.loadCards();
          }
        });
      });

    new Setting(filters)
      .setName('Filters')
      .addDropdown((dropdown) => {
        dropdown
          .addOption('all', 'All cards')
          .addOption('available', 'Not archived')
          .addOption('enabled', 'Enabled')
          .addOption('suspended', 'Suspended')
          .addOption('archived', 'Archived')
          .setValue(this.statusFilter)
          .onChange((value) => {
            this.statusFilter = value as CardStatusFilter;
            this.loadCards();
          });
      })
      .addDropdown((dropdown) => {
        dropdown.addOption('', 'All decks');
        dropdown.addOption('__none__', 'No deck');
        for (const set of this.studySets) {
          dropdown.addOption(set.id, set.name);
        }
        dropdown
          .setValue(this.deckFilter)
          .onChange((value) => {
            this.deckFilter = value;
            this.loadCards();
          });
      })
      .addDropdown((dropdown) => {
        dropdown.addOption('', 'All types');
        for (const type of QUESTION_TYPES) {
          dropdown.addOption(type, type);
        }
        dropdown
          .setValue(this.typeFilter)
          .onChange((value) => {
            this.typeFilter = value;
            this.loadCards();
          });
      });

    new Setting(filters)
      .addButton((button) => button
        .setButtonText('Apply')
        .setCta()
        .onClick(() => this.loadCards()))
      .addButton((button) => button
        .setButtonText('Clear')
        .onClick(() => {
          this.search = '';
          this.statusFilter = 'available';
          this.deckFilter = '';
          this.typeFilter = '';
          this.editingCardId = null;
          this.duplicateGroups = [];
          this.loadCards();
        }))
      .addButton((button) => button
        .setButtonText('Refresh')
        .onClick(() => this.loadCards()));

    new Setting(filters)
      .addButton((button) => button
        .setButtonText('Find Duplicates')
        .onClick(() => this.findDuplicates()))
      .addButton((button) => button
        .setButtonText('Archive Duplicates')
        .setDisabled(this.duplicateGroups.length === 0)
        .onClick(() => this.archiveDuplicateCards()))
      .addButton((button) => button
        .setButtonText('Export Markdown')
        .setDisabled(this.cards.length === 0)
        .onClick(() => this.exportShownCards('markdown')))
      .addButton((button) => button
        .setButtonText('Export JSON')
        .setDisabled(this.cards.length === 0)
        .onClick(() => this.exportShownCards('json')));
  }

  private renderDuplicateGroups(container: HTMLElement): void {
    if (!this.duplicateGroups.length) {
      return;
    }

    const panel = container.createDiv({ cls: 'spaced-repetition-card-management-duplicates' });
    const duplicateCount = this.duplicateGroups.reduce((sum, group) => sum + group.cards.length - 1, 0);
    panel.createEl('h3', { text: `Duplicates: ${duplicateCount} extra card(s) in ${this.duplicateGroups.length} group(s)` });

    for (const group of this.duplicateGroups.slice(0, 10)) {
      const keeper = chooseDuplicateKeeper(group.cards);
      const groupEl = panel.createDiv({ cls: 'spaced-repetition-card-management-duplicate-group' });
      groupEl.createEl('div', {
        text: `Keep: ${keeper.questionName || keeper.questionText}`,
        cls: 'spaced-repetition-card-management-duplicate-keeper',
      });

      for (const card of group.cards.filter((item) => item.id !== keeper.id)) {
        groupEl.createEl('div', {
          text: `Duplicate: ${card.questionName || card.questionText} (${card.studySetName ?? 'No deck'})`,
          cls: 'spaced-repetition-card-management-duplicate-card',
        });
      }
    }
  }

  private renderCard(container: HTMLElement, card: CardManagementRecord): void {
    const row = container.createDiv({
      cls: this.getCardRowClass(card),
    });

    const top = row.createDiv({ cls: 'spaced-repetition-card-management-row-top' });
    top.createEl('div', {
      text: card.questionName || card.questionType,
      cls: 'spaced-repetition-card-management-title',
    });
    const status = this.getCardStatus(card);
    top.createEl('div', {
      text: status.label,
      cls: status.kind === 'enabled'
        ? 'spaced-repetition-card-management-status'
        : 'spaced-repetition-card-management-status spaced-repetition-card-management-status-suspended',
    });

    const context = [
      card.studySetName ?? 'No deck',
      card.notePath,
      card.archivedAt ? `Archived: ${this.formatDate(card.archivedAt)}` : null,
      `Due: ${this.formatDate(card.nextRepeatAt)}`,
    ].filter((part): part is string => Boolean(part));
    row.createEl('div', {
      text: context.join(' | '),
      cls: 'spaced-repetition-card-management-context',
    });

    if (this.editingCardId === card.id) {
      this.renderEditForm(row, card);
    } else {
      row.createEl('div', {
        text: card.questionText,
        cls: 'spaced-repetition-card-management-question',
      });
      row.createEl('div', {
        text: card.answerText ?? '',
        cls: 'spaced-repetition-card-management-answer',
      });
      this.renderCardActions(row, card);
    }
  }

  private renderCardActions(container: HTMLElement, card: CardManagementRecord): void {
    const actions = container.createDiv({ cls: 'spaced-repetition-card-management-actions' });

    actions.createEl('button', { text: 'Edit' })
      .addEventListener('click', () => this.startEditing(card));

    actions.createEl('button', { text: card.enabled ? 'Suspend' : 'Restore' })
      .addEventListener('click', () => this.setCardEnabled(card, !card.enabled));

    actions.createEl('button', { text: card.archivedAt ? 'Unarchive' : 'Archive' })
      .addEventListener('click', () => this.setCardArchived(card, !card.archivedAt));
  }

  private renderEditForm(container: HTMLElement, card: CardManagementRecord): void {
    const form = container.createDiv({ cls: 'spaced-repetition-card-management-edit' });

    new Setting(form)
      .setName('Name')
      .addText((text) => text
        .setPlaceholder('Optional card label')
        .setValue(this.draftQuestionName)
        .onChange((value) => {
          this.draftQuestionName = value;
        }));

    new Setting(form)
      .setName('Deck')
      .addDropdown((dropdown) => {
        dropdown.addOption('__none__', 'No deck');
        for (const set of this.studySets) {
          dropdown.addOption(set.id, set.name);
        }
        dropdown
          .setValue(this.draftStudySetId)
          .onChange((value) => {
            this.draftStudySetId = value;
          });
      });

    const question = form.createEl('textarea', {
      cls: 'spaced-repetition-card-management-textarea',
      attr: { rows: '4', placeholder: 'Question' },
    });
    question.value = this.draftQuestionText;
    question.addEventListener('input', () => {
      this.draftQuestionText = question.value;
    });

    const answer = form.createEl('textarea', {
      cls: 'spaced-repetition-card-management-textarea',
      attr: { rows: '4', placeholder: 'Answer' },
    });
    answer.value = this.draftAnswerText;
    answer.addEventListener('input', () => {
      this.draftAnswerText = answer.value;
    });

    if (card.questionType === 'typed_fields_exact') {
      form.createEl('div', {
        text: 'Exact fields, one per line: Label::Answer or Label::Answer::{"aliases":["Alt"],"normalization":"csharp","caseSensitive":true,"normalizeWhitespace":false,"regex":"^...$"}',
        cls: 'spaced-repetition-card-management-help',
      });

      const exactFields = form.createEl('textarea', {
        cls: 'spaced-repetition-card-management-textarea spaced-repetition-card-management-exact-fields',
        attr: { rows: '5', placeholder: 'Method name::SelectMany\nParameter order::source, collectionSelector, resultSelector' },
      });
      exactFields.value = this.draftExactFieldsText;
      exactFields.addEventListener('input', () => {
        this.draftExactFieldsText = exactFields.value;
      });
    }

    const actions = form.createDiv({ cls: 'spaced-repetition-card-management-actions' });
    actions.createEl('button', { text: 'Save' })
      .addEventListener('click', () => this.saveCard(card));
    actions.createEl('button', { text: 'Cancel' })
      .addEventListener('click', () => {
        this.editingCardId = null;
        this.render();
      });
  }

  private startEditing(card: CardManagementRecord): void {
    this.editingCardId = card.id;
    this.draftQuestionName = card.questionName ?? '';
    this.draftQuestionText = card.questionText;
    this.draftAnswerText = card.answerText ?? '';
    this.draftExactFieldsText = this.formatExactFieldsForEdit(card.metadata);
    this.draftStudySetId = card.studySetId ?? '__none__';
    this.render();
  }

  private async saveCard(card: CardManagementRecord): Promise<void> {
    if (!this.draftQuestionText.trim()) {
      new Notice('Question cannot be empty');
      return;
    }

    try {
      const exactFields = card.questionType === 'typed_fields_exact'
        ? this.parseExactFields(this.draftExactFieldsText)
        : null;

      if (card.questionType === 'typed_fields_exact' && (!exactFields || exactFields.length === 0)) {
        new Notice('Typed exact field cards need at least one Label::Answer field');
        return;
      }

      const metadata = exactFields
        ? { ...card.metadata, exactFields }
        : undefined;
      const answerText = exactFields
        ? exactFields.map((field) => `${field.label}: ${field.answer}`).join('\n')
        : this.draftAnswerText.trim() || null;

      const database = await this.plugin.services.ensureSpacedRepetitionDatabase();
      await database.updateQuestionContent({
        questionId: card.id,
        questionName: this.draftQuestionName.trim() || null,
        questionText: this.draftQuestionText.trim(),
        answerText,
        metadata,
      });

      const nextStudySetId = this.draftStudySetId === '__none__' ? null : this.draftStudySetId;
      if (nextStudySetId !== card.studySetId) {
        await database.setQuestionStudySet(card.id, nextStudySetId);
      }

      this.editingCardId = null;
      new Notice('Card updated');
      await this.loadCards();
    } catch (error) {
      console.error('Failed to update card:', error);
      new Notice(`Failed to update card: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async setCardEnabled(card: CardManagementRecord, enabled: boolean): Promise<void> {
    try {
      const database = await this.plugin.services.ensureSpacedRepetitionDatabase();
      await database.setQuestionEnabled(card.id, enabled);
      new Notice(enabled ? 'Card restored' : 'Card suspended');
      await this.loadCards();
    } catch (error) {
      console.error('Failed to update card enabled state:', error);
      new Notice(`Failed to update card: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async setCardArchived(card: CardManagementRecord, archived: boolean): Promise<void> {
    try {
      const database = await this.plugin.services.ensureSpacedRepetitionDatabase();
      await database.setQuestionArchived(card.id, archived);
      new Notice(archived ? 'Card archived' : 'Card unarchived');
      await this.loadCards();
    } catch (error) {
      console.error('Failed to update card archive state:', error);
      new Notice(`Failed to update card: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private findDuplicates(): void {
    this.duplicateGroups = findFlashcardDuplicateGroups(this.cards.filter((card) => !card.archivedAt));
    const duplicateCount = this.duplicateGroups.reduce((sum, group) => sum + group.cards.length - 1, 0);
    new Notice(duplicateCount ? `Found ${duplicateCount} duplicate card(s)` : 'No duplicates found in shown cards');
    this.render();
  }

  private async archiveDuplicateCards(): Promise<void> {
    if (!this.duplicateGroups.length) {
      this.findDuplicates();
      return;
    }

    const duplicateIds = new Set<string>();
    for (const group of this.duplicateGroups) {
      const keeper = chooseDuplicateKeeper(group.cards);
      for (const card of group.cards) {
        if (card.id !== keeper.id) {
          duplicateIds.add(card.id);
        }
      }
    }

    if (duplicateIds.size === 0) {
      new Notice('No duplicate cards to archive');
      return;
    }

    if (!confirm(`Archive ${duplicateIds.size} duplicate card(s)? The oldest copy in each group will stay active.`)) {
      return;
    }

    try {
      const database = await this.plugin.services.ensureSpacedRepetitionDatabase();
      for (const questionId of duplicateIds) {
        await database.setQuestionArchived(questionId, true);
      }

      this.duplicateGroups = [];
      new Notice(`Archived ${duplicateIds.size} duplicate card(s)`);
      await this.loadCards();
    } catch (error) {
      console.error('Failed to archive duplicate cards:', error);
      new Notice(`Failed to archive duplicates: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async exportShownCards(format: 'markdown' | 'json'): Promise<void> {
    if (!this.cards.length) {
      new Notice('No cards to export');
      return;
    }

    try {
      const folder = normalizePath(`${this.plugin.settings.flashcardFolder || 'Flashcards'}/Exports`);
      await this.ensureVaultFolder(folder);
      const timestamp = this.createTimestamp();
      const extension = format === 'json' ? 'json' : 'md';
      const path = normalizePath(`${folder}/flashcards-export-${timestamp}.${extension}`);
      const content = format === 'json'
        ? this.renderCardsJson(this.cards)
        : this.renderCardsMarkdown(this.cards);

      const file = await this.app.vault.create(path, content);
      await this.app.workspace.getLeaf(false).openFile(file);
      new Notice(`Exported ${this.cards.length} card(s) to ${path}`);
    } catch (error) {
      console.error('Failed to export flashcards:', error);
      new Notice(`Failed to export cards: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private getEnabledFilter(): boolean | null {
    if (this.statusFilter === 'enabled') {
      return true;
    }

    if (this.statusFilter === 'suspended') {
      return false;
    }

    return null;
  }

  private getArchivedFilter(): boolean | null {
    if (this.statusFilter === 'archived') {
      return true;
    }

    if (this.statusFilter === 'available' || this.statusFilter === 'enabled' || this.statusFilter === 'suspended') {
      return false;
    }

    return null;
  }

  private getCardRowClass(card: CardManagementRecord): string {
    const classes = ['spaced-repetition-card-management-row'];
    if (!card.enabled) {
      classes.push('spaced-repetition-card-management-row-suspended');
    }
    if (card.archivedAt) {
      classes.push('spaced-repetition-card-management-row-archived');
    }
    return classes.join(' ');
  }

  private getCardStatus(card: CardManagementRecord): { label: string; kind: 'enabled' | 'disabled' } {
    if (card.archivedAt) {
      return { label: 'Archived', kind: 'disabled' };
    }

    return card.enabled
      ? { label: 'Enabled', kind: 'enabled' }
      : { label: 'Suspended', kind: 'disabled' };
  }

  private getDeckFilter(): string | null | undefined {
    if (this.deckFilter === '__none__') {
      return null;
    }

    return this.deckFilter || undefined;
  }

  private formatExactFieldsForEdit(metadata: Record<string, unknown>): string {
    const fields = this.getExactFields(metadata);
    return fields.map((field) => formatExactAnswerFieldLine(field)).join('\n');
  }

  private parseExactFields(value: string): ExactAnswerField[] {
    return parseExactAnswerFieldsText(value);
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

  private formatDate(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }

    return date.toLocaleString();
  }

  private renderCardsJson(cards: CardManagementRecord[]): string {
    return JSON.stringify({
      exportedAt: new Date().toISOString(),
      filters: {
        search: this.search,
        status: this.statusFilter,
        deck: this.deckFilter,
        type: this.typeFilter,
      },
      cards,
    }, null, 2);
  }

  private renderCardsMarkdown(cards: CardManagementRecord[]): string {
    const lines = [
      '# Flashcard Export',
      '',
      `Exported: ${new Date().toISOString()}`,
      `Cards: ${cards.length}`,
      '',
    ];

    for (const card of cards) {
      lines.push(
        `## ${card.questionName || card.questionType}`,
        '',
        `- ID: \`${card.id}\``,
        `- Type: \`${card.questionType}\``,
        `- Deck: ${card.studySetName ?? 'No deck'}`,
        `- Note: ${card.notePath ?? 'No note'}`,
        `- Status: ${this.getCardStatus(card).label}`,
        `- Due: ${card.nextRepeatAt}`,
        '',
        '### Question',
        '',
        card.questionText,
        '',
        '### Answer',
        '',
        card.answerText ?? '',
        ''
      );

      if (Object.keys(card.metadata).length) {
        lines.push('### Metadata', '', '```json', JSON.stringify(card.metadata, null, 2), '```', '');
      }
    }

    return lines.join('\n');
  }

  private async ensureVaultFolder(folder: string): Promise<void> {
    const parts = normalizePath(folder).split('/').filter(Boolean);
    let current = '';
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      if (!await this.app.vault.adapter.exists(current)) {
        await this.app.vault.createFolder(current);
      }
    }
  }

  private createTimestamp(): string {
    return new Date().toISOString().replace(/[:.]/g, '-');
  }
}
