// ArticleRequestModal.ts
import { App, Modal, Setting, Notice, ButtonComponent, DropdownComponent } from "obsidian";
import type GptFreeTextGeneratorPlugin from '../main';
import { SettingTab } from '../settings/SettingTab'; // Import SettingTab to access getFilteredModelsForBackend

type TextProviderId = 'openrouter' | 'chutes' | 'zai' | 'ollama' | 'proxy';

export class ArticleRequestModal extends Modal {
  private plugin: GptFreeTextGeneratorPlugin;
  private articleUrl: string = "";
  private outputLanguage: string = "en";
  private isProcessing: boolean = false;
  private provider: TextProviderId; // New: Use multi-provider system
  private summaryModel: string; // New: Summary model property
  private modelDropdown: DropdownComponent | null = null; // Reference to model dropdown component

  constructor(app: App, plugin: GptFreeTextGeneratorPlugin) {
    super(app);
    this.plugin = plugin;
    this.outputLanguage = plugin.settings.defaultOutputLanguage;
    this.provider = plugin.settings.defaultLLMProvider; // Initialize provider from settings
    this.summaryModel = this.getSummaryModelForProvider(this.provider); // Initialize with provider-specific model
  }

  // Helper method to get summary model for provider
  private getSummaryModelForProvider(provider: TextProviderId): string {
    switch (provider) {
      case 'openrouter':
        return this.plugin.settings.openrouterSummaryModel || this.plugin.settings.summaryModel;
      case 'chutes':
        return this.plugin.settings.chutesSummaryModel || 'deepseek-ai/DeepSeek-V3.2-Speciale-TEE';
      case 'zai':
        return this.plugin.settings.zaiSummaryModel || 'glm-4.6';
      case 'ollama':
        return this.plugin.settings.ollamaSummaryModel || 'gemma4:31b-cloud';
      case 'proxy':
        return this.plugin.settings.proxySummaryModel || 'nim:nvidia/nemotron-3-nano-omni-30b-a3b-reasoning';
      default:
        return this.plugin.settings.summaryModel;
    }
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h2", { text: "Summarize Web Article" });

    // Article URL input
    new Setting(contentEl)
      .setName("Article URL")
      .setDesc("Enter the URL of the article you want to summarize")
      .addText(text => text
        .setPlaceholder("https://example.com/article")
        .setValue(this.articleUrl)
        .onChange(value => {
          this.articleUrl = value;
        }));

    // Provider Selection (NEW - using multi-provider system)
    new Setting(contentEl)
      .setName("LLM Provider")
      .setDesc("Choose the AI provider for text generation")
      .addDropdown(dropdown => {
        dropdown.addOptions({
          'openrouter': 'OpenRouter',
          'chutes': 'Chutes',
          'zai': 'ZAI',
          'ollama': 'Ollama',
          'proxy': 'OpenAI Proxy'
        });
        dropdown
          .setValue(this.provider)
          .onChange(async value => {
            this.provider = value as TextProviderId;
            this.summaryModel = this.getSummaryModelForProvider(this.provider); // Update model for new provider
            this.updateModelDropdown(contentEl); // Update model dropdown based on new provider
          });
      });

    // Summary Model Selection (NEW)
    new Setting(contentEl)
      .setName("Summary Model")
      .setDesc("Choose the AI model for generating the summary")
      .addDropdown((dropdown) => {
        this.modelDropdown = dropdown; // CAPTURE REFERENCE HERE
        this.updateModelDropdown(contentEl); // Initial population
        dropdown
          .setValue(this.summaryModel)
          .onChange((value) => {
            this.summaryModel = value;
          });
      });

    // Language Selection
    new Setting(contentEl)
      .setName("Output Language")
      .setDesc("Choose the language for the generated summary")
      .addDropdown(dropdown => {
        dropdown.addOptions({
          en: "English",
          ru: "Russian",
          es: "Spanish",
          fr: "French",
          de: "German",
          ja: "Japanese",
          zh: "Chinese",
          // Add more languages as needed
        });
        dropdown
          .setValue(this.outputLanguage)
          .onChange(value => {
            this.outputLanguage = value;
          });
      });

    // Buttons container
    const buttonContainer = contentEl.createDiv("modal-button-container");

    // Process button
    const processButton = new ButtonComponent(buttonContainer)
      .setButtonText("Summarize Article")
      .setCta()
      .onClick(async () => {
        await this.processArticle(processButton);
      });

    // Cancel button
    new ButtonComponent(buttonContainer)
      .setButtonText("Cancel")
      .onClick(() => {
        this.close();
      });
  }

  private async processArticle(button: ButtonComponent) {
    if (!this.articleUrl.trim()) {
      new Notice("Please enter an article URL");
      return;
    }

    if (this.isProcessing) {
      return;
    }

    try {
      this.isProcessing = true;
      button.setButtonText("Processing...").setDisabled(true);

      const filePath = await this.plugin.articleManager.fetchAndSummarizeArticle({
        articleUrl: this.articleUrl,
        summaryModel: this.summaryModel, // summaryModel is already provider-specific
        outputLanguage: this.outputLanguage,
        articlesFolder: this.plugin.settings.articlesFolder,
        provider: this.provider // Pass the selected provider
      });

      await this.plugin.articleManager.openArticle(filePath);
      this.close();
    } catch (error: unknown) {
      if (error instanceof Error) {
        new Notice(`Failed to process article: ${error.message}`);
      } else {
        new Notice("Failed to process article");
      }
      button.setButtonText("Summarize Article").setDisabled(false);
    } finally {
      this.isProcessing = false;
    }
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }

  private updateModelDropdown(containerEl: HTMLElement): void {
    if (!this.modelDropdown) return;

    const settingTab = new SettingTab(this.app, this.plugin);
    const models = settingTab.getFilteredModelsForBackend(this.provider);
    
    // Clear and populate
    this.modelDropdown.selectEl.empty();
    
    // Add options
    for (const [value, label] of Object.entries(models)) {
      this.modelDropdown.addOption(value, label as string);
    }
    
    // Set value (fallback to first available if current selection invalid)
    const firstModel = Object.keys(models)[0];
    this.modelDropdown.setValue(models[this.summaryModel] ? this.summaryModel : firstModel);
    
    // Update local state if it changed
    if (!models[this.summaryModel]) {
        this.summaryModel = firstModel;
    }
  }
}
