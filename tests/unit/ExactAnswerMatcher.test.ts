import { describe, expect, it } from 'vitest';
import {
  formatExactAnswerFieldLine,
  matchesExactAnswerField,
  normalizeExactAnswer,
  normalizeExactAnswerField,
  parseExactAnswerFieldLine,
} from '../../src/utils/spacedRepetition/ExactAnswerMatcher';

describe('ExactAnswerMatcher', () => {
  it('matches text case-insensitively with normalized whitespace by default', () => {
    expect(matchesExactAnswerField('  SELECT   MANY ', {
      id: 'method',
      label: 'Method',
      answer: 'Select Many',
    })).toBe(true);
  });

  it('supports case-sensitive fields', () => {
    const field = {
      id: 'method',
      label: 'Method',
      answer: 'SelectMany',
      caseSensitive: true,
    };

    expect(matchesExactAnswerField('SelectMany', field)).toBe(true);
    expect(matchesExactAnswerField('selectmany', field)).toBe(false);
  });

  it('supports aliases', () => {
    expect(matchesExactAnswerField('ThenByDescending', {
      id: 'method',
      label: 'Method',
      answer: 'OrderByDescending',
      aliases: ['ThenByDescending'],
    })).toBe(true);
  });

  it('supports regex matching', () => {
    expect(matchesExactAnswerField('Enumerable.Where(source, x => x.Age > 18)', {
      id: 'call',
      label: 'Call',
      answer: 'Where',
      regex: '^Enumerable\\.Where\\(',
    })).toBe(true);
  });

  it('supports basic C# syntax normalization', () => {
    const field = {
      id: 'predicate',
      label: 'Predicate',
      answer: 'x=>x.Age>=18',
      normalization: 'csharp' as const,
    };

    expect(normalizeExactAnswer('x => x.Age >= 18', field)).toBe('x=>x.age>=18');
    expect(matchesExactAnswerField('x => x.Age >= 18', field)).toBe(true);
  });

  it('parses JSON options from exact field lines', () => {
    const field = parseExactAnswerFieldLine('Predicate::x => x.Age >= 18::{"aliases":["person => person.Age >= 18"],"normalization":"csharp"}');

    expect(field).toMatchObject({
      id: 'predicate',
      label: 'Predicate',
      answer: 'x => x.Age >= 18',
      aliases: ['person => person.Age >= 18'],
      normalization: 'csharp',
    });
  });

  it('parses pipe options from exact field lines', () => {
    const field = parseExactAnswerFieldLine('Method::SelectMany::aliases=SelectMany<T>;Enumerable.SelectMany|case=true|whitespace=false');

    expect(field).toMatchObject({
      label: 'Method',
      answer: 'SelectMany',
      aliases: ['SelectMany<T>', 'Enumerable.SelectMany'],
      caseSensitive: true,
      normalizeWhitespace: false,
    });
  });

  it('formats only non-default options', () => {
    expect(formatExactAnswerFieldLine({
      id: 'method',
      label: 'Method',
      answer: 'Where',
      placeholder: null,
      aliases: ['Enumerable.Where'],
      normalization: 'csharp',
    })).toBe('Method::Where::{"aliases":["Enumerable.Where"],"normalization":"csharp"}');
  });

  it('normalizes generated field objects with matching options', () => {
    expect(normalizeExactAnswerField({
      label: 'Call',
      answer: 'Where',
      regex: '^Where',
      caseSensitive: true,
      normalizeWhitespace: false,
      normalization: 'csharp',
      aliases: ['Enumerable.Where'],
    })).toEqual({
      id: 'call',
      label: 'Call',
      answer: 'Where',
      placeholder: null,
      regex: '^Where',
      caseSensitive: true,
      normalizeWhitespace: false,
      normalization: 'csharp',
      aliases: ['Enumerable.Where'],
    });
  });
});
