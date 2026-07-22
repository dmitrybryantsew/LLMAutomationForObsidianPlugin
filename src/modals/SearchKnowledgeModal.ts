import { App, Modal, Notice, Setting, TextAreaComponent, ButtonComponent, TFile, MarkdownView } from 'obsidian';
import type GptFreeTextGeneratorPlugin from '../main';
import { IndexCoordinator } from '../retrieval/IndexCoordinator';
import { RetrievalService } from '../retrieval/RetrievalService';
import { SearchHit, SearchRequest } from '../types/retrieval';
import { QuickQueryModal } from './QuickQueryModal';

/**
 * Standalone search-UI for the indexed knowledge base.
 *
 * Works without a configured LLM. Shows ranked chunks (path, heading, snippet,
 * score, reasons), lets the user open the source note at the heading, and can
 * hand the selected hits off to Quick Query for grounded answer generation.
 *
 * Per the runbook (§8.1): no LLM dependency, scope filters, open action, and
 * an "Ask using selected results" hand-off.
 */
export class SearchKnowledgeModal extends Modal {
  private plugin: GptFreeTextGeneratorPlugin;
  private retrievalService: RetrievalService;
  private indexCoordinator: IndexCoordinator;

  private query = '';
  private folderPrefix = '';
  private tagFilter = '';
  private hits: SearchHit[] = [];
  private selectedHitIds = new Set<string>();
  private isSearching = false;

  private resultsContainer!: HTMLElement;
  private statusContainer!: HTMLElement;
  private searchButton!: ButtonComponent;
  private askButton!: ButtonComponent;

  constructor(
    app: App,
    plugin: GptFreeTextGeneratorPlugin,
    retrievalService: RetrievalService,
    indexCoordinator: IndexCoordinator
  ) {
    super(app);
    this.plugin = plugin;
    this.retrievalService = retrievalService;
    this.indexCoordinator = indexCoordinator;
    this.modalEl.addClass('search-knowledge-modal');
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl('h2', { text: 'Search Knowledge Base' });

    this.buildStatusSection(contentEl);
    this.buildQuerySection(contentEl);
    this.buildResultsSection(contentEl);
    this.buildActionButtons(contentEl);

    this.renderStatus();
  }

  private buildStatusSection(container: HTMLElement): void {
    this.statusContainer = container.createEl('div', { cls: 'search-knowledge-status' });
  }

  private buildQuerySection(container: HTMLElement): void {
    const querySetting = new Setting(container)
      .setName('Query')
      .setDesc('Search the indexed vault. Exact symbols, error strings, and paths work best.');

    const textArea = new TextAreaComponent(querySetting.controlEl);
    textArea
      .setPlaceholder('e.g. HttpClient.GetAsync retry policy')
      .onChange((value) => {
        this.query = value;
      });
    textArea.inputEl.addClass('search-knowledge-query-textarea');
    textArea.inputEl.rows = 3;
    textArea.inputEl.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        void this.runSearch();
      }
    });

    new Setting(container)
      .setName('Folder prefix (optional)')
      .setDesc('Restrict to paths starting with this prefix, e.g. "Networking/".')
      .addText((text) =>
        text
          .setPlaceholder('Folder prefix')
          .onChange((value) => {
            this.folderPrefix = value.trim();
          })
      );

    new Setting(container)
      .setName('Tags (optional)')
      .setDesc('Comma-separated tag filter, e.g. "csharp, networking".')
      .addText((text) =>
        text
          .setPlaceholder('tags')
          .onChange((value) => {
            this.tagFilter = value.trim();
          })
      );

    this.searchButton = new ButtonComponent(container);
    this.searchButton.setButtonText('Search').setCta().onClick(() => {
      void this.runSearch();
    });
  }

  private buildResultsSection(container: HTMLElement): void {
    container.createEl('h3', { text: 'Results' });
    this.resultsContainer = container.createEl('div', { cls: 'search-knowledge-results empty' });
    this.resultsContainer.createEl('div', {
      cls: 'search-knowledge-empty',
      text: 'Run a search to see ranked chunks.',
    });
  }

  private buildActionButtons(container: HTMLElement): void {
    const actions = container.createEl('div', { cls: 'search-knowledge-actions' });

    this.askButton = new ButtonComponent(actions);
    this.askButton
      .setButtonText('Ask using selected results')
      .setTooltip('Open Quick Query with these chunks as grounded evidence.')
      .setDisabled(true)
      .onClick(() => this.handOffToQuickQuery());

    new ButtonComponent(actions)
      .setButtonText('Index now')
      .setTooltip('Re-scan enabled sources and update the index.')
      .onClick(() => {
        void this.runIndex();
      });

    new ButtonComponent(actions)
      .setButtonText('Refresh status')
      .onClick(() => {
        this.renderStatus();
      });
  }

  private async runSearch(): Promise<void> {
    const trimmed = this.query.trim();
    if (!trimmed) {
      new Notice('Enter a query first.');
      return;
    }
    if (this.isSearching) {
      return;
    }

    this.isSearching = true;
    this.searchButton.setButtonText('Searching...').setDisabled(true);
    this.resultsContainer.empty();
    this.resultsContainer.addClass('empty');
    this.resultsContainer.createEl('div', {
      cls: 'search-knowledge-empty',
      text: 'Searching...',
    });

    try {
      const request: SearchRequest = {
        query: trimmed,
        folderPrefix: this.folderPrefix || undefined,
        tags: this.tagFilter
          ? this.tagFilter.split(',').map((t) => t.trim()).filter(Boolean)
          : undefined,
        limit: this.plugin.settings.retrieval.defaultResultLimit,
      };
      const startedAt = Date.now();
      this.hits = await this.retrievalService.search(request);
      const elapsed = Date.now() - startedAt;
      this.selectedHitIds.clear();
      this.renderResults(elapsed);
    } catch (error) {
      console.error('Knowledge search failed:', error);
      this.resultsContainer.empty();
      this.resultsContainer.addClass('empty');
      this.resultsContainer.createEl('div', {
        cls: 'search-knowledge-empty',
        text: `Search failed: ${error instanceof Error ? error.message : String(error)}`,
      });
    } finally {
      this.isSearching = false;
      this.searchButton.setButtonText('Search').setDisabled(false);
    }
  }

  private async runIndex(): Promise<void> {
    if (this.indexCoordinator.getStatus().state === 'indexing') {
      new Notice('Indexing is already running.');
      return;
    }
    new Notice('Indexing started...');
    try {
      const status = await this.indexCoordinator.indexAll();
      new Notice(
        `Index updated: ${status.indexedFiles} indexed, ${status.unchangedFiles} unchanged, ${status.skippedFiles} skipped, ${status.deletedFiles} deleted.`
      );
      this.renderStatus();
    } catch (error) {
      new Notice(`Index failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private renderResults(elapsedMs: number): void {
    this.resultsContainer.empty();
    if (this.hits.length === 0) {
      this.resultsContainer.addClass('empty');
      const empty = this.resultsContainer.createEl('div', { cls: 'search-knowledge-empty' });
      empty.createEl('p', { text: 'No results found in the indexed sources.' });
      const status = this.indexCoordinator.getStatus();
      if (status.chunkCount === 0) {
        empty.createEl('p', {
          text: 'The index is empty. Click "Index now" to build it.',
        });
      } else if (status.lastIndexedAt && Date.now() - status.lastIndexedAt > 1000 * 60 * 60 * 24) {
        empty.createEl('p', {
          text: 'The index is stale. Click "Index now" to refresh it.',
        });
      }
      this.askButton.setDisabled(true);
      return;
    }

    this.resultsContainer.removeClass('empty');
    const summary = this.resultsContainer.createEl('div', { cls: 'search-knowledge-summary' });
    summary.setText(
      `${this.hits.length} result(s) · ${elapsedMs}ms · ${this.indexCoordinator.getStatus().chunkCount} chunks indexed`
    );

    for (const hit of this.hits) {
      this.renderHitCard(hit);
    }

    // Auto-select top hits (up to 5) so the hand-off is one click.
    for (const hit of this.hits.slice(0, 5)) {
      this.selectedHitIds.add(hit.id);
    }
    this.refreshAskButton();
  }

  private renderHitCard(hit: SearchHit): void {
    const card = this.resultsContainer.createEl('div', { cls: 'search-knowledge-card' });

    const header = card.createEl('div', { cls: 'search-knowledge-card-header' });

    const checkbox = header.createEl('input', { type: 'checkbox' });
    checkbox.checked = this.selectedHitIds.has(hit.id);
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) {
        this.selectedHitIds.add(hit.id);
      } else {
        this.selectedHitIds.delete(hit.id);
      }
      this.refreshAskButton();
    });

    const titleArea = header.createEl('div', { cls: 'search-knowledge-card-title' });
    titleArea.createEl('span', { cls: 'search-knowledge-card-basename', text: hit.basename });
    const heading = hit.headingPath.length > 0 ? hit.headingPath.join(' > ') : '(preamble)';
    titleArea.createEl('span', { cls: 'search-knowledge-card-heading', text: heading });

    const openBtn = header.createEl('button', { cls: 'search-knowledge-card-open' });
    openBtn.setText('Open');
    openBtn.addEventListener('click', () => {
      void this.openSource(hit);
    });

    const meta = card.createEl('div', { cls: 'search-knowledge-card-meta' });
    meta.createEl('span', { text: hit.path });
    meta.createEl('span', { text: `Lines ${hit.startLine}-${hit.endLine}` });
    const scoreText = hit.finalScore.toFixed(3);
    meta.createEl('span', { text: `score ${scoreText}` });
    if (hit.matchReasons.length > 0) {
      meta.createEl('span', {
        cls: 'search-knowledge-card-reasons',
        text: hit.matchReasons.join(', '),
      });
    }

    const snippet = card.createEl('div', { cls: 'search-knowledge-card-snippet' });
    const previewText = hit.text.length > 280 ? `${hit.text.slice(0, 280)}…` : hit.text;
    snippet.setText(previewText);
  }

  private async openSource(hit: SearchHit): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(hit.path);
    if (!(file instanceof TFile)) {
      new Notice(`Could not find file: ${hit.path}. It may have been moved or deleted.`);
      return;
    }
    await this.app.workspace.openLinkText(hit.path, '', false);
    // Best-effort scroll to the first heading line if the file opened in a markdown view.
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (view && hit.headingPath.length > 0) {
      const heading = hit.headingPath[hit.headingPath.length - 1];
      try {
        const editor = view.editor;
        const cursor = editor.getCursor();
        // Set a search-free fallback: just move cursor to the chunk's start line if the editor
        // line count is large enough. Obsidian editors are 0-indexed.
        if (hit.startLine > 0 && editor.lineCount() >= hit.startLine) {
          editor.setCursor({ line: Math.max(0, hit.startLine - 1), ch: 0 });
          void cursor;
        }
      } catch {
        // Non-critical: opening the file is the main behaviour.
      }
    }
  }

  private refreshAskButton(): void {
    this.askButton.setDisabled(this.selectedHitIds.size === 0);
    this.askButton.setButtonText(
      this.selectedHitIds.size === 0
        ? 'Ask using selected results'
        : `Ask using ${this.selectedHitIds.size} selected result(s)`
    );
  }

  private renderStatus(): void {
    const status = this.indexCoordinator.getStatus();
    this.statusContainer.empty();
    const state = status.state === 'indexing' ? 'Indexing…' : status.state === 'error' ? 'Error' : 'Idle';
    const last = status.lastIndexedAt ? new Date(status.lastIndexedAt).toLocaleString() : 'never';
    this.statusContainer.createEl('span', { text: `Status: ${state}` });
    this.statusContainer.createEl('span', { text: `Chunks: ${status.chunkCount}` });
    this.statusContainer.createEl('span', { text: `Files: ${status.fileCount}` });
    this.statusContainer.createEl('span', { text: `Last indexed: ${last}` });
    if (status.lastError) {
      this.statusContainer.createEl('div', {
        cls: 'search-knowledge-status-error',
        text: `Last error: ${status.lastError}`,
      });
    }
  }

  private handOffToQuickQuery(): void {
    const selected = this.hits.filter((hit) => this.selectedHitIds.has(hit.id));
    if (selected.length === 0) {
      new Notice('Select at least one result first.');
      return;
    }
    this.close();
    const modal = new QuickQueryModal(this.app, this.plugin, {
      mode: 'indexed-knowledge-base',
      preselectedQuery: this.query.trim(),
      preselectedHits: selected,
    });
    modal.open();
  }

  onClose(): void {
    const { contentEl } = this;
    contentEl.empty();
  }
}
