import { describe, expect, it } from 'vitest';

describe('Flashcard Hub UI Logic', () => {
  const sampleDecks = [
    {
      studySetId: 'set-1',
      name: 'C# Architecture',
      description: 'Design patterns and BCL',
      enabled: true,
      totalCount: 50,
      dueCount: 15,
      suspendedCount: 0,
      archivedCount: 0,
    },
    {
      studySetId: 'set-2',
      name: 'Obsidian Plugins',
      description: 'API and Leaf management',
      enabled: true,
      totalCount: 30,
      dueCount: 0,
      suspendedCount: 2,
      archivedCount: 0,
    },
    {
      studySetId: 'set-3',
      name: 'Algorithms',
      description: 'Sorting and Trees',
      enabled: false,
      totalCount: 80,
      dueCount: 25,
      suspendedCount: 5,
      archivedCount: 1,
    },
  ];

  it('filters decks by search query across name and description', () => {
    const query = 'patterns';
    const filtered = sampleDecks.filter((d) =>
      d.name.toLowerCase().includes(query) || (d.description && d.description.toLowerCase().includes(query))
    );

    expect(filtered).toHaveLength(1);
    expect(filtered[0].studySetId).toBe('set-1');
  });

  it('filters decks by due status', () => {
    const dueOnly = sampleDecks.filter((d) => d.dueCount > 0);
    expect(dueOnly).toHaveLength(2);
    expect(dueOnly.map((d) => d.studySetId)).toEqual(['set-1', 'set-3']);
  });

  it('sorts decks by most due first, then total cards', () => {
    const sorted = [...sampleDecks].sort((a, b) => b.dueCount - a.dueCount || b.totalCount - a.totalCount);
    expect(sorted[0].studySetId).toBe('set-3'); // 25 due
    expect(sorted[1].studySetId).toBe('set-1'); // 15 due
    expect(sorted[2].studySetId).toBe('set-2'); // 0 due
  });

  it('sorts decks alphabetically by name', () => {
    const sorted = [...sampleDecks].sort((a, b) => a.name.localeCompare(b.name));
    expect(sorted[0].name).toBe('Algorithms');
    expect(sorted[1].name).toBe('C# Architecture');
    expect(sorted[2].name).toBe('Obsidian Plugins');
  });

  it('calculates 30-day retention rate correctly from grade distribution', () => {
    const grades = [
      { grade: 0, count: 2 }, // lapse
      { grade: 1, count: 1 }, // fail
      { grade: 2, count: 2 }, // hard fail
      { grade: 3, count: 10 }, // pass
      { grade: 4, count: 20 }, // good
      { grade: 5, count: 15 }, // easy
    ];

    const total = grades.reduce((acc, g) => acc + g.count, 0); // 50
    const passed = grades.filter((g) => g.grade >= 3).reduce((acc, g) => acc + g.count, 0); // 45
    const retentionRate = Math.round((passed / total) * 100);

    expect(total).toBe(50);
    expect(passed).toBe(45);
    expect(retentionRate).toBe(90);
  });

  it('calculates proportional forecast fill heights correctly', () => {
    const maxDue = 50;
    const dueCount = 25;
    const percent = Math.min(100, Math.max(dueCount > 0 ? 12 : 0, Math.round((dueCount / maxDue) * 100)));
    expect(percent).toBe(50);

    // Non-zero small count should have at least min height 12%
    const smallDue = 1;
    const smallPercent = Math.min(100, Math.max(smallDue > 0 ? 12 : 0, Math.round((smallDue / maxDue) * 100)));
    expect(smallPercent).toBe(12);

    // Zero count should be 0%
    const zeroDue = 0;
    const zeroPercent = Math.min(100, Math.max(zeroDue > 0 ? 12 : 0, Math.round((zeroDue / maxDue) * 100)));
    expect(zeroPercent).toBe(0);
  });
});
