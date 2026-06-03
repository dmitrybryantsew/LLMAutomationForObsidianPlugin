import { App, TFile, Notice } from "obsidian";
import { FileManager } from "./FileManager";
import { sanitizeFilename } from "../utils/helpers";
import { ErrorHandler } from "./ErrorHandler";

interface HistoryMetadata {
  id: string;
  date_created: string;
  date_modified: string;
  model: string;
  language: string;
  textType: string;
  total_interactions: number;
  context_files: Array<{
    name: string;
    path: string;
    content?: string;
  }>;
  year: number;
  month: string;
  day: string;
  [key: string]: string | number | Array<any> | unknown; // Allow for additional dynamic properties
}

interface SaveHistoryOptions {
  messages: string[];
  metadata: Partial<HistoryMetadata>;
  historyFolder: string;
  contextFiles?: Map<string, any>;
}

export class HistoryManager {
  private app: App;
  private fileManager: FileManager;

  constructor(app: App) {
    this.app = app;
    this.fileManager = new FileManager(app);
  }

  private generateShortName(message: string): string {
    const words = message.split(' ')
      .filter(word => word.length > 2)
      .map(word => word.replace(/[^a-zA-Z0-9]/g, ''))
      .slice(0, 5);
    
    let shortName = words.join('-').toLowerCase();
    shortName = shortName.slice(0, 30);
    const randomSuffix = Math.random().toString(36).substring(2, 6);
    return `${shortName}-${randomSuffix}`;
  }

  async saveHistory({
    messages,
    metadata,
    historyFolder,
    contextFiles
  }: SaveHistoryOptions): Promise<string> {
    if (messages.length === 0) { //todo was options.messages.length
        ErrorHandler.handleError(
          "No messages to save",
          "VALIDATION_ERROR",
          { operation: "save-history" }
        );
        return "";
      }

    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const year = new Date().getFullYear();
      const month = String(new Date().getMonth() + 1).padStart(2, '0');
      const day = String(new Date().getDate()).padStart(2, '0');

      // Generate conversation ID if not provided
      const conversationId = metadata.id || this.generateShortName(messages[0]);

      // Create folder structure
      const folderPath = `${historyFolder}/GeneratedText/${year}/${month}/${day}/${conversationId}_${timestamp}`;
      const filesFolder = `${folderPath}/files`;

      // Save context files if provided
      let savedContextFiles = [];
      if (contextFiles?.size) {
        await this.app.vault.adapter.mkdir(filesFolder);
        
        for (const [path, fileInfo] of contextFiles.entries()) {
          if (fileInfo.content) {
            const newPath = `${filesFolder}/${fileInfo.name}`;
            await this.app.vault.adapter.write(newPath, fileInfo.content);
            savedContextFiles.push({
              name: fileInfo.name,
              path: newPath,
              content: fileInfo.content
            });
          }
        }
      }

      // Prepare full metadata
      const fullMetadata: HistoryMetadata = {
        id: conversationId,
        date_created: timestamp,
        date_modified: new Date().toISOString(),
        model: metadata.model || "unknown",
        language: metadata.language || "english",
        textType: metadata.textType || "chat",
        total_interactions: messages.length,
        context_files: savedContextFiles,
        year,
        month,
        day,
        ...metadata
      };

      // Save conversation file
      const conversationPath = await this.fileManager.saveFile({
        content: messages.join('\n\n'),
        folder: folderPath,
        filename: 'conversation.md',
        metadata: fullMetadata
      });

      return conversationPath;
    } catch (error: unknown) {
        ErrorHandler.handleError(error, "HISTORY_ERROR", {
          operation: "save",
          messagesCount: messages.length, //todo was options.messages.length
          historyFolder: historyFolder //todo was options.historyFolder
        });
        throw error;
      }
  }

  async loadHistory(filePath: string): Promise<{
    messages: string[];
    metadata: HistoryMetadata;
  }> {
    try {
      const content = await this.fileManager.readFile(filePath);
      const [frontmatter, ...historyParts] = content.split('---\n').filter(Boolean);
      
      // Parse metadata
      const metadata = frontmatter.split('\n').reduce<HistoryMetadata>((acc, line) => {
        const [key, ...values] = line.split(': ');
        const trimmedKey = key?.trim();
        if (trimmedKey && values.length) {
          const value = values.join(': ').trim();
          try {
            acc[trimmedKey] = JSON.parse(value);
          } catch {
            acc[trimmedKey] = value;
          }
        }
        return acc;
      }, {
        id: '',
        date_created: '',
        date_modified: '',
        model: '',
        language: '',
        textType: '',
        total_interactions: 0,
        context_files: [],
        year: 0,
        month: '',
        day: ''
      });

      // Parse messages
      const messages = historyParts[0].split('\n\n').filter(entry => entry.trim());

      return { messages, metadata };
    } catch (error: unknown) {
      console.error("Failed to load history:", error);
      if (error instanceof Error) {
        throw new Error(`Failed to load history: ${error.message}`);
      }
      throw new Error('Failed to load history: Unknown error');
    }
  }

  async getHistoryFiles(): Promise<TFile[]> {
    // Recursively find all conversation.md files in the history folder
    const files: TFile[] = [];
    
    const searchFiles = (folder: string) => {
      const items = this.app.vault.getAbstractFileByPath(folder);
      if (!items) return;
      
      if (items instanceof TFile && items.name === 'conversation.md') {
        files.push(items);
      } else {
        // @ts-ignore - Obsidian typing issue
        items.children?.forEach(child => {
          searchFiles(child.path);
        });
      }
    };

    searchFiles('GeneratedText');
    return files;
  }
}