import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OllamaProvider } from '../../src/utils/OllamaProvider';
import { LLMProvider } from '../../src/types/providers';
import { TextGenerationOptions } from '../../src/types/openrouter';

describe('OllamaProvider Integration', () => {
    let provider: OllamaProvider;
    let mockFetch: any;

    beforeEach(() => {
        mockFetch = vi.fn();
        global.fetch = mockFetch;

        provider = new OllamaProvider({
            apiKey: '',
            provider: LLMProvider.OLLAMA,
            baseUrl: 'http://localhost:11434'
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should generate text through Ollama chat API', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                model: 'gemma4:31b-cloud',
                message: {
                    role: 'assistant',
                    content: 'Generated text from Ollama'
                },
                done: true
            })
        });

        const options: TextGenerationOptions = {
            message: 'Write a summary',
            model: 'gemma4:31b-cloud',
            language: 'english',
            maxTokens: 1000,
            temperature: 0.2
        };

        const result = await provider.generateText(options);

        expect(result.output).toBe('Generated text from Ollama');
        expect(result.metadata.provider_name).toBe('Ollama');
        expect(result.metadata.actual_model).toBe('gemma4:31b-cloud');

        const [url, request] = mockFetch.mock.calls[0];
        expect(url).toBe('http://localhost:11434/api/chat');
        expect(request.headers.Authorization).toBeUndefined();
        expect(request.headers['Content-Type']).toBe('application/json');

        const body = JSON.parse(request.body);
        expect(body.stream).toBe(false);
        expect(body.model).toBe('gemma4:31b-cloud');
        expect(body.messages[0].role).toBe('user');
        expect(body.messages[0].content).toContain('Write a summary');
        expect(body.options.num_predict).toBe(1000);
    });

    it('should list models from Ollama tags API', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                models: [
                    { name: 'gemma4:31b-cloud' },
                    { model: 'llama3.2:latest' }
                ]
            })
        });

        const models = await provider.listModels();

        expect(models).toEqual(['gemma4:31b-cloud', 'llama3.2:latest']);
        expect(mockFetch.mock.calls[0][0]).toBe('http://localhost:11434/api/tags');
    });

    it('should surface API errors', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: false,
            status: 404,
            json: async () => ({ error: { message: 'model not found' } })
        });

        await expect(provider.generateText({
            message: 'Test',
            model: 'missing-model',
            language: 'english'
        })).rejects.toThrow('model not found');
    });
});
