import { App, normalizePath } from 'obsidian';
import * as path from './pathUtils';
import { getNodeChildProcess, getNodeFsPromises } from './nodeModules';
import { PluginSettings } from '../types';
import { LocalRunResult } from '../types/codingExercise';

export class LocalCodeRunner {
  constructor(
    private app: App,
    private settings: PluginSettings
  ) {}

  updateSettings(settings: PluginSettings): void {
    this.settings = settings;
  }

  async runCSharpLinqPad(code: string): Promise<LocalRunResult> {
    this.assertExecutionAllowed();

    const startedAt = Date.now();
    const tempDir = await this.ensureTempDir();
    const scriptPath = path.join(tempDir, `exercise-${Date.now()}.linq`);
    const fsPromises = getNodeFsPromises();
    if (!fsPromises?.writeFile) {
      throw new Error('Filesystem access is not available on this platform.');
    }
    await fsPromises.writeFile(scriptPath, code, 'utf8');

    return this.runProcess(this.settings.linqPadLprunPath, [
      '-format=text',
      '-noinfo',
      '-lang=Program',
      scriptPath
    ], startedAt);
  }

  async compileCSharpLinqPad(code: string): Promise<LocalRunResult> {
    this.assertExecutionAllowed();

    const startedAt = Date.now();
    const tempDir = await this.ensureTempDir();
    const scriptPath = path.join(tempDir, `exercise-${Date.now()}.linq`);
    const fsPromises = getNodeFsPromises();
    if (!fsPromises?.writeFile) {
      throw new Error('Filesystem access is not available on this platform.');
    }
    await fsPromises.writeFile(scriptPath, code, 'utf8');

    return this.runProcess(this.settings.linqPadLprunPath, [
      '-compileonly',
      '-noinfo',
      '-lang=Program',
      scriptPath
    ], startedAt);
  }

  private assertExecutionAllowed(): void {
    if (!this.settings.allowLocalCodeExecution) {
      throw new Error('Local code execution is disabled in plugin settings.');
    }

    if (!this.settings.linqPadLprunPath.trim()) {
      throw new Error('LINQPad LPRun path is not configured.');
    }

    const cp = getNodeChildProcess();
    const fsPromises = getNodeFsPromises();
    if (!cp?.spawn || !fsPromises?.writeFile) {
      throw new Error('Local code execution is only available in Desktop Obsidian.');
    }
  }

  private async ensureTempDir(): Promise<string> {
    const relativePath = normalizePath(`${this.app.vault.configDir}/plugins/gpt4free-text-generator-plugin/coding-exercise-temp`);
    const basePath = (this.app.vault.adapter as unknown as { basePath?: string }).basePath;
    const absolutePath = basePath ? path.join(basePath, relativePath) : relativePath;
    const fsPromises = getNodeFsPromises();
    if (fsPromises?.mkdir) {
      await fsPromises.mkdir(absolutePath, { recursive: true });
    }
    return absolutePath;
  }

  private runProcess(command: string, args: string[], startedAt: number): Promise<LocalRunResult> {
    const timeoutMs = Math.max(1000, this.settings.exerciseRunTimeoutMs || 10000);
    const cp = getNodeChildProcess();
    if (!cp?.spawn) {
      return Promise.reject(new Error('Process execution is not available on this platform.'));
    }

    return new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      let settled = false;
      let timedOut = false;

      const child = cp.spawn(command, args, {
        windowsHide: true,
        shell: false,
      });

      const timer = window.setTimeout(() => {
        timedOut = true;
        child.kill();
      }, timeoutMs);

      child.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString('utf8');
      });

      child.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString('utf8');
      });

      child.on('error', (error) => {
        if (settled) {
          return;
        }
        settled = true;
        window.clearTimeout(timer);
        reject(error);
      });

      child.on('close', (code) => {
        if (settled) {
          return;
        }
        settled = true;
        window.clearTimeout(timer);
        resolve({
          success: code === 0 && !timedOut,
          timedOut,
          exitCode: code,
          stdout,
          stderr,
          elapsedMs: Date.now() - startedAt,
        });
      });
    });
  }
}
