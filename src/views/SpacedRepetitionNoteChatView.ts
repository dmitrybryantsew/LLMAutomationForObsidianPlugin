import { ItemView, MarkdownRenderer, Notice, Setting, TFile, WorkspaceLeaf } from 'obsidian';
import { VIEW_TYPE_SPACED_REPETITION_NOTE_CHAT } from '../constants';
import type GptFreeTextGeneratorPlugin from '../main';
import { VaultFileSelectorModal } from '../modals/VaultFileSelectorModal';
import { NoteChatMessageRecord, NoteChatRecord } from '../types/spacedRepetition';
import { PdfHelper } from '../utils/PdfHelper';

const MAX_EXTRA_CONTEXT_CHARS = 18000;
const MAX_CONTEXT_FILE_CHARS = 8000;
const TEXT_CONTEXT_EXTENSIONS = new Set([
  '',
  'adoc',
  'asm',
  'bat',
  'c',
  'cfg',
  'clj',
  'cmd',
  'cpp',
  'cs',
  'css',
  'csv',
  'dart',
  'go',
  'h',
  'hpp',
  'html',
  'ini',
  'java',
  'js',
  'json',
  'jsx',
  'kt',
  'lua',
  'md',
  'mdx',
  'php',
  'ps1',
  'py',
  'rb',
  'rs',
  'scss',
  'sh',
  'sql',
  'svelte',
  'toml',
  'ts',
  'tsx',
  'txt',
  'vue',
  'xml',
  'yaml',
  'yml',
]);

export class SpacedRepetitionNoteChatView extends ItemView {
  private plugin: GptFreeTextGeneratorPlugin;
  private file: TFile | null = null;
  private noteContent = '';
  private noteId: string | null = null;
  private chatId: string | null = null;
  private contextFiles: Set<TFile> = new Set();
  private chats: NoteChatRecord[] = [];
  private messages: NoteChatMessageRecord[] = [];
  private prompt = '';
  private isSending = false;
  private isLoading = false;

  constructor(leaf: WorkspaceLeaf, plugin: GptFreeTextGeneratorPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_SPACED_REPETITION_NOTE_CHAT;
  }

  getDisplayText(): string {
    return this.file ? `Chat: ${this.file.basename}` : 'Note Chat';
  }

  getIcon(): string {
    return 'messages-square';
  }

  async onOpen(): Promise<void> {
    this.contentEl.addClass('spaced-repetition-note-chat-view');
    const activeFile = this.app.workspace.getActiveFile();
    if (activeFile) {
      await this.setFile(activeFile);
    } else {
      this.render();
    }
  }

  async onClose(): Promise<void> {
    this.contentEl.empty();
  }

  async setFile(file: TFile): Promise<void> {
    this.file = file;
    this.noteContent = '';
    this.noteId = null;
    this.chatId = null;
    this.contextFiles.clear();
    this.chats = [];
    this.messages = [];
    this.prompt = '';
    this.isLoading = true;
    this.render();

    try {
      await this.initializeChat(file);
    } catch (error) {
      console.error('Failed to initialize note chat view:', error);
      new Notice(`Failed to initialize note chat: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      this.isLoading = false;
      this.render();
    }
  }

  private async initializeChat(file: TFile): Promise<void> {
    const database = await this.plugin.services.ensureSpacedRepetitionDatabase();
    this.noteContent = await this.app.vault.read(file);
    this.noteId = await database.upsertNoteFromFile(file, this.createSimpleContentHash(this.noteContent));

    this.chats = database.getNoteChats(this.noteId);
    this.chatId = this.chats[0]?.id ?? await this.createChatForCurrentNote();
    this.chats = database.getNoteChats(this.noteId);
    this.messages = database.getNoteChatMessages(this.chatId);
  }

  private render(): void {
    const container = this.contentEl;
    container.empty();

    const header = container.createDiv({ cls: 'spaced-repetition-note-chat-header' });
    header.createEl('h2', { text: this.file ? `Chat With ${this.file.basename}` : 'Chat With Current Note' });
    if (this.file) {
      header.createEl('div', {
        text: this.file.path,
        cls: 'spaced-repetition-note-chat-path',
      });
    }

    new Setting(container)
      .addButton((button) => {
        button
          .setButtonText('Use Active Note')
          .onClick(() => this.useActiveNote());
      })
      .addButton((button) => {
        button
          .setButtonText('Open Source Note')
          .setDisabled(!this.file)
          .onClick(() => this.openSourceNote());
      })
      .addButton((button) => {
        button
          .setButtonText('Add Context File')
          .setDisabled(!this.file)
          .onClick(() => this.openContextFileSelector());
      })
      .addButton((button) => {
        button
          .setButtonText('Add Mentioned Files')
          .setDisabled(!this.file)
          .onClick(() => this.addMentionedContextFiles());
      });

    if (!this.file) {
      this.renderEmptyState(container, 'Open a note, then use this pane to chat with it.');
      return;
    }

    if (this.isLoading) {
      this.renderEmptyState(container, 'Loading note chat...');
      return;
    }

    this.renderContextFiles(container);

    const history = container.createDiv({ cls: 'spaced-repetition-note-chat-history' });
    if (this.messages.length === 0) {
      history.createEl('div', {
        text: 'No saved chat messages yet.',
        cls: 'spaced-repetition-note-chat-empty',
      });
    }

    for (const message of this.messages) {
      const messageEl = history.createDiv({
        cls: `spaced-repetition-note-chat-message spaced-repetition-note-chat-${message.role}`,
      });
      messageEl.createEl('div', {
        text: message.role === 'assistant' ? 'Ollama' : message.role,
        cls: 'spaced-repetition-note-chat-role',
      });
      const contentEl = messageEl.createDiv({ cls: 'spaced-repetition-note-chat-content' });
      MarkdownRenderer.renderMarkdown(message.content, contentEl, this.file?.path ?? '', this);
    }

    const input = container.createEl('textarea', {
      cls: 'spaced-repetition-note-chat-input',
      attr: {
        placeholder: 'Ask about this note...',
      },
    });
    input.value = this.prompt;
    input.addEventListener('input', () => {
      this.prompt = input.value;
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        this.sendMessage();
      }
    });

    const actionSetting = new Setting(container)
      .setName('Chat');
    actionSetting.settingEl.addClass('spaced-repetition-note-chat-actions');
    actionSetting
      .addDropdown((dropdown) => {
        for (const chat of this.chats) {
          dropdown.addOption(chat.id, this.formatChatTitle(chat));
        }
        if (this.chatId) {
          dropdown.setValue(this.chatId);
        }
        dropdown.onChange((value) => {
          this.selectChat(value);
        });
      })
      .addButton((button) => {
        button
          .setButtonText('New Chat')
          .setDisabled(!this.noteId)
          .onClick(() => this.createAndSelectNewChat());
      })
      .addButton((button) => {
        button
          .setButtonText(this.isSending ? 'Sending...' : 'Send')
          .setCta()
          .setDisabled(this.isSending)
          .onClick(() => this.sendMessage());
      })
      .addButton((button) => {
        button
          .setButtonText('Save Last Reply As Review Question')
          .setDisabled(!this.getLastAssistantMessage() || !this.getLastUserMessage())
          .onClick(() => this.saveLastReplyAsQuestion());
      });

    window.setTimeout(() => {
      history.scrollTop = history.scrollHeight;
    }, 0);
  }

  private renderEmptyState(container: HTMLElement, message: string): void {
    container.createEl('div', {
      text: message,
      cls: 'spaced-repetition-note-chat-empty',
    });
  }

  private async useActiveNote(): Promise<void> {
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile) {
      new Notice('No active note');
      return;
    }

    await this.setFile(activeFile);
  }

  private async openSourceNote(): Promise<void> {
    if (!this.file) {
      return;
    }

    await this.app.workspace.getLeaf(false).openFile(this.file);
  }

  private openContextFileSelector(): void {
    new VaultFileSelectorModal(
      this.app,
      (file: TFile) => this.addContextFile(file),
      {
        placeholder: 'Type to filter text, code, markdown, or PDF files...',
        filter: (file) => this.isSupportedContextFile(file),
      }
    ).open();
  }

  private addContextFile(file: TFile): void {
    if (this.file?.path === file.path) {
      new Notice('The source note is already included');
      return;
    }

    const existing = [...this.contextFiles].some((contextFile) => contextFile.path === file.path);
    if (existing) {
      new Notice('File already in context');
      return;
    }

    this.contextFiles.add(file);
    this.render();
  }

  private addMentionedContextFiles(): void {
    if (!this.file) {
      return;
    }

    const cache = this.app.metadataCache.getFileCache(this.file);
    if (!cache) {
      new Notice('No links found in this note');
      return;
    }

    let addedCount = 0;
    const candidates = [...(cache.links ?? []), ...(cache.embeds ?? [])];
    for (const candidate of candidates) {
      const linkedFile = this.app.metadataCache.getFirstLinkpathDest(candidate.link, this.file.path);
      if (!linkedFile || linkedFile.path === this.file.path || !this.isSupportedContextFile(linkedFile)) {
        continue;
      }

      const existing = [...this.contextFiles].some((contextFile) => contextFile.path === linkedFile.path);
      if (!existing) {
        this.contextFiles.add(linkedFile);
        addedCount += 1;
      }
    }

    this.render();
    new Notice(addedCount > 0 ? `Added ${addedCount} context file(s)` : 'No new supported context files found');
  }

  private renderContextFiles(container: HTMLElement): void {
    if (this.contextFiles.size === 0) {
      return;
    }

    const contextContainer = container.createDiv({ cls: 'spaced-repetition-note-chat-context-files' });
    for (const file of this.contextFiles) {
      const chip = contextContainer.createDiv({ cls: 'spaced-repetition-note-chat-context-chip' });
      chip.createSpan({
        text: file.name,
        cls: 'spaced-repetition-note-chat-context-name',
      });
      const removeButton = chip.createEl('button', {
        text: 'x',
        cls: 'spaced-repetition-note-chat-context-remove',
        attr: {
          'aria-label': `Remove ${file.path} from context`,
        },
      });
      removeButton.addEventListener('click', () => {
        this.contextFiles.delete(file);
        this.render();
      });
    }
  }

  private async sendMessage(): Promise<void> {
    if (!this.file || !this.chatId || !this.noteId) {
      new Notice('Note chat is not initialized');
      return;
    }

    const prompt = this.prompt.trim();
    if (!prompt) {
      new Notice('Write a message first');
      return;
    }

    try {
      this.isSending = true;
      this.render();

      const database = await this.plugin.services.ensureSpacedRepetitionDatabase();
      await database.addNoteChatMessage({ chatId: this.chatId, role: 'user', content: prompt });
      this.messages = database.getNoteChatMessages(this.chatId);

      const client = this.plugin.services.llmClientService.getClientForProvider('ollama')
        ?? this.plugin.services.llmClientService.getClient();
      if (!client) {
        throw new Error('Ollama client is not available');
      }

      const response = await client.generateText({
        model: this.plugin.settings.ollamaTextModel || 'gemma4:31b-cloud',
        message: await this.buildChatPrompt(prompt),
        temperature: 0.3,
        maxTokens: 2200,
      });

      await database.addNoteChatMessage({
        chatId: this.chatId,
        role: 'assistant',
        content: response.output,
        metadata: response.metadata as unknown as Record<string, unknown>,
      });

      this.prompt = '';
      this.chats = database.getNoteChats(this.noteId);
      this.messages = database.getNoteChatMessages(this.chatId);
    } catch (error) {
      console.error('Failed to send note chat message:', error);
      new Notice(`Failed to send note chat message: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      this.isSending = false;
      this.render();
    }
  }

  private async saveLastReplyAsQuestion(): Promise<void> {
    if (!this.file || !this.noteId) {
      new Notice('Note chat is not initialized');
      return;
    }

    const lastUser = this.getLastUserMessage();
    const lastAssistant = this.getLastAssistantMessage();
    if (!lastUser || !lastAssistant) {
      new Notice('Need a user question and an Ollama reply first');
      return;
    }

    try {
      const database = await this.plugin.services.ensureSpacedRepetitionDatabase();
      const [questionId] = await database.createQuestions([
        {
          noteId: this.noteId,
          questionName: `Chat: ${lastUser.content.slice(0, 48)}`,
          questionText: lastUser.content,
          questionType: 'self_check',
          answerText: lastAssistant.content,
          answerCheckMode: 'self',
          metadata: {
            createdFrom: 'note_chat',
            chatId: this.chatId,
            userMessageId: lastUser.id,
            assistantMessageId: lastAssistant.id,
          },
        },
      ]);
      await database.recordQuestionSources(questionId, [
        { noteId: this.noteId, sourceLabel: this.file.basename },
      ]);
      new Notice('Saved latest chat reply as a review question');
    } catch (error) {
      console.error('Failed to save chat reply as review question:', error);
      new Notice(`Failed to save review question: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async createAndSelectNewChat(): Promise<void> {
    if (!this.noteId || !this.file) {
      new Notice('Note chat is not initialized');
      return;
    }

    try {
      this.chatId = await this.createChatForCurrentNote();
      const database = await this.plugin.services.ensureSpacedRepetitionDatabase();
      this.chats = database.getNoteChats(this.noteId);
      this.messages = database.getNoteChatMessages(this.chatId);
      this.prompt = '';
      this.render();
    } catch (error) {
      console.error('Failed to create note chat:', error);
      new Notice(`Failed to create note chat: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async createChatForCurrentNote(): Promise<string> {
    if (!this.noteId || !this.file) {
      throw new Error('Note chat is not initialized');
    }

    const database = await this.plugin.services.ensureSpacedRepetitionDatabase();
    return database.createNoteChat(this.noteId, this.buildNewChatTitle(), {
      notePath: this.file.path,
    });
  }

  private async selectChat(chatId: string): Promise<void> {
    if (!this.noteId || chatId === this.chatId) {
      return;
    }

    try {
      const database = await this.plugin.services.ensureSpacedRepetitionDatabase();
      this.chatId = chatId;
      this.messages = database.getNoteChatMessages(chatId);
      this.prompt = '';
      this.render();
    } catch (error) {
      console.error('Failed to select note chat:', error);
      new Notice(`Failed to select note chat: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private buildNewChatTitle(): string {
    const timestamp = new Date().toLocaleString();
    return this.file ? `${this.file.basename} - ${timestamp}` : `Note chat - ${timestamp}`;
  }

  private formatChatTitle(chat: NoteChatRecord): string {
    const updatedAt = new Date(chat.updatedAt);
    const dateLabel = Number.isNaN(updatedAt.getTime()) ? chat.updatedAt : updatedAt.toLocaleString();
    const title = chat.title || 'Untitled chat';
    return `${title} (${dateLabel})`;
  }

  private async buildChatPrompt(currentPrompt: string): Promise<string> {
    if (!this.file) {
      return currentPrompt;
    }

    const extraContext = await this.buildExtraContextSection();
    const recentMessages = this.messages.slice(-8)
      .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
      .join('\n\n');

    return [
      'You are chatting with the user about one Obsidian note.',
      'Use the source note as primary context. If the note does not contain enough information, say so.',
      '',
      `Note title: ${this.file.basename}`,
      `Note path: ${this.file.path}`,
      '',
      `Source note:\n${this.noteContent.slice(0, 12000)}`,
      '',
      extraContext,
      '',
      recentMessages ? `Recent saved chat:\n${recentMessages}` : '',
      '',
      `Current user message:\n${currentPrompt}`,
    ].filter(Boolean).join('\n');
  }

  private async buildExtraContextSection(): Promise<string> {
    if (this.contextFiles.size === 0) {
      return '';
    }

    const sections: string[] = [];
    let usedChars = 0;
    let pdfHelper: PdfHelper | null = null;

    for (const file of this.contextFiles) {
      if (usedChars >= MAX_EXTRA_CONTEXT_CHARS) {
        sections.push('[Additional context truncated to fit prompt budget.]');
        break;
      }

      try {
        const rawContent = file.extension.toLowerCase() === 'pdf'
          ? await (pdfHelper ??= new PdfHelper(this.app)).extractText(file)
          : await this.app.vault.read(file);
        const remaining = MAX_EXTRA_CONTEXT_CHARS - usedChars;
        const limit = Math.min(MAX_CONTEXT_FILE_CHARS, remaining);
        const content = rawContent.slice(0, limit);
        usedChars += content.length;
        sections.push([
          `Context file: ${file.path}`,
          '```',
          content,
          rawContent.length > content.length ? '...[truncated]' : '',
          '```',
        ].filter(Boolean).join('\n'));
      } catch (error) {
        console.error('Failed to read note chat context file:', error);
        sections.push(`Context file: ${file.path}\n[Failed to read file: ${error instanceof Error ? error.message : 'Unknown error'}]`);
      }
    }

    return sections.length ? `Additional context files:\n\n${sections.join('\n\n')}` : '';
  }

  private isSupportedContextFile(file: TFile): boolean {
    const extension = file.extension.toLowerCase();
    return extension === 'pdf' || TEXT_CONTEXT_EXTENSIONS.has(extension);
  }

  private getLastUserMessage(): NoteChatMessageRecord | null {
    return [...this.messages].reverse().find((message) => message.role === 'user') ?? null;
  }

  private getLastAssistantMessage(): NoteChatMessageRecord | null {
    return [...this.messages].reverse().find((message) => message.role === 'assistant') ?? null;
  }

  private createSimpleContentHash(content: string): string {
    let hash = 0;
    for (let index = 0; index < content.length; index += 1) {
      hash = ((hash << 5) - hash + content.charCodeAt(index)) | 0;
    }

    return `simple_${Math.abs(hash)}_${content.length}`;
  }
}
