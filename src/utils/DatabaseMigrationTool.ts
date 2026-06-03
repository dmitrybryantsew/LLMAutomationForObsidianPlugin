import { App, TFile, Notice } from "obsidian";
import { DatabaseManager, TranscriptRecord } from "../database/DatabaseManager";
import { ErrorHandler } from "./ErrorHandler";
import { sanitizeForMetadata } from "./helpers";

interface MigrationResult {
    totalProcessed: number;
    successfulMigrations: number;
    failedMigrations: number;
    skippedMigrations: number;
    errors: Array<{ path: string; error: string }>;
}

interface NoteDataExtraction {
    transcriptContent: string;
    description?: string;
    detailedSummaries?: string[];
    videoUrl?: string;
    videoTitle?: string;
    videoChannel?: string;
}

class DatabaseMigrationTool {
    private app: App;
    private databaseManager: DatabaseManager;

    constructor(app: App, databaseManager: DatabaseManager) {
        this.app = app;
        this.databaseManager = databaseManager;
    }

    /**
     * Migrates all notes with embedded transcripts to the database
     * Also migrates descriptions and detailed summaries if present
     */
    async migrateAllNotes(): Promise<MigrationResult> {
        const result: MigrationResult = {
            totalProcessed: 0,
            successfulMigrations: 0,
            failedMigrations: 0,
            skippedMigrations: 0,
            errors: []
        };

        try {
            const allFiles = this.app.vault.getMarkdownFiles();
            
            for (const file of allFiles) {
                const content = await this.app.vault.read(file);
                
                // Check if note has embedded transcript
                if (this.hasEmbeddedTranscript(content)) {
                    result.totalProcessed++;
                    
                    try {
                        // Check if transcript is already in database
                        const existingRecord = await this.databaseManager.getTranscript(
                            file.basename,
                            file.path
                        );

                        // Extract note data (transcript, description, detailed summaries)
                        const extraction = this.extractNoteData(content);
                         
                        if (!extraction.transcriptContent) {
                            result.failedMigrations++;
                            result.errors.push({
                                path: file.path,
                                error: "Could not extract transcript content"
                            });
                            continue;
                        }

                        if (existingRecord) {
                            // Note already has transcript - check if we need to migrate description/summaries
                            const needsUpdate =
                                (!existingRecord.description && extraction.description) ||
                                (!existingRecord.detailed_summaries && extraction.detailedSummaries);
                            
                            if (needsUpdate) {
                                // Update existing record with description and/or detailed summaries
                                const updates: Partial<TranscriptRecord> = {};
                                if (extraction.description) {
                                    updates.description = extraction.description;
                                }
                                if (extraction.detailedSummaries) {
                                    updates.detailed_summaries = extraction.detailedSummaries;
                                }
                                
                                await this.databaseManager.updateTranscript(existingRecord.id!, updates);
                                
                                // Update note to remove description and detailed summaries sections
                                const updatedContent = this.updateNoteForDatabase(content);
                                await this.app.vault.modify(file, updatedContent);
                                
                                result.successfulMigrations++;
                                console.log(`Updated: ${file.path} (added description/summaries)`);
                            } else {
                                result.skippedMigrations++;
                                console.log(`Skipped: ${file.path} (already fully migrated)`);
                            }
                        } else {
                            // New migration - save everything to database
                            const record: TranscriptRecord = {
                                note_title: file.basename,
                                note_path: file.path,
                                transcript_content: extraction.transcriptContent,
                                description: extraction.description,
                                detailed_summaries: extraction.detailedSummaries,
                                video_url: extraction.videoUrl,
                                video_title: extraction.videoTitle,
                                video_channel: extraction.videoChannel
                            };

                            await this.databaseManager.saveTranscript(record);
                            
                            // Update note to remove transcript, description, and detailed summaries
                            const updatedContent = this.updateNoteForDatabase(content);
                            await this.app.vault.modify(file, updatedContent);
                            
                            result.successfulMigrations++;
                            console.log(`Migrated: ${file.path}`);
                        }
                        
                    } catch (error) {
                        result.failedMigrations++;
                        result.errors.push({
                            path: file.path,
                            error: error instanceof Error ? error.message : 'Unknown error'
                        });
                        console.error(`Failed to migrate ${file.path}:`, error);
                    }
                }
            }

            return result;
        } catch (error) {
            ErrorHandler.handleError(error, "DATABASE_ERROR", {
                operation: "migrate-all-transcripts"
            });
            throw error;
        }
    }

    /**
     * Checks if a note has an embedded transcript
     */
    private hasEmbeddedTranscript(content: string): boolean {
        // Look for the collapsible transcript section with actual content
        const transcriptSectionMatch = content.match(
            /##\s*(Full\s+)?Transcript\s*<details>[\s\S]*?<summary>Click to expand<\/summary>[\s\S]*?([\s\S]{50,})[\s\S]*?<\/details>/i
        );
        
        return transcriptSectionMatch !== null && transcriptSectionMatch[2].trim().length > 50;
    }

    /**
     * Extracts note data (transcript, description, detailed summaries) from note content
     */
    private extractNoteData(content: string): NoteDataExtraction {
        const extraction: NoteDataExtraction = {
            transcriptContent: ""
        };

        // Extract transcript content from collapsible section
        const transcriptMatch = content.match(
            /##\s*(Full\s+)?Transcript\s*<details>[\s\S]*?<summary>Click to expand<\/summary>\s*([\s\S]*?)\s*<\/details>/i
        );

        if (transcriptMatch && transcriptMatch[2]) {
            extraction.transcriptContent = transcriptMatch[2].trim();
        }

        // Extract video URL from YAML frontmatter - more robust regex
        const urlMatch = content.match(/^---[\s\S]*?video_url:\s*["']?(.+?)["']?[\r\n]/m);
        if (urlMatch && urlMatch[1]) {
            extraction.videoUrl = urlMatch[1].trim();
        }

        // Extract video title from YAML frontmatter - more robust regex
        const titleMatch = content.match(/^---[\s\S]*?title:\s*["']?(.+?)["']?[\r\n]/m);
        if (titleMatch && titleMatch[1]) {
            extraction.videoTitle = titleMatch[1].trim();
        }

        // Extract video channel from YAML frontmatter - more robust regex
        const channelMatch = content.match(/^---[\s\S]*?(?:author|channel):\s*["']?(.+?)["']?[\r\n]/m);
        if (channelMatch && channelMatch[1]) {
            extraction.videoChannel = channelMatch[1].trim();
        }

        // Extract description from collapsible section
        const descriptionMatch = content.match(
            /##\s*Description\s*<details>[\s\S]*?<summary>Click to expand<\/summary>\s*([\s\S]*?)\s*<\/details>/i
        );
        if (descriptionMatch && descriptionMatch[1]) {
            extraction.description = descriptionMatch[1].trim();
        }

        // Extract detailed summaries by part
        const detailedSummariesMatch = content.match(
            /##\s*Detailed\s+Summaries\s+by\s+Part\s*([\s\S]*?)(?=\n##|\n*$)/i
        );
        if (detailedSummariesMatch && detailedSummariesMatch[1]) {
            const summaries: string[] = [];
            const partMatches = detailedSummariesMatch[1].matchAll(
                /<details>[\s\S]*?<summary>Part\s+(\d+)<\/summary>\s*([\s\S]*?)\s*<\/details>/gi
            );
            for (const match of partMatches) {
                if (match[2]) {
                    summaries.push(match[2].trim());
                }
            }
            if (summaries.length > 0) {
                extraction.detailedSummaries = summaries;
            }
        }

        return extraction;
    }

    /**
     * Updates note content to remove transcript, description, and detailed summaries
     * Adds database indicators for each removed section
     */
    private updateNoteForDatabase(content: string): string {
        let updatedContent = content;

        // Replace the transcript section with database indicator
        updatedContent = updatedContent.replace(
            /##\s*(Full\s+)?Transcript\s*<details>[\s\S]*?<summary>Click to expand<\/summary>[\s\S]*?<\/details>/gi,
            "## Transcript\n*Transcript is stored in database. Click 'View Transcript' button to view.*\n\n"
        );

        // Replace the description section with database indicator (if it exists)
        updatedContent = updatedContent.replace(
            /##\s*Description\s*<details>[\s\S]*?<summary>Click to expand<\/summary>[\s\S]*?<\/details>/gi,
            "## Description\n*Description is stored in database. Click 'View Description' button to view.*\n\n"
        );

        // Replace the detailed summaries section with database indicator (if it exists)
        updatedContent = updatedContent.replace(
            /##\s*Detailed\s+Summaries\s+by\s+Part\s*[\s\S]*?<details>[\s\S]*?<\/details>[\s\S]*?(?=\n##|\n*$)/gi,
            "## Detailed Summaries by Part\n*Detailed summaries are stored in database. Click 'View Detailed Summaries' button to view.*\n\n"
        );

        return updatedContent;
    }

    /**
     * Migrates only descriptions from notes to the database
     * Updates existing records with description content
     */
    async migrateDescriptions(): Promise<MigrationResult> {
        const result: MigrationResult = {
            totalProcessed: 0,
            successfulMigrations: 0,
            failedMigrations: 0,
            skippedMigrations: 0,
            errors: []
        };

        try {
            const allFiles = this.app.vault.getMarkdownFiles();
            
            for (const file of allFiles) {
                const content = await this.app.vault.read(file);
                
                // Check if note has description section
                if (this.hasDescriptionSection(content)) {
                    result.totalProcessed++;
                    
                    try {
                        // Check if record exists in database
                        const existingRecord = await this.databaseManager.getTranscript(
                            file.basename,
                            file.path
                        );

                        if (!existingRecord) {
                            result.skippedMigrations++;
                            console.log(`Skipped: ${file.path} (no transcript record found)`);
                            continue;
                        }

                        // Check if description already exists
                        if (existingRecord.description) {
                            result.skippedMigrations++;
                            console.log(`Skipped: ${file.path} (description already in database)`);
                            continue;
                        }

                        // Extract description
                        const description = this.extractDescription(content);
                        
                        if (!description) {
                            result.failedMigrations++;
                            result.errors.push({
                                path: file.path,
                                error: "Could not extract description"
                            });
                            continue;
                        }

                        // Update record with description
                        await this.databaseManager.updateTranscript(existingRecord.id!, {
                            description: description
                        });
                        
                        // Update note to remove description section
                        const updatedContent = this.removeDescriptionSection(content);
                        await this.app.vault.modify(file, updatedContent);
                        
                        result.successfulMigrations++;
                        console.log(`Migrated description: ${file.path}`);
                        
                    } catch (error) {
                        result.failedMigrations++;
                        result.errors.push({
                            path: file.path,
                            error: error instanceof Error ? error.message : 'Unknown error'
                        });
                        console.error(`Failed to migrate description for ${file.path}:`, error);
                    }
                }
            }

            return result;
        } catch (error) {
            ErrorHandler.handleError(error, "DATABASE_ERROR", {
                operation: "migrate-descriptions"
            });
            throw error;
        }
    }

    /**
     * Migrates only detailed summaries from notes to the database
     * Updates existing records with detailed summaries content
     */
    async migrateDetailedSummaries(): Promise<MigrationResult> {
        const result: MigrationResult = {
            totalProcessed: 0,
            successfulMigrations: 0,
            failedMigrations: 0,
            skippedMigrations: 0,
            errors: []
        };

        try {
            const allFiles = this.app.vault.getMarkdownFiles();
            
            for (const file of allFiles) {
                const content = await this.app.vault.read(file);
                
                // Check if note has detailed summaries section
                if (this.hasDetailedSummariesSection(content)) {
                    result.totalProcessed++;
                    
                    try {
                        // Check if record exists in database
                        const existingRecord = await this.databaseManager.getTranscript(
                            file.basename,
                            file.path
                        );

                        if (!existingRecord) {
                            result.skippedMigrations++;
                            console.log(`Skipped: ${file.path} (no transcript record found)`);
                            continue;
                        }

                        // Check if detailed summaries already exist
                        if (existingRecord.detailed_summaries && existingRecord.detailed_summaries.length > 0) {
                            result.skippedMigrations++;
                            console.log(`Skipped: ${file.path} (detailed summaries already in database)`);
                            continue;
                        }

                        // Extract detailed summaries
                        const summaries = this.extractDetailedSummaries(content);
                        
                        if (!summaries || summaries.length === 0) {
                            result.failedMigrations++;
                            result.errors.push({
                                path: file.path,
                                error: "Could not extract detailed summaries"
                            });
                            continue;
                        }

                        // Update record with detailed summaries
                        await this.databaseManager.updateTranscript(existingRecord.id!, {
                            detailed_summaries: summaries
                        });
                        
                        // Update note to remove detailed summaries section
                        const updatedContent = this.removeDetailedSummariesSection(content);
                        await this.app.vault.modify(file, updatedContent);
                        
                        result.successfulMigrations++;
                        console.log(`Migrated detailed summaries: ${file.path}`);
                        
                    } catch (error) {
                        result.failedMigrations++;
                        result.errors.push({
                            path: file.path,
                            error: error instanceof Error ? error.message : 'Unknown error'
                        });
                        console.error(`Failed to migrate detailed summaries for ${file.path}:`, error);
                    }
                }
            }

            return result;
        } catch (error) {
            ErrorHandler.handleError(error, "DATABASE_ERROR", {
                operation: "migrate-detailed-summaries"
            });
            throw error;
        }
    }

    /**
     * Checks if a note has a description section
     */
    private hasDescriptionSection(content: string): boolean {
        const descriptionMatch = content.match(
            /##\s*Description\s*<details>[\s\S]*?<summary>Click to expand<\/summary>[\s\S]*?<\/details>/i
        );
        return descriptionMatch !== null;
    }

    /**
     * Checks if a note has a detailed summaries section
     */
    private hasDetailedSummariesSection(content: string): boolean {
        // Check for the section header and at least one details element
        const sectionMatch = content.match(/##\s*Detailed\s+Summaries\s+by\s+Part/i);
        if (!sectionMatch) return false;
        
        // Check if there are any <details> elements after the header
        const afterHeader = content.substring(sectionMatch.index!);
        const detailsMatch = afterHeader.match(/<details>/i);
        
        return detailsMatch !== null;
    }

    /**
     * Extracts description from note content
     */
    private extractDescription(content: string): string | null {
        const descriptionMatch = content.match(
            /##\s*Description\s*<details>[\s\S]*?<summary>Click to expand<\/summary>\s*([\s\S]*?)\s*<\/details>/i
        );
        if (descriptionMatch && descriptionMatch[1]) {
            return descriptionMatch[1].trim();
        }
        return null;
    }

    /**
     * Extracts detailed summaries from note content
     */
    private extractDetailedSummaries(content: string): string[] | null {
        // Find the section header
        const sectionMatch = content.match(/##\s*Detailed\s+Summaries\s+by\s+Part/i);
        if (!sectionMatch || sectionMatch.index === undefined) {
            return null;
        }
        
        // Get content after the header
        const afterHeader = content.substring(sectionMatch.index);
        
        // Find the next section header that's NOT inside a <details> block
        let sectionContent = afterHeader;
        let depth = 0;
        let pos = 0;
        
        while (pos < afterHeader.length) {
            // Check for opening <details>
            const openMatch = afterHeader.substring(pos).match(/<details>/i);
            if (openMatch && openMatch.index !== undefined) {
                depth++;
                pos += openMatch.index + openMatch[0].length;
                continue;
            }
            
            // Check for closing </details>
            const closeMatch = afterHeader.substring(pos).match(/<\/details>/i);
            if (closeMatch && closeMatch.index !== undefined) {
                depth--;
                pos += closeMatch.index + closeMatch[0].length;
                continue;
            }
            
            // Check for next section header only when depth is 0 (not inside <details>)
            if (depth === 0) {
                const nextSectionMatch = afterHeader.substring(pos).match(/\n##(?!\s*Detailed)/);
                if (nextSectionMatch && nextSectionMatch.index !== undefined) {
                    sectionContent = afterHeader.substring(0, pos + nextSectionMatch.index);
                    break;
                }
            }
            
            // Move to next character
            pos++;
        }
        
        console.log(`[DEBUG] Section content length: ${sectionContent.length}`);
        console.log(`[DEBUG] Section starts with: ${sectionContent.substring(0, 100)}...`);
        
        // Extract all <details> blocks with Part summaries
        const summaries: string[] = [];
        // More flexible regex to match summary with "Part X" pattern
        const detailsRegex = /<details>[\s\S]*?<summary>[\s\S]*?Part\s+\d+[\s\S]*?<\/summary>\s*([\s\S]*?)\s*<\/details>/gi;
        let match;
        
        while ((match = detailsRegex.exec(sectionContent)) !== null) {
            if (match[1]) {
                const summary = match[1].trim();
                console.log(`[DEBUG] Found summary part, length: ${summary.length}`);
                summaries.push(summary);
            }
        }
        
        console.log(`[DEBUG] Total summaries extracted: ${summaries.length}`);
        
        if (summaries.length > 0) {
            return summaries;
        }
        
        return null;
    }

    /**
     * Removes description section from note content
     */
    private removeDescriptionSection(content: string): string {
        return content.replace(
            /##\s*Description\s*<details>[\s\S]*?<summary>Click to expand<\/summary>[\s\S]*?<\/details>/gi,
            "## Description\n*Description is stored in database. Click 'View Description' button to view.*\n\n"
        );
    }

    /**
     * Removes detailed summaries section from note content
     */
    private removeDetailedSummariesSection(content: string): string {
        return content.replace(
            /##\s*Detailed\s+Summaries\s+by\s+Part\s*[\s\S]*?<details>[\s\S]*?<\/details>[\s\S]*?(?=\n##|\n*$)/gi,
            "## Detailed Summaries by Part\n*Detailed summaries are stored in database. Click 'View Detailed Summaries' button to view.*\n\n"
        );
    }

    /**
     * Displays migration results to the user
     */
    displayResults(result: MigrationResult, migrationType: string = "transcripts"): void {
        const message = `
📊 Database Migration Results (${migrationType}):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Total processed: ${result.totalProcessed}
✅ Successful: ${result.successfulMigrations}
⏭️  Skipped: ${result.skippedMigrations}
❌ Failed: ${result.failedMigrations}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        `.trim();

        console.log(message);
        new Notice(message, 10000);

        if (result.errors.length > 0) {
            console.error("Migration errors:");
            result.errors.forEach(err => {
                console.error(`  ${err.path}: ${err.error}`);
            });
        }
    }
}

export { DatabaseMigrationTool, MigrationResult, NoteDataExtraction };