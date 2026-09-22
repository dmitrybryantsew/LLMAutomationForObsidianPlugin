/**
 * Editor ergonomics and diff utilities for Coding Exercises.
 */

export interface IndentResult {
  text: string;
  selectionStart: number;
  selectionEnd: number;
}

/**
 * Handle Tab and Shift+Tab key presses within a text editor.
 */
export function handleTabKey(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  shiftKey: boolean,
  indent: string = '    '
): IndentResult {
  const indentLen = indent.length;

  if (selectionStart === selectionEnd) {
    if (!shiftKey) {
      // Simple insertion at cursor
      const nextText = value.slice(0, selectionStart) + indent + value.slice(selectionEnd);
      return {
        text: nextText,
        selectionStart: selectionStart + indentLen,
        selectionEnd: selectionStart + indentLen,
      };
    } else {
      // Shift+Tab at single cursor: unindent current line
      const lineStart = value.lastIndexOf('\n', selectionStart - 1) + 1;
      const line = value.slice(lineStart);
      let removed = 0;
      if (line.startsWith(indent)) {
        removed = indentLen;
      } else {
        const leadingSpaces = line.match(/^ +/)?.[0]?.length ?? 0;
        removed = Math.min(leadingSpaces, indentLen);
      }

      if (removed > 0) {
        const nextText = value.slice(0, lineStart) + value.slice(lineStart + removed);
        const nextPos = Math.max(lineStart, selectionStart - removed);
        return {
          text: nextText,
          selectionStart: nextPos,
          selectionEnd: nextPos,
        };
      }
      return { text: value, selectionStart, selectionEnd };
    }
  }

  // Multi-line selection
  const lineStart = value.lastIndexOf('\n', selectionStart - 1) + 1;
  let lineEnd = value.indexOf('\n', selectionEnd);
  if (lineEnd === -1) {
    lineEnd = value.length;
  }

  const selectedBlock = value.slice(lineStart, lineEnd);
  const lines = selectedBlock.split('\n');
  let startOffsetChange = 0;
  let totalLengthChange = 0;

  const modifiedLines = lines.map((line, idx) => {
    if (!shiftKey) {
      // Indent line
      if (idx === 0) startOffsetChange += indentLen;
      totalLengthChange += indentLen;
      return indent + line;
    } else {
      // Unindent line
      let removed = 0;
      if (line.startsWith(indent)) {
        removed = indentLen;
      } else {
        const spaces = line.match(/^ +/)?.[0]?.length ?? 0;
        removed = Math.min(spaces, indentLen);
      }

      if (idx === 0) startOffsetChange -= removed;
      totalLengthChange -= removed;
      return line.slice(removed);
    }
  });

  const nextText = value.slice(0, lineStart) + modifiedLines.join('\n') + value.slice(lineEnd);
  const nextStart = Math.max(lineStart, selectionStart + startOffsetChange);
  const nextEnd = Math.max(nextStart, selectionEnd + totalLengthChange);

  return {
    text: nextText,
    selectionStart: nextStart,
    selectionEnd: nextEnd,
  };
}

/**
 * Handle Enter key to preserve indentation and auto-indent after opening braces '{'.
 */
export function handleEnterKey(
  value: string,
  selectionStart: number,
  indent: string = '    '
): IndentResult {
  const lineStart = value.lastIndexOf('\n', selectionStart - 1) + 1;
  const currentLinePrefix = value.slice(lineStart, selectionStart);

  // Match leading whitespace
  const leadingMatch = currentLinePrefix.match(/^[ \t]+/);
  let nextIndent = leadingMatch ? leadingMatch[0] : '';

  // If the line up to cursor ends with '{', add an extra indentation level
  if (currentLinePrefix.trimEnd().endsWith('{')) {
    nextIndent += indent;
  }

  const insertion = '\n' + nextIndent;
  const nextText = value.slice(0, selectionStart) + insertion + value.slice(selectionStart);
  const nextPos = selectionStart + insertion.length;

  return {
    text: nextText,
    selectionStart: nextPos,
    selectionEnd: nextPos,
  };
}

export type DiffRowType = 'match' | 'mismatch' | 'missing' | 'extra';

export interface DiffRow {
  lineNumber: number;
  type: DiffRowType;
  expected?: string;
  actual?: string;
}

export interface OutputDiffResult {
  matched: boolean;
  rows: DiffRow[];
  totalExpectedLines: number;
  totalActualLines: number;
}

/**
 * Compute line-by-line comparison between expected output and actual stdout.
 */
export function computeOutputDiff(expectedStr: string, actualStr: string): OutputDiffResult {
  const normalize = (s: string) => s.replace(/\r\n/g, '\n').trimEnd();
  const normExpected = normalize(expectedStr);
  const normActual = normalize(actualStr);

  const matched = normExpected === normActual;

  const expectedLines = normExpected.length ? normExpected.split('\n') : [];
  const actualLines = normActual.length ? normActual.split('\n') : [];
  const maxLines = Math.max(expectedLines.length, actualLines.length);

  const rows: DiffRow[] = [];

  for (let i = 0; i < maxLines; i++) {
    const exp = expectedLines[i];
    const act = actualLines[i];

    if (exp !== undefined && act !== undefined) {
      if (exp === act) {
        rows.push({ lineNumber: i + 1, type: 'match', expected: exp, actual: act });
      } else {
        rows.push({ lineNumber: i + 1, type: 'mismatch', expected: exp, actual: act });
      }
    } else if (exp !== undefined) {
      rows.push({ lineNumber: i + 1, type: 'missing', expected: exp });
    } else {
      rows.push({ lineNumber: i + 1, type: 'extra', actual: act });
    }
  }

  return {
    matched,
    rows,
    totalExpectedLines: expectedLines.length,
    totalActualLines: actualLines.length,
  };
}
