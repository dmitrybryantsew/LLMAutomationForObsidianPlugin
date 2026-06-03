import { App, Modal, Notice, Setting } from "obsidian";

interface StandaloneTranscriptFile {
    path: string;
    name: string;
    type: 'standalone' | 'legacy';
}

export class StandaloneTranscriptCleanupModal extends Modal {
    private standaloneFiles: StandaloneTranscriptFile[];
    private legacyFiles: StandaloneTranscriptFile[];
    private selectedFiles: Set<string> = new Set();
    private onConfirm: (filesToDelete: string[]) => void;

    constructor(
        app: App,
        standaloneFiles: string[],
        legacyFiles: string[],
        onConfirm: (filesToDelete: string[]) => void
    ) {
        super(app);
        this.standaloneFiles = standaloneFiles.map(path => ({
            path,
            name: path.split('/').pop() || path,
            type: 'standalone' as const
        }));
        this.legacyFiles = legacyFiles.map(path => ({
            path,
            name: path.split('/').pop() || path,
            type: 'legacy' as const
        }));
        this.onConfirm = onConfirm;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('standalone-transcript-modal');

        // Header
        contentEl.createEl('h2', { text: 'Transcript Files Cleanup' });
        
        const totalFiles = this.standaloneFiles.length + this.legacyFiles.length;
        const description = contentEl.createEl('p', {
            text: `Found ${totalFiles} transcript files to clean up:\n• ${this.standaloneFiles.length} standalone transcript files (transcripts without summaries)\n• ${this.legacyFiles.length} legacy transcript files (from earlier plugin versions)\n\nThese files can be safely deleted after migration.`,
            cls: 'setting-item-description'
        });

        // Select All / Deselect All
        const buttonContainer = contentEl.createDiv({ cls: 'modal-button-container' });
        
        const selectAllBtn = buttonContainer.createEl('button', {
            text: 'Select All',
            cls: 'mod-cta'
        });
        selectAllBtn.onclick = () => {
            [...this.standaloneFiles, ...this.legacyFiles].forEach(file => this.selectedFiles.add(file.path));
            this.updateFileList();
        };

        const deselectAllBtn = buttonContainer.createEl('button', {
            text: 'Deselect All'
        });
        deselectAllBtn.onclick = () => {
            this.selectedFiles.clear();
            this.updateFileList();
        };

        // File list container
        const fileListContainer = contentEl.createDiv({
            cls: 'standalone-file-list'
        });

        // Create file list
        this.updateFileList(fileListContainer);

        // Warning
        const warning = contentEl.createEl('p', {
            text: '⚠️ Warning: This action cannot be undone. Make sure to backup your vault before proceeding.',
            cls: 'warning-text'
        });

        // Action buttons
        const actionContainer = contentEl.createDiv({ cls: 'modal-button-container' });

        const deleteBtn = actionContainer.createEl('button', {
            text: `Delete Selected (${this.selectedFiles.size})`,
            cls: 'mod-warning'
        });
        deleteBtn.onclick = () => {
            this.handleDelete();
        };

        const cancelBtn = actionContainer.createEl('button', {
            text: 'Cancel'
        });
        cancelBtn.onclick = () => {
            this.close();
        };
    }

    private updateFileList(container?: HTMLElement): void {
        const fileListContainer = container || this.contentEl.querySelector('.standalone-file-list') as HTMLElement;
        if (!fileListContainer) return;

        fileListContainer.empty();

        const allFiles = [...this.standaloneFiles, ...this.legacyFiles];

        if (allFiles.length === 0) {
            fileListContainer.createEl('p', {
                text: 'No transcript files found.',
                cls: 'empty-message'
            });
            return;
        }

        // Display standalone files section
        if (this.standaloneFiles.length > 0) {
            const standaloneHeader = fileListContainer.createEl('h3', {
                text: `🟡 Standalone Transcript Files (${this.standaloneFiles.length})`,
                cls: 'file-section-header'
            });
            
            this.standaloneFiles.forEach(file => {
                this.createFileItem(fileListContainer, file);
            });
        }

        // Display legacy files section
        if (this.legacyFiles.length > 0) {
            const legacyHeader = fileListContainer.createEl('h3', {
                text: `🔴 Legacy Transcript Files (${this.legacyFiles.length})`,
                cls: 'file-section-header'
            });
            
            this.legacyFiles.forEach(file => {
                this.createFileItem(fileListContainer, file);
            });
        }
    }

    private createFileItem(container: HTMLElement, file: StandaloneTranscriptFile): void {
        const fileItem = container.createDiv({ cls: 'file-item' });
        
        const checkbox = fileItem.createEl('input', {
            type: 'checkbox',
            attr: { id: `file-${file.path.replace(/\//g, '-')}` }
        });
        checkbox.checked = this.selectedFiles.has(file.path);
        checkbox.onclick = () => {
            if (checkbox.checked) {
                this.selectedFiles.add(file.path);
            } else {
                this.selectedFiles.delete(file.path);
            }
            
            // Update delete button text
            const deleteBtn = this.contentEl.querySelector('.mod-warning') as HTMLButtonElement;
            if (deleteBtn) {
                deleteBtn.textContent = `Delete Selected (${this.selectedFiles.size})`;
            }
        };

        const label = fileItem.createEl('label', {
            text: file.name,
            attr: { for: `file-${file.path.replace(/\//g, '-')}` }
        });
        label.title = file.path;
    }

    private handleDelete(): void {
        if (this.selectedFiles.size === 0) {
            new Notice('No files selected for deletion.');
            return;
        }

        const filesToDelete = Array.from(this.selectedFiles);
        
        // Confirmation
        const confirmMsg = `Are you sure you want to delete ${filesToDelete.length} file(s)? This action cannot be undone.`;
        if (!confirm(confirmMsg)) {
            return;
        }

        this.onConfirm(filesToDelete);
        this.close();
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}