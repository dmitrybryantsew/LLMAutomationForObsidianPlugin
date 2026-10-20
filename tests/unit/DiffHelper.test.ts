import { describe, it, expect } from 'vitest';
import { computeCharDiff, computeTokenDiff } from '../../src/utils/spacedRepetition/DiffHelper';

describe('DiffHelper', () => {
  it('detects identical strings as a single equal chunk', () => {
    const diff = computeCharDiff('hello world', 'hello world');
    expect(diff).toEqual([{ type: 'equal', text: 'hello world' }]);
  });

  it('detects missing characters in user input', () => {
    // Expected: console.log, Actual: consle.log (missing 'o')
    const diff = computeCharDiff('consle.log', 'console.log');
    expect(diff).toEqual([
      { type: 'equal', text: 'cons' },
      { type: 'missing', text: 'o' },
      { type: 'equal', text: 'le.log' },
    ]);
  });

  it('detects extra characters in user input', () => {
    // Expected: Task, Actual: Task<void> (extra '<void>')
    const diff = computeCharDiff('Task<void>', 'Task');
    expect(diff).toEqual([
      { type: 'equal', text: 'Task' },
      { type: 'extra', text: '<void>' },
    ]);
  });

  it('handles empty actual input', () => {
    const diff = computeCharDiff('', 'expected answer');
    expect(diff).toEqual([
      { type: 'missing', text: 'expected answer' },
    ]);
  });

  it('handles empty expected string', () => {
    const diff = computeCharDiff('user text', '');
    expect(diff).toEqual([
      { type: 'extra', text: 'user text' },
    ]);
  });

  it('computes token-level diffs correctly for longer text', () => {
    const actual = 'The quick brown fox jumped';
    const expected = 'The fast brown fox jumps';
    const diff = computeTokenDiff(actual, expected);
    expect(diff.some((c) => c.type === 'equal')).toBe(true);
    expect(diff.some((c) => c.type === 'missing')).toBe(true);
    expect(diff.some((c) => c.type === 'extra')).toBe(true);
  });
});
