import { App, FuzzyMatch, FuzzySuggestModal, Notice } from 'obsidian';
import { PowerShellScriptEntry } from '../types/projectLauncher';
import {
  listPowerShellScriptsSync,
  runPowerShellScript,
  openInEditor,
  copyProjectPath,
  buildScriptRunCommand,
  openInTerminal,
} from '../utils/projectLauncher';
import type GptFreeTextGeneratorPlugin from '../main';

export class PowerShellScriptLauncherModal extends FuzzySuggestModal<PowerShellScriptEntry> {
  private plugin: GptFreeTextGeneratorPlugin;
  private folderPath: string;
  private folderName: string;
  private scripts: PowerShellScriptEntry[] = [];

  constructor(
    app: App,
    plugin: GptFreeTextGeneratorPlugin,
    folderPath: string,
    folderName: string = 'Scripts'
  ) {
    super(app);
    this.plugin = plugin;
    this.folderPath = folderPath;
    this.folderName = folderName;
    this.scripts = listPowerShellScriptsSync(this.folderPath);

    this.setPlaceholder(`Search scripts in ${this.folderName} (${this.scripts.length} available)...`);
    this.setInstructions([
      { command: '↵', purpose: 'Run Script' },
      { command: 'Ctrl ↵', purpose: 'Edit in VS Code' },
      { command: 'Alt ↵', purpose: 'Open Terminal' },
      { command: 'Shift ↵', purpose: 'Copy Command' },
    ]);
  }

  getItems(): PowerShellScriptEntry[] {
    return this.scripts;
  }

  getItemText(item: PowerShellScriptEntry): string {
    return `${item.name} ${item.relativePath} ${item.filename}`;
  }

  renderSuggestion(match: FuzzyMatch<PowerShellScriptEntry>, el: HTMLElement): void {
    const script = match.item;
    el.addClass('project-launcher-suggestion-row');

    const mainCol = el.createDiv({ cls: 'project-launcher-main-col' });
    const headerRow = mainCol.createDiv({ cls: 'project-launcher-header-row' });
    
    headerRow.createSpan({ cls: 'project-launcher-icon', text: '📜' });
    headerRow.createSpan({ cls: 'project-launcher-title', text: `${script.name}.ps1` });

    if (script.sizeBytes !== undefined) {
      const sizeKb = (script.sizeBytes / 1024).toFixed(1);
      headerRow.createSpan({ cls: 'project-launcher-badge size-badge', text: `${sizeKb} KB` });
    }

    mainCol.createDiv({ cls: 'project-launcher-path', text: script.relativePath });

    // Action buttons for mouse clicks
    const actionsCol = el.createDiv({ cls: 'project-launcher-btn-group' });

    const runBtn = actionsCol.createEl('button', {
      cls: 'project-action-btn project-action-btn-primary',
      text: '▶ Run',
    });
    runBtn.onclick = async (e) => {
      e.stopPropagation();
      this.close();
      await runPowerShellScript(script.fullPath, this.folderPath);
    };

    const editBtn = actionsCol.createEl('button', {
      cls: 'project-action-btn',
      text: '✏️ Edit',
    });
    editBtn.onclick = async (e) => {
      e.stopPropagation();
      this.close();
      await openInEditor(script.fullPath);
    };

    const copyBtn = actionsCol.createEl('button', {
      cls: 'project-action-btn',
      text: '📋 Copy Cmd',
    });
    copyBtn.onclick = async (e) => {
      e.stopPropagation();
      this.close();
      const cmd = buildScriptRunCommand(script.fullPath);
      await copyProjectPath(cmd);
      new Notice(`Copied run command for: ${script.filename}`);
    };
  }

  async onChooseItem(item: PowerShellScriptEntry, evt: MouseEvent | KeyboardEvent): Promise<void> {
    const isCtrl = evt.ctrlKey || evt.metaKey;
    const isShift = evt.shiftKey;
    const isAlt = evt.altKey;

    if (isShift) {
      const cmd = buildScriptRunCommand(item.fullPath);
      await copyProjectPath(cmd);
      new Notice(`Copied run command: ${item.filename}`);
      return;
    }

    if (isCtrl) {
      await openInEditor(item.fullPath);
      return;
    }

    if (isAlt) {
      await openInTerminal(this.folderPath);
      return;
    }

    // Default: run script
    await runPowerShellScript(item.fullPath, this.folderPath);
  }
}
