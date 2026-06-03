import { vi } from 'vitest';
import { TFile } from 'obsidian';

// Mock TFile class that extends the real TFile to pass instanceof checks
export class MockTFile extends TFile {
  stat: { mtime: number; size: number; ctime: number };
  content: string;

  constructor(path: string, content: string = '') {
    super();
    this.path = path;
    this.content = content;
    const now = Date.now();
    this.stat = {
      mtime: now,
      size: content.length,
      ctime: now
    };
    // Set required TFile properties
    this.name = path.split('/').pop() || '';
    this.extension = path.split('.').pop() || '';
    this.basename = this.name.replace(/\.[^/.]+$/, '');
  }

  setContent(content: string) {
    this.content = content;
    this.stat.size = content.length;
    this.stat.mtime = Date.now();
  }
}

// Mock Vault adapter
export const mockVaultAdapter = {
  exists: vi.fn(),
  write: vi.fn(),
  read: vi.fn(),
  mkdir: vi.fn(),
  rmdir: vi.fn(),
  remove: vi.fn(),
  list: vi.fn()
};

// Mock Vault
export const mockVault = {
  create: vi.fn(),
  modify: vi.fn(),
  read: vi.fn(),
  delete: vi.fn(),
  getAbstractFileByPath: vi.fn(),
  getMarkdownFiles: vi.fn(),
  createFolder: vi.fn(),
  adapter: mockVaultAdapter
};

// Mock App
export const mockApp = {
  vault: mockVault,
  metadataCache: {
    getFileCache: vi.fn()
  }
};

// Global files map accessible for test manipulation
let globalFilesMap: Map<string, MockTFile> | null = null;

// Helper to create mock file
export function createMockFile(path: string, content: string = ''): MockTFile {
  return new MockTFile(path, content);
}

// Helper to add a file to the mock vault (for tests that need to add files after setup)
export function addMockFile(path: string, content: string = ''): MockTFile {
  if (!globalFilesMap) {
    throw new Error('Mock vault not initialized. Call setupMockVault() first.');
  }
  const file = new MockTFile(path, content);
  globalFilesMap.set(path, file);
  return file;
}

// Helper to get the current files map (for tests that need to inspect it)
export function getMockFilesMap(): Map<string, MockTFile> {
  if (!globalFilesMap) {
    throw new Error('Mock vault not initialized. Call setupMockVault() first.');
  }
  return globalFilesMap;
}

// Helper to setup mock vault for file operations
export function setupMockVault() {
  const files = new Map<string, MockTFile>();
  globalFilesMap = files;

  mockVault.create.mockImplementation(async (path: string, content: string) => {
    const file = new MockTFile(path, content);
    files.set(path, file);
    return file;
  });

  mockVault.modify.mockImplementation(async (file: MockTFile, content: string) => {
    file.setContent(content);
  });

  mockVault.read.mockImplementation(async (file: MockTFile) => {
    return file.content;
  });

  mockVault.delete.mockImplementation(async (file: MockTFile) => {
    files.delete(file.path);
  });

  mockVault.getAbstractFileByPath.mockImplementation((path: string) => {
    return files.get(path) || null;
  });

  mockVault.getMarkdownFiles.mockImplementation(() => {
    return Array.from(files.values());
  });

  mockVaultAdapter.exists.mockImplementation(async (path: string) => {
    return files.has(path);
  });

  return { files };
}

// Helper to reset all mocks
export function resetMocks() {
  mockVault.create.mockClear();
  mockVault.modify.mockClear();
  mockVault.read.mockClear();
  mockVault.delete.mockClear();
  mockVault.getAbstractFileByPath.mockClear();
  mockVault.getMarkdownFiles.mockClear();
  mockVault.createFolder.mockClear();
  mockVaultAdapter.exists.mockClear();
  // Don't clear globalFilesMap, just reset the mock implementations
}