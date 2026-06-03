import {
    App,
    Setting,
    Modal,
    DropdownComponent
  } from "obsidian";

  import type GptFreeTextGeneratorPlugin from '../main';
  import { SettingTab } from '../settings/SettingTab'; // Import SettingTab to access getFilteredModelsForBackend

  class TextGeneratorModal extends Modal {
    plugin: GptFreeTextGeneratorPlugin;
    onSave: (options: any) => void;
    model: string;
    language: string;
    textType: string;
    filePath: string = "";
    private provider: 'openrouter' | 'chutes' | 'zai'; // New: Use multi-provider system
    private modelDropdown: DropdownComponent | null = null; // Reference to model dropdown component

  constructor(app: App, plugin: GptFreeTextGeneratorPlugin, onSave: (options: any) => void) {
    super(app);
    this.plugin = plugin;
    this.onSave = onSave;
    this.provider = plugin.settings.defaultLLMProvider; // Initialize provider from settings
    this.model = this.getTextModelForProvider(this.provider); // Initialize with provider-specific model
    this.language = plugin.settings.defaultLanguage;
    this.textType = plugin.settings.defaultTextType;
  }

  // Helper method to get text model for provider
  private getTextModelForProvider(provider: 'openrouter' | 'chutes' | 'zai'): string {
    switch (provider) {
      case 'openrouter':
        return this.plugin.settings.openrouterTextModel || this.plugin.settings.defaultTextModel;
      case 'chutes':
        return this.plugin.settings.chutesTextModel || 'deepseek-ai/DeepSeek-V3.2-Speciale-TEE';
      case 'zai':
        return this.plugin.settings.zaiTextModel || 'glm-4.6';
      default:
        return this.plugin.settings.defaultTextModel;
    }
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h2", { text: "Text Generator Options" });

    // Provider Selection (NEW - using multi-provider system)
    new Setting(contentEl)
      .setName("LLM Provider")
      .setDesc("Choose the AI provider for text generation")
      .addDropdown(dropdown => {
        dropdown.addOptions({
          'openrouter': 'OpenRouter',
          'chutes': 'Chutes',
          'zai': 'ZAI'
        });
        dropdown
          .setValue(this.provider)
          .onChange(async value => {
            this.provider = value as 'openrouter' | 'chutes' | 'zai';
            this.model = this.getTextModelForProvider(this.provider); // Update model for new provider
            this.updateModelDropdown(contentEl); // Update model dropdown based on new provider
          });
      });

    new Setting(contentEl)
      .setName("Select Model")
      .addDropdown((dropdown) => {
        this.modelDropdown = dropdown; // CAPTURE REFERENCE HERE
        this.updateModelDropdown(contentEl); // Initial population
        dropdown.setValue(this.model).onChange((value) => {
          this.model = value;
        });
      });

    new Setting(contentEl)
      .setName("Language")
      .addDropdown((dropdown) => {
        dropdown.addOptions({
          english: "English",
          russian: "Russian"
        });
        dropdown.setValue(this.language).onChange((value) => {
          this.language = value;
        });
      });

    new Setting(contentEl)
      .setName("Text Type")
      .addDropdown((dropdown) => {
        dropdown.addOptions({
          transcript: "Transcript",
          summary: "Summary",
          creative: "Creative Writing",
        });
        dropdown.setValue(this.textType).onChange((value) => {
          this.textType = value;
        });
      });

    new Setting(contentEl)
      .addButton((btn) => {
        btn.setButtonText("Save Options").onClick(() => {
          this.onSave({
            model: this.model,
            language: this.language,
            textType: this.textType,
            filePath: this.filePath,
          });
          this.close();
        });
      });
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
    this.modelDropdown.setValue(models[this.model] ? this.model : firstModel);
    
    // Update local state if it changed
    if (!models[this.model]) {
        this.model = firstModel;
    }
  }
}

export { TextGeneratorModal };
