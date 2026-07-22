import { App, Notice, TFile } from "obsidian";
import { sanitizeFilename, yamlValue } from "../utils/helpers";
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
    overwrite?: boolean;
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
      
      await this.app.vault.adapter.mkdir(folderPath);
      
      const imageResponse = await fetch(imageUrl);
      const imageBlob = await imageResponse.blob();
      const imageBuffer = await imageBlob.arrayBuffer();
      
      const imagePath = `${folderPath}/image.png`;
      await this.app.vault.createBinary(imagePath, imageBuffer);

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
      await this.app.vault.adapter.mkdir(folder);
      
      const filePath = `${folder}/${filename}`;
      
      const existingFile = this.app.vault.getAbstractFileByPath(filePath);
      
      if (existingFile) {
        if (overwrite) {
          if (existingFile instanceof TFile) {
            await this.app.vault.delete(existingFile);
          } else {
            throw new Error("Existing path is not a file");
          }
        } else {
          throw new Error("File already exists");
        }
      }
  
      let finalContent = content;
      
      // Add metadata if provided — uses proper YAML serialization
      if (Object.keys(metadata).length > 0) {
        const yamlMetadata = Object.entries(metadata)
          .map(([key, value]) => `${key}: ${yamlValue(value)}`)
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
      // Normalize path: strip leading slashes, resolve double slashes, remove trailing slash
      let normalized = path.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+/g, '/').replace(/\/$/, '');
      let file = this.app.vault.getAbstractFileByPath(normalized);
      if (file instanceof TFile) {
        return await this.app.vault.read(file);
      }
      // Fallback: try adapter.read() for files that may not be registered as TFile yet
      if (await this.app.vault.adapter.exists(normalized)) {
        return await this.app.vault.adapter.read(normalized);
      }
      throw new Error(`File not found: ${path}`);
    } catch (error: unknown) {
        ErrorHandler.handleError(error, "FILE_OPERATION", {
          operation: "read",
          path,
          timestamp: new Date().toISOString()
        });
        throw error;
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
