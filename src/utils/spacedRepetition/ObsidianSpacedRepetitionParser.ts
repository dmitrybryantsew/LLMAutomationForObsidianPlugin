/**
 * Pure parser for flashcards created by the obsidian-spaced-repetition plugin (by st3v3nmw).
 *
 * Supports:
 * - Single-line cards (::)
 * - Reversed single-line cards (:::)
 * - Multiline cards (?)
 * - Reversed multiline cards (??)
 * - Cloze deletions (==highlight== and {c1::cloze})
 * - Hierarchical deck tags (#CSharpFlashcards/Unity/Basics, #German/nouns)
 * - Learning schedule extraction from <!--SR:!YYYY-MM-DD,interval,ease--> comments
 */

export interface OsrCardSchedule {
  dueDateStr: string; // e.g. '2026-03-10'
  isNew: boolean;
  intervalDays: number;
  ease: number; // e.g. 2.5 (from 250 in comment)
  repetitionCount: number;
}

export interface ParsedOsrCard {
  deckTag: string; // e.g. 'German/ageeva/nouns'
  deckName: string; // Display name, e.g. 'German/ageeva/nouns'
  questionText: string;
  answerText: string;
  cardStyle: 'basic' | 'reversed' | 'multiline' | 'multiline_reversed' | 'cloze';
  schedule?: OsrCardSchedule;
  sourceFilePath: string;
  sourceLineNumber: number;
}

const SR_HTML_COMMENT_REGEX = /<!--SR:(.+?)-->/g;
const MULTI_SCHEDULING_REGEX = /!([\d-]+),(\d+),(\d+)/g;
const DUMMY_DATE_NEW_CARD = '2000-01-01';

/**
 * Extracts all schedule entries from an HTML comment string like:
 * `<!--SR:!2025-08-27,3,250!2025-08-26,2,247-->`
 */
export function parseOsrSchedules(commentText: string): OsrCardSchedule[] {
  const results: OsrCardSchedule[] = [];
  const matches = [...commentText.matchAll(MULTI_SCHEDULING_REGEX)];

  for (const match of matches) {
    const dueDateStr = match[1];
    const intervalDays = parseInt(match[2], 10) || 0;
    const rawEase = parseInt(match[3], 10) || 250;
    const isNew = dueDateStr === DUMMY_DATE_NEW_CARD || intervalDays === 0;

    results.push({
      dueDateStr,
      isNew,
      intervalDays,
      ease: rawEase > 0 ? Number((rawEase / 100).toFixed(2)) : 2.5,
      repetitionCount: isNew ? 0 : Math.max(1, Math.round(Math.log2(intervalDays + 1))),
    });
  }

  return results;
}

/**
 * Normalizes a configured tag name by stripping leading '#' and trimming.
 */
export function normalizeTag(tag: string): string {
  return tag.replace(/^#+/, '').trim().toLowerCase();
}

/**
 * Matches a tag string in text against the list of configured deck tags.
 * Returns the matched tag path without '#' if matched, or null.
 * E.g., if configuredTags has ['#German'], matching '#German/ageeva/nouns' returns 'German/ageeva/nouns'.
 */
export function matchDeckTag(tagInText: string, configuredTags: string[]): string | null {
  const cleanTag = tagInText.replace(/^#+/, '').trim();
  const lowerCleanTag = cleanTag.toLowerCase();

  for (const cfg of configuredTags) {
    const cleanCfg = normalizeTag(cfg);
    if (lowerCleanTag === cleanCfg || lowerCleanTag.startsWith(cleanCfg + '/')) {
      return cleanTag;
    }
  }

  return null;
}

/**
 * Strips all `<!--SR:...-->` comment tags from a text block.
 */
export function stripSrComments(text: string): string {
  return text.replace(SR_HTML_COMMENT_REGEX, '').trim();
}

/**
 * Parses markdown file content and extracts all cards belonging to any of the configured deck tags.
 */
export function parseOsrFileContent(
  content: string,
  sourceFilePath: string,
  configuredTags: string[] = ['flashcards', 'cppFlashcards', 'CSharpFlashcards', 'German', 'Mnemonics']
): ParsedOsrCard[] {
  const cards: ParsedOsrCard[] = [];
  const lines = content.split('\n');

  // First check if the file as a whole has a default deck tag at the top
  let currentDeckTag = '';

  // Scan file for top-level tag if present
  for (let i = 0; i < Math.min(lines.length, 25); i++) {
    const lineTags = extractTagsFromLine(lines[i]);
    for (const tag of lineTags) {
      const matched = matchDeckTag(tag, configuredTags);
      if (matched) {
        currentDeckTag = matched;
        break;
      }
    }
    if (currentDeckTag) break;
  }

  // State machine for line-by-line parsing
  let i = 0;
  while (i < lines.length) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();

    // Check if this line introduces a new deck tag (e.g. ### #German/ageeva/nouns or #review #CSharpFlashcards/...)
    const lineTags = extractTagsFromLine(rawLine);
    for (const tag of lineTags) {
      const matched = matchDeckTag(tag, configuredTags);
      if (matched) {
        currentDeckTag = matched;
        break;
      }
    }

    // Skip empty lines, code blocks, or pure headings without card content
    if (!trimmed || trimmed.startsWith('```') || trimmed.startsWith('|')) {
      i++;
      continue;
    }

    // Lookahead to check if the next lines contain a scheduling comment
    const peekSchedules = (startIdx: number): { schedules: OsrCardSchedule[]; endIdx: number } => {
      let lookahead = startIdx;
      let combinedComment = '';
      while (lookahead < lines.length && lookahead <= startIdx + 4) {
        const nextTrimmed = lines[lookahead].trim();
        if (nextTrimmed.startsWith('<!--SR:')) {
          combinedComment += ' ' + nextTrimmed;
          lookahead++;
        } else if (!nextTrimmed) {
          lookahead++;
        } else {
          break;
        }
      }
      return {
        schedules: parseOsrSchedules(combinedComment),
        endIdx: lookahead,
      };
    };

    // 1. Single-Line Reversed Card: `side1:::side2`
    if (trimmed.includes(':::') && !trimmed.startsWith('#') && !trimmed.startsWith('<!--SR:')) {
      const parts = trimmed.split(':::');
      if (parts.length >= 2) {
        const side1 = stripSrComments(parts[0]).trim();
        const side2 = stripSrComments(parts.slice(1).join(':::')).trim();

        if (side1 && side2 && currentDeckTag) {
          const { schedules, endIdx } = peekSchedules(i + 1);
          const forwardSchedule = schedules[0];
          const reverseSchedule = schedules[1] ?? schedules[0];

          // Forward Card
          cards.push({
            deckTag: currentDeckTag,
            deckName: currentDeckTag,
            questionText: side1,
            answerText: side2,
            cardStyle: 'reversed',
            schedule: forwardSchedule,
            sourceFilePath,
            sourceLineNumber: i + 1,
          });

          // Reversed Card
          cards.push({
            deckTag: currentDeckTag,
            deckName: currentDeckTag,
            questionText: side2,
            answerText: side1,
            cardStyle: 'reversed',
            schedule: reverseSchedule,
            sourceFilePath,
            sourceLineNumber: i + 1,
          });

          i = Math.max(i + 1, endIdx);
          continue;
        }
      }
    }

    // 2. Single-Line Basic Card: `question::answer` (does not have `:::`)
    if (trimmed.includes('::') && !trimmed.includes(':::') && !trimmed.startsWith('#') && !trimmed.startsWith('<!--SR:')) {
      const idx = trimmed.indexOf('::');
      const question = stripSrComments(trimmed.substring(0, idx)).trim();
      const answer = stripSrComments(trimmed.substring(idx + 2)).trim();

      if (question && answer && currentDeckTag) {
        const { schedules, endIdx } = peekSchedules(i + 1);
        cards.push({
          deckTag: currentDeckTag,
          deckName: currentDeckTag,
          questionText: question,
          answerText: answer,
          cardStyle: 'basic',
          schedule: schedules[0],
          sourceFilePath,
          sourceLineNumber: i + 1,
        });

        i = Math.max(i + 1, endIdx);
        continue;
      }
    }

    // 3. Multiline Basic (?) and Multiline Reversed (??)
    // Check if the current line or subsequent lines have `?` or `??` on their own line
    if (i + 2 < lines.length && !trimmed.startsWith('#') && !trimmed.startsWith('<!--SR:')) {
      const nextLineTrimmed = lines[i + 1]?.trim();
      if (nextLineTrimmed === '?' || nextLineTrimmed === '??') {
        const isReversed = nextLineTrimmed === '??';
        const questionText = stripSrComments(trimmed).trim();

        let answerIdx = i + 2;
        const answerLines: string[] = [];
        while (answerIdx < lines.length) {
          const aLine = lines[answerIdx];
          const aTrim = aLine.trim();
          if (aTrim.startsWith('<!--SR:') || aTrim.startsWith('#') || aTrim === '---') {
            break;
          }
          if (!aTrim && answerLines.length > 0 && lines[answerIdx + 1]?.trim().startsWith('<!--SR:')) {
            break;
          }
          if (!aTrim && answerLines.length > 0) {
            if (lines[answerIdx + 1]?.trim().includes('::') || lines[answerIdx + 2]?.trim() === '?') {
              break;
            }
          }
          answerLines.push(aLine);
          answerIdx++;
        }

        const answerText = stripSrComments(answerLines.join('\n')).trim();

        if (questionText && answerText && currentDeckTag) {
          const { schedules, endIdx } = peekSchedules(answerIdx);

          cards.push({
            deckTag: currentDeckTag,
            deckName: currentDeckTag,
            questionText,
            answerText,
            cardStyle: isReversed ? 'multiline_reversed' : 'multiline',
            schedule: schedules[0],
            sourceFilePath,
            sourceLineNumber: i + 1,
          });

          if (isReversed) {
            cards.push({
              deckTag: currentDeckTag,
              deckName: currentDeckTag,
              questionText: answerText,
              answerText: questionText,
              cardStyle: 'multiline_reversed',
              schedule: schedules[1] ?? schedules[0],
              sourceFilePath,
              sourceLineNumber: i + 1,
            });
          }

          i = Math.max(answerIdx, endIdx);
          continue;
        }
      }
    }

    // 4. Cloze Deletion Card: inline `==highlight==` or `{c1::cloze}`
    if (
      currentDeckTag &&
      (trimmed.includes('==') || /\{c\d+::/.test(trimmed)) &&
      !trimmed.startsWith('#') &&
      !trimmed.startsWith('<!--SR:')
    ) {
      const clozeCards = parseClozesFromLine(trimmed, currentDeckTag, sourceFilePath, i + 1);
      if (clozeCards.length > 0) {
        const { schedules, endIdx } = peekSchedules(i + 1);
        for (let cIdx = 0; cIdx < clozeCards.length; cIdx++) {
          clozeCards[cIdx].schedule = schedules[cIdx] ?? schedules[0];
          cards.push(clozeCards[cIdx]);
        }
        i = Math.max(i + 1, endIdx);
        continue;
      }
    }

    i++;
  }

  return cards;
}

/**
 * Extracts hashtags from a line (handles `#tag`, `#tag/sub/deck`).
 */
function extractTagsFromLine(line: string): string[] {
  const matches = line.match(/#[a-zA-Z0-9_\u0080-\uFFFF/-]+/g);
  return matches ? matches.map((m) => m.trim()) : [];
}

/**
 * Parses cloze deletions from a single line.
 */
function parseClozesFromLine(
  line: string,
  deckTag: string,
  sourceFilePath: string,
  lineNumber: number
): ParsedOsrCard[] {
  const cards: ParsedOsrCard[] = [];
  const cleanLine = stripSrComments(line);

  // Style A: ==cloze== or ==cloze::hint==
  const highlightRegex = /==(.+?)==/g;
  const highlightMatches = [...cleanLine.matchAll(highlightRegex)];
  if (highlightMatches.length > 0) {
    for (const match of highlightMatches) {
      const rawContent = match[1];
      const hintParts = rawContent.split('::');
      const answer = hintParts[0].trim();
      const hint = hintParts[1]?.trim();
      const replacement = hint ? `[${hint}]` : '[...]';
      const question = cleanLine.replace(match[0], replacement);

      cards.push({
        deckTag,
        deckName: deckTag,
        questionText: question,
        answerText: answer,
        cardStyle: 'cloze',
        sourceFilePath,
        sourceLineNumber: lineNumber,
      });
    }
    return cards;
  }

  // Style B: {c1::cloze}
  const clozeRegex = /\{c\d+::([^}]+)\}/g;
  const clozeMatches = [...cleanLine.matchAll(clozeRegex)];
  if (clozeMatches.length > 0) {
    for (const match of clozeMatches) {
      const answer = match[1].trim();
      const question = cleanLine.replace(match[0], '[...]');

      cards.push({
        deckTag,
        deckName: deckTag,
        questionText: question,
        answerText: answer,
        cardStyle: 'cloze',
        sourceFilePath,
        sourceLineNumber: lineNumber,
      });
    }
    return cards;
  }

  return cards;
}
