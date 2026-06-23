// New file: modals/PlaylistSummaryModal.ts
import { App, Modal, Setting, Notice, ButtonComponent, DropdownComponent } from "obsidian";
import type GptFreeTextGeneratorPlugin from '../main';
import { SummaryType, SUMMARY_PROMPTS, getAvailableSummaryTypes } from '../utils/summaryPrompts';
import { TextProviderId } from '../types/providers';
import { SettingTab } from '../settings/SettingTab'; // Import SettingTab to access getFilteredModelsForBackend

export class PlaylistSummaryModal extends Modal {
  private plugin: GptFreeTextGeneratorPlugin;
  private playlistUrl: string = "";
  private videoUrls: string = "";
  private inputType: "playlist" | "list" = "playlist";
  private summaryModel: string; // Initialize in constructor
  private summaryType: SummaryType = 'general';
  private outputLanguage: string = "en";
  private videoLanguage: string = "en";
  private tokenOutput: number = 2000;
  private topic: string = "";
  private isProcessing: boolean = false;
  private skipExisting: boolean = true;
  private provider: TextProviderId; // New: Use multi-provider system
  private enableChunking: boolean = true; // New: Enable chunking toggle
  private modelDropdown: DropdownComponent | null = null; // Reference to model dropdown component

  constructor(app: App, plugin: GptFreeTextGeneratorPlugin) {
    super(app);
    this.plugin = plugin;
    this.provider = plugin.settings.defaultLLMProvider; // Initialize with default provider from settings
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

    contentEl.createEl("h2", { text: "Batch Video Summarization" });

    // Input type selection
    new Setting(contentEl)
      .setName("Input Type")
      .setDesc("Choose how to input multiple videos")
      .addDropdown(dropdown => dropdown
        .addOptions({
          "playlist": "YouTube Playlist URL",
          "list": "List of Video URLs"
        })
        .setValue(this.inputType)
        .onChange(value => {
          this.inputType = value as "playlist" | "list";
          this.updateInputFields();
        }));

    // Create container for dynamic input fields
    const inputContainer = contentEl.createDiv("input-container");
    this.updateInputFields(inputContainer);

    // Common settings
    this.createCommonSettings(contentEl);

    // Buttons container
    const buttonContainer = contentEl.createDiv("modal-button-container");

    // Process button
    const processButton = new ButtonComponent(buttonContainer)
      .setButtonText("Process Videos")
      .setCta()
      .onClick(async () => {
        await this.processVideos(processButton);
      });

    // Cancel button
    new ButtonComponent(buttonContainer)
      .setButtonText("Cancel")
      .onClick(() => {
        this.close();
      });
  }

  private updateInputFields(container?: HTMLElement) {
    const inputContainer = container || this.contentEl.querySelector(".input-container") as HTMLElement;
    if (!inputContainer) return;

    inputContainer.empty();

    if (this.inputType === "playlist") {
      new Setting(inputContainer)
        .setName("Playlist URL")
        .setDesc("Enter the URL of the YouTube playlist")
        .addText(text => text
          .setPlaceholder("https://www.youtube.com/playlist?list=...")
          .setValue(this.playlistUrl)
          .onChange(value => {
            this.playlistUrl = value;
          }));
    } else {
      new Setting(inputContainer)
        .setName("Video URLs")
        .setDesc("Enter one video URL per line")
        .addTextArea(text => text
          .setPlaceholder("https://youtube.com/watch?v=...\nhttps://youtube.com/watch?v=...")
          .setValue(this.videoUrls)
          .onChange(value => {
            this.videoUrls = value;
          }));
    }

    // Skip existing option
    new Setting(inputContainer)
      .setName("Skip Existing")
      .setDesc("Skip videos that already have summaries")
      .addToggle(toggle => toggle
        .setValue(this.skipExisting)
        .onChange(value => {
          this.skipExisting = value;
        }));
  }

  private createCommonSettings(contentEl: HTMLElement) {
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
      .addDropdown((dropdown) => {
        const types = getAvailableSummaryTypes();
        types.forEach(({ type, name }) => {
          dropdown.addOption(type, name);
        });
        dropdown
          .setValue(this.summaryType)
          .onChange(async (value) => {
            this.summaryType = value as SummaryType;
            // Show/hide topic input based on type
            this.toggleTopicInput(value as SummaryType);
          });
      });

    // Topic input (for tutorials)
    const topicContainer = contentEl.createDiv();
    this.createTopicInput(topicContainer);

    // Languages
    new Setting(contentEl)
      .setName("Video Language")
      .setDesc("What language is used in the videos")
      .addDropdown((dropdown) => {
        dropdown.addOptions({
          en: "English",
          ru: "Russian",
          es: "Spanish",
          fr: "French",
          de: "German",
          ja: "Japanese",
          zh: "Chinese",
        });
        dropdown
          .setValue(this.videoLanguage)
          .onChange((value) => {
            this.videoLanguage = value;
          });
      });

    new Setting(contentEl)
      .setName("Summary Language")
      .setDesc("Choose the language for the generated summaries")
      .addDropdown((dropdown) => {
        dropdown.addOptions({
          en: "English",
          ru: "Russian",
          es: "Spanish",
          fr: "French",
          de: "German",
          ja: "Japanese",
          zh: "Chinese",
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
      .addText(text => text
        .setPlaceholder("2000")
        .setValue(this.tokenOutput.toString())
        .onChange(value => {
          const parsedValue = parseInt(value, 10);
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
  }

  private createTopicInput(container: HTMLElement) {
    const setting = new Setting(container)
      .setName("Topic")
      .setDesc("Enter the main topic of the tutorials")
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

  private async processVideos(button: ButtonComponent) {
    // Get URLs to process
    let videoUrls: string[] = [];
    
    if (this.inputType === "playlist") {
      if (!this.playlistUrl.trim()) {
        new Notice("Please enter a playlist URL");
        return;
      }
      
      try {
        this.isProcessing = true;
        button.setButtonText("Processing...").setDisabled(true);
        
        // Extract URLs from playlist
        videoUrls = await this.extractPlaylistUrls(this.playlistUrl);
        
        if (videoUrls.length === 0) {
          new Notice("No videos found in playlist");
          this.isProcessing = false;
          button.setButtonText("Process Videos").setDisabled(false);
          return;
        }
        
        new Notice(`Found ${videoUrls.length} videos in playlist`);
      } catch (error: unknown) { // Explicitly type error as unknown
        if (error instanceof Error) {
          new Notice(`Failed to process playlist: ${error.message}`);
        } else {
          new Notice("Failed to process playlist: An unknown error occurred.");
        }
        this.isProcessing = false;
        button.setButtonText("Process Videos").setDisabled(false);
        return;
      }
    } else {
      // Process list of URLs
      if (!this.videoUrls.trim()) {
        new Notice("Please enter at least one video URL");
        return;
      }
      
      videoUrls = this.videoUrls
        .split('\n')
        .map(url => url.trim())
        .filter(url => url.length > 0);
      
      if (videoUrls.length === 0) {
        new Notice("No valid video URLs found");
        return;
      }
    }
    
    // Open the progress view
    this.plugin.videoQueueManager.addToQueue(videoUrls, {
      summaryModel: this.summaryModel,
      summaryType: this.summaryType,
      videoLanguage: this.videoLanguage,
      outputLanguage: this.outputLanguage,
      numberOfOutputTokens: this.tokenOutput,
      topic: this.topic,
      skipExisting: this.skipExisting,
      provider: this.provider, // Pass the selected provider (NEW)
      enableChunking: this.enableChunking // Pass the chunking option
    });
    
    this.plugin.activateVideoProcessingView();
    this.close();
  }

    private async extractPlaylistUrls(playlistUrl: string): Promise<string[]> {
      try {
        // Extract playlist ID from URL
        const playlistIdMatch = playlistUrl.match(/[?&]list=([^&]+)/);
        if (!playlistIdMatch) {
          throw new Error("Invalid playlist URL. Could not extract playlist ID.");
        }
        const playlistId = playlistIdMatch[1];

        // Use YouTube's no-JS embed page to get video IDs
        const embedUrl = `https://www.youtube.com/embed/videoseries?list=${playlistId}`;
        const response = await fetch(embedUrl);

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const html = await response.text();

        // Extract video IDs using regex
        const videoIdRegex = /"videoId":"([^"]+)"/g;
        const videoIds: string[] = [];
        let match;

        while ((match = videoIdRegex.exec(html)) !== null) {
          const videoId = match[1];
          if (!videoIds.includes(videoId)) {
            videoIds.push(videoId);
          }
        }

        if (videoIds.length === 0) {
          throw new Error("No videos found in playlist. The playlist might be private or empty.");
        }

        // Convert video IDs to full URLs
        const videoUrls = videoIds.map(videoId => `https://www.youtube.com/watch?v=${videoId}`);
        return videoUrls;
      } catch (error: unknown) { // Explicitly type error as unknown
        throw new Error(`Failed to extract playlist: ${error instanceof Error ? error.message : 'An unknown error occurred.'}`);
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
