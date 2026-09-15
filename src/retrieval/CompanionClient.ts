import { RetrievalChunkDraft } from '../types/retrieval';

export interface CompanionStatus {
  running: boolean;
  version: string;
  capabilities: string[];
  allowlistSize: number;
  defaultIncludeGlobs: string[];
  defaultExcludeGlobs: string[];
}

export interface CompanionScannedFile {
  relativePath: string;
  absolutePath: string;
  sizeBytes: number;
  modifiedTime: number;
  extension: string;
  tooLarge: boolean;
}

export interface CompanionScanResult {
  root: string;
  totalFiles: number;
  includedFiles: CompanionScannedFile[];
  skippedReasons: Record<string, number>;
}

export interface CompanionGitInfo {
  available: boolean;
  branch: string | null;
  commitSha: string | null;
  originUrl: string | null;
  dirty: boolean | null;
  error: string | null;
}

export interface CompanionIndexResult {
  sourceId: string;
  root: string;
  chunkCount: number;
  fileCount: number;
  errors: Record<string, number>;
  chunks: RetrievalChunkDraft[];
}

export interface CompanionAllowlistEntry {
  id: string;
  path: string;
  addedAt: number;
}

export interface CompanionPdfFile {
  relativePath: string;
  bytes: number;
  modifiedAt: number;
}

export interface CompanionPdfChapter {
  title: string;
  level: number;
  startPage: number;
  endPage: number;
}

export interface CompanionPdfInfo {
  path: string;
  pageCount: number;
  hasOutline: boolean;
  chapters: CompanionPdfChapter[];
}

export interface CompanionPdfPage {
  page: number;
  text: string;
}

export interface CompanionPdfParagraph {
  page: number;
  paragraphIndex: number;
  text: string;
}

export interface CompanionScanRequest {
  rootPath: string;
  includeGlobs?: string[];
  excludeGlobs?: string[];
  maxFileBytes?: number;
}

export interface CompanionIndexRequest {
  sourceId: string;
  rootPath: string;
  files?: CompanionScannedFile[];
  includeGlobs?: string[];
  excludeGlobs?: string[];
  maxFileBytes?: number;
}

export class CompanionClient {
  private endpoint: string;
  private cachedStatus: CompanionStatus | null = null;
  private lastStatusCheck = 0;
  private statusCheckIntervalMs = 5000;

  constructor(endpoint: string) {
    this.endpoint = endpoint.replace(/\/$/, '');
  }

  setEndpoint(endpoint: string): void {
    this.endpoint = endpoint.replace(/\/$/, '');
    this.cachedStatus = null;
  }

  async checkStatus(force = false): Promise<CompanionStatus | null> {
    const now = Date.now();
    if (!force && this.cachedStatus && now - this.lastStatusCheck < this.statusCheckIntervalMs) {
      return this.cachedStatus;
    }

    try {
      const res = await fetch(`${this.endpoint}/status`, {
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) return null;
      const status = await res.json() as CompanionStatus;
      this.cachedStatus = status;
      this.lastStatusCheck = now;
      return status;
    } catch {
      this.cachedStatus = null;
      return null;
    }
  }

  isAvailable(): boolean {
    return this.cachedStatus?.running === true;
  }

  async getSources(): Promise<CompanionAllowlistEntry[]> {
    const res = await fetch(`${this.endpoint}/sources`);
    if (!res.ok) throw new Error(`Companion /sources failed: ${res.status}`);
    const data = await res.json();
    return data.roots as CompanionAllowlistEntry[];
  }

  async addAllowlistRoot(id: string, path: string): Promise<CompanionAllowlistEntry[]> {
    const res = await fetch(`${this.endpoint}/allowlist/add`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, path }),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Companion allowlist/add failed: ${res.status} ${err}`);
    }
    const data = await res.json();
    return data.roots as CompanionAllowlistEntry[];
  }

  async removeAllowlistRoot(id: string): Promise<CompanionAllowlistEntry[]> {
    const res = await fetch(`${this.endpoint}/allowlist/remove`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    if (!res.ok) throw new Error(`Companion allowlist/remove failed: ${res.status}`);
    const data = await res.json();
    return data.roots as CompanionAllowlistEntry[];
  }

  async scanSource(req: CompanionScanRequest): Promise<CompanionScanResult> {
    const res = await fetch(`${this.endpoint}/source/scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    });
    if (res.status === 403) {
      throw new Error(`Companion rejected path (not allowlisted): ${req.rootPath}`);
    }
    if (!res.ok) throw new Error(`Companion /source/scan failed: ${res.status}`);
    return await res.json() as CompanionScanResult;
  }

  async getGitInfo(rootPath: string): Promise<CompanionGitInfo> {
    const res = await fetch(`${this.endpoint}/source/git-info`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rootPath }),
    });
    if (res.status === 403) {
      throw new Error(`Companion rejected path (not allowlisted): ${rootPath}`);
    }
    if (!res.ok) throw new Error(`Companion /source/git-info failed: ${res.status}`);
    return await res.json() as CompanionGitInfo;
  }

  async indexSource(req: CompanionIndexRequest): Promise<CompanionIndexResult> {
    const res = await fetch(`${this.endpoint}/source/index`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    });
    if (res.status === 403) {
      throw new Error(`Companion rejected path (not allowlisted): ${req.rootPath}`);
    }
    if (!res.ok) throw new Error(`Companion /source/index failed: ${res.status}`);
    return await res.json() as CompanionIndexResult;
  }

  supportsPdf(): boolean {
    return this.cachedStatus?.capabilities?.includes('pdf') === true;
  }

  async listPdfs(rootPath: string): Promise<CompanionPdfFile[]> {
    const res = await this.postPdf(`${this.endpoint}/pdf/list`, { path: rootPath });
    const data = await res.json();
    return data.files as CompanionPdfFile[];
  }

  async getPdfInfo(pdfPath: string): Promise<CompanionPdfInfo> {
    const res = await this.postPdf(`${this.endpoint}/pdf/info`, { path: pdfPath });
    return await res.json() as CompanionPdfInfo;
  }

  async getPdfText(
    pdfPath: string,
    startPage: number,
    endPage: number,
  ): Promise<CompanionPdfPage[]> {
    const res = await this.postPdf(`${this.endpoint}/pdf/text`, {
      path: pdfPath,
      startPage,
      endPage,
    });
    const data = await res.json();
    return data.pages as CompanionPdfPage[];
  }

  async getPdfParagraphs(
    pdfPath: string,
    startPage: number,
    endPage: number,
  ): Promise<CompanionPdfParagraph[]> {
    const res = await this.postPdf(`${this.endpoint}/pdf/text`, {
      path: pdfPath,
      startPage,
      endPage,
      withParagraphs: true,
    });
    const data = await res.json();
    return data.paragraphs as CompanionPdfParagraph[];
  }

  private async postPdf(url: string, body: Record<string, unknown>): Promise<Response> {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.status === 403) {
      throw new Error(`Companion rejected path (not allowlisted): ${body.path}`);
    }
    if (res.status === 404) {
      throw new Error('Companion could not find the PDF file');
    }
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Companion ${url} failed: ${res.status} ${err}`);
    }
    return res;
  }
}
