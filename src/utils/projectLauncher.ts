import { Notice } from 'obsidian';
import * as path from 'path';
import * as fs from 'fs';
import { ExternalProject, PowerShellScriptEntry } from '../types/projectLauncher';

function getChildProcess(): typeof import('child_process') | null {
  try {
    const req = (window as unknown as { require?: (mod: string) => typeof import('child_process') }).require;
    return req ? req('child_process') : null;
  } catch {
    return null;
  }
}

function getElectronShell(): { openPath: (path: string) => Promise<string> } | null {
  try {
    const req = (window as unknown as { require?: (mod: string) => { shell: { openPath: (p: string) => Promise<string> } } }).require;
    return req ? req('electron')?.shell : null;
  } catch {
    return null;
  }
}

/**
 * Open folder in Windows Explorer or OS default file manager.
 */
export async function openInExplorer(folderPath: string): Promise<boolean> {
  const normPath = path.normalize(folderPath);

  const shell = getElectronShell();
  if (shell?.openPath) {
    const err = await shell.openPath(normPath);
    if (!err) {
      new Notice(`Opened in Explorer: ${path.basename(normPath)}`);
      return true;
    }
  }

  const cp = getChildProcess();
  if (cp?.spawn) {
    try {
      cp.spawn('explorer.exe', [normPath], { detached: true, stdio: 'ignore' });
      new Notice(`Opened in Explorer: ${path.basename(normPath)}`);
      return true;
    } catch (e) {
      console.error('Failed to spawn explorer.exe:', e);
    }
  }

  new Notice(`Could not open folder: ${normPath}`);
  return false;
}

/**
 * Open folder or file in VS Code or configured editor command.
 */
export async function openInEditor(folderPath: string, editorCommand: string = 'code'): Promise<boolean> {
  const normPath = path.normalize(folderPath);
  const cp = getChildProcess();

  if (cp?.spawn) {
    try {
      const child = cp.spawn(editorCommand, [normPath], {
        shell: true,
        detached: true,
        stdio: 'ignore',
      });
      child.unref?.();
      new Notice(`Opened in ${editorCommand}: ${path.basename(normPath)}`);
      return true;
    } catch (e) {
      console.error(`Failed to launch editor (${editorCommand}):`, e);
      new Notice(`Failed to launch editor (${editorCommand})`);
      return false;
    }
  }

  new Notice('Child process not available to launch editor.');
  return false;
}

/**
 * Open external PowerShell terminal in the target directory.
 */
export async function openInTerminal(folderPath: string): Promise<boolean> {
  const normPath = path.normalize(folderPath);
  const cp = getChildProcess();

  if (cp?.spawn) {
    try {
      // Launch external interactive PowerShell window
      const child = cp.spawn('powershell.exe', ['-NoExit', '-WorkingDirectory', normPath], {
        shell: true,
        detached: true,
        stdio: 'ignore',
      });
      child.unref?.();
      new Notice(`Terminal opened at: ${path.basename(normPath)}`);
      return true;
    } catch (e) {
      console.error('Failed to spawn terminal:', e);
      new Notice('Failed to open terminal window.');
      return false;
    }
  }

  new Notice('Child process not available to launch terminal.');
  return false;
}

/**
 * Copy directory or file path to clipboard.
 */
export async function copyProjectPath(targetPath: string): Promise<boolean> {
  const normPath = path.normalize(targetPath);
  try {
    await navigator.clipboard.writeText(normPath);
    new Notice(`Copied path: ${normPath}`);
    return true;
  } catch (e) {
    console.error('Failed to copy path to clipboard:', e);
    new Notice('Failed to copy path to clipboard');
    return false;
  }
}

/**
 * Build execution command string for a PowerShell script.
 */
export function buildScriptRunCommand(scriptPath: string): string {
  const norm = path.normalize(scriptPath);
  return `powershell.exe -NoExit -ExecutionPolicy Bypass -File "${norm}"`;
}

/**
 * Execute a PowerShell script in a detached external terminal window.
 */
export async function runPowerShellScript(scriptPath: string, workingDir?: string): Promise<boolean> {
  const normScript = path.normalize(scriptPath);
  const cwd = workingDir ? path.normalize(workingDir) : path.dirname(normScript);
  const cp = getChildProcess();

  if (cp?.spawn) {
    try {
      const child = cp.spawn(
        'powershell.exe',
        ['-NoExit', '-ExecutionPolicy', 'Bypass', '-File', normScript],
        {
          cwd,
          shell: true,
          detached: true,
          stdio: 'ignore',
        }
      );
      child.unref?.();
      new Notice(`Running script: ${path.basename(normScript)}`);
      return true;
    } catch (e) {
      console.error('Failed to run script:', e);
      new Notice(`Failed to execute script: ${path.basename(normScript)}`);
      return false;
    }
  }

  new Notice('Child process not available to run script.');
  return false;
}

/**
/**
 * Synchronously scan folder for PowerShell (.ps1) script files.
 */
export function listPowerShellScriptsSync(folderPath: string): PowerShellScriptEntry[] {
  const normFolder = path.normalize(folderPath);

  if (!fs.existsSync(normFolder)) {
    return [];
  }

  const results: PowerShellScriptEntry[] = [];

  function scan(currentDir: string, depth = 0): void {
    if (depth > 2) return;
    try {
      const entries = fs.readdirSync(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(currentDir, entry.name);
        if (entry.isDirectory()) {
          if (!entry.name.startsWith('.') && entry.name !== 'node_modules' && entry.name !== 'bin' && entry.name !== 'obj') {
            scan(full, depth + 1);
          }
        } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.ps1')) {
          const rel = path.relative(normFolder, full);
          let sizeBytes: number | undefined;
          let modifiedAt: number | undefined;
          try {
            const stat = fs.statSync(full);
            sizeBytes = stat.size;
            modifiedAt = stat.mtimeMs;
          } catch {
            // ignore
          }

          const baseNameWithoutExt = entry.name.replace(/\.ps1$/i, '');
          results.push({
            name: baseNameWithoutExt,
            filename: entry.name,
            fullPath: full,
            relativePath: rel,
            sizeBytes,
            modifiedAt,
          });
        }
      }
    } catch (e) {
      console.error(`Error scanning directory for scripts: ${currentDir}`, e);
    }
  }

  scan(normFolder);
  return results.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Scan folder for PowerShell (.ps1) script files (async wrapper).
 */
export async function listPowerShellScripts(folderPath: string): Promise<PowerShellScriptEntry[]> {
  return listPowerShellScriptsSync(folderPath);
}
