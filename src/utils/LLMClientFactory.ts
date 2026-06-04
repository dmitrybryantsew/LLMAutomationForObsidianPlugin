/**
 * LLM Client Factory
 * Factory for creating provider-specific LLM clients
 */

import { OpenRouterProvider } from './OpenRouterProvider';
import { ChutesProvider } from './ChutesProvider';
import { ZAIProvider } from './ZAIProvider';
import { OllamaProvider } from './OllamaProvider';
import {
    LLMProvider,
    ProviderConfig,
    OpenRouterConfig,
    ChutesConfig,
    ZAIConfig,
    OllamaConfig
} from '../types/providers';

export type LLMClient = OpenRouterProvider | ChutesProvider | ZAIProvider | OllamaProvider;

/**
 * LLM Client Factory
 * Creates provider-specific clients based on configuration
 */
export class LLMClientFactory {
    /**
     * Create an LLM client based on provider type
     * @param provider - The provider type (OPENROUTER, CHUTES, ZAI)
     * @param config - Provider configuration
     * @returns Provider-specific client instance
     */
    static createClient(
        provider: LLMProvider,
        config: ProviderConfig
    ): LLMClient {
        switch (provider) {
            case LLMProvider.OPENROUTER:
                return new OpenRouterProvider(config as OpenRouterConfig);
            
            case LLMProvider.CHUTES:
                return new ChutesProvider(config as ChutesConfig);
            
            case LLMProvider.ZAI:
                return new ZAIProvider(config as ZAIConfig);

            case LLMProvider.OLLAMA:
                return new OllamaProvider(config as OllamaConfig);
            
            default:
                throw new Error(`Unsupported provider: ${provider}`);
        }
    }

    /**
     * Create an OpenRouter client
     * @param apiKey - OpenRouter API key
     * @param baseUrl - Optional custom base URL
     * @param referer - Optional referer URL
     * @param debugMode - Enable debug logging
     * @returns OpenRouter client instance
     */
    static createOpenRouterClient(
        apiKey: string,
        baseUrl?: string,
        referer?: string,
        debugMode?: boolean,
        timeout?: number,
        maxRetries?: number
    ): OpenRouterProvider {
        const config: OpenRouterConfig = {
            apiKey,
            baseUrl,
            referer,
            timeout,
            maxRetries,
            provider: LLMProvider.OPENROUTER
        };
        return new OpenRouterProvider(config, debugMode || false);
    }

    /**
     * Create a Chutes client
     * @param apiKey - Chutes API key
     * @param baseUrl - Optional custom base URL
     * @param debugMode - Enable debug logging
     * @returns Chutes client instance
     */
    static createChutesClient(
        apiKey: string,
        baseUrl?: string,
        debugMode?: boolean,
        timeout?: number,
        maxRetries?: number
    ): ChutesProvider {
        const config: ChutesConfig = {
            apiKey,
            baseUrl,
            timeout,
            maxRetries,
            provider: LLMProvider.CHUTES
        };
        const client = new ChutesProvider(config, debugMode || false);
        if (baseUrl) {
            client.updateBaseUrl(baseUrl);
        }
        return client;
    }

    /**
     * Create a ZAI client
     * @param apiKey - ZAI API key
     * @param baseUrl - Optional custom base URL
     * @param debugMode - Enable debug logging
     * @returns ZAI client instance
     */
    static createZAIClient(
        apiKey: string,
        baseUrl?: string,
        debugMode?: boolean,
        timeout?: number,
        maxRetries?: number
    ): ZAIProvider {
        const config: ZAIConfig = {
            apiKey,
            baseUrl,
            timeout,
            maxRetries,
            provider: LLMProvider.ZAI
        };
        const client = new ZAIProvider(config, debugMode || false);
        if (baseUrl) {
            client.updateBaseUrl(baseUrl);
        }
        return client;
    }

    /**
     * Create an Ollama client
     * @param baseUrl - Ollama base URL
     * @param debugMode - Enable debug logging
     * @param timeout - Request timeout in milliseconds
     * @returns Ollama client instance
     */
    static createOllamaClient(
        baseUrl?: string,
        debugMode?: boolean,
        timeout?: number
    ): OllamaProvider {
        const config: OllamaConfig = {
            apiKey: '',
            baseUrl: baseUrl || 'http://localhost:11434',
            timeout: timeout ?? 120000,
            provider: LLMProvider.OLLAMA
        };
        return new OllamaProvider(config, debugMode || false);
    }

    /**
     * Parse provider from string
     * @param providerString - Provider string (e.g., "openrouter", "chutes", "zai")
     * @returns LLMProvider enum value
     */
    static parseProvider(providerString: string): LLMProvider {
        const normalized = providerString.toLowerCase().trim();
        
        switch (normalized) {
            case 'openrouter':
                return LLMProvider.OPENROUTER;
            case 'chutes':
                return LLMProvider.CHUTES;
            case 'zai':
                return LLMProvider.ZAI;
            case 'ollama':
                return LLMProvider.OLLAMA;
            default:
                throw new Error(`Unknown provider: ${providerString}`);
        }
    }

    /**
     * Get provider name from enum
     * @param provider - LLMProvider enum value
     * @returns Provider name as string
     */
    static getProviderName(provider: LLMProvider): string {
        switch (provider) {
            case LLMProvider.OPENROUTER:
                return 'OpenRouter';
            case LLMProvider.CHUTES:
                return 'Chutes';
            case LLMProvider.ZAI:
                return 'ZAI';
            case LLMProvider.OLLAMA:
                return 'Ollama';
        }
    }
}

/**
 * Convenience function to create a client from settings
 * (Moved outside of class to allow standalone export)
 * @param provider - Provider type
 * @param settings - Plugin settings containing API keys and base URLs
 * @returns Provider-specific client instance
 */
export function createLLMClientFromSettings(
    provider: LLMProvider,
    settings: {
        openRouterApiKey?: string;
        chutesApiKey?: string;
        zaiApiKey?: string;
        openRouterBaseUrl?: string;
        chutesBaseUrl?: string;
        zaiBaseUrl?: string;
        ollamaBaseUrl?: string;
        ollamaTimeout?: number;
        providerTimeout?: number;
        providerRetryCount?: number;
        debugMode?: boolean;
    }
): LLMClient {
    switch (provider) {
        case LLMProvider.OPENROUTER:
            if (!settings.openRouterApiKey) {
                throw new Error('OpenRouter API key is required');
            }
            return LLMClientFactory.createOpenRouterClient(
                settings.openRouterApiKey,
                settings.openRouterBaseUrl,
                "https://obsidian.md",
                settings.debugMode,
                settings.providerTimeout,
                settings.providerRetryCount
            );
        
        case LLMProvider.CHUTES:
            if (!settings.chutesApiKey) {
                throw new Error('Chutes API key is required');
            }
            return LLMClientFactory.createChutesClient(
                settings.chutesApiKey,
                settings.chutesBaseUrl,
                settings.debugMode,
                settings.providerTimeout,
                settings.providerRetryCount
            );
        
        case LLMProvider.ZAI:
            if (!settings.zaiApiKey) {
                throw new Error('ZAI API key is required');
            }
            return LLMClientFactory.createZAIClient(
                settings.zaiApiKey,
                settings.zaiBaseUrl,
                settings.debugMode,
                settings.providerTimeout,
                settings.providerRetryCount
            );

        case LLMProvider.OLLAMA:
            return LLMClientFactory.createOllamaClient(
                settings.ollamaBaseUrl,
                settings.debugMode,
                settings.ollamaTimeout
            );
        
        default:
            throw new Error(`Unsupported provider: ${provider}`);
    }
}
