import { 
    App, 
    Setting, 
    Modal, 
    Notice,
    ButtonComponent,
    DropdownComponent
  } from "obsidian";
  
  import type GptFreeTextGeneratorPlugin from '../main';
  import { SummaryType, SUMMARY_PROMPTS, getAvailableSummaryTypes } from '../utils/summaryPrompts';
  import { SettingTab } from '../settings/SettingTab'; // Import SettingTab to access getFilteredOpenRouterModels
  
  export class VideoSummaryModal extends Modal {
    private plugin: GptFreeTextGeneratorPlugin;
    private summaryModel: string; // Initialize in constructor
    private videoUrl: string = "";
    private summaryType: SummaryType = 'general';
    private outputLanguage: string = "en";
    private topic: string = "";
    private isProcessing: boolean = false;
    private videoLanguage : string = "en";
    private tokenOutput : number = 2000;
    private provider: 'openrouter' | 'chutes' | 'zai'; // New: Use multi-provider system
    private enableChunking: boolean = true; // New: Enable chunking toggle
    private saveToDatabase: boolean = false; // New: Save transcript to database toggle
    private modelDropdown: DropdownComponent | null = null; // Reference to model dropdown component
  
    constructor(app: App, plugin: GptFreeTextGeneratorPlugin) {
      super(app);
      this.plugin = plugin;
      this.provider = plugin.settings.defaultLLMProvider; // Initialize provider from settings
      this.summaryModel = this.getSummaryModelForProvider(this.provider); // Initialize with provider-specific model
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
  
    onOpen() {
      const { contentEl } = this;
      contentEl.empty();
  
      contentEl.createEl("h2", { text: "Create Video Summary" });
  
      // Video URL input
      new Setting(contentEl)
        .setName("Video URL")
        .setDesc("Enter the URL of the YouTube video")
        .addText(text => text
          .setPlaceholder("https://youtube.com/...")
          .setValue(this.videoUrl)
          .onChange(value => {
            this.videoUrl = value;
          }));
          
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
              this.summaryModel = this.getSummaryModelForProvider(this.provider); // Update model for new provider
              this.updateModelDropdown(contentEl); // Update model dropdown based on new provider
            });
        });
  
      // Summary Model Selection
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
  
      // Summary Type Selection
      new Setting(contentEl)
        .setName("Summary Type")
        .setDesc("Choose the type of video for better summarization")
        .addDropdown((dropdown: DropdownComponent) => {
          const types = getAvailableSummaryTypes();
          types.forEach(({ type, name }) => {
            dropdown.addOption(type, name);
          });
          dropdown
            .setValue(this.summaryType)
            .onChange(async (value) => {
              this.summaryType = value as SummaryType;
              // Update description
              typeDesc.innerText = SUMMARY_PROMPTS[value as SummaryType].description;
              // Show/hide topic input based on type
              this.toggleTopicInput(value as SummaryType);
            });
        });
  
      // Description of selected type
      const typeDesc = contentEl.createEl('p', {
        text: SUMMARY_PROMPTS[this.summaryType].description,
        cls: 'setting-item-description'
      });
  
      new Setting(contentEl)
        .setName("Video Language")
        .setDesc("What language used in the video")
        .addDropdown((dropdown) => {
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
            .setValue(this.videoLanguage)
            .onChange((value) => {
              this.videoLanguage = value;
            });
        });
  
      new Setting(contentEl)
        .setName("Summary Language")
        .setDesc("Choose the language for the generated summary")
        .addDropdown((dropdown) => {
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
            .onChange((value) => {
              this.outputLanguage = value;
            });
        });
  
      
      new Setting(contentEl)
        .setName("Number of output tokens")
        .setDesc("Enter the amount of tokens to generate up to 164000. (more != better output; ~2-3k per 30mins of video)")
        .addText(Number => Number
          .setPlaceholder("2000")
          .setValue(this.tokenOutput.toString()) // Ensure the initial value is a string
          .onChange(value => {
              const parsedValue = parseInt(value, 10); // Convert input to a number
              if (!isNaN(parsedValue)) {
                  this.tokenOutput = parsedValue;
              }
          }));
  
      // Enable Chunking toggle
      new Setting(contentEl)
        .setName("Enable Chunking")
        .setDesc("Enable chunking for long videos (recommended for videos longer than 30 minutes)")
        .addToggle(toggle => toggle
          .setValue(this.enableChunking)
          .onChange(value => {
            this.enableChunking = value;
          }));
  
      // Save to Database toggle
      new Setting(contentEl)
        .setName("Save Transcript to Database")
        .setDesc("Store transcript in database instead of note file (transcript will be accessible via modal)")
        .addToggle(toggle => toggle
          .setValue(this.saveToDatabase)
          .onChange(value => {
            this.saveToDatabase = value;
          }));
  
      // Topic input (for tutorials)
      const topicContainer = contentEl.createDiv();
      this.createTopicInput(topicContainer);
  
      // Buttons container
      const buttonContainer = contentEl.createDiv("modal-button-container");
  
      // Create Summary button
      const createButton = new ButtonComponent(buttonContainer)
        .setButtonText("Create Summary")
        .setCta()
        .onClick(async () => {
          await this.createSummary(createButton);
        });
  
      // Cancel button
      new ButtonComponent(buttonContainer)
        .setButtonText("Cancel")
        .onClick(() => {
          this.close();
        });
    }
  
    private createTopicInput(container: HTMLElement) {
      const setting = new Setting(container)
        .setName("Topic")
        .setDesc("Enter the main topic of the tutorial")
        .addText(text => text
          .setPlaceholder("e.g., Blueprint Communication")
          .setValue(this.topic)
          .onChange(value => {
            this.topic = value;
          }));
      
      setting.settingEl.id = 'topic-input';
      this.toggleTopicInput(this.summaryType);
    }
  
    private toggleTopicInput(type: SummaryType) {
      const topicSetting = document.getElementById('topic-input');
      if (topicSetting) {
        topicSetting.style.display = 
          type === 'unreal_tutorial' || type === 'programming_tutorial' 
            ? 'block' 
            : 'none';
      }
    }
    private getLanguageName(langCode: string): string {
      const languages: {[key: string]: string} = {
        "en": "English",
        "ru": "Russian",
        "es": "Spanish",
        "fr": "French",
        "de": "German",
        "ja": "Japanese",
        "zh": "Chinese",
        // Add more as needed
      };
      return languages[langCode] || langCode;
    }
    private async createSummary(button: ButtonComponent) {
      if (!this.videoUrl.trim()) {
        new Notice("Please enter a video URL");
        return;
      }
  
      if (this.isProcessing) {
        return;
      }
  
      try {
        this.isProcessing = true;
        button.setButtonText("Processing...").setDisabled(true);
  
        // Get the appropriate prompts
        const prompts = SUMMARY_PROMPTS[this.summaryType];
        
        // Replace {topic} in prompt if needed
        const summaryPrompt = this.topic 
          ? prompts.summaryPrompt.replace(/\{topic\}/g, this.topic)
          : prompts.summaryPrompt;
  
        await this.plugin.transcriptManager.createLongVideoSummary({
          videoUrl: this.videoUrl,
          summaryModel: this.summaryModel,
          summaryPrompt: summaryPrompt,
          tagPrompt: prompts.tagPrompt,
          summaryType: this.summaryType,
          summaryFolder: this.plugin.settings.summaryFolder,
          videoLanguage: this.videoLanguage,
          outputLanguage : this.outputLanguage,
          numberOfOutputTokens : this.tokenOutput,
          enableChunking: this.enableChunking, // Pass the chunking option
          saveToDatabase: this.saveToDatabase, // Pass the database storage option
          provider: this.provider // Pass the selected provider
        });
  
        this.close();
      } catch (error: unknown) {
        if (error instanceof Error) {
          new Notice(`Failed to create summary: ${error.message}`);
        } else {
          new Notice("Failed to create summary: An unknown error occurred.");
        }
        button.setButtonText("Create Summary").setDisabled(false);
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
