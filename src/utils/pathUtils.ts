/**
 * Zero-dependency path utility for browser and mobile Obsidian environments.
 * Replaces Node.js 'path' module to prevent runtime crashes on Android/iOS.
 */

function cleanPath(p: string): string {
  return p.replace(/\\/g, '/');
}

export function normalize(path: string): string {
  if (!path) return '.';
  const cleaned = cleanPath(path);
  const isAbsolute = cleaned.startsWith('/') || /^[a-zA-Z]:\//.test(cleaned);
  let prefix = '';

  let toProcess = cleaned;
  if (/^[a-zA-Z]:\//.test(cleaned)) {
    prefix = cleaned.slice(0, 3);
    toProcess = cleaned.slice(3);
  } else if (cleaned.startsWith('/')) {
    prefix = '/';
    toProcess = cleaned.slice(1);
  }

  const parts = toProcess.split('/').filter(Boolean);
  const resolved: string[] = [];

  for (const part of parts) {
    if (part === '.') continue;
    if (part === '..') {
      if (resolved.length > 0 && resolved[resolved.length - 1] !== '..') {
        resolved.pop();
      } else if (!isAbsolute) {
        resolved.push('..');
      }
    } else {
      resolved.push(part);
    }
  }

  const result = prefix + resolved.join('/');
  if (!result) return isAbsolute ? prefix || '/' : '.';
  return result;
}

export function join(...paths: string[]): string {
  const filtered = paths.filter((p) => p && typeof p === 'string');
  if (filtered.length === 0) return '.';
  return normalize(filtered.map(cleanPath).join('/'));
}

export function dirname(path: string): string {
  const normalized = normalize(path);
  if (normalized === '.' || normalized === '/') return normalized;
  if (/^[a-zA-Z]:\/$/.test(normalized)) return normalized;

  const idx = normalized.lastIndexOf('/');
  if (idx === -1) return '.';
  if (idx === 0) return '/';
  if (/^[a-zA-Z]:$/.test(normalized.slice(0, idx))) {
    return normalized.slice(0, idx + 1);
  }
  return normalized.slice(0, idx);
}

export function basename(path: string, ext?: string): string {
  const normalized = normalize(path);
  const idx = normalized.lastIndexOf('/');
  let base = idx === -1 ? normalized : normalized.slice(idx + 1);

  if (ext && base.toLowerCase().endsWith(ext.toLowerCase())) {
    base = base.slice(0, -ext.length);
  }
  return base;
}

export function extname(path: string): string {
  const base = basename(path);
  const idx = base.lastIndexOf('.');
  if (idx <= 0) return '';
  return base.slice(idx);
}

export function relative(from: string, to: string): string {
  const normFrom = normalize(from);
  const normTo = normalize(to);

  if (normFrom === normTo) return '';

  const fromParts = normFrom.split('/').filter(Boolean);
  const toParts = normTo.split('/').filter(Boolean);

  let common = 0;
  while (common < fromParts.length && common < toParts.length && fromParts[common] === toParts[common]) {
    common++;
  }

  const ups = fromParts.length - common;
  const remaining = toParts.slice(common);

  const parts = [];
  for (let i = 0; i < ups; i++) {
    parts.push('..');
  }
  parts.push(...remaining);

  return parts.join('/') || '.';
}

export const posix = {
  normalize,
  join,
  dirname,
  basename,
  extname,
  relative,
};

export default {
  normalize,
  join,
  dirname,
  basename,
  extname,
  relative,
  posix,
};
