import { App, Notice } from "obsidian";
import { ErrorHandler } from "../utils/ErrorHandler";

interface TranscriptRecord {
    id?: number;
    note_title: string;
    note_path: string;
    transcript_content?: string; // Made optional to support selective storage
    video_url?: string;
    video_title?: string;
    video_channel?: string;
    description?: string; // New: Video description
    detailed_summaries?: string[]; // New: Array of part summaries
    created_at?: string;
    updated_at?: string;
}

interface DatabaseConfig {
    dbPath: string;
    maxSizeMB?: number;
}

class DatabaseManager {
    private db: any = null;
    private app: App;
    private config: DatabaseConfig;

    constructor(app: App, config: DatabaseConfig) {
        this.app = app;
        this.config = config;
    }

    async initialize(): Promise<void> {
        try {
            // Create database directory if it doesn't exist
            const dbDir = this.config.dbPath.split('/').slice(0, -1).join('/');
            if (!await this.app.vault.adapter.exists(dbDir)) {
                await this.app.vault.adapter.mkdir(dbDir);
            }

            // Initialize database file only if it doesn't exist
            const dbExists = await this.app.vault.adapter.exists(this.config.dbPath);
            if (!dbExists) {
                await this.app.vault.adapter.write(this.config.dbPath, JSON.stringify({
                    version: "2.0",
                    transcripts: [],
                    created_at: new Date().toISOString()
                }));
                new Notice("Database initialized successfully");
            } else {
                // Check if we need to migrate the database
                await this.migrateDatabaseIfNeeded();
            }
        } catch (error: unknown) {
            ErrorHandler.handleError(error, "DATABASE_ERROR", {
                operation: "initialize-database",
                dbPath: this.config.dbPath
            });
            throw error;
        }
    }

    private async migrateDatabaseIfNeeded(): Promise<void> {
        try {
            const data = await this.readDatabase();
            
            // Check if migration is needed (version < 2.0)
            if (data.version && data.version < "2.0") {
                console.log("Migrating database to version 2.0...");
                
                // Add new fields to existing records
                data.transcripts = data.transcripts.map((record: TranscriptRecord) => ({
                    ...record,
                    description: record.description || undefined,
                    detailed_summaries: record.detailed_summaries || undefined
                }));
                
                // Update version
                data.version = "2.0";
                data.migrated_at = new Date().toISOString();
                
                await this.writeDatabase(data);
                console.log("Database migration completed successfully");
            }
        } catch (error: unknown) {
            console.error("Database migration failed:", error);
            // Don't throw - allow the database to continue working
        }
    }

    async saveTranscript(record: TranscriptRecord): Promise<number> {
        try {
            const data = await this.readDatabase();
            
            // Sanitize the record data
            const sanitizedRecord = this.sanitizeRecord(record);
            
            // Generate unique ID
            const id = Date.now() + Math.floor(Math.random() * 1000);
            const newRecord = {
                ...sanitizedRecord,
                id,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            };

            data.transcripts.push(newRecord);
            await this.writeDatabase(data);

            return id;
        } catch (error: unknown) {
            ErrorHandler.handleError(error, "DATABASE_ERROR", {
                operation: "save-transcript",
                noteTitle: record.note_title
            });
            throw error;
        }
    }

    async getTranscript(noteTitle: string, notePath?: string): Promise<TranscriptRecord | null> {
        try {
            const data = await this.readDatabase();
            
            // Find transcript by note title (sanitized) or path
            const sanitizedTitle = this.sanitizeText(noteTitle);
            const transcript = data.transcripts.find((t: TranscriptRecord) => {
                const titleMatch = this.sanitizeText(t.note_title) === sanitizedTitle;
                const pathMatch = notePath ? t.note_path === notePath : true;
                return titleMatch && pathMatch;
            });

            return transcript || null;
        } catch (error: unknown) {
            ErrorHandler.handleError(error, "DATABASE_ERROR", {
                operation: "get-transcript",
                noteTitle
            });
            return null;
        }
    }

    async updateTranscript(id: number, updates: Partial<TranscriptRecord>): Promise<boolean> {
        try {
            const data = await this.readDatabase();
            const index = data.transcripts.findIndex((t: TranscriptRecord) => t.id === id);
            
            if (index === -1) {
                return false;
            }

            // Sanitize updates
            const sanitizedUpdates = this.sanitizeRecord(updates);
            
            data.transcripts[index] = {
                ...data.transcripts[index],
                ...sanitizedUpdates,
                updated_at: new Date().toISOString()
            };

            await this.writeDatabase(data);
            return true;
        } catch (error: unknown) {
            ErrorHandler.handleError(error, "DATABASE_ERROR", {
                operation: "update-transcript",
                id
            });
            return false;
        }
    }

    async deleteTranscript(id: number): Promise<boolean> {
        try {
            const data = await this.readDatabase();
            const initialLength = data.transcripts.length;
            
            data.transcripts = data.transcripts.filter((t: TranscriptRecord) => t.id !== id);
            
            if (data.transcripts.length === initialLength) {
                return false;
            }

            await this.writeDatabase(data);
            return true;
        } catch (error: unknown) {
            ErrorHandler.handleError(error, "DATABASE_ERROR", {
                operation: "delete-transcript",
                id
            });
            return false;
        }
    }

    async searchTranscripts(query: string): Promise<TranscriptRecord[]> {
        try {
            const data = await this.readDatabase();
            const sanitizedQuery = this.sanitizeText(query.toLowerCase());
            
            return data.transcripts.filter((t: TranscriptRecord) => {
                const searchableContent = [
                    t.note_title,
                    t.video_title,
                    t.video_channel,
                    t.transcript_content?.substring(0, 1000) // Search first 1000 chars
                ].filter(Boolean).join(' ').toLowerCase();
                
                return searchableContent.includes(sanitizedQuery);
            });
        } catch (error: unknown) {
            ErrorHandler.handleError(error, "DATABASE_ERROR", {
                operation: "search-transcripts",
                query
            });
            return [];
        }
    }

    async getAllTranscripts(): Promise<TranscriptRecord[]> {
        try {
            const data = await this.readDatabase();
            return data.transcripts || [];
        } catch (error: unknown) {
            ErrorHandler.handleError(error, "DATABASE_ERROR", {
                operation: "get-all-transcripts"
            });
            return [];
        }
    }

    private async readDatabase(): Promise<any> {
        try {
            const content = await this.app.vault.adapter.read(this.config.dbPath);
            return JSON.parse(content);
        } catch (error: unknown) {
            // Return empty database structure if file doesn't exist or is corrupted
            return {
                version: "1.0",
                transcripts: [],
                created_at: new Date().toISOString()
            };
        }
    }

    private async writeDatabase(data: any): Promise<void> {
        try {
            await this.app.vault.adapter.write(this.config.dbPath, JSON.stringify(data, null, 2));
        } catch (error: unknown) {
            throw new Error(`Failed to write database: ${error}`);
        }
    }

    private sanitizeRecord(record: Partial<TranscriptRecord>): Partial<TranscriptRecord> {
        const sanitized: Partial<TranscriptRecord> = {};
        
        if (record.note_title) {
            sanitized.note_title = this.sanitizeText(record.note_title);
        }
        
        if (record.note_path) {
            sanitized.note_path = this.sanitizeText(record.note_path);
        }
        
        if (record.transcript_content) {
            sanitized.transcript_content = record.transcript_content.trim();
        }
        
        if (record.video_url) {
            sanitized.video_url = this.sanitizeText(record.video_url);
        }
        
        if (record.video_title) {
            sanitized.video_title = this.sanitizeText(record.video_title);
        }
        
        if (record.video_channel) {
            sanitized.video_channel = this.sanitizeText(record.video_channel);
        }
        
        if (record.description) {
            sanitized.description = record.description.trim();
        }
        
        if (record.detailed_summaries && Array.isArray(record.detailed_summaries)) {
            sanitized.detailed_summaries = record.detailed_summaries.map(s => s.trim());
        }
        
        return sanitized;
    }

    private sanitizeText(text: string): string {
        return text
            .replace(/[<>"'&]/g, '') // Remove problematic characters
            .replace(/\s+/g, ' ') // Normalize whitespace
            .trim()
            .substring(0, 500); // Limit length
    }

    async close(): Promise<void> {
        // Cleanup resources if needed
        this.db = null;
    }
}

export { DatabaseManager, TranscriptRecord, DatabaseConfig };