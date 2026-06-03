import {
    App,
    Modal,
    Setting,
    Notice
} from "obsidian";
import type GptFreeTextGeneratorPlugin from '../main';
import { LLMProvider } from '../types/providers';
import { LLMClientFactory, createLLMClientFromSettings } from '../utils/LLMClientFactory';

interface TestResult {
    success: boolean;
    message: string;
    response?: string;
    timing?: number;
    error?: string;
}

class TestProviderConnectionModal extends Modal {
    private plugin: GptFreeTextGeneratorPlugin;
    private selectedProvider: LLMProvider = LLMProvider.OLLAMA;
    private testPrompt: string = "Hello! Please respond with a simple greeting.";
    private testResult: TestResult | null = null;
    private isTesting: boolean = false;

    constructor(app: App, plugin: GptFreeTextGeneratorPlugin) {
        super(app);
        this.plugin = plugin;
    }

    async onOpen() {
        const { contentEl } = this;
        contentEl.empty();

        // Add header
        contentEl.createEl("h2", { text: "Test Provider Connection" });
        contentEl.createEl("p", { 
            text: "Test connectivity to LLM providers and verify they can generate text.",
            cls: "setting-item-description"
        });

        // Provider selection
        new Setting(contentEl)
            .setName("Provider")
            .setDesc("Select the provider to test")
            .addDropdown(dropdown => {
                dropdown.addOptions({
                    'openrouter': 'OpenRouter',
                    'chutes': 'Chutes',
                    'zai': 'ZAI',
                    'ollama': 'Ollama'
                });
                dropdown
                    .setValue(this.selectedProvider.toLowerCase())
                    .onChange(async (value) => {
                        this.selectedProvider = LLMClientFactory.parseProvider(value);
                        this.testResult = null;
                        this.updateTestResultDisplay();
                    });
            });

        // Test prompt
        new Setting(contentEl)
            .setName("Test Prompt")
            .setDesc("Enter a simple prompt to test text generation")
            .addTextArea(text => text
                .setPlaceholder("Enter a simple test prompt...")
                .setValue(this.testPrompt)
                .onChange(async (value) => {
                    this.testPrompt = value;
                }));

        // Test button
        const testButtonContainer = contentEl.createEl("div", { cls: "test-button-container" });
        const testButton = testButtonContainer.createEl("button", {
            text: "Test Connection",
            cls: "mod-cta"
        });
        testButton.addEventListener("click", () => {
            this.runTest(testButton);
        });

        // Test result display
        const resultContainer = contentEl.createEl("div", { cls: "test-result-container" });
        resultContainer.createEl("h3", { text: "Test Results" });
        const resultContent = resultContainer.createEl("div", { cls: "test-result-content" });
        this.updateTestResultDisplay(resultContent);

        // Add styles
        this.addStyles();
    }

    private async runTest(button: HTMLButtonElement) {
        if (this.isTesting) return;

        this.isTesting = true;
        this.testResult = null;
        button.disabled = true;
        button.textContent = "Testing...";

        const resultContent = this.contentEl.querySelector(".test-result-content");
        if (resultContent) {
            resultContent.innerHTML = '<p class="testing-status">Running test...</p>';
        }

        try {
            // Check if API key is configured
            const apiKey = this.getApiKeyForProvider(this.selectedProvider);
            if (this.selectedProvider !== LLMProvider.OLLAMA && !apiKey) {
                this.testResult = {
                    success: false,
                    message: "API key not configured",
                    error: `Please configure the ${LLMClientFactory.getProviderName(this.selectedProvider)} API key in settings.`
                };
                this.updateTestResultDisplay();
                return;
            }

            // Get model for the provider
            const model = this.getModelForProvider(this.selectedProvider);

            // Create client
            const client = createLLMClientFromSettings(this.selectedProvider, {
                openRouterApiKey: this.plugin.settings.openRouterApiKey,
                chutesApiKey: this.plugin.settings.chutesApiKey,
                zaiApiKey: this.plugin.settings.zaiApiKey,
                ollamaBaseUrl: this.plugin.settings.ollamaBaseUrl,
                ollamaTimeout: this.plugin.settings.ollamaTimeout,
                debugMode: true
            });

            // Run test
            const startTime = Date.now();
            const response = await client.generateText({
                message: this.testPrompt,
                model: model,
                language: 'english',
                files: [],
                temperature: 0.7,
                maxTokens: 100
            });
            const elapsed = Date.now() - startTime;

            this.testResult = {
                success: true,
                message: "Connection successful",
                response: response.output,
                timing: elapsed
            };

            new Notice(`✓ ${LLMClientFactory.getProviderName(this.selectedProvider)}: Connected (${elapsed}ms)`);

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            this.testResult = {
                success: false,
                message: "Connection failed",
                error: errorMessage
            };

            new Notice(`✗ ${LLMClientFactory.getProviderName(this.selectedProvider)}: ${errorMessage}`);
        } finally {
            this.isTesting = false;
            button.disabled = false;
            button.textContent = "Test Connection";
            this.updateTestResultDisplay();
        }
    }

    private getApiKeyForProvider(provider: LLMProvider): string | undefined {
        switch (provider) {
            case LLMProvider.OPENROUTER:
                return this.plugin.settings.openRouterApiKey;
            case LLMProvider.CHUTES:
                return this.plugin.settings.chutesApiKey;
            case LLMProvider.ZAI:
                return this.plugin.settings.zaiApiKey;
            case LLMProvider.OLLAMA:
                return '';
            default:
                return undefined;
        }
    }

    private getModelForProvider(provider: LLMProvider): string {
        switch (provider) {
            case LLMProvider.OPENROUTER:
                return this.plugin.settings.openrouterTextModel || this.plugin.settings.defaultTextModel;
            case LLMProvider.CHUTES:
                return this.plugin.settings.chutesTextModel || 'deepseek-ai/DeepSeek-V3.2-Speciale-TEE';
            case LLMProvider.ZAI:
                return this.plugin.settings.zaiTextModel || 'glm-4.6';
            case LLMProvider.OLLAMA:
                return this.plugin.settings.ollamaTextModel || 'gemma4:31b-cloud';
            default:
                return this.plugin.settings.defaultTextModel;
        }
    }

    private updateTestResultDisplay(container?: HTMLElement) {
        const resultContent = container || this.contentEl.querySelector(".test-result-content");
        if (!resultContent) return;

        resultContent.empty();

        if (!this.testResult) {
            resultContent.innerHTML = '<p class="no-result">No test run yet</p>';
            return;
        }

        if (this.testResult.success) {
            resultContent.innerHTML = `
                <div class="test-result success">
                    <div class="result-status">✓ Success</div>
                    <div class="result-message">${this.testResult.message}</div>
                    ${this.testResult.timing ? `<div class="result-timing">Response time: ${this.testResult.timing}ms</div>` : ''}
                    <div class="result-response">
                        <div class="response-label">Response:</div>
                        <div class="response-text">${this.escapeHtml(this.testResult.response || 'No response text')}</div>
                    </div>
                </div>
            `;
        } else {
            resultContent.innerHTML = `
                <div class="test-result error">
                    <div class="result-status">✗ Failed</div>
                    <div class="result-message">${this.testResult.message}</div>
                    ${this.testResult.error ? `<div class="result-error">Error: ${this.escapeHtml(this.testResult.error)}</div>` : ''}
                </div>
            `;
        }
    }

    private escapeHtml(text: string): string {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    private addStyles() {
        const styles = `
            .test-button-container {
                margin: 20px 0;
                text-align: center;
            }
            .test-button-container button {
                padding: 8px 16px;
                cursor: pointer;
            }
            .test-result-container {
                margin-top: 20px;
                padding: 15px;
                border: 1px solid var(--background-modifier-border);
                border-radius: 6px;
            }
            .test-result-container h3 {
                margin-top: 0;
                margin-bottom: 15px;
                font-size: 1.1em;
            }
            .test-result-content {
                min-height: 100px;
            }
            .test-result {
                padding: 15px;
                border-radius: 6px;
                border-left: 4px solid;
            }
            .test-result.success {
                background-color: var(--background-success);
                border-left-color: var(--color-success);
            }
            .test-result.error {
                background-color: var(--background-error);
                border-left-color: var(--color-error);
            }
            .result-status {
                font-weight: bold;
                font-size: 1.1em;
                margin-bottom: 8px;
            }
            .result-message {
                margin-bottom: 8px;
            }
            .result-timing {
                color: var(--text-muted);
                font-size: 0.9em;
                margin-bottom: 12px;
            }
            .result-error {
                color: var(--color-error);
                margin-top: 8px;
                padding: 8px;
                background-color: var(--background-error);
                border-radius: 4px;
                font-size: 0.9em;
            }
            .result-response {
                margin-top: 12px;
            }
            .response-label {
                font-weight: bold;
                margin-bottom: 6px;
            }
            .response-text {
                padding: 10px;
                background-color: var(--background-secondary);
                border-radius: 4px;
                white-space: pre-wrap;
                word-wrap: break-word;
                max-height: 200px;
                overflow-y: auto;
                font-family: var(--font-monospace);
                font-size: 0.9em;
            }
            .no-result {
                color: var(--text-muted);
                font-style: italic;
            }
            .testing-status {
                color: var(--text-accent);
                font-style: italic;
            }
        `;

        const styleEl = document.createElement('style');
        styleEl.textContent = styles;
        document.head.appendChild(styleEl);
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

export { TestProviderConnectionModal };
