import { 
    WorkspaceLeaf, 
    ItemView, 
    Setting, 
    MarkdownRenderer, 
    Notice, 
    TFile,
    normalizePath,
  } from "obsidian";

  import type GptFreeTextGeneratorPlugin from '../main'; 
  import { sanitizeFilename } from "../utils/helpers";
  import { VIEW_TYPE_GENERATE_TEXT } from "../constants";
  import { TextGeneratorModal } from "../modals/TextGeneratorModal";
  import {ImageGeneratorModal} from "../modals/ImageGeneratorModal";
  import {HistoryLoaderModal} from "../modals/HistoryLoaderModal";
  import { FilePickerModal } from "../modals/FilePickerModal";
  import { FilePreviewModal } from "../modals/FilePreviewModal";
  import { FileManager } from "../utils/FileManager";
  import { HistoryManager } from "../utils/HistoryManager";
  import { ErrorHandler } from "../utils/ErrorHandler";
  import { TextGenerationOptions, OpenRouterError } from '../types/openrouter';
  import { TextProviderId } from '../types/providers';

  interface SelectedFile {
    path: string;
    name: string;
    content?: string;
  }
  
  interface ContextFile {
    path: string;
    name: string;
    content?: string;
  }

class GenerateTextView extends ItemView {
  plugin: GptFreeTextGeneratorPlugin;
  inputMessage: string = "";
  filePath: string = "";
  model: string;
  provider: TextProviderId;
  textType: string;
  language: string;
  temperature: number;
  maxTokens: number;
  topP: number;
  presencePenalty: number;
  frequencyPenalty: number;
  queryHistory: string[] = [];
  private contextFiles: Map<string, ContextFile> = new Map();
  private fileManager: FileManager;
  private historyManager: HistoryManager;
  private conversationShortName: string | null = null;
  constructor(leaf: WorkspaceLeaf, plugin: GptFreeTextGeneratorPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.model = plugin.settings.defaultTextModel;
    this.provider = plugin.settings.defaultLLMProvider;
    this.textType = plugin.settings.defaultTextType;
    this.language = plugin.settings.defaultLanguage;
    this.temperature = plugin.settings.defaultTemperature;
    this.maxTokens = plugin.settings.defaultMaxTokens;
    this.topP = plugin.settings.defaultTopP;
    this.presencePenalty = plugin.settings.defaultPresencePenalty;
    this.frequencyPenalty = plugin.settings.defaultFrequencyPenalty;
    this.fileManager = new FileManager(this.app);
    this.historyManager = new HistoryManager(this.app);
  }

  getViewType() {
    return VIEW_TYPE_GENERATE_TEXT;
  }

// Helper method to generate a short name based on the first message
private generateShortName(message: string): string {
    // Take first 3-5 meaningful words, remove special characters
    const words = message.split(' ')
      .filter(word => word.length > 2) // Filter out short words
      .map(word => word.replace(/[^a-zA-Z0-9]/g, '')) // Remove special characters
      .slice(0, 5);
    
    // Generate short name
    let shortName = words.join('-').toLowerCase();
    // Limit length
    shortName = shortName.slice(0, 30);
    // Add random suffix for uniqueness
    const randomSuffix = Math.random().toString(36).substring(2, 6);
    return `${shortName}-${randomSuffix}`;
  }

  getDisplayText() {
    return "Text Generation Panel";
  }

  async onOpen() {
    const container = this.contentEl;
    container.empty();
    
    const layoutContainer = container.createDiv({
      cls: "generate-text-layout",
    });

    const mainPanel = layoutContainer.createDiv({ cls: "main-panel" });
    
    // History container
    const historyContainer = mainPanel.createDiv({
      cls: "history-container",
    }) as HTMLDivElement;

    // Add context files section
    const contextSection = mainPanel.createDiv({ cls: "context-section" });
    this.updateContextFilesSection(contextSection);

    // Input section
    const inputSection = mainPanel.createDiv({ cls: "input-section" });
    const inputArea = inputSection.createEl("textarea", {
      attr: { rows: "4", placeholder: "Type your query here..." },
      cls: "input-area",
    });
    inputArea.value = this.inputMessage;

    inputArea.addEventListener("input", (e: Event) => {
      const target = e.target as HTMLTextAreaElement;
      this.inputMessage = target.value;
    });

    // Button section
    const buttonSection = inputSection.createDiv({ cls: "button-section" });

    // Generate Text Button
    new Setting(buttonSection)
      .addButton((btn) => {
        btn
          .setButtonText("Generate Text")
          .setCta()
          .onClick(async () => {
            await this.generateText(inputArea, historyContainer);
          });
      });

    // Options Button
    new Setting(buttonSection)
      .addButton((btn) => {
        btn.setButtonText("Options").onClick(() => {
          new TextGeneratorModal(this.app, this.plugin, (options) => {
            this.model = options.model;
            this.provider = options.provider;
            this.language = options.language;
            this.textType = options.textType;
            this.filePath = options.filePath;
            this.temperature = options.temperature;
            this.maxTokens = options.maxTokens;
            this.topP = options.topP;
            this.presencePenalty = options.presencePenalty;
            this.frequencyPenalty = options.frequencyPenalty;
          }).open();
        });
      });

    // Context Files Button
    new Setting(buttonSection)
      .addButton((btn) => {
        btn
          .setButtonText("Add Context Files")
          .onClick(() => {
            new FilePickerModal(this.app, (files) => {
              this.addContextFiles(files);
              this.updateContextFilesSection(contextSection);
            }).open();
          });
      });

    
    // Load History Button
    new Setting(buttonSection)
      .addButton((btn) => {
        btn
          .setButtonText("Load History")
          .onClick(() => {
            new HistoryLoaderModal(this.app, this.plugin, async (filePath) => {
              await this.loadHistory(filePath);
            }).open();
          });
      });

    // If we have existing history, display it
    await this.updateHistoryDisplay();
  }

  private updateContextFilesSection(containerEl: HTMLElement) {
    containerEl.empty();
    containerEl.addClass("context-files-section");
    
    if (this.contextFiles.size === 0) {
      containerEl.createEl("p", {
        text: "No context files selected",
        cls: "context-empty-message"
      });
      return;
    }

    const fileList = containerEl.createDiv({ cls: "context-file-list" });
    
    for (const [path, fileInfo] of this.contextFiles) {
      const fileItem = fileList.createDiv({ cls: "context-file-item" });
      
      fileItem.createSpan({ text: "📄", cls: "context-file-icon" });
      fileItem.createSpan({ text: fileInfo.name, cls: "context-file-name" });
      
      // Preview button
      const previewBtn = fileItem.createEl("button", {
        text: "Preview",
        cls: "context-file-preview"
      });
      previewBtn.addEventListener("click", async () => {
        try {
          const content = await this.app.vault.adapter.read(fileInfo.path);
          new FilePreviewModal(this.app, fileInfo.name, content).open();
        } catch (error) {
          new Notice(`Failed to read file: ${fileInfo.name}`);
        }
      });
      
      // Remove button
      const removeBtn = fileItem.createEl("button", {
        text: "×",
        cls: "context-file-remove"
      });
      removeBtn.addEventListener("click", () => {
        this.contextFiles.delete(path);
        this.updateContextFilesSection(containerEl);
      });
    }
  }

  async saveHistory() {
    if (this.queryHistory.length === 0) return;

    try {
      const metadata = {
        model: this.model,
        language: this.language,
        textType: this.textType,
        id: this.conversationShortName || undefined
      };

      const historyPath = await this.historyManager.saveHistory({
        messages: this.queryHistory,
        metadata,
        historyFolder: this.plugin.settings.historyFolder,
        contextFiles: this.contextFiles
      });

      if (historyPath) {
        new Notice("Conversation history saved!");
      }
    } catch (error: unknown) {
      console.error('Failed to save history:', error);
      if (error instanceof Error) {
        new Notice(`Failed to save history: ${error.message}`);
      } else {
        new Notice('Failed to save history: Unknown error');
      }
    }
  }


  async loadHistory(filePath: string) {
    try {
      const { messages, metadata } = await this.historyManager.loadHistory(filePath);
      
      // Update view settings from metadata
      this.model = metadata.model || this.model;
      this.language = metadata.language || this.language;
      this.textType = metadata.textType || this.textType;
      this.conversationShortName = metadata.id || null;
      
      // Clear and update context files
      this.contextFiles.clear();
      if (metadata.context_files) {
        for (const file of metadata.context_files) {
          this.contextFiles.set(file.path, {
            path: file.path,
            name: file.name,
            content: file.content
          });
        }
      }

      // Set history and update display
      this.queryHistory = messages;
      await this.updateHistoryDisplay();
      
      // Update context files display
      const contextSection = this.contentEl.querySelector('.context-section');
      if (contextSection instanceof HTMLElement) {
        this.updateContextFilesSection(contextSection);
      }
      
      new Notice(`Loaded conversation: ${metadata.id || 'Unknown'}`);
    } catch (error: unknown) {
      console.error('Error loading history:', error);
      if (error instanceof Error) {
        new Notice(`Failed to load history: ${error.message}`);
      } else {
        new Notice('Failed to load history: Unknown error');
      }
    }
  }

  async updateHistoryDisplay() {
  const historyContainer = this.contentEl.querySelector('.history-container') as HTMLDivElement;
  if (historyContainer) {
    historyContainer.empty();
    
    // Convert history items to HTML with code block handling
    const processedContent = this.queryHistory.map(entry => {
      return entry.replace(/```(\w+)?\n([\s\S]*?)```/g, (match, language, code) => {
        const langClass = language ? ` class="language-${language}"` : '';
        return `<div class="code-wrapper">
          <div class="code-block-header">
            ${language || 'Code'}
            <button class="copy-button" onclick="navigator.clipboard.writeText(\`${code.trim()}\`)">
              Copy
            </button>
          </div>
          <pre${langClass}><code${langClass}>${code}</code></pre>
        </div>`;
      });
    }).join('\n\n');

    await MarkdownRenderer.renderMarkdown(
      processedContent,
      historyContainer,
      '',
      this
    );

    // Add click handlers for copy buttons
    historyContainer.querySelectorAll('.copy-button').forEach(button => {
      button.addEventListener('click', (e) => {
        e.stopPropagation();
        const codeBlock = (button as HTMLElement).closest('.code-wrapper')?.querySelector('code');
        if (codeBlock) {
          navigator.clipboard.writeText(codeBlock.textContent || '');
          new Notice('Code copied to clipboard!');
        }
      });
    });
  }
}

private createContextSection(containerEl: HTMLElement) {
    containerEl.empty();
    containerEl.addClass("context-files-section");
    
    if (this.contextFiles.size === 0) {
      containerEl.createEl("p", {
        text: "No context files selected",
        cls: "context-empty-message"
      });
      return;
    }

    const fileList = containerEl.createDiv({ cls: "context-file-list" });
    
    for (const [path, fileInfo] of this.contextFiles) {
      const fileItem = fileList.createDiv({ cls: "context-file-item" });
      
      fileItem.createSpan({ text: "📄", cls: "context-file-icon" });
      fileItem.createSpan({ text: fileInfo.name, cls: "context-file-name" });
      
      const removeBtn = fileItem.createEl("button", {
        text: "×",
        cls: "context-file-remove"
      });
      removeBtn.addEventListener("click", () => {
        this.contextFiles.delete(path);
        this.createContextSection(containerEl);
      });
    }
  }

  async addContextFiles(files: SelectedFile[]) {
    try {
      for (const file of files) {
        if (!file.content) {
          console.error('No content provided for file:', file.name);
          continue;
        }

        // Use FileManager to save the context file
        const fileName = `${Date.now()}_${file.name}`;
        const filePath = await this.fileManager.saveFile({
          content: file.content,
          folder: this.plugin.settings.historyFolder,
          filename: fileName,
        });

        // Add to context files
        this.contextFiles.set(filePath, {
          path: filePath,
          name: file.name,
          content: file.content
        });
        
        new Notice(`Added file: ${file.name}`);
      }
    } catch (error: unknown) {
      console.error('Error adding context files:', error);
      if (error instanceof Error) {
        new Notice(`Failed to add files: ${error.message}`);
      } else {
        new Notice('Failed to add files: Unknown error');
      }
    }
  }

  async generateText(inputArea: HTMLTextAreaElement, historyContainer: HTMLDivElement) {
    if (!this.inputMessage.trim()) {
      new Notice("Please enter a query.");
      return;
    }

    try {
      // Get LLM client from services
      const llmClient = this.plugin.services.llmClientService.getClientForProvider(this.provider);
      
      if (!llmClient) {
        new Notice("LLM client not initialized. Please check your settings and API keys.");
        return;
      }

      const combinedHistory = this.queryHistory.join("\n");

      // Read files using FileManager
      const files = await Promise.all(
        Array.from(this.contextFiles.values()).map(async (file) => {
          try {
            const content = await this.fileManager.readFile(file.path);
            return {
              path: file.path,
              name: file.name,
              content: content
            };
          } catch (error: unknown) {
            ErrorHandler.handleError(error, "FILE_OPERATION", {
              fileName: file.name,
              operation: "read",
              path: file.path
            });
            return null;
          }
        })
      );

      const validFiles = files.filter((f): f is NonNullable<typeof f> => f !== null);

      // Prepare options for LLM client
      const options: TextGenerationOptions = {
        message: combinedHistory + "\n" + this.inputMessage,
        model: this.model,
        language: this.language,
        files: validFiles,
        temperature: this.temperature,
        maxTokens: this.maxTokens,
        topP: this.topP,
        presencePenalty: this.presencePenalty,
        frequencyPenalty: this.frequencyPenalty
      };

      // Generate text using LLM client
      const result = await llmClient.generateText(options);

      // Extract response data
      const newResponse = result.output;
      const metadata = result.metadata;

      // Format context files list
      const contextFilesList = validFiles
        .map(f => f.name)
        .join(', ');

      // Create metadata block
      const metadataBlock = `
provider_name: ${metadata.provider_name || 'Unknown'}
provider_selected: ${this.provider}
model_used: ${metadata.actual_model || this.model}
request_time: ${metadata.request_time || new Date().toISOString()}
completion_time: ${metadata.completion_time || new Date().toISOString()}
generation_time: ${metadata.elapsed_time || 'N/A'}
context_files: ${contextFilesList || 'None'}`;

      // Create new history entry
      const newHistory = `\n### You:\n${this.inputMessage}\n\n### Bot:\n${newResponse}\n\n<details>\n<summary>Response Metadata</summary>\n\n\`\`\`yaml${metadataBlock}\n\`\`\`\n</details>`;
      this.queryHistory.push(newHistory);

      // Update display and save
      await this.updateHistoryDisplay();
      await this.saveHistory();

      // Clear input
      inputArea.value = "";
      this.inputMessage = "";
      
      new Notice("Text generated successfully!");

    } catch (error) {
      if (error instanceof OpenRouterError) {
        new Notice(`LLM Error: ${error.message}`);
        console.error('LLM Error:', error.details);
      } else if (ErrorHandler.isNetworkError(error)) {
        ErrorHandler.handleError(error, "NETWORK_ERROR", {
          endpoint: "LLM Provider API",
          method: "POST"
        });
      } else {
        ErrorHandler.handleError(error, "API_ERROR", {
          operation: "text-generation",
          model: this.model,
          timestamp: new Date().toISOString()
        });
      }
    }
  }

  

  async onClose() {
    await this.saveHistory();
  }
  
}

export { GenerateTextView };
