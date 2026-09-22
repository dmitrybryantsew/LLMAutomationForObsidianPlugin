import { describe, expect, it } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { buildScriptRunCommand, listPowerShellScripts } from '../../src/utils/projectLauncher';

describe('projectLauncher utilities', () => {
  describe('buildScriptRunCommand', () => {
    it('creates a proper PowerShell execution string', () => {
      const script = 'C:\\tools\\deploy.ps1';
      const cmd = buildScriptRunCommand(script);
      expect(cmd).toContain('powershell.exe -NoExit -ExecutionPolicy Bypass -File');
      expect(cmd).toContain('deploy.ps1');
    });
  });

  describe('listPowerShellScripts', () => {
    it('finds .ps1 scripts in a directory', async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-test-'));
      try {
        fs.writeFileSync(path.join(tempDir, 'build.ps1'), 'Write-Host "Build"');
        fs.writeFileSync(path.join(tempDir, 'test.PS1'), 'Write-Host "Test"');
        fs.writeFileSync(path.join(tempDir, 'notes.txt'), 'Not a script');

        const subDir = path.join(tempDir, 'sub');
        fs.mkdirSync(subDir);
        fs.writeFileSync(path.join(subDir, 'sub-script.ps1'), 'Write-Host "Sub"');

        const scripts = await listPowerShellScripts(tempDir);
        expect(scripts).toHaveLength(3);
        const names = scripts.map((s) => s.name);
        expect(names).toContain('build');
        expect(names).toContain('test');
        expect(names).toContain('sub-script');
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('returns empty array if folder does not exist', async () => {
      const scripts = await listPowerShellScripts('Z:\\nonexistent\\path\\12345');
      expect(scripts).toEqual([]);
    });
  });
});
