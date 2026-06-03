// Stub for Obsidian API to allow tests to run without the actual Obsidian package
export class TFile {
  path: string;
  stat: { mtime: number; size: number };
  
  constructor(path: string) {
    this.path = path;
    this.stat = { mtime: Date.now(), size: 0 };
  }
}

export class TFolder {
  path: string;
  
  constructor(path: string) {
    this.path = path;
  }
}

export class TAbstractFile {
  path: string;
  
  constructor(path: string) {
    this.path = path;
  }
}

export class Notice {
  constructor(message: string, duration?: number) {
    // Stub implementation
  }
}

export class Modal {
  constructor(app: any) {
    // Stub implementation
  }
  
  onOpen() {
    // Stub implementation
  }
  
  onClose() {
    // Stub implementation
  }
}

export class Setting {
  constructor(containerEl: any) {
    // Stub implementation
  }
  
  setName(name: string) {
    return this;
  }
  
  setDesc(desc: string) {
    return this;
  }
  
  addText(callback: any) {
    return this;
  }
  
  addDropdown(callback: any) {
    return this;
  }
  
  addButton(callback: any) {
    return this;
  }
}

export class Menu {
  constructor(app: any) {
    // Stub implementation
  }
  
  addItem(callback: any) {
    return this;
  }
}

export class MenuItem {
  constructor(menu: any) {
    // Stub implementation
  }
  
  setTitle(title: string) {
    return this;
  }
  
  onClick(callback: any) {
    return this;
  }
}

export function normalizePath(path: string): string {
  return path.replace(/\\/g, '/');
}

export function getAllTags(cache: any): Record<string, number> | null {
  return cache?.frontmatter?.tags || {};
}

// Re-export from obsidianMock for convenience
export { mockVault, mockApp, setupMockVault, resetMocks, MockTFile, createMockFile } from './obsidianMock';
export interface RequestUrlParam {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string | ArrayBuffer;
  throw?: boolean;
}

export async function requestUrl(params: RequestUrlParam): Promise<any> {
  const fetchImpl = (globalThis as any).fetch;
  if (typeof fetchImpl !== 'function') {
    throw new Error('global.fetch mock is not configured');
  }

  const response = await fetchImpl(params.url, {
    method: params.method,
    headers: params.headers,
    body: params.body
  });

  const status = response.status ?? (response.ok === false ? 500 : 200);
  const headers = response.headers ?? {};
  const json = typeof response.json === 'function' ? await response.json() : response.json;
  const text = typeof response.text === 'function' ? await response.text() : response.text ?? JSON.stringify(json ?? '');

  return { status, headers, json, text };
}
