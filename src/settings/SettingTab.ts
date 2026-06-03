import {
    App,
    Setting,
    PluginSettingTab,
    Notice
  } from "obsidian";

  import type GptFreeTextGeneratorPlugin from '../main';
  import { fetchOpenRouterModels } from '../utils/OpenRouterAPI';
  import { OpenRouterModel } from '../types';
  import { TestProviderConnectionModal } from '../modals/TestProviderConnectionModal';

class SettingTab extends PluginSettingTab {
  plugin: GptFreeTextGeneratorPlugin;

  constructor(app: App, plugin: GptFreeTextGeneratorPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    this.addMultiProviderSettings(containerEl);
    this.addOpenRouterSettings(containerEl);
    this.addGeneralSettings(containerEl);
    this.addFolderSettings(containerEl);
    this.addSummarySettings(containerEl);
    this.addLanguageSettings(containerEl);
    this.addContentStorageSettings(containerEl);
    this.addSpacedRepetitionSettings(containerEl);
    this.addDebugSettings(containerEl);
    this.addTestSettings(containerEl);
  }

  addGeneralSettings(containerEl: HTMLElement): void {
    containerEl.createEl('h2', { text: 'General Settings' });

    new Setting(containerEl)
      .setName("Default Backend")
      .setDesc("Choose the default backend for AI model requests.")
      .addDropdown(dropdown => {
        dropdown.addOptions({
          'openrouter': 'OpenRouter',
          'chutes': 'Chutes',
          'zai': 'ZAI',
          'g4f': 'G4F (Local - Legacy)'
        });
        dropdown
          .setValue(this.plugin.settings.defaultBackend)
          .onChange(async value => {
            this.plugin.settings.defaultBackend = value as 'g4f' | 'openrouter' | 'chutes' | 'zai';
            await this.plugin.saveSettings();
            this.display(); // Re-render to update model dropdowns
          });
      });

    new Setting(containerEl)
      .setName("Default Text Model")
      .setDesc("Choose the default model for text generation")
      .addDropdown(dropdown => {
        const models = this.getFilteredModelsForBackend(this.plugin.settings.defaultLLMProvider);
        dropdown
          .addOptions(models)
          .setValue(this.getTextModelForProvider(this.plugin.settings.defaultLLMProvider))
          .onChange(async value => {
            this.setTextModelForProvider(this.plugin.settings.defaultLLMProvider, value);
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Default Image Model")
      .setDesc("Choose the default model for image generation")
      .addDropdown(dropdown => {
        const models = {
          'flux': 'Flux',
          'sdxl': 'SDXL',
          'flux-pro': 'Flux Pro',
          'dall-e-3': 'DALL-E 3',
          // Add other models as needed
        };
        dropdown
          .addOptions(models)
          .setValue(this.plugin.settings.defaultImageModel)
          .onChange(async value => {
            this.plugin.settings.defaultImageModel = value;
            await this.plugin.saveSettings();
          });
      });
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

  // Helper method to set text model for provider
  private setTextModelForProvider(provider: 'openrouter' | 'chutes' | 'zai', model: string): void {
    switch (provider) {
      case 'openrouter':
        this.plugin.settings.openrouterTextModel = model;
        break;
      case 'chutes':
        this.plugin.settings.chutesTextModel = model;
        break;
      case 'zai':
        this.plugin.settings.zaiTextModel = model;
        break;
      default:
        this.plugin.settings.defaultTextModel = model;
    }
  }

  // Helper method to get summary model for provider
  private getSummaryModelForProvider(provider: 'openrouter' | 'chutes' | 'zai'): string {
    switch (provider) {
      case 'openrouter':
        return this.plugin.settings.openrouterSummaryModel || this.plugin.settings.summaryModel;
      case 'chutes':
        return this.plugin.settings.chutesSummaryModel || 'deepseek-ai/DeepSeek-V3.2-Speciale-TEE';
      case 'zai':
        return this.plugin.settings.zaiSummaryModel || 'glm-4.6';
      default:
        return this.plugin.settings.summaryModel;
    }
  }

  // Helper method to set summary model for provider
  private setSummaryModelForProvider(provider: 'openrouter' | 'chutes' | 'zai', model: string): void {
    switch (provider) {
      case 'openrouter':
        this.plugin.settings.openrouterSummaryModel = model;
        break;
      case 'chutes':
        this.plugin.settings.chutesSummaryModel = model;
        break;
      case 'zai':
        this.plugin.settings.zaiSummaryModel = model;
        break;
      default:
        this.plugin.settings.summaryModel = model;
    }
  }

  addOpenRouterSettings(containerEl: HTMLElement): void {
    containerEl.createEl('h2', { text: 'OpenRouter Settings' });

    new Setting(containerEl)
      .setName("OpenRouter API Key")
      .setDesc("Your API key for OpenRouter. Get it from openrouter.ai/keys")
      .addText(text => text
        .setValue(this.plugin.settings.openRouterApiKey || '')
        .onChange(async value => {
          this.plugin.settings.openRouterApiKey = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Refresh Models from OpenRouter")
      .setDesc("Download the latest available AI models from OpenRouter.")
      .addButton(button => button
        .setButtonText("Refresh Models")
        .onClick(async () => {
          button.setDisabled(true).setButtonText("Refreshing...");
          try {
            const models = await fetchOpenRouterModels(this.plugin.settings.openRouterApiKey);
            this.plugin.settings.openRouterModels = models;
            this.plugin.settings.lastUpdated = new Date().toISOString();
            await this.plugin.saveSettings();
            new Notice("Models refreshed successfully!");
            this.display(); // Re-render settings to show updated models and timestamp
          } catch (error: unknown) { // Explicitly type error as unknown
            if (error instanceof Error) {
              new Notice(`Failed to refresh models: ${error.message}`);
            } else {
              new Notice("Failed to refresh models: An unknown error occurred.");
            }
            console.error(error);
          } finally {
            button.setDisabled(false).setButtonText("Refresh Models");
          }
        }));

    new Setting(containerEl)
      .setName("Last Updated")
      .setDesc("Date and time when OpenRouter models were last refreshed.")
      .addMomentFormat(moment => moment
        .setDisabled(true)
        .setValue(this.plugin.settings.lastUpdated ? new Date(this.plugin.settings.lastUpdated).toLocaleString() : 'Never'));

    containerEl.createEl('h3', { text: 'OpenRouter Model Filters' });

    new Setting(containerEl)
      .setName("Show Free Models Only")
      .setDesc("Only display models that are free to use.")
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.filterFreeModelsOnly || false)
        .onChange(async value => {
          this.plugin.settings.filterFreeModelsOnly = value;
          await this.plugin.saveSettings();
          this.display(); // Re-render to apply filter
        }));

    // Add more filter settings here (e.g., by provider, max context, pricing threshold)
    // For example:
    new Setting(containerEl)
      .setName("Max Context Length (tokens)")
      .setDesc("Only show models with a context length greater than or equal to this value. Set to 0 for no filter.")
      .addText(text => text
        .setValue(String(this.plugin.settings.minContextLength || 0))
        .setPlaceholder("0")
        .onChange(async value => {
          const numValue = parseInt(value);
          if (!isNaN(numValue) && numValue >= 0) {
            this.plugin.settings.minContextLength = numValue;
            await this.plugin.saveSettings();
            this.display();
          } else {
            new Notice("Please enter a valid number for max context length.");
          }
        }));
  }

  addFolderSettings(containerEl: HTMLElement): void {
    containerEl.createEl('h2', { text: 'Folder Settings' });

    new Setting(containerEl)
      .setName("History Folder")
      .setDesc("Folder where conversation histories will be saved")
      .addText(text => text
        .setValue(this.plugin.settings.historyFolder)
        .onChange(async value => {
          this.plugin.settings.historyFolder = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Image Folder")
      .setDesc("Folder where generated images will be saved")
      .addText(text => text
        .setValue(this.plugin.settings.imageFolder)
        .onChange(async value => {
          this.plugin.settings.imageFolder = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Transcript Folder")
      .setDesc("Folder where video transcripts will be saved")
      .addText(text => text
        .setValue(this.plugin.settings.transcriptFolder)
        .onChange(async value => {
          this.plugin.settings.transcriptFolder = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Articles Folder")
      .setDesc("Folder where saved articles will be stored")
      .addText(text => text
        .setValue(this.plugin.settings.articlesFolder)
        .onChange(async value => {
          this.plugin.settings.articlesFolder = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Quiz Folder")
      .setDesc("Folder where generated quizzes will be saved")
      .addText(text => text
        .setValue(this.plugin.settings.quizFolder)
        .onChange(async value => {
          this.plugin.settings.quizFolder = value;
          await this.plugin.saveSettings();
        }));
  }

  addSummarySettings(containerEl: HTMLElement): void {
    containerEl.createEl('h2', { text: 'Summary Settings' });

    new Setting(containerEl)
      .setName("Summary Model")
      .setDesc("Choose the default model for video summaries")
      .addDropdown(dropdown => {
        const models = this.getFilteredModelsForBackend(this.plugin.settings.defaultLLMProvider);
        dropdown
          .addOptions(models)
          .setValue(this.getSummaryModelForProvider(this.plugin.settings.defaultLLMProvider))
          .onChange(async value => {
            this.setSummaryModelForProvider(this.plugin.settings.defaultLLMProvider, value);
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Summary Prompt")
      .setDesc("The prompt used for generating summaries.")
      .addTextArea(text => text
        .setValue(this.plugin.settings.summaryPrompt)
        .setPlaceholder("Summarize the following content...")
        .onChange(async value => {
          this.plugin.settings.summaryPrompt = value;
          await this.plugin.saveSettings();
        }));
  }

  addLanguageSettings(containerEl: HTMLElement): void {
    containerEl.createEl('h2', { text: 'Language Settings' });

    new Setting(containerEl)
      .setName("Default Language")
      .setDesc("Choose the default language")
      .addDropdown(dropdown => {
        dropdown
          .addOptions({
            english: "English",
            russian: "Russian"
          })
          .setValue(this.plugin.settings.defaultLanguage)
          .onChange(async value => {
            this.plugin.settings.defaultLanguage = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Default Transcript Language")
      .setDesc("Choose the default language for video transcripts")
      .addDropdown(dropdown => {
        dropdown
          .addOptions({
            en: "English",
            ru: "Russian",
            es: "Spanish",
            fr: "French",
            de: "German",
            // Add more languages
          })
          .setValue(this.plugin.settings.defaultTranscriptLanguage)
          .onChange(async value => {
            this.plugin.settings.defaultTranscriptLanguage = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Default Output Language")
      .setDesc("Choose the default language for generated content")
      .addDropdown(dropdown => {
        dropdown
          .addOptions({
            en: "English",
            ru: "Russian",
            es: "Spanish",
            fr: "French",
            de: "German",
            // Add more languages
          })
          .setValue(this.plugin.settings.defaultOutputLanguage)
          .onChange(async value => {
            this.plugin.settings.defaultOutputLanguage = value;
            await this.plugin.saveSettings();
          });
      });
  }

  addContentStorageSettings(containerEl: HTMLElement): void {
    containerEl.createEl('h2', { text: 'Content Storage Settings' });

    new Setting(containerEl)
      .setName("Transcript Storage Location")
      .setDesc("Choose where to store video transcripts: in the database or embedded in the note.")
      .addDropdown(dropdown => {
        dropdown.addOptions({
          'database': 'Database',
          'note': 'Note'
        });
        dropdown
          .setValue(this.plugin.settings.transcriptStorageLocation)
          .onChange(async value => {
            this.plugin.settings.transcriptStorageLocation = value as 'database' | 'note';
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Description Storage Location")
      .setDesc("Choose where to store video descriptions: in the database or embedded in the note.")
      .addDropdown(dropdown => {
        dropdown.addOptions({
          'database': 'Database',
          'note': 'Note'
        });
        dropdown
          .setValue(this.plugin.settings.descriptionStorageLocation)
          .onChange(async value => {
            this.plugin.settings.descriptionStorageLocation = value as 'database' | 'note';
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Detailed Summaries Storage Location")
      .setDesc("Choose where to store detailed summaries: in the database or embedded in the note.")
      .addDropdown(dropdown => {
        dropdown.addOptions({
          'database': 'Database',
          'note': 'Note'
        });
        dropdown
          .setValue(this.plugin.settings.detailedSummariesStorageLocation)
          .onChange(async value => {
            this.plugin.settings.detailedSummariesStorageLocation = value as 'database' | 'note';
            await this.plugin.saveSettings();
          });
      });
  }

  addSpacedRepetitionSettings(containerEl: HTMLElement): void {
    containerEl.createEl('h2', { text: 'Spaced Repetition Settings' });

    new Setting(containerEl)
      .setName("Enable Spaced Repetition")
      .setDesc("Use a separate SQLite database for review questions and scheduling state.")
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.spacedRepetition.enabled)
        .onChange(async value => {
          this.plugin.settings.spacedRepetition.enabled = value;
          await this.plugin.saveSettings();
          if (value) {
            await this.plugin.services.ensureSpacedRepetitionDatabase();
            new Notice("Spaced repetition database initialized.");
          }
        }));

    new Setting(containerEl)
      .setName("SQLite Database Path")
      .setDesc("Runtime database file. Keep this out of git.")
      .addText(text => text
        .setValue(this.plugin.settings.spacedRepetition.databasePath)
        .onChange(async value => {
          this.plugin.settings.spacedRepetition.databasePath = value.trim() || this.plugin.settings.spacedRepetition.databasePath;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Max Cards Per Session")
      .addText(text => text
        .setValue(String(this.plugin.settings.spacedRepetition.maxReviewCardsPerSession))
        .onChange(async value => {
          const parsed = parseInt(value, 10);
          if (!Number.isNaN(parsed) && parsed > 0) {
            this.plugin.settings.spacedRepetition.maxReviewCardsPerSession = parsed;
            await this.plugin.saveSettings();
          }
        }));

    new Setting(containerEl)
      .setName("Grade 0 Reask Delay")
      .setDesc("Number of other reviewed cards before a grade 0 card can appear again.")
      .addText(text => text
        .setValue(String(this.plugin.settings.spacedRepetition.gradeZeroReaskDelay))
        .onChange(async value => {
          const parsed = parseInt(value, 10);
          if (!Number.isNaN(parsed) && parsed >= 0) {
            this.plugin.settings.spacedRepetition.gradeZeroReaskDelay = parsed;
            await this.plugin.saveSettings();
          }
        }));
  }

  addMultiProviderSettings(containerEl: HTMLElement): void {
    containerEl.createEl('h2', { text: 'Multi-Provider Settings' });

    // Default Provider Selection
    new Setting(containerEl)
      .setName("Default LLM Provider")
      .setDesc("Choose the default provider for text generation")
      .addDropdown(dropdown => {
        dropdown.addOptions({
          'openrouter': 'OpenRouter',
          'chutes': 'Chutes',
          'zai': 'ZAI'
        });
        dropdown
          .setValue(this.plugin.settings.defaultLLMProvider)
          .onChange(async value => {
            this.plugin.settings.defaultLLMProvider = value as 'openrouter' | 'chutes' | 'zai';
            await this.plugin.saveSettings();
            this.display(); // Re-render to show provider-specific settings
          });
      });

    // Chutes API Key
    new Setting(containerEl)
      .setName("Chutes API Key")
      .setDesc("Your API key for Chutes.ai")
      .addText(text => text
        .setValue(this.plugin.settings.chutesApiKey || '')
        .onChange(async value => {
          this.plugin.settings.chutesApiKey = value;
          await this.plugin.saveSettings();
        }));

    // ZAI API Key
    new Setting(containerEl)
      .setName("ZAI API Key")
      .setDesc("Your API key for ZAI.ai")
      .addText(text => text
        .setValue(this.plugin.settings.zaiApiKey || '')
        .onChange(async value => {
          this.plugin.settings.zaiApiKey = value;
          await this.plugin.saveSettings();
        }));

    // Provider Timeout
    new Setting(containerEl)
      .setName("Provider Timeout (seconds)")
      .setDesc("Timeout for API requests in seconds")
      .addText(text => text
        .setValue(String(this.plugin.settings.providerTimeout / 1000))
        .onChange(async value => {
          const numValue = parseInt(value) * 1000;
          if (!isNaN(numValue) && numValue > 0) {
            this.plugin.settings.providerTimeout = numValue;
            await this.plugin.saveSettings();
          }
        }));

    // Provider Retry Count
    new Setting(containerEl)
      .setName("Provider Retry Count")
      .setDesc("Number of retry attempts for failed requests")
      .addText(text => text
        .setValue(String(this.plugin.settings.providerRetryCount))
        .onChange(async value => {
          const numValue = parseInt(value);
          if (!isNaN(numValue) && numValue >= 0) {
            this.plugin.settings.providerRetryCount = numValue;
            await this.plugin.saveSettings();
          }
        }));
  }

  getFilteredOpenRouterModels(): OpenRouterModel[] {
    let models = this.plugin.settings.openRouterModels || [];

    if (this.plugin.settings.filterFreeModelsOnly) {
      models = models.filter(model => model.pricing && parseFloat(model.pricing.prompt) === 0 && parseFloat(model.pricing.completion) === 0);
    }

    if (this.plugin.settings.minContextLength > 0) {
      models = models.filter(model => model.context_length >= this.plugin.settings.minContextLength);
    }

    // Sort models alphabetically by name
    models.sort((a, b) => a.name.localeCompare(b.name));

    return models;
  }

  public getFilteredModelsForBackend(provider: 'openrouter' | 'chutes' | 'zai'): Record<string, string> {
    switch (provider) {
      case 'openrouter':
        return this.getFilteredOpenRouterModels().reduce((acc: Record<string, string>, model) => {
          acc[model.id] = model.name;
          return acc;
        }, {});
      
      case 'chutes':
        // Chutes models
        return {
          "deepseek-ai/DeepSeek-V3.2-Speciale-TEE": "DeepSeek V3.2 Speciale TEE",
          "moonshotai/Kimi-K2-Instruct-0905": "Kimi K2 Instruct",
          "deepseek-ai/DeepSeek-V3.2-TEE": "DeepSeek V3.2 TEE",
          "zai-org/GLM-4.6-TEE": "GLM 4.6 TEE",
          // Add more Chutes models as needed
        };
      
      case 'zai':
        // ZAI models
        return {
          "glm-4.6": "GLM 4.6",
          "glm-4.7": "GLM 4.7",
          // Add more ZAI models as needed
        };
      
      default:
        // Fallback to G4F models for backward compatibility
        return {
          "gpt-4o": "GPT-4o",
          "gpt-4": "GPT-4",
          "gpt-4-turbo": "GPT-4 Turbo",
          "claude-3-haiku": "Claude 3 Haiku",
          "claude-3-sonnet": "Claude 3 Sonnet",
          "claude-3-opus": "Claude 3 Opus",
          "claude-3.5-sonnet": "Claude 3.5 Sonnet",
          "google/gemini-pro": "Google Gemini Pro",
          "google/gemini-1.5-flash": "Google Gemini 1.5 Flash",
          "google/gemini-1.5-pro": "Google Gemini 1.5 Pro",
        };
    }
  }

  addDebugSettings(containerEl: HTMLElement): void {
    containerEl.createEl('h2', { text: 'Debug Settings' });

    new Setting(containerEl)
      .setName("Debug Mode")
      .setDesc("Enable detailed debug logging for troubleshooting text generation errors. This will log API requests, responses, timing information, and error details to the browser console.")
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.debugMode || false)
        .onChange(async value => {
          this.plugin.settings.debugMode = value;
          await this.plugin.saveSettings();
          if (value) {
            new Notice("Debug mode enabled. Check browser console (F12) for detailed logs.");
          } else {
            new Notice("Debug mode disabled.");
          }
        }));
  }

  addTestSettings(containerEl: HTMLElement): void {
    containerEl.createEl('h2', { text: 'Test Settings' });

    new Setting(containerEl)
      .setName("Test Provider Connection")
      .setDesc("Test connectivity to LLM providers with a simple prompt to verify they can generate text.")
      .addButton(button => button
        .setButtonText("Test Connection")
        .onClick(() => {
          new TestProviderConnectionModal(this.app, this.plugin).open();
        }));
  }
}

export { SettingTab };
