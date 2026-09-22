export type ProjectAction = 'explorer' | 'editor' | 'terminal' | 'copy' | 'scripts';

export interface ExternalProject {
  id: string;
  name: string;
  path: string;
  defaultAction?: ProjectAction;
  editorCommand?: string;
  isScriptFolder?: boolean;
  description?: string;
}

export interface PowerShellScriptEntry {
  name: string;
  filename: string;
  fullPath: string;
  relativePath: string;
  sizeBytes?: number;
  modifiedAt?: number;
}
