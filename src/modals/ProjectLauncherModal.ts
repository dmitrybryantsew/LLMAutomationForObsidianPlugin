import { App, FuzzyMatch, FuzzySuggestModal } from 'obsidian';
import { ExternalProject } from '../types/projectLauncher';
import {
  openInExplorer,
  openInEditor,
  openInTerminal,
  copyProjectPath,
} from '../utils/projectLauncher';
import type GptFreeTextGeneratorPlugin from '../main';
import { PowerShellScriptLauncherModal } from './PowerShellScriptLauncherModal';

export class ProjectLauncherModal extends FuzzySuggestModal<ExternalProject> {
  private plugin: GptFreeTextGeneratorPlugin;

  constructor(app: App, plugin: GptFreeTextGeneratorPlugin) {
    super(app);
    this.plugin = plugin;

    this.setPlaceholder('Search projects and toolsets...');
    this.setInstructions([
      { command: '↵', purpose: 'Open (Explorer / Scripts)' },
      { command: 'Ctrl ↵', purpose: 'Open in VS Code' },
      { command: 'Alt ↵', purpose: 'Open Terminal' },
      { command: 'Shift ↵', purpose: 'Copy Path' },
    ]);
  }

  getItems(): ExternalProject[] {
    return this.plugin.settings.externalProjects || [];
  }

  getItemText(item: ExternalProject): string {
    return `${item.name} ${item.path} ${item.description || ''}`;
  }

  renderSuggestion(match: FuzzyMatch<ExternalProject>, el: HTMLElement): void {
    const project = match.item;
    el.addClass('project-launcher-suggestion-row');

    const mainCol = el.createDiv({ cls: 'project-launcher-main-col' });
    const headerRow = mainCol.createDiv({ cls: 'project-launcher-header-row' });

    const icon = project.isScriptFolder ? '⚡' : '📁';
    headerRow.createSpan({ cls: 'project-launcher-icon', text: icon });
    headerRow.createSpan({ cls: 'project-launcher-title', text: project.name });

    if (project.isScriptFolder) {
      headerRow.createSpan({
        cls: 'project-launcher-badge script-badge',
        text: 'PowerShell Scripts',
      });
    }

    mainCol.createDiv({ cls: 'project-launcher-path', text: project.path });

    if (project.description) {
      mainCol.createDiv({ cls: 'project-launcher-desc', text: project.description });
    }

    // Action buttons for mouse users
    const actionsCol = el.createDiv({ cls: 'project-launcher-btn-group' });

    if (project.isScriptFolder) {
      const scriptsBtn = actionsCol.createEl('button', {
        cls: 'project-action-btn project-action-btn-primary',
        text: '📜 Scripts',
      });
      scriptsBtn.onclick = (e) => {
        e.stopPropagation();
        this.close();
        new PowerShellScriptLauncherModal(this.app, this.plugin, project.path, project.name).open();
      };
    }

    const explorerBtn = actionsCol.createEl('button', {
      cls: 'project-action-btn',
      text: '📁 Explorer',
    });
    explorerBtn.onclick = async (e) => {
      e.stopPropagation();
      this.close();
      await openInExplorer(project.path);
    };

    const codeBtn = actionsCol.createEl('button', {
      cls: 'project-action-btn',
      text: '💻 Code',
    });
    codeBtn.onclick = async (e) => {
      e.stopPropagation();
      this.close();
      await openInEditor(project.path, project.editorCommand || 'code');
    };

    const termBtn = actionsCol.createEl('button', {
      cls: 'project-action-btn',
      text: '⚡ Terminal',
    });
    termBtn.onclick = async (e) => {
      e.stopPropagation();
      this.close();
      await openInTerminal(project.path);
    };

    const copyBtn = actionsCol.createEl('button', {
      cls: 'project-action-btn',
      text: '📋 Copy',
    });
    copyBtn.onclick = async (e) => {
      e.stopPropagation();
      this.close();
      await copyProjectPath(project.path);
    };
  }

  async onChooseItem(item: ExternalProject, evt: MouseEvent | KeyboardEvent): Promise<void> {
    const isCtrl = evt.ctrlKey || evt.metaKey;
    const isAlt = evt.altKey;
    const isShift = evt.shiftKey;

    if (isShift) {
      await copyProjectPath(item.path);
      return;
    }

    if (isCtrl) {
      await openInEditor(item.path, item.editorCommand || 'code');
      return;
    }

    if (isAlt) {
      await openInTerminal(item.path);
      return;
    }

    // Default action:
    if (item.isScriptFolder) {
      new PowerShellScriptLauncherModal(this.app, this.plugin, item.path, item.name).open();
      return;
    }

    if (item.defaultAction === 'editor') {
      await openInEditor(item.path, item.editorCommand || 'code');
    } else if (item.defaultAction === 'terminal') {
      await openInTerminal(item.path);
    } else {
      await openInExplorer(item.path);
    }
  }
}
