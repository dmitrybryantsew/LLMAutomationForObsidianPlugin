import { ItemView, MarkdownRenderer, Notice, Setting, TFile, WorkspaceLeaf } from 'obsidian';
import { VIEW_TYPE_SPACED_REPETITION_NOTE_CHAT } from '../constants';
import type GptFreeTextGeneratorPlugin from '../main';
import { NoteChatMessageRecord, NoteChatRecord } from '../types/spacedRepetition';

export class SpacedRepetitionNoteChatView extends ItemView {
  private plugin: GptFreeTextGeneratorPlugin;
  private file: TFile | null = null;
  private noteContent = '';
  private noteId: string | null = null;
  private chatId: string | null = null;
  private chats: NoteChatRecord[] = [];
  private messages: NoteChatMessageRecord[] = [];
  private prompt = '';
  private isSending = false;
  private isLoading = false;
  private model: string;

  constructor(leaf: WorkspaceLeaf, plugin: GptFreeTextGeneratorPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.model = plugin.settings.ollamaTextModel || 'gemma4:31b-cloud';
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
      });

    if (!this.file) {
      this.renderEmptyState(container, 'Open a note, then use this pane to chat with it.');
      return;
    }

    if (this.isLoading) {
      this.renderEmptyState(container, 'Loading note chat...');
      return;
    }

    new Setting(container)
      .setName('Ollama model')
      .addDropdown((dropdown) => {
        const configuredModels = this.plugin.settings.ollamaModels ?? [];
        const models = configuredModels.length
          ? configuredModels
          : [this.model];
        for (const model of models) {
          dropdown.addOption(model, model);
        }
        dropdown.setValue(this.model);
        dropdown.onChange((value) => {
          this.model = value;
        });
      });

    new Setting(container)
      .setName('Chat')
      .setDesc(this.getSelectedChatLabel())
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
      });

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

    new Setting(container)
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
        model: this.model,
        message: this.buildChatPrompt(prompt),
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

  private getSelectedChatLabel(): string {
    const selected = this.chats.find((chat) => chat.id === this.chatId);
    if (!selected) {
      return 'No chat selected';
    }

    const updatedAt = new Date(selected.updatedAt);
    const dateLabel = Number.isNaN(updatedAt.getTime()) ? selected.updatedAt : updatedAt.toLocaleString();
    return `Updated ${dateLabel}`;
  }

  private buildChatPrompt(currentPrompt: string): string {
    if (!this.file) {
      return currentPrompt;
    }

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
      recentMessages ? `Recent saved chat:\n${recentMessages}` : '',
      '',
      `Current user message:\n${currentPrompt}`,
    ].filter(Boolean).join('\n');
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
