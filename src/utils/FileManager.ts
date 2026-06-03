import { App, Notice, TFile } from "obsidian";
import { sanitizeFilename } from "../utils/helpers";
import { ErrorHandler } from "./ErrorHandler";

interface SaveImageOptions {
  imageUrl: string;
  prompt: string;
  model: string;
  metadata?: Record<string, any>;
  imageFolder: string;
}

interface SaveFileOptions {
    content: string;
    folder: string;
    filename: string;
    metadata?: Record<string, any>;
    overwrite?: boolean;  // New option
  }

class FileManager {
  private app: App;

  constructor(app: App) {
    this.app = app;
  }

  async saveImage({
    imageUrl,
    prompt,
    model,
    metadata = {},
    imageFolder
  }: SaveImageOptions): Promise<string> {
    try {
      const timestamp = new Date().toISOString().slice(0, 10);
      const sanitizedPrompt = sanitizeFilename(prompt.slice(0, 30));
      const folderPath = `${imageFolder}/${timestamp}/${sanitizedPrompt}`;
      
      // Create folder if it doesn't exist
      await this.app.vault.adapter.mkdir(folderPath);
      
      // Download and save image
      const imageResponse = await fetch(imageUrl);
      const imageBlob = await imageResponse.blob();
      const imageBuffer = await imageBlob.arrayBuffer();
      
      const imagePath = `${folderPath}/image.png`;
      await this.app.vault.createBinary(imagePath, imageBuffer);

      // Save metadata
      const fullMetadata = {
        prompt,
        model,
        date: new Date().toISOString(),
        imageUrl,
        ...metadata
      };

      await this.app.vault.create(
        `${folderPath}/metadata.md`,
        JSON.stringify(fullMetadata, null, 2)
      );

      return imagePath;
    } catch (error: unknown) {
      console.error("Failed to save image:", error);
      if (error instanceof Error) {
        throw new Error(`Failed to save image: ${error.message}`);
      }
      throw new Error('Failed to save image: Unknown error');
    }
  }

  async saveFile({ content, folder, filename, metadata = {}, overwrite = false }: SaveFileOptions): Promise<string> {
    try {
      // Ensure folder exists
      await this.app.vault.adapter.mkdir(folder);
      
      const filePath = `${folder}/${filename}`;
      
      // Check if file exists and handle overwrite
      const existingFile = this.app.vault.getAbstractFileByPath(filePath);
      
      if (existingFile) {
        if (overwrite) {
          if (existingFile instanceof TFile) {
            // Delete existing file before creating new one
            await this.app.vault.delete(existingFile);
          } else {
            throw new Error("Existing path is not a file");
          }
        } else {
          throw new Error("File already exists");
        }
      }
  
      let finalContent = content;
      
      // Add metadata if provided
      if (Object.keys(metadata).length > 0) {
        const yamlMetadata = Object.entries(metadata)
          .map(([key, value]) => `${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`)
          .join('\n');
          
        finalContent = `---\n${yamlMetadata}\n---\n\n${content}`;
      }
  
      await this.app.vault.create(filePath, finalContent);
      return filePath;
      
    } catch (error: unknown) {
      console.error("Failed to save file:", error);
      if (error instanceof Error) {
        throw new Error(`Failed to save file: ${error.message}`);
      }
      throw new Error('Failed to save file: Unknown error');
    }
  }

  
  async readFile(path: string): Promise<string> {
    try {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (file instanceof TFile) {
        return await this.app.vault.read(file);
      }
      throw new Error("File not found");
    } catch (error: unknown) {
        ErrorHandler.handleError(error, "FILE_OPERATION", {
          operation: "read",
          path,
          timestamp: new Date().toISOString()
        });
        throw error; // Re-throw to handle in calling code if needed
      }
  }

  async copyFile(sourcePath: string, targetPath: string): Promise<void> {
    try {
      const content = await this.readFile(sourcePath);
      await this.saveFile({
        content,
        folder: targetPath.split('/').slice(0, -1).join('/'),
        filename: targetPath.split('/').pop() || 'file.txt'
      });
    } catch (error: unknown) {
      console.error("Failed to copy file:", error);
      if (error instanceof Error) {
        throw new Error(`Failed to copy file: ${error.message}`);
      }
      throw new Error('Failed to copy file: Unknown error');
    }
  }

  /**
   * Get all markdown file paths in the vault
   * @returns Array of markdown file paths
   */
  async getVaultData(): Promise<string[]> {
    try {
      const markdownFiles = this.app.vault.getMarkdownFiles();
      return markdownFiles.map(file => file.path);
    } catch (error: unknown) {
      console.error("Failed to get vault data:", error);
      if (error instanceof Error) {
        throw new Error(`Failed to get vault data: ${error.message}`);
      }
      throw new Error('Failed to get vault data: Unknown error');
    }
  }
}

export {FileManager}