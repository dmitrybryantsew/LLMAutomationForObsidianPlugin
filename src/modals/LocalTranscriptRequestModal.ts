import { App, Modal, Setting, Notice, TextComponent, ButtonComponent, DropdownComponent } from "obsidian";
import { TranscriptManager } from "../utils/TranscriptManager";
import { FileManager } from "../utils/FileManager";
import { HierarchyManager } from "../utils/HierarchyManager";
import type GptFreeTextGeneratorPlugin from "../main";
import { sanitizeFilename } from "../utils/helpers";
import { SummaryType, SUMMARY_PROMPTS, getAvailableSummaryTypes } from '../utils/summaryPrompts';
import { TextProviderId } from '../types/providers';
import { SettingTab } from '../settings/SettingTab';

export class LocalTranscriptRequestModal extends Modal {
  private plugin: GptFreeTextGeneratorPlugin;
  private transcriptManager: TranscriptManager;
  private fileManager: FileManager;
  private hierarchyManager: HierarchyManager;

  private localFilePath: string = "";
  private title: string = "";
  private authorOrCourse: string = "";

  private transcriptLanguage: string = "en";
  private outputLanguage: string = "en";
  private summaryModel: string;
  private summaryType: SummaryType;
  private tokenOutput: number;
  private topic: string;
  private provider: TextProviderId;
  private modelDropdown: DropdownComponent | null = null;
  private saveToDatabase: boolean = true; // default ON: no transcript in result file
  private enableChunking: boolean = false; // default OFF
  private flatFolder: boolean = false; // default OFF: save under Author/Title

  constructor(app: App, plugin: GptFreeTextGeneratorPlugin, transcriptManager: TranscriptManager, fileManager: FileManager, hierarchyManager: HierarchyManager) {
    super(app);
    this.plugin = plugin;
    this.transcriptManager = transcriptManager;
    this.fileManager = fileManager;
    this.hierarchyManager = hierarchyManager;

    this.provider = plugin.settings.defaultLLMProvider;
    this.summaryModel = this.getSummaryModelForProvider(this.provider);
    this.summaryType = plugin.settings.summaryType;
    this.tokenOutput = plugin.settings.numberOfOutputTokens;
    this.topic = "";
  }

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
    contentEl.createEl("h2", { text: "Process Local Transcript" });
    contentEl.createEl("p", { text: "Please ensure the .txt transcript file is located within your Obsidian vault. Provide the path relative to your vault root." });

    let titleTextInput: TextComponent; // Declare TextComponent instance

    new Setting(contentEl)
      .setName("Local Transcript File Path")
      .setDesc("Path to the local .txt transcript file (e.g., 'MyNotes/Transcripts/my_video.txt')")
      .addText((text) =>
        text
          .setPlaceholder("Enter file path within vault")
          .setValue(this.localFilePath)
          .onChange((value) => {
            this.localFilePath = value;
            // Attempt to derive title from filename immediately
            if (!this.title && titleTextInput) { // Check if titleTextInput is defined
              this.title = value.split('/').pop()?.replace(/\.txt$/, '') || '';
              titleTextInput.setValue(this.title); // Update the title input field
            }
          })
      );

    new Setting(contentEl)
      .setName("Title (Optional, derived from filename if empty)")
      .setDesc("The title for the transcript. If left empty, it will be derived from the filename.")
      .addText((text) => {
        titleTextInput = text; // Assign the TextComponent instance
        text
          .setPlaceholder("Enter title")
          .setValue(this.title)
          .onChange((value) => {
            this.title = value;
          });
      });

    new Setting(contentEl)
      .setName("Author/Course")
      .setDesc("The author or course name for hierarchical organization (e.g., 'John Doe' or 'Machine Learning Course'). This field is required.")
      .addText((text) =>
        text
          .setPlaceholder("Enter author or course name")
          .setValue(this.authorOrCourse)
          .onChange((value) => {
            this.authorOrCourse = value;
          })
      );

    new Setting(contentEl)
      .setName("Transcript Language")
      .setDesc("The original language of the transcript.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("en", "English")
          .addOption("ru", "Russian")
          .setValue(this.transcriptLanguage)
          .onChange((value) => {
            this.transcriptLanguage = value;
          })
      );

    new Setting(contentEl)
      .setName("Output Language")
      .setDesc("The language for the output markdown file (can be the same as transcript language).")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("en", "English")
          .addOption("ru", "Russian")
          .setValue(this.outputLanguage)
          .onChange((value) => {
            this.outputLanguage = value;
          })
      );

    // Provider Selection
    new Setting(contentEl)
      .setName("LLM Provider")
      .setDesc("Choose the AI provider for text generation")
      .addDropdown((dropdown) => {
        dropdown.addOptions({
          openrouter: "OpenRouter",
          chutes: "Chutes",
          zai: "ZAI",
          ollama: "Ollama",
          proxy: "OpenAI Proxy",
        });
        dropdown
          .setValue(this.provider)
          .onChange(async (value) => {
            this.provider = value as TextProviderId;
            this.summaryModel = this.getSummaryModelForProvider(this.provider);
            this.updateModelDropdown(contentEl);
          });
      });

    // Summary Model Selection (dynamic)
    new Setting(contentEl)
      .setName("Summary Model")
      .setDesc("The LLM model to use for generating the summary and tags.")
      .addDropdown((dropdown) => {
        this.modelDropdown = dropdown;
        this.updateModelDropdown(contentEl);
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


    new Setting(contentEl)
      .setName("Number of Output Tokens")
      .setDesc("The maximum number of tokens for the generated summary.")
      .addText((text) =>
        text
          .setPlaceholder("e.g., 1000")
          .setValue("2000") //TODO fix crash properly
          .onChange((value) => {
            const num = parseInt(value);
            if (!isNaN(num) && num > 0) {
              this.tokenOutput = num;
            } else {
              new Notice("Please enter a valid positive number for tokens.");
            }
          })
      );

    new Setting(contentEl)
      .setName("Topic (Optional)")
      .setDesc("An optional topic to guide the summary generation, especially for tutorials.")
      .addText((text) =>
        text
          .setPlaceholder("e.g., 'React Hooks'")
          .setValue(this.topic)
          .onChange((value) => {
            this.topic = value;
          })
      );

    // Save to Database toggle
    new Setting(contentEl)
      .setName("Save Transcript to Database")
      .setDesc("If ON, the transcript text is NOT embedded in the summary file (keeps files small). If OFF, the full transcript is included in a collapsible section.")
      .addToggle((toggle) =>
        toggle.setValue(this.saveToDatabase).onChange((value) => {
          this.saveToDatabase = value;
        })
      );

    // Process in Chunks toggle
    new Setting(contentEl)
      .setName("Process in Chunks")
      .setDesc("If ON, long transcripts are split into chunks and summarized separately, then combined. If OFF, the entire transcript is sent at once.")
      .addToggle((toggle) =>
        toggle.setValue(this.enableChunking).onChange((value) => {
          this.enableChunking = value;
        })
      );

    // Flat Folder toggle
    new Setting(contentEl)
      .setName("Flat Folder Structure")
      .setDesc("If ON, the summary file is saved directly in the summary folder. If OFF, it's saved under Author/Title subfolders.")
      .addToggle((toggle) =>
        toggle.setValue(this.flatFolder).onChange((value) => {
          this.flatFolder = value;
        })
      );

    // Buttons container
    const buttonContainer = contentEl.createDiv("modal-button-container");

    // Process button
    const processButton = new ButtonComponent(buttonContainer)
      .setButtonText("Process Transcript")
      .setCta()
      .onClick(async () => {
        if (!this.localFilePath) {
          new Notice("Please provide a local transcript file path.");
          return;
        }
        if (!this.authorOrCourse) {
          new Notice("Please provide an Author/Course name.");
          return;
        }

        this.close();
        new Notice("Processing local transcript...");

        try {
          // Get summary folder from plugin settings
          const summaryFolder = this.plugin.settings.summaryFolder;
          const summaryTypeConfig = SUMMARY_PROMPTS[this.summaryType];

          const filePath = await this.transcriptManager.processLocalTranscript({
            filePath: this.localFilePath,
            title: this.title,
            authorOrCourse: this.authorOrCourse,
            transcriptLanguage: this.transcriptLanguage,
            outputLanguage: this.outputLanguage,
            targetFolder: summaryFolder,
            summaryModel: this.summaryModel,
            summaryPrompt: summaryTypeConfig.summaryPrompt,
            tagPrompt: summaryTypeConfig.tagPrompt,
            summaryType: this.summaryType,
            numberOfOutputTokens: this.tokenOutput,
            topic: this.topic,
            provider: this.provider,
            saveToDatabase: this.saveToDatabase,
            enableChunking: this.enableChunking,
            flatFolder: this.flatFolder,
          });

          new Notice(`Transcript and Summary saved to: ${filePath}`);

          // Now, apply hierarchy using the LLM
          new Notice("Determining and applying hierarchy...");
          // The videoUrl for local files will be a file:// URI
          const videoUrl = `file://${this.localFilePath}`;
          // Use the summaryModel from plugin settings for hierarchy determination
          const hierarchyModel = this.summaryModel; // Use the selected summary model for hierarchy

          await this.hierarchyManager.determineAndApplyHierarchy(filePath, videoUrl, hierarchyModel);
          new Notice("Hierarchy applied successfully!");

        } catch (error: unknown) { // Explicitly type error as unknown
          console.error("Error processing local transcript or applying hierarchy:", error);
          new Notice(`Failed to process transcript: ${(error as Error).message || error}`);
        }
      });

    // Cancel button
    new ButtonComponent(buttonContainer)
      .setButtonText("Cancel")
      .onClick(() => {
        this.close();
      });
    
    contentEl.appendChild(buttonContainer); // Append the button container to contentEl
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

  private updateModelDropdown(containerEl: HTMLElement) {
    if (!this.modelDropdown) return;
    const settingTab = new SettingTab(this.app, this.plugin);
    const models = settingTab.getFilteredModelsForBackend(this.provider);
    this.modelDropdown.selectEl.empty();
    for (const [value, label] of Object.entries(models)) {
      this.modelDropdown.addOption(value, label as string);
    }
    const firstModel = Object.keys(models)[0];
    this.modelDropdown.setValue(models[this.summaryModel] ? this.summaryModel : firstModel);
    if (!models[this.summaryModel]) {
      this.summaryModel = firstModel;
    }
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
