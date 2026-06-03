/**
 * OpenRouter API Types
 * Type definitions for OpenRouter API requests and responses
 */

/**
 * File context for text generation
 * Represents a file from the Obsidian vault to be included in generation
 */
export interface FileContext {
    path: string;
    name: string;
    content?: string;
}

/**
 * Text generation options
 */
export interface TextGenerationOptions {
    /** OpenRouter model identifier (e.g., "openrouter/deepseek/deepseek-r1:free") */
    model: string;
    /** Main message/prompt for generation */
    message: string;
    /** Optional files to include as context */
    files?: FileContext[];
    /** Temperature for generation (0.0 - 1.0), default 0.7 */
    temperature?: number;
    /** Maximum tokens to generate, default 2000 */
    maxTokens?: number;
    /** Language for the response (e.g., "english", "russian") */
    language?: string;
}

/**
 * Vision analysis options
 */
export interface VisionAnalysisOptions {
    /** Vision-enabled model identifier (e.g., "qwen/qwen2.5-vl-32b-instruct:free") */
    model: string;
    /** Image URL or base64 encoded image */
    imageUrl: string;
    /** Prompt for image analysis */
    prompt: string;
    /** Temperature for generation (0.0 - 1.0), default 0.7 */
    temperature?: number;
    /** Maximum tokens to generate, default 2000 */
    maxTokens?: number;
}

/**
 * Image generation options
 * Note: OpenRouter may not support image generation directly
 */
export interface ImageGenerationOptions {
    /** Model identifier for image generation */
    model: string;
    /** Prompt for image generation */
    prompt: string;
}

/**
 * Generation response metadata
 */
export interface GenerationMetadata {
    /** Name of the provider that handled the request */
    provider_name: string;
    /** Actual model used (may differ from requested) */
    actual_model: string;
    /** ISO timestamp when request was sent */
    request_time: string;
    /** ISO timestamp when response was received */
    completion_time: string;
    /** Elapsed time in seconds */
    elapsed_time: string;
}

/**
 * Text generation response
 */
export interface GenerationResponse {
    /** Generated text content */
    output: string;
    /** Metadata about the generation */
    metadata: GenerationMetadata;
}

/**
 * Vision analysis response
 */
export interface AnalysisResponse {
    /** Analysis text content */
    analysis: string;
    /** Metadata about the analysis */
    metadata: GenerationMetadata;
}

/**
 * Image generation response
 */
export interface ImageResponse {
    /** URL to the generated image */
    imageUrl: string;
    /** Metadata about the generation */
    metadata: {
        provider_name: string;
        actual_model: string;
        elapsed_time: string;
    };
}

/**
 * OpenRouter API error details
 */
export interface OpenRouterErrorDetails {
    /** Error message from API */
    message?: string;
    /** Error type */
    type?: string;
    /** Additional error details */
    details?: any;
}

/**
 * Custom error class for OpenRouter API errors
 */
export class OpenRouterError extends Error {
    /**
     * HTTP status code (if available)
     */
    statusCode?: number;
    
    /**
     * Additional error details from API
     */
    details?: OpenRouterErrorDetails;
    
    constructor(
        message: string,
        statusCode?: number,
        details?: OpenRouterErrorDetails
    ) {
        super(message);
        this.name = 'OpenRouterError';
        this.statusCode = statusCode;
        this.details = details;
    }
}

/**
 * OpenRouter API configuration
 */
export interface OpenRouterConfig {
    /** API key for authentication */
    apiKey: string;
    /** Base URL for OpenRouter API */
    baseUrl?: string;
    /** Referer URL for API requests */
    referer?: string;
    /** Request timeout in milliseconds */
    timeout?: number;
    /** Maximum retry attempts */
    maxRetries?: number;
}

/**
 * OpenRouter API request payload
 */
export interface OpenRouterRequestPayload {
    /** Model identifier */
    model: string;
    /** Array of messages */
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
    /** Temperature (0.0 - 1.0) */
    temperature?: number;
    /** Maximum tokens to generate */
    max_tokens?: number;
}

/**
 * OpenRouter API response
 */
export interface OpenRouterApiResponse {
    /** Response ID */
    id: string;
    /** Object type (always "chat.completion") */
    object: string;
    /** Unix timestamp of creation */
    created: number;
    /** Model used */
    model: string;
    /** Provider information */
    provider?: {
        name: string;
        url?: string;
    };
    /** Array of choices */
    choices: Array<{
        index: number;
        message: {
            role: string;
            content: string;
        };
        finish_reason: string;
    }>;
    /** Usage statistics */
    usage?: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
}