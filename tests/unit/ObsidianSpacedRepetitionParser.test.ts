import { describe, expect, it } from 'vitest';
import {
  parseOsrFileContent,
  parseOsrSchedules,
  matchDeckTag,
  stripSrComments,
} from '../../src/utils/spacedRepetition/ObsidianSpacedRepetitionParser';

describe('ObsidianSpacedRepetitionParser', () => {
  it('parses single and multi-schedule comments accurately', () => {
    const singleComment = '<!--SR:!2026-03-10,3,250-->';
    const single = parseOsrSchedules(singleComment);
    expect(single).toHaveLength(1);
    expect(single[0].dueDateStr).toBe('2026-03-10');
    expect(single[0].intervalDays).toBe(3);
    expect(single[0].ease).toBe(2.5);
    expect(single[0].isNew).toBe(false);

    // Multi-schedule on reversed card
    const multiComment = '<!--SR:!2025-08-27,3,250!2025-08-26,2,247-->';
    const multi = parseOsrSchedules(multiComment);
    expect(multi).toHaveLength(2);
    expect(multi[0].dueDateStr).toBe('2025-08-27');
    expect(multi[0].intervalDays).toBe(3);
    expect(multi[0].ease).toBe(2.5);

    expect(multi[1].dueDateStr).toBe('2025-08-26');
    expect(multi[1].intervalDays).toBe(2);
    expect(multi[1].ease).toBe(2.47);

    // Dummy date for new/unreviewed card
    const newComment = '<!--SR:!2000-01-01,1,250-->';
    const newCard = parseOsrSchedules(newComment);
    expect(newCard[0].isNew).toBe(true);
    expect(newCard[0].repetitionCount).toBe(0);
  });

  it('matches configured deck tags and sub-deck hierarchies', () => {
    const tags = ['#flashcards', '#cppFlashcards', '#CSharpFlashcards', '#German', '#Mnemonics'];

    expect(matchDeckTag('#German', tags)).toBe('German');
    expect(matchDeckTag('#German/ageeva/nouns', tags)).toBe('German/ageeva/nouns');
    expect(matchDeckTag('#CSharpFlashcards/Unity/BasicsBook', tags)).toBe('CSharpFlashcards/Unity/BasicsBook');
    expect(matchDeckTag('#cppFlashcards', tags)).toBe('cppFlashcards');
    expect(matchDeckTag('#unrelatedTag', tags)).toBeNull();
  });

  it('parses single-line basic (::) cards with schedule', () => {
    const content = `
#review #CSharpFlashcards/Unity/BasicsBook

Что означает C# компилируемый?::Код C# компилируется в CIL
<!--SR:!2026-03-10,3,250-->
`;

    const cards = parseOsrFileContent(content, 'test.md', ['CSharpFlashcards']);
    expect(cards).toHaveLength(1);
    expect(cards[0].deckTag).toBe('CSharpFlashcards/Unity/BasicsBook');
    expect(cards[0].questionText).toBe('Что означает C# компилируемый?');
    expect(cards[0].answerText).toBe('Код C# компилируется в CIL');
    expect(cards[0].cardStyle).toBe('basic');
    expect(cards[0].schedule?.dueDateStr).toBe('2026-03-10');
    expect(cards[0].schedule?.intervalDays).toBe(3);
    expect(cards[0].schedule?.ease).toBe(2.5);
  });

  it('parses single-line reversed (:::) cards into 2 sibling cards with schedules', () => {
    const content = `
### #German/ageeva/nouns

die Mutter/Mütter ::: /ˈmʊtɐ/ mother (noun)
<!--SR:!2025-08-27,3,250!2025-08-26,2,247-->
`;

    const cards = parseOsrFileContent(content, 'german.md', ['German']);
    expect(cards).toHaveLength(2);

    // Forward
    expect(cards[0].questionText).toBe('die Mutter/Mütter');
    expect(cards[0].answerText).toBe('/ˈmʊtɐ/ mother (noun)');
    expect(cards[0].cardStyle).toBe('reversed');
    expect(cards[0].schedule?.dueDateStr).toBe('2025-08-27');
    expect(cards[0].schedule?.intervalDays).toBe(3);
    expect(cards[0].schedule?.ease).toBe(2.5);

    // Reverse
    expect(cards[1].questionText).toBe('/ˈmʊtɐ/ mother (noun)');
    expect(cards[1].answerText).toBe('die Mutter/Mütter');
    expect(cards[1].cardStyle).toBe('reversed');
    expect(cards[1].schedule?.dueDateStr).toBe('2025-08-26');
    expect(cards[1].schedule?.intervalDays).toBe(2);
    expect(cards[1].schedule?.ease).toBe(2.47);
  });

  it('parses multiline (?) cards', () => {
    const content = `
#review #CSharpFlashcards/Unity/BasicsBook

Что такое ООП?
?
Объектно-ориентированное программирование — объединение данных и поведения.
<!--SR:!2026-03-10,3,250-->
`;

    const cards = parseOsrFileContent(content, 'test.md', ['CSharpFlashcards']);
    expect(cards).toHaveLength(1);
    expect(cards[0].questionText).toBe('Что такое ООП?');
    expect(cards[0].answerText).toBe('Объектно-ориентированное программирование — объединение данных и поведения.');
    expect(cards[0].cardStyle).toBe('multiline');
    expect(cards[0].schedule?.dueDateStr).toBe('2026-03-10');
  });

  it('parses cloze deletion cards', () => {
    const content = `
#Mnemonics

In 1969 humans landed on the ==Moon== for the first time.
`;

    const cards = parseOsrFileContent(content, 'mnemonics.md', ['Mnemonics']);
    expect(cards).toHaveLength(1);
    expect(cards[0].questionText).toBe('In 1969 humans landed on the [...] for the first time.');
    expect(cards[0].answerText).toBe('Moon');
    expect(cards[0].cardStyle).toBe('cloze');
  });

  it('strips SR comments cleanly from text', () => {
    const text = 'die Torte/Torten ::: cake <!--SR:!2025-08-27,3,250-->';
    expect(stripSrComments(text)).toBe('die Torte/Torten ::: cake');
  });
});
