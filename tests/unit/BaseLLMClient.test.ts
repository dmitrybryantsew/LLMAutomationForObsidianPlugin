/**
 * Unit Tests for BaseLLMClient
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BaseLLMClient } from '../../src/utils/BaseLLMClient';
import { LLMProvider, ProviderApiResponse } from '../../src/types/providers';
import { TextGenerationOptions, FileContext } from '../../src/types/openrouter';

// Test implementation of BaseLLMClient
class TestLLMClient extends BaseLLMClient {
    constructor(config: any) {
        super(config);
    }

    async generateText(options: TextGenerationOptions): Promise<any> {
        const startTime = Date.now();
        const payload = this.buildPayload(options);
        
        const response = await this.fetchWithRetry(
            this.config.baseUrl || 'https://api.test.com/v1/chat/completions',
            {
                method: 'POST',
                headers: this.buildHeaders(),
                body: JSON.stringify(payload)
            }
        );

        const data = await response.json();
        const metadata = this.extractMetadata(data, startTime);

        return {
            output: data.choices[0].message.content,
            metadata
        };
    }

    async analyzeImage(options: any): Promise<any> {
        const startTime = Date.now();
        const payload = this.buildPayload(options);
        
        const response = await this.fetchWithRetry(
            this.config.baseUrl || 'https://api.test.com/v1/chat/completions',
            {
                method: 'POST',
                headers: this.buildHeaders(),
                body: JSON.stringify(payload)
            }
        );

        const data = await response.json();
        const metadata = this.extractMetadata(data, startTime);

        return {
            analysis: data.choices[0].message.content,
            metadata
        };
    }

    protected getProviderName(response: any): string {
        return 'test-provider';
    }

    protected buildHeaders(): Record<string, string> {
        return {
            'Authorization': `Bearer ${this.config.apiKey}`,
            'Content-Type': 'application/json'
        };
    }

    protected buildPayload(options: any): any {
        const content = this['buildMessageContent'](
            options.message,
            options.files,
            options.language
        );
        
        return {
            model: options.model,
            messages: [{ role: 'user', content }]
        };
    }
}

describe('BaseLLMClient', () => {
    let client: TestLLMClient;
    let mockFetch: any;

    beforeEach(() => {
        mockFetch = vi.fn();
        global.fetch = mockFetch;
        
        client = new TestLLMClient({
            apiKey: 'test-api-key',
            provider: LLMProvider.OPENROUTER,
            baseUrl: 'https://api.test.com/v1/chat/completions',
            timeout: 60000,
            maxRetries: 3
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('buildMessageContent', () => {
        it('should build message without file context or language', () => {
            const message = 'Test message';
            const result = client['buildMessageContent'](message);
            
            expect(result).toBe(message);
        });

        it('should build message with file context', () => {
            const message = 'Test message';
            const files: FileContext[] = [
                { path: '/path/to/file1.txt', name: 'file1.txt', content: 'Content of file 1' },
                { path: '/path/to/file2.txt', name: 'file2.txt', content: 'Content of file 2' }
            ];
            
            const result = client['buildMessageContent'](message, files);
            
            expect(result).toContain(message);
            expect(result).toContain('file1.txt contents:');
            expect(result).toContain('Content of file 1');
            expect(result).toContain('file2.txt contents:');
            expect(result).toContain('Content of file 2');
            expect(result).toContain('Context Files:');
        });

        it('should build message with language instruction', () => {
            const message = 'Test message';
            const language = 'english';
            
            const result = client['buildMessageContent'](message, undefined, language);
            
            expect(result).toContain(message);
            expect(result).toContain('Please answer in english');
        });

        it('should build message with both file context and language', () => {
            const message = 'Test message';
            const files: FileContext[] = [{ path: '/path/to/file1.txt', name: 'file1.txt', content: 'Content' }];
            const language = 'spanish';
            
            const result = client['buildMessageContent'](message, files, language);
            
            expect(result).toContain(message);
            expect(result).toContain('file1.txt contents:');
            expect(result).toContain('Content');
            expect(result).toContain('Context Files:');
            expect(result).toContain('Please answer in spanish');
        });

        it('should filter files without content', () => {
            const message = 'Test message';
            const files: FileContext[] = [
                { path: '/path/to/file1.txt', name: 'file1.txt', content: 'Content 1' },
                { path: '/path/to/file2.txt', name: 'file2.txt', content: '' },
                { path: '/path/to/file3.txt', name: 'file3.txt', content: 'Content 3' }
            ];
            
            const result = client['buildMessageContent'](message, files);
            
            expect(result).toContain('file1.txt contents:');
            expect(result).toContain('Content 1');
            expect(result).toContain('file3.txt contents:');
            expect(result).toContain('Content 3');
            expect(result).not.toContain('file2.txt contents:');
        });

        it('should handle empty file list', () => {
            const message = 'Test message';
            const files: FileContext[] = [];
            
            const result = client['buildMessageContent'](message, files);
            
            expect(result).toBe(message);
        });
    });

    describe('parseErrorResponse', () => {
        it('should parse error response with message', async () => {
            const mockResponse = {
                ok: false,
                statusText: 'Bad Request',
                json: async () => ({ error: { message: 'Invalid API key' } })
            };
            
            const result = await client['parseErrorResponse'](mockResponse as any);
            
            expect(result).toEqual({ message: 'Invalid API key' });
        });

        it('should parse error response without error field', async () => {
            const mockResponse = {
                ok: false,
                statusText: 'Bad Request',
                json: async () => ({ message: 'Direct message' })
            };
            
            const result = await client['parseErrorResponse'](mockResponse as any);
            
            expect(result).toEqual({ message: 'Direct message' });
        });

        it('should handle JSON parse errors', async () => {
            const mockResponse = {
                ok: false,
                statusText: 'Bad Request',
                json: async () => { throw new Error('Invalid JSON'); }
            };
            
            const result = await client['parseErrorResponse'](mockResponse as any);
            
            expect(result).toEqual({
                message: 'Bad Request',
                type: 'api_error'
            });
        });
    });

    describe('extractMetadata', () => {
        it('should extract metadata from API response', () => {
            const startTime = Date.now();
            const response: ProviderApiResponse = {
                id: 'test-id',
                object: 'chat.completion',
                model: 'test-model',
                created: 1234567890,
                choices: [{
                    index: 0,
                    message: { role: 'assistant', content: 'Test' },
                    finish_reason: 'stop'
                }]
            };
            
            const metadata = client['extractMetadata'](response, startTime);
            
            expect(metadata).toHaveProperty('provider_name');
            expect(metadata).toHaveProperty('actual_model');
            expect(metadata).toHaveProperty('request_time');
            expect(metadata).toHaveProperty('completion_time');
            expect(metadata).toHaveProperty('elapsed_time');
            expect(metadata.actual_model).toBe('test-model');
        });

        it('should include timing information', () => {
            const startTime = Date.now();
            const response: ProviderApiResponse = {
                id: 'test-id',
                object: 'chat.completion',
                model: 'test-model',
                created: 1234567890,
                choices: [{
                    index: 0,
                    message: { role: 'assistant', content: 'Test' },
                    finish_reason: 'stop'
                }]
            };
            
            const metadata = client['extractMetadata'](response, startTime);
            
            expect(parseFloat(metadata.elapsed_time)).toBeGreaterThanOrEqual(0);
            expect(metadata.request_time).toBeDefined();
            expect(metadata.completion_time).toBeDefined();
        });
    });

    describe('fetchWithRetry', () => {
        it('should succeed on first attempt', async () => {
            const mockResponse = {
                ok: true,
                json: async () => ({ test: 'data' })
            };
            
            mockFetch.mockResolvedValueOnce(mockResponse);
            
            const result = await client['fetchWithRetry']('https://api.test.com', {});
            
            expect(result.ok).toBe(true);
            expect(result.status).toBe(200);
            expect(await result.json()).toEqual({ test: 'data' });
            expect(mockFetch).toHaveBeenCalledTimes(1);
        });

        it('should retry on network errors', async () => {
            mockFetch
                .mockRejectedValueOnce(new Error('Network error'))
                .mockResolvedValueOnce({
                    ok: true,
                    json: async () => ({ test: 'data' })
                });
            
            const result = await client['fetchWithRetry']('https://api.test.com', {});
            
            expect(result.ok).toBe(true);
            expect(mockFetch).toHaveBeenCalledTimes(2);
        });

        it('should retry on 5xx errors', async () => {
            mockFetch
                .mockResolvedValueOnce({
                    ok: false,
                    status: 500,
                    statusText: 'Internal Server Error',
                    json: async () => ({ error: { message: 'Server error' } })
                })
                .mockResolvedValueOnce({
                    ok: true,
                    json: async () => ({ test: 'data' })
                });
            
            const result = await client['fetchWithRetry']('https://api.test.com', {});
            
            expect(result.ok).toBe(true);
            expect(mockFetch).toHaveBeenCalledTimes(2);
        });

        it('should not retry on 4xx errors', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: false,
                status: 401,
                statusText: 'Unauthorized',
                json: async () => ({ error: { message: 'Invalid API key' } })
            });
            
            await expect(client['fetchWithRetry']('https://api.test.com', {}))
                .rejects.toThrow('Invalid API key');
            
            expect(mockFetch).toHaveBeenCalledTimes(1);
        });

        it('should respect max retry count', async () => {
            mockFetch
                .mockRejectedValueOnce(new Error('Network error'))
                .mockRejectedValueOnce(new Error('Network error'))
                .mockRejectedValueOnce(new Error('Network error'))
                .mockRejectedValueOnce(new Error('Network error'));
            
            await expect(client['fetchWithRetry']('https://api.test.com', {}))
                .rejects.toThrow('Request failed after 3 attempts');
            
            expect(mockFetch).toHaveBeenCalledTimes(3);
        });

        it('should use exponential backoff', async () => {
            let attemptCount = 0;
            
            mockFetch
                .mockImplementation(() => {
                    attemptCount++;
                    if (attemptCount === 1 || attemptCount === 2) {
                        return Promise.reject(new Error('Network error'));
                    }
                    return Promise.resolve({
                        ok: true,
                        json: async () => ({ test: 'data' })
                    });
                });
            
            const startTime = Date.now();
            await client['fetchWithRetry']('https://api.test.com', {});
            const elapsed = Date.now() - startTime;
            
            // Should have taken at least 1000ms (first backoff) + 2000ms (second backoff)
            expect(elapsed).toBeGreaterThanOrEqual(3000);
            expect(mockFetch).toHaveBeenCalledTimes(3);
        });

        it('should timeout after configured timeout', async () => {
            const clientWithTimeout = new TestLLMClient({
                apiKey: 'test-api-key',
                provider: LLMProvider.OPENROUTER,
                baseUrl: 'https://api.test.com/v1/chat/completions',
                timeout: 100 // 100ms timeout
            });
            
            mockFetch.mockImplementationOnce((url: string, options: RequestInit) => {
                return new Promise((resolve, reject) => {
                    // Check if request is aborted
                    if (options.signal) {
                        options.signal.addEventListener('abort', () => {
                            reject(new DOMException('Aborted', 'AbortError'));
                        });
                    }
                    
                    setTimeout(() => {
                        resolve({
                            ok: true,
                            json: async () => ({ test: 'data' })
                        });
                    }, 200); // 200ms response time
                });
            });
            
            await expect(clientWithTimeout['fetchWithRetry']('https://api.test.com', {}))
                .rejects.toThrow('Request timeout after 100ms');
        }, { timeout: 10000 });
    });

    describe('updateApiKey', () => {
        it('should update API key', () => {
            const newKey = 'new-api-key';
            client.updateApiKey(newKey);
            
            expect(client['config'].apiKey).toBe(newKey);
        });
    });

    describe('Configuration', () => {
        it('should use default timeout when not provided', () => {
            const clientNoTimeout = new TestLLMClient({
                apiKey: 'test-api-key',
                provider: LLMProvider.OPENROUTER,
                baseUrl: 'https://api.test.com/v1/chat/completions'
            });
            
            // Access through the protected property using bracket notation
            expect((clientNoTimeout as any).timeout).toBe(60000);
        });

        it('should use custom timeout when provided', () => {
            const clientCustomTimeout = new TestLLMClient({
                apiKey: 'test-api-key',
                provider: LLMProvider.OPENROUTER,
                baseUrl: 'https://api.test.com/v1/chat/completions',
                timeout: 30000
            });
            
            expect((clientCustomTimeout as any).timeout).toBe(30000);
        });

        it('should use default max retries when not provided', () => {
            const clientNoRetries = new TestLLMClient({
                apiKey: 'test-api-key',
                provider: LLMProvider.OPENROUTER,
                baseUrl: 'https://api.test.com/v1/chat/completions'
            });
            
            expect((clientNoRetries as any).maxRetries).toBe(3);
        });

        it('should use custom max retries when provided', () => {
            const clientCustomRetries = new TestLLMClient({
                apiKey: 'test-api-key',
                provider: LLMProvider.OPENROUTER,
                baseUrl: 'https://api.test.com/v1/chat/completions',
                maxRetries: 5
            });
            
            expect((clientCustomRetries as any).maxRetries).toBe(5);
        });
    });

    describe('Integration with generateText', () => {
        it('should generate text successfully', async () => {
            const mockResponse = {
                id: 'test-id',
                object: 'chat.completion',
                model: 'test-model',
                created: 1234567890,
                choices: [{
                    index: 0,
                    message: { role: 'assistant', content: 'Generated text' },
                    finish_reason: 'stop'
                }]
            };
            
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => mockResponse
            });
            
            const options: TextGenerationOptions = {
                message: 'Write a summary',
                model: 'test-model'
            };
            
            const result = await client.generateText(options);
            
            expect(result.output).toBe('Generated text');
            expect(result.metadata).toBeDefined();
            expect(result.metadata.provider_name).toBe('test-provider');
            expect(result.metadata.actual_model).toBe('test-model');
        });

        it('should include file context in request', async () => {
            const mockResponse = {
                id: 'test-id',
                object: 'chat.completion',
                model: 'test-model',
                created: 1234567890,
                choices: [{
                    index: 0,
                    message: { role: 'assistant', content: 'Generated text' },
                    finish_reason: 'stop'
                }]
            };
            
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => mockResponse
            });
            
            const options: TextGenerationOptions = {
                message: 'Write a summary',
                model: 'test-model',
                files: [
                    { path: '/path/to/file1.txt', name: 'file1.txt', content: 'File content' }
                ]
            };
            
            const result = await client.generateText(options);
            
            expect(result.output).toBe('Generated text');
            
            const callArgs = mockFetch.mock.calls[0];
            const requestBody = JSON.parse(callArgs[1].body);
            const content = requestBody.messages[0].content;
            
            // Verify the structure: message, then file context
            expect(content).toContain('Write a summary');
            expect(content).toContain('Context Files:');
            expect(content).toContain('file1.txt contents:');
            expect(content).toContain('File content');
        });

        it('should include language instruction in request', async () => {
            const mockResponse = {
                id: 'test-id',
                object: 'chat.completion',
                model: 'test-model',
                created: 1234567890,
                choices: [{
                    index: 0,
                    message: { role: 'assistant', content: 'Generated text' },
                    finish_reason: 'stop'
                }]
            };
            
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => mockResponse
            });
            
            const options: TextGenerationOptions = {
                message: 'Write a summary',
                model: 'test-model',
                language: 'spanish'
            };
            
            const result = await client.generateText(options);
            
            expect(result.output).toBe('Generated text');
            
            const callArgs = mockFetch.mock.calls[0];
            const requestBody = JSON.parse(callArgs[1].body);
            const content = requestBody.messages[0].content;
            
            // Verify the structure: message, then language instruction
            expect(content).toContain('Write a summary');
            expect(content).toContain('Please answer in spanish');
        });

        it('should use correct headers', async () => {
            const mockResponse = {
                id: 'test-id',
                object: 'chat.completion',
                model: 'test-model',
                created: 1234567890,
                choices: [{
                    index: 0,
                    message: { role: 'assistant', content: 'Generated text' },
                    finish_reason: 'stop'
                }]
            };
            
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => mockResponse
            });
            
            const options: TextGenerationOptions = {
                message: 'Write a summary',
                model: 'test-model'
            };
            
            await client.generateText(options);
            
            const callArgs = mockFetch.mock.calls[0];
            const headers = callArgs[1].headers;
            
            expect(headers['Authorization']).toBe('Bearer test-api-key');
            expect(headers['Content-Type']).toBe('application/json');
        });
    });
});


