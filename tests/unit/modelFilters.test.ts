import { describe, expect, it } from 'vitest';
import { isThinkingModel, modelLabel, sortModelsByThinking, stripThinkingTags } from '../../src/utils/modelFilters';

describe('modelFilters', () => {
  it('detects known thinking model ids', () => {
    expect(isThinkingModel('nim:nvidia/nemotron-3-nano-omni-30b-a3b-reasoning')).toBe(true);
    expect(isThinkingModel('deepseek/deepseek-r1:free')).toBe(true);
    expect(isThinkingModel('openai/o1-mini')).toBe(true);
    expect(isThinkingModel('openai/o3')).toBe(true);
    expect(isThinkingModel('qwen/qwq-32b')).toBe(true);
    expect(isThinkingModel('qwen/qwen3-235b-a22b-thinking')).toBe(true);
    expect(isThinkingModel('chutes:moonshotai/Kimi-K2.6-TEE')).toBe(true);
    expect(isThinkingModel('chutes:moonshotai/Kimi-K2.5-TEE')).toBe(true);
    expect(isThinkingModel('moonshotai/kimi-k2-thinking')).toBe(true);
    expect(isThinkingModel('zai:glm-4.6')).toBe(true);
    expect(isThinkingModel('chutes:zai-org/GLM-5-TEE')).toBe(true);
  });

  it('does not flag regular models', () => {
    // -TEE means Trusted Execution Environment (confidential compute), NOT thinking —
    // but the Kimi K2.5+ line itself is a thinking model regardless of the suffix.
    expect(isThinkingModel('deepseek-ai/DeepSeek-V3.2-Speciale-TEE')).toBe(false);
    expect(isThinkingModel('chutes:zai-org/GLM-5.1-TEE')).toBe(false);
    expect(isThinkingModel('gpt-4o')).toBe(false);
    expect(isThinkingModel('gemma4:31b-cloud')).toBe(false);
    expect(isThinkingModel('meta-llama/llama-3.3-70b-instruct')).toBe(false);
    expect(isThinkingModel('openai/gpt-4.1')).toBe(false);
  });

  it('labels and sorts thinking models last', () => {
    expect(modelLabel('deepseek/deepseek-r1:free')).toContain('(thinking)');
    expect(modelLabel('gpt-4o')).not.toContain('(thinking)');

    const sorted = sortModelsByThinking(['deepseek/deepseek-r1:free', 'gpt-4o', 'claude-3.5-sonnet']);
    expect(sorted).toEqual(['claude-3.5-sonnet', 'gpt-4o', 'deepseek/deepseek-r1:free']);
  });

  it('strips qwen3 thinking blocks', () => {
    const raw = 'Thinking about the book...\n\n\n\n{"questions":[]}';
    expect(stripThinkingTags(raw)).toBe('{"questions":[]}');
  });

  it('strips <thinking> tags including unterminated ones', () => {
    expect(stripThinkingTags('<thinking>secret</thinking>{"questions":[]}')).toBe('{"questions":[]}');
    expect(stripThinkingTags('<thinking>cut off mid reasoning')).toBe('');
  });

  it('strips markdown reasoning sections', () => {
    const raw = '# Thinking\nI should analyze this...\n\n# Answer\n{"questions":[]}';
    expect(stripThinkingTags(raw)).toContain('{"questions":[]}');
    expect(stripThinkingTags(raw)).not.toContain('I should analyze this');
  });

  it('leaves plain answers untouched', () => {
    expect(stripThinkingTags('{"questions": []}')).toBe('{"questions": []}');
  });
});
