/**
 * LLM Client Service
 * Centralized service for managing LLM client instances and provider switching
 */

import { App } from 'obsidian';
import { LLMClientFactory, createLLMClientFromSettings, LLMClient } from './LLMClientFactory';
import { LLMProvider } from '../types/providers';
import { PluginSettings } from '../types';

export class LLMClientService {
  private app: App;
  private settings: PluginSettings;
  private currentClient: LLMClient | null = null;

  constructor(app: App, settings: PluginSettings) {
    this.app = app;
    this.settings = settings;
  }

  /**
   * Initialize the LLM client based on current settings
   */
  initialize(): void {
    try {
      const provider = LLMClientFactory.parseProvider(this.settings.defaultLLMProvider);
      this.currentClient = createLLMClientFromSettings(provider, {
        openRouterApiKey: this.settings.openRouterApiKey,
        chutesApiKey: this.settings.chutesApiKey,
        zaiApiKey: this.settings.zaiApiKey,
        openRouterBaseUrl: this.settings.openRouterBaseUrl,
        chutesBaseUrl: this.settings.chutesBaseUrl,
        zaiBaseUrl: this.settings.zaiBaseUrl,
        ollamaBaseUrl: this.settings.ollamaBaseUrl,
        ollamaTimeout: this.settings.ollamaTimeout,
        debugMode: this.settings.debugMode
      });
      
      // Log initialization if debug mode is enabled
      if (this.settings.debugMode) {
        console.log('[LLMClientService] Initialized with provider:', provider);
        console.log('[LLMClientService] Debug mode:', this.settings.debugMode);
        console.log('[LLMClientService] Timeout:', this.settings.providerTimeout);
        console.log('[LLMClientService] Retries:', this.settings.providerRetryCount);
      }
    } catch (error) {
      console.error('Failed to initialize LLM client:', error);
      this.currentClient = null;
    }
  }

  /**
   * Get the current LLM client
   */
  getClient(): LLMClient | null {
    return this.currentClient;
  }

  /**
   * Get a client for a specific provider (ad-hoc provider selection)
   * This allows getting a specific client without changing global defaults
   */
  getClientForProvider(providerId: 'openrouter' | 'chutes' | 'zai' | 'ollama'): LLMClient | null {
    try {
      const provider = LLMClientFactory.parseProvider(providerId);
      return createLLMClientFromSettings(provider, {
        openRouterApiKey: this.settings.openRouterApiKey,
        chutesApiKey: this.settings.chutesApiKey,
        zaiApiKey: this.settings.zaiApiKey,
        openRouterBaseUrl: this.settings.openRouterBaseUrl,
        chutesBaseUrl: this.settings.chutesBaseUrl,
        zaiBaseUrl: this.settings.zaiBaseUrl,
        ollamaBaseUrl: this.settings.ollamaBaseUrl,
        ollamaTimeout: this.settings.ollamaTimeout,
        debugMode: this.settings.debugMode
      });
    } catch (error) {
      console.error(`Failed to get client for provider ${providerId}:`, error);
      return null;
    }
  }

  /**
   * Update settings and reinitialize client
   */
  updateSettings(settings: PluginSettings): void {
    this.settings = settings;
    this.initialize();
  }

  /**
   * Switch to a different provider
   */
  switchProvider(provider: LLMProvider): void {
    this.settings.defaultLLMProvider = provider;
    this.initialize();
  }

  /**
   * Check if client is ready
   */
  isReady(): boolean {
    return this.currentClient !== null;
  }

  /**
   * Get the current provider name
   */
  getCurrentProvider(): string {
    return this.settings.defaultLLMProvider;
  }

  /**
   * Reinitialize the client (useful after API key changes)
   */
  reinitialize(): void {
    this.initialize();
  }
}
