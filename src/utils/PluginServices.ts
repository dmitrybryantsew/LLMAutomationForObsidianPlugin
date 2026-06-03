
import { App } from "obsidian";
import { TranscriptManager } from "./TranscriptManager";
import { ArticleManager } from "./ArticleManager";
import { FileManager } from "./FileManager";
import { TagManager } from "./TagManager";
import { VideoQueueManager } from "./VideoQueueManager";
import { PathManager } from "./pathStructure/PathManager";
import { HierarchyManager } from "./HierarchyManager";
import { PluginSettings } from "../types";
import { DatabaseManager } from "../database/DatabaseManager";
import { LLMClientService } from "./LLMClientService";
import { ErrorHandler } from "./ErrorHandler";
import { FlashcardManager } from "./FlashcardManager";
import { SpacedRepetitionDatabase } from "./spacedRepetition/SpacedRepetitionDatabase";
import { SpacedRepetitionScheduler } from "./spacedRepetition/SpacedRepetitionScheduler";
import { SpacedRepetitionGenerator } from "./spacedRepetition/SpacedRepetitionGenerator";

import {HIERARCHY_PLUGIN_ID} from "../constants"
import type GptFreeTextGeneratorPlugin from "../main";

/**
 * Central service registry for the plugin.
 * Handles initialization order and dependency management.
 */
export class PluginServices {
  private app: App;
  private plugin: GptFreeTextGeneratorPlugin;
  
  // Services
  private _fileManager: FileManager;
  private _tagManager: TagManager; // Keep single instance
  private _transcriptManager: TranscriptManager;
  private _articleManager: ArticleManager;
  private _videoQueueManager: VideoQueueManager | null = null;
  private _pathManager: PathManager;
  private _hierarchyManager: HierarchyManager;
  private _databaseManager: DatabaseManager | null = null;
  private _llmClientService: LLMClientService;
  private _flashcardManager: FlashcardManager;
  private _spacedRepetitionDatabase: SpacedRepetitionDatabase | null = null;
  private _spacedRepetitionScheduler: SpacedRepetitionScheduler;
  private _spacedRepetitionGenerator: SpacedRepetitionGenerator;
  
  // Settings
  private _settings: PluginSettings;
  
  constructor(app: App, plugin: GptFreeTextGeneratorPlugin, settings: PluginSettings) {
    this.app = app;
    this.plugin = plugin;
    this._settings = settings;
    
    // Initialize core services first
    this._fileManager = new FileManager(app);
    
    // TagManager needs the app, initialize it here. It handles its own async loading.
    // Place its custom tags file in a consistent location, maybe "Paths/custom_tags.json".
    this._tagManager = new TagManager(app, "Paths/custom_tags.json"); 

    // PathManager needs the app and potentially settings for paths
    // Its structure JSON and backups will be in summaryFolder.
    this._pathManager = new PathManager(
       app,
       `${settings.summaryFolder}/path_structure.json`, 
       `${settings.summaryFolder}/path_structure_backups`
     );


    // Initialize DatabaseManager
    const dbPath = `${app.vault.configDir}/plugins/gpt4free-text-generator-plugin/transcripts.db`;
    this._databaseManager = new DatabaseManager(app, { dbPath });

    // Initialize LLM Client Service
    this._llmClientService = new LLMClientService(app, settings);
    this._llmClientService.initialize();

    // Initialize FlashcardManager
    this._flashcardManager = new FlashcardManager(app, settings, this._llmClientService);

    this._spacedRepetitionScheduler = new SpacedRepetitionScheduler({
      gradeZeroReaskDelay: settings.spacedRepetition.gradeZeroReaskDelay
    });
    this._spacedRepetitionGenerator = new SpacedRepetitionGenerator(this._llmClientService);

    if (settings.spacedRepetition.enabled) {
      this._spacedRepetitionDatabase = new SpacedRepetitionDatabase(app, {
        dbPath: settings.spacedRepetition.databasePath,
        wasmPath: `${app.vault.configDir}/plugins/gpt4free-text-generator-plugin/sql-wasm.wasm`
      });
    }

    // Initialize managers that depend on core services, passing dependencies
    this._transcriptManager = new TranscriptManager(app, this._fileManager, this._tagManager, this._pathManager, this._databaseManager, this._settings, this._llmClientService);
    this._articleManager = new ArticleManager(app, this._fileManager, this._tagManager, this._llmClientService); // Pass TagManager and LLMClientService to ArticleManager
    
    this._hierarchyManager = new HierarchyManager(this.plugin, this._pathManager, this._transcriptManager, this._llmClientService);
    
    // VideoQueueManager needs TranscriptManager, Plugin, and App
    // Initialize it later as it might depend on plugin initialization state
  }
  
  /**
   * Initialize all services that require async initialization
   */
  public async initializeServices(): Promise<void> {
    // Initialize the path manager (loads structure into cache)
    await this._pathManager.initialize();
    
    // Initialize the database manager
    if (this._databaseManager) {
      try {
        await this._databaseManager.initialize();
      } catch (error) {
        console.error("Failed to initialize database manager:", error);
        // Allow plugin to work without database
      }
    }
    
     // TagManager initialization (loading custom tags) is handled within its constructor's async call.
     // We don't need to await it here unless the UI or logic immediately depends on loaded custom tags.

    if (this._spacedRepetitionDatabase) {
      try {
        await this._spacedRepetitionDatabase.initialize();
      } catch (error) {
        console.error("Failed to initialize spaced repetition database:", error);
      }
    }
  }
  
  /**
   * Initialize services that depend on the plugin being fully initialized
   * Call this after plugin initialization is complete
   */
  public initializeVideoQueueManager(): void {
    if (!this._videoQueueManager) {
      this._videoQueueManager = new VideoQueueManager(
        this.app, 
        this.plugin, 
        this._transcriptManager,
        this._hierarchyManager
      );
    }
  }
  
  // Getters for services
  public get fileManager(): FileManager {
    return this._fileManager;
  }

   public get tagManager(): TagManager {
       return this._tagManager;
   }
  
  public get transcriptManager(): TranscriptManager {
    return this._transcriptManager;
  }
  
  public get articleManager(): ArticleManager {
    return this._articleManager;
  }
  
  public get videoQueueManager(): VideoQueueManager {
    if (!this._videoQueueManager) {
      // This indicates a design issue if it's accessed before initializeVideoQueueManager()
      throw new Error("VideoQueueManager not initialized. Call initializeVideoQueueManager() after plugin load.");
    }
    return this._videoQueueManager;
  }
  
  public get pathManager(): PathManager {
    return this._pathManager;
  }

  public get hierarchyManager(): HierarchyManager {
    return this._hierarchyManager;
  }

  public get databaseManager(): DatabaseManager | null {
    return this._databaseManager;
  }

  public get llmClientService(): LLMClientService {
    return this._llmClientService;
  }

  public get flashcardManager(): FlashcardManager {
    return this._flashcardManager;
  }

  public get spacedRepetitionDatabase(): SpacedRepetitionDatabase | null {
    return this._spacedRepetitionDatabase;
  }

  public get spacedRepetitionScheduler(): SpacedRepetitionScheduler {
    return this._spacedRepetitionScheduler;
  }

  public get spacedRepetitionGenerator(): SpacedRepetitionGenerator {
    return this._spacedRepetitionGenerator;
  }

  public async ensureSpacedRepetitionDatabase(): Promise<SpacedRepetitionDatabase> {
    if (!this._spacedRepetitionDatabase) {
      this._spacedRepetitionDatabase = new SpacedRepetitionDatabase(this.app, {
        dbPath: this._settings.spacedRepetition.databasePath,
        wasmPath: `${this.app.vault.configDir}/plugins/gpt4free-text-generator-plugin/sql-wasm.wasm`
      });
    }

    await this._spacedRepetitionDatabase.initialize();
    return this._spacedRepetitionDatabase;
  }
  
  /**
   * Update settings when they change
   */
  public updateSettings(settings: PluginSettings): void {
    this._settings = settings;
    
    // Update LLM client service
    this._llmClientService.updateSettings(settings);
    
    // Update FlashcardManager
    this._flashcardManager.updateSettings(settings);

    this._spacedRepetitionScheduler = new SpacedRepetitionScheduler({
      gradeZeroReaskDelay: settings.spacedRepetition.gradeZeroReaskDelay
    });

    
    // Update ErrorHandler debug mode
    ErrorHandler.setDebugMode(settings.debugMode || false);
    
    // If settings affect service configuration (like folder paths for PathManager's JSON/backups),
    // the service might need a specific update method or re-initialization.
    // Re-initializing PathManager here would lose its cached structure.
    // A better approach is to add specific update methods to managers for relevant settings.
    // For now, relying on managers using settings passed into their methods is simpler.
    if (this._pathManager) {
         // If structurePath or backupFolder were dependent on settings:
          // this._pathManager.updatePaths(settings.summaryFolder); // requires updatePaths method
          // If rootPath was dependent:
          // this._pathManager.setRootPath(settings.someOtherPathSetting);
      }
       // If TagManager path was dependent on settings:
      // this._tagManager.updatePath(settings.someTagPathSetting); // requires updatePath method
  }
  
  /**
   * Clean up resources when plugin is unloaded.
   * Ensures services that need explicit cleanup (like saving state) are handled.
   */
  public async destroy(): Promise<void> {
    // Clean up any resources that need to be released
    this._videoQueueManager = null;

    // Save TagManager state
    await this._tagManager.destroy();

    // Close database connection
    if (this._databaseManager) {
      await this._databaseManager.close();
    }

    if (this._spacedRepetitionDatabase) {
      await this._spacedRepetitionDatabase.close();
    }

    // Other managers currently don't hold resources needing explicit destroy
    // PathManager doesn't need explicit destroy (saving is handled internally)
     console.log("Plugin Services Destroyed.");
  }
}
