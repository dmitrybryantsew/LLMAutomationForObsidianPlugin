import { ItemView, MarkdownRenderer, Notice, Setting, TFile, WorkspaceLeaf, normalizePath } from 'obsidian';
import type GptFreeTextGeneratorPlugin from '../main';
import { VIEW_TYPE_CODING_EXERCISES } from '../constants';
import { CodingExercise, LocalRunResult } from '../types/codingExercise';
import { sanitizeFilename } from '../utils/helpers';
import { StudyAssistantExerciseEntry } from '../types/codingExercise';
import { computeOutputDiff, handleEnterKey, handleTabKey, OutputDiffResult } from '../utils/editorUtils';

type Difficulty = 'Easy' | 'Medium' | 'Hard';

const TOPIC_PRESETS = [
  'LINQ',
  'Async/Await',
  'Pattern Matching',
  'Collections',
  'Records & Structs',
  'Generics',
  'Span & Memory',
  'Exceptions',
];

export class CodingExerciseView extends ItemView {
  private plugin: GptFreeTextGeneratorPlugin;
  private topic = 'C# basics';
  private difficulty: Difficulty = 'Medium';
  private instructions = '';
  private exercise: CodingExercise | null = null;
  private solutionCode = '';
  private lastRun: LocalRunResult | null = null;
  private lastComparison = '';
  private generatedNotePath: string | null = null;
  private importedEntries: StudyAssistantExerciseEntry[] = [];
  private selectedImportedId = '';
  private activeOutputTab: 'diff' | 'stdout' | 'stderr' = 'diff';
  private topicInputEl: HTMLInputElement | null = null;
  private cursorStatusEl: HTMLElement | null = null;

  private taskContainer: HTMLElement | null = null;
  private editorEl: HTMLTextAreaElement | null = null;
  private outputContainer: HTMLElement | null = null;
  private generateButton: HTMLButtonElement | null = null;
  private runButton: HTMLButtonElement | null = null;
  private compileButton: HTMLButtonElement | null = null;
  private saveButton: HTMLButtonElement | null = null;
  private importSelect: HTMLSelectElement | null = null;
  private loadCatalogButton: HTMLButtonElement | null = null;
  private importButton: HTMLButtonElement | null = null;

  private controlsCollapsed = false;
  private keyHandler = (event: KeyboardEvent) => this.handleKey(event);

  constructor(leaf: WorkspaceLeaf, plugin: GptFreeTextGeneratorPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_CODING_EXERCISES;
  }

  getDisplayText(): string {
    return 'Coding Exercises';
  }

  async onOpen(): Promise<void> {
    window.addEventListener('keydown', this.keyHandler);
    this.render();
  }

  async onClose(): Promise<void> {
    window.removeEventListener('keydown', this.keyHandler);
    this.contentEl.empty();
    this.plugin.handleCodingViewClosed();
  }

  private handleKey(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null;

    if (event.key === 'Escape') {
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        target.blur();
        return;
      }
      if (this.plugin.isCodingFocusActive() || this.plugin.isStudyFocusActive()) {
        event.preventDefault();
        this.plugin.exitCodingFocus();
        return;
      }
    }

    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      void this.runSolution();
      return;
    }
  }

  public render(): void {
    this.contentEl.empty();
    this.contentEl.addClass('coding-exercise-view');

    const header = this.contentEl.createDiv({ cls: 'coding-exercise-header' });
    const headerTitle = header.createDiv({ cls: 'coding-exercise-header-title-row' });
    headerTitle.createEl('h2', { text: 'Coding Exercises' });

    const headerActions = headerTitle.createDiv({ cls: 'coding-exercise-header-actions' });
    headerActions.createEl('button', {
      text: '← Study Hub',
      cls: 'llm-automation-btn llm-automation-btn-secondary',
    }).addEventListener('click', () => {
      void this.plugin.activateStudyHub();
    });

    const isFocused = this.plugin.isCodingFocusActive() || this.plugin.isStudyFocusActive();
    const focusButton = headerActions.createEl('button', {
      text: isFocused ? 'Exit Focus (Esc)' : 'Focus Mode',
      cls: `llm-automation-btn llm-automation-btn-secondary${isFocused ? ' is-active' : ''}`,
    });
    focusButton.addEventListener('click', () => {
      void this.plugin.toggleCodingFocus();
    });

    const toggleControlsBtn = headerActions.createEl('button', {
      text: this.controlsCollapsed ? 'Show Options' : 'Hide Options',
      cls: 'llm-automation-btn llm-automation-btn-secondary',
    });
    toggleControlsBtn.addEventListener('click', () => {
      this.controlsCollapsed = !this.controlsCollapsed;
      this.render();
    });

    const status = header.createDiv({ cls: 'coding-exercise-status' });
    const isLocalEnabled = this.plugin.settings.allowLocalCodeExecution;
    status.createSpan({
      cls: `coding-exercise-status-dot ${isLocalEnabled ? 'is-enabled' : 'is-disabled'}`,
      attr: { 'aria-label': isLocalEnabled ? 'Local execution enabled' : 'Local execution disabled' },
    });
    status.createSpan({
      text: isLocalEnabled ? 'LPRun Ready' : 'Local Run Disabled',
      cls: `coding-exercise-status-label ${isLocalEnabled ? 'is-enabled' : 'is-disabled'}`,
    });
    status.createSpan({ text: '·', cls: 'coding-exercise-status-sep' });
    status.createSpan({
      text: `${this.plugin.settings.codingExerciseProvider} · ${this.plugin.settings.codingExerciseModel}`,
      cls: 'coding-exercise-status-model',
    });

    if (!this.controlsCollapsed) {
      this.renderControls(this.contentEl);
    }

    const body = this.contentEl.createDiv({ cls: 'coding-exercise-body' });
    this.taskContainer = body.createDiv({ cls: 'coding-exercise-task' });
    this.renderTask();

    const editorSection = body.createDiv({ cls: 'coding-exercise-editor-section' });
    const editorHeader = editorSection.createDiv({ cls: 'coding-exercise-editor-header' });
    const editorTitleGroup = editorHeader.createDiv({ cls: 'coding-exercise-editor-title-group' });
    editorTitleGroup.createEl('div', { cls: 'coding-exercise-section-title', text: 'Solution Code' });
    editorTitleGroup.createSpan({ cls: 'coding-exercise-lang-badge', text: 'C# Program' });

    const editorToolbar = editorHeader.createDiv({ cls: 'coding-exercise-editor-toolbar' });
    this.cursorStatusEl = editorToolbar.createSpan({ cls: 'coding-exercise-cursor-status', text: 'Ln 1, Col 1' });

    if (this.exercise) {
      const resetBtn = editorToolbar.createEl('button', {
        text: '↺ Reset',
        cls: 'llm-automation-btn llm-automation-btn-secondary coding-exercise-mini-btn',
        attr: { 'aria-label': 'Reset editor to original starter code' },
      });
      resetBtn.addEventListener('click', () => {
        if (!this.exercise) return;
        this.solutionCode = this.exercise.starterCode;
        if (this.editorEl) {
          this.editorEl.value = this.solutionCode;
        }
        this.updateCursorStatus();
        new Notice('Restored starter code.');
      });
    }

    const copyBtn = editorToolbar.createEl('button', {
      text: '📋 Copy',
      cls: 'llm-automation-btn llm-automation-btn-secondary coding-exercise-mini-btn',
      attr: { 'aria-label': 'Copy code to clipboard' },
    });
    copyBtn.addEventListener('click', async () => {
      const code = this.editorEl?.value ?? this.solutionCode;
      await navigator.clipboard.writeText(code);
      new Notice('Code copied to clipboard.');
    });

    this.editorEl = editorSection.createEl('textarea', {
      cls: 'coding-exercise-code-editor',
      attr: {
        spellcheck: 'false',
        placeholder: 'Generate an exercise to get starter code, or paste C# LINQPad Program code here.'
      }
    });
    this.editorEl.value = this.solutionCode;
    this.editorEl.addEventListener('input', () => {
      this.solutionCode = this.editorEl?.value ?? '';
      this.updateCursorStatus();
    });

    this.editorEl.addEventListener('keydown', (e: KeyboardEvent) => {
      if (!this.editorEl) return;

      if (e.key === 'Tab') {
        e.preventDefault();
        const res = handleTabKey(
          this.editorEl.value,
          this.editorEl.selectionStart,
          this.editorEl.selectionEnd,
          e.shiftKey
        );
        this.editorEl.value = res.text;
        this.solutionCode = res.text;
        this.editorEl.selectionStart = res.selectionStart;
        this.editorEl.selectionEnd = res.selectionEnd;
        this.updateCursorStatus();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const res = handleEnterKey(this.editorEl.value, this.editorEl.selectionStart);
        this.editorEl.value = res.text;
        this.solutionCode = res.text;
        this.editorEl.selectionStart = res.selectionStart;
        this.editorEl.selectionEnd = res.selectionEnd;
        this.updateCursorStatus();
      }
    });

    this.editorEl.addEventListener('keyup', () => this.updateCursorStatus());
    this.editorEl.addEventListener('click', () => this.updateCursorStatus());
    this.updateCursorStatus();

    this.renderActionButtons(editorSection);

    this.outputContainer = body.createDiv({ cls: 'coding-exercise-output' });
    this.renderOutput();
  }

  private updateCursorStatus(): void {
    if (!this.editorEl || !this.cursorStatusEl) return;
    const pos = this.editorEl.selectionStart;
    const val = this.editorEl.value;
    const lines = val.slice(0, pos).split('\n');
    const lineNum = lines.length;
    const colNum = lines[lines.length - 1].length + 1;
    const totalLines = val.split('\n').length;
    this.cursorStatusEl.setText(`Ln ${lineNum}, Col ${colNum} (${totalLines} lines)`);
  }

  private renderControls(container: HTMLElement): void {
    const controls = container.createDiv({ cls: 'coding-exercise-controls' });

    new Setting(controls)
      .setName('Topic')
      .setDesc('Pick a preset chip below or enter a custom C# topic.')
      .addText((text) => {
        this.topicInputEl = text.inputEl;
        text
          .setValue(this.topic)
          .setPlaceholder('Arrays, LINQ, strings, classes...')
          .onChange((value) => {
            this.topic = value.trim() || 'C# basics';
            this.updateTopicChips();
          });
      });

    const chipsRow = controls.createDiv({ cls: 'coding-exercise-topic-chips' });
    TOPIC_PRESETS.forEach((preset) => {
      const chip = chipsRow.createEl('button', {
        text: preset,
        cls: `coding-exercise-chip${this.topic.toLowerCase() === preset.toLowerCase() ? ' is-active' : ''}`,
      });
      chip.addEventListener('click', () => {
        this.topic = preset;
        if (this.topicInputEl) {
          this.topicInputEl.value = preset;
        }
        this.updateTopicChips();
      });
    });

    new Setting(controls)
      .setName('Difficulty')
      .addDropdown((dropdown) => dropdown
        .addOptions({ Easy: 'Easy', Medium: 'Medium', Hard: 'Hard' })
        .setValue(this.difficulty)
        .onChange((value) => {
          this.difficulty = value as Difficulty;
        }));

    new Setting(controls)
      .setName('Instructions')
      .addTextArea((text) => {
        text
          .setValue(this.instructions)
          .setPlaceholder('Optional: focus on a specific API, avoid LINQ, include edge cases...')
          .onChange((value) => {
            this.instructions = value;
          });
        text.inputEl.rows = 2;
      });

    const row = controls.createDiv({ cls: 'coding-exercise-control-row' });
    this.generateButton = row.createEl('button', { text: 'Generate Exercise', cls: 'mod-cta' });
    this.generateButton.addEventListener('click', () => this.generateExercise());

    const openSettingsButton = row.createEl('button', { text: 'Open Settings' });
    openSettingsButton.addEventListener('click', () => {
      (this.app as unknown as { setting?: { open: () => void; openTabById: (id: string) => void } }).setting?.open();
      (this.app as unknown as { setting?: { openTabById: (id: string) => void } }).setting?.openTabById(this.plugin.manifest.id);
    });

    const importSection = controls.createDiv({ cls: 'coding-exercise-import-section' });
    importSection.createEl('div', { cls: 'coding-exercise-section-title', text: 'StudyAssistant Import' });
    const importRow = importSection.createDiv({ cls: 'coding-exercise-import-row' });
    this.importSelect = importRow.createEl('select', { cls: 'coding-exercise-import-select' });
    this.renderImportOptions();

    this.loadCatalogButton = importRow.createEl('button', { text: 'Load Catalog' });
    this.loadCatalogButton.addEventListener('click', () => this.loadStudyAssistantCatalog());

    this.importButton = importRow.createEl('button', { text: 'Import Selected' });
    this.importButton.addEventListener('click', () => this.importSelectedStudyAssistantExercise());
  }

  private updateTopicChips(): void {
    const chips = this.contentEl.querySelectorAll<HTMLButtonElement>('.coding-exercise-chip');
    chips.forEach((chip) => {
      const isMatch = chip.textContent?.toLowerCase() === this.topic.toLowerCase();
      chip.toggleClass('is-active', isMatch);
    });
  }

  private renderActionButtons(container: HTMLElement): void {
    const actions = container.createDiv({ cls: 'coding-exercise-actions' });

    this.runButton = actions.createEl('button', {
      text: '▶ Run (Ctrl+Enter)',
      cls: 'mod-cta coding-exercise-btn-run',
      attr: { 'title': 'Execute solution locally using LINQPad LPRun (Ctrl+Enter)' }
    });
    this.runButton.addEventListener('click', () => this.runSolution());

    this.compileButton = actions.createEl('button', {
      text: 'Compile Only',
      cls: 'llm-automation-btn llm-automation-btn-secondary'
    });
    this.compileButton.addEventListener('click', () => this.compileSolution());

    this.saveButton = actions.createEl('button', {
      text: 'Save Note',
      cls: 'llm-automation-btn llm-automation-btn-secondary'
    });
    this.saveButton.addEventListener('click', () => this.saveExerciseNote());
  }

  private async renderTask(): Promise<void> {
    if (!this.taskContainer) {
      return;
    }

    this.taskContainer.empty();
    this.taskContainer.createEl('div', { cls: 'coding-exercise-section-title', text: 'Task Description' });

    if (!this.exercise) {
      this.taskContainer.createEl('div', {
        cls: 'coding-exercise-empty',
        text: 'Generate an exercise or import one to start a local compile/run learning loop.'
      });
      return;
    }

    this.taskContainer.createEl('h3', { text: this.exercise.title, cls: 'coding-exercise-title' });

    const metaRow = this.taskContainer.createDiv({ cls: 'coding-exercise-meta-row' });
    const diffClass = this.exercise.difficulty.toLowerCase();
    metaRow.createEl('span', {
      cls: `coding-exercise-badge badge-${diffClass}`,
      text: this.exercise.difficulty,
    });
    metaRow.createEl('span', {
      cls: 'coding-exercise-badge badge-concept',
      text: this.exercise.concept,
    });
    metaRow.createEl('span', {
      cls: 'coding-exercise-badge badge-runtime',
      text: 'C# LINQPad 9',
    });

    const taskMarkdown = [
      this.exercise.task,
      '',
      '#### Desired Output',
      '```text',
      this.exercise.desiredOutput,
      '```',
      this.exercise.visibleTests.length ? '#### Visible Checks' : '',
      ...this.exercise.visibleTests.map((test) => `- ${test}`),
    ].filter((line) => line !== '').join('\n');

    const markdownEl = this.taskContainer.createDiv({ cls: 'coding-exercise-markdown' });
    await MarkdownRenderer.renderMarkdown(taskMarkdown, markdownEl, '', this);

    if (this.exercise.hints && this.exercise.hints.length > 0) {
      const hintsSection = this.taskContainer.createDiv({ cls: 'coding-exercise-hints-section' });
      hintsSection.createEl('div', { cls: 'coding-exercise-subheading', text: 'Hints (Click to Reveal)' });
      this.exercise.hints.forEach((hint, idx) => {
        const details = hintsSection.createEl('details', { cls: 'coding-exercise-hint-details' });
        details.createEl('summary', { text: `💡 Hint ${idx + 1}` });
        const content = details.createDiv({ cls: 'coding-exercise-hint-body' });
        void MarkdownRenderer.renderMarkdown(hint, content, '', this);
      });
    }
  }

  private renderOutput(): void {
    if (!this.outputContainer) {
      return;
    }

    this.outputContainer.empty();

    const header = this.outputContainer.createDiv({ cls: 'coding-exercise-output-header' });
    header.createEl('div', { cls: 'coding-exercise-section-title', text: 'Output & Verification' });

    if (!this.lastRun) {
      this.outputContainer.createEl('div', {
        cls: 'coding-exercise-empty',
        text: 'Hit Run (Ctrl+Enter) or Compile to execute your solution against LINQPad.'
      });
      return;
    }

    const diff = this.exercise
      ? computeOutputDiff(this.exercise.desiredOutput, this.lastRun.stdout)
      : null;

    // Tabs
    const tabs = header.createDiv({ cls: 'coding-exercise-tabs' });
    const diffTab = tabs.createEl('button', {
      text: 'Diff',
      cls: `coding-exercise-tab-btn${this.activeOutputTab === 'diff' ? ' is-active' : ''}`
    });
    diffTab.addEventListener('click', () => {
      this.activeOutputTab = 'diff';
      this.renderOutput();
    });

    const stdoutTab = tabs.createEl('button', {
      text: 'Raw Output',
      cls: `coding-exercise-tab-btn${this.activeOutputTab === 'stdout' ? ' is-active' : ''}`
    });
    stdoutTab.addEventListener('click', () => {
      this.activeOutputTab = 'stdout';
      this.renderOutput();
    });

    const hasStderr = Boolean(this.lastRun.stderr.trim());
    const stderrTab = tabs.createEl('button', {
      text: hasStderr ? `Errors (!)` : 'Diagnostics',
      cls: `coding-exercise-tab-btn${hasStderr ? ' has-errors' : ''}${this.activeOutputTab === 'stderr' ? ' is-active' : ''}`
    });
    stderrTab.addEventListener('click', () => {
      this.activeOutputTab = 'stderr';
      this.renderOutput();
    });

    // Summary banner
    const isSuccess = this.lastRun.success && (diff ? diff.matched : true);
    const isMismatch = this.lastRun.success && diff && !diff.matched;

    const banner = this.outputContainer.createDiv({
      cls: `coding-exercise-run-banner ${isSuccess ? 'is-success' : isMismatch ? 'is-mismatch' : 'is-error'}`
    });

    if (isSuccess) {
      banner.createEl('div', { cls: 'banner-title', text: `✓ All Checks Passed! (${this.lastRun.elapsedMs}ms)` });
      banner.createEl('div', { cls: 'banner-desc', text: 'Stdout matches the desired output.' });
    } else if (isMismatch) {
      banner.createEl('div', { cls: 'banner-title', text: `⚠ Output Mismatch (${this.lastRun.elapsedMs}ms)` });
      banner.createEl('div', { cls: 'banner-desc', text: 'Program completed with exit code 0, but stdout differs from expected.' });
    } else {
      banner.createEl('div', { cls: 'banner-title', text: `✗ Execution Failed (${this.lastRun.elapsedMs}ms)` });
      banner.createEl('div', {
        cls: 'banner-desc',
        text: `Exit code ${this.lastRun.exitCode ?? 'none'}${this.lastRun.timedOut ? ' · Timed out' : ''}. Check diagnostics for compiler/runtime errors.`
      });
    }

    // Active tab body
    if (this.activeOutputTab === 'diff' && diff) {
      this.renderDiffTable(diff);
    } else if (this.activeOutputTab === 'stdout') {
      this.createOutputBlock('stdout', this.lastRun.stdout || '(empty)');
    } else if (this.activeOutputTab === 'stderr') {
      this.createOutputBlock('stderr', this.lastRun.stderr || '(no compiler/runtime errors)');
    } else {
      this.createOutputBlock('stdout', this.lastRun.stdout || '(empty)');
    }
  }

  private renderDiffTable(diff: OutputDiffResult): void {
    if (!this.outputContainer) return;

    if (diff.rows.length === 0) {
      this.outputContainer.createEl('div', { cls: 'coding-exercise-empty', text: 'No output lines to compare.' });
      return;
    }

    const table = this.outputContainer.createEl('table', { cls: 'coding-exercise-diff-table' });
    const thead = table.createEl('thead');
    const headerRow = thead.createEl('tr');
    headerRow.createEl('th', { text: '#', cls: 'coding-exercise-diff-line-num' });
    headerRow.createEl('th', { text: 'Status', cls: 'diff-status-header' });
    headerRow.createEl('th', { text: 'Expected Output' });
    headerRow.createEl('th', { text: 'Actual (Your Output)' });

    const tbody = table.createEl('tbody');
    diff.rows.forEach((row) => {
      const tr = tbody.createEl('tr', { cls: `coding-exercise-diff-row is-${row.type}` });
      tr.createEl('td', { text: String(row.lineNumber), cls: 'coding-exercise-diff-line-num' });

      const statusTd = tr.createEl('td', { cls: 'diff-status' });
      if (row.type === 'match') {
        statusTd.createSpan({ cls: 'diff-badge is-match', text: '✓ Match' });
      } else if (row.type === 'mismatch') {
        statusTd.createSpan({ cls: 'diff-badge is-mismatch', text: '≠ Diff' });
      } else if (row.type === 'missing') {
        statusTd.createSpan({ cls: 'diff-badge is-missing', text: '- Missing' });
      } else if (row.type === 'extra') {
        statusTd.createSpan({ cls: 'diff-badge is-extra', text: '+ Extra' });
      }

      tr.createEl('td', { text: row.expected ?? '(none)', cls: 'diff-expected' });
      tr.createEl('td', { text: row.actual ?? '(none)', cls: 'diff-actual' });
    });
  }

  private createOutputBlock(label: string, content: string): void {
    if (!this.outputContainer) {
      return;
    }

    const wrapper = this.outputContainer.createDiv({ cls: 'coding-exercise-output-block' });
    wrapper.createEl('div', { cls: 'coding-exercise-output-label', text: label });
    wrapper.createEl('pre', { text: content });
  }

  private async generateExercise(): Promise<void> {
    if (this.generateButton) {
      this.generateButton.disabled = true;
      this.generateButton.textContent = 'Generating...';
    }

    try {
      this.exercise = await this.plugin.services.codingExerciseGenerator.generate({
        topic: this.topic,
        difficulty: this.difficulty,
        instructions: this.instructions,
      });
      this.solutionCode = this.exercise.starterCode;
      this.lastRun = null;
      this.lastComparison = '';
      this.generatedNotePath = null;
      this.activeOutputTab = 'diff';
      if (this.editorEl) {
        this.editorEl.value = this.solutionCode;
      }
      await this.renderTask();
      this.renderOutput();
      new Notice('Coding exercise generated.');
    } catch (error) {
      console.error('Failed to generate coding exercise:', error);
      new Notice(`Failed to generate exercise: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      if (this.generateButton) {
        this.generateButton.disabled = false;
        this.generateButton.textContent = 'Generate Exercise';
      }
    }
  }

  private async loadStudyAssistantCatalog(): Promise<void> {
    if (this.loadCatalogButton) {
      this.loadCatalogButton.disabled = true;
      this.loadCatalogButton.textContent = 'Loading...';
    }

    try {
      this.importedEntries = await this.plugin.services.studyAssistantImporter.listExercises();
      this.selectedImportedId = this.importedEntries[0]?.id ?? '';
      this.renderImportOptions();
      new Notice(`Loaded ${this.importedEntries.length} StudyAssistant exercise(s).`);
    } catch (error) {
      console.error('Failed to load StudyAssistant catalog:', error);
      new Notice(`Failed to load StudyAssistant catalog: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      if (this.loadCatalogButton) {
        this.loadCatalogButton.disabled = false;
        this.loadCatalogButton.textContent = 'Load Catalog';
      }
    }
  }

  private renderImportOptions(): void {
    if (!this.importSelect) {
      return;
    }

    this.importSelect.empty();

    if (this.importedEntries.length === 0) {
      this.importSelect.createEl('option', { value: '', text: 'Load catalog first' });
      this.importSelect.disabled = true;
      return;
    }

    this.importSelect.disabled = false;
    for (const entry of this.importedEntries) {
      const option = this.importSelect.createEl('option', {
        value: entry.id,
        text: `${entry.namespace} / ${entry.difficulty} / ${entry.exerciseNumber}: ${entry.title}`
      });
      option.selected = entry.id === this.selectedImportedId;
    }

    this.importSelect.onchange = () => {
      this.selectedImportedId = this.importSelect?.value ?? '';
    };
  }

  private async importSelectedStudyAssistantExercise(): Promise<void> {
    const entry = this.importedEntries.find((candidate) => candidate.id === this.selectedImportedId);
    if (!entry) {
      new Notice('Load the StudyAssistant catalog and select an exercise first.');
      return;
    }

    if (this.importButton) {
      this.importButton.disabled = true;
      this.importButton.textContent = 'Converting...';
    }

    try {
      const imported = await this.plugin.services.studyAssistantImporter.loadExercise(entry);
      this.exercise = await this.plugin.services.codingExerciseGenerator.convertImported(imported);
      this.solutionCode = this.exercise.starterCode;
      this.lastRun = null;
      this.lastComparison = '';
      this.generatedNotePath = null;
      if (this.editorEl) {
        this.editorEl.value = this.solutionCode;
      }
      await this.renderTask();
      this.renderOutput();
      new Notice(`Imported ${entry.id}.`);
    } catch (error) {
      console.error('Failed to import StudyAssistant exercise:', error);
      new Notice(`Failed to import exercise: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      if (this.importButton) {
        this.importButton.disabled = false;
        this.importButton.textContent = 'Import Selected';
      }
    }
  }

  private async compileSolution(): Promise<void> {
    await this.executeSolution('compile');
  }

  private async runSolution(): Promise<void> {
    await this.executeSolution('run');
  }

  private async executeSolution(mode: 'compile' | 'run'): Promise<void> {
    this.solutionCode = this.editorEl?.value ?? this.solutionCode;
    if (!this.solutionCode.trim()) {
      new Notice('No solution code to run.');
      return;
    }

    this.setRunButtonsDisabled(true, mode === 'compile' ? 'Compiling...' : 'Running...');

    try {
      this.lastRun = mode === 'compile'
        ? await this.plugin.services.localCodeRunner.compileCSharpLinqPad(this.solutionCode)
        : await this.plugin.services.localCodeRunner.runCSharpLinqPad(this.solutionCode);

      this.lastComparison = mode === 'run' ? this.compareOutput(this.lastRun.stdout) : '';
      if (mode === 'compile' && this.lastRun.stderr.trim()) {
        this.activeOutputTab = 'stderr';
      } else {
        this.activeOutputTab = 'diff';
      }
      this.renderOutput();
      new Notice(mode === 'compile' ? 'Compile finished.' : 'Run finished.');
    } catch (error) {
      console.error(`Failed to ${mode} solution:`, error);
      new Notice(`Failed to ${mode}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      this.setRunButtonsDisabled(false);
    }
  }

  private setRunButtonsDisabled(disabled: boolean, activeText?: string): void {
    if (this.compileButton) {
      this.compileButton.disabled = disabled;
      this.compileButton.textContent = activeText === 'Compiling...' ? activeText : 'Compile Only';
    }
    if (this.runButton) {
      this.runButton.disabled = disabled;
      this.runButton.textContent = activeText === 'Running...' ? activeText : '▶ Run (Ctrl+Enter)';
    }
    if (this.saveButton) {
      this.saveButton.disabled = disabled;
    }
  }

  private compareOutput(stdout: string): string {
    if (!this.exercise) {
      return '';
    }

    const actual = this.normalizeOutput(stdout);
    const expected = this.normalizeOutput(this.exercise.desiredOutput);
    return actual === expected
      ? 'Output matches desired output.'
      : 'Output does not match desired output.';
  }

  private normalizeOutput(output: string): string {
    return output.replace(/\r\n/g, '\n').trim();
  }

  private async saveExerciseNote(): Promise<void> {
    if (!this.exercise) {
      new Notice('Generate an exercise first.');
      return;
    }

    this.solutionCode = this.editorEl?.value ?? this.solutionCode;

    try {
      const folder = normalizePath(this.plugin.settings.codingExercisesFolder || 'Coding Exercises');
      if (!await this.app.vault.adapter.exists(folder)) {
        await this.app.vault.createFolder(folder);
      }

      const filename = await this.resolveFilename(folder, this.exercise.title);
      const path = normalizePath(`${folder}/${filename}`);
      const content = this.buildExerciseNote();

      const existing = this.generatedNotePath ? this.app.vault.getAbstractFileByPath(this.generatedNotePath) : null;
      let file: TFile;
      if (existing instanceof TFile) {
        await this.app.vault.modify(existing, content);
        file = existing;
      } else {
        file = await this.app.vault.create(path, content);
        this.generatedNotePath = file.path;
      }

      await this.app.workspace.getLeaf(false).openFile(file);
      new Notice(`Saved coding exercise: ${file.path}`);
    } catch (error) {
      console.error('Failed to save coding exercise:', error);
      new Notice(`Failed to save exercise: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private buildExerciseNote(): string {
    const exercise = this.exercise!;
    const now = new Date().toISOString();
    const runBlock = this.lastRun
      ? [
          '## Last Run',
          '',
          `Status: ${this.lastRun.success ? 'success' : 'failed'}`,
          `Comparison: ${this.lastComparison || 'not checked'}`,
          '',
          '```text',
          this.lastRun.stdout || '(empty)',
          '```',
          this.lastRun.stderr.trim() ? '```text' : '',
          this.lastRun.stderr.trim() ? this.lastRun.stderr : '',
          this.lastRun.stderr.trim() ? '```' : '',
        ].filter(Boolean).join('\n')
      : '## Last Run\n\nNot run yet.';

    return [
      '---',
      'type: coding-exercise',
      `language: ${exercise.language}`,
      `difficulty: ${exercise.difficulty}`,
      `concept: ${this.escapeYaml(exercise.concept)}`,
      `created: ${now}`,
      '---',
      '',
      `# ${exercise.title}`,
      '',
      '## Task',
      '',
      exercise.task,
      '',
      '## Desired Output',
      '',
      '```text',
      exercise.desiredOutput,
      '```',
      '',
      '## Solution',
      '',
      '```csharp',
      this.solutionCode,
      '```',
      '',
      exercise.visibleTests.length ? '## Visible Checks' : '',
      ...exercise.visibleTests.map((test) => `- ${test}`),
      '',
      exercise.hints.length ? '## Hints' : '',
      ...exercise.hints.map((hint, index) => `${index + 1}. ${hint}`),
      '',
      runBlock,
      '',
    ].filter((line) => line !== '').join('\n');
  }

  private async resolveFilename(folder: string, title: string): Promise<string> {
    const baseName = sanitizeFilename(title, '-').toLowerCase() || 'coding-exercise';
    let filename = `${baseName}.md`;
    let counter = 1;
    while (await this.app.vault.adapter.exists(normalizePath(`${folder}/${filename}`))) {
      filename = `${baseName}-${counter}.md`;
      counter++;
    }
    return filename;
  }

  private escapeYaml(value: string): string {
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
}
