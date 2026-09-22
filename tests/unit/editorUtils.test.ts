import { describe, expect, it } from 'vitest';
import { handleTabKey, handleEnterKey, computeOutputDiff } from '../../src/utils/editorUtils';

describe('editorUtils', () => {
  describe('handleTabKey', () => {
    it('inserts 4 spaces at single cursor position', () => {
      const text = 'int x = 1;';
      const result = handleTabKey(text, 0, 0, false);
      expect(result.text).toBe('    int x = 1;');
      expect(result.selectionStart).toBe(4);
      expect(result.selectionEnd).toBe(4);
    });

    it('unindents single line on Shift+Tab', () => {
      const text = '    int x = 1;';
      const result = handleTabKey(text, 6, 6, true);
      expect(result.text).toBe('int x = 1;');
      expect(result.selectionStart).toBe(2);
      expect(result.selectionEnd).toBe(2);
    });

    it('indents multiple lines when selected', () => {
      const text = 'void Main()\n{\nConsole.WriteLine(1);\n}';
      // Select from '{' to 'Console'
      const selStart = 12; // start of line 2
      const selEnd = 20;
      const result = handleTabKey(text, selStart, selEnd, false);
      expect(result.text).toBe('void Main()\n    {\n    Console.WriteLine(1);\n}');
    });

    it('unindents multiple lines when selected with Shift+Tab', () => {
      const text = '    line 1\n    line 2\nline 3';
      const result = handleTabKey(text, 2, 16, true);
      expect(result.text).toBe('line 1\nline 2\nline 3');
    });
  });

  describe('handleEnterKey', () => {
    it('preserves indentation of the current line', () => {
      const text = '    int a = 1;';
      const result = handleEnterKey(text, text.length);
      expect(result.text).toBe('    int a = 1;\n    ');
      expect(result.selectionStart).toBe(text.length + 5);
    });

    it('adds an extra level of indentation after an opening brace', () => {
      const text = '    void Test() {';
      const result = handleEnterKey(text, text.length);
      expect(result.text).toBe('    void Test() {\n        ');
      expect(result.selectionStart).toBe(text.length + 9);
    });
  });

  describe('computeOutputDiff', () => {
    it('marks matching outputs as matched', () => {
      const expected = 'Hello\nWorld 42';
      const actual = 'Hello\nWorld 42\n';
      const diff = computeOutputDiff(expected, actual);
      expect(diff.matched).toBe(true);
      expect(diff.rows).toHaveLength(2);
      expect(diff.rows[0].type).toBe('match');
      expect(diff.rows[1].type).toBe('match');
    });

    it('identifies mismatched, missing, and extra lines', () => {
      const expected = 'Line 1\nLine 2\nLine 3';
      const actual = 'Line 1\nLine 2 changed\nLine 3\nExtra Line';
      const diff = computeOutputDiff(expected, actual);

      expect(diff.matched).toBe(false);
      expect(diff.rows[0]).toEqual({ lineNumber: 1, type: 'match', expected: 'Line 1', actual: 'Line 1' });
      expect(diff.rows[1]).toEqual({ lineNumber: 2, type: 'mismatch', expected: 'Line 2', actual: 'Line 2 changed' });
      expect(diff.rows[2]).toEqual({ lineNumber: 3, type: 'match', expected: 'Line 3', actual: 'Line 3' });
      expect(diff.rows[3]).toEqual({ lineNumber: 4, type: 'extra', actual: 'Extra Line' });
    });

    it('identifies missing lines when actual output is shorter', () => {
      const expected = 'A\nB\nC';
      const actual = 'A';
      const diff = computeOutputDiff(expected, actual);

      expect(diff.matched).toBe(false);
      expect(diff.rows[0].type).toBe('match');
      expect(diff.rows[1].type).toBe('missing');
      expect(diff.rows[2].type).toBe('missing');
    });
  });
});
