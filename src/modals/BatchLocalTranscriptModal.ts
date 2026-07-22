import { App, Modal, Setting, Notice, ButtonComponent, DropdownComponent } from "obsidian";
import type GptFreeTextGeneratorPlugin from "../main";
import { SummaryType, SUMMARY_PROMPTS, getAvailableSummaryTypes } from "../utils/summaryPrompts";
import { TextProviderId } from "../types/providers";
import { SettingTab } from "../settings/SettingTab";
import { FolderPickerModal } from "./FolderPickerModal";

/**
 * Modal for batch-processing local transcript .txt files.
 * Scans a source folder for .txt files, queues them into VideoQueueManager,
 * and processes them via TranscriptManager.processLocalTranscript().
 * Reuses the same VideoProcessingView sidebar for progress tracking.
 */
export class BatchLocalTranscriptModal extends Modal {
  private plugin: GptFreeTextGeneratorPlugin;
  private sourceFolder: string = "";
  private targetFolder: string = "";
  private defaultAuthor: string = "";
  private summaryModel: string;
  private summaryType: SummaryType = "general";
  private transcriptLanguage: string = "en";
  private outputLanguage: string = "en";
  private tokenOutput: number = 2000;
  private topic: string = "";
  private skipExisting: boolean = true;
  private saveToDatabase: boolean = true; // default ON: no transcript in result file
  private enableChunking: boolean = false; // default OFF
  private flatFolder: boolean = false; // default OFF: save under Author/Title
  private provider: TextProviderId;
  private modelDropdown: DropdownComponent | null = null;

  constructor(app: App, plugin: GptFreeTextGeneratorPlugin) {
    super(app);
    this.plugin = plugin;
    this.provider = plugin.settings.defaultLLMProvider;
    this.summaryModel = this.getSummaryModelForProvider(this.provider);
  }

  private getSummaryModelForProvider(provider: TextProviderId): string {
    switch (provider) {
      case "openrouter":
        return this.plugin.settings.openrouterSummaryModel || this.plugin.settings.summaryModel;
      case "chutes":
        return this.plugin.settings.chutesSummaryModel || "deepseek-ai/DeepSeek-V3.2-Speciale-TEE";
      case "zai":
        return this.plugin.settings.zaiSummaryModel || "glm-4.6";
      case "ollama":
        return this.plugin.settings.ollamaSummaryModel || "gemma4:31b-cloud";
      case "proxy":
        return this.plugin.settings.proxySummaryModel || "nim:nvidia/nemotron-3-nano-omni-30b-a3b-reasoning";
      default:
        return this.plugin.settings.summaryModel;
    }
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Batch Local Transcript Summarization" });
    contentEl.createEl("p", {
      text: "Select a folder containing .txt transcript files. Each will be summarized and saved to the target folder.",
    });

    // Source folder picker
    new Setting(contentEl)
      .setName("Source Folder")
      .setDesc("Folder containing .txt transcript files to process")
      .addText((text) => {
        text
          .setPlaceholder("e.g., Transcripts/MyCourse")
          .setValue(this.sourceFolder)
          .onChange((value) => {
            this.sourceFolder = value.trim();
          });
      })
      .addButton((btn) => {
        btn.setButtonText("Browse").onClick(() => {
          new FolderPickerModal(this.app, (folder) => {
            this.sourceFolder = folder.path;
            const input = contentEl.querySelector(
              "input[placeholder='e.g., Transcripts/MyCourse']"
            ) as HTMLInputElement | null;
            if (input) input.value = this.sourceFolder;
          }).open();
        });
      });

    // Target folder picker
    new Setting(contentEl)
      .setName("Target Folder")
      .setDesc("Where to save summary notes (defaults to Summary folder in settings)")
      .addText((text) => {
        text
          .setPlaceholder("e.g., Summaries/MyCourse")
          .setValue(this.targetFolder)
          .onChange((value) => {
            this.targetFolder = value.trim();
          });
      })
      .addButton((btn) => {
        btn.setButtonText("Browse").onClick(() => {
          new FolderPickerModal(this.app, (folder) => {
            this.targetFolder = folder.path;
            const input = contentEl.querySelector(
              "input[placeholder='e.g., Summaries/MyCourse']"
            ) as HTMLInputElement | null;
            if (input) input.value = this.targetFolder;
          }).open();
        });
      });

    // Default author
    new Setting(contentEl)
      .setName("Default Author/Course")
      .setDesc("Author or course name used for all transcripts in this batch")
      .addText((text) => {
        text
          .setPlaceholder("e.g., John Doe or Machine Learning Course")
          .setValue(this.defaultAuthor)
          .onChange((value) => {
            this.defaultAuthor = value.trim();
          });
      });

    // Skip existing
    new Setting(contentEl)
      .setName("Skip Existing")
      .setDesc("Skip transcripts that already have summaries")
      .addToggle((toggle) =>
        toggle.setValue(this.skipExisting).onChange((value) => {
          this.skipExisting = value;
        })
      );

    // Save to Database (no transcript in result file)
    new Setting(contentEl)
      .setName("Save Transcript to Database")
      .setDesc("If ON, the transcript text is NOT embedded in the summary file (keeps files small). If OFF, the full transcript is included in a collapsible section.")
      .addToggle((toggle) =>
        toggle.setValue(this.saveToDatabase).onChange((value) => {
          this.saveToDatabase = value;
        })
      );

    // Process in Chunks
    new Setting(contentEl)
      .setName("Process in Chunks")
      .setDesc("If ON, long transcripts are split into chunks and summarized separately, then combined. If OFF, the entire transcript is sent at once.")
      .addToggle((toggle) =>
        toggle.setValue(this.enableChunking).onChange((value) => {
          this.enableChunking = value;
        })
      );

    // Flat Folder (save directly in target, no author subfolder)
    new Setting(contentEl)
      .setName("Flat Folder Structure")
      .setDesc("If ON, all summary files are saved directly in the target folder. If OFF, files are saved under Author/Title subfolders.")
      .addToggle((toggle) =>
        toggle.setValue(this.flatFolder).onChange((value) => {
          this.flatFolder = value;
        })
      );

    this.createCommonSettings(contentEl);

    // Buttons
    const buttonContainer = contentEl.createDiv("modal-button-container");

    new ButtonComponent(buttonContainer)
      .setButtonText("Process Transcripts")
      .setCta()
      .onClick(async () => {
        await this.processTranscripts();
      });

    new ButtonComponent(buttonContainer).setButtonText("Cancel").onClick(() => {
      this.close();
    });
  }

  private createCommonSettings(contentEl: HTMLElement) {
    // Provider
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
        dropdown.setValue(this.provider).onChange(async (value) => {
          this.provider = value as TextProviderId;
          this.summaryModel = this.getSummaryModelForProvider(this.provider);
          this.updateModelDropdown(contentEl);
        });
      });

    // Model
    new Setting(contentEl)
      .setName("Summary Model")
      .setDesc("Choose the AI model for generating the summary")
      .addDropdown((dropdown) => {
        this.modelDropdown = dropdown;
        this.updateModelDropdown(contentEl);
        dropdown.setValue(this.summaryModel).onChange((value) => {
          this.summaryModel = value;
        });
      });

    // Summary Type
    new Setting(contentEl)
      .setName("Summary Type")
      .setDesc("Choose the type of content for better summarization")
      .addDropdown((dropdown) => {
        const types = getAvailableSummaryTypes();
        types.forEach(({ type, name }) => {
          dropdown.addOption(type, name);
        });
        dropdown.setValue(this.summaryType).onChange(async (value) => {
          this.summaryType = value as SummaryType;
          this.toggleTopicInput(value as SummaryType);
        });
      });

    // Topic
    const topicContainer = contentEl.createDiv();
    this.createTopicInput(topicContainer);

    // Transcript Language
    new Setting(contentEl)
      .setName("Transcript Language")
      .setDesc("The original language of the transcripts")
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
        dropdown.setValue(this.transcriptLanguage).onChange((value) => {
          this.transcriptLanguage = value;
        });
      });

    // Output Language
    new Setting(contentEl)
      .setName("Summary Language")
      .setDesc("Language for the generated summaries")
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
        dropdown.setValue(this.outputLanguage).onChange((value) => {
          this.outputLanguage = value;
        });
      });

    // Output tokens
    new Setting(contentEl)
      .setName("Number of Output Tokens")
      .setDesc("Max tokens for the generated summary (~2-3k per 30 mins of content)")
      .addText((text) => {
        text
          .setPlaceholder("2000")
          .setValue(this.tokenOutput.toString())
          .onChange((value) => {
            const parsed = parseInt(value, 10);
            if (!isNaN(parsed)) {
              this.tokenOutput = parsed;
            }
          });
      });
  }

  private createTopicInput(container: HTMLElement) {
    const setting = new Setting(container)
      .setName("Topic")
      .setDesc("Enter the main topic (for tutorials)")
      .addText((text) =>
        text
          .setPlaceholder("e.g., Blueprint Communication")
          .setValue(this.topic)
          .onChange((value) => {
            this.topic = value;
          })
      );
    setting.settingEl.id = "batch-topic-input";
    this.toggleTopicInput(this.summaryType);
  }

  private toggleTopicInput(type: SummaryType) {
    const topicSetting = document.getElementById("batch-topic-input");
    if (topicSetting) {
      topicSetting.style.display =
        type === "unreal_tutorial" || type === "programming_tutorial" ? "block" : "none";
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

  private async processTranscripts() {
    if (!this.sourceFolder) {
      new Notice("Please select a source folder.");
      return;
    }
    if (!this.defaultAuthor) {
      new Notice("Please provide a Default Author/Course name.");
      return;
    }

    try {
      // List all .txt files in the source folder
      const listing = await this.app.vault.adapter.list(this.sourceFolder);
      // Normalize: strip leading slashes, resolve double slashes, remove trailing slash
      const txtFiles = listing.files
        .filter((f) => f.toLowerCase().endsWith(".txt"))
        .map((f) => f.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+/g, '/').replace(/\/$/, ''));

      if (txtFiles.length === 0) {
        new Notice("No .txt transcript files found in the selected folder.");
        return;
      }

      new Notice(`Found ${txtFiles.length} transcript(s). Starting batch processing...`);

      const targetFolder = this.targetFolder || this.plugin.settings.summaryFolder;

      this.plugin.videoQueueManager.addLocalTranscriptsToQueue(txtFiles, {
        summaryModel: this.summaryModel,
        summaryType: this.summaryType,
        videoLanguage: this.transcriptLanguage,
        outputLanguage: this.outputLanguage,
        numberOfOutputTokens: this.tokenOutput,
        topic: this.topic,
        skipExisting: this.skipExisting,
        provider: this.provider,
        saveToDatabase: this.saveToDatabase,
        enableChunking: this.enableChunking,
        localTranscript: {
          sourceFolder: this.sourceFolder,
          defaultAuthor: this.defaultAuthor,
          targetFolder,
          flatFolder: this.flatFolder,
        },
      });

      this.plugin.activateVideoProcessingView();
      this.close();
    } catch (error) {
      console.error("Error scanning source folder:", error);
      new Notice(
        `Failed to scan folder: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }

  onClose() {
    this.contentEl.empty();
  }
}
