import {
    App,
    Setting,
    Modal,
    DropdownComponent
  } from "obsidian";

  import type GptFreeTextGeneratorPlugin from '../main';
  import { SettingTab } from '../settings/SettingTab'; // Import SettingTab to access getFilteredModelsForBackend

  type TextProviderId = 'openrouter' | 'chutes' | 'zai' | 'ollama' | 'proxy';

  class TextGeneratorModal extends Modal {
    plugin: GptFreeTextGeneratorPlugin;
    onSave: (options: any) => void;
    model: string;
    language: string;
    textType: string;
    filePath: string = "";
    temperature: number;
    maxTokens: number;
    topP: number;
    presencePenalty: number;
    frequencyPenalty: number;
    private provider: TextProviderId; // New: Use multi-provider system
    private modelDropdown: DropdownComponent | null = null; // Reference to model dropdown component

  constructor(app: App, plugin: GptFreeTextGeneratorPlugin, onSave: (options: any) => void) {
    super(app);
    this.plugin = plugin;
    this.onSave = onSave;
    this.provider = plugin.settings.defaultLLMProvider; // Initialize provider from settings
    this.model = this.getTextModelForProvider(this.provider); // Initialize with provider-specific model
    this.language = plugin.settings.defaultLanguage;
    this.textType = plugin.settings.defaultTextType;
    this.temperature = plugin.settings.defaultTemperature;
    this.maxTokens = plugin.settings.defaultMaxTokens;
    this.topP = plugin.settings.defaultTopP;
    this.presencePenalty = plugin.settings.defaultPresencePenalty;
    this.frequencyPenalty = plugin.settings.defaultFrequencyPenalty;
  }

  // Helper method to get text model for provider
  private getTextModelForProvider(provider: TextProviderId): string {
    switch (provider) {
      case 'openrouter':
        return this.plugin.settings.openrouterTextModel || this.plugin.settings.defaultTextModel;
      case 'chutes':
        return this.plugin.settings.chutesTextModel || 'deepseek-ai/DeepSeek-V3.2-Speciale-TEE';
      case 'zai':
        return this.plugin.settings.zaiTextModel || 'glm-4.6';
      case 'ollama':
        return this.plugin.settings.ollamaTextModel || 'gemma4:31b-cloud';
      case 'proxy':
        return this.plugin.settings.proxyTextModel || 'nim:nvidia/nemotron-3-nano-omni-30b-a3b-reasoning';
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
          'zai': 'ZAI',
          'ollama': 'Ollama',
          'proxy': 'OpenAI Proxy'
        });
        dropdown
          .setValue(this.provider)
          .onChange(async value => {
            this.provider = value as TextProviderId;
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

    this.addNumberOption(contentEl, "Temperature", this.temperature, value => {
      this.temperature = value;
    }, 0, 2);

    this.addNumberOption(contentEl, "Max Tokens", this.maxTokens, value => {
      this.maxTokens = Math.max(1, Math.round(value));
    }, 1);

    this.addNumberOption(contentEl, "Top P", this.topP, value => {
      this.topP = value;
    }, 0, 1);

    this.addNumberOption(contentEl, "Presence Penalty", this.presencePenalty, value => {
      this.presencePenalty = value;
    }, -2, 2);

    this.addNumberOption(contentEl, "Frequency Penalty", this.frequencyPenalty, value => {
      this.frequencyPenalty = value;
    }, -2, 2);

    new Setting(contentEl)
      .addButton((btn) => {
        btn.setButtonText("Save Options").onClick(() => {
          this.onSave({
            provider: this.provider,
            model: this.model,
            language: this.language,
            textType: this.textType,
            filePath: this.filePath,
            temperature: this.temperature,
            maxTokens: this.maxTokens,
            topP: this.topP,
            presencePenalty: this.presencePenalty,
            frequencyPenalty: this.frequencyPenalty,
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

  private addNumberOption(
    containerEl: HTMLElement,
    name: string,
    value: number,
    onValidChange: (value: number) => void,
    min?: number,
    max?: number
  ): void {
    new Setting(containerEl)
      .setName(name)
      .addText(text => text
        .setValue(String(value))
        .onChange(input => {
          const parsed = Number(input);
          if (Number.isNaN(parsed)) {
            return;
          }
          if (min !== undefined && parsed < min) {
            return;
          }
          if (max !== undefined && parsed > max) {
            return;
          }
          onValidChange(parsed);
        }));
  }
}

export { TextGeneratorModal };
