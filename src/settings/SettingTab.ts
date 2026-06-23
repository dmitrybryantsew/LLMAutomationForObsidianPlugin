import {
    App,
    Setting,
    PluginSettingTab,
    Notice,
    TFile
  } from "obsidian";

  import type GptFreeTextGeneratorPlugin from '../main';
  import { fetchOpenRouterModels } from '../utils/OpenRouterAPI';
  import { OpenRouterModel } from '../types';
  import { StudySourceType } from '../types/studySources';
  import { TestProviderConnectionModal } from '../modals/TestProviderConnectionModal';
  import { LLMClientFactory } from '../utils/LLMClientFactory';
  import { LLMProvider, TextProviderId, TEXT_PROVIDER_LABELS } from '../types/providers';

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
    this.addFlashcardGenerationSettings(containerEl);
    this.addCodingExerciseSettings(containerEl);
    this.addStudySourceSettings(containerEl);
    this.addStudyPathSettings(containerEl);
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
          'ollama': 'Ollama',
          'proxy': 'OpenAI Proxy',
          'g4f': 'G4F (Local - Legacy)'
        });
        dropdown
          .setValue(this.plugin.settings.defaultBackend)
          .onChange(async value => {
            this.plugin.settings.defaultBackend = value as 'g4f' | TextProviderId;
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

  // Helper method to set text model for provider
  private setTextModelForProvider(provider: TextProviderId, model: string): void {
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
      case 'ollama':
        this.plugin.settings.ollamaTextModel = model;
        break;
      case 'proxy':
        this.plugin.settings.proxyTextModel = model;
        break;
      default:
        this.plugin.settings.defaultTextModel = model;
    }
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

  // Helper method to set summary model for provider
  private setSummaryModelForProvider(provider: TextProviderId, model: string): void {
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
      case 'ollama':
        this.plugin.settings.ollamaSummaryModel = model;
        break;
      case 'proxy':
        this.plugin.settings.proxySummaryModel = model;
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
      .setName("OpenRouter Tag Model")
      .setDesc("Model used only for video/local transcript tags when the selected provider is OpenRouter.")
      .addText(text => text
        .setValue(this.plugin.settings.openrouterTagModel || 'google/gemma-4-31b-it')
        .setPlaceholder("google/gemma-4-31b-it")
        .onChange(async value => {
          this.plugin.settings.openrouterTagModel = value.trim() || 'google/gemma-4-31b-it';
          await this.plugin.saveSettings();
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

    new Setting(containerEl)
      .setName("Coding Exercises Folder")
      .setDesc("Folder where generated coding exercises will be saved")
      .addText(text => text
        .setValue(this.plugin.settings.codingExercisesFolder)
        .onChange(async value => {
          this.plugin.settings.codingExercisesFolder = value.trim() || 'Coding Exercises';
          await this.plugin.saveSettings();
        }));
  }

  addCodingExerciseSettings(containerEl: HTMLElement): void {
    containerEl.createEl('h2', { text: 'Coding Exercise Settings' });

    new Setting(containerEl)
      .setName("Exercise Generation Provider")
      .setDesc("Provider used only for generating coding exercises.")
      .addDropdown(dropdown => {
        dropdown.addOptions({
          'openrouter': 'OpenRouter',
          'chutes': 'Chutes',
          'zai': 'ZAI',
          'ollama': 'Ollama',
          'proxy': 'OpenAI Proxy'
        });
        dropdown
          .setValue(this.plugin.settings.codingExerciseProvider)
          .onChange(async value => {
            this.plugin.settings.codingExerciseProvider = value as TextProviderId;
            this.plugin.settings.codingExerciseModel = this.getTextModelForProvider(value as TextProviderId);
            await this.plugin.saveSettings();
            this.display();
          });
      });

    new Setting(containerEl)
      .setName("Exercise Generation Model")
      .setDesc("Model used only for coding exercise task generation.")
      .addDropdown(dropdown => {
        const provider = this.plugin.settings.codingExerciseProvider;
        const models = this.getFilteredModelsForBackend(provider);
        const currentModel = this.plugin.settings.codingExerciseModel || this.getTextModelForProvider(provider);
        dropdown
          .addOptions(models)
          .setValue(currentModel)
          .onChange(async value => {
            this.plugin.settings.codingExerciseModel = value;
            await this.plugin.saveSettings();
          });
      });

    this.addNumberSetting(containerEl, "Exercise Generation Temperature", "Sampling temperature for exercise task generation.", this.plugin.settings.codingExerciseTemperature, async value => {
      this.plugin.settings.codingExerciseTemperature = value;
      await this.plugin.saveSettings();
    }, 0, 2);

    this.addNumberSetting(containerEl, "Exercise Generation Max Tokens", "Maximum output tokens for generated exercise JSON.", this.plugin.settings.codingExerciseMaxTokens, async value => {
      this.plugin.settings.codingExerciseMaxTokens = Math.max(500, Math.round(value));
      await this.plugin.saveSettings();
    }, 500);

    new Setting(containerEl)
      .setName("StudyAssistant Root Path")
      .setDesc("Optional external StudyAssistant corpus root used for importing existing C# exercises.")
      .addText(text => text
        .setValue(this.plugin.settings.studyAssistantRootPath)
        .onChange(async value => {
          this.plugin.settings.studyAssistantRootPath = value.trim();
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Allow Local Code Execution")
      .setDesc("Enable running generated exercise code through local tools. Only enable this if you trust the exercises and understand that code runs on this machine.")
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.allowLocalCodeExecution)
        .onChange(async value => {
          this.plugin.settings.allowLocalCodeExecution = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("LINQPad LPRun Path")
      .setDesc("Path to LPRun9-x64.exe used for C# exercise compile/run.")
      .addText(text => text
        .setValue(this.plugin.settings.linqPadLprunPath)
        .onChange(async value => {
          this.plugin.settings.linqPadLprunPath = value.trim();
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Exercise Run Timeout")
      .setDesc("Maximum local run time in milliseconds.")
      .addText(text => text
        .setValue(String(this.plugin.settings.exerciseRunTimeoutMs))
        .onChange(async value => {
          const parsed = parseInt(value, 10);
          if (!Number.isNaN(parsed) && parsed >= 1000) {
            this.plugin.settings.exerciseRunTimeoutMs = parsed;
            await this.plugin.saveSettings();
          }
        }));
  }

  addFlashcardGenerationSettings(containerEl: HTMLElement): void {
    containerEl.createEl('h2', { text: 'Flashcard Generation Settings' });

    new Setting(containerEl)
      .setName("Flashcard Generation Provider")
      .setDesc("Provider used by the flashcard side panel.")
      .addDropdown(dropdown => {
        dropdown.addOptions({
          'openrouter': 'OpenRouter',
          'chutes': 'Chutes',
          'zai': 'ZAI',
          'ollama': 'Ollama',
          'proxy': 'OpenAI Proxy'
        });
        dropdown
          .setValue(this.plugin.settings.flashcardGenerationProvider)
          .onChange(async value => {
            this.plugin.settings.flashcardGenerationProvider = value as TextProviderId;
            this.plugin.settings.flashcardGenerationModel = this.getTextModelForProvider(value as TextProviderId);
            await this.plugin.saveSettings();
            this.display();
          });
      });

    new Setting(containerEl)
      .setName("Flashcard Generation Model")
      .setDesc("Model used by the flashcard side panel.")
      .addDropdown(dropdown => {
        const provider = this.plugin.settings.flashcardGenerationProvider;
        const currentModel = this.plugin.settings.flashcardGenerationModel || this.getTextModelForProvider(provider);
        dropdown
          .addOptions(this.getFilteredModelsForBackend(provider))
          .setValue(currentModel)
          .onChange(async value => {
            this.plugin.settings.flashcardGenerationModel = value;
            await this.plugin.saveSettings();
          });
      });

    this.addNumberSetting(containerEl, "Flashcard Generation Temperature", "Sampling temperature for flashcard generation.", this.plugin.settings.flashcardGenerationTemperature, async value => {
      this.plugin.settings.flashcardGenerationTemperature = value;
      await this.plugin.saveSettings();
    }, 0, 2);

    this.addNumberSetting(containerEl, "Flashcard Generation Max Tokens", "Maximum output tokens for generated flashcard JSON.", this.plugin.settings.flashcardGenerationMaxTokens, async value => {
      this.plugin.settings.flashcardGenerationMaxTokens = Math.max(500, Math.round(value));
      await this.plugin.saveSettings();
    }, 500);
  }

  addStudySourceSettings(containerEl: HTMLElement): void {
    containerEl.createEl('h2', { text: 'Study Source Library' });

    new Setting(containerEl)
      .setName("Inventory Note Path")
      .setDesc("Generated note showing configured study sources, included files, and approximate token budgets.")
      .addText(text => text
        .setValue(this.plugin.settings.studySourceInventoryNotePath)
        .onChange(async value => {
          this.plugin.settings.studySourceInventoryNotePath = value.trim() || 'WikiSynthesis/Study/Source Library/Study Source Inventory.md';
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Scan Sources")
      .setDesc("Scan enabled groups and create/update the inventory note.")
      .addButton(button => button
        .setButtonText("Scan")
        .onClick(async () => {
          button.setDisabled(true).setButtonText("Scanning...");
          try {
            const result = await this.plugin.services.studySourceLibrary.scan();
            const file = await this.plugin.services.studySourceLibrary.createOrUpdateInventoryNote(result);
            await this.plugin.app.workspace.getLeaf(false).openFile(file);
            new Notice(`Study sources scanned: ${result.includedFiles}/${result.totalFiles} files, ~${result.includedEstimatedTokens} tokens included.`);
          } catch (error) {
            new Notice(`Failed to scan study sources: ${error instanceof Error ? error.message : 'Unknown error'}`);
          } finally {
            button.setDisabled(false).setButtonText("Scan");
          }
        }));

    const addContainer = containerEl.createDiv({ cls: 'study-source-add-container' });
    addContainer.createEl('h3', { text: 'Add Source Group' });

    let newName = '';
    let newPath = '';
    let newType: StudySourceType = 'reference';

    new Setting(addContainer)
      .setName("Name")
      .addText(text => text
        .setPlaceholder("C# Reference Notes")
        .onChange(value => {
          newName = value.trim();
        }));

    new Setting(addContainer)
      .setName("Path")
      .addText(text => text
        .setPlaceholder("H:\\Common\\foam\\knowledgeBase\\...")
        .onChange(value => {
          newPath = value.trim();
        }));

    new Setting(addContainer)
      .setName("Type")
      .addDropdown(dropdown => dropdown
        .addOptions({
          'reference': 'Reference',
          'exercise-corpus': 'Exercise Corpus',
          'summary': 'Summary',
          'plan': 'Plan',
          'docs': 'Docs',
          'canvas': 'Canvas',
          'other': 'Other'
        })
        .setValue(newType)
        .onChange(value => {
          newType = value as StudySourceType;
        }));

    new Setting(addContainer)
      .setName("Add Group")
      .addButton(button => button
        .setButtonText("Add")
        .onClick(async () => {
          if (!newName || !newPath) {
            new Notice("Enter both name and path.");
            return;
          }

          this.plugin.settings.studySourceGroups.push({
            id: `${Date.now()}-${newName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
            name: newName,
            path: newPath,
            type: newType,
            enabled: true,
            recursive: true,
            extensions: newType === 'canvas' ? ['canvas'] : ['md'],
            maxFiles: 100,
            maxEstimatedTokens: 100000,
            priority: this.plugin.settings.studySourceGroups.length * 10 + 100,
          });
          await this.plugin.saveSettings();
          this.display();
        }));

    containerEl.createEl('h3', { text: 'Configured Source Groups' });

    for (const group of this.plugin.settings.studySourceGroups) {
      new Setting(containerEl)
        .setName(group.name)
        .setDesc(`${group.type} | ${group.path} | extensions: ${group.extensions.join(', ')} | max ~${group.maxEstimatedTokens} tokens`)
        .addToggle(toggle => toggle
          .setValue(group.enabled)
          .onChange(async value => {
            group.enabled = value;
            await this.plugin.saveSettings();
          }))
        .addButton(button => button
          .setButtonText("Remove")
          .onClick(async () => {
            if (!confirm(`Remove study source group "${group.name}"?`)) {
              return;
            }
            this.plugin.settings.studySourceGroups = this.plugin.settings.studySourceGroups.filter(candidate => candidate.id !== group.id);
            await this.plugin.saveSettings();
            this.display();
          }));
    }
  }

  addStudyPathSettings(containerEl: HTMLElement): void {
    containerEl.createEl('h2', { text: 'Study Path Generation' });

    new Setting(containerEl)
      .setName("Study Path Provider")
      .setDesc("Provider used only for generating study plans and canvases from the source library.")
      .addDropdown(dropdown => {
        dropdown.addOptions({
          'openrouter': 'OpenRouter',
          'chutes': 'Chutes',
          'zai': 'ZAI',
          'ollama': 'Ollama',
          'proxy': 'OpenAI Proxy'
        });
        dropdown
          .setValue(this.plugin.settings.studyPathProvider)
          .onChange(async value => {
            this.plugin.settings.studyPathProvider = value as TextProviderId;
            this.plugin.settings.studyPathModel = this.getTextModelForProvider(value as TextProviderId);
            await this.plugin.saveSettings();
            this.display();
          });
      });

    new Setting(containerEl)
      .setName("Study Path Model")
      .setDesc("Model used for generating structured study path JSON.")
      .addDropdown(dropdown => {
        const provider = this.plugin.settings.studyPathProvider;
        const currentModel = this.plugin.settings.studyPathModel || this.getTextModelForProvider(provider);
        dropdown
          .addOptions(this.getFilteredModelsForBackend(provider))
          .setValue(currentModel)
          .onChange(async value => {
            this.plugin.settings.studyPathModel = value;
            await this.plugin.saveSettings();
          });
      });

    this.addNumberSetting(containerEl, "Study Path Temperature", "Sampling temperature for study path generation.", this.plugin.settings.studyPathTemperature, async value => {
      this.plugin.settings.studyPathTemperature = value;
      await this.plugin.saveSettings();
    }, 0, 2);

    this.addNumberSetting(containerEl, "Study Path Max Tokens", "Maximum output tokens for generated study path JSON.", this.plugin.settings.studyPathMaxTokens, async value => {
      this.plugin.settings.studyPathMaxTokens = Math.max(1500, Math.round(value));
      await this.plugin.saveSettings();
    }, 1500);

    this.addNumberSetting(containerEl, "Study Path Context Token Budget", "Approximate maximum source tokens fed to the model from included study sources.", this.plugin.settings.studyPathContextMaxTokens, async value => {
      this.plugin.settings.studyPathContextMaxTokens = Math.max(10000, Math.round(value));
      await this.plugin.saveSettings();
    }, 10000);

    new Setting(containerEl)
      .setName("Study Path Markdown Path")
      .setDesc("Vault path for the generated markdown study plan.")
      .addText(text => text
        .setValue(this.plugin.settings.studyPathMarkdownPath)
        .onChange(async value => {
          this.plugin.settings.studyPathMarkdownPath = value.trim() || 'WikiSynthesis/Study/Plans/CSharp/Generated CSharp Study Path.md';
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Study Path Canvas Path")
      .setDesc("Vault path for the generated Obsidian canvas.")
      .addText(text => text
        .setValue(this.plugin.settings.studyPathCanvasPath)
        .onChange(async value => {
          this.plugin.settings.studyPathCanvasPath = value.trim() || 'WikiSynthesis/Study/Plans/CSharp/Generated CSharp Study Path.canvas';
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Generate C# Study Path")
      .setDesc("Scan configured sources, generate a markdown plan and canvas, then open the canvas.")
      .addButton(button => button
        .setButtonText("Generate")
        .setCta()
        .onClick(async () => {
          button.setDisabled(true).setButtonText("Generating...");
          try {
            const result = await this.plugin.services.studyPathGenerator.generateCSharpStudyPath();
            const canvasFile = this.plugin.app.vault.getAbstractFileByPath(result.canvasPath);
            if (canvasFile instanceof TFile) {
              await this.plugin.app.workspace.getLeaf(false).openFile(canvasFile);
            }
            new Notice(`Generated study path: ${result.plan.stages.length} stages from ${result.sourceFileCount} files.`);
          } catch (error) {
            new Notice(`Failed to generate study path: ${error instanceof Error ? error.message : 'Unknown error'}`);
          } finally {
            button.setDisabled(false).setButtonText("Generate");
          }
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

    new Setting(containerEl)
      .setName("Later Today Delay")
      .setDesc("Minutes before a weak card marked Later Today becomes due again.")
      .addText(text => text
        .setValue(String(this.plugin.settings.spacedRepetition.sameDayReviewDelayMinutes))
        .onChange(async value => {
          const parsed = parseInt(value, 10);
          if (!Number.isNaN(parsed) && parsed >= 1) {
            this.plugin.settings.spacedRepetition.sameDayReviewDelayMinutes = parsed;
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
          'zai': 'ZAI',
          'ollama': 'Ollama',
          'proxy': 'OpenAI Proxy'
        });
        dropdown
          .setValue(this.plugin.settings.defaultLLMProvider)
          .onChange(async value => {
            this.plugin.settings.defaultLLMProvider = value as TextProviderId;
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

    // Chutes Base URL
    new Setting(containerEl)
      .setName("Chutes Base URL")
      .setDesc("Chutes-compatible chat completions endpoint. Leave blank to use the default Chutes.ai cloud endpoint (https://llm.chutes.ai/v1/chat/completions). Point this at your own reverse proxy / remote machine if you route Chutes traffic through one.")
      .addText(text => text
        .setValue(this.plugin.settings.chutesBaseUrl || '')
        .onChange(async value => {
          this.plugin.settings.chutesBaseUrl = value.trim() || undefined;
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

    // ZAI Base URL
    new Setting(containerEl)
      .setName("ZAI Base URL")
      .setDesc("ZAI-compatible chat completions endpoint. Leave blank to use the default Z.ai cloud endpoint (https://api.z.ai/api/paas/v4/chat/completions). Point this at your own reverse proxy / remote machine if you route ZAI traffic through one.")
      .addText(text => text
        .setValue(this.plugin.settings.zaiBaseUrl || '')
        .onChange(async value => {
          this.plugin.settings.zaiBaseUrl = value.trim() || undefined;
          await this.plugin.saveSettings();
        }));

    // Provider Timeout
    new Setting(containerEl)
      .setName("Ollama Base URL")
      .setDesc("Ollama server endpoint. Use http://localhost:11434 for local Ollama.")
      .addText(text => text
        .setValue(this.plugin.settings.ollamaBaseUrl || 'http://localhost:11434')
        .onChange(async value => {
          this.plugin.settings.ollamaBaseUrl = value.trim() || 'http://localhost:11434';
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Proxy Base URL")
      .setDesc("OpenAI-compatible proxy endpoint. Use http://server:3000/v1 or http://server:3000.")
      .addText(text => text
        .setValue(this.plugin.settings.proxyBaseUrl || 'http://localhost:3000/v1')
        .onChange(async value => {
          this.plugin.settings.proxyBaseUrl = value.trim() || 'http://localhost:3000/v1';
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Proxy API Key")
      .setDesc("Bearer key configured as PROXY_API_KEY on the proxy server.")
      .addText(text => text
        .setValue(this.plugin.settings.proxyApiKey || '')
        .onChange(async value => {
          this.plugin.settings.proxyApiKey = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Refresh Proxy Models")
      .setDesc("Load model IDs from the proxy /v1/models endpoint.")
      .addButton(button => button
        .setButtonText("Refresh Proxy")
        .onClick(async () => {
          button.setDisabled(true).setButtonText("Refreshing...");
          try {
            const client = LLMClientFactory.createProxyClient(
              this.plugin.settings.proxyApiKey,
              this.plugin.settings.proxyBaseUrl,
              this.plugin.settings.debugMode,
              this.plugin.settings.providerTimeout,
              this.plugin.settings.providerRetryCount
            );
            this.plugin.settings.proxyModels = await client.listModels();
            await this.plugin.saveSettings();
            new Notice(`Loaded ${this.plugin.settings.proxyModels.length} proxy model(s).`);
            this.display();
          } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            new Notice(`Failed to refresh proxy models: ${message}`);
          } finally {
            button.setDisabled(false).setButtonText("Refresh Proxy");
          }
        }));

    new Setting(containerEl)
      .setName("Refresh Ollama Models")
      .setDesc("Load models from Ollama /api/tags. Cloud models may not appear until used or signed in.")
      .addButton(button => button
        .setButtonText("Refresh Ollama")
        .onClick(async () => {
          button.setDisabled(true).setButtonText("Refreshing...");
          try {
            const client = LLMClientFactory.createOllamaClient(
              this.plugin.settings.ollamaBaseUrl,
              this.plugin.settings.debugMode,
              this.plugin.settings.ollamaTimeout
            );
            this.plugin.settings.ollamaModels = await client.listModels();
            await this.plugin.saveSettings();
            new Notice(`Loaded ${this.plugin.settings.ollamaModels.length} Ollama model(s).`);
            this.display();
          } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            new Notice(`Failed to refresh Ollama models: ${message}`);
          } finally {
            button.setDisabled(false).setButtonText("Refresh Ollama");
          }
        }));

    new Setting(containerEl)
      .setName("Ollama Timeout (seconds)")
      .setDesc("Longer values help with first cloud calls and larger local models.")
      .addText(text => text
        .setValue(String((this.plugin.settings.ollamaTimeout || 120000) / 1000))
        .onChange(async value => {
          const numValue = parseInt(value, 10) * 1000;
          if (!isNaN(numValue) && numValue > 0) {
            this.plugin.settings.ollamaTimeout = numValue;
            await this.plugin.saveSettings();
          }
        }));

    new Setting(containerEl)
      .setName("Provider Timeout (seconds)")
      .setDesc("Timeout for OpenRouter, Chutes, ZAI, and Proxy requests. Long video summaries often need 600-1200 seconds.")
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

    containerEl.createEl('h3', { text: 'Default Generation Request Settings' });

    this.addNumberSetting(containerEl, "Temperature", "Default sampling temperature for text generation.", this.plugin.settings.defaultTemperature, async value => {
      this.plugin.settings.defaultTemperature = value;
      await this.plugin.saveSettings();
    }, 0, 2);

    this.addNumberSetting(containerEl, "Max Tokens", "Default maximum output tokens for text generation.", this.plugin.settings.defaultMaxTokens, async value => {
      this.plugin.settings.defaultMaxTokens = Math.max(1, Math.round(value));
      await this.plugin.saveSettings();
    }, 1);

    this.addNumberSetting(containerEl, "Top P", "Default nucleus sampling value where supported.", this.plugin.settings.defaultTopP, async value => {
      this.plugin.settings.defaultTopP = value;
      await this.plugin.saveSettings();
    }, 0, 1);

    this.addNumberSetting(containerEl, "Presence Penalty", "Default presence penalty where supported.", this.plugin.settings.defaultPresencePenalty, async value => {
      this.plugin.settings.defaultPresencePenalty = value;
      await this.plugin.saveSettings();
    }, -2, 2);

    this.addNumberSetting(containerEl, "Frequency Penalty", "Default frequency penalty where supported.", this.plugin.settings.defaultFrequencyPenalty, async value => {
      this.plugin.settings.defaultFrequencyPenalty = value;
      await this.plugin.saveSettings();
    }, -2, 2);
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

  public getFilteredModelsForBackend(provider: TextProviderId): Record<string, string> {
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

      case 'ollama': {
        const models = this.plugin.settings.ollamaModels?.length
          ? this.plugin.settings.ollamaModels
          : [this.plugin.settings.ollamaTextModel || 'gemma4:31b-cloud'];
        return models.reduce((acc: Record<string, string>, model) => {
          acc[model] = model;
          return acc;
        }, {});
      }

      case 'proxy': {
        const models = this.plugin.settings.proxyModels?.length
          ? this.plugin.settings.proxyModels
          : [this.plugin.settings.proxyTextModel || 'nim:nvidia/nemotron-3-nano-omni-30b-a3b-reasoning'];
        return models.reduce((acc: Record<string, string>, model) => {
          acc[model] = model;
          return acc;
        }, {});
      }
      
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

  private addNumberSetting(
    containerEl: HTMLElement,
    name: string,
    desc: string,
    value: number,
    onValidChange: (value: number) => Promise<void>,
    min?: number,
    max?: number
  ): void {
    new Setting(containerEl)
      .setName(name)
      .setDesc(desc)
      .addText(text => text
        .setValue(String(value))
        .onChange(async input => {
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
          await onValidChange(parsed);
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
