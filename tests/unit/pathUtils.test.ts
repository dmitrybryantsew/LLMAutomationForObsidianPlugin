import { describe, expect, it } from 'vitest';
import * as pathUtils from '../../src/utils/pathUtils';
import { base64ToUint8Array, uint8ArrayToBase64 } from '../../src/utils/bufferUtils';

describe('pathUtils', () => {
  it('normalizes relative and absolute paths', () => {
    expect(pathUtils.normalize('a/b/../c')).toBe('a/c');
    expect(pathUtils.normalize('C:\\vault\\notes\\sub\\..\\note.md')).toBe('C:/vault/notes/note.md');
    expect(pathUtils.normalize('/root/sub/./file.txt')).toBe('/root/sub/file.txt');
  });

  it('joins path segments correctly', () => {
    expect(pathUtils.join('folder', 'subfolder', 'file.md')).toBe('folder/subfolder/file.md');
    expect(pathUtils.join('C:\\tools', 'bin', 'run.exe')).toBe('C:/tools/bin/run.exe');
  });

  it('extracts dirname, basename, extname', () => {
    const p = 'vault/folder/note.spec.md';
    expect(pathUtils.dirname(p)).toBe('vault/folder');
    expect(pathUtils.basename(p)).toBe('note.spec.md');
    expect(pathUtils.basename(p, '.md')).toBe('note.spec');
    expect(pathUtils.extname(p)).toBe('.md');
  });

  it('computes relative paths', () => {
    expect(pathUtils.relative('vault/decks', 'vault/decks/sub/card.md')).toBe('sub/card.md');
    expect(pathUtils.relative('vault/decks/sub', 'vault/decks')).toBe('..');
  });
});

describe('bufferUtils', () => {
  it('encodes and decodes base64 round-trip', () => {
    const original = new Uint8Array([72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100]); // "Hello World"
    const base64 = uint8ArrayToBase64(original);
    expect(base64).toBe('SGVsbG8gV29ybGQ=');

    const decoded = base64ToUint8Array(base64);
    expect(Array.from(decoded)).toEqual(Array.from(original));
  });
});
