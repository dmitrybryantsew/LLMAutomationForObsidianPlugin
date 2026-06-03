import { App, Modal, Notice } from "obsidian";
import type GptFreeTextGeneratorPlugin from '../main';
import { DatabaseManager, TranscriptRecord } from '../database/DatabaseManager';

interface TranscriptViewerOptions {
    noteTitle: string;
    notePath?: string;
    defaultTab?: 'transcript' | 'description' | 'summaries';
}

class TranscriptViewerModal extends Modal {
    private plugin: GptFreeTextGeneratorPlugin;
    private noteTitle: string;
    private notePath?: string;
    private defaultTab: 'transcript' | 'description' | 'summaries';
    private record: TranscriptRecord | null = null;
    private loading: boolean = true;
    private activeTab: 'transcript' | 'description' | 'summaries';

    constructor(app: App, plugin: GptFreeTextGeneratorPlugin, options: TranscriptViewerOptions) {
        super(app);
        this.plugin = plugin;
        this.noteTitle = options.noteTitle;
        this.notePath = options.notePath;
        this.defaultTab = options.defaultTab || 'transcript';
        this.activeTab = this.defaultTab;
    }

    async onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('transcript-viewer-modal');

        // Header
        const headerEl = contentEl.createEl('div', { cls: 'transcript-viewer-header' });
        headerEl.createEl('h2', { text: 'Content Viewer' });
        
        // Loading state
        const loadingEl = contentEl.createEl('div', { cls: 'transcript-viewer-loading' });
        loadingEl.textContent = 'Loading content from database...';

        try {
            // Fetch all content from database
            this.record = await this.fetchContent();
             
            if (!this.record) {
                loadingEl.textContent = 'No content found in database for this note.';
                loadingEl.addClass('transcript-viewer-error');
                return;
            }

            // Clear loading indicator
            loadingEl.remove();

            // Create tabs
            this.createTabs(contentEl);

            // Create content container
            const contentContainer = contentEl.createEl('div', {
                cls: 'transcript-viewer-content'
            });
            contentContainer.id = 'transcript-viewer-content';

            // Add note title
            contentContainer.createEl('h3', {
                text: this.noteTitle,
                cls: 'transcript-viewer-title'
            });

            // Create content area
            const contentArea = contentContainer.createEl('div', {
                cls: 'transcript-viewer-text',
                attr: { id: 'transcript-viewer-text' }
            });

            // Show default tab content
            this.showTabContent(this.activeTab, contentArea);

            // Add buttons
            const buttonContainer = contentEl.createEl('div', {
                cls: 'transcript-viewer-buttons'
            });
             
            const copyButton = buttonContainer.createEl('button', {
                text: 'Copy Content',
                cls: 'mod-cta'
            });
            copyButton.addEventListener('click', () => {
                const content = this.getCurrentContent();
                if (content) {
                    navigator.clipboard.writeText(content);
                    new Notice('Content copied to clipboard!');
                }
            });

            // Add close button
            const closeButton = buttonContainer.createEl('button', {
                text: 'Close'
            });
            closeButton.addEventListener('click', () => {
                this.close();
            });

        } catch (error) {
            loadingEl.textContent = 'Failed to load content from database.';
            loadingEl.addClass('transcript-viewer-error');
            console.error('Error loading content:', error);
        }

        // Add styles
        this.addStyles();
    }

    private createTabs(container: HTMLElement): void {
        const tabsContainer = container.createEl('div', { cls: 'transcript-viewer-tabs' });

        const tabs: Array<{ id: 'transcript' | 'description' | 'summaries'; label: string; available: boolean }> = [
            { id: 'transcript', label: 'Transcript', available: !!this.record?.transcript_content },
            { id: 'description', label: 'Description', available: !!this.record?.description },
            { id: 'summaries', label: 'Summaries', available: !!this.record?.detailed_summaries && this.record.detailed_summaries.length > 0 }
        ];

        tabs.forEach(tab => {
            if (!tab.available) return;

            const tabButton = tabsContainer.createEl('button', {
                text: tab.label,
                cls: `transcript-viewer-tab ${this.activeTab === tab.id ? 'active' : ''}`
            });
            tabButton.dataset.tab = tab.id;
            
            tabButton.addEventListener('click', () => {
                this.activeTab = tab.id;
                this.updateTabs();
                this.showTabContent(tab.id);
            });
        });
    }

    private updateTabs(): void {
        const tabs = this.contentEl.querySelectorAll('.transcript-viewer-tab');
        tabs.forEach(tab => {
            const tabElement = tab as HTMLElement;
            if (tabElement.dataset.tab === this.activeTab) {
                tabElement.classList.add('active');
            } else {
                tabElement.classList.remove('active');
            }
        });
    }

    private showTabContent(tab: 'transcript' | 'description' | 'summaries', contentArea?: HTMLElement): void {
        const container = contentArea || this.contentEl.querySelector('#transcript-viewer-text');
        if (!container) return;

        container.empty();

        switch (tab) {
            case 'transcript':
                if (this.record?.transcript_content) {
                    container.textContent = this.record.transcript_content;
                } else {
                    container.textContent = 'No transcript available.';
                }
                break;
            case 'description':
                if (this.record?.description) {
                    container.textContent = this.record.description;
                } else {
                    container.textContent = 'No description available.';
                }
                break;
            case 'summaries':
                if (this.record?.detailed_summaries && this.record.detailed_summaries.length > 0) {
                    this.record.detailed_summaries.forEach((summary, index) => {
                        const summarySection = container.createEl('div', { cls: 'summary-part' });
                        summarySection.createEl('h4', { text: `Part ${index + 1}` });
                        summarySection.createEl('p', { text: summary });
                    });
                } else {
                    container.textContent = 'No detailed summaries available.';
                }
                break;
        }
    }

    private getCurrentContent(): string | null {
        if (!this.record) return null;

        switch (this.activeTab) {
            case 'transcript':
                return this.record.transcript_content || null;
            case 'description':
                return this.record.description || null;
            case 'summaries':
                if (this.record.detailed_summaries && this.record.detailed_summaries.length > 0) {
                    return this.record.detailed_summaries.map((s, i) => `Part ${i + 1}\n${s}`).join('\n\n');
                }
                return null;
            default:
                return null;
        }
    }

    private async fetchContent(): Promise<TranscriptRecord | null> {
        const databaseManager = this.plugin.services.databaseManager;
        if (!databaseManager) {
            new Notice('Database manager not available');
            return null;
        }

        return await databaseManager.getTranscript(this.noteTitle, this.notePath);
    }

    private addStyles() {
        const styles = `
            .transcript-viewer-modal {
                max-width: 800px;
                max-height: 80vh;
            }
             
            .transcript-viewer-header {
                padding: 16px;
                border-bottom: 1px solid var(--background-modifier-border);
            }
             
            .transcript-viewer-header h2 {
                margin: 0;
                font-size: 1.2em;
            }
             
            .transcript-viewer-tabs {
                display: flex;
                gap: 4px;
                padding: 8px 16px 0;
                border-bottom: 1px solid var(--background-modifier-border);
            }
             
            .transcript-viewer-tab {
                padding: 8px 16px;
                background: transparent;
                border: none;
                border-bottom: 2px solid transparent;
                cursor: pointer;
                color: var(--text-muted);
                font-size: 0.9em;
            }
             
            .transcript-viewer-tab:hover {
                color: var(--text-normal);
            }
             
            .transcript-viewer-tab.active {
                color: var(--text-normal);
                border-bottom-color: var(--interactive-accent);
                font-weight: 500;
            }
             
            .transcript-viewer-loading {
                padding: 32px;
                text-align: center;
                color: var(--text-muted);
            }
             
            .transcript-viewer-error {
                color: var(--text-error);
            }
             
            .transcript-viewer-content {
                padding: 16px;
                max-height: 60vh;
                overflow-y: auto;
            }
             
            .transcript-viewer-title {
                margin-top: 0;
                margin-bottom: 16px;
                font-size: 1em;
                color: var(--text-muted);
            }
             
            .transcript-viewer-text {
                white-space: pre-wrap;
                word-wrap: break-word;
                line-height: 1.6;
                font-size: 0.95em;
            }
             
            .summary-part {
                margin-bottom: 24px;
            }
             
            .summary-part h4 {
                margin: 0 0 8px 0;
                font-size: 0.95em;
                color: var(--text-muted);
            }
             
            .summary-part p {
                margin: 0;
                line-height: 1.6;
            }
             
            .transcript-viewer-buttons {
                padding: 16px;
                border-top: 1px solid var(--background-modifier-border);
                display: flex;
                gap: 8px;
                justify-content: flex-end;
            }
             
            .transcript-viewer-buttons button {
                padding: 6px 16px;
                border-radius: 4px;
                cursor: pointer;
            }
        `;

        const styleEl = document.createElement('style');
        styleEl.textContent = styles;
        document.head.appendChild(styleEl);
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

export { TranscriptViewerModal, TranscriptViewerOptions };