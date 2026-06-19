import { ItemView, MarkdownRenderer, Notice, Setting, TFile, WorkspaceLeaf, normalizePath } from 'obsidian';
import type GptFreeTextGeneratorPlugin from '../main';
import { VIEW_TYPE_CODING_EXERCISES } from '../constants';
import { CodingExercise, LocalRunResult } from '../types/codingExercise';
import { sanitizeFilename } from '../utils/helpers';
import { StudyAssistantExerciseEntry } from '../types/codingExercise';

type Difficulty = 'Easy' | 'Medium' | 'Hard';

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
    this.render();
  }

  async onClose(): Promise<void> {
    return;
  }

  private render(): void {
    this.contentEl.empty();
    this.contentEl.addClass('coding-exercise-view');

    const header = this.contentEl.createDiv({ cls: 'coding-exercise-header' });
    header.createEl('h2', { text: 'Coding Exercises' });
    const status = header.createDiv({ cls: 'coding-exercise-status' });
    status.setText(`${this.plugin.settings.codingExerciseProvider} · ${this.plugin.settings.codingExerciseModel} · ${this.plugin.settings.allowLocalCodeExecution ? 'local run enabled' : 'local run disabled'}`);

    this.renderControls(this.contentEl);

    const body = this.contentEl.createDiv({ cls: 'coding-exercise-body' });
    this.taskContainer = body.createDiv({ cls: 'coding-exercise-task' });
    this.renderTask();

    const editorSection = body.createDiv({ cls: 'coding-exercise-editor-section' });
    editorSection.createEl('div', { cls: 'coding-exercise-section-title', text: 'Solution' });
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
    });

    this.renderActionButtons(editorSection);

    this.outputContainer = body.createDiv({ cls: 'coding-exercise-output' });
    this.renderOutput();
  }

  private renderControls(container: HTMLElement): void {
    const controls = container.createDiv({ cls: 'coding-exercise-controls' });

    new Setting(controls)
      .setName('Topic')
      .addText((text) => text
        .setValue(this.topic)
        .setPlaceholder('Arrays, LINQ, strings, classes...')
        .onChange((value) => {
          this.topic = value.trim() || 'C# basics';
        }));

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

  private renderActionButtons(container: HTMLElement): void {
    const actions = container.createDiv({ cls: 'coding-exercise-actions' });

    this.compileButton = actions.createEl('button', { text: 'Compile' });
    this.compileButton.addEventListener('click', () => this.compileSolution());

    this.runButton = actions.createEl('button', { text: 'Run', cls: 'mod-cta' });
    this.runButton.addEventListener('click', () => this.runSolution());

    this.saveButton = actions.createEl('button', { text: 'Save Exercise Note' });
    this.saveButton.addEventListener('click', () => this.saveExerciseNote());
  }

  private async renderTask(): Promise<void> {
    if (!this.taskContainer) {
      return;
    }

    this.taskContainer.empty();
    this.taskContainer.createEl('div', { cls: 'coding-exercise-section-title', text: 'Task' });

    if (!this.exercise) {
      this.taskContainer.createEl('div', {
        cls: 'coding-exercise-empty',
        text: 'Generate an exercise to start a local compile/run learning loop.'
      });
      return;
    }

    this.taskContainer.createEl('h3', { text: this.exercise.title });
    this.taskContainer.createEl('div', {
      cls: 'coding-exercise-meta',
      text: `${this.exercise.concept} · ${this.exercise.difficulty} · C# LINQPad`
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
      this.exercise.hints.length ? '#### Hints' : '',
      ...this.exercise.hints.map((hint, index) => `${index + 1}. ${hint}`),
    ].filter((line) => line !== '').join('\n');

    const markdownEl = this.taskContainer.createDiv({ cls: 'coding-exercise-markdown' });
    await MarkdownRenderer.renderMarkdown(taskMarkdown, markdownEl, '', this);
  }

  private renderOutput(): void {
    if (!this.outputContainer) {
      return;
    }

    this.outputContainer.empty();
    this.outputContainer.createEl('div', { cls: 'coding-exercise-section-title', text: 'Output' });

    if (!this.lastRun) {
      this.outputContainer.createEl('div', {
        cls: 'coding-exercise-empty',
        text: 'No run yet.'
      });
      return;
    }

    const summary = this.outputContainer.createDiv({
      cls: `coding-exercise-run-summary ${this.lastRun.success ? 'coding-exercise-run-ok' : 'coding-exercise-run-failed'}`
    });
    summary.setText(`${this.lastRun.success ? 'Success' : 'Failed'} · exit ${this.lastRun.exitCode ?? 'none'} · ${this.lastRun.elapsedMs}ms${this.lastRun.timedOut ? ' · timed out' : ''}`);

    if (this.lastComparison) {
      this.outputContainer.createEl('div', { cls: 'coding-exercise-comparison', text: this.lastComparison });
    }

    this.createOutputBlock('stdout', this.lastRun.stdout || '(empty)');
    if (this.lastRun.stderr.trim()) {
      this.createOutputBlock('stderr', this.lastRun.stderr);
    }
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
      this.compileButton.textContent = activeText === 'Compiling...' ? activeText : 'Compile';
    }
    if (this.runButton) {
      this.runButton.disabled = disabled;
      this.runButton.textContent = activeText === 'Running...' ? activeText : 'Run';
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
