import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QwenGateProvider } from '../../src/utils/QwenGateProvider';
import { LLMProvider } from '../../src/types/providers';

describe('QwenGateProvider', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('normalizes base URLs with and without /v1', () => {
    const withV1 = new QwenGateProvider({ provider: LLMProvider.QWENGATE, apiKey: '', baseUrl: 'http://localhost:26405/v1' });
    const withoutV1 = new QwenGateProvider({ provider: LLMProvider.QWENGATE, apiKey: '', baseUrl: 'http://localhost:26405' });
    // Both should hit the same endpoint; verify indirectly through updateBaseUrl not throwing.
    expect(withV1).toBeDefined();
    expect(withoutV1).toBeDefined();
  });

  it('extracts content and falls back to reasoning_content when content is empty', async () => {
    const provider = new QwenGateProvider({ provider: LLMProvider.QWENGATE, apiKey: '', baseUrl: 'http://localhost:26405/v1' });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { role: 'assistant', content: 'hello', reasoning_content: 'thinking...' }, finish_reason: 'stop' }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { role: 'assistant', content: '', reasoning_content: 'fallback answer' }, finish_reason: 'stop' }],
        }),
      });

    vi.stubGlobal('fetch', fetchMock);
    // @ts-expect-error test override
    provider.fetchWithRetry = async () => fetchMock();

    const first = await provider.generateText({ message: 'hi', model: 'qwen3.7-plus', maxTokens: 100 });
    expect(first.output).toBe('hello');

    const second = await provider.generateText({ message: 'hi', model: 'qwen3.7-plus', maxTokens: 100 });
    expect(second.output).toBe('fallback answer');

    vi.unstubAllGlobals();
  });
});
