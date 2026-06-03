import { App, TFile, Notice } from "obsidian";
import { ErrorHandler } from "./ErrorHandler";

interface ScanResult {
    totalNotes: number;
    notesWithTranscript: number;
    notesWithDatabaseTranscript: number;
    standaloneTranscriptFiles: number;
    legacyTranscriptFiles: number;
    notePaths: string[];
    standaloneTranscriptPaths: string[];
    legacyTranscriptPaths: string[];
}

class TranscriptNoteScanner {
    private app: App;

    constructor(app: App) {
        this.app = app;
    }

    /**
     * Scans all markdown files in the vault to identify AI-generated notes with transcripts
     */
    async scanVault(): Promise<ScanResult> {
        try {
            const allFiles = this.app.vault.getMarkdownFiles();
            const notesWithTranscript: string[] = [];
            const notesWithDatabaseTranscript: string[] = [];
            const standaloneTranscriptFiles: string[] = [];
            const legacyTranscriptFiles: string[] = [];

            for (const file of allFiles) {
                const content = await this.app.vault.read(file);
                
                // Check if note has the AI-generated template structure
                if (this.isAiGeneratedNote(content)) {
                    if (this.hasTranscriptInFile(content)) {
                        notesWithTranscript.push(file.path);
                    } else if (this.hasDatabaseTranscript(content)) {
                        notesWithDatabaseTranscript.push(file.path);
                    }
                } else if (this.isStandaloneTranscriptFile(content)) {
                    // Check for standalone transcript files (no summary, just transcript)
                    standaloneTranscriptFiles.push(file.path);
                } else if (this.isLegacyTranscriptFile(file, content)) {
                    // Check for legacy transcript files from earlier plugin versions
                    legacyTranscriptFiles.push(file.path);
                }
            }

            const result: ScanResult = {
                totalNotes: allFiles.length,
                notesWithTranscript: notesWithTranscript.length,
                notesWithDatabaseTranscript: notesWithDatabaseTranscript.length,
                standaloneTranscriptFiles: standaloneTranscriptFiles.length,
                legacyTranscriptFiles: legacyTranscriptFiles.length,
                notePaths: [...notesWithTranscript, ...notesWithDatabaseTranscript],
                standaloneTranscriptPaths: standaloneTranscriptFiles,
                legacyTranscriptPaths: legacyTranscriptFiles
            };

            return result;
        } catch (error: unknown) {
            ErrorHandler.handleError(error, "FILE_OPERATION", {
                operation: "scan-vault-for-transcript-notes"
            });
            throw error;
        }
    }

    /**
     * Checks if a note has the AI-generated template structure
     * Based on the formatSummaryContent method in TranscriptManager
     */
    private isAiGeneratedNote(content: string): boolean {
        // Check for common sections in AI-generated video summaries
        const hasTitle = /^#\s+.+$/m.test(content); // Has # Title
        const hasSummary = /##\s*Summary/i.test(content); // Has ## Summary section
        const hasTags = /##\s*Tags/i.test(content); // Has ## Tags section
        const hasTranscriptSection = /##\s*(Full\s+)?Transcript/i.test(content); // Has ## Transcript or ## Full Transcript section

        // A note is considered AI-generated if it has at least title, summary, and transcript section
        return hasTitle && hasSummary && hasTranscriptSection;
    }

    /**
     * Checks if the note has transcript content in the file itself
     */
    private hasTranscriptInFile(content: string): boolean {
        // Look for the collapsible transcript section with actual content
        const transcriptSectionMatch = content.match(
            /##\s*(Full\s+)?Transcript\s*<details>[\s\S]*?<summary>Click to expand<\/summary>[\s\S]*?([\s\S]{50,})[\s\S]*?<\/details>/i
        );
        
        // Check if there's substantial content in the transcript section (at least 50 chars)
        return transcriptSectionMatch !== null && transcriptSectionMatch[2].trim().length > 50;
    }

    /**
     * Checks if the note has a database-stored transcript
     */
    private hasDatabaseTranscript(content: string): boolean {
        // Look for the message indicating transcript is in database
        return /\*Transcript is stored in database/i.test(content);
    }

    /**
     * Checks if a file is a standalone transcript file (transcript without summary)
     */
    private isStandaloneTranscriptFile(content: string): boolean {
        // Check for YAML frontmatter with transcript metadata
        const hasYamlFrontmatter = /^---[\s\S]*?---/.test(content);
        
        // Check for transcript section
        const hasTranscriptSection = /##\s*(Full\s+)?Transcript/i.test(content);
        
        // Check if it lacks summary section (indicating it's standalone)
        const hasSummarySection = /##\s*Summary/i.test(content);
        
        // Check if it has substantial transcript content
        const hasTranscriptContent = this.hasTranscriptInFile(content);
        
        // A file is a standalone transcript if it has transcript but no summary
        return hasTranscriptSection && !hasSummarySection && hasTranscriptContent;
    }

    /**
     * Checks if a file is a legacy transcript file from earlier plugin versions
     * These are typically files named "transcript.md" or containing "transcript" in the name
     * with YAML frontmatter containing transcript metadata
     */
    private isLegacyTranscriptFile(file: TFile, content: string): boolean {
        // Check if filename contains "transcript" (case insensitive)
        const hasTranscriptInName = file.basename.toLowerCase().includes('transcript');
        
        if (!hasTranscriptInName) {
            return false;
        }
        
        // Check for YAML frontmatter with transcript-related metadata
        const hasYamlFrontmatter = /^---[\s\S]*?---/.test(content);
        
        if (!hasYamlFrontmatter) {
            return false;
        }
        
        // Look for transcript-related fields in YAML
        const hasTranscriptField = /(?:transcript|video_url|title):\s*/i.test(content);
        
        // Check if it has substantial content (not just metadata)
        const hasSubstantialContent = content.length > 200;
        
        return hasTranscriptField && hasSubstantialContent;
    }

    /**
     * Displays the scan results to the user
     */
    displayResults(result: ScanResult): void {
        const message = `
📊 Vault Scan Results:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Total markdown files: ${result.totalNotes}
Notes with embedded transcripts: ${result.notesWithTranscript}
Notes with database transcripts: ${result.notesWithDatabaseTranscript}
Standalone transcript files: ${result.standaloneTranscriptFiles}
Legacy transcript files (old plugin): ${result.legacyTranscriptFiles}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Total AI-generated notes with transcripts: ${result.notesWithTranscript + result.notesWithDatabaseTranscript}
Total transcript files to clean up: ${result.standaloneTranscriptFiles + result.legacyTranscriptFiles}
        `.trim();

        console.log(message);
        new Notice(message, 10000); // Show for 10 seconds
    }
}

export { TranscriptNoteScanner, ScanResult };