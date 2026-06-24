import { App, MarkdownRenderer, Modal, Notice, Setting, TFile } from 'obsidian';
import type GptFreeTextGeneratorPlugin from '../main';
import { NoteChatMessageRecord } from '../types/spacedRepetition';
import { TextProviderId, TEXT_PROVIDER_LABELS } from '../types/providers';

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
  private provider: TextProviderId;

  constructor(app: App, plugin: GptFreeTextGeneratorPlugin, file: TFile) {
    super(app);
    this.plugin = plugin;
    this.file = file;
    this.provider = plugin.settings.noteChatProvider as TextProviderId
      || plugin.settings.defaultLLMProvider as TextProviderId;
    this.model = plugin.settings.noteChatModel
      || this.getDefaultModelForProvider(this.provider);
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
      .setName('Provider')
      .addDropdown((dropdown) => {
        dropdown
          .addOptions(TEXT_PROVIDER_LABELS)
          .setValue(this.provider)
          .onChange(async (value) => {
            const newProvider = value as TextProviderId;
            this.provider = newProvider;
            this.plugin.settings.noteChatProvider = newProvider;
            this.model = this.getDefaultModelForProvider(newProvider);
            this.plugin.settings.noteChatModel = this.model;
            await this.plugin.saveSettings();
            this.render();
          });
      });

    new Setting(container)
      .setName('Model')
      .addDropdown((dropdown) => {
        dropdown
          .addOptions(this.getModelOptionsForProvider(this.provider))
          .setValue(this.model)
          .onChange((value) => {
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
        text: message.role === 'assistant' ? TEXT_PROVIDER_LABELS[this.provider] : message.role,
        cls: 'spaced-repetition-note-chat-role',
      });
      const contentEl = messageEl.createDiv({ cls: 'spaced-repetition-note-chat-content' });
      MarkdownRenderer.renderMarkdown(message.content, contentEl, this.file.path, this.plugin);
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

      const provider = this.plugin.settings.noteChatProvider || this.plugin.settings.defaultLLMProvider;
      const client = this.plugin.services.llmClientService.getClientForProvider(provider as TextProviderId)
        ?? this.plugin.services.llmClientService.getClient();
      if (!client) {
        throw new Error(`No LLM client available for provider "${provider}". Check the API key/base URL for this provider in Settings.`);
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
        metadata: {
          ...(response.metadata as unknown as Record<string, unknown>),
          provider: this.plugin.settings.noteChatProvider || this.plugin.settings.defaultLLMProvider,
        },
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
      new Notice('Need a user question and an assistant reply first');
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
        return models.reduce((acc: Record<string, string>, model: string) => {
          acc[model] = model;
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
