/**
 * Integration Tests for OpenRouterProvider
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenRouterProvider } from '../../src/utils/OpenRouterProvider';
import { LLMProvider } from '../../src/types/providers';
import { TextGenerationOptions, VisionAnalysisOptions } from '../../src/types/openrouter';

describe('OpenRouterProvider Integration', () => {
    let provider: OpenRouterProvider;
    let mockFetch: any;

    beforeEach(() => {
        mockFetch = vi.fn();
        global.fetch = mockFetch;
        
        provider = new OpenRouterProvider({
            apiKey: 'test-api-key',
            provider: LLMProvider.OPENROUTER,
            baseUrl: 'https://api.openrouter.ai/v1/chat/completions',
            referer: 'https://test-app.com'
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('generateText', () => {
        it('should generate text successfully', async () => {
            const mockResponse = {
                id: 'test-id',
                model: 'meta-llama/llama-3.1-8b-instruct:free',
                created: 1234567890,
                choices: [{
                    message: { content: 'Generated text response' }
                }]
            };
            
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => mockResponse
            });
            
            const options: TextGenerationOptions = {
                message: 'Write a summary',
                model: 'meta-llama/llama-3.1-8b-instruct:free',
                language: 'english',
                maxTokens: 1000,
                temperature: 0.7
            };
            
            const result = await provider.generateText(options);
            
            expect(result.output).toBe('Generated text response');
            expect(result.metadata).toBeDefined();
            expect(result.metadata.provider_name).toBeDefined();
            expect(result.metadata.actual_model).toBe('meta-llama/llama-3.1-8b-instruct:free');
        });

        it('should include language instruction in message', async () => {
            const mockResponse = {
                id: 'test-id',
                model: 'test-model',
                created: 1234567890,
                choices: [{
                    message: { content: 'Respuesta en español' }
                }]
            };
            
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => mockResponse
            });
            
            const options: TextGenerationOptions = {
                message: 'Write a summary',
                model: 'test-model',
                language: 'spanish',
                maxTokens: 1000
            };
            
            await provider.generateText(options);
            
            const callArgs = mockFetch.mock.calls[0];
            const requestBody = JSON.parse(callArgs[1].body);
            const content = requestBody.messages[0].content;
            
            // Verify the structure: message, then language instruction
            expect(content).toContain('Write a summary');
            expect(content).toContain('Please answer in spanish');
        });

        it('should read text from OpenRouter content blocks', async () => {
            const mockResponse = {
                id: 'test-id',
                model: 'test-model',
                created: 1234567890,
                choices: [{
                    message: {
                        role: 'assistant',
                        content: [
                            { type: 'text', text: 'First block' },
                            { type: 'text', text: 'Second block' }
                        ]
                    },
                    finish_reason: 'stop'
                }]
            };

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => mockResponse
            });

            const result = await provider.generateText({
                message: 'Test',
                model: 'test-model',
                language: 'english'
            });

            expect(result.output).toBe('First block\nSecond block');
        });

        it('should fall back to reasoning text when content is empty', async () => {
            const mockResponse = {
                id: 'test-id',
                model: 'test-model',
                created: 1234567890,
                choices: [{
                    message: {
                        role: 'assistant',
                        content: '',
                        reasoning: 'Reasoning-only output'
                    },
                    finish_reason: 'stop'
                }]
            };

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => mockResponse
            });

            const result = await provider.generateText({
                message: 'Test',
                model: 'test-model',
                language: 'english'
            });

            expect(result.output).toBe('Reasoning-only output');
        });

        it('should include file context in message', async () => {
            const mockResponse = {
                id: 'test-id',
                model: 'test-model',
                created: 1234567890,
                choices: [{
                    message: { content: 'Summary with file context' }
                }]
            };
            
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => mockResponse
            });
            
            const options: TextGenerationOptions = {
                message: 'Summarize the files',
                model: 'test-model',
                language: 'english',
                files: [
                    { path: '/path/to/file1.md', name: 'file1.md', content: 'Content 1' },
                    { path: '/path/to/file2.md', name: 'file2.md', content: 'Content 2' }
                ]
            };
            
            await provider.generateText(options);
            
            const callArgs = mockFetch.mock.calls[0];
            const requestBody = JSON.parse(callArgs[1].body);
            
            expect(requestBody.messages[0].content).toContain('// file1.md contents:');
            expect(requestBody.messages[0].content).toContain('Content 1');
            expect(requestBody.messages[0].content).toContain('// file2.md contents:');
            expect(requestBody.messages[0].content).toContain('Content 2');
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
            expect(headers['HTTP-Referer']).toBe('https://test-app.com');
            expect(headers['Content-Type']).toBe('application/json');
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
            expect(callArgs[0]).toBe('https://api.openrouter.ai/v1/chat/completions');
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

        it('should use default temperature if not provided', async () => {
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
                // temperature not provided
            };
            
            await provider.generateText(options);
            
            const callArgs = mockFetch.mock.calls[0];
            const requestBody = JSON.parse(callArgs[1].body);
            
            expect(requestBody.temperature).toBe(0.7);
        });

        it('should use default maxTokens if not provided', async () => {
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
                // maxTokens not provided
            };
            
            await provider.generateText(options);
            
            const callArgs = mockFetch.mock.calls[0];
            const requestBody = JSON.parse(callArgs[1].body);
            
            expect(requestBody.max_tokens).toBe(2000);
        });
    });

    describe('analyzeImage', () => {
        it('should analyze image successfully', async () => {
            const mockResponse = {
                id: 'test-id',
                model: 'qwen/qwen2.5-vl-32b-instruct:free',
                created: 1234567890,
                choices: [{
                    message: { content: 'Image analysis result' }
                }]
            };
            
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => mockResponse
            });
            
            const options: VisionAnalysisOptions = {
                imageUrl: 'https://example.com/image.jpg',
                prompt: 'Describe this image',
                model: 'qwen/qwen2.5-vl-32b-instruct:free'
            };
            
            const result = await provider.analyzeImage(options);
            
            expect(result.analysis).toBe('Image analysis result');
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
            expect(requestBody.messages[0].content[0].text).toBe('Describe this image');
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

        it('should use default temperature for vision', async () => {
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
                prompt: 'Describe',
                model: 'test-model'
                // temperature not provided
            };
            
            await provider.analyzeImage(options);
            
            const callArgs = mockFetch.mock.calls[0];
            const requestBody = JSON.parse(callArgs[1].body);
            
            expect(requestBody.temperature).toBe(0.7);
        });

        it('should use default maxTokens for vision', async () => {
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
                prompt: 'Describe',
                model: 'test-model'
                // maxTokens not provided
            };
            
            await provider.analyzeImage(options);
            
            const callArgs = mockFetch.mock.calls[0];
            const requestBody = JSON.parse(callArgs[1].body);
            
            expect(requestBody.max_tokens).toBe(2000);
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
            
            // Mock a successful response
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

    describe('Error Handling', () => {
        it('should handle timeout errors', async () => {
            mockFetch.mockRejectedValueOnce(new Error('Request timeout'));
            
            const options: TextGenerationOptions = {
                message: 'Test',
                model: 'test-model',
                language: 'english'
            };
            
            await expect(provider.generateText(options)).rejects.toThrow();
        });

        it('should handle malformed JSON response', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => { throw new Error('Invalid JSON'); }
            });
            
            const options: TextGenerationOptions = {
                message: 'Test',
                model: 'test-model',
                language: 'english'
            };
            
            await expect(provider.generateText(options)).rejects.toThrow();
        });

        it('should handle missing choices in response', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ id: 'test-id', model: 'test-model' })
            });
            
            const options: TextGenerationOptions = {
                message: 'Test',
                model: 'test-model',
                language: 'english'
            };
            
            await expect(provider.generateText(options)).rejects.toThrow();
        });
    });
});
