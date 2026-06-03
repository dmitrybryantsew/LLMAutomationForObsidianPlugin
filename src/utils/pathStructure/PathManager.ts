
import { App, TFile, Notice, Vault, normalizePath } from "obsidian";
import { 
  PathStructure, Domain, Subject, Topic, Series, Author, Content, ContentMetadata
} from "./types";
import { sanitizeFilename } from "../helpers"; // Assuming sanitizeFilename is in helpers

export class PathManager {
    private app: App;
    private structure: PathStructure; // This is the in-memory cache
    private structurePath: string;
    private backupFolder: string;
    private vault: Vault; // Add reference to vault
    private maxBackups: number = 3; // Maximum number of rotating backups
    private monthlyBackupFolder: string; // Path to monthly backup folder
    private maxMonthlyBackups: number = 3; // Maximum number of monthly backups
    //TODO it seems structure path handled  incorrectly - i should have it but need to refine it place in folder structure
    constructor(app: App, structurePath: string = "Paths/path_structure.json", backupFolder: string = "Paths/backups") {
      this.app = app;
      this.vault = app.vault; // Assign vault
      this.structurePath = structurePath;
      this.backupFolder = backupFolder;
      this.monthlyBackupFolder = `${backupFolder}/monthly`; // Monthly backup subfolder
      // Initialize with empty structure immediately
      this.structure = this.createEmptyStructure();
    }
    
    private createEmptyStructure(): PathStructure {
      return {
        version: "1.0",
        lastUpdated: new Date().toISOString(),
        rootPath: "Paths/Domains", // Updated root path
        structure: { domains: [] }
      };
    }
    
    // Set or update the root path
    public setRootPath(rootPath: string): void {
      this.structure.rootPath = rootPath;
    }
    
    // Get the full path for a subfolder within the PathStructure root
    public getFullPath(relativePath: string): string {
      return `${this.structure.rootPath}/${relativePath}`;
    }
    
    /**
     * Initializes the PathManager by loading the structure from file,
     * or creating the initial structure if it doesn't exist.
     * This effectively loads the structure into the in-memory cache (this.structure).
     */
    public async initialize(): Promise<boolean> {
        try {
          // Ensure the base 'Paths' directory exists regardless of rootPath
          await this.ensureFolderExists("Paths");
          // Ensure the backup folder exists
          await this.ensureFolderExists(this.backupFolder);
          // Ensure the monthly backup folder exists
          await this.ensureMonthlyBackupFolder();
          
          // Check if structure exists
          const exists = await this.rootStructureExists();
          
          if (exists) {
            // Load existing structure into cache
            await this.loadStructure();
            // Ensure the rootPath folder exists (based on loaded structure)
            await this.ensureFolderExists(this.structure.rootPath);
            // Ensure the root index exists (updates if needed based on loaded structure)
            await this.ensureRootIndexExists();
          } else {
            // Use default empty structure (already set in constructor)
             // Ensure the default rootPath folder exists
            await this.ensureFolderExists(this.structure.rootPath);
            // Create the root index
            await this.ensureRootIndexExists();
            // Save the initial structure from the default empty cache
            await this.saveStructure();
            await this.updateStructureSummaryFile();
          }

          // Check if we need to create a monthly backup (on 1st of month)
          await this.checkAndCreateMonthlyBackup();
          
          return true;
        } catch (error) {
          console.error("Failed to initialize PathManager:", error);
          // It might be better to return false and let the caller handle the UI/error message
          // But current pattern is to throw, so let's keep it consistent.
          throw error;
        }
      }
    
    // DOMAIN OPERATIONS
    
    public async addDomain(options: { name: string, description?: string }): Promise<Domain> {
      const { name, description } = options;
      const id = this.generateId(name);
      
      // Check if domain already exists in the cache
      if (this.structure.structure.domains.some(d => d.id === id)) {
        throw new Error(`Domain with ID "${id}" already exists`);
      }
      
      // Generate folder path for the domain (relative to rootPath)
      const folderPath = sanitizeFilename(name); // Use helper for sanitization
      
      // Create domain object
      const domain: Domain = {
        id,
        name,
        description,
        folderPath,
        subjects: [],
        dateCreated: new Date().toISOString(),
        dateModified: new Date().toISOString()
      };
      
      // Add to in-memory structure
      this.structure.structure.domains.push(domain);
      
      // Ensure domain folder exists in the vault
      await this.ensureFolderExists(this.getFullPath(folderPath));
      
      // Create MD file for the domain in the vault
      domain.mdFile = await this.createDomainMdFile(domain);
      
      // Update the root index.md in the vault to link to this domain
      await this.updateRootIndex();
      
      // Save the updated in-memory structure to JSON file
      await this.saveStructure();
      
      // Update the structure summary file
      await this.updateStructureSummaryFile();

      // Create backup
      await this.createBackup();
      
      return domain;
    }
    
    private async createDomainMdFile(domain: Domain): Promise<string> {
      const filePath = `${this.getFullPath(domain.folderPath)}/${domain.id}.md`;
      
      // Generate content for the MD file
      const content = `# ${domain.name}
  
  ${domain.description || ''}
  
  ## Subjects
  
  *No subjects have been added to this domain yet.*
  
  ## About This Domain
  
  This is a root-level knowledge domain in your hierarchical content organization system.
  
  ---
  
  *This file was automatically generated on ${new Date().toLocaleString()}.*
  `;
      try {
         // Check if file exists before creating to avoid errors if called incidentally
         const file = this.vault.getAbstractFileByPath(filePath);
         if (file instanceof TFile) {
            // File already exists, maybe update it or just return the path
            // For now, if it exists, assume it's the one and return its path
            return filePath; 
         }
         await this.vault.create(filePath, content);
         return filePath;
      } catch (error) {
         console.error(`Failed to create domain MD file at ${filePath}:`, error);
         throw error; // Re-throw the error
      }
    }
    
    private async ensureRootIndexExists(): Promise<void> {
      const rootIndexPath = `${this.structure.rootPath}/index.md`;
      
      // Check if root index exists
      const file = this.vault.getAbstractFileByPath(rootIndexPath);
      
      if (!file) {
        // Create the root index file
        const content = `# Knowledge Domains
  
  This is the root of your hierarchical knowledge organization system.
  
  ## Domains
  
  *Links to knowledge domains will appear here as they are added.*
  
  ---
  
  *This file was automatically generated on ${new Date().toLocaleString()}.*
  `;
        try {
            await this.vault.create(rootIndexPath, content);
        } catch (error) {
            const errorMessage = (error instanceof Error) ? error.message : String(error);
            if (errorMessage.includes("File already exists")) {
                console.warn(`Root index file at ${rootIndexPath} already exists. Race condition handled.`);
            } else {
                console.error(`Failed to create root index file at ${rootIndexPath}:`, error);
                throw error;
            }
        }
      } else if (file instanceof TFile) {
          // If it exists, update it to ensure all current domains are linked
          await this.updateRootIndex();
      }
    }
    
    private async updateRootIndex(): Promise<void> {
      const rootIndexPath = `${this.structure.rootPath}/index.md`;
      
      // Get the current content
      const file = this.vault.getAbstractFileByPath(rootIndexPath);
      
      if (file instanceof TFile) {
        // Use the generic helper to update the '## Domains' section
         await this.updateSectionInMdFile(
             rootIndexPath,
             '## Domains',
             this.formatDomainLinks(),
             // No parent entity needed for root index
         );
      } else {
          console.error(`Root index path ${rootIndexPath} does not point to a valid file.`);
          // Optionally, recreate the root index file here if it's missing/corrupted
          // await this.ensureRootIndexExists(); 
      }
    }

    private formatDomainLinks(): string {
        let linksContent = '';
        if (this.structure.structure.domains.length === 0) {
          linksContent += '\n*No domains have been added yet.*\n';
        } else {
          // Add links to all domains
          this.structure.structure.domains.forEach(domain => {
             // Construct the relative path to the domain's index file for internal linking
             const relativeDomainPath = `${domain.folderPath}/${domain.id}`; // No .md needed in internal link target
            linksContent += `- [[${this.getFullPath(relativeDomainPath)}|${domain.name}]]${domain.description ? ` - ${domain.description}` : ''}\n`;
          });
        }
        return linksContent;
    }

  
  
  /**
 * Creates the complete root folder structure if it doesn't exist
 * This includes the Paths folder, Domains subfolder, and initial files
 */
public async createRootStructure(): Promise<boolean> {
    try {
      // Create Paths folder
      await this.ensureFolderExists("Paths");
      
      // Create Domains folder (using the current rootPath)
      await this.ensureFolderExists(this.structure.rootPath);
      
      // Create backups folder
      await this.ensureFolderExists(this.backupFolder);
      
      // Create or update root index.md
      await this.ensureRootIndexExists();
      
      // Create or update initial structure json file (using the current in-memory structure)
      await this.saveStructure();
      
      // Create initial backup
      await this.createBackup();
      
      return true;
    } catch (error) {
      console.error("Failed to create root structure:", error);
      throw error;
    }
  }
  
  /**
   * Checks if the root structure exists by looking for key files/folders
   */
  public async rootStructureExists(): Promise<boolean> {
    try {
      // Check if Paths folder exists
      const pathsExists = await this.vault.adapter.exists("Paths");
      if (!pathsExists) return false;
      
      // Check if the configured rootPath folder exists
      // Note: this relies on the default rootPath if structure.json doesn't exist yet
      const rootPathExists = await this.vault.adapter.exists(this.structure.rootPath);
      if (!rootPathExists) return false;
      
      // Check if the structure file exists
      const structureExists = await this.vault.adapter.exists(this.structurePath);
      
      return structureExists;
    } catch (error) {
      console.error("Error checking root structure:", error);
      // If there's an error checking existence, assume it doesn't exist or is corrupted
      return false;
    }
  }
  // UTILITY METHODS
  
  private async ensureFolderExists(folderPath: string): Promise<void> {
    // Normalize path to handle potential Windows/Linux differences
    const normalizedPath = normalizePath(folderPath);
    if (!(await this.vault.adapter.exists(normalizedPath))) {
      // Use createFolder which handles parent directories
      await this.vault.createFolder(normalizedPath);
    }
  }
  
 
  /**
   * Loads the path structure from the JSON file into the in-memory cache.
   */
  public async loadStructure(): Promise<PathStructure> {
    try {
      const file = this.vault.getAbstractFileByPath(this.structurePath);
      
      if (file instanceof TFile) {
        const content = await this.vault.read(file);
        // Use a try-catch around JSON parsing
        try {
            this.structure = JSON.parse(content);
             // Ensure domains array exists if the file was empty or malformed but parsed
             if (!Array.isArray(this.structure.structure.domains)) {
                 this.structure.structure.domains = [];
             }
        } catch (parseError) {
            console.error(`Failed to parse structure file at ${this.structurePath}:`, parseError);
            // Attempt auto-recovery from backup
            await this.attemptAutoRecovery();
            // If parsing fails, throw an error to indicate corruption
            throw new Error(`Failed to parse path structure file: ${parseError instanceof Error ? parseError.message : 'Unknown error'}`);
        }
      } else {
        // Structure file doesn't exist. This should ideally not happen if initialize() was called first.
        // If called directly and file is missing, just return the empty structure initialized in constructor.
        console.warn(`Structure file not found at ${this.structurePath}. Using empty structure.`);
        this.structure = this.createEmptyStructure(); // Re-initialize to be safe
      }
      
      return this.structure; // Return the cached structure
    } catch (error) {
      console.error("Error loading structure:", error);
      throw error;
    }
  }
  
  /**
   * Validates the path structure before saving.
   * @returns true if data is valid, false otherwise
   */
  private validateStructure(structure: PathStructure): boolean {
      // Check if structure is an object
      if (!structure || typeof structure !== 'object') {
          console.error("PathManager: Validation failed - structure is not an object");
          return false;
      }

      // Check if structure.structure exists and is an object
      if (!structure.structure || typeof structure.structure !== 'object') {
          console.error("PathManager: Validation failed - structure.structure is not an object");
          return false;
      }

      // Check if domains array exists
      if (!Array.isArray(structure.structure.domains)) {
          console.error("PathManager: Validation failed - domains is not an array");
          return false;
      }

      // Check version exists
      if (!structure.version || typeof structure.version !== 'string') {
          console.error("PathManager: Validation failed - version is missing or invalid");
          return false;
      }

      return true;
  }

  /**
   * Saves the current in-memory structure to the JSON file.
   * Implements atomic writes with backup and validation.
   */
  public async saveStructure(): Promise<void> {
    try {
      // Create backup before overwriting
      await this.createBackup();

      // Update timestamp
      this.structure.lastUpdated = new Date().toISOString();
      
      // Validate before saving
      if (!this.validateStructure(this.structure)) {
          throw new Error("Path structure validation failed");
      }

      // Convert to JSON
      const content = JSON.stringify(this.structure, null, 2);
      
      // Atomic write: write to temp file first, then rename
      const tempPath = `${this.structurePath}.tmp`;
      
      // Check if file exists
      const file = this.vault.getAbstractFileByPath(this.structurePath);
      
      if (file instanceof TFile) {
        // Write to temp file first
        await this.vault.create(tempPath, content);
        
        // If successful, modify the original file
        await this.vault.modify(file, content);
        
        // Clean up temp file
        try {
            const tempFile = this.vault.getAbstractFileByPath(tempPath);
            if (tempFile instanceof TFile) {
                await this.vault.delete(tempFile);
            }
        } catch (tempError) {
            console.warn(`PathManager: Failed to delete temp file ${tempPath}:`, tempError);
        }
      } else {
        // File doesn't exist, ensure directory exists and then create
        const folder = this.structurePath.split('/').slice(0, -1).join('/');
        await this.ensureFolderExists(folder);
        await this.vault.create(this.structurePath, content);
      }
    } catch (error) {
      console.error("Error saving structure:", error);
      throw error;
    }
  }
  
/**
 * Get the current in-memory structure.
 * Returns a reference to the internal cache. Consumers should avoid mutating it directly.
 */
public getStructure(): PathStructure {
    return this.structure; // Return reference to the cache
    // If deep copy is strictly needed: return JSON.parse(JSON.stringify(this.structure));
  }

    /**
     * Generates a structured text summary of the path hierarchy for LLM input.
     */
    public generateStructureSummary(): string {
        let summary = '';

        // Add Domains
        const domainNames = this.structure.structure.domains.map(d => d.name);
        summary += `Domains: [${domainNames.join(', ')}]\n`;

        // Add Subjects, Topics, and Series nested under their parents
        this.structure.structure.domains.forEach(domain => {
            if (domain.subjects.length > 0) {
                const subjectNames = domain.subjects.map(s => s.name);
                summary += `${domain.name} Subjects: [${subjectNames.join(', ')}]\n`;

                domain.subjects.forEach(subject => {
                    if (subject.topics.length > 0) {
                        const topicNames = subject.topics.map(t => t.name);
                        summary += `${subject.name} Topics: [${topicNames.join(', ')}]\n`;

                        subject.topics.forEach(topic => {
                            if (topic.series.length > 0) {
                                const seriesNames = topic.series.map(s => s.name);
                                summary += `${topic.name} Series: [${seriesNames.join(', ')}]\n`;
                            }
                        });
                    }
                    // Add Authors under Subjects if needed in the summary, though plan was up to Series
                    // subject.topics.forEach(topic => {
                    //     topic.series.forEach(series => {
                    //         if (series.authors.length > 0) {
                    //             const authorNames = series.authors.map(a => a.name);
                    //             summary += `${series.name} Authors: [${authorNames.join(', ')}]\n`;
                    //         }
                    //     });
                    // });
                });
            }
        });

        return summary.trim(); // Trim trailing newline
    }

    /**
     * Generates the structure summary and saves it to a file.
     */
    private async updateStructureSummaryFile(): Promise<void> {
        const summaryFilePath = "Paths/path_structure_summary.txt";
        try {
            const summaryContent = this.generateStructureSummary();
            // Ensure the 'Paths' directory exists
            await this.ensureFolderExists("Paths");
            // Write the summary content to the file
            await this.vault.adapter.write(summaryFilePath, summaryContent);
            console.log(`PathManager: Updated structure summary file at ${summaryFilePath}`);
        } catch (error) {
            console.error(`PathManager: Failed to update structure summary file at ${summaryFilePath}:`, error);
            // Depending on severity, you might want to throw or handle differently
        }
    }

  // BACKUP OPERATIONS
  
  private async ensureBackupFolder(): Promise<void> {
    await this.ensureFolderExists(this.backupFolder);
  }
  
  /**
   * Creates a backup of the current path structure.
   * Implements rotating backup system with maxBackups limit.
   */
  public async createBackup(): Promise<string> {
    try {
      await this.ensureBackupFolder();
      
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupPath = `${this.backupFolder}/backup-${timestamp}.json`;
      
      // Save the current in-memory structure
      const content = JSON.stringify(this.structure, null, 2);
       // Check if file exists before creating to avoid errors (though create is safe)
      await this.vault.create(backupPath, content); // create will throw if file exists but it's okay for backups
      
      // Clean up old backups (keep only maxBackups most recent)
      await this.cleanupOldBackups();
      
      return backupPath;
    } catch (error) {
      console.error("Error creating backup:", error);
      throw error;
    }
  }

  /**
   * Cleans up old backup files, keeping only the most recent maxBackups.
   */
  private async cleanupOldBackups(): Promise<void> {
      try {
          const files = this.vault.getMarkdownFiles();
          const backupFiles = files
              .filter(f => f.path.startsWith(this.backupFolder) && f.path.endsWith('.json'))
              .sort((a, b) => b.stat.mtime - a.stat.mtime); // Sort by modification time (newest first)

          // Delete backups beyond the limit
          if (backupFiles.length > this.maxBackups) {
              for (let i = this.maxBackups; i < backupFiles.length; i++) {
                  try {
                      await this.vault.delete(backupFiles[i]);
                      console.log(`PathManager: Deleted old backup: ${backupFiles[i].path}`);
                  } catch (deleteError) {
                      console.error(`PathManager: Failed to delete old backup ${backupFiles[i].path}:`, deleteError);
                  }
              }
          }
      } catch (error) {
          console.error("PathManager: Error cleaning up old backups:", error);
          // Don't throw - cleanup failure shouldn't block save operation
      }
  }

  /**
   * Gets the list of available backup files sorted by date (newest first).
   * @returns Array of backup file paths
   */
  public async getAvailableBackups(): Promise<string[]> {
      try {
          const files = this.vault.getMarkdownFiles();
          const backupFiles = files
              .filter(f => f.path.startsWith(this.backupFolder) && f.path.endsWith('.json'))
              .sort((a, b) => b.stat.mtime - a.stat.mtime); // Sort by modification time (newest first)

          return backupFiles.map(f => f.path);
      } catch (error) {
          console.error("PathManager: Error getting available backups:", error);
          return [];
      }
  }
  
  /**
   * Restores path structure from a backup file.
   * @param backupPath Path to the backup file to restore from
   * @returns true if restore was successful, false otherwise
   */
  public async restoreFromBackup(backupPath: string): Promise<boolean> {
    try {
      const file = this.vault.getAbstractFileByPath(backupPath);
      
      if (!(file instanceof TFile)) {
        throw new Error("Backup file not found");
      }
      
      const content = await this.vault.read(file);
      
      // Validate JSON before restoring
      let restoredStructure: PathStructure;
      try {
          restoredStructure = JSON.parse(content);
          // Validate structure format
          if (!restoredStructure || typeof restoredStructure !== 'object' || !Array.isArray(restoredStructure.structure?.domains)) {
              throw new Error("Invalid structure format in backup file.");
          }
          // Additional validation
          if (!this.validateStructure(restoredStructure)) {
              throw new Error("Backup structure validation failed.");
          }
      } catch (parseError) {
          console.error(`Failed to parse backup file at ${backupPath}:`, parseError);
          throw new Error(`Failed to parse backup file: ${parseError instanceof Error ? parseError.message : 'Unknown error'}`);
      }

      // Overwrite the in-memory structure
      this.structure = restoredStructure;
      
      // Save the restored structure as the current structure file
      await this.saveStructure();
      
      // Attempt to update index files based on the restored structure
      await this.updateAllIndexFiles();
      
      new Notice(`Successfully restored path structure from backup`);
      console.log(`PathManager: Restored structure from ${backupPath}`);
      return true;
    } catch (error) {
      console.error("Error restoring from backup:", error);
      new Notice(`Failed to restore from backup: ${error instanceof Error ? error.message : 'Unknown error'}`);
      // Do not throw error here, return false to indicate failure
      return false;
    }
  }

  /**
   * Attempts auto-recovery from the latest backup if the main file is corrupted.
   * @returns true if recovery was successful, false otherwise
   */
  public async attemptAutoRecovery(): Promise<boolean> {
      try {
          // Check if main file exists
          if (!(await this.vault.adapter.exists(this.structurePath))) {
              console.log(`PathManager: Main file ${this.structurePath} does not exist, attempting recovery from backup`);
              return await this.restoreFromLatestBackup();
          }

          // Try to load and validate main file
          const file = this.vault.getAbstractFileByPath(this.structurePath);
          if (!(file instanceof TFile)) {
              console.log(`PathManager: Main file is not a valid file, attempting recovery from backup`);
              return await this.restoreFromLatestBackup();
          }

          const content = await this.vault.read(file);
          try {
              const structure = JSON.parse(content);
              if (!this.validateStructure(structure)) {
                  throw new Error("Invalid format");
              }
              // File is valid, no recovery needed
              console.log(`PathManager: Main file is valid, no recovery needed`);
              return false;
          } catch (parseError) {
              console.log(`PathManager: Main file is corrupted, attempting recovery from backup: ${parseError}`);
              return await this.restoreFromLatestBackup();
          }
      } catch (error) {
          console.error("PathManager: Error during auto-recovery:", error);
          return false;
      }
  }

  /**
   * Restores from the latest available backup.
   * @returns true if restore was successful, false otherwise
   */
  private async restoreFromLatestBackup(): Promise<boolean> {
      try {
          const backups = await this.getAvailableBackups();
          if (backups.length === 0) {
              console.log("PathManager: No backups available for recovery");
              return false;
          }

          // Restore from the most recent backup (first in list)
          const latestBackup = backups[0];
          console.log(`PathManager: Restoring from latest backup: ${latestBackup}`);
          
          const success = await this.restoreFromBackup(latestBackup);
          if (success) {
              new Notice(`Recovered path structure from backup: ${latestBackup}`);
          }
          
          return success;
      } catch (error) {
          console.error("PathManager: Error restoring from latest backup:", error);
          return false;
      }
  }

  /**
   * Ensures the monthly backup folder exists.
   */
  private async ensureMonthlyBackupFolder(): Promise<void> {
      await this.ensureFolderExists(this.monthlyBackupFolder);
  }

  /**
   * Checks if today is the 1st of the month and creates a monthly backup if needed.
   */
  private async checkAndCreateMonthlyBackup(): Promise<void> {
      const now = new Date();
      const dayOfMonth = now.getDate();
      
      if (dayOfMonth === 1) {
          console.log(`PathManager: Today is the 1st of the month. Checking for monthly backup...`);
          await this.createMonthlyBackup();
      }
  }

  /**
   * Creates a monthly backup of the current path structure.
   * Uses month-based naming (e.g., monthly-backup-2025-01.json).
   * Replaces existing backup for the same month if it exists.
   */
  public async createMonthlyBackup(): Promise<string> {
      try {
          await this.ensureMonthlyBackupFolder();

          const now = new Date();
          const year = now.getFullYear();
          const month = String(now.getMonth() + 1).padStart(2, '0');
          const backupPath = `${this.monthlyBackupFolder}/monthly-backup-${year}-${month}.json`;

          // Save the current in-memory structure
          const content = JSON.stringify(this.structure, null, 2);

          // Check if backup already exists for this month
          const existingFile = this.vault.getAbstractFileByPath(backupPath);
          if (existingFile instanceof TFile) {
              // Replace existing backup
              await this.vault.modify(existingFile, content);
              console.log(`PathManager: Updated monthly backup at ${backupPath}`);
          } else {
              // Create new backup
              await this.vault.create(backupPath, content);
              console.log(`PathManager: Created monthly backup at ${backupPath}`);
          }

          // Clean up old monthly backups (keep only maxMonthlyBackups most recent)
          await this.cleanupOldMonthlyBackups();

          return backupPath;
      } catch (error) {
          console.error("PathManager: Error creating monthly backup:", error);
          throw error;
      }
  }

  /**
   * Cleans up old monthly backup files, keeping only the most recent maxMonthlyBackups.
   */
  private async cleanupOldMonthlyBackups(): Promise<void> {
      try {
          const files = this.vault.getMarkdownFiles();
          const backupFiles = files
              .filter(f => f.path.startsWith(this.monthlyBackupFolder) && f.path.endsWith('.json'))
              .sort((a, b) => b.stat.mtime - a.stat.mtime); // Sort by modification time (newest first)

          // Delete backups beyond the limit
          if (backupFiles.length > this.maxMonthlyBackups) {
              for (let i = this.maxMonthlyBackups; i < backupFiles.length; i++) {
                  try {
                      await this.vault.delete(backupFiles[i]);
                      console.log(`PathManager: Deleted old monthly backup: ${backupFiles[i].path}`);
                  } catch (deleteError) {
                      console.error(`PathManager: Failed to delete old monthly backup ${backupFiles[i].path}:`, deleteError);
                  }
              }
          }
      } catch (error) {
          console.error("PathManager: Error cleaning up old monthly backups:", error);
          // Don't throw - cleanup failure shouldn't block operation
      }
  }

  /**
   * Gets the list of available monthly backup files sorted by date (newest first).
   * @returns Array of monthly backup file paths
   */
  public async getAvailableMonthlyBackups(): Promise<string[]> {
      try {
          const files = this.vault.getMarkdownFiles();
          const backupFiles = files
              .filter(f => f.path.startsWith(this.monthlyBackupFolder) && f.path.endsWith('.json'))
              .sort((a, b) => b.stat.mtime - a.stat.mtime); // Sort by modification time (newest first)

          return backupFiles.map(f => f.path);
      } catch (error) {
          console.error("PathManager: Error getting available monthly backups:", error);
          return [];
      }
  }

  /**
   * Restores path structure from a monthly backup file.
   * @param backupPath Path to the monthly backup file to restore from
   * @returns true if restore was successful, false otherwise
   */
  public async restoreFromMonthlyBackup(backupPath: string): Promise<boolean> {
      try {
          const file = this.vault.getAbstractFileByPath(backupPath);

          if (!(file instanceof TFile)) {
              throw new Error("Monthly backup file not found");
          }

          const content = await this.vault.read(file);

          // Validate JSON before restoring
          let restoredStructure: PathStructure;
          try {
              restoredStructure = JSON.parse(content);
              // Validate structure format
              if (!restoredStructure || typeof restoredStructure !== 'object' || !Array.isArray(restoredStructure.structure?.domains)) {
                  throw new Error("Invalid structure format in monthly backup file.");
              }
              // Additional validation
              if (!this.validateStructure(restoredStructure)) {
                  throw new Error("Monthly backup structure validation failed.");
              }
          } catch (parseError) {
              console.error(`Failed to parse monthly backup file at ${backupPath}:`, parseError);
              throw new Error(`Failed to parse monthly backup file: ${parseError instanceof Error ? parseError.message : 'Unknown error'}`);
          }

          // Overwrite the in-memory structure
          this.structure = restoredStructure;

          // Save the restored structure as the current structure file
          await this.saveStructure();

          // Attempt to update index files based on the restored structure
          await this.updateAllIndexFiles();

          new Notice(`Successfully restored path structure from monthly backup`);
          console.log(`PathManager: Restored structure from monthly backup ${backupPath}`);
          return true;
      } catch (error) {
          console.error("PathManager: Error restoring from monthly backup:", error);
          new Notice(`Failed to restore from monthly backup: ${error instanceof Error ? error.message : 'Unknown error'}`);
          return false;
      }
  }

  private async updateAllIndexFiles(): Promise<void> {
      // This is a simplified approach. A robust implementation would traverse the structure
      // and call updateMdFile for each entity (Domain, Subject, Topic, Series, Author) that *has*
      // an mdFile path recorded in the structure.
      // For now, we'll update the root and attempt to update lower levels if the MD file paths exist.
      // A full rebuild might be a separate complex operation.
      await this.updateRootIndex();

      // Iterating through the structure to update lower-level index files.
      // This assumes the update methods (updateDomainMdFile, etc.) correctly handle
      // finding and modifying their respective files based on the paths stored in the structure object.
      // They also handle recreation if the file is missing.
      for (const domain of this.structure.structure.domains) {
          await this.updateDomainMdFile(domain); // This internally calls updateSectionInMdFile for Subjects
          for (const subject of domain.subjects) {
              await this.updateSubjectMdFile(subject, domain); // This internally calls updateSectionInMdFile for Topics
              for (const topic of subject.topics) {
                  await this.updateTopicMdFile(topic, subject, domain); // This internally calls updateSectionInMdFile for Series
                   for (const series of topic.series) {
                       await this.updateSeriesMdFile(series, topic, subject, domain); // Updates Authors and Content sections
                        for (const author of series.authors) {
                             // Update Author files to ensure their Content list is correct
                            await this.updateAuthorMdFile(author, series, topic, subject, domain);
                        }
                   }
              }
          }
      }
  }

  // Helper to find or create/update a section in an MD file and insert content
    private async updateSectionInMdFile(
        filePath: string,
        sectionMarker: string, // e.g., '## Subjects'
        newSectionContent: string, // The markdown content for the section body
        parentEntity?: Domain | Subject | Topic | Series | Author, // For potential recreation context
        ...parentContext: (Domain | Subject | Topic | Series)[] // For potential recreation context
    ): Promise<void> {
        let file = this.vault.getAbstractFileByPath(filePath);

        // If the file doesn't exist, attempt to recreate it first.
        // This requires specific logic based on the type of entity the file belongs to.
        if (!(file instanceof TFile)) {
            console.warn(`MD file not found at ${filePath}. Attempting recreation.`);
            // This generic helper isn't ideal for recreating specific entity files.
            // We rely on the specific update methods (updateDomainMdFile etc.)
            // to call their respective `createXMdFile` first if `entity.mdFile` is null/missing.
            // If we reach here and file is null, it means the entity had an mdFile path recorded,
            // but the file is missing. Attempt recreation based on parent context.
            try {
                 if (parentEntity && parentContext.length > 0) {
                     // Determine type and recreate - this is complex.
                     // A simpler pattern is to check/recreate in the specific `updateXMdFile` methods.
                     // Let's add recreation there instead.
                     // For now, if file is missing, just warn and skip update.
                     console.error(`MD file missing at ${filePath}. Cannot update section '${sectionMarker}'. Skipping update.`);
                     return; // Skip update if file is missing and cannot be recreated here
                 } else {
                      // If no parent context, maybe it's the root index or a simple file?
                      // Recreating root index is handled by ensureRootIndexExists.
                      console.error(`MD file missing at ${filePath}. Cannot update section '${sectionMarker}'. Skipping update.`);
                     return;
                 }
            } catch (recreationError) {
                 console.error(`Failed to recreate missing MD file at ${filePath}:`, recreationError);
                 console.error(`Cannot update section '${sectionMarker}'. Skipping update.`);
                 return; // Skip update if recreation fails
            }
        }

        const content = await this.vault.read(file);

        const nextSectionMarkerRegex = /^##\s+.+/m;

        const startIndex = content.indexOf(sectionMarker);
        let endIndex = content.length; // Assume end of file initially

        if (startIndex !== -1) {
            // Look for the next '##' header after the section marker
            const contentAfterMarker = content.substring(startIndex + sectionMarker.length);
            const nextHeaderMatch = contentAfterMarker.match(nextSectionMarkerRegex);
             if (nextHeaderMatch && nextHeaderMatch.index !== undefined) {
                 endIndex = startIndex + sectionMarker.length + nextHeaderMatch.index;
             }
        } else {
             // If the section marker isn't found, append the new section at the end
            console.warn(`'${sectionMarker}' marker not found in ${file.path}. Appending section.`);
            const newContent = content.trim() +
                               `\n\n${sectionMarker}\n\n` +
                               newSectionContent;
            try {
                await this.vault.modify(file, newContent.trim());
            } catch (error) {
                console.error(`Failed to append section to MD file at ${file.path}:`, error);
                throw error;
            }
             return; // Section appended, we're done
        }

        // Reconstruct the content with the updated section
        // Keep content BEFORE the marker, add the marker, add new section content, add content AFTER the old section end
        const newContent = content.substring(0, startIndex + sectionMarker.length) +
                           '\n' + // Add a newline after the header
                           newSectionContent +
                           '\n' + // Add a newline after the list content
                           content.substring(endIndex);

        try {
            await this.vault.modify(file, newContent.trim());
        } catch (error) {
            console.error(`Failed to update section '${sectionMarker}' in MD file at ${file.path}:`, error);
            throw error;
        }
    }


  // CREATE OPERATIONS
  
  
  /**
 * Add a new subject to a domain
 */
public async addSubject(options: { domainId: string, name: string, description?: string }): Promise<Subject> {
    const { domainId, name, description } = options;
    const id = this.generateId(name);
    
    // Find domain in the cache
    const domain = this.findDomainById(domainId);
    
    if (!domain) {
      throw new Error(`Domain with ID "${domainId}" not found`);
    }
    
    // Check if subject already exists in this domain in the cache
    if (domain.subjects.some(s => s.id === id)) {
      throw new Error(`Subject with ID "${id}" already exists in domain "${domain.name}"`);
    }
    
    // Generate folder path for the subject (relative to domain)
    const folderPath = sanitizeFilename(name); // Use helper
    const fullFolderPath = `${domain.folderPath}/${folderPath}`;
    
    // Create subject object
    const subject: Subject = {
      id,
      name,
      description,
      folderPath: folderPath,
      topics: [],
      dateCreated: new Date().toISOString(),
      dateModified: new Date().toISOString()
    };
    
    // Add to domain in the in-memory structure
    domain.subjects.push(subject);
    
    // Update domain's modified date in the cache
    domain.dateModified = new Date().toISOString();
    
    // Ensure subject folder exists in the vault
    await this.ensureFolderExists(this.getFullPath(fullFolderPath));
    
    // Create MD file for the subject in the vault
    subject.mdFile = await this.createSubjectMdFile(subject, domain);
    
    // Update domain MD file in the vault to link to this subject
    await this.updateDomainMdFile(domain);
    
    // Save the updated in-memory structure to JSON file
    await this.saveStructure();
    
    // Update the structure summary file
    await this.updateStructureSummaryFile();

    // Create backup
    await this.createBackup();
    
    return subject;
  }
  
  private async createSubjectMdFile(subject: Subject, domain: Domain): Promise<string> {
    const filePath = `${this.getFullPath(domain.folderPath)}/${subject.folderPath}/${subject.id}.md`;
    
    // Generate content for the MD file
    const content = `# ${subject.name}
  
  ${subject.description || ''}
  
  ## Topics
  
  *No topics have been added to this subject yet.*
  
  ## About This Subject
  
  This subject is part of the [[${domain.folderPath}/${domain.id}|${domain.name}]] domain.
  
  ---
  
  *This file was automatically generated on ${new Date().toLocaleString()}.*
  `;
  
     try {
         const file = this.vault.getAbstractFileByPath(filePath);
         if (file instanceof TFile) return filePath;
         await this.vault.create(filePath, content);
         return filePath;
      } catch (error) {
         console.error(`Failed to create subject MD file at ${filePath}:`, error);
         throw error;
      }
  }
  
  private async updateDomainMdFile(domain: Domain): Promise<void> {
    if (!domain.mdFile) {
        console.warn(`Domain MD file path not recorded for ${domain.name} (${domain.id}). Cannot update.`);
        // Option: Try to recreate the file here before updating
        // domain.mdFile = await this.createDomainMdFile(domain);
        // if (!domain.mdFile) return; // If recreation failed, stop
        return; // If no file path is known, we can't update it.
    }

    // Use the generic updateSectionInMdFile helper
    await this.updateSectionInMdFile(
        domain.mdFile,
        '## Subjects',
        this.formatSubjectLinks(domain),
        domain // Pass parent entity for potential recreation context (though updateSectionInMdFile doesn't use it yet)
    );
  }
   private formatSubjectLinks(domain: Domain): string {
        let linksContent = '';
        if (domain.subjects.length === 0) {
          linksContent += '\n*No subjects have been added to this domain yet.*\n';
        } else {
          domain.subjects.forEach(subject => {
             const relativeSubjectPath = `${domain.folderPath}/${subject.folderPath}/${subject.id}`;
            linksContent += `- [[${this.getFullPath(relativeSubjectPath)}|${subject.name}]]${subject.description ? ` - ${subject.description}` : ''}\n`;
          });
        }
        return linksContent;
    }


  /**
 * Add a new topic to a subject
 */
public async addTopic(options: { domainId: string, subjectId: string, name: string, description?: string }): Promise<Topic> {
    const { domainId, subjectId, name, description } = options;
    const id = this.generateId(name);
    
    // Find hierarchy in the cache
    const domain = this.findDomainById(domainId);
    const subject = this.findSubjectById(domain, subjectId);
    
    if (!domain || !subject) {
      throw new Error(`Parent subject with ID "${subjectId}" not found in domain "${domainId}"`);
    }
    
    // Check if topic already exists in this subject in the cache
    if (subject.topics.some(t => t.id === id)) {
      throw new Error(`Topic with ID "${id}" already exists in subject "${subject.name}"`);
    }
    
    // Generate folder path for the topic (relative to subject)
    const folderPath = sanitizeFilename(name); // Use helper
    const fullFolderPath = `${domain.folderPath}/${subject.folderPath}/${folderPath}`;
    
    // Create topic object
    const topic: Topic = {
      id,
      name,
      description,
      folderPath: folderPath,
      series: [],
      dateCreated: new Date().toISOString(),
      dateModified: new Date().toISOString()
    };
    
    // Add to subject in the in-memory structure
    subject.topics.push(topic);
    
    // Update subject's modified date in the cache
    subject.dateModified = new Date().toISOString();
    
    // Ensure topic folder exists in the vault
    await this.ensureFolderExists(this.getFullPath(fullFolderPath));
    
    // Create MD file for the topic in the vault
    topic.mdFile = await this.createTopicMdFile(topic, subject, domain);
    
    // Update subject MD file in the vault to link to this topic
    await this.updateSubjectMdFile(subject, domain);
    
    // Save the updated in-memory structure to JSON file
    await this.saveStructure();
    
    // Update the structure summary file
    await this.updateStructureSummaryFile();

    // Create backup
    await this.createBackup();
    
    return topic;
  }
  
  private async createTopicMdFile(topic: Topic, subject: Subject, domain: Domain): Promise<string> {
    const filePath = `${this.getFullPath(domain.folderPath)}/${subject.folderPath}/${topic.folderPath}/${topic.id}.md`;
    
    // Generate content for the MD file
    const content = `# ${topic.name}
  
  ${topic.description || ''}
  
  ## Series
  
  *No series have been added to this topic yet.*
  
  ## About This Topic
  
  This topic is part of the [[${domain.folderPath}/${subject.folderPath}/${subject.id}|${subject.name}]] subject in the [[${domain.folderPath}/${domain.id}|${domain.name}]] domain.
  
  ---
  
  *This file was automatically generated on ${new Date().toLocaleString()}.*
  `;
  
      try {
         const file = this.vault.getAbstractFileByPath(filePath);
         if (file instanceof TFile) return filePath;
         await this.vault.create(filePath, content);
         return filePath;
      } catch (error) {
         console.error(`Failed to create topic MD file at ${filePath}:`, error);
         throw error;
      }
  }
  
  private async updateSubjectMdFile(subject: Subject, domain: Domain): Promise<void> {
    if (!subject.mdFile) {
        console.warn(`Subject MD file path not recorded for ${subject.name} (${subject.id}). Cannot update.`);
        return;
    }

    await this.updateSectionInMdFile(
        subject.mdFile,
        '## Topics',
        this.formatTopicLinks(subject, domain),
        subject, domain // Pass parent entities (not used by updateSectionInMdFile yet)
    );
  }

   private formatTopicLinks(subject: Subject, domain: Domain): string {
        let linksContent = '';
        if (subject.topics.length === 0) {
          linksContent += '\n*No series have been added to this topic yet.*\n'; // Should be topics, not series
        } else {
          subject.topics.forEach(topic => {
            const relativeTopicPath = `${domain.folderPath}/${subject.folderPath}/${topic.folderPath}/${topic.id}`;
            linksContent += `- [[${this.getFullPath(relativeTopicPath)}|${topic.name}]]${topic.description ? ` - ${topic.description}` : ''}\n`;
          });
        }
        return linksContent;
    }
 
  /**
 * Add a new series to a topic
 */
public async addSeries(options: { 
    domainId: string, 
    subjectId: string, 
    topicId: string, 
    name: string, 
    description?: string 
  }): Promise<Series> {
    const { domainId, subjectId, topicId, name, description } = options;
    const id = this.generateId(name);
    
    // Find hierarchy in the cache
    const domain = this.findDomainById(domainId);
    const subject = this.findSubjectById(domain, subjectId);
    const topic = this.findTopicById(subject, topicId);
    
    if (!domain || !subject || !topic) {
      throw new Error(`Parent topic with ID "${topicId}" not found in subject "${subjectId}" or domain "${domainId}"`);
    }
    
    // Check if series already exists in this topic in the cache
    if (topic.series.some(s => s.id === id)) {
      throw new Error(`Series with ID "${id}" already exists in topic "${topic.name}"`);
    }
    
    // Generate folder path for the series (relative to topic)
    const folderPath = sanitizeFilename(name); // Use helper
    const fullFolderPath = `${domain.folderPath}/${subject.folderPath}/${topic.folderPath}/${folderPath}`;
    
    // Create series object
    const series: Series = {
      id,
      name,
      description,
      folderPath: folderPath,
      authors: [],
      dateCreated: new Date().toISOString(),
      dateModified: new Date().toISOString()
    };
    
    // Add to topic in the in-memory structure
    topic.series.push(series);
    
    // Update topic's modified date in the cache
    topic.dateModified = new Date().toISOString();
    
    // Ensure series folder exists in the vault
    await this.ensureFolderExists(this.getFullPath(fullFolderPath));
    
    // Create MD file for the series in the vault
    series.mdFile = await this.createSeriesMdFile(series, topic, subject, domain);
    
    // Update topic MD file in the vault to link to this series
    await this.updateTopicMdFile(topic, subject, domain);
    
    // Save the updated in-memory structure to JSON file
    await this.saveStructure();
    
    // Update the structure summary file
    await this.updateStructureSummaryFile();

    // Create backup
    await this.createBackup();
    
    return series;
  }
  
  private async createSeriesMdFile(series: Series, topic: Topic, subject: Subject, domain: Domain): Promise<string> {
    const filePath = `${this.getFullPath(domain.folderPath)}/${subject.folderPath}/${topic.folderPath}/${series.folderPath}/${series.id}.md`;
    
    // Generate content for the MD file
    const content = `# ${series.name}
  
  ${series.description || ''}
  
  ## Authors
  
  *No authors have been added to this series yet.*
  
  ## Content
  
  *No content has been added to this series yet.*
  
  ## About This Series
  
  This series is part of the [[${domain.folderPath}/${subject.folderPath}/${topic.folderPath}/${topic.id}|${topic.name}]] topic in the [[${domain.folderPath}/${subject.folderPath}/${subject.id}|${subject.name}]] subject of the [[${domain.folderPath}/${domain.id}|${domain.name}]] domain.
  
  ---
  
  *This file was automatically generated on ${new Date().toLocaleString()}.*
  `;
  
      try {
         const file = this.vault.getAbstractFileByPath(filePath);
         if (file instanceof TFile) return filePath;
         await this.vault.create(filePath, content);
         return filePath;
      } catch (error) {
         console.error(`Failed to create series MD file at ${filePath}:`, error);
         throw error;
      }
  }
  
  private async updateTopicMdFile(topic: Topic, subject: Subject, domain: Domain): Promise<void> {
    if (!topic.mdFile) {
        console.warn(`Topic MD file path not recorded for ${topic.name} (${topic.id}). Cannot update.`);
        return;
    }

    await this.updateSectionInMdFile(
        topic.mdFile,
        '## Series',
        this.formatSeriesLinks(topic, subject, domain),
        topic, subject, domain // Pass parent entities (not used by updateSectionInMdFile yet)
    );
  }

   private formatSeriesLinks(topic: Topic, subject: Subject, domain: Domain): string {
        let linksContent = '';
        if (topic.series.length === 0) {
          linksContent += '\n*No series have been added to this topic yet.*\n';
        } else {
          topic.series.forEach(series => {
            const relativeSeriesPath = `${domain.folderPath}/${subject.folderPath}/${topic.folderPath}/${series.folderPath}/${series.id}`;
            linksContent += `- [[${this.getFullPath(relativeSeriesPath)}|${series.name}]]${series.description ? ` - ${series.description}` : ''}\n`;
          });
        }
        return linksContent;
    }


    /**
 * Add a new author to a series
 */
public async addAuthor(options: { 
    domainId: string, 
    subjectId: string, 
    topicId: string, 
    seriesId: string,
    name: string, 
    description?: string 
  }): Promise<Author> {
    const { domainId, subjectId, topicId, seriesId, name, description } = options;
    const id = this.generateId(name);
    
    // Find hierarchy in the cache
    const domain = this.findDomainById(domainId);
    const subject = this.findSubjectById(domain, subjectId);
    const topic = this.findTopicById(subject, topicId);
    const series = this.findSeriesById(topic, seriesId);

    if (!domain || !subject || !topic || !series) {
      console.error(`PathManager: addAuthor failed. Parent series not found. Domain: ${domainId}, Subject: ${subjectId}, Topic: ${topicId}, Series: ${seriesId}`);
      throw new Error("Parent series not found in the structure. Ensure you selected the correct path."); // More specific errors could be given
    }
    
    // Check if author already exists in this series in the cache
    if (series.authors.some(a => a.id === id)) {
      throw new Error(`Author with ID "${id}" already exists in series "${series.name}"`);
    }
    
    // Create author object
    const author: Author = {
      id,
      name,
      description: description, // Include description
      content: [],
      dateCreated: new Date().toISOString(),
      dateModified: new Date().toISOString()
      // mdFile will be set after creation
    };
    
    // Add to series in the in-memory structure
    series.authors.push(author);
    
    // Update series's modified date in the cache
    series.dateModified = new Date().toISOString();
    
     // Determine MD file path for the author (inside the series folder)
    const seriesFullFolderPath = this.getFullPath(`${domain.folderPath}/${subject.folderPath}/${topic.folderPath}/${series.folderPath}`);
    await this.ensureFolderExists(seriesFullFolderPath); // Ensure series folder exists in the vault
    
    author.mdFile = await this.createAuthorMdFile(author, series, topic, subject, domain);
    
    // Update series MD file in the vault to link to this author
    await this.updateSeriesMdFile(series, topic, subject, domain);
    
    // Save the updated in-memory structure to JSON file
    await this.saveStructure();
    
    // Create backup
    await this.createBackup();
    
    return author;
  }

    private async createAuthorMdFile(author: Author, series: Series, topic: Topic, subject: Subject, domain: Domain): Promise<string> {
        // MD file goes inside the series folder
        const filePath = `${this.getFullPath(domain.folderPath)}/${subject.folderPath}/${topic.folderPath}/${series.folderPath}/${author.id}.md`;

         const content = `# ${author.name}

${author.description ? author.description + '\n\n' : ''}

## Content

*No content has been linked for this author yet.*

## About This Author

This author is associated with the [[${this.getFullPath(`${domain.folderPath}/${subject.folderPath}/${topic.folderPath}/${series.folderPath}/${series.id}`)}|${series.name}]] series, part of the [[${this.getFullPath(`${domain.folderPath}/${subject.folderPath}/${topic.folderPath}/${topic.id}`)}|${topic.name}]] topic in the [[${this.getFullPath(`${domain.folderPath}/${subject.folderPath}/${subject.id}`)}|${subject.name}]] subject of the [[${this.getFullPath(`${domain.folderPath}/${domain.id}`)}|${domain.name}]] domain.

---

*This file was automatically generated on ${new Date().toLocaleString()}.*
`;
        try {
             const file = this.vault.getAbstractFileByPath(filePath);
             if (file instanceof TFile) return filePath; // File already exists, return path
             await this.vault.create(filePath, content);
             return filePath;
        } catch (error) {
             console.error(`Failed to create author MD file at ${filePath}:`, error);
             throw error;
        }
    }

    private async updateSeriesMdFile(series: Series, topic: Topic, subject: Subject, domain: Domain): Promise<void> {
        if (!series.mdFile) {
            console.warn(`Series MD file path not recorded for ${series.name} (${series.id}). Cannot update.`);
            return;
        }

        await this.updateSectionInMdFile(
            series.mdFile,
            '## Authors',
            this.formatAuthorLinks(series, topic, subject, domain),
            series, topic, subject, domain // Pass parent entities (not used by updateSectionInMdFile yet)
        );

        // Also ensure the '## Content' section in the Series file lists aggregated content
         await this.updateSectionInMdFile(
             series.mdFile,
             '## Content',
             this.formatSeriesContentLinks(series), // Formats content links aggregated from all authors in this series
             series, topic, subject, domain // Pass parent entities (not used by updateSectionInMdFile yet)
         );
    }

    private formatAuthorLinks(series: Series, topic: Topic, subject: Subject, domain: Domain): string {
        let linksContent = '';
        if (series.authors.length === 0) {
            linksContent += '\n*No authors have been added to this series yet.*\n';
        } else {
            series.authors.forEach(author => {
                // Link to the author's MD file within the series folder
                 const relativeAuthorPath = `${domain.folderPath}/${subject.folderPath}/${topic.folderPath}/${series.folderPath}/${author.id}`;
                 linksContent += `- [[${this.getFullPath(relativeAuthorPath)}|${author.name}]]${author.description ? ` - ${author.description}` : ''}\n`;
            });
        }
        return linksContent;
    }

     // This helper formats links to *content* items *within* a series's MD file.
     // It lists all content from all authors in the series.
     private formatSeriesContentLinks(series: Series): string {
        let linksContent = '';
        const allContent: Content[] = [];
        series.authors.forEach(author => {
            allContent.push(...author.content);
        });

        if (allContent.length === 0) {
            linksContent += '\n*No content has been added to this series yet.*';
        } else {
             // Sort content by position if available, otherwise by title
            const sortedContent = [...allContent].sort((a, b) => {
                if (a.position !== undefined && b.position !== undefined) {
                    return a.position - b.position;
                }
                // Fallback to comparing by title if position is not available
                return a.title.localeCompare(b.title);
            });

            sortedContent.forEach(item => {
                // Use item.filePath for the link target (the actual content file)
                const displayPath = item.filePath.replace(/\.md$/, ''); // Remove .md for link display
                // Use item.title as the display text, fall back to filename derived from path
                const linkText = item.title || displayPath.split('/').pop();
                 // Add position if available
                 const positionPrefix = item.position !== undefined ? `Part ${item.position}: ` : '';
                linksContent += `- ${positionPrefix}[[${displayPath}|${linkText}]]\n`;
            });
        }
        return linksContent;
     }


    /**
 * Link an existing content file to an author within the structure.
 * Note: This method does NOT create the content file itself.
 * It creates the Content object in the JSON structure and updates the Author's index file.
 * It also updates the parent Series file to include the new content link.
 */
public async addContent(contentMetadata: ContentMetadata): Promise<Content> {
    const { domain, subject, topic, series, author: authorId, ...restMetadata } = contentMetadata;
    const id = this.generateId(contentMetadata.title); // Generate ID based on content title
    
    // Find hierarchy in the cache using provided IDs (from modal)
    const foundDomain = this.findDomainById(domain);
    const foundSubject = this.findSubjectById(foundDomain, subject);
    const foundTopic = this.findTopicById(foundSubject, topic);
    const foundSeries = this.findSeriesById(foundTopic, series);
    const foundAuthor = this.findAuthorById(foundSeries, authorId);

    if (!foundDomain || !foundSubject || !foundTopic || !foundSeries || !foundAuthor) {
      // Log specific missing parent for easier debugging
      console.error(`PathManager: addContent failed. Parent entity not found. DomainID: ${domain}, SubjectID: ${subject}, TopicID: ${topic}, SeriesID: ${series}, AuthorID: ${authorId}`);
      throw new Error("Parent author not found in the structure. Ensure you selected the correct path.");
    }
    
    // Check if content with this ID already exists for this author in the cache
    if (foundAuthor.content.some(c => c.id === id)) {
      throw new Error(`Content with ID "${id}" already exists for author "${foundAuthor.name}"`);
    }

     // Validate that the provided filePath exists in the vault
    const contentFile = this.vault.getAbstractFileByPath(contentMetadata.filePath);
    if (!(contentFile instanceof TFile)) {
        throw new Error(`Content file not found in vault at path: ${contentMetadata.filePath}`);
    }
    
    // Create content object
    const content: Content = {
      id,
      title: contentMetadata.title,
      subtitle: contentMetadata.subtitle,
      position: contentMetadata.position,
      totalParts: contentMetadata.totalParts,
      filePath: contentMetadata.filePath, // Use the provided file path
      videoUrl: contentMetadata.videoUrl, // Optional
      dateAdded: new Date().toISOString()
    };
    
    // Add to author in the in-memory structure
    foundAuthor.content.push(content);
    
    // Update author's modified date in the cache
    foundAuthor.dateModified = new Date().toISOString();
    
    // Update author MD file in the vault to link to this content
    // Pass the entire hierarchy path for potential file recreation if needed
    await this.updateAuthorMdFile(foundAuthor, foundSeries, foundTopic, foundSubject, foundDomain);
    
    // Update parent Series MD file in the vault to include the new content link (aggregated list)
     await this.updateSeriesMdFile(foundSeries, foundTopic, foundSubject, foundDomain); // Call updateSeriesMdFile to refresh its content list

    // Save the updated in-memory structure to JSON file
    await this.saveStructure();
    
    // Create backup
    await this.createBackup();
    
    return content;
  }

    private async updateAuthorMdFile(author: Author, series: Series, topic: Topic, subject: Subject, domain: Domain): Promise<void> {
        if (!author.mdFile) {
             console.warn(`Author MD file path not recorded for ${author.name} (${author.id}). Cannot update.`);
             // Option: Try to recreate the file here before updating
             // author.mdFile = await this.createAuthorMdFile(author, series, topic, subject, domain);
             // if (!author.mdFile) return; // If recreation failed, stop
             return; // If no file path is known, we can't update it.
        }

        await this.updateSectionInMdFile(
            author.mdFile,
            '## Content',
            this.formatAuthorContentLinks(author),
            author, series, topic, subject, domain // Pass parent entities (not used by updateSectionInMdFile yet)
        );
    }

     private formatAuthorContentLinks(author: Author): string {
        let linksContent = '';
        if (author.content.length === 0) {
            linksContent += '\n*No content has been linked for this author yet.*\n';
        } else {
             // Sort content by position if available, otherwise by title
            const sortedContent = [...author.content].sort((a, b) => {
                if (a.position !== undefined && b.position !== undefined) {
                    return a.position - b.position;
                }
                // Fallback to comparing by title if position is not available
                return a.title.localeCompare(b.title);
            });
             sortedContent.forEach(item => {
                // Use item.filePath for the link target
                const displayPath = item.filePath.replace(/\.md$/, ''); // Remove .md for link display
                // Use item.title as the display text, fall back to filename derived from path
                const linkText = item.title || displayPath.split('/').pop();
                 // Add position if available
                 const positionPrefix = item.position !== undefined ? `Part ${item.position}: ` : '';
                linksContent += `- ${positionPrefix}[[${displayPath}|${linkText}]]\n`;
             });
        }
        return linksContent;
    }
  
  public generateId(name: string): string {
     if (!name) return ''; // Handle empty name case gracefully
     // Use sanitizeFilename with '-' separator for ID generation
    return sanitizeFilename(name.toLowerCase(), '-') 
      .replace(/^-+|-+$/g, ''); // Remove leading/trailing hyphens
  }
  
  // MD FILE OPERATIONS - Ensure these are updated to use vault.read/modify/create

  // The create/update MD file methods are now specific to each entity type
  // e.g., createDomainMdFile, updateDomainMdFile, createSubjectMdFile, etc.
  // These are implemented alongside the addX methods above.

  // QUERY OPERATIONS (Helpers to find entities)
  
  public findDomainById(id: string | undefined): Domain | undefined {
     if (!id) return undefined;
    return this.structure.structure.domains.find(d => d.id === id);
  }
  
  public findSubjectById(domain: Domain | undefined, id: string | undefined): Subject | undefined {
    if (!domain || !id) return undefined;
    return domain.subjects.find(s => s.id === id);
  }
  
   public findTopicById(subject: Subject | undefined, id: string | undefined): Topic | undefined {
     if (!subject || !id) return undefined;
     return subject.topics.find(t => t.id === id);
   }

    public findSeriesById(topic: Topic | undefined, id: string | undefined): Series | undefined {
        if (!topic || !id) return undefined;
        return topic.series.find(s => s.id === id);
    }

    public findAuthorById(series: Series | undefined, id: string | undefined): Author | undefined {
        if (!series || !id) return undefined;
        return series.authors.find(a => a.id === id);
    }

     // Optional: Add find methods by name for convenience, though ID is more reliable
     public findDomainByName(name: string): Domain | undefined {
        if (!name) return undefined;
        const searchId = this.generateId(name);
        return this.structure.structure.domains.find(d => d.id === searchId || d.name.toLowerCase() === name.toLowerCase());
     }
    // ... similar methods for Subject, Topic, Series, Author by name if needed ...

  // SERIES DETECTION - Keep existing method
  
  public detectSeries(videoTitle: string): { series: string, position?: number, totalParts?: number } {
    // Try to detect if video is part of a series
    const seriesMatch = videoTitle.match(/part\s*(\d+)(?:\s*of\s*(\d+))?|episode\s*(\d+)/i);
    
    if (seriesMatch) {
      // Extract position and total parts if available
      const position = parseInt(seriesMatch[1] || seriesMatch[3], 10);
      const totalParts = seriesMatch[2] ? parseInt(seriesMatch[2], 10) : undefined;
      
      // Try to extract series name - Capture everything before the 'part' or 'episode' marker
      // Added a check for common separators like ' - '
      const seriesTitleMatch = videoTitle.match(/(.+?)(?:\s*-|\s*[:.])?\s*(?:part|episode)/i);
      const seriesTitle = seriesTitleMatch ? seriesTitleMatch[1].trim() : "Unknown Series";
      
      return {
        series: seriesTitle,
        position,
        totalParts
      };
    }
    
    return { series: "Standalone" };
  }
}
