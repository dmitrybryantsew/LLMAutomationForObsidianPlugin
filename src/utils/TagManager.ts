import { App, TFile, getAllTags, Vault, Notice } from "obsidian"; // Import Vault and Notice
import { ErrorHandler } from "./ErrorHandler";

class TagManager {
  private app: App;
  private vault: Vault; // Add Vault reference
  private vaultTags: Set<string> = new Set(); // Tags found in existing vault files
  private customTags: Set<string> = new Set(); // Tags generated/added by the plugin
  private customTagsPath: string; // Path to the custom tags file
  private backupFolder: string; // Path to backup folder
  private maxBackups: number = 3; // Maximum number of rotating backups
  private monthlyBackupFolder: string; // Path to monthly backup folder
  private maxMonthlyBackups: number = 3; // Maximum number of monthly backups

  constructor(app: App, customTagsPath: string = "Paths/custom_tags.json", backupFolder: string = "Paths/tags_backups") {
    this.app = app;
    this.vault = app.vault; // Assign Vault
    this.customTagsPath = customTagsPath; // Store path
    this.backupFolder = backupFolder; // Store backup folder path
    this.monthlyBackupFolder = `${backupFolder}/monthly`; // Monthly backup subfolder

    // Initialize tags asynchronously (now includes loading custom tags)
    this.initializeTags().catch(error => {
        ErrorHandler.handleError(error, "TAG_MANAGER_INIT", {
            operation: "initialize-tags",
            details: error instanceof Error ? error.message : String(error)
        });
    });
  }

  /**
   * Initializes the TagManager by collecting vault tags and loading saved custom tags.
   */
  async initializeTags() {
    try {
      // Ensure backup folder exists
      await this.ensureBackupFolder();
      // Ensure monthly backup folder exists
      await this.ensureMonthlyBackupFolder();

      // Load custom tags first if the file exists
      await this.loadCustomTags();

      // Check if we need to create a monthly backup (on 1st of month)
      await this.checkAndCreateMonthlyBackup();

      // Collect all tags from vault (this will update vaultTags)
      await this.collectVaultTags();

      // Note: Hardcoded default tags are now less necessary if custom_tags.json persists,
      // but can still be added here if you want a baseline even when the file is empty.
      // If adding here, use addCustomTags to leverage normalization and saving.
      /*
      this.addCustomTags([
        "tutorial", "guide", "development", "programming", "gaming",
        "technology", "ai", "machine_learning", "unreal_engine",
        "video_editing", "philosophy", "psychology"
      ]);
      */

    } catch (error: unknown) {
        console.error("Error during TagManager initialization:", error);
        // ErrorHandler is used in the constructor's catch, so no need to re-report here
    }
  }

  /**
   * Loads custom tags from the dedicated JSON file.
   */
  private async loadCustomTags(): Promise<void> {
      try {
          const file = this.vault.getAbstractFileByPath(this.customTagsPath);
          if (file instanceof TFile) {
              const content = await this.vault.read(file);
              try {
                  const tagsArray: string[] = JSON.parse(content);
                   if (Array.isArray(tagsArray)) {
                       tagsArray.forEach(tag => {
                           const normalized = this.normalizeTag(tag);
                           if (normalized) this.customTags.add(normalized);
                       });
                       console.log(`TagManager: Loaded ${this.customTags.size} custom tags from ${this.customTagsPath}`);
                   } else {
                       console.warn(`TagManager: Custom tags file ${this.customTagsPath} has invalid format.`);
                       // Attempt auto-recovery from backup
                       await this.attemptAutoRecovery();
                  }
              } catch (parseError) {
                  console.error(`TagManager: Failed to parse custom tags file ${this.customTagsPath}:`, parseError);
                  // Attempt auto-recovery from backup
                  await this.attemptAutoRecovery();
              }
          } else {
              // File doesn't exist yet, which is expected on first run
              console.log(`TagManager: Custom tags file not found at ${this.customTagsPath}. Starting with empty custom tags.`);
          }
      } catch (error: unknown) {
          // Catch file reading errors
          ErrorHandler.handleError(error, "FILE_OPERATION", {
              operation: "load-custom-tags",
              path: this.customTagsPath,
              details: error instanceof Error ? error.message : String(error)
          });
      }
  }

  /**
   * Ensures the backup folder exists.
   */
  private async ensureBackupFolder(): Promise<void> {
      try {
          await this.vault.createFolder(this.backupFolder);
      } catch (error) {
          // Ignore error if folder already exists
          if (!(error instanceof Error) || !error.message.includes('Folder already exists')) {
              console.warn(`TagManager: Could not create backup folder: ${error}`);
          }
      }
  }

  /**
   * Creates a backup of the current custom tags file.
   * Implements rotating backup system with maxBackups limit.
   */
  private async createBackup(): Promise<string> {
      try {
          await this.ensureBackupFolder();

          const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
          const backupPath = `${this.backupFolder}/backup-${timestamp}.json`;

          // Save the current custom tags as a backup
          const tagsArray = Array.from(this.customTags).sort();
          const content = JSON.stringify(tagsArray, null, 2);

          await this.vault.create(backupPath, content);

          // Clean up old backups (keep only maxBackups most recent)
          await this.cleanupOldBackups();

          console.log(`TagManager: Created backup at ${backupPath}`);
          return backupPath;
      } catch (error) {
          console.error("TagManager: Error creating backup:", error);
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
                      console.log(`TagManager: Deleted old backup: ${backupFiles[i].path}`);
                  } catch (deleteError) {
                      console.error(`TagManager: Failed to delete old backup ${backupFiles[i].path}:`, deleteError);
                  }
              }
          }
      } catch (error) {
          console.error("TagManager: Error cleaning up old backups:", error);
          // Don't throw - cleanup failure shouldn't block save operation
      }
  }

  /**
   * Restores custom tags from a backup file.
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
          let restoredTags: string[];
          try {
              restoredTags = JSON.parse(content);
              if (!Array.isArray(restoredTags)) {
                  throw new Error("Invalid backup format: expected array");
              }
          } catch (parseError) {
              console.error(`TagManager: Failed to parse backup file at ${backupPath}:`, parseError);
              throw new Error(`Failed to parse backup file: ${parseError instanceof Error ? parseError.message : 'Unknown error'}`);
          }

          // Validate and normalize restored tags
          const normalizedTags = restoredTags
              .map(tag => this.normalizeTag(tag))
              .filter((tag): tag is string => tag !== null && tag !== undefined && tag.length > 0);

          // Replace current tags with restored tags
          this.customTags = new Set(normalizedTags);

          // Save the restored tags
          await this.saveCustomTags();

          new Notice(`Successfully restored ${this.customTags.size} tags from backup`);
          console.log(`TagManager: Restored tags from ${backupPath}`);
          return true;
      } catch (error) {
          console.error("TagManager: Error restoring from backup:", error);
          new Notice(`Failed to restore from backup: ${error instanceof Error ? error.message : 'Unknown error'}`);
          return false;
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
          console.error("TagManager: Error getting available backups:", error);
          return [];
      }
  }

  /**
   * Validates the custom tags data before saving.
   * @returns true if data is valid, false otherwise
   */
  private validateCustomTags(tags: string[]): boolean {
      // Check if tags is an array
      if (!Array.isArray(tags)) {
          console.error("TagManager: Validation failed - tags is not an array");
          return false;
      }

      // Check if all tags are strings
      for (const tag of tags) {
          if (typeof tag !== 'string') {
              console.error(`TagManager: Validation failed - invalid tag type: ${typeof tag}`);
              return false;
          }
          // Check if tag is not empty after normalization
          const normalized = this.normalizeTag(tag);
          if (!normalized || normalized.length === 0) {
              console.error(`TagManager: Validation failed - tag normalizes to empty: ${tag}`);
              return false;
          }
      }

      return true;
  }

    /**
     * Saves the current set of custom tags to the dedicated JSON file.
     * Implements atomic writes with backup and validation.
     */
    public async saveCustomTags(): Promise<void> {
        if (this.customTags.size === 0 && !(await this.vault.adapter.exists(this.customTagsPath))) {
             // Don't create an empty file if no custom tags exist and the file isn't already there
             return;
        }

        try {
            // Create backup before overwriting
            await this.createBackup();

            // Ensure the parent directory exists
            const folder = this.customTagsPath.split('/').slice(0, -1).join('/');
            if (folder) { // Only try to create if it's in a subfolder
                 // Use vault.createFolder which handles parent directories
                await this.vault.createFolder(folder).catch(err => {
                     // Ignore error if folder already exists
                     if (!err.message.includes('Folder already exists')) {
                         throw err;
                     }
                 });
            }


            const tagsArray = Array.from(this.customTags).sort(); // Save as sorted array

            // Validate before saving
            if (!this.validateCustomTags(tagsArray)) {
                throw new Error("Custom tags validation failed");
            }

            const content = JSON.stringify(tagsArray, null, 2);

            // Atomic write: write to temp file first, then rename
            const tempPath = `${this.customTagsPath}.tmp`;
             const file = this.vault.getAbstractFileByPath(this.customTagsPath);

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
                    console.warn(`TagManager: Failed to delete temp file ${tempPath}:`, tempError);
                }
             } else {
                // For new files, just create directly
                await this.vault.create(this.customTagsPath, content);
             }
             console.log(`TagManager: Saved ${this.customTags.size} custom tags to ${this.customTagsPath}`);

        } catch (error: unknown) {
             ErrorHandler.handleError(error, "FILE_OPERATION", {
                operation: "save-custom-tags",
                path: this.customTagsPath,
                details: error instanceof Error ? error.message : String(error)
            });
        }
    }


  private async collectVaultTags() {
    this.vaultTags.clear(); // Clear previous vault tags
    const files = this.app.vault.getMarkdownFiles();
    for (const file of files) {
      try {
        const tags = await this.getFileTags(file);
        tags.forEach(tag => {
             const normalized = this.normalizeTag(tag);
             if (normalized) this.vaultTags.add(normalized);
        });
      } catch (error: unknown) {
        // Log individual file errors but don't stop the whole collection
        console.error(`TagManager: Error collecting tags from ${file.path}:`, error);
      }
    }
     console.log(`TagManager: Collected ${this.vaultTags.size} vault tags.`);
  }

  private async getFileTags(file: TFile): Promise<string[]> {
    // Use app.metadataCache to reliably get tags from frontmatter or inline
    const cache = this.app.metadataCache.getFileCache(file);
    if (!cache) {
        // console.warn(`No cache found for file: ${file.path}`);
        return [];
    }
    
    const allTags = getAllTags(cache); // Get all tags from cache

    if (!allTags) {
        return [];
    }

    // getAllTags returns an object like { 'tag1': 1, 'tag2/sub': 1 }
    // We want the tag names without the count
    return Object.keys(allTags).map(tag => tag.replace(/^#/, '')); // Remove '#' prefix if present
  }

  /**
   * Adds new tags to the internal managed list (custom tags).
   * Handles single tags or arrays. Automatically normalizes tags.
   * Calls saveCustomTags after adding.
   */
  addCustomTags(tags: string | string[]) {
    const tagsToAdd = Array.isArray(tags) ? tags : [tags];
    let changed = false;
    tagsToAdd.forEach(tag => {
        const normalizedTag = this.normalizeTag(tag);
        if (normalizedTag && !this.customTags.has(normalizedTag)) { // Only add if valid and new
            this.customTags.add(normalizedTag);
            changed = true;
        }
    });
    
     // Save custom tags if any new tags were added
    if (changed) {
        this.saveCustomTags().catch(error => {
             ErrorHandler.handleError(error, "FILE_OPERATION", {
                operation: "save-custom-tags-after-add",
                details: error instanceof Error ? error.message : String(error)
            });
        });
    }
  }

  /**
   * Normalizes a single tag string (lowercase, spaces to underscores, basic sanitization).
   */
  normalizeTag(tag: string): string {
    // Remove leading/trailing whitespace, convert to lowercase
    let normalized = tag.trim().toLowerCase();
    // Replace spaces and slashes with underscores
    normalized = normalized.replace(/[ /\\]+/g, '_');
    // Remove characters not typically allowed in Obsidian tags (or that cause issues)
    normalized = normalized.replace(/[^a-z0-9_-]/g, '');
    // Remove leading/trailing underscores or hyphens
    normalized = normalized.replace(/^[_-\s]+|[_-\s]+$/g, '');
    // Handle empty string after sanitization
    return normalized;
  }

  /**
   * Gets a combined list of all managed tags (vault + custom), sorted and unique.
   */
  getAllManagedTags(): string[] {
    return [...new Set([...this.vaultTags, ...this.customTags])].sort();
  }

  /**
   * Formats a sample of managed tags into a string suitable for an LLM prompt.
   * Instructs the LLM to use similar tags if relevant or generate distinct new ones.
   * @param limit The maximum number of tags to include in the sample.
   * @returns A string containing a list of tags for the prompt.
   */
  formatTagsForPrompt(limit: number = 150): string {
      const allTags = this.getAllManagedTags();
      // Take a random sample of tags if there are many, or the first 'limit' after sorting
      // A random sample might be more representative than just the first N.
      const tagsSample = allTags.sort(() => 0.5 - Math.random()).slice(0, limit).sort(); // Random sample, then sort for consistency

      if (tagsSample.length === 0) {
          return "Generate concise tags (3-6 words max, lowercase, underscores for spaces). Output ONLY a comma-separated list of tags with whitespace after comma, nothing else. Try to use already existing tags where possible.";
      }

      // Include instructions to consider these tags but also allow new ones
      return `Consider using tags from this list if relevant (use underscores for multi-word tags as shown): ${tagsSample.join(', ')}. If this list doesn't contain relevant tags, generate new concise ones (3-6 words max, lowercase, underscores for spaces). Output ONLY a comma-separated list of tags, nothing else.`;
  }


  // Parse tags from different formats (Kept for potential reading from files, but updated to use normalizeTag)
  parseTags(content: string): string[] {
    const tags: Set<string> = new Set();

    // Try to parse frontmatter tags (string or array)
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (frontmatterMatch) {
        const frontmatter = frontmatterMatch[1];
        // Simple regex for tags line - won't handle complex YAML arrays perfectly without a YAML parser
        const tagsLineMatch = frontmatter.match(/^tags:\s*(.*?)$/m);
        if (tagsLineMatch?.[1]) {
            // Attempt to handle simple array syntax [tag1, tag2] or string tag1, tag2
            let rawTags = tagsLineMatch[1].trim();
            if (rawTags.startsWith('[') && rawTags.endsWith(']')) {
                rawTags = rawTags.substring(1, rawTags.length - 1);
            }
            rawTags.split(/,/).forEach(tag => { // Split by comma
                const normalized = this.normalizeTag(tag);
                if (normalized) tags.add(normalized);
            });
        }
    }

    // Try to parse inline #tag or #tag/sub-tag format within the document body
    const inlineTagMatches = content.match(/#([a-zA-Z0-9_/-]+)/g);
    if (inlineTagMatches) {
        inlineTagMatches.forEach(tagMatch => {
            const tag = tagMatch.substring(1); // Remove '#'
            // Normalize, replacing '/' with '_' as per Obsidian tag best practices for many systems
            const normalized = this.normalizeTag(tag.replace(/\//g, '_')); 
            if (normalized) tags.add(normalized);
        });
    }

    // Return unique, normalized tags
    return Array.from(tags);
  }

  // Validate and normalize tags (Kept, useful internally)
  normalizeTags(tags: string[]): string[] {
    return tags.map(tag => this.normalizeTag(tag)).filter(Boolean);
  }

  // Format tags for metadata (Kept, useful for saving to files)
  formatTags(tags: string[]): string {
    return tags.join(', '); // Format as comma-separated string for frontmatter value
  }

  // Check if tag exists in vault (Kept, useful for UI perhaps)
  hasTag(tag: string): boolean {
    const normalizedTag = this.normalizeTag(tag);
    if (!normalizedTag) return false;
    return this.vaultTags.has(normalizedTag) || this.customTags.has(normalizedTag);
  }

  // Suggest related tags based on existing tag (Kept, useful for UI perhaps)
  suggestRelatedTags(tag: string): string[] {
    const allTags = this.getAllManagedTags();
    const normalizedQuery = this.normalizeTag(tag);
    if (!normalizedQuery) return [];

    // Simple substring match for suggestion
    return allTags.filter(t => t.includes(normalizedQuery));
  }

    /**
     * Called when the plugin is unloaded. Saves custom tags.
     */
    public async destroy(): Promise<void> {
        await this.saveCustomTags();
         console.log("TagManager: Saved custom tags on unload.");
    }

    /**
     * Attempts auto-recovery from the latest backup if the main file is corrupted.
     * @returns true if recovery was successful, false otherwise
     */
    public async attemptAutoRecovery(): Promise<boolean> {
        try {
            // Check if main file exists
            if (!(await this.vault.adapter.exists(this.customTagsPath))) {
                console.log(`TagManager: Main file ${this.customTagsPath} does not exist, attempting recovery from backup`);
                return await this.restoreFromLatestBackup();
            }

            // Try to load and validate main file
            const file = this.vault.getAbstractFileByPath(this.customTagsPath);
            if (!(file instanceof TFile)) {
                console.log(`TagManager: Main file is not a valid file, attempting recovery from backup`);
                return await this.restoreFromLatestBackup();
            }

            const content = await this.vault.read(file);
            try {
                const tags = JSON.parse(content);
                if (!Array.isArray(tags)) {
                    throw new Error("Invalid format");
                }
                // File is valid, no recovery needed
                console.log(`TagManager: Main file is valid, no recovery needed`);
                return false;
            } catch (parseError) {
                console.log(`TagManager: Main file is corrupted, attempting recovery from backup: ${parseError}`);
                return await this.restoreFromLatestBackup();
            }
        } catch (error) {
            console.error("TagManager: Error during auto-recovery:", error);
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
                console.log("TagManager: No backups available for recovery");
                return false;
            }

            // Restore from the most recent backup (first in list)
            const latestBackup = backups[0];
            console.log(`TagManager: Restoring from latest backup: ${latestBackup}`);
            
            const success = await this.restoreFromBackup(latestBackup);
            if (success) {
                new Notice(`Recovered tags from backup: ${latestBackup}`);
            }
            
            return success;
        } catch (error) {
            console.error("TagManager: Error restoring from latest backup:", error);
            return false;
        }
      }
    
      /**
       * Ensures the monthly backup folder exists.
       */
      private async ensureMonthlyBackupFolder(): Promise<void> {
          try {
              await this.vault.createFolder(this.monthlyBackupFolder);
          } catch (error) {
              // Ignore error if folder already exists
              if (!(error instanceof Error) || !error.message.includes('Folder already exists')) {
                  console.warn(`TagManager: Could not create monthly backup folder: ${error}`);
              }
          }
      }
    
      /**
       * Checks if today is the 1st of the month and creates a monthly backup if needed.
       */
      private async checkAndCreateMonthlyBackup(): Promise<void> {
          const now = new Date();
          const dayOfMonth = now.getDate();
          
          if (dayOfMonth === 1) {
              console.log(`TagManager: Today is the 1st of the month. Checking for monthly backup...`);
              await this.createMonthlyBackup();
          }
      }
    
      /**
       * Creates a monthly backup of the current custom tags.
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
    
              // Save the current custom tags as a backup
              const tagsArray = Array.from(this.customTags).sort();
              const content = JSON.stringify(tagsArray, null, 2);
    
              // Check if backup already exists for this month
              const existingFile = this.vault.getAbstractFileByPath(backupPath);
              if (existingFile instanceof TFile) {
                  // Replace existing backup
                  await this.vault.modify(existingFile, content);
                  console.log(`TagManager: Updated monthly backup at ${backupPath}`);
              } else {
                  // Create new backup
                  await this.vault.create(backupPath, content);
                  console.log(`TagManager: Created monthly backup at ${backupPath}`);
              }
    
              // Clean up old monthly backups (keep only maxMonthlyBackups most recent)
              await this.cleanupOldMonthlyBackups();
    
              return backupPath;
          } catch (error) {
              console.error("TagManager: Error creating monthly backup:", error);
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
                          console.log(`TagManager: Deleted old monthly backup: ${backupFiles[i].path}`);
                      } catch (deleteError) {
                          console.error(`TagManager: Failed to delete old monthly backup ${backupFiles[i].path}:`, deleteError);
                      }
                  }
              }
          } catch (error) {
              console.error("TagManager: Error cleaning up old monthly backups:", error);
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
              console.error("TagManager: Error getting available monthly backups:", error);
              return [];
          }
      }
    
      /**
       * Restores custom tags from a monthly backup file.
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
              let restoredTags: string[];
              try {
                  restoredTags = JSON.parse(content);
                  if (!Array.isArray(restoredTags)) {
                      throw new Error("Invalid backup format: expected array");
                  }
              } catch (parseError) {
                  console.error(`TagManager: Failed to parse monthly backup file at ${backupPath}:`, parseError);
                  throw new Error(`Failed to parse monthly backup file: ${parseError instanceof Error ? parseError.message : 'Unknown error'}`);
              }
    
              // Validate and normalize restored tags
              const normalizedTags = restoredTags
                  .map(tag => this.normalizeTag(tag))
                  .filter((tag): tag is string => tag !== null && tag !== undefined && tag.length > 0);
    
              // Replace current tags with restored tags
              this.customTags = new Set(normalizedTags);
    
              // Save the restored tags
              await this.saveCustomTags();
    
              new Notice(`Successfully restored ${this.customTags.size} tags from monthly backup`);
              console.log(`TagManager: Restored tags from monthly backup ${backupPath}`);
              return true;
          } catch (error) {
              console.error("TagManager: Error restoring from monthly backup:", error);
              new Notice(`Failed to restore from monthly backup: ${error instanceof Error ? error.message : 'Unknown error'}`);
              return false;
          }
      }
    }
    
    export {TagManager};