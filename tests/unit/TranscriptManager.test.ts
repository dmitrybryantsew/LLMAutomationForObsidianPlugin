import { describe, expect, it, vi } from 'vitest';
import { TranscriptManager } from '../../src/utils/TranscriptManager';

function createManager(providerOutput = 'ai, video-summary') {
  const generateText = vi.fn().mockResolvedValue({ output: providerOutput });
  const getClientForProvider = vi.fn().mockReturnValue({ generateText });
  const tagManager = {
    formatTagsForPrompt: vi.fn().mockReturnValue('Existing tags: ai'),
    addCustomTags: vi.fn(),
  };

  const manager = new TranscriptManager(
    {} as any,
    {} as any,
    tagManager as any,
    {} as any,
    null,
    {
      defaultLLMProvider: 'openrouter',
      openrouterTagModel: 'google/gemma-4-31b-it',
    },
    { getClientForProvider } as any
  );

  return { manager, generateText, getClientForProvider, tagManager };
}

describe('TranscriptManager tag model selection', () => {
  it('uses the configured OpenRouter tag model instead of the summary model', async () => {
    const { manager, generateText, getClientForProvider } = createManager();

    const tags = await (manager as any).generateTags(
      'Transcript content about model routing.',
      { title: 'Routing test' },
      {
        provider: 'openrouter',
        summaryModel: 'moonshotai/kimi-k2.6',
        tagPrompt: 'Generate tags',
      }
    );

    expect(getClientForProvider).toHaveBeenCalledWith('openrouter');
    expect(generateText).toHaveBeenCalledWith(expect.objectContaining({
      model: 'google/gemma-4-31b-it',
      maxTokens: 200,
    }));
    expect(tags).toEqual(['ai', 'video-summary']);
  });

  it('keeps non-OpenRouter tag generation on the selected summary model', async () => {
    const { manager, generateText, getClientForProvider } = createManager();

    await (manager as any).generateTags(
      'Transcript content about model routing.',
      { title: 'Routing test' },
      {
        provider: 'chutes',
        summaryModel: 'deepseek-ai/DeepSeek-V3.2-Speciale-TEE',
        tagPrompt: 'Generate tags',
      }
    );

    expect(getClientForProvider).toHaveBeenCalledWith('chutes');
    expect(generateText).toHaveBeenCalledWith(expect.objectContaining({
      model: 'deepseek-ai/DeepSeek-V3.2-Speciale-TEE',
    }));
  });
});
