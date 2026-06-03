import { 
    App, 
    Setting, 
    Modal,  
    Notice, 
  } from "obsidian";

  import type GptFreeTextGeneratorPlugin from '../main'; 

class ImageGeneratorModal extends Modal {
  plugin: GptFreeTextGeneratorPlugin;
  onSave: (options: { prompt: string; model: string }) => void;
  prompt: string = "";
  model: string;

  constructor(app: App, plugin: GptFreeTextGeneratorPlugin, onSave: (options: any) => void) {
    super(app);
    this.plugin = plugin;
    this.onSave = onSave;
    this.model = plugin.settings.defaultImageModel;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Image Generator Options" });

    // Input for the prompt
    new Setting(contentEl)
      .setName("Image Prompt")
      .setDesc("Enter a description of the image you want to generate")
      .addText((text) => {
        text
          .setPlaceholder("A serene landscape with mountains...")
          .setValue(this.prompt)
          .onChange((value) => {
            this.prompt = value;
          });
      });

    // Dropdown for selecting the model
    new Setting(contentEl)
      .setName("Select Model")
      .setDesc("Choose the AI model for image generation")
      .addDropdown((dropdown) => {
        dropdown.addOptions({
          'flux': 'Flux',
          'sdxl': 'SDXL',
          'sdxl-lora': 'SDXL Lora',
          'sd-3': 'SD-3',
          'playground-v2.5': 'Playground v2.5',
          'flux-pro': 'Flux Pro',
          'flux-dev': 'Flux Dev',
          'flux-schnell': 'Flux Schnell',
          'flux-realism': 'Flux Realism',
          'flux-cablyai': 'Flux CablyAI',
          'flux-anime': 'Flux Anime',
          'flux-3d': 'Flux 3D',
          'flux-disney': 'Flux Disney',
          'flux-pixel': 'Flux Pixel',
          'flux-4o': 'Flux 4o',
          'dall-e-3': 'DALL-E 3',
          'midjourney': 'Midjourney',
          'any-dark': 'Any Dark'
        });
        dropdown
          .setValue(this.model)
          .onChange((value) => {
            this.model = value;
          });
      });

    // Generate button
    new Setting(contentEl)
      .addButton((btn) => {
        btn
          .setButtonText("Generate Image")
          .setCta()
          .onClick(() => {
            if (!this.prompt.trim()) {
              new Notice("Please enter an image prompt");
              return;
            }
            this.onSave({
              prompt: this.prompt,
              model: this.model
            });
            this.close();
          });
      });

    // Cancel button
    new Setting(contentEl)
      .addButton((btn) => {
        btn
          .setButtonText("Cancel")
          .onClick(() => {
            this.close();
          });
      });
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}

export { ImageGeneratorModal };