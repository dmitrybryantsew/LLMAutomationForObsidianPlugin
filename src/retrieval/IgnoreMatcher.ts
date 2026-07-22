// IgnoreMatcher - path filtering for vault ingestion.

export interface IgnoreMatcherConfig {
  rootPath: string;
  includeGlobs: string[];
  excludeGlobs: string[];
}

const DEFAULT_EXCLUDES = [
  ".obsidian/**",
  ".trash/**",
  "**/*.pdf",
];

function normalizePathLike(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

function globToRegex(glob: string): RegExp {
  const normalized = normalizePathLike(glob);
  let pattern = "";
  let i = 0;
  while (i < normalized.length) {
    const char = normalized[i];
    if (char === "*") {
      if (normalized[i + 1] === "*") {
        pattern += ".*";
        i += 2;
        if (normalized[i] === "/") {
          i++;
        }
      } else {
        pattern += "[^/]*";
        i++;
      }
    } else if (char === "?") {
      pattern += "[^/]";
      i++;
    } else if (char === ".") {
      pattern += "\\.";
      i++;
    } else if ("+()^$}|![]".includes(char)) {
      pattern += "\\" + char;
      i++;
    } else {
      pattern += char;
      i++;
    }
  }
  return new RegExp("^" + pattern + "$", "i");
}

export class IgnoreMatcher {
  private rootPath: string;
  private includePatterns: RegExp[];
  private excludePatterns: RegExp[];

  constructor(config: IgnoreMatcherConfig) {
    this.rootPath = normalizePathLike(config.rootPath ?? "");
    this.includePatterns = (config.includeGlobs?.length ? config.includeGlobs : ["**/*.md"]).map(globToRegex);
    this.excludePatterns = [...(config.excludeGlobs ?? []), ...DEFAULT_EXCLUDES].map(globToRegex);
  }

  shouldIndex(path: string): boolean {
    const normalized = normalizePathLike(path);
    if (!this.isUnderRoot(normalized)) {
      return false;
    }
    if (!this.includePatterns.some((pattern) => pattern.test(normalized))) {
      return false;
    }
    if (this.excludePatterns.some((pattern) => pattern.test(normalized))) {
      return false;
    }
    return true;
  }

  private isUnderRoot(path: string): boolean {
    if (!this.rootPath) {
      return true;
    }
    return path === this.rootPath || path.startsWith(this.rootPath + "/");
  }
}