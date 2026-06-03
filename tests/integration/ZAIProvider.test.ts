/**
 * Integration Tests for ZAIProvider
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ZAIProvider } from '../../src/utils/ZAIProvider';
import { LLMProvider } from '../../src/types/providers';
import { TextGenerationOptions, VisionAnalysisOptions } from '../../src/types/openrouter';

describe('ZAIProvider Integration', () => {
    let provider: ZAIProvider;
    let mockFetch: any;

    beforeEach(() => {
        mockFetch = vi.fn();
        global.fetch = mockFetch;
        
        provider = new ZAIProvider({
            apiKey: 'test-api-key',
            provider: LLMProvider.ZAI,
            baseUrl: 'https://api.zai.ai/v1/chat/completions'
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('generateText', () => {
        it('should generate text successfully', async () => {
            const mockResponse = {
                id: 'test-id',
                model: 'zai-model',
                created: 1234567890,
                choices: [{
                    message: { content: 'Generated text from ZAI' }
                }]
            };
            
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => mockResponse
            });
            
            const options: TextGenerationOptions = {
                message: 'Write a summary',
                model: 'zai-model',
                language: 'english',
                maxTokens: 1000,
                temperature: 0.7
            };
            
            const result = await provider.generateText(options);
            
            expect(result.output).toBe('Generated text from ZAI');
            expect(result.metadata).toBeDefined();
            expect(result.metadata.provider_name).toBeDefined();
            expect(result.metadata.actual_model).toBe('zai-model');
        });

        it('should use correct headers', async () => {
            const mockResponse = {
                id: 'test-id',
                model: 'test-model',
                created: 1234567890,
                choices: [{
                    message: { content: 'Test' }
                }]
            };
            
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => mockResponse
            });
            
            const options: TextGenerationOptions = {
                message: 'Test',
                model: 'test-model',
                language: 'english'
            };
            
            await provider.generateText(options);
            
            const callArgs = mockFetch.mock.calls[0];
            const headers = callArgs[1].headers;
            
            expect(headers['Authorization']).toBe('Bearer test-api-key');
            expect(headers['Content-Type']).toBe('application/json');
            expect(headers['HTTP-Referer']).toBeUndefined(); // ZAI doesn't use referer
        });

        it('should use correct API endpoint', async () => {
            const mockResponse = {
                id: 'test-id',
                model: 'test-model',
                created: 1234567890,
                choices: [{
                    message: { content: 'Test' }
                }]
            };
            
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => mockResponse
            });
            
            const options: TextGenerationOptions = {
                message: 'Test',
                model: 'test-model',
                language: 'english'
            };
            
            await provider.generateText(options);
            
            const callArgs = mockFetch.mock.calls[0];
            expect(callArgs[0]).toBe('https://api.zai.ai/v1/chat/completions');
        });

        it('should handle API errors', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: false,
                status: 401,
                statusText: 'Unauthorized',
                json: async () => ({ error: { message: 'Invalid API key' } })
            });
            
            const options: TextGenerationOptions = {
                message: 'Test',
                model: 'test-model',
                language: 'english'
            };
            
            await expect(provider.generateText(options)).rejects.toThrow('Invalid API key');
            expect(mockFetch).toHaveBeenCalledTimes(1);
        });

        it('should retry on network errors', async () => {
            mockFetch
                .mockRejectedValueOnce(new Error('Network error'))
                .mockResolvedValueOnce({
                    ok: true,
                    json: async () => ({
                        id: 'test-id',
                        model: 'test-model',
                        created: 1234567890,
                        choices: [{ message: { content: 'Success after retry' } }]
                    })
                });
            
            const options: TextGenerationOptions = {
                message: 'Test',
                model: 'test-model',
                language: 'english'
            };
            
            const result = await provider.generateText(options);
            
            expect(result.output).toBe('Success after retry');
            expect(mockFetch).toHaveBeenCalledTimes(2);
        });
    });

    describe('analyzeImage', () => {
        it('should analyze image successfully', async () => {
            const mockResponse = {
                id: 'test-id',
                model: 'zai-vision-model',
                created: 1234567890,
                choices: [{
                    message: { content: 'Image analysis from ZAI' }
                }]
            };
            
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => mockResponse
            });
            
            const options: VisionAnalysisOptions = {
                imageUrl: 'https://example.com/image.jpg',
                prompt: 'Describe this image',
                model: 'zai-vision-model'
            };
            
            const result = await provider.analyzeImage(options);
            
            expect(result.analysis).toBe('Image analysis from ZAI');
            expect(result.metadata).toBeDefined();
        });

        it('should include image URL in request', async () => {
            const mockResponse = {
                id: 'test-id',
                model: 'test-model',
                created: 1234567890,
                choices: [{
                    message: { content: 'Test' }
                }]
            };
            
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => mockResponse
            });
            
            const options: VisionAnalysisOptions = {
                imageUrl: 'https://example.com/image.jpg',
                prompt: 'Describe this image',
                model: 'test-model'
            };
            
            await provider.analyzeImage(options);
            
            const callArgs = mockFetch.mock.calls[0];
            const requestBody = JSON.parse(callArgs[1].body);
            
            expect(requestBody.messages[0].content).toHaveLength(2);
            expect(requestBody.messages[0].content[0].type).toBe('text');
            expect(requestBody.messages[0].content[1].type).toBe('image_url');
            expect(requestBody.messages[0].content[1].image_url.url).toBe('https://example.com/image.jpg');
        });

        it('should handle API errors for vision', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: false,
                status: 400,
                statusText: 'Bad Request',
                json: async () => ({ error: { message: 'Invalid image URL' } })
            });
            
            const options: VisionAnalysisOptions = {
                imageUrl: 'invalid-url',
                prompt: 'Describe this image',
                model: 'test-model'
            };
            
            await expect(provider.analyzeImage(options)).rejects.toThrow('Invalid image URL');
            expect(mockFetch).toHaveBeenCalledTimes(1);
        });
    });

    describe('updateApiKey', () => {
        it('should update API key', () => {
            provider.updateApiKey('new-api-key');
            
            const options: TextGenerationOptions = {
                message: 'Test',
                model: 'test-model',
                language: 'english'
            };
            
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    id: 'test-id',
                    model: 'test-model',
                    created: 1234567890,
                    choices: [{ message: { content: 'Test' } }]
                })
            });
            
            provider.generateText(options);
            
            const callArgs = mockFetch.mock.calls[0];
            expect(callArgs[1].headers['Authorization']).toBe('Bearer new-api-key');
        });
    });
});