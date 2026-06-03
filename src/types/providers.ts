/**
 * LLM Provider Types
 * Type definitions for multiple LLM provider support
 */

/**
 * Supported LLM providers
 */
export enum LLMProvider {
    OPENROUTER = 'openrouter',
    CHUTES = 'chutes',
    ZAI = 'zai',
    OLLAMA = 'ollama'
}

/**
 * Base provider configuration
 */
export interface ProviderConfig {
    /** Provider type */
    provider: LLMProvider;
    /** API key for authentication */
    apiKey: string;
    /** Base URL for API requests */
    baseUrl?: string;
    /** Referer URL for API requests */
    referer?: string;
    /** Request timeout in milliseconds */
    timeout?: number;
    /** Maximum retry attempts */
    maxRetries?: number;
}

/**
 * OpenRouter-specific configuration
 */
export interface OpenRouterConfig extends ProviderConfig {
    provider: LLMProvider.OPENROUTER;
    /** OpenRouter-specific settings */
}

/**
 * Chutes-specific configuration
 */
export interface ChutesConfig extends ProviderConfig {
    provider: LLMProvider.CHUTES;
    /** Chutes-specific settings */
}

/**
 * ZAI-specific configuration
 */
export interface ZAIConfig extends ProviderConfig {
    provider: LLMProvider.ZAI;
    /** ZAI-specific settings */
}

/**
 * Ollama-specific configuration
 */
export interface OllamaConfig extends ProviderConfig {
    provider: LLMProvider.OLLAMA;
    /** Ollama base URL, for example http://localhost:11434 */
    baseUrl: string;
}

/**
 * Provider-specific request payload
 */
export interface ProviderRequestPayload {
    model: string;
    messages: Array<{
        role: 'user' | 'assistant' | 'system';
        content: string | Array<{
            type: 'text' | 'image_url';
            text?: string;
            image_url?: {
                url: string;
            };
        }>;
    }>;
    temperature?: number;
    max_tokens?: number;
    [key: string]: any; // Allow provider-specific fields
}

/**
 * Provider-specific API response
 */
export interface ProviderApiResponse {
    id: string;
    object: string;
    created: number;
    model: string;
    choices: Array<{
        index: number;
        message: {
            role: string;
            content: string;
        };
        finish_reason: string;
    }>;
    usage?: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
    [key: string]: any; // Allow provider-specific fields
}

/**
 * Provider metadata in response
 */
export interface ProviderMetadata {
    /** Name of the provider */
    provider_name: string;
    /** Actual model used */
    actual_model: string;
    /** Provider-specific metadata */
    [key: string]: any;
}
