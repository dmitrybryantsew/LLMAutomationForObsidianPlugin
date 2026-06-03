import { App, Modal, Notice, Setting, TFile } from 'obsidian';
import type GptFreeTextGeneratorPlugin from '../main';
import { NoteChatMessageRecord } from '../types/spacedRepetition';

export class SpacedRepetitionNoteChatModal extends Modal {
  private plugin: GptFreeTextGeneratorPlugin;
  private file: TFile;
  private noteContent = '';
  private noteId: string | null = null;
  private chatId: string | null = null;
  private messages: NoteChatMessageRecord[] = [];
  private prompt = '';
  private isSending = false;
  private model: string;

  constructor(app: App, plugin: GptFreeTextGeneratorPlugin, file: TFile) {
    super(app);
    this.plugin = plugin;
    this.file = file;
    this.model = plugin.settings.ollamaTextModel || 'gemma4:31b-cloud';
  }

  async onOpen(): Promise<void> {
    this.modalEl.addClass('spaced-repetition-note-chat-modal');
    await this.initializeChat();
    this.render();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private async initializeChat(): Promise<void> {
    const database = await this.plugin.services.ensureSpacedRepetitionDatabase();
    this.noteContent = await this.app.vault.read(this.file);
    this.noteId = await database.upsertNoteFromFile(this.file, this.createSimpleContentHash(this.noteContent));

    const existingChat = database.getLatestNoteChat(this.noteId);
    this.chatId = existingChat?.id ?? await database.createNoteChat(this.noteId, `Chat: ${this.file.basename}`, {
      notePath: this.file.path,
    });
    this.messages = database.getNoteChatMessages(this.chatId);
  }

  private render(): void {
    const container = this.contentEl;
    container.empty();

    container.createEl('h2', { text: `Chat With ${this.file.basename}` });

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
      messageEl.createEl('div', {
        text: message.content,
        cls: 'spaced-repetition-note-chat-content',
      });
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
  }

  private async sendMessage(): Promise<void> {
    if (!this.chatId || !this.noteId) {
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
    if (!this.noteId) {
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

  private buildChatPrompt(currentPrompt: string): string {
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
