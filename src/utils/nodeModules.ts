/**
 * Safely access Node.js built-in modules in Obsidian desktop or Vitest
 * without throwing when evaluated in Obsidian mobile (Android/iOS).
 */

export function getNodeRequire(): ((moduleName: string) => any) | null {
  try {
    const win = typeof window !== 'undefined' ? (window as any) : null;
    if (win && typeof win.require === 'function') {
      return win.require;
    }
    const glob = typeof globalThis !== 'undefined' ? (globalThis as any) : null;
    if (glob && typeof glob.require === 'function') {
      return glob.require;
    }
  } catch {}
  return null;
}

function getBuiltin(name: string): any {
  try {
    const req = getNodeRequire();
    if (req) {
      try {
        return req(name);
      } catch {}
    }
    const proc = typeof process !== 'undefined' ? (process as any) : null;
    if (proc && typeof proc.getBuiltinModule === 'function') {
      return proc.getBuiltinModule(name);
    }
  } catch {}
  return null;
}

export function getNodeChildProcess(): typeof import('child_process') | null {
  return getBuiltin('child_process');
}

export function getNodeFs(): typeof import('fs') | null {
  return getBuiltin('fs');
}

export function getNodeFsPromises(): typeof import('fs/promises') | null {
  const fsp = getBuiltin('fs/promises');
  if (fsp) return fsp;
  const fs = getBuiltin('fs');
  return fs?.promises || null;
}

export function isNodeAvailable(): boolean {
  return getNodeChildProcess() !== null || getNodeFs() !== null;
}
