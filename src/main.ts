import { Plugin, WorkspaceLeaf, Notice, TFile, Editor, MarkdownView, MarkdownFileInfo, normalizePath } from 'obsidian';
import { VIEW_TYPE_GENERATE_TEXT, VIEW_TYPE_GENERATE_IMAGE, VIEW_TYPE_SPACED_REPETITION_REVIEW, DEFAULT_SETTINGS } from './constants';
import { PluginSettings } from './types';
import { GenerateTextView } from './views/GenerateTextView';
import { GenerateImageView } from './views/GenerateImageView';
import { VideoProcessingView, VIEW_TYPE_VIDEO_PROCESSING } from './views/VideoProcessingView';
import { TranscriptRequestModal } from './modals/TranscriptRequestModal';
import { VideoSummaryModal } from './modals/VideoSummaryModal';
import { PlaylistSummaryModal } from './modals/PlaylistSummaryModal';
import { TranscriptViewerModal } from './modals/TranscriptViewerModal';
import { SettingTab } from './settings/SettingTab';
import { TranscriptManager } from './utils/TranscriptManager';
import { ErrorHandler } from './utils/ErrorHandler';
import { ArticleManager } from './utils/ArticleManager';
import { ArticleRequestModal } from './modals/ArticleRequestModal';
import { VideoQueueManager } from './utils/VideoQueueManager';
import { PluginServices } from './utils/PluginServices';
import { AddDomainModal } from './modals/AddDomainModal';
import { InitializePathStructureModal } from './modals/InitializePathStructureModal';
import { AddSubjectModal } from './modals/AddSubjectModal';
import { AddTopicModal } from './modals/AddTopicModal';
import { AddSeriesModal } from './modals/AddSeriesModal';
// Import the new modals
import { AddAuthorModal } from './modals/AddAuthorModal';
import { AddContentModal } from './modals/AddContentModal';
import { LocalTranscriptRequestModal } from './modals/LocalTranscriptRequestModal'; // Import the new modal
import { TranscriptNoteScanner } from './utils/TranscriptNoteScanner'; // Import the scanner
import { DatabaseMigrationTool } from './utils/DatabaseMigrationTool'; // Import the migration utility
import { NoteDeleter } from './utils/NoteDeleter'; // Import the note deleter
import { StandaloneTranscriptCleanupModal } from './modals/StandaloneTranscriptCleanupModal'; // Import the cleanup modal
import { QuickQueryModal } from './modals/QuickQueryModal'; // Import the QuickQueryModal
import { QuizGeneratorModal } from './modals/QuizGeneratorModal'; // Import the QuizGeneratorModal
import { FlashcardGeneratorModal } from './modals/FlashcardGeneratorModal'; // Import the FlashcardGeneratorModal
import { COMMAND_CHEATSHEET_NOTE_PATH, renderCommandCheatsheet } from './commandCatalog';
import { SpacedRepetitionReviewView } from './views/SpacedRepetitionReviewView';
import { SpacedRepetitionManualQuestionModal } from './modals/SpacedRepetitionManualQuestionModal';
import { SpacedRepetitionGenerateQuestionsModal } from './modals/SpacedRepetitionGenerateQuestionsModal';
import { SpacedRepetitionNoteChatModal } from './modals/SpacedRepetitionNoteChatModal';

import './styles/styles.css';

export default class GptFreeTextGeneratorPlugin extends Plugin {
  settings!: PluginSettings;
  services!: PluginServices;
  
  async onload() {
    // First load settings
    await this.loadSettings();
    
    // Initialize services (includes PathManager and TagManager async init)
    this.services = new PluginServices(this.app, this, this.settings);
    
    // Initialize async services that need `await`
    await this.services.initializeServices();

    // Add settings tab
    this.addSettingTab(new SettingTab(this.app, this));

    // Register views
    this.registerView(VIEW_TYPE_GENERATE_TEXT, (leaf) => new GenerateTextView(leaf, this));
    this.registerView(VIEW_TYPE_GENERATE_IMAGE, (leaf) => new GenerateImageView(leaf, this));
    this.registerView(VIEW_TYPE_VIDEO_PROCESSING, (leaf) => new VideoProcessingView(leaf, this));
    this.registerView(VIEW_TYPE_SPACED_REPETITION_REVIEW, (leaf) => new SpacedRepetitionReviewView(leaf, this));

    // Initialize VideoQueueManager after plugin is fully initialized
    // It depends on TranscriptManager which might be doing async work internally
    // but its constructor should be synchronous with dependencies provided.
    // initializeVideoQueueManager is now just about creating the instance.
    this.services.initializeVideoQueueManager();

    // Add ribbon icons
    this.addRibbonIcon("pencil", "Open Text Generator", () => {
      this.activateView(VIEW_TYPE_GENERATE_TEXT);
    });

    this.addRibbonIcon("image", "Open Image Generator", () => {
      this.activateView(VIEW_TYPE_GENERATE_IMAGE);
    });

    this.addRibbonIcon("book-open", "Summarize Article", () => {
      const modal = new ArticleRequestModal(this.app, this);
      modal.open();
    });

    // Add new ribbon icon for playlist summarization
    this.addRibbonIcon("list-video", "Batch Video Summarization", () => {
      const modal = new PlaylistSummaryModal(this.app, this);
      modal.open();
    });
    
    // Add ribbon icon for video processing view
    this.addRibbonIcon("video", "Video Processing Queue", () => {
      this.activateVideoProcessingView();
    });

    // Add ribbon icon for adding content to path structure (e.g., linking a summary)
    this.addRibbonIcon("link", "Link Content to Path", () => {
      const modal = new AddContentModal(this.app, this);
      modal.open();
    });
    
    // Add ribbon icon for processing local transcripts
    this.addRibbonIcon("file-text", "Process Local Transcript", () => {
      const modal = new LocalTranscriptRequestModal(
        this.app,
        this,
        this.services.transcriptManager,
        this.services.fileManager,
        this.services.hierarchyManager
      );
      modal.open();
    });

    // Add ribbon icon for flashcard generation
    this.addRibbonIcon("layers", "Generate Flashcards", () => {
      const modal = new FlashcardGeneratorModal(this.app, this);
      modal.open();
    });


    this.addCommands();
    this.addMenuItems();
     // Add path structure management commands
    this.addPathCommands();
  }

  // Getter methods to maintain backward compatibility (optional, can be removed if services are accessed directly)
  // Note: Accessing services via plugin.services is the preferred pattern now.
  // Keeping these might cause confusion. Consider removing in a refactor.
  get transcriptManager(): TranscriptManager {
    return this.services.transcriptManager;
  }
  
  get articleManager(): ArticleManager {
    return this.services.articleManager;
  }
  
  get videoQueueManager(): VideoQueueManager {
    return this.services.videoQueueManager;
  }

  private addPathCommands() {
    this.addCommand({
      id: 'initialize-path-structure',
      name: 'Initialize Path Structure',
      callback: () => {
        const modal = new InitializePathStructureModal(this.app, this);
        modal.open();
      }
    });
    this.addCommand({
      id: 'add-domain',
      name: 'Add New Knowledge Domain',
      callback: () => {
        const modal = new AddDomainModal(this.app, this);
        modal.open();
      }
    });
    this.addCommand({
      id: 'add-subject',
      name: 'Add New Subject to Domain',
      callback: () => {
        const modal = new AddSubjectModal(this.app, this);
        modal.open();
      }
    });
    this.addCommand({
      id: 'add-topic',
      name: 'Add New Topic to Subject',
      callback: () => {
        const modal = new AddTopicModal(this.app, this);
        modal.open();
      }
    });
    this.addCommand({
      id: 'add-series',
      name: 'Add New Series to Topic',
      callback: () => {
        const modal = new AddSeriesModal(this.app, this);
        modal.open();
      }
    });
    // Add new commands for Author and Content
    this.addCommand({
      id: 'add-author',
      name: 'Add New Author to Series',
      callback: () => {
        const modal = new AddAuthorModal(this.app, this);
        modal.open();
      }
    });
     this.addCommand({
      id: 'link-content',
      name: 'Link Existing Content File',
      callback: () => {
        const modal = new AddContentModal(this.app, this);
        modal.open();
      }
    });

    this.addCommand({
      id: 'create-path-backup',
      name: 'Create Path Structure Backup',
      callback: async () => {
        try {
          const backupPath = await this.services.pathManager.createBackup();
          new Notice(`Backup created: ${backupPath}`);
        } catch (error) {
          new Notice(`Failed to create backup: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      }
    });
    // Optional: Add a command to restore from backup
    // This would require a modal to select a backup file.
    /*
    this.addCommand({
        id: 'restore-path-backup',
        name: 'Restore Path Structure from Backup',
        callback: () => {
            // Implement a modal to select a backup file (similar to HistoryLoaderModal)
            // then call this.services.pathManager.restoreFromBackup(selectedBackupPath);
            new Notice("Restore backup command not fully implemented yet.");
        }
    });
    */
     // Optional: Add a command to rebuild index files if they get out of sync
     /*
     this.addCommand({
         id: 'rebuild-path-index-files',
         name: 'Rebuild Path Structure Index Files',
         callback: async () => {
             new Notice("Rebuilding index files...");
             try {
                 // PathManager would need a method to traverse the structure
                 // and recreate/update all the MD files based on the current JSON state.
                 // This is complex. For now, adding new entities auto-updates parent.
                 // Re-initializing might partly achieve this but has side effects.
                 // await this.services.pathManager.rebuildIndexFiles(); // Needs implementation
                 new Notice("Rebuild command not fully implemented yet.");
             } catch (error) {
                 new Notice(`Failed to rebuild index files: ${error instanceof Error ? error.message : 'Unknown error'}`);
             }
         }
     });
     */
  }

  private addCommands() {
    this.addCommand({
      id: 'create-command-cheatsheet',
      name: 'Create/Update Plugin Commands Cheatsheet',
      callback: () => this.createOrUpdateCommandCheatsheet(),
    });

    this.addCommand({
      id: 'add-manual-spaced-repetition-question',
      name: 'Add Manual Spaced Repetition Question',
      callback: () => {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) {
          new Notice('No active note');
          return;
        }

        new SpacedRepetitionManualQuestionModal(this.app, this, activeFile).open();
      },
    });

    this.addCommand({
      id: 'generate-spaced-repetition-from-current-note',
      name: 'Generate Spaced Repetition Questions From Current Note',
      callback: () => {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) {
          new Notice('No active note');
          return;
        }

        new SpacedRepetitionGenerateQuestionsModal(this.app, this, activeFile).open();
      },
    });

    this.addCommand({
      id: 'open-spaced-repetition-review',
      name: 'Open Spaced Repetition Review',
      callback: () => this.activateView(VIEW_TYPE_SPACED_REPETITION_REVIEW),
    });

    this.addCommand({
      id: 'chat-with-current-note-ollama',
      name: 'Chat With Current Note Using Ollama',
      callback: () => {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) {
          new Notice('No active note');
          return;
        }

        new SpacedRepetitionNoteChatModal(this.app, this, activeFile).open();
      },
    });

    // Text Generator command
    this.addCommand({
      id: "open-text-generator-panel",
      name: "Open Text Generator Panel",
      callback: () => this.activateView(VIEW_TYPE_GENERATE_TEXT),
    });

    // Image Generator command
    this.addCommand({
      id: "open-image-generator-panel",
      name: "Open Image Generator Panel",
      callback: () => this.activateView(VIEW_TYPE_GENERATE_IMAGE),
    });

    // Transcript command
    this.addCommand({
      id: 'request-transcript',
      name: 'Request Video Transcript',
      callback: () => {
        const modal = new TranscriptRequestModal(this.app, this);
        modal.open();
      }
    });

    // Video Summary command
    this.addCommand({
      id: 'create-video-summary',
      name: 'Create Video Summary',
      callback: () => {
        const modal = new VideoSummaryModal(this.app, this);
        modal.open();
      }
    });

    // Batch Video Summary command
    this.addCommand({
      id: 'batch-video-summary',
      name: 'Batch Video Summarization',
      callback: () => {
        const modal = new PlaylistSummaryModal(this.app, this);
        modal.open();
      }
    });
    
    // Video Processing View command
    this.addCommand({
      id: 'video-processing-queue',
      name: 'Open Video Processing Queue',
      callback: () => this.activateVideoProcessingView(),
    });

    // Add Article commands
    this.addCommand({
      id: 'request-article-summary',
      name: 'Summarize Web Article',
      callback: () => {
        const modal = new ArticleRequestModal(this.app, this);
        modal.open();
      }
    });

    // Add command for processing local transcripts
    this.addCommand({
      id: 'process-local-transcript',
      name: 'Process Local Transcript File',
      callback: () => {
        const modal = new LocalTranscriptRequestModal(
          this.app,
          this,
          this.services.transcriptManager,
          this.services.fileManager,
          this.services.hierarchyManager
        );
        modal.open();
      }
    });

    // Add command to view transcript from database
    this.addCommand({
      id: 'view-transcript-from-database',
      name: 'View Transcript from Database',
      callback: () => {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) {
          new Notice('No active file');
          return;
        }
        
        const modal = new TranscriptViewerModal(this.app, this, {
          noteTitle: activeFile.basename,
          notePath: activeFile.path
        });
        modal.open();
      }
    });

    // Add tag commands
    this.addCommand({
      id: 'init-tags',
      name: 'Init=tags',
      callback: () => {
        this.services.tagManager.initializeTags();
        
        new Notice(`tags: ${this.services.tagManager.getAllManagedTags()}`);
      }
    });

    // Add command to scan vault for transcript notes
    this.addCommand({
      id: 'scan-vault-transcript-notes',
      name: 'Scan Vault for AI-Generated Notes with Transcripts',
      callback: async () => {
        try {
          const scanner = new TranscriptNoteScanner(this.app);
          new Notice('Scanning vault for AI-generated notes with transcripts...');
          
          const result = await scanner.scanVault();
          scanner.displayResults(result);
        } catch (error) {
          console.error('Failed to scan vault:', error);
          new Notice('Failed to scan vault. Check console for details.');
        }
      }
    });

    // Add command to migrate all transcripts to database
    this.addCommand({
      id: 'migrate-transcripts-to-database',
      name: 'Migrate All Transcripts to Database',
      callback: async () => {
        try {
          if (!this.services.databaseManager) {
            new Notice('Database manager not available');
            return;
          }

          const confirmMsg = 'This will move all embedded transcripts to the database and update the notes. Continue?';
          if (!confirm(confirmMsg)) {
            return;
          }

          new Notice('Starting transcript migration...');
          const migration = new DatabaseMigrationTool(this.app, this.services.databaseManager);
          const result = await migration.migrateAllNotes();
          migration.displayResults(result);
        } catch (error) {
          console.error('Failed to migrate transcripts:', error);
          new Notice('Failed to migrate transcripts. Check console for details.');
        }
      }
    });

    // Add command to migrate descriptions to database
    this.addCommand({
      id: 'migrate-descriptions-to-database',
      name: 'Migrate Descriptions to Database',
      callback: async () => {
        try {
          if (!this.services.databaseManager) {
            new Notice('Database manager not available');
            return;
          }

          const confirmMsg = 'This will move all descriptions from notes to the database and update the notes. Continue?';
          if (!confirm(confirmMsg)) {
            return;
          }

          new Notice('Starting description migration...');
          const migration = new DatabaseMigrationTool(this.app, this.services.databaseManager);
          const result = await migration.migrateDescriptions();
          migration.displayResults(result, 'descriptions');
        } catch (error) {
          console.error('Failed to migrate descriptions:', error);
          new Notice('Failed to migrate descriptions. Check console for details.');
        }
      }
    });

    // Add command to migrate detailed summaries to database
    this.addCommand({
      id: 'migrate-detailed-summaries-to-database',
      name: 'Migrate Detailed Summaries to Database',
      callback: async () => {
        try {
          if (!this.services.databaseManager) {
            new Notice('Database manager not available');
            return;
          }

          const confirmMsg = 'This will move all detailed summaries from notes to the database and update the notes. Continue?';
          if (!confirm(confirmMsg)) {
            return;
          }

          new Notice('Starting detailed summaries migration...');
          const migration = new DatabaseMigrationTool(this.app, this.services.databaseManager);
          const result = await migration.migrateDetailedSummaries();
          migration.displayResults(result, 'detailed summaries');
        } catch (error) {
          console.error('Failed to migrate detailed summaries:', error);
          new Notice('Failed to migrate detailed summaries. Check console for details.');
        }
      }
    });

    // Add command to clean up standalone transcript files
    this.addCommand({
      id: 'cleanup-standalone-transcripts',
      name: 'Clean Up Standalone Transcript Files',
      callback: async () => {
        try {
          const scanner = new TranscriptNoteScanner(this.app);
          new Notice('Scanning for standalone transcript files...');
          
          const result = await scanner.scanVault();
          
          const totalFiles = result.standaloneTranscriptFiles + result.legacyTranscriptFiles;
          if (totalFiles === 0) {
            new Notice('No transcript files found to clean up.');
            return;
          }

          // Show modal with both standalone and legacy files
          const modal = new StandaloneTranscriptCleanupModal(
            this.app,
            result.standaloneTranscriptPaths,
            result.legacyTranscriptPaths,
            async (filesToDelete: string[]) => {
              if (!this.services.databaseManager) {
                new Notice('Database manager not available');
                return;
              }

              const deleter = new NoteDeleter(this.app, this.services.databaseManager);
              new Notice(`Deleting ${filesToDelete.length} file(s)...`);
              
              const deleteResult = await deleter.deleteMultipleNotesWithCleanup(filesToDelete);
              deleter.displayResults(deleteResult.results);
            }
          );
          modal.open();
        } catch (error) {
          console.error('Failed to clean up standalone transcripts:', error);
          new Notice('Failed to clean up standalone transcripts. Check console for details.');
        }
      }
    });

    // Add command to delete current note with database cleanup
    this.addCommand({
      id: 'delete-note-with-database-cleanup',
      name: 'Delete Current Note (with Database Cleanup)',
      callback: async () => {
        try {
          const activeFile = this.app.workspace.getActiveFile();
          if (!activeFile) {
            new Notice('No active file');
            return;
          }

          if (!this.services.databaseManager) {
            new Notice('Database manager not available');
            return;
          }

          const confirmMsg = `Are you sure you want to delete "${activeFile.basename}"? This will also remove any associated database records.`;
          if (!confirm(confirmMsg)) {
            return;
          }

          const deleter = new NoteDeleter(this.app, this.services.databaseManager);
          const result = await deleter.deleteNoteWithCleanup(activeFile.path);
          deleter.displayResults(result);
        } catch (error) {
          console.error('Failed to delete note:', error);
          new Notice('Failed to delete note. Check console for details.');
        }
      }
    });

    // Add Quick Query command
    this.addCommand({
      id: 'quick-context-query',
      name: 'Quick Query (Current Note Context)',
      hotkeys: [{ modifiers: ["Mod", "Shift"], key: "Q" }],
      editorCallback: (editor: Editor, view: MarkdownView | MarkdownFileInfo) => {
        new QuickQueryModal(this.app, this).open();
      }
    });

    // Add Quiz Generator command
    this.addCommand({
      id: 'generate-quiz',
      name: 'Generate Quiz from Context',
      callback: () => {
        const modal = new QuizGeneratorModal(this.app, this);
        modal.open();
      }
    });

    // Add Flashcard Generator command
    this.addCommand({
      id: 'generate-flashcards',
      name: 'Generate Flashcards from Context',
      callback: () => {
        const modal = new FlashcardGeneratorModal(this.app, this);
        modal.open();
      }
    });
  }

  private addMenuItems() {
    // Register menu items for retrieving content from database
    this.registerEvent(
      this.app.workspace.on('file-menu', (menu, file) => {
        if (file instanceof TFile && file.extension === 'md') {
          // Check if file has database-stored content
          const hasDatabaseContent = this.checkForDatabaseContent(file);
          
          if (hasDatabaseContent) {
            menu.addItem((item) => {
              item.setTitle('View Transcript from Database')
                .setIcon('file-text')
                .onClick(async () => {
                  const modal = new TranscriptViewerModal(this.app, this, {
                    noteTitle: file.basename,
                    notePath: file.path,
                    defaultTab: 'transcript'
                  });
                  modal.open();
                });
            });

            menu.addItem((item) => {
              item.setTitle('View Description from Database')
                .setIcon('info')
                .onClick(async () => {
                  const modal = new TranscriptViewerModal(this.app, this, {
                    noteTitle: file.basename,
                    notePath: file.path,
                    defaultTab: 'description'
                  });
                  modal.open();
                });
            });

            menu.addItem((item) => {
              item.setTitle('View Detailed Summaries from Database')
                .setIcon('list')
                .onClick(async () => {
                  const modal = new TranscriptViewerModal(this.app, this, {
                    noteTitle: file.basename,
                    notePath: file.path,
                    defaultTab: 'summaries'
                  });
                  modal.open();
                });
            });
          }
        }
      })
    );
  }

  private checkForDatabaseContent(file: TFile): boolean {
    // Check if the note file contains database indicator text
    const indicators = [
      '*Transcript is stored in database',
      '*Description is stored in database',
      '*Detailed summaries are stored in database'
    ];
    
    // We can't read the file synchronously, so we'll check the file content asynchronously
    // For now, return true and let the modal handle the check
    return true;
  }

  private async createOrUpdateCommandCheatsheet() {
    const notePath = normalizePath(COMMAND_CHEATSHEET_NOTE_PATH);
    const content = renderCommandCheatsheet();

    try {
      const existingFile = this.app.vault.getAbstractFileByPath(notePath);
      let file: TFile;

      if (existingFile instanceof TFile) {
        await this.app.vault.modify(existingFile, content);
        file = existingFile;
      } else {
        file = await this.app.vault.create(notePath, content);
      }

      await this.app.workspace.getLeaf(false).openFile(file);
      new Notice(`Updated command cheatsheet: ${notePath}`);
    } catch (error) {
      console.error('Failed to create command cheatsheet:', error);
      new Notice(`Failed to create command cheatsheet: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
  
  // Keeping for backward compatibility or specific use cases, but services.transcriptManager is preferred
  // Note: This method is deprecated. Use plugin.services.transcriptManager instead.
  getTranscriptManager(): TranscriptManager {
    return this.services.transcriptManager;
  }

  async loadSettings() {
    // NOTE: loadData() and saveData() are Obsidian Plugin base class methods
    // They automatically read/write to 'data.json' in the plugin folder
    // This file contains ALL plugin settings including:
    // - User preferences (folders, models, API keys)
    // - Cached OpenRouter models list (openRouterModels array)
    // - Last updated timestamps
    // This is NOT a manually managed file - it's Obsidian's automatic settings storage
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    
    // Ensure new OpenRouter settings have default values if not present
    this.settings.openRouterApiKey = this.settings.openRouterApiKey ?? DEFAULT_SETTINGS.openRouterApiKey;
    this.settings.openRouterModels = this.settings.openRouterModels ?? DEFAULT_SETTINGS.openRouterModels;
    this.settings.lastUpdated = this.settings.lastUpdated ?? DEFAULT_SETTINGS.lastUpdated;
    this.settings.filterFreeModelsOnly = this.settings.filterFreeModelsOnly ?? DEFAULT_SETTINGS.filterFreeModelsOnly;
    this.settings.minContextLength = this.settings.minContextLength ?? DEFAULT_SETTINGS.minContextLength;
    this.settings.defaultBackend = this.settings.defaultBackend ?? DEFAULT_SETTINGS.defaultBackend; // Initialize defaultBackend
    this.settings.flashcardFolder = this.settings.flashcardFolder ?? DEFAULT_SETTINGS.flashcardFolder; // Initialize flashcardFolder
    this.settings.spacedRepetition = {
      ...DEFAULT_SETTINGS.spacedRepetition,
      ...(this.settings.spacedRepetition ?? {})
    };
    this.settings.providerTimeout = this.settings.providerTimeout && this.settings.providerTimeout > 60000
      ? this.settings.providerTimeout
      : DEFAULT_SETTINGS.providerTimeout;
    this.settings.providerRetryCount = this.settings.providerRetryCount ?? DEFAULT_SETTINGS.providerRetryCount;
    
    // Settings relevant to service initialization are passed in the constructor
    // of PluginServices during plugin's onload.
  }

  async saveSettings() {
    // Save all settings to data.json (Obsidian's automatic settings file)
    // This overwrites the entire file with current settings state
    await this.saveData(this.settings);
    
    // Update settings in services that hold internal settings state
    if (this.services) {
      this.services.updateSettings(this.settings);
       // If settings affect service configuration (like folder paths for PathManager's JSON/backups),
       // the service might need a specific update method or re-initialization.
       // Re-initializing PathManager here would lose its cached structure.
       // A better approach is to add specific update methods to managers for relevant settings.
       // For now, relying on managers using settings passed into their methods is simpler.
    }
  }

  async activateView(viewType: string) {
    try {
      const existing = this.app.workspace.getLeavesOfType(viewType);
      if (existing.length > 0) {
        this.app.workspace.revealLeaf(existing[0]);
        return;
      }

      let leaf = this.app.workspace.getRightLeaf(false);
      if (!leaf) {
        // Fallback to creating a new leaf if no right leaf exists or is obtainable
        const activeLeaf = this.app.workspace.getLeaf();
        if (!activeLeaf) {
          // If no active leaf, get a new leaf pane
           leaf = this.app.workspace.getLeaf(true); // true means 'into a new pane'
        } else {
          // If there's an active leaf, split it vertically
           leaf = this.app.workspace.createLeafBySplit(activeLeaf, 'vertical');
        }
      }


      await leaf.setViewState({
        type: viewType,
        active: true,
      });

      this.app.workspace.revealLeaf(leaf);
    } catch (error: unknown) {
      ErrorHandler.handleError(error, "VIEW_ACTIVATION_ERROR", { // More specific category
        operation: "activate-view",
        viewType
      });
       // Also show a user-friendly notice
       new Notice(`Failed to open view: ${viewType}`);
    }
  }
  
  async activateVideoProcessingView() {
    await this.activateView(VIEW_TYPE_VIDEO_PROCESSING);
  }

  onunload() {
    // Clean up services and views
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_GENERATE_TEXT);
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_GENERATE_IMAGE);
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_VIDEO_PROCESSING);
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_SPACED_REPETITION_REVIEW);

    if (this.services) {
      this.services.destroy(); // Custom cleanup for services
    }
    
    // Obsidian automatically handles unregistering views, commands, settings tab, ribbon icons
  }
}
