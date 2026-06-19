export interface FlashcardLike {
  id?: string;
  questionText: string;
  questionType: string;
  answerText?: string | null;
  archivedAt?: string | null;
  createdAt?: string | null;
}

export interface FlashcardDuplicateGroup<T extends FlashcardLike> {
  key: string;
  cards: T[];
}

export interface FlashcardDedupeResult<T extends FlashcardLike> {
  unique: T[];
  duplicates: T[];
}

export function getFlashcardDuplicateKey(card: FlashcardLike): string {
  return [
    normalizeForDuplicateKey(card.questionType),
    normalizeForDuplicateKey(card.questionText),
    normalizeForDuplicateKey(card.answerText ?? ''),
  ].join('|');
}

export function findFlashcardDuplicateGroups<T extends FlashcardLike>(cards: T[]): FlashcardDuplicateGroup<T>[] {
  const groups = new Map<string, T[]>();

  for (const card of cards) {
    const key = getFlashcardDuplicateKey(card);
    if (!key.trim()) {
      continue;
    }

    const group = groups.get(key) ?? [];
    group.push(card);
    groups.set(key, group);
  }

  return Array.from(groups.entries())
    .filter(([, group]) => group.length > 1)
    .map(([key, group]) => ({ key, cards: group }));
}

export function filterDuplicateFlashcards<T extends FlashcardLike>(
  incoming: T[],
  existing: FlashcardLike[] = []
): FlashcardDedupeResult<T> {
  const seen = new Set(existing.map((card) => getFlashcardDuplicateKey(card)));
  const unique: T[] = [];
  const duplicates: T[] = [];

  for (const card of incoming) {
    const key = getFlashcardDuplicateKey(card);
    if (seen.has(key)) {
      duplicates.push(card);
      continue;
    }

    seen.add(key);
    unique.push(card);
  }

  return { unique, duplicates };
}

export function chooseDuplicateKeeper<T extends FlashcardLike>(cards: T[]): T {
  return [...cards].sort((left, right) => {
    const leftCreated = left.createdAt ? Date.parse(left.createdAt) : Number.MAX_SAFE_INTEGER;
    const rightCreated = right.createdAt ? Date.parse(right.createdAt) : Number.MAX_SAFE_INTEGER;
    if (leftCreated !== rightCreated) {
      return leftCreated - rightCreated;
    }

    return (left.id ?? '').localeCompare(right.id ?? '');
  })[0];
}

function normalizeForDuplicateKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[`*_~>#\-[\]().,;:!?'"{}]/g, ' ')
    .replace(/\s+/g, ' ');
}
