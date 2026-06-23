import { App, Modal, Setting } from "obsidian";
import type GptFreeTextGeneratorPlugin from '../main';
import { TranscriptManager } from "../utils/TranscriptManager";
import { ErrorHandler } from "../utils/ErrorHandler";
import { TextProviderId } from '../types/providers';

export class TranscriptRequestModal extends Modal {
  private plugin: GptFreeTextGeneratorPlugin;
  private transcriptManager: TranscriptManager;
  private videoUrl: string = "";
  private transcriptLanguage: string = "en";
  private outputLanguage: string = "en"; // Add new property for output language
  private provider: TextProviderId; // New: Use multi-provider system

  constructor(app: App, plugin: GptFreeTextGeneratorPlugin) {
    super(app);
    this.plugin = plugin;
    this.transcriptManager = this.plugin.services.transcriptManager;
    this.provider = plugin.settings.defaultLLMProvider; // Initialize provider from settings
  }

  onOpen() {
    const { contentEl } = this;

    contentEl.createEl("h2", { text: "Request Video Transcript" });

    // Provider Selection (NEW - using multi-provider system)
    new Setting(contentEl)
      .setName("LLM Provider")
      .setDesc("Choose the AI provider for transcript processing")
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
          .onChange(value => {
            this.provider = value as TextProviderId;
          });
      });

    new Setting(contentEl)
      .setName("Video URL")
      .setDesc("Enter the URL of the video")
      .addText((text) =>
        text
          .setPlaceholder("https://youtube.com/...")
          .setValue(this.videoUrl)
          .onChange((value) => {
            this.videoUrl = value;
          })
      );

    // Transcript language selection
    new Setting(contentEl)
      .setName("Transcript Language")
      .setDesc("Language of the original video")
      .addDropdown((dropdown) =>
        dropdown
          .addOptions({
            en: "English",
            ru: "Russian",
            es: "Spanish",
            fr: "French",
            de: "German",
            ja: "Japanese",
            zh: "Chinese",
            ko: "Korean",
            it: "Italian",
            pt: "Portuguese",
            // Add more languages as needed
          })
          .setValue(this.transcriptLanguage)
          .onChange((value) => {
            this.transcriptLanguage = value;
          })
      );

    // Output language selection (new)
    new Setting(contentEl)
      .setName("Output Language")
      .setDesc("Language for the transcript output (translation if different)")
      .addDropdown((dropdown) =>
        dropdown
          .addOptions({
            same: "Same as transcript",
            en: "English",
            ru: "Russian",
            es: "Spanish",
            fr: "French",
            de: "German",
            ja: "Japanese",
            zh: "Chinese",
            ko: "Korean",
            it: "Italian",
            pt: "Portuguese",
            // Add more languages as needed
          })
          .setValue(this.outputLanguage)
          .onChange((value) => {
            this.outputLanguage = value;
          })
      );

    new Setting(contentEl)
      .addButton((btn) =>
        btn
          .setButtonText("Get Transcript")
          .setCta()
          .onClick(async () => {
            if (!this.videoUrl) {
              ErrorHandler.handleError(
                "Please enter a video URL",
                "VALIDATION_ERROR",
                { field: "videoUrl" }
              );
              return;
            }

            // Handle "same" option for output language
            const finalOutputLang = this.outputLanguage === "same"
              ? this.transcriptLanguage
              : this.outputLanguage;

            try {
              const { filePath } = await this.transcriptManager.requestTranscript(
                this.videoUrl,
                this.transcriptLanguage,
                finalOutputLang, // Pass output language
                this.plugin.settings.transcriptFolder
              );

              if (filePath) {
                await this.transcriptManager.openTranscript(filePath);
                this.close();
              } else {
                ErrorHandler.handleError(
                  "Failed to get transcript file path",
                  "FILE_OPERATION",
                  { url: this.videoUrl }
                );
              }
            } catch (error: unknown) {
              console.error("Failed to get transcript:", error);
            }
          })
      );
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
