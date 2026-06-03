/**
 * Unit Tests for LLMClientFactory
 */

import { describe, it, expect, vi } from 'vitest';
import { LLMClientFactory, createLLMClientFromSettings } from '../../src/utils/LLMClientFactory';
import { OpenRouterProvider } from '../../src/utils/OpenRouterProvider';
import { ChutesProvider } from '../../src/utils/ChutesProvider';
import { ZAIProvider } from '../../src/utils/ZAIProvider';
import { OllamaProvider } from '../../src/utils/OllamaProvider';
import { LLMProvider } from '../../src/types/providers';

describe('LLMClientFactory', () => {
    describe('createClient', () => {
        it('should create OpenRouter client', () => {
            const client = LLMClientFactory.createClient(
                LLMProvider.OPENROUTER,
                {
                    apiKey: 'test-key',
                    provider: LLMProvider.OPENROUTER
                }
            );
            
            expect(client).toBeInstanceOf(OpenRouterProvider);
        });

        it('should create Chutes client', () => {
            const client = LLMClientFactory.createClient(
                LLMProvider.CHUTES,
                {
                    apiKey: 'test-key',
                    provider: LLMProvider.CHUTES
                }
            );
            
            expect(client).toBeInstanceOf(ChutesProvider);
        });

        it('should create ZAI client', () => {
            const client = LLMClientFactory.createClient(
                LLMProvider.ZAI,
                {
                    apiKey: 'test-key',
                    provider: LLMProvider.ZAI
                }
            );
            
            expect(client).toBeInstanceOf(ZAIProvider);
        });

        it('should create Ollama client', () => {
            const client = LLMClientFactory.createClient(
                LLMProvider.OLLAMA,
                {
                    apiKey: '',
                    baseUrl: 'http://localhost:11434',
                    provider: LLMProvider.OLLAMA
                }
            );

            expect(client).toBeInstanceOf(OllamaProvider);
        });

        it('should throw error for unsupported provider', () => {
            expect(() => {
                LLMClientFactory.createClient(
                    'unsupported' as LLMProvider,
                    {
                        apiKey: 'test-key',
                        provider: 'unsupported' as LLMProvider
                    }
                );
            }).toThrow('Unsupported provider: unsupported');
        });
    });

    describe('createOpenRouterClient', () => {
        it('should create OpenRouter client with API key', () => {
            const client = LLMClientFactory.createOpenRouterClient('test-key');
            
            expect(client).toBeInstanceOf(OpenRouterProvider);
        });

        it('should create OpenRouter client with custom base URL', () => {
            const client = LLMClientFactory.createOpenRouterClient(
                'test-key',
                'https://custom-api.com/v1/chat/completions'
            );
            
            expect(client).toBeInstanceOf(OpenRouterProvider);
        });

        it('should create OpenRouter client with custom referer', () => {
            const client = LLMClientFactory.createOpenRouterClient(
                'test-key',
                undefined,
                'https://my-app.com'
            );
            
            expect(client).toBeInstanceOf(OpenRouterProvider);
        });

        it('should create OpenRouter client with all custom options', () => {
            const client = LLMClientFactory.createOpenRouterClient(
                'test-key',
                'https://custom-api.com/v1/chat/completions',
                'https://my-app.com'
            );
            
            expect(client).toBeInstanceOf(OpenRouterProvider);
        });
    });

    describe('createChutesClient', () => {
        it('should create Chutes client with API key', () => {
            const client = LLMClientFactory.createChutesClient('test-key');
            
            expect(client).toBeInstanceOf(ChutesProvider);
        });

        it('should create Chutes client with custom base URL', () => {
            const client = LLMClientFactory.createChutesClient(
                'test-key',
                'https://custom-chutes.com/v1/chat/completions'
            );
            
            expect(client).toBeInstanceOf(ChutesProvider);
        });
    });

    describe('createZAIClient', () => {
        it('should create ZAI client with API key', () => {
            const client = LLMClientFactory.createZAIClient('test-key');
            
            expect(client).toBeInstanceOf(ZAIProvider);
        });

        it('should create ZAI client with custom base URL', () => {
            const client = LLMClientFactory.createZAIClient(
                'test-key',
                'https://custom-zai.com/v1/chat/completions'
            );
            
            expect(client).toBeInstanceOf(ZAIProvider);
        });
    });

    describe('createOllamaClient', () => {
        it('should create Ollama client without API key', () => {
            const client = LLMClientFactory.createOllamaClient('http://localhost:11434');

            expect(client).toBeInstanceOf(OllamaProvider);
        });
    });

    describe('parseProvider', () => {
        it('should parse openrouter string', () => {
            const provider = LLMClientFactory.parseProvider('openrouter');
            expect(provider).toBe(LLMProvider.OPENROUTER);
        });

        it('should parse OpenRouter string (case insensitive)', () => {
            const provider = LLMClientFactory.parseProvider('OpenRouter');
            expect(provider).toBe(LLMProvider.OPENROUTER);
        });

        it('should parse OPENROUTER string (case insensitive)', () => {
            const provider = LLMClientFactory.parseProvider('OPENROUTER');
            expect(provider).toBe(LLMProvider.OPENROUTER);
        });

        it('should parse chutes string', () => {
            const provider = LLMClientFactory.parseProvider('chutes');
            expect(provider).toBe(LLMProvider.CHUTES);
        });

        it('should parse Chutes string (case insensitive)', () => {
            const provider = LLMClientFactory.parseProvider('Chutes');
            expect(provider).toBe(LLMProvider.CHUTES);
        });

        it('should parse zai string', () => {
            const provider = LLMClientFactory.parseProvider('zai');
            expect(provider).toBe(LLMProvider.ZAI);
        });

        it('should parse ollama string', () => {
            const provider = LLMClientFactory.parseProvider('ollama');
            expect(provider).toBe(LLMProvider.OLLAMA);
        });

        it('should parse ZAI string (case insensitive)', () => {
            const provider = LLMClientFactory.parseProvider('ZAI');
            expect(provider).toBe(LLMProvider.ZAI);
        });

        it('should trim whitespace', () => {
            const provider = LLMClientFactory.parseProvider('  openrouter  ');
            expect(provider).toBe(LLMProvider.OPENROUTER);
        });

        it('should throw error for unknown provider', () => {
            expect(() => {
                LLMClientFactory.parseProvider('unknown');
            }).toThrow('Unknown provider: unknown');
        });

        it('should throw error for empty string', () => {
            expect(() => {
                LLMClientFactory.parseProvider('');
            }).toThrow('Unknown provider: ');
        });
    });

    describe('getProviderName', () => {
        it('should return OpenRouter for OPENROUTER enum', () => {
            const name = LLMClientFactory.getProviderName(LLMProvider.OPENROUTER);
            expect(name).toBe('OpenRouter');
        });

        it('should return Chutes for CHUTES enum', () => {
            const name = LLMClientFactory.getProviderName(LLMProvider.CHUTES);
            expect(name).toBe('Chutes');
        });

        it('should return ZAI for ZAI enum', () => {
            const name = LLMClientFactory.getProviderName(LLMProvider.ZAI);
            expect(name).toBe('ZAI');
        });

        it('should return Ollama for OLLAMA enum', () => {
            const name = LLMClientFactory.getProviderName(LLMProvider.OLLAMA);
            expect(name).toBe('Ollama');
        });
    });
});

describe('createLLMClientFromSettings', () => {
    it('should create OpenRouter client from settings', () => {
        const client = createLLMClientFromSettings(
            LLMProvider.OPENROUTER,
            {
                openRouterApiKey: 'test-key'
            }
        );
        
        expect(client).toBeInstanceOf(OpenRouterProvider);
    });

    it('should create Chutes client from settings', () => {
        const client = createLLMClientFromSettings(
            LLMProvider.CHUTES,
            {
                chutesApiKey: 'test-key'
            }
        );
        
        expect(client).toBeInstanceOf(ChutesProvider);
    });

    it('should create ZAI client from settings', () => {
        const client = createLLMClientFromSettings(
            LLMProvider.ZAI,
            {
                zaiApiKey: 'test-key'
            }
        );
        
        expect(client).toBeInstanceOf(ZAIProvider);
    });

    it('should create Ollama client from settings without API key', () => {
        const client = createLLMClientFromSettings(
            LLMProvider.OLLAMA,
            {
                ollamaBaseUrl: 'http://localhost:11434'
            }
        );

        expect(client).toBeInstanceOf(OllamaProvider);
    });

    it('should throw error if OpenRouter API key is missing', () => {
        expect(() => {
            createLLMClientFromSettings(
                LLMProvider.OPENROUTER,
                {}
            );
        }).toThrow('OpenRouter API key is required');
    });

    it('should throw error if Chutes API key is missing', () => {
        expect(() => {
            createLLMClientFromSettings(
                LLMProvider.CHUTES,
                {}
            );
        }).toThrow('Chutes API key is required');
    });

    it('should throw error if ZAI API key is missing', () => {
        expect(() => {
            createLLMClientFromSettings(
                LLMProvider.ZAI,
                {}
            );
        }).toThrow('ZAI API key is required');
    });

    it('should handle empty API key strings', () => {
        expect(() => {
            createLLMClientFromSettings(
                LLMProvider.OPENROUTER,
                { openRouterApiKey: '' }
            );
        }).toThrow('OpenRouter API key is required');
    });

    it('should handle undefined API key', () => {
        expect(() => {
            createLLMClientFromSettings(
                LLMProvider.OPENROUTER,
                { openRouterApiKey: undefined }
            );
        }).toThrow('OpenRouter API key is required');
    });
});
