import { ExactAnswerField, ExactAnswerNormalization } from '../../types/spacedRepetition';

type ExactFieldOptions = Partial<Pick<ExactAnswerField, 'caseSensitive' | 'normalizeWhitespace' | 'aliases' | 'regex' | 'normalization'>>;

export function normalizeExactAnswer(value: string, options: ExactFieldOptions = {}): string {
  let normalized = value.trim();

  if (options.normalizeWhitespace !== false) {
    normalized = normalized.replace(/\s+/g, ' ');
  }

  if (options.normalization === 'csharp') {
    normalized = normalizeCSharpAnswer(normalized);
  }

  if (!options.caseSensitive) {
    normalized = normalized.toLowerCase();
  }

  return normalized;
}

export function matchesExactAnswerField(userAnswer: string, field: ExactAnswerField): boolean {
  const regex = field.regex?.trim();
  if (regex) {
    try {
      const input = normalizeExactAnswer(userAnswer, { ...field, caseSensitive: true });
      const flags = field.caseSensitive ? '' : 'i';
      if (new RegExp(regex, flags).test(input)) {
        return true;
      }
    } catch {
      return false;
    }
  }

  const expectedAnswers = [field.answer, ...(field.aliases ?? [])]
    .map((answer) => answer.trim())
    .filter(Boolean);
  const normalizedUserAnswer = normalizeExactAnswer(userAnswer, field);
  return expectedAnswers.some((answer) => normalizeExactAnswer(answer, field) === normalizedUserAnswer);
}

export function normalizeExactAnswerField(value: unknown, fallbackIndex = 0): ExactAnswerField | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const raw = value as Record<string, unknown>;
  const label = cleanString(raw.label);
  const answer = cleanString(raw.answer);
  if (!label || !answer) {
    return null;
  }

  const id = cleanString(raw.id)
    || makeFieldId(label)
    || `field-${fallbackIndex + 1}`;

  const normalized: ExactAnswerField = {
    id,
    label,
    answer,
    placeholder: cleanString(raw.placeholder) || null,
  };

  applyOptions(normalized, raw);
  return normalized;
}

export function parseExactAnswerFieldLine(line: string, fallbackIndex = 0): ExactAnswerField | null {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }

  const firstDelimiter = trimmed.indexOf('::');
  if (firstDelimiter < 0) {
    return null;
  }

  const secondDelimiter = trimmed.indexOf('::', firstDelimiter + 2);
  const label = trimmed.slice(0, firstDelimiter).trim();
  const answer = (secondDelimiter >= 0
    ? trimmed.slice(firstDelimiter + 2, secondDelimiter)
    : trimmed.slice(firstDelimiter + 2)).trim();
  const optionsText = secondDelimiter >= 0 ? trimmed.slice(secondDelimiter + 2).trim() : '';

  if (!label || !answer) {
    return null;
  }

  const field: ExactAnswerField = {
    id: makeFieldId(label) || `field-${fallbackIndex + 1}`,
    label,
    answer,
    placeholder: `Type ${label}`,
  };

  if (optionsText) {
    applyOptions(field, parseOptionsText(optionsText));
  }

  return field;
}

export function formatExactAnswerFieldLine(field: ExactAnswerField): string {
  const options: Record<string, unknown> = {};
  if (field.caseSensitive) {
    options.caseSensitive = true;
  }
  if (field.normalizeWhitespace === false) {
    options.normalizeWhitespace = false;
  }
  if (field.aliases?.length) {
    options.aliases = field.aliases;
  }
  if (field.regex?.trim()) {
    options.regex = field.regex.trim();
  }
  if (field.normalization === 'csharp') {
    options.normalization = 'csharp';
  }

  const optionText = Object.keys(options).length ? `::${JSON.stringify(options)}` : '';
  return `${field.label}::${field.answer}${optionText}`;
}

export function parseExactAnswerFieldsText(value: string): ExactAnswerField[] {
  return value
    .split('\n')
    .map((line, index) => parseExactAnswerFieldLine(line, index))
    .filter((field): field is ExactAnswerField => field !== null);
}

function normalizeCSharpAnswer(value: string): string {
  return value
    .replace(/\s*([()[\]{}.,;:+\-*/%=&|<>!?])\s*/g, '$1')
    .replace(/\bnew(?=[A-Za-z_])/g, 'new ');
}

function parseOptionsText(value: string): Record<string, unknown> {
  const trimmed = value.trim();
  if (!trimmed) {
    return {};
  }

  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  const options: Record<string, unknown> = {};
  for (const segment of trimmed.split('|')) {
    const separatorIndex = segment.indexOf('=');
    if (separatorIndex < 0) {
      continue;
    }

    const key = segment.slice(0, separatorIndex).trim();
    const rawValue = segment.slice(separatorIndex + 1).trim();
    if (!key || !rawValue) {
      continue;
    }

    options[key] = rawValue;
  }

  return options;
}

function applyOptions(field: ExactAnswerField, raw: Record<string, unknown>): void {
  const caseSensitive = readBoolean(raw.caseSensitive ?? raw.case);
  if (caseSensitive !== null) {
    field.caseSensitive = caseSensitive;
  }

  const normalizeWhitespace = readBoolean(raw.normalizeWhitespace ?? raw.whitespace);
  if (normalizeWhitespace !== null) {
    field.normalizeWhitespace = normalizeWhitespace;
  }

  const aliases = readAliases(raw.aliases ?? raw.alias);
  if (aliases.length) {
    field.aliases = aliases;
  }

  const regex = cleanString(raw.regex);
  if (regex) {
    field.regex = regex;
  }

  const normalization = readNormalization(raw.normalization ?? raw.norm ?? raw.codeNormalization);
  if (normalization) {
    field.normalization = normalization;
  }
}

function readBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (['true', 'yes', '1', 'on'].includes(normalized)) {
    return true;
  }

  if (['false', 'no', '0', 'off'].includes(normalized)) {
    return false;
  }

  return null;
}

function readAliases(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(cleanString).filter(Boolean);
  }

  if (typeof value === 'string') {
    return value
      .split(/[;,]/)
      .map((alias) => alias.trim())
      .filter(Boolean);
  }

  return [];
}

function readNormalization(value: unknown): ExactAnswerNormalization | null {
  const normalized = cleanString(value).toLowerCase();
  return normalized === 'csharp' || normalized === 'text' ? normalized : null;
}

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function makeFieldId(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
