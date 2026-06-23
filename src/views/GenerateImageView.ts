import {
    WorkspaceLeaf,
    ItemView,
    Setting,
    Notice,
    ButtonComponent,
  } from "obsidian";
  import type GptFreeTextGeneratorPlugin from '../main';
  import { VIEW_TYPE_GENERATE_IMAGE } from "../constants";
  import { TextGenerationOptions } from "../types/openrouter";
  
  interface GeneratedImage {
    url: string;
    prompt: string;
    model: string;
    provider?: string;
  }
  
  export class GenerateImageView extends ItemView {
    plugin: GptFreeTextGeneratorPlugin;
    private promptInput: string = "";
    private selectedModel: string;
    private generatedImages: GeneratedImage[] = [];
    private imageGrid!: HTMLDivElement; // Using definite assignment assertion
    private promptArea!: HTMLTextAreaElement; // Using definite assignment assertion
  
    constructor(leaf: WorkspaceLeaf, plugin: GptFreeTextGeneratorPlugin) {
      super(leaf);
      this.plugin = plugin;
      this.selectedModel = plugin.settings.defaultImageModel;
    }
  
    getViewType() {
      return VIEW_TYPE_GENERATE_IMAGE;
    }
  
    getDisplayText() {
      return "Image Generation Panel";
    }
  
    async onOpen() {
      const container = this.contentEl;
      container.empty();
      
      // Main layout container
      const layoutContainer = container.createDiv({
        cls: "generate-image-layout",
      });
  
      // Input section
      const inputSection = layoutContainer.createDiv({ cls: "input-section" });
      
      // Prompt input
      const promptContainer = inputSection.createDiv({ cls: "prompt-container" });
      promptContainer.createEl("h3", { text: "Image Prompt" });
      
      this.promptArea = promptContainer.createEl("textarea", {
        cls: "prompt-input",
        attr: {
          placeholder: "Describe the image you want to generate...",
          rows: "4"
        }
      });
      this.promptArea.value = this.promptInput;
      this.promptArea.addEventListener("input", () => {
        this.promptInput = this.promptArea.value;
      });
  
      // Model selection
      new Setting(inputSection)
        .setName("Model")
        .setDesc("Choose the AI model for image generation")
        .addDropdown((dropdown) => {
          dropdown.addOptions({
            'flux': 'Flux',
            'sdxl': 'SDXL',
            'sdxl-lora': 'SDXL Lora',
            'sd-3': 'SD-3',
            'playground-v2.5': 'Playground v2.5',
            'flux-pro': 'Flux Pro',
            'dall-e-3': 'DALL-E 3',
            'midjourney': 'Midjourney',
          })
          .setValue(this.selectedModel)
          .onChange((value) => {
            this.selectedModel = value;
          });
        });
  
      // Buttons section
      const buttonSection = inputSection.createDiv({ cls: "button-section" });
  
      // Generate Images button
      new ButtonComponent(buttonSection)
        .setButtonText("Generate Images (4)")
        .setCta()
        .onClick(async () => {
          await this.generateImages();
        });
  
      // Get Prompt Suggestions button
      new ButtonComponent(buttonSection)
        .setButtonText("Get Prompt Suggestions")
        .onClick(async () => {
          await this.getPromptSuggestions();
        });
  
      // Create image grid for results
      this.imageGrid = layoutContainer.createDiv({ cls: "image-grid" });
      this.updateImageGrid();
    }
  
    private async generateImages() {
      if (!this.promptInput.trim()) {
        new Notice("Please enter an image prompt");
        return;
      }

      const llmClientService = this.plugin.services.llmClientService;
      const client = llmClientService?.getClient();

      if (!client || typeof (client as any).generateImage !== 'function') {
        new Notice(
          `Image generation is not supported by the current provider. ` +
          `Only OpenRouter supports image generation at this time. Switch the default provider to OpenRouter in Settings, or use the Image Generator modal.`
        );
        return;
      }

      try {
        new Notice("Generating images...");

        // Generate 4 images in parallel
        const imagePromises = Array(4).fill(null).map(async () => {
          const response = await (client as any).generateImage({
            prompt: this.promptInput,
            model: this.selectedModel,
          });
          return {
            url: response.imageUrl ?? response.url,
            prompt: this.promptInput,
            model: this.selectedModel,
            provider: llmClientService?.getCurrentProvider(),
          };
        });

        const newImages = await Promise.all(imagePromises);
        this.generatedImages.unshift(...newImages);

        this.updateImageGrid();
        new Notice("Images generated successfully!");
      } catch (error) {
        console.error("Failed to generate images:", error);
        new Notice(`Failed to generate images: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }
  
    private async getPromptSuggestions() {
      if (!this.promptInput.trim()) {
        new Notice("Please enter a base prompt first");
        return;
      }
  
      try {
        const llmClientService = this.plugin.services.llmClientService;
        if (!llmClientService) {
          new Notice("LLM Client Service not initialized");
          return;
        }
        
        const llmClient = llmClientService.getClient();
        if (!llmClient) {
          new Notice("LLM client not initialized. Please check your settings and API keys.");
          return;
        }

        const suggestionsOptions: TextGenerationOptions = {
          message: `Please help improve this image generation prompt: "${this.promptInput}". 
                   Provide 3 enhanced versions that would work better for AI image generation. 
                   Include specific details about lighting, style, composition, and mood.`,
          model: this.plugin.settings.defaultTextModel,
          language: "english",
          files: [],
          temperature: 0.7,
          maxTokens: 500
        };

        const result = await llmClient.generateText(suggestionsOptions);
        
        // Create a modal to display suggestions
        const suggestionList = document.createElement("div");
        const suggestions = result.output.split("\\n").filter((s: string) => s.trim());
        
        suggestions.forEach((suggestion: string) => {
          const suggestionItem = suggestionList.createDiv({ cls: "suggestion-item" });
          suggestionItem.createEl("p", { text: suggestion });
          
          new ButtonComponent(suggestionItem)
            .setButtonText("Use This Prompt")
            .onClick(() => {
              this.promptArea.value = suggestion;
              this.promptInput = suggestion;
              suggestionList.remove();
            });
        });
  
        // Display suggestions in a floating container
        const container = this.containerEl.createDiv({ cls: "suggestion-container" });
        container.createEl("h3", { text: "Prompt Suggestions" });
        container.appendChild(suggestionList);
        container.createEl("button", { text: "Close" })
          .addEventListener("click", () => container.remove());
  
      } catch (error) {
        console.error("Failed to get prompt suggestions:", error);
        new Notice("Failed to get prompt suggestions");
      }
    }
  
    private updateImageGrid() {
      this.imageGrid.empty();
  
      this.generatedImages.forEach((image, index) => {
        const imageCard = this.imageGrid.createDiv({ cls: "image-card" });
        
        // Image container
        const imgContainer = imageCard.createDiv({ cls: "image-container" });
        const img = imgContainer.createEl("img", {
          attr: {
            src: image.url,
            alt: image.prompt
          }
        });
  
        // Image info
        const infoContainer = imageCard.createDiv({ cls: "image-info" });
        infoContainer.createEl("p", { text: `Prompt: ${image.prompt}`, cls: "image-prompt" });
        infoContainer.createEl("p", { text: `Model: ${image.model}`, cls: "image-model" });
        if (image.provider) {
          infoContainer.createEl("p", { text: `Provider: ${image.provider}`, cls: "image-provider" });
        }
  
        // Action buttons
        const actionContainer = imageCard.createDiv({ cls: "image-actions" });
        
        // Edit prompt button
        new ButtonComponent(actionContainer)
          .setButtonText("Edit & Regenerate")
          .onClick(() => {
            this.promptArea.value = image.prompt;
            this.promptInput = image.prompt;
            this.promptArea.focus();
          });
  
        // Download button
        new ButtonComponent(actionContainer)
          .setButtonText("Download")
          .onClick(async () => {
            try {
              const response = await fetch(image.url);
              const blob = await response.blob();
              const url = window.URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `generated-image-${Date.now()}.png`;
              document.body.appendChild(a);
              a.click();
              window.URL.revokeObjectURL(url);
              document.body.removeChild(a);
            } catch (error) {
              console.error("Failed to download image:", error);
              new Notice("Failed to download image");
            }
          });
      });
    }
  
    async onClose() {
      // Cleanup code if needed
    }
  }