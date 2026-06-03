import { App, TFile, Notice } from "obsidian";
import { DatabaseManager } from "../database/DatabaseManager";
import { ErrorHandler } from "./ErrorHandler";

interface DeleteResult {
    success: boolean;
    fileDeleted: boolean;
    databaseRecordDeleted: boolean;
    message: string;
}

class NoteDeleter {
    private app: App;
    private databaseManager: DatabaseManager;

    constructor(app: App, databaseManager: DatabaseManager) {
        this.app = app;
        this.databaseManager = databaseManager;
    }

    /**
     * Deletes a note and its associated database record (if exists)
     */
    async deleteNoteWithCleanup(filePath: string): Promise<DeleteResult> {
        const result: DeleteResult = {
            success: false,
            fileDeleted: false,
            databaseRecordDeleted: false,
            message: ""
        };

        try {
            // Get the file
            const file = this.app.vault.getAbstractFileByPath(filePath);
            
            if (!(file instanceof TFile)) {
                result.message = `File not found: ${filePath}`;
                return result;
            }

            const noteTitle = file.basename;

            // Check and delete database record
            const existingRecord = await this.databaseManager.getTranscript(noteTitle, filePath);
            
            if (existingRecord && existingRecord.id) {
                const deletedFromDb = await this.databaseManager.deleteTranscript(existingRecord.id);
                result.databaseRecordDeleted = deletedFromDb;
                
                if (deletedFromDb) {
                    console.log(`Deleted database record for: ${noteTitle}`);
                }
            }

            // Delete the file
            await this.app.vault.delete(file);
            result.fileDeleted = true;
            result.success = true;
            result.message = `Successfully deleted note: ${noteTitle}`;

            return result;
        } catch (error) {
            ErrorHandler.handleError(error, "FILE_OPERATION", {
                operation: "delete-note-with-cleanup",
                filePath
            });
            
            result.message = `Failed to delete note: ${error instanceof Error ? error.message : 'Unknown error'}`;
            return result;
        }
    }

    /**
     * Deletes multiple notes and their associated database records
     */
    async deleteMultipleNotesWithCleanup(filePaths: string[]): Promise<{
        successful: number;
        failed: number;
        results: DeleteResult[];
    }> {
        const results: DeleteResult[] = [];
        let successful = 0;
        let failed = 0;

        for (const filePath of filePaths) {
            const result = await this.deleteNoteWithCleanup(filePath);
            results.push(result);
            
            if (result.success) {
                successful++;
            } else {
                failed++;
            }
        }

        return { successful, failed, results };
    }

    /**
     * Displays deletion results to the user
     */
    displayResults(results: DeleteResult | DeleteResult[]): void {
        if (Array.isArray(results)) {
            const successful = results.filter(r => r.success).length;
            const failed = results.length - successful;
            
            const message = `
📊 Batch Deletion Results:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Total: ${results.length}
✅ Successful: ${successful}
❌ Failed: ${failed}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
            `.trim();

            console.log(message);
            new Notice(message, 10000);

            if (failed > 0) {
                console.error("Failed deletions:");
                results.filter(r => !r.success).forEach(r => {
                    console.error(`  ${r.message}`);
                });
            }
        } else {
            if (results.success) {
                new Notice(results.message);
                console.log(results.message);
            } else {
                new Notice(results.message, 5000);
                console.error(results.message);
            }
        }
    }
}

export { NoteDeleter, DeleteResult };