# LLMAutomationForObsidianPlugin — Detailed Changelog with Diffs

Branch: main
Period: 2026-06-23 (Steps 01–11)
Total: 10 commits, 30 files changed, ~1,200 net lines added

---

======================================================================
### Step 01 — Remove dead code
**Commit:** `08a6495`

**Summary:** Deleted two unreachable files that hardcoded `127.0.0.1:8001`. No behavioral change — all imports were already absent.

```diff
diff --git a/.gitignore b/.gitignore
--- a/.gitignore
+++ b/.gitignore
@@ -3,6 +3,7 @@
 dist/
 build/
 android-build/
+plans/

 src/utils/api.ts | 20 DELETED (dead code: hardcoded 127.0.0.1:8001 image generation)
 src/utils/OpenRouterClient.ts | 397 DELETED (dead code: hardcoded 127.0.0.1:8001 text/image generation)
```

======================================================================
### Step 02 — Expose Chutes/ZAI base URL in Settings
**Commit:** `1762bda`

**Summary:** Added text fields in Settings for Chutes/ZAI base URLs. TestProviderConnectionModal now forwards them to the client factory.

```diff
diff --git a/src/modals/TestProviderConnectionModal.ts b/src/modals/TestProviderConnectionModal.ts
index fad5b25..34e2e98 100644
--- a/src/modals/TestProviderConnectionModal.ts
+++ b/src/modals/TestProviderConnectionModal.ts
@@ -122,10 +122,12 @@ class TestProviderConnectionModal extends Modal {
 
             // Create client
             const client = createLLMClientFromSettings(this.selectedProvider, {
-                openRouterApiKey: this.p...Key,
-                chutesApiKey: this.p...Key,
-                zaiApiKey: this.p...Key,
-                proxyApiKey: this.p...Key,
+                openRouterApiKey: ***
+                chutesApiKey: ***
+                zaiApiKey: ***
+                proxyApiKey: ***
+                chutesBaseUrl: this.plugin.settings.chutesBaseUrl,
+                zaiBaseUrl: this.plugin.settings.zaiBaseUrl,
                 ollamaBaseUrl: this.plugin.settings.ollamaBaseUrl,
                 proxyBaseUrl: this.plugin.settings.proxyBaseUrl,
                 ollamaTimeout: this.plugin.settings.ollamaTimeout,
diff --git a/src/settings/SettingTab.ts b/src/settings/SettingTab.ts
index af4b602..cc85bfd 100644
--- a/src/settings/SettingTab.ts
+++ b/src/settings/SettingTab.ts
@@ -945,6 +945,17 @@ class SettingTab extends PluginSettingTab {
           await this.plugin.saveSettings();
         }));
 
+    // Chutes Base URL
+    new Setting(containerEl)
+      .setName("Chutes Base URL")
+      .setDesc("Chutes-compatible chat completions endpoint. Leave blank to use the default Chutes.ai cloud endpoint (https://llm.chutes.ai/v1/chat/completions). Point this at your own reverse proxy / remote machine if you route Chutes traffic through one.")
+      .addText(text => text
+        .setValue(this.plugin.settings.chutesBaseUrl || '')
+        .onChange(async value => {
+          this.plugin.settings.chutesBaseUrl = value.trim() || undefined;
+          await this.plugin.saveSettings();
+        }));
+
     // ZAI API Key
     new Setting(containerEl)
       .setName("ZAI API Key")
@@ -956,6 +967,17 @@ class SettingTab extends PluginSettingTab {
           await this.plugin.saveSettings();
         }));
 
+    // ZAI Base URL
+    new Setting(containerEl)
+      .setName("ZAI Base URL")
+      .setDesc("ZAI-compatible chat completions endpoint. Leave blank to use the default Z.ai cloud endpoint (https://api.z.ai/api/paas/v4/chat/completions). Point this at your own reverse proxy / remote machine if you route ZAI traffic through one.")
+      .addText(text => text
+        .setValue(this.plugin.settings.zaiBaseUrl || '')
+        .onChange(async value => {
+          this.plugin.settings.zaiBaseUrl = value.trim() || undefined;
+          await this.plugin.saveSettings();
+        }));
+
     // Provider Timeout
     new Setting(containerEl)
       .setName("Ollama Base URL")
```

======================================================================
### Step 03 — Centralize TextProviderId type
**Commit:** `7003fdc`

**Summary:** Single source of truth for provider type + labels across 12 files. All dropdowns now share the same 5 options.

```diff
diff --git a/src/modals/ArticleRequestModal.ts b/src/modals/ArticleRequestModal.ts
index 2f547ac..0ceb336 100644
--- a/src/modals/ArticleRequestModal.ts
+++ b/src/modals/ArticleRequestModal.ts
@@ -1,10 +1,9 @@
 // ArticleRequestModal.ts
 import { App, Modal, Setting, Notice, ButtonComponent, DropdownComponent } from "obsidian";
 import type GptFreeTextGeneratorPlugin from '../main';
+import { TextProviderId } from '../types/providers';
 import { SettingTab } from '../settings/SettingTab'; // Import SettingTab to access getFilteredModelsForBackend
 
-type TextProviderId = 'openrouter' | 'chutes' | 'zai' | 'ollama' | 'proxy';
-
 export class ArticleRequestModal extends Modal {
   private plugin: GptFreeTextGeneratorPlugin;
   private articleUrl: string = "";
diff --git a/src/modals/PlaylistSummaryModal.ts b/src/modals/PlaylistSummaryModal.ts
index 2ddd625..7410e6d 100644
--- a/src/modals/PlaylistSummaryModal.ts
+++ b/src/modals/PlaylistSummaryModal.ts
@@ -2,10 +2,9 @@
 import { App, Modal, Setting, Notice, ButtonComponent, DropdownComponent } from "obsidian";
 import type GptFreeTextGeneratorPlugin from '../main';
 import { SummaryType, SUMMARY_PROMPTS, getAvailableSummaryTypes } from '../utils/summaryPrompts';
+import { TextProviderId } from '../types/providers';
 import { SettingTab } from '../settings/SettingTab'; // Import SettingTab to access getFilteredModelsForBackend
 
-type TextProviderId = 'openrouter' | 'chutes' | 'zai' | 'ollama' | 'proxy';
-
 export class PlaylistSummaryModal extends Modal {
   private plugin: GptFreeTextGeneratorPlugin;
   private playlistUrl: string = "";
diff --git a/src/modals/TextGeneratorModal.ts b/src/modals/TextGeneratorModal.ts
index c4d4844..f320bc3 100644
--- a/src/modals/TextGeneratorModal.ts
+++ b/src/modals/TextGeneratorModal.ts
@@ -6,10 +6,9 @@ import {
   } from "obsidian";
 
   import type GptFreeTextGeneratorPlugin from '../main';
+  import { TextProviderId } from '../types/providers';
   import { SettingTab } from '../settings/SettingTab'; // Import SettingTab to access getFilteredModelsForBackend
 
-  type TextProviderId = 'openrouter' | 'chutes' | 'zai' | 'ollama' | 'proxy';
-
   class TextGeneratorModal extends Modal {
     plugin: GptFreeTextGeneratorPlugin;
     onSave: (options: any) => void;
diff --git a/src/modals/TranscriptRequestModal.ts b/src/modals/TranscriptRequestModal.ts
index aa002df..5ae0586 100644
--- a/src/modals/TranscriptRequestModal.ts
+++ b/src/modals/TranscriptRequestModal.ts
@@ -2,8 +2,7 @@ import { App, Modal, Setting } from "obsidian";
 import type GptFreeTextGeneratorPlugin from '../main';
 import { TranscriptManager } from "../utils/TranscriptManager";
 import { ErrorHandler } from "../utils/ErrorHandler";
-
-type TextProviderId = 'openrouter' | 'chutes' | 'zai' | 'ollama' | 'proxy';
+import { TextProviderId } from '../types/providers';
 
 export class TranscriptRequestModal extends Modal {
   private plugin: GptFreeTextGeneratorPlugin;
diff --git a/src/modals/VideoSummaryModal.ts b/src/modals/VideoSummaryModal.ts
index 4384242..52dff27 100644
--- a/src/modals/VideoSummaryModal.ts
+++ b/src/modals/VideoSummaryModal.ts
@@ -9,9 +9,8 @@ import {
   
   import type GptFreeTextGeneratorPlugin from '../main';
   import { SummaryType, SUMMARY_PROMPTS, getAvailableSummaryTypes } from '../utils/summaryPrompts';
-  import { SettingTab } from '../settings/SettingTab'; // Import SettingTab to access getFilteredOpenRouterModels
-
-  type TextProviderId = 'openrouter' | 'chutes' | 'zai' | 'ollama' | 'proxy';
+  import { TextProviderId } from '../types/providers';
+  import { SettingTab } from '../settings/SettingTab'; // Import SettingTab to access getFilteredModelsForBackend
   
   export class VideoSummaryModal extends Modal {
     private plugin: GptFreeTextGeneratorPlugin;
diff --git a/src/settings/SettingTab.ts b/src/settings/SettingTab.ts
index cc85bfd..ef00204 100644
--- a/src/settings/SettingTab.ts
+++ b/src/settings/SettingTab.ts
@@ -12,11 +12,9 @@ import {
   import { StudySourceType } from '../types/studySources';
   import { TestProviderConnectionModal } from '../modals/TestProviderConnectionModal';
   import { LLMClientFactory } from '../utils/LLMClientFactory';
-  import { LLMProvider } from '../types/providers';
+  import { LLMProvider, TextProviderId, TEXT_PROVIDER_LABELS } from '../types/providers';
 
-type TextProviderId = 'openrouter' | 'chutes' | 'zai' | 'ollama' | 'proxy';
-
-class SettingTab extends PluginSettingTab {
+  class SettingTab extends PluginSettingTab {
   plugin: GptFreeTextGeneratorPlugin;
 
   constructor(app: App, plugin: GptFreeTextGeneratorPlugin) {
diff --git a/src/types/providers.ts b/src/types/providers.ts
index 3f6a78d..43cbb1f 100644
--- a/src/types/providers.ts
+++ b/src/types/providers.ts
@@ -14,6 +14,22 @@ export enum LLMProvider {
     PROXY = 'proxy'
 }
 
+/**
+ * String-literal form of LLMProvider, used by UI code (dropdowns, modal state)
+ * that works with plain strings rather than the enum. Keep this in sync with
+ * the LLMProvider enum above — if you add a provider, update both.
+ */
+export type TextProviderId = 'openrouter' | 'chutes' | 'zai' | 'ollama' | 'proxy';
+
+/** Canonical display names, for any UI that needs a label for a TextProviderId. */
+export const TEXT_PROVIDER_LABELS: Record<TextProviderId, string> = {
+    openrouter: 'OpenRouter',
+    chutes: 'Chutes',
+    zai: 'ZAI',
+    ollama: 'Ollama',
+    proxy: 'OpenAI Proxy',
+};
+
 /**
  * Base provider configuration
  */
diff --git a/src/utils/ArticleManager.ts b/src/utils/ArticleManager.ts
index c2f2d5d..ed5b436 100644
--- a/src/utils/ArticleManager.ts
+++ b/src/utils/ArticleManager.ts
@@ -5,8 +5,7 @@ import { sanitizeFilename, sanitizeForMetadata } from "../utils/helpers"; // Imp
 import { TagManager } from "./TagManager"; // Import TagManager
 import { LLMClientService } from "./LLMClientService";
 import { TextGenerationOptions, OpenRouterError } from "../types/openrouter";
-
-type TextProviderId = 'openrouter' | 'chutes' | 'zai' | 'ollama' | 'proxy';
+import { TextProviderId } from '../types/providers';
 
 interface ArticleData {
   title: string;
diff --git a/src/utils/TranscriptManager.ts b/src/utils/TranscriptManager.ts
index 31a776c..520072f 100644
--- a/src/utils/TranscriptManager.ts
+++ b/src/utils/TranscriptManager.ts
@@ -11,8 +11,7 @@ import { ContentMetadata } from "./pathStructure/types";
 import { DatabaseManager } from "../database/DatabaseManager";
 import { LLMClientService } from "./LLMClientService";
 import { TextGenerationOptions, OpenRouterError } from "../types/openrouter";
-
-type TextProviderId = 'openrouter' | 'chutes' | 'zai' | 'ollama' | 'proxy';
+import { TextProviderId } from '../types/providers';
 
 interface VideoData {
   title: string;
diff --git a/src/utils/VideoQueueManager.ts b/src/utils/VideoQueueManager.ts
index c2a31c3..91960af 100644
--- a/src/utils/VideoQueueManager.ts
+++ b/src/utils/VideoQueueManager.ts
@@ -6,8 +6,7 @@ import { Events } from "obsidian"; // Use Obsidian's Events
 import type GptFreeTextGeneratorPlugin from '../main';
 import { PathManager } from "./pathStructure/PathManager"; // Import PathManager
 import { HierarchyManager } from "./HierarchyManager"; // Import HierarchyManager
-
-type TextProviderId = 'openrouter' | 'chutes' | 'zai' | 'ollama' | 'proxy';
+import { TextProviderId } from '../types/providers';
 
 export interface VideoProcessingOptions {
   summaryModel: string;
diff --git a/src/views/FlashcardGenerationView.ts b/src/views/FlashcardGenerationView.ts
index 3fbd1f5..c2694ec 100644
--- a/src/views/FlashcardGenerationView.ts
+++ b/src/views/FlashcardGenerationView.ts
@@ -3,8 +3,7 @@ import type GptFreeTextGeneratorPlugin from '../main';
 import { VIEW_TYPE_FLASHCARD_GENERATION } from '../constants';
 import { GeneratedSpacedRepetitionQuestion } from '../utils/spacedRepetition/SpacedRepetitionGenerator';
 import { QuestionType, SpacedRepetitionStudySetRecord } from '../types/spacedRepetition';
-
-type TextProviderId = 'openrouter' | 'chutes' | 'zai' | 'ollama' | 'proxy';
+import { TextProviderId } from '../types/providers';
 
 export class FlashcardGenerationView extends ItemView {
   private plugin: GptFreeTextGeneratorPlugin;
diff --git a/src/views/GenerateTextView.ts b/src/views/GenerateTextView.ts
index 43123ae..55b4791 100644
--- a/src/views/GenerateTextView.ts
+++ b/src/views/GenerateTextView.ts
@@ -20,6 +20,7 @@ import {
   import { HistoryManager } from "../utils/HistoryManager";
   import { ErrorHandler } from "../utils/ErrorHandler";
   import { TextGenerationOptions, OpenRouterError } from '../types/openrouter';
+  import { TextProviderId } from '../types/providers';
 
   interface SelectedFile {
     path: string;
@@ -33,8 +34,6 @@ import {
     content?: string;
   }
 
-  type TextProviderId = 'openrouter' | 'chutes' | 'zai' | 'ollama' | 'proxy';
-
 class GenerateTextView extends ItemView {
   plugin: GptFreeTextGeneratorPlugin;
   inputMessage: string = "";
```

======================================================================
### Step 04 — Route image generation through provider abstraction
**Commit:** `8b8b638`

**Summary:** Replaced hardcoded fetch() with llmClientService.getClient(). Added capability check for non-OpenRouter providers.

```diff
diff --git a/src/views/GenerateImageView.ts b/src/views/GenerateImageView.ts
index 411da8b..73967de 100644
--- a/src/views/GenerateImageView.ts
+++ b/src/views/GenerateImageView.ts
@@ -115,42 +115,43 @@ import {
         new Notice("Please enter an image prompt");
         return;
       }
-  
+
+      const llmClientService = this.plugin.services.llmClientService;
+      const client = llmClientService?.getClient();
+
+      if (!client || typeof (client as any).generateImage !== 'function') {
+        new Notice(
+          `Image generation is not supported by the current provider. ` +
+          `Only OpenRouter supports image generation at this time. Switch the default provider to OpenRouter in Settings, or use the Image Generator modal.`
+        );
+        return;
+      }
+
       try {
         new Notice("Generating images...");
-        
+
         // Generate 4 images in parallel
         const imagePromises = Array(4).fill(null).map(async () => {
-          const response = await fetch("http://127.0.0.1:8001/generate-image", {
-            method: "POST",
-            headers: { "Content-Type": "application/json" },
-            body: JSON.stringify({
-              prompt: this.promptInput,
-              model: this.selectedModel
-            }),
+          const response = await (client as any).generateImage({
+            prompt: this.promptInput,
+            model: this.selectedModel,
           });
-  
-          if (!response.ok) {
-            throw new Error(response.statusText);
-          }
-  
-          const data = await response.json();
           return {
-            url: data.image_url,
+            url: response.imageUrl ?? response.url,
             prompt: this.promptInput,
             model: this.selectedModel,
-            provider: data.provider
+            provider: llmClientService?.getCurrentProvider(),
           };
         });
-  
+
         const newImages = await Promise.all(imagePromises);
         this.generatedImages.unshift(...newImages);
-        
+
         this.updateImageGrid();
         new Notice("Images generated successfully!");
       } catch (error) {
         console.error("Failed to generate images:", error);
-        new Notice("Failed to generate images");
+        new Notice(`Failed to generate images: ${error instanceof Error ? error.message : 'Unknown error'}`);
       }
     }
```

======================================================================
### Step 05 — Make helper server URL configurable
**Commit:** `dc923f7`

**Summary:** New `helperServerUrl` setting. ArticleManager and TranscriptManager now read from it. Better error messages.

```diff
diff --git a/src/constants.ts b/src/constants.ts
index 169b12f..f272ebb 100644
--- a/src/constants.ts
+++ b/src/constants.ts
@@ -53,6 +53,7 @@ const DEFAULT_SETTINGS = {
   defaultFrequencyPenalty: 0,
   ollamaBaseUrl: "http://localhost:11434",
   proxyBaseUrl: "http://localhost:3000/v1",
+  helperServerUrl: "http://127.0.0.1:8001",
   ollamaTimeout: 120000,
   ollamaModels: [],
   proxyModels: [],
diff --git a/src/main.ts b/src/main.ts
index 21b8ffc..28c3d41 100644
--- a/src/main.ts
+++ b/src/main.ts
@@ -865,6 +865,7 @@ export default class GptFreeTextGeneratorPlugin extends Plugin {
     this.settings.codingExercisesFolder = this.settings.codingExercisesFolder ?? DEFAULT_SETTINGS.codingExercisesFolder;
     this.settings.proxyApiKey = this.settings.proxyApiKey ?? DEFAULT_SETTINGS.proxyApiKey;
     this.settings.proxyBaseUrl = this.settings.proxyBaseUrl ?? DEFAULT_SETTINGS.proxyBaseUrl;
+    this.settings.helperServerUrl = this.settings.helperServerUrl ?? DEFAULT_SETTINGS.helperServerUrl;
     this.settings.proxyModels = this.settings.proxyModels ?? DEFAULT_SETTINGS.proxyModels;
     this.settings.proxyTextModel = this.settings.proxyTextModel ?? DEFAULT_SETTINGS.proxyTextModel;
     this.settings.proxySummaryModel = this.settings.proxySummaryModel ?? DEFAULT_SETTINGS.proxySummaryModel;
diff --git a/src/settings/SettingTab.ts b/src/settings/SettingTab.ts
index ef00204..1f16ce8 100644
--- a/src/settings/SettingTab.ts
+++ b/src/settings/SettingTab.ts
@@ -1007,6 +1007,23 @@ import {
           await this.plugin.saveSettings();
         }));
 
+    // Helper Server (Article Fetch & YouTube Transcripts)
+    containerEl.createEl('h3', { text: 'Helper Server (Article Fetch & YouTube Transcripts)' });
+    containerEl.createEl('p', {
+      text: 'Article fetching and YouTube transcript retrieval are not LLM calls — they require a separate small helper server (not one of the LLM providers above). Point this at wherever that helper server is running.',
+      cls: 'setting-item-description',
+    });
+
+    new Setting(containerEl)
+      .setName("Helper Server URL")
+      .setDesc("Base URL for the article-fetch and transcript helper server. Default: http://127.0.0.1:8001")
+      .addText(text => text
+        .setValue(this.plugin.settings.helperServerUrl || 'http://127.0.0.1:8001')
+        .onChange(async value => {
+          this.plugin.settings.helperServerUrl = value.trim() || 'http://127.0.0.1:8001';
+          await this.plugin.saveSettings();
+        }));
+
     new Setting(containerEl)
       .setName("Refresh Proxy Models")
       .setDesc("Load model IDs from the proxy /v1/models endpoint.")
diff --git a/src/types/index.ts b/src/types/index.ts
index d7b25fe..1ca54eb 100644
--- a/src/types/index.ts
+++ b/src/types/index.ts
@@ -93,6 +93,8 @@ export interface PluginSettings {
     zaiBaseUrl?: string; // Custom ZAI endpoint
     ollamaBaseUrl: string; // Ollama local/server endpoint
     proxyBaseUrl: string; // OpenAI-compatible proxy endpoint
+    /** Base URL of the optional local/remote helper server used for article scraping and YouTube transcript fetching (e.g. http://127.0.0.1:8001 or http://your-remote-machine:8001). */
+    helperServerUrl: string;
     ollamaTimeout: number; // Ollama request timeout in milliseconds
     
     // Provider-specific model lists
diff --git a/src/utils/ArticleManager.ts b/src/utils/ArticleManager.ts
index ed5b436..d970fe5 100644
--- a/src/utils/ArticleManager.ts
+++ b/src/utils/ArticleManager.ts
@@ -6,6 +6,7 @@ import { TagManager } from "./TagManager"; // Import TagManager
 import { LLMClientService } from "./LLMClientService";
 import { TextGenerationOptions, OpenRouterError } from "../types/openrouter";
 import { TextProviderId } from '../types/providers';
+import type { PluginSettings } from '../types';
 
 interface ArticleData {
   title: string;
@@ -55,12 +56,14 @@ class ArticleManager {
   private fileManager: FileManager; // Use injected FileManager
   private tagManager: TagManager; // Use injected TagManager
   private llmClientService: LLMClientService | null = null; // LLM Client Service
+  private settings: PluginSettings;
 
-  constructor(app: App, fileManager: FileManager, tagManager: TagManager, llmClientService: LLMClientService | null = null) {
+  constructor(app: App, fileManager: FileManager, tagManager: TagManager, llmClientService: LLMClientService | null = null, settings: PluginSettings) {
     this.app = app;
     this.fileManager = fileManager; // Store injected instance
     this.tagManager = tagManager; // Store injected instance
     this.llmClientService = llmClientService;
+    this.settings = settings;
   }
 
   async fetchAndSummarizeArticle(options: ArticleSummaryOptions): Promise<string> {
@@ -107,7 +110,8 @@ class ArticleManager {
 
   private async fetchArticle(url: string): Promise<ArticleData> {
     try {
-      const response = await fetch("http://127.0.0.1:8001/fetch-article", {
+      const helperServerUrl = (this.settings.helperServerUrl || 'http://127.0.0.1:8001').replace(/\/+$/, '');
+      const response = await fetch(`${helperServerUrl}/fetch-article`, {
         method: "POST",
         headers: { "Content-Type": "application/json" },
         body: JSON.stringify({ url }),
@@ -127,12 +131,18 @@ class ArticleManager {
       }
       return data;
     } catch (error: unknown) {
+      const helperServerUrl = (this.settings.helperServerUrl || 'http://127.0.0.1:8001').replace(/\/+$/, '');
       ErrorHandler.handleError(error, "API_FETCH_ERROR", {
         operation: "fetch-article",
         url,
+        helperServerUrl,
         details: error instanceof Error ? error.message : String(error)
       });
-      throw error; // Re-throw to be handled by calling method
+      throw new Error(
+        `Could not reach the article-fetch helper server at ${helperServerUrl}. ` +
+        `Check that it is running and that "Helper Server URL" in Settings is correct. ` +
+        `Original error: ${error instanceof Error ? error.message : String(error)}`
+      );
     }
   }
 
diff --git a/src/utils/PluginServices.ts b/src/utils/PluginServices.ts
index 52344ca..c48e784 100644
--- a/src/utils/PluginServices.ts
+++ b/src/utils/PluginServices.ts
@@ -110,7 +110,7 @@ export class PluginServices {
 
     // Initialize managers that depend on core services, passing dependencies
     this._transcriptManager = new TranscriptManager(app, this._fileManager, this._tagManager, this._pathManager, this._databaseManager, this._settings, this._llmClientService);
-    this._articleManager = new ArticleManager(app, this._fileManager, this._tagManager, this._llmClientService); // Pass TagManager and LLMClientService to ArticleManager
+    this._articleManager = new ArticleManager(app, this._fileManager, this._tagManager, this._llmClientService, this._settings); // Pass TagManager, LLMClientService, and settings to ArticleManager
     
     this._hierarchyManager = new HierarchyManager(this.plugin, this._pathManager, this._transcriptManager, this._llmClientService);
     
diff --git a/src/utils/TranscriptManager.ts b/src/utils/TranscriptManager.ts
index 520072f..2fa0b0f 100644
--- a/src/utils/TranscriptManager.ts
+++ b/src/utils/TranscriptManager.ts
@@ -287,9 +287,10 @@ class TranscriptManager {
     saveToDatabase: boolean = false // New parameter to skip file saving
   ): Promise<{ filePath: string | null; videoData: VideoData; transcript: string }> {
     try {
-      // Note: Transcript fetching still uses Python server for now
-      // This could be migrated to use YouTube API directly in the future
-      const response = await fetch("http://127.0.0.1:8001/get-transcript", {
+      // Note: Transcript fetching still uses an external helper server (see settings.helperServerUrl),
+      // not one of the LLM providers. This could be migrated to use the YouTube API directly in the future.
+      const helperServerUrl = (this.settings.helperServerUrl || 'http://127.0.0.1:8001').replace(/\/+$/, '');
+      const response = await fetch(`${helperServerUrl}/get-transcript`, {
         method: "POST",
         headers: { "Content-Type": "application/json" },
         body: JSON.stringify({
```

======================================================================
### Step 06 — Fix spaced-repetition generation provider bug
**Commit:** `2fe70bf`

**Summary:** CRITICAL BUG: was overwriting `defaultLLMProvider = 'ollama'` globally. Now uses dedicated settings. Added Provider+Model dropdowns.

```diff
diff --git a/src/commandCatalog.ts b/src/commandCatalog.ts
index 242ce25..8702da6 100644
--- a/src/commandCatalog.ts
+++ b/src/commandCatalog.ts
@@ -31,7 +31,7 @@ export const PLUGIN_COMMAND_CATALOG: PluginCommandCatalogEntry[] = [
     id: 'generate-spaced-repetition-from-current-note',
     name: 'Generate Spaced Repetition Questions From Current Note',
     group: 'Spaced Repetition',
-    description: 'Uses Ollama to generate review questions from the active note and saves them to the spaced repetition database.',
+    description: 'Generates review questions from the active note using your configured LLM provider and saves them to the spaced repetition database.',
   },
   {
     id: 'open-spaced-repetition-review',
diff --git a/src/constants.ts b/src/constants.ts
index f272ebb..356fd23 100644
--- a/src/constants.ts
+++ b/src/constants.ts
@@ -98,6 +98,8 @@ const DEFAULT_SETTINGS = {
   studyPathContextMaxTokens: 120000,
   studyPathMarkdownPath: "WikiSynthesis/Study/Plans/CSharp/Generated CSharp Study Path.md",
   studyPathCanvasPath: "WikiSynthesis/Study/Plans/CSharp/Generated CSharp Study Path.canvas",
+  spacedRepetitionGenerationProvider: 'openrouter',
+  spacedRepetitionGenerationModel: '',
   studySourceGroups: [
     {
       id: "csharp-reference",
diff --git a/src/main.ts b/src/main.ts
index 28c3d41..a1bda09 100644
--- a/src/main.ts
+++ b/src/main.ts
@@ -895,6 +895,8 @@ export default class GptFreeTextGeneratorPlugin extends Plugin {
     this.settings.studyPathContextMaxTokens = this.settings.studyPathContextMaxTokens ?? DEFAULT_SETTINGS.studyPathContextMaxTokens;
     this.settings.studyPathMarkdownPath = this.settings.studyPathMarkdownPath ?? DEFAULT_SETTINGS.studyPathMarkdownPath;
     this.settings.studyPathCanvasPath = this.settings.studyPathCanvasPath ?? DEFAULT_SETTINGS.studyPathCanvasPath;
+    this.settings.spacedRepetitionGenerationProvider = this.settings.spacedRepetitionGenerationProvider ?? DEFAULT_SETTINGS.spacedRepetitionGenerationProvider;
+    this.settings.spacedRepetitionGenerationModel = this.settings.spacedRepetitionGenerationModel ?? DEFAULT_SETTINGS.spacedRepetitionGenerationModel;
     this.settings.providerTimeout = this.settings.providerTimeout && this.settings.providerTimeout > 600000
       ? this.settings.providerTimeout
       : DEFAULT_SETTINGS.providerTimeout;
diff --git a/src/modals/SpacedRepetitionGenerateQuestionsModal.ts b/src/modals/SpacedRepetitionGenerateQuestionsModal.ts
index 7298a01..f3ca927 100644
--- a/src/modals/SpacedRepetitionGenerateQuestionsModal.ts
+++ b/src/modals/SpacedRepetitionGenerateQuestionsModal.ts
@@ -1,11 +1,13 @@
 import { App, Modal, Notice, Setting, TFile } from 'obsidian';
 import type GptFreeTextGeneratorPlugin from '../main';
 import { QuestionType } from '../types/spacedRepetition';
+import { TextProviderId, TEXT_PROVIDER_LABELS } from '../types/providers';
 
 export class SpacedRepetitionGenerateQuestionsModal extends Modal {
   private plugin: GptFreeTextGeneratorPlugin;
   private sourceFile: TFile;
   private model: string;
+  private provider: TextProviderId;
   private questionCount = 8;
   private includeSelfCheck = true;
   private includeTypedExact = true;
@@ -19,7 +21,10 @@ export class SpacedRepetitionGenerateQuestionsModal extends Modal {
     super(app);
     this.plugin = plugin;
     this.sourceFile = sourceFile;
-    this.model = plugin.settings.ollamaTextModel || 'gemma4:31b-cloud';
+    this.provider = plugin.settings.spacedRepetitionGenerationProvider as TextProviderId
+      || plugin.settings.defaultLLMProvider as TextProviderId;
+    this.model = plugin.settings.spacedRepetitionGenerationModel
+      || this.getDefaultModelForProvider(this.provider);
   }
 
   onOpen(): void {
@@ -34,12 +39,26 @@ export class SpacedRepetitionGenerateQuestionsModal extends Modal {
     });
 
     new Setting(contentEl)
-      .setName('Ollama Model')
-      .setDesc('Used through the configured Ollama base URL.')
+      .setName('Provider')
       .addDropdown((dropdown) => {
-        const models = this.getOllamaModelOptions();
         dropdown
-          .addOptions(models)
+          .addOptions(TEXT_PROVIDER_LABELS)
+          .setValue(this.provider)
+          .onChange(async (value) => {
+            const newProvider = value as TextProviderId;
+            this.provider = newProvider;
+            this.plugin.settings.spacedRepetitionGenerationProvider = newProvider;
+            this.model = this.getDefaultModelForProvider(newProvider);
+            await this.plugin.saveSettings();
+            this.onOpen();
+          });
+      });
+
+    new Setting(contentEl)
+      .setName('Model')
+      .addDropdown((dropdown) => {
+        dropdown
+          .addOptions(this.getModelOptionsForProvider(this.provider))
           .setValue(this.model)
           .onChange((value) => {
             this.model = value;
@@ -131,12 +150,12 @@ export class SpacedRepetitionGenerateQuestionsModal extends Modal {
     }
 
     this.isGenerating = true;
-    new Notice('Generating review questions with Ollama...');
+    new Notice(`Generating review questions with ${TEXT_PROVIDER_LABELS[this.provider]}...`);
 
     try {
       this.plugin.settings.spacedRepetition.enabled = true;
-      this.plugin.settings.defaultLLMProvider = 'ollama';
-      this.plugin.settings.ollamaTextModel = this.model;
+      this.plugin.settings.spacedRepetitionGenerationProvider = this.provider;
+      this.plugin.settings.spacedRepetitionGenerationModel = this.model;
       await this.plugin.saveSettings();
 
       const noteContent = await this.app.vault.read(this.sourceFile);
@@ -145,6 +164,7 @@ export class SpacedRepetitionGenerateQuestionsModal extends Modal {
       const generatedQuestions = await this.plugin.services.spacedRepetitionGenerator.generateQuestionsForNote({
         file: this.sourceFile,
         noteContent,
+        provider: this.provider,
         model: this.model,
         questionCount: this.questionCount,
         questionTypes,
@@ -188,15 +208,64 @@ export class SpacedRepetitionGenerateQuestionsModal extends Modal {
     return types;
   }
 
-  private getOllamaModelOptions(): Record<string, string> {
-    const models = this.plugin.settings.ollamaModels?.length
-      ? this.plugin.settings.ollamaModels
-      : [this.model || 'gemma4:31b-cloud'];
+  private getDefaultModelForProvider(provider: TextProviderId): string {
+    switch (provider) {
+      case 'openrouter':
+        return this.plugin.settings.openrouterTextModel || 'openrouter/deepseek/deepseek-r1:free';
+      case 'chutes':
+        return this.plugin.settings.chutesTextModel || 'deepseek-ai/DeepSeek-V3.2-Speciale-TEE';
+      case 'zai':
+        return this.plugin.settings.zaiTextModel || 'glm-4.6';
+      case 'ollama':
+        return this.plugin.settings.ollamaTextModel || 'gemma4:31b-cloud';
+      case 'proxy':
+        return this.plugin.settings.proxyTextModel || 'nim:nvidia/nemotron-3-nano-omni-30b-a3b-reasoning';
+      default:
+        return this.plugin.settings.defaultTextModel || 'gpt-4o';
+    }
+  }
 
-    return models.reduce((acc: Record<string, string>, model) => {
-      acc[model] = model;
-      return acc;
-    }, {});
+  private getModelOptionsForProvider(provider: TextProviderId): Record<string, string> {
+    switch (provider) {
+      case 'openrouter': {
+        const models = this.plugin.settings.openRouterModels?.length
+          ? this.plugin.settings.openRouterModels
+          : [this.getDefaultModelForProvider('openrouter')];
+        return models.reduce((acc: Record<string, string>, id) => {
+          const name = this.plugin.settings.openRouterModels?.find(m => m === id) || id;
+          acc[id] = name;
+        }, {});
+      }
+      case 'chutes':
+        return {
+          'deepseek-ai/DeepSeek-V3.2-Speciale-TEE': 'DeepSeek V3.2 Speciale',
+        };
+      case 'zai':
+        return {
+          'glm-4.6': 'GLM 4.6',
+          'glm-4.7': 'GLM 4.7',
+        };
+      case 'ollama': {
+        const models = this.plugin.settings.ollamaModels?.length
+          ? this.plugin.settings.ollamaModels
+          : [this.getDefaultModelForProvider('ollama')];
+        return models.reduce((acc: Record<string, string>, model) => {
+          acc[model] = model;
+          return acc;
+        }, {});
+      }
+      case 'proxy': {
+        const models = this.plugin.settings.proxyModels?.length
+          ? this.plugin.settings.proxyModels
+          : [this.getDefaultModelForProvider('proxy')];
+        return models.reduce((acc: Record<string, string>, model) => {
+          acc[model] = model;
+          return acc;
+        }, {});
+      }
+      default:
+        return { [this.getDefaultModelForProvider(provider)]: this.getDefaultModelForProvider(provider) };
+    }
   }
 
   private createContentHash(content: string): string {
diff --git a/src/types/index.ts b/src/types/index.ts
index 1ca54eb..61d4775 100644
--- a/src/types/index.ts
+++ b/src/types/index.ts
@@ -144,6 +144,10 @@ export interface PluginSettings {
     studyPathContextMaxTokens: number;
     studyPathMarkdownPath: string;
     studyPathCanvasPath: string;
+
+    // Spaced repetition question generation provider
+    spacedRepetitionGenerationProvider: 'openrouter' | 'chutes' | 'zai' | 'ollama' | 'proxy';
+    spacedRepetitionGenerationModel: string;
   }
   
   /**
diff --git a/src/utils/spacedRepetition/SpacedRepetitionGenerator.ts b/src/utils/spacedRepetition/SpacedRepetitionGenerator.ts
index 0fe7b9c..e227a86 100644
--- a/src/utils/spacedRepetition/SpacedRepetitionGenerator.ts
+++ b/src/utils/spacedRepetition/SpacedRepetitionGenerator.ts
@@ -52,7 +52,7 @@ export class SpacedRepetitionGenerator {
   async generateQuestionsForNote(options: GenerateQuestionsForNoteOptions): Promise<GeneratedSpacedRepetitionQuestion[]> {
     const client = options.provider
       ? this.llmClientService.getClientForProvider(options.provider)
-      : this.llmClientService.getClientForProvider('ollama') ?? this.llmClientService.getClient();
+      : this.llmClientService.getClient();
     if (!client) {
       throw new Error('LLM client is not initialized');
     }
@@ -137,7 +137,7 @@ export class SpacedRepetitionGenerator {
     }
 
     if (valid.length === 0) {
-      throw new Error('Ollama did not return any valid review questions');
+      throw new Error('The selected provider did not return any valid review questions');
     }
 
     return valid;
```

======================================================================
### Step 07 — Fix Note Chat provider lock-in
**Commit:** `3963506`

**Summary:** CRITICAL BUG: note chat was hardcoded to Ollama. Now supports all 5 providers with dropdowns.

```diff
diff --git a/src/commandCatalog.ts b/src/commandCatalog.ts
index 8702da6..cd1d43b 100644
--- a/src/commandCatalog.ts
+++ b/src/commandCatalog.ts
@@ -65,9 +65,9 @@ export const PLUGIN_COMMAND_CATALOG: PluginCommandCatalogEntry[] = [
   },
   {
     id: 'chat-with-current-note-ollama',
-    name: 'Chat With Current Note Using Ollama',
+    name: 'Chat With Current Note',
     group: 'Spaced Repetition',
-    description: 'Opens a side pane chat with Ollama using the active note as context and saves chat history in the spaced repetition database.',
+    description: 'Opens a side pane chat with your configured LLM provider using the active note as context and saves chat history in the spaced repetition database.',
   },
   {
     id: 'chat-with-current-note-ollama-modal',
diff --git a/src/constants.ts b/src/constants.ts
index 356fd23..e0ad9ff 100644
--- a/src/constants.ts
+++ b/src/constants.ts
@@ -100,6 +100,8 @@ const DEFAULT_SETTINGS = {
   studyPathCanvasPath: "WikiSynthesis/Study/Plans/CSharp/Generated CSharp Study Path.canvas",
   spacedRepetitionGenerationProvider: 'openrouter',
   spacedRepetitionGenerationModel: '',
+  noteChatProvider: 'openrouter',
+  noteChatModel: '',
   studySourceGroups: [
     {
       id: "csharp-reference",
diff --git a/src/main.ts b/src/main.ts
index a1bda09..5bc9472 100644
--- a/src/main.ts
+++ b/src/main.ts
@@ -897,6 +897,8 @@ export default class GptFreeTextGeneratorPlugin extends Plugin {
     this.settings.studyPathCanvasPath = this.settings.studyPathCanvasPath ?? DEFAULT_SETTINGS.studyPathCanvasPath;
     this.settings.spacedRepetitionGenerationProvider = this.settings.spacedRepetitionGenerationProvider ?? DEFAULT_SETTINGS.spacedRepetitionGenerationProvider;
     this.settings.spacedRepetitionGenerationModel = this.settings.spacedRepetitionGenerationModel ?? DEFAULT_SETTINGS.spacedRepetitionGenerationModel;
+    this.settings.noteChatProvider = this.settings.noteChatProvider ?? DEFAULT_SETTINGS.noteChatProvider;
+    this.settings.noteChatModel = this.settings.noteChatModel ?? DEFAULT_SETTINGS.noteChatModel;
     this.settings.providerTimeout = this.settings.providerTimeout && this.settings.providerTimeout > 600000
       ? this.settings.providerTimeout
       : DEFAULT_SETTINGS.providerTimeout;
diff --git a/src/modals/SpacedRepetitionNoteChatModal.ts b/src/modals/SpacedRepetitionNoteChatModal.ts
index f009dc6..0cb8f72 100644
--- a/src/modals/SpacedRepetitionNoteChatModal.ts
+++ b/src/modals/SpacedRepetitionNoteChatModal.ts
@@ -1,6 +1,7 @@
 import { App, MarkdownRenderer, Modal, Notice, Setting, TFile } from 'obsidian';
 import type GptFreeTextGeneratorPlugin from '../main';
 import { NoteChatMessageRecord } from '../types/spacedRepetition';
+import { TextProviderId, TEXT_PROVIDER_LABELS } from '../types/providers';
 
 export class SpacedRepetitionNoteChatModal extends Modal {
   private plugin: GptFreeTextGeneratorPlugin;
@@ -12,12 +13,16 @@ export class SpacedRepetitionNoteChatModal extends Modal {
   private prompt = '';
   private isSending = false;
   private model: string;
+  private provider: TextProviderId;
 
   constructor(app: App, plugin: GptFreeTextGeneratorPlugin, file: TFile) {
     super(app);
     this.plugin = plugin;
     this.file = file;
-    this.model = plugin.settings.ollamaTextModel || 'gemma4:31b-cloud';
+    this.provider = plugin.settings.noteChatProvider as TextProviderId
+      || plugin.settings.defaultLLMProvider as TextProviderId;
+    this.model = plugin.settings.noteChatModel
+      || this.getDefaultModelForProvider(this.provider);
   }
 
   async onOpen(): Promise<void> {
@@ -49,19 +54,31 @@ export class SpacedRepetitionNoteChatModal extends Modal {
     container.createEl('h2', { text: `Chat With ${this.file.basename}` });
 
     new Setting(container)
-      .setName('Ollama model')
+      .setName('Provider')
       .addDropdown((dropdown) => {
-        const configuredModels = this.plugin.settings.ollamaModels ?? [];
-        const models = configuredModels.length
-          ? configuredModels
-          : [this.model];
-        for (const model of models) {
-          dropdown.addOption(model, model);
-        }
-        dropdown.setValue(this.model);
-        dropdown.onChange((value) => {
-          this.model = value;
-        });
+        dropdown
+          .addOptions(TEXT_PROVIDER_LABELS)
+          .setValue(this.provider)
+          .onChange(async (value) => {
+            const newProvider = value as TextProviderId;
+            this.provider = newProvider;
+            this.plugin.settings.noteChatProvider = newProvider;
+            this.model = this.getDefaultModelForProvider(newProvider);
+            this.plugin.settings.noteChatModel = this.model;
+            await this.plugin.saveSettings();
+            this.render();
+          });
+      });
+
+    new Setting(container)
+      .setName('Model')
+      .addDropdown((dropdown) => {
+        dropdown
+          .addOptions(this.getModelOptionsForProvider(this.provider))
+          .setValue(this.model)
+          .onChange((value) => {
+            this.model = value;
+          });
       });
 
     const history = container.createDiv({ cls: 'spaced-repetition-note-chat-history' });
@@ -77,7 +94,7 @@ export class SpacedRepetitionNoteChatModal extends Modal {
         cls: `spaced-repetition-note-chat-message spaced-repetition-note-chat-${message.role}`,
       });
       messageEl.createEl('div', {
-        text: message.role === 'assistant' ? 'Ollama' : message.role,
+        text: message.role === 'assistant' ? TEXT_PROVIDER_LABELS[this.provider] : message.role,
         cls: 'spaced-repetition-note-chat-role',
       });
       const contentEl = messageEl.createDiv({ cls: 'spaced-repetition-note-chat-content' });
@@ -131,10 +148,11 @@ export class SpacedRepetitionNoteChatModal extends Modal {
       await database.addNoteChatMessage({ chatId: this.chatId, role: 'user', content: prompt });
       this.messages = database.getNoteChatMessages(this.chatId);
 
-      const client = this.plugin.services.llmClientService.getClientForProvider('ollama')
+      const provider = this.plugin.settings.noteChatProvider || this.plugin.settings.defaultLLMProvider;
+      const client = this.plugin.services.llmClientService.getClientForProvider(provider as TextProviderId)
         ?? this.plugin.services.llmClientService.getClient();
       if (!client) {
-        throw new Error('Ollama client is not available');
+        throw new Error(`No LLM client available for provider "${provider}". Check the API key/base URL for this provider in Settings.`);
       }
 
       const response = await client.generateText({
@@ -171,7 +189,7 @@ export class SpacedRepetitionNoteChatModal extends Modal {
     const lastUser = this.getLastUserMessage();
     const lastAssistant = this.getLastAssistantMessage();
     if (!lastUser || !lastAssistant) {
-      new Notice('Need a user question and an Ollama reply first');
+      new Notice('Need a user question and an assistant reply first');
       return;
     }
 
@@ -223,6 +241,48 @@ export class SpacedRepetitionNoteChatModal extends Modal {
     ].filter(Boolean).join('\n');
   }
 
+  private getDefaultModelForProvider(provider: TextProviderId): string {
+    switch (provider) {
+      case 'openrouter':
+        return this.plugin.settings.openrouterTextModel || 'openrouter/deepseek/deepseek-r1:free';
+      case 'chutes':
+        return this.plugin.settings.chutesTextModel || 'deepseek-ai/DeepSeek-V3.2-Speciale-TEE';
+      case 'zai':
+        return this.plugin.settings.zaiTextModel || 'glm-4.6';
+      case 'ollama':
+        return this.plugin.settings.ollamaTextModel || 'gemma4:31b-cloud';
+      case 'proxy':
+        return this.plugin.settings.proxyTextModel || 'nim:nvidia/nemotron-3-nano-omni-30b-a3b-reasoning';
+      default:
+        return this.plugin.settings.defaultTextModel || 'gpt-4o';
+    }
+  }
+
+  private getModelOptionsForProvider(provider: TextProviderId): Record<string, string> {
+    switch (provider) {
+      case 'ollama': {
+        const models = this.plugin.settings.ollamaModels?.length
+          ? this.plugin.settings.ollamaModels
+          : [this.getDefaultModelForProvider('ollama')];
+        return models.reduce((acc: Record<string, string>, model) => {
+          acc[model] = model;
+          return acc;
+        }, {});
+      }
+      case 'proxy': {
+        const models = this.plugin.settings.proxyModels?.length
+          ? this.plugin.settings.proxyModels
+          : [this.getDefaultModelForProvider('proxy')];
+        return models.reduce((acc: Record<string, string>, model) => {
+          acc[model] = model;
+          return acc;
+        }, {});
+      }
+      default:
+        return { [this.getDefaultModelForProvider(provider)]: this.getDefaultModelForProvider(provider) };
+    }
+  }
+
   private getLastUserMessage(): NoteChatMessageRecord | null {
     return [...this.messages].reverse().find((message) => message.role === 'user') ?? null;
   }
diff --git a/src/types/index.ts b/src/types/index.ts
index 61d4775..0024d38 100644
--- a/src/types/index.ts
+++ b/src/types/index.ts
@@ -148,6 +148,10 @@ export interface PluginSettings {
     // Spaced repetition question generation provider
     spacedRepetitionGenerationProvider: 'openrouter' | 'chutes' | 'zai' | 'ollama' | 'proxy';
     spacedRepetitionGenerationModel: string;
+
+    // Note chat provider
+    noteChatProvider: 'openrouter' | 'chutes' | 'zai' | 'ollama' | 'proxy';
+    noteChatModel: string;
   }
   
   /**
diff --git a/src/views/SpacedRepetitionNoteChatView.ts b/src/views/SpacedRepetitionNoteChatView.ts
index 177ee31..a57b6bd 100644
--- a/src/views/SpacedRepetitionNoteChatView.ts
+++ b/src/views/SpacedRepetitionNoteChatView.ts
@@ -3,6 +3,7 @@ import { VIEW_TYPE_SPACED_REPETITION_NOTE_CHAT } from '../constants';
 import type GptFreeTextGeneratorPlugin from '../main';
 import { VaultFileSelectorModal } from '../modals/VaultFileSelectorModal';
 import { NoteChatMessageRecord, NoteChatRecord } from '../types/spacedRepetition';
+import { TextProviderId, TEXT_PROVIDER_LABELS } from '../types/providers';
 import { PdfHelper } from '../utils/PdfHelper';
 
 const MAX_EXTRA_CONTEXT_CHARS = 18000;
@@ -181,6 +182,33 @@ export class SpacedRepetitionNoteChatView extends ItemView {
 
     this.renderContextFiles(container);
 
+    const providerSetting = new Setting(container)
+      .setName('Provider')
+      .addDropdown((dropdown) => {
+        dropdown
+          .addOptions(TEXT_PROVIDER_LABELS)
+          .setValue(this.plugin.settings.noteChatProvider || this.plugin.settings.defaultLLMProvider)
+          .onChange(async (value) => {
+            const newProvider = value as TextProviderId;
+            this.plugin.settings.noteChatProvider = newProvider;
+            this.plugin.settings.noteChatModel = this.getDefaultModelForProvider(newProvider);
+            await this.plugin.saveSettings();
+            this.render();
+          });
+      });
+
+    providerSetting
+      .addDropdown((dropdown) => {
+        const provider = (this.plugin.settings.noteChatProvider || this.plugin.settings.defaultLLMProvider) as TextProviderId;
+        dropdown
+          .addOptions(this.getModelOptionsForProvider(provider))
+          .setValue(this.plugin.settings.noteChatModel || this.getDefaultModelForProvider(provider))
+          .onChange(async (value) => {
+            this.plugin.settings.noteChatModel = value;
+            await this.plugin.saveSettings();
+          });
+      });
+
     const history = container.createDiv({ cls: 'spaced-repetition-note-chat-history' });
     if (this.messages.length === 0) {
       history.createEl('div', {
@@ -194,7 +222,9 @@ export class SpacedRepetitionNoteChatView extends ItemView {
         cls: `spaced-repetition-note-chat-message spaced-repetition-note-chat-${message.role}`,
       });
       messageEl.createEl('div', {
-        text: message.role === 'assistant' ? 'Ollama' : message.role,
+        text: message.role === 'assistant'
+          ? TEXT_PROVIDER_LABELS[(this.plugin.settings.noteChatProvider || this.plugin.settings.defaultLLMProvider) as TextProviderId]
+          : message.role,
         cls: 'spaced-repetition-note-chat-role',
       });
       const contentEl = messageEl.createDiv({ cls: 'spaced-repetition-note-chat-content' });
@@ -386,14 +416,15 @@ export class SpacedRepetitionNoteChatView extends ItemView {
       await database.addNoteChatMessage({ chatId: this.chatId, role: 'user', content: prompt });
       this.messages = database.getNoteChatMessages(this.chatId);
 
-      const client = this.plugin.services.llmClientService.getClientForProvider('ollama')
+      const provider = this.plugin.settings.noteChatProvider || this.plugin.settings.defaultLLMProvider;
+      const client = this.plugin.services.llmClientService.getClientForProvider(provider as TextProviderId)
         ?? this.plugin.services.llmClientService.getClient();
       if (!client) {
-        throw new Error('Ollama client is not available');
+        throw new Error(`No LLM client available for provider "${provider}". Check the API key/base URL for this provider in Settings.`);
       }
 
       const response = await client.generateText({
-        model: this.plugin.settings.ollamaTextModel || 'gemma4:31b-cloud',
+        model: this.plugin.settings.noteChatModel || this.getDefaultModelForProvider(provider as TextProviderId),
         message: await this.buildChatPrompt(prompt),
         temperature: 0.3,
         maxTokens: 2200,
@@ -427,7 +458,7 @@ export class SpacedRepetitionNoteChatView extends ItemView {
     const lastUser = this.getLastUserMessage();
     const lastAssistant = this.getLastAssistantMessage();
     if (!lastUser || !lastAssistant) {
-      new Notice('Need a user question and an Ollama reply first');
+      new Notice('Need a user question and an assistant reply first');
       return;
     }
 
@@ -605,4 +636,46 @@ export class SpacedRepetitionNoteChatView extends ItemView {
 
     return `simple_${Math.abs(hash)}_${content.length}`;
   }
+
+  private getDefaultModelForProvider(provider: TextProviderId): string {
+    switch (provider) {
+      case 'openrouter':
+        return this.plugin.settings.openrouterTextModel || 'openrouter/deepseek/deepseek-r1:free';
+      case 'chutes':
+        return this.plugin.settings.chutesTextModel || 'deepseek-ai/DeepSeek-V3.2-Speciale-TEE';
+      case 'zai':
+        return this.plugin.settings.zaiTextModel || 'glm-4.6';
+      case 'ollama':
+        return this.plugin.settings.ollamaTextModel || 'gemma4:31b-cloud';
+      case 'proxy':
+        return this.plugin.settings.proxyTextModel || 'nim:nvidia/nemotron-3-nano-omni-30b-a3b-reasoning';
+      default:
+        return this.plugin.settings.defaultTextModel || 'gpt-4o';
+    }
+  }
+
+  private getModelOptionsForProvider(provider: TextProviderId): Record<string, string> {
+    switch (provider) {
+      case 'ollama': {
+        const models = this.plugin.settings.ollamaModels?.length
+          ? this.plugin.settings.ollamaModels
+          : [this.getDefaultModelForProvider('ollama')];
+        return models.reduce((acc: Record<string, string>, model) => {
+          acc[model] = model;
+          return acc;
+        }, {});
+      }
+      case 'proxy': {
+        const models = this.plugin.settings.proxyModels?.length
+          ? this.plugin.settings.proxyModels
+          : [this.getDefaultModelForProvider('proxy')];
+        return models.reduce((acc: Record<string, string>, model) => {
+          acc[model] = model;
+          return acc;
+        }, {});
+      }
+      default:
+        return { [this.getDefaultModelForProvider(provider)]: this.getDefaultModelForProvider(provider) };
+    }
+  }
 }
```

======================================================================
### Step 08 — Improve manual flashcard creation
**Commit:** `6cc37c4`

**Summary:** Deck selector, multiple-choice fields (4 choices + correct marker), keep-open toggle for rapid card creation.

```diff
diff --git a/src/modals/SpacedRepetitionManualQuestionModal.ts b/src/modals/SpacedRepetitionManualQuestionModal.ts
index 2f2e3e3..63b9d7e 100644
--- a/src/modals/SpacedRepetitionManualQuestionModal.ts
+++ b/src/modals/SpacedRepetitionManualQuestionModal.ts
@@ -1,6 +1,6 @@
 import { App, Modal, Notice, Setting, TFile } from 'obsidian';
 import type GptFreeTextGeneratorPlugin from '../main';
-import { AnswerCheckMode, ExactAnswerField, QuestionType } from '../types/spacedRepetition';
+import { AnswerCheckMode, ExactAnswerField, QuestionType, SpacedRepetitionStudySetRecord } from '../types/spacedRepetition';
 import { parseExactAnswerFieldsText } from '../utils/spacedRepetition/ExactAnswerMatcher';
 
 export class SpacedRepetitionManualQuestionModal extends Modal {
@@ -11,6 +11,12 @@ export class SpacedRepetitionManualQuestionModal extends Modal {
   private answerText = '';
   private questionType: QuestionType = 'self_check';
   private answerCheckMode: AnswerCheckMode = 'self';
+  private studySets: SpacedRepetitionStudySetRecord[] = [];
+  private selectedStudySetId = '';
+  private newDeckName = '';
+  private choiceTexts = ['', '', '', ''];
+  private correctChoiceIndex = 0;
+  private keepOpenAfterSave = false;
 
   constructor(app: App, plugin: GptFreeTextGeneratorPlugin, sourceFile: TFile) {
     super(app);
@@ -18,7 +24,7 @@ export class SpacedRepetitionManualQuestionModal extends Modal {
     this.sourceFile = sourceFile;
   }
 
-  onOpen(): void {
+  async onOpen(): Promise<void> {
     const { contentEl } = this;
     contentEl.empty();
     this.modalEl.addClass('spaced-repetition-manual-question-modal');
@@ -29,6 +35,29 @@ export class SpacedRepetitionManualQuestionModal extends Modal {
       cls: 'spaced-repetition-source-path',
     });
 
+    await this.loadStudySets();
+    this.render();
+  }
+
+  onClose(): void {
+    this.contentEl.empty();
+  }
+
+  private async loadStudySets(): Promise<void> {
+    const database = await this.plugin.services.ensureSpacedRepetitionDatabase();
+    this.studySets = database.getStudySets().filter((set) => set.enabled);
+  }
+
+  private render(): void {
+    const { contentEl } = this;
+    contentEl.empty();
+
+    contentEl.createEl('h2', { text: 'Add Review Question' });
+    contentEl.createEl('p', {
+      text: this.sourceFile.path,
+      cls: 'spaced-repetition-source-path',
+    });
+
     new Setting(contentEl)
       .setName('Question Name')
       .setDesc('Optional short label for finding this card later.')
@@ -55,6 +84,10 @@ export class SpacedRepetitionManualQuestionModal extends Modal {
           .onChange((value) => {
             this.questionType = value as QuestionType;
             this.answerCheckMode = this.questionType === 'typed_exact' || this.questionType === 'typed_fields_exact' ? 'exact' : 'self';
+            if (this.questionType === 'multiple_choice') {
+              this.answerCheckMode = 'self';
+            }
+            this.render();
           });
       });
 
@@ -70,17 +103,83 @@ export class SpacedRepetitionManualQuestionModal extends Modal {
         text.inputEl.rows = 4;
       });
 
+    if (this.questionType === 'multiple_choice') {
+      contentEl.createEl('h4', { text: 'Choices (mark the correct one)' });
+      for (let i = 0; i < 4; i += 1) {
+        new Setting(contentEl)
+          .addText((text) => {
+            text
+              .setPlaceholder(`Choice ${i + 1}`)
+              .setValue(this.choiceTexts[i])
+              .onChange((value) => {
+                this.choiceTexts[i] = value;
+              });
+          })
+          .addToggle((toggle) => {
+            toggle
+              .setValue(this.correctChoiceIndex === i)
+              .onChange((value) => {
+                if (value) {
+                  this.correctChoiceIndex = i;
+                }
+              });
+          });
+      }
+    } else {
+      new Setting(contentEl)
+        .setName('Answer')
+        .setDesc('For typed exact fields, use one Label::Answer per line. Add optional JSON settings after a second ::.')
+        .addTextArea((text) => {
+          text
+            .setPlaceholder('Expected answer')
+            .setValue(this.answerText)
+            .onChange((value) => {
+              this.answerText = value;
+            });
+          text.inputEl.rows = 4;
+        });
+    }
+
+    // Deck / Study Set selector
+    const deckSetting = new Setting(contentEl)
+      .setName('Deck')
+      .setDesc('Which deck to add this question to.');
+
+    if (this.studySets.length > 0) {
+      deckSetting.addDropdown((dropdown) => {
+        dropdown.addOption('', 'No deck');
+        for (const set of this.studySets) {
+          dropdown.addOption(set.id, set.name);
+        }
+        dropdown
+          .setValue(this.selectedStudySetId)
+          .onChange((value) => {
+            this.selectedStudySetId = value;
+          });
+      });
+    } else {
+      deckSetting.setDesc('No decks available. Create one below or generate cards first.');
+    }
+
     new Setting(contentEl)
-      .setName('Answer')
-      .setDesc('For typed exact fields, use one Label::Answer per line. Add optional JSON settings after a second ::.')
-      .addTextArea((text) => {
+      .setName('New Deck Name')
+      .setDesc('Create a new deck for this question.')
+      .addText((text) => {
         text
-          .setPlaceholder('Expected answer')
-          .setValue(this.answerText)
+          .setPlaceholder('My Deck')
+          .setValue(this.newDeckName)
           .onChange((value) => {
-            this.answerText = value;
+            this.newDeckName = value.trim();
           });
-        text.inputEl.rows = 4;
+      });
+
+    new Setting(contentEl)
+      .setName('Keep Open')
+      .setDesc('Stay open to add another question after saving.')
+      .addToggle((toggle) => {
+        toggle.setValue(this.keepOpenAfterSave).onChange((value) => {
+          this.keepOpenAfterSave = value;
+        });
       });
 
     new Setting(contentEl)
@@ -103,7 +202,17 @@ export class SpacedRepetitionManualQuestionModal extends Modal {
       return;
     }
 
-    if (!this.answerText.trim()) {
+    if (this.questionType === 'multiple_choice') {
+      const filledChoices = this.choiceTexts.filter((c) => c.trim());
+      if (filledChoices.length < 2) {
+        new Notice('Multiple choice needs at least 2 filled choices');
+        return;
+      }
+      if (!this.choiceTexts[this.correctChoiceIndex]?.trim()) {
+        new Notice('The correct choice cannot be empty');
+        return;
+      }
+    } else if (!this.answerText.trim()) {
       new Notice('Answer text is required');
       return;
     }
@@ -122,33 +231,71 @@ export class SpacedRepetitionManualQuestionModal extends Modal {
 
       const database = await this.plugin.services.ensureSpacedRepetitionDatabase();
       const noteId = await database.upsertNoteFromFile(this.sourceFile);
-      const metadata = this.questionType === 'typed_fields_exact'
+
+      let studySetId: string | null = this.selectedStudySetId || null;
+      let deckName: string | null = null;
+
+      if (this.newDeckName) {
+        const newSetId = await database.createStudySet({
+          name: this.newDeckName,
+          sourceType: 'manual',
+          sourceRule: {},
+          tags: [],
+        });
+        studySetId = newSetId;
+        deckName = this.newDeckName;
+        this.newDeckName = '';
+      } else if (studySetId) {
+        deckName = this.studySets.find((set) => set.id === studySetId)?.name ?? null;
+      }
+
+      const metadata: Record<string, unknown> = this.questionType === 'typed_fields_exact'
         ? { exactFields }
         : {};
+      if (deckName) {
+        metadata.deckName = deckName;
+      }
+
+      const choices = this.questionType === 'multiple_choice'
+        ? this.choiceTexts.filter((c) => c.trim())
+        : null;
+      const answerText = this.questionType === 'multiple_choice'
+        ? this.choiceTexts[this.correctChoiceIndex]?.trim() || ''
+        : this.answerText.trim();
+
       await database.createQuestions([
         {
           noteId,
+          studySetId,
           questionName: this.questionName.trim() || null,
           questionText: this.questionText.trim(),
           questionType: this.questionType,
-          answerText: this.answerText.trim(),
+          answerText,
+          choices,
           answerCheckMode: this.answerCheckMode,
           metadata,
         },
       ]);
 
       new Notice('Review question saved');
-      this.close();
+
+      if (this.keepOpenAfterSave) {
+        this.questionName = '';
+        this.questionText = '';
+        this.answerText = '';
+        this.choiceTexts = ['', '', '', ''];
+        this.correctChoiceIndex = 0;
+        await this.loadStudySets();
+        this.render();
+      } else {
+        this.close();
+      }
     } catch (error) {
       console.error('Failed to save review question:', error);
       new Notice(`Failed to save review question: ${error instanceof Error ? error.message : 'Unknown error'}`);
     }
   }
 
-  onClose(): void {
-    this.contentEl.empty();
-  }
-
   private parseExactFields(value: string): ExactAnswerField[] {
     return parseExactAnswerFieldsText(value);
   }
```

======================================================================
### Step 09 — Make automatic flashcard preview editable
**Commit:** `0cc5811`

**Summary:** Per-card: Edit (full modal), Exclude (skip from save), Regenerate (re-call LLM). New SpacedRepetitionEditCardModal.

```diff
diff --git a/src/modals/SpacedRepetitionEditCardModal.ts b/src/modals/SpacedRepetitionEditCardModal.ts
new file mode 100644
index 0000000..de8f010
--- /dev/null
+++ b/src/modals/SpacedRepetitionEditCardModal.ts
@@ -0,0 +1,179 @@
+import { App, Modal, Notice, Setting } from 'obsidian';
+import { GeneratedSpacedRepetitionQuestion } from '../utils/spacedRepetition/SpacedRepetitionGenerator';
+import { AnswerCheckMode, ExactAnswerField, QuestionType } from '../types/spacedRepetition';
+import { parseExactAnswerFieldsText } from '../utils/spacedRepetition/ExactAnswerMatcher';
+
+export class SpacedRepetitionEditCardModal extends Modal {
+  private question: GeneratedSpacedRepetitionQuestion;
+  private onSave: (updated: GeneratedSpacedRepetitionQuestion) => Promise<void>;
+  private questionName: string;
+  private questionText: string;
+  private answerText: string;
+  private questionType: QuestionType;
+  private answerCheckMode: AnswerCheckMode;
+  private choiceTexts: string[];
+  private correctChoiceIndex: number;
+
+  constructor(
+    app: App,
+    question: GeneratedSpacedRepetitionQuestion,
+    onSave: (updated: GeneratedSpacedRepetitionQuestion) => Promise<void>,
+  ) {
+    super(app);
+    this.question = question;
+    this.onSave = onSave;
+    this.questionName = question.questionName || '';
+    this.questionText = question.questionText;
+    this.answerText = question.answerText || '';
+    this.questionType = question.questionType;
+    this.answerCheckMode = question.answerCheckMode;
+    this.choiceTexts = question.choices ? [...question.choices, ...Array(4 - question.choices.length).fill('')].slice(0, 4) : ['', '', '', ''];
+    this.correctChoiceIndex = 0;
+  }
+
+  onOpen(): void {
+    const { contentEl } = this;
+    contentEl.empty();
+    this.modalEl.addClass('spaced-repetition-edit-card-modal');
+
+    contentEl.createEl('h2', { text: 'Edit Card' });
+
+    new Setting(contentEl)
+      .setName('Question Name')
+      .addText((text) => {
+        text
+          .setValue(this.questionName)
+          .onChange((value) => { this.questionName = value; });
+      });
+
+    new Setting(contentEl)
+      .setName('Question Type')
+      .addDropdown((dropdown) => {
+        dropdown
+          .addOptions({
+            self_check: 'Self-check',
+            typed_exact: 'Typed exact',
+            typed_fields_exact: 'Typed exact fields',
+            multiple_choice: 'Multiple choice',
+          })
+          .setValue(this.questionType)
+          .onChange((value) => {
+            this.questionType = value as QuestionType;
+            this.answerCheckMode = this.questionType === 'typed_exact' || this.questionType === 'typed_fields_exact' ? 'exact' : 'self';
+            this.render();
+          });
+      });
+
+    new Setting(contentEl)
+      .setName('Question')
+      .addTextArea((text) => {
+        text
+          .setValue(this.questionText)
+          .onChange((value) => { this.questionText = value; });
+        text.inputEl.rows = 3;
+      });
+
+    if (this.questionType === 'multiple_choice') {
+      contentEl.createEl('h4', { text: 'Choices' });
+      for (let i = 0; i < 4; i += 1) {
+        new Setting(contentEl)
+          .addText((text) => {
+            text
+              .setPlaceholder(`Choice ${i + 1}`)
+              .setValue(this.choiceTexts[i])
+              .onChange((value) => { this.choiceTexts[i] = value; });
+          })
+          .addToggle((toggle) => {
+            toggle
+              .setValue(this.correctChoiceIndex === i)
+              .onChange((value) => { if (value) this.correctChoiceIndex = i; });
+          });
+      }
+    } else {
+      new Setting(contentEl)
+        .setName('Answer')
+        .addTextArea((text) => {
+          text
+            .setValue(this.answerText)
+            .onChange((value) => { this.answerText = value; });
+          text.inputEl.rows = 3;
+        });
+    }
+
+    new Setting(contentEl)
+      .addButton((button) => {
+        button
+          .setButtonText('Save Changes')
+          .setCta()
+          .onClick(() => this.saveChanges());
+      })
+      .addButton((button) => {
+        button
+          .setButtonText('Cancel')
+          .onClick(() => this.close());
+      });
+  }
+
+  private render(): void {
+    this.onOpen();
+  }
+
+  private async saveChanges(): Promise<void> {
+    if (!this.questionText.trim()) {
+      new Notice('Question text is required');
+      return;
+    }
+
+    let answerText = '';
+    let choices: string[] | null = null;
+
+    if (this.questionType === 'multiple_choice') {
+      const filled = this.choiceTexts.filter((c) => c.trim());
+      if (filled.length < 2) {
+        new Notice('Multiple choice needs at least 2 filled choices');
+        return;
+      }
+      if (!this.choiceTexts[this.correctChoiceIndex]?.trim()) {
+        new Notice('The correct choice cannot be empty');
+        return;
+      }
+      choices = this.choiceTexts.filter((c) => c.trim());
+      answerText = this.choiceTexts[this.correctChoiceIndex]?.trim() || '';
+    } else {
+      if (!this.answerText.trim()) {
+        new Notice('Answer text is required');
+        return;
+      }
+      answerText = this.answerText.trim();
+    }
+
+    const exactFields: ExactAnswerField[] | undefined = this.questionType === 'typed_fields_exact'
+      ? parseExactAnswerFieldsText(this.answerText)
+      : undefined;
+    if (this.questionType === 'typed_fields_exact' && (!exactFields || exactFields.length === 0)) {
+      new Notice('Add at least one exact field as Label::Answer');
+      return;
+    }
+
+    const updated: GeneratedSpacedRepetitionQuestion = {
+      ...this.question,
+      questionName: this.questionName.trim() || null,
+      questionText: this.questionText.trim(),
+      answerText,
+      questionType: this.questionType,
+      answerCheckMode: this.answerCheckMode,
+      choices,
+      metadata: {
+        ...(this.question.metadata ?? {}),
+        ...(exactFields ? { exactFields } : {}),
+      },
+    };
+
+    await this.onSave(updated);
+    this.close();
+  }
+
+  onClose(): void {
+    this.contentEl.empty();
+  }
+}
diff --git a/src/views/FlashcardGenerationView.ts b/src/views/FlashcardGenerationView.ts
index c2694ec..bc3f2f9 100644
--- a/src/views/FlashcardGenerationView.ts
+++ b/src/views/FlashcardGenerationView.ts
@@ -4,6 +4,7 @@ import { VIEW_TYPE_FLASHCARD_GENERATION } from '../constants';
 import { GeneratedSpacedRepetitionQuestion } from '../utils/spacedRepetition/SpacedRepetitionGenerator';
 import { QuestionType, SpacedRepetitionStudySetRecord } from '../types/spacedRepetition';
 import { TextProviderId } from '../types/providers';
+import { SpacedRepetitionEditCardModal } from '../modals/SpacedRepetitionEditCardModal';
 
 export class FlashcardGenerationView extends ItemView {
   private plugin: GptFreeTextGeneratorPlugin;
@@ -21,6 +22,7 @@ export class FlashcardGenerationView extends ItemView {
   private newDeckName = '';
   private isGenerating = false;
   private generatedQuestions: GeneratedSpacedRepetitionQuestion[] = [];
+  private excludedIndices: Set<number> = new Set();
 
   constructor(leaf: WorkspaceLeaf, plugin: GptFreeTextGeneratorPlugin) {
     super(leaf);
@@ -229,11 +231,50 @@ export class FlashcardGenerationView extends ItemView {
       return;
     }
 
-    for (const question of this.generatedQuestions) {
-      const card = preview.createDiv({ cls: 'flashcard-generation-preview-card' });
-      card.createEl('div', { text: question.questionName ?? question.questionType, cls: 'flashcard-generation-preview-label' });
+    for (let index = 0; index < this.generatedQuestions.length; index += 1) {
+      const question = this.generatedQuestions[index];
+      const isExcluded = this.excludedIndices.has(index);
+      const card = preview.createDiv({
+        cls: `flashcard-generation-preview-card${isExcluded ? ' flashcard-generation-preview-card-excluded' : ''}`,
+      });
+
+      const header = card.createDiv({ cls: 'flashcard-generation-preview-header' });
+      header.createEl('div', { text: question.questionName ?? question.questionType, cls: 'flashcard-generation-preview-label' });
+
+      const actions = header.createDiv({ cls: 'flashcard-generation-preview-actions' });
+
+      // Edit button
+      actions.createEl('button', { text: 'Edit', cls: 'mod-cta' }).addEventListener('click', () => {
+        this.editCard(index);
+      });
+
+      // Exclude toggle button
+      const excludeBtn = actions.createEl('button', {
+        text: isExcluded ? 'Include' : 'Exclude',
+        cls: isExcluded ? 'mod-warning' : '',
+      });
+      excludeBtn.addEventListener('click', () => {
+        if (this.excludedIndices.has(index)) {
+          this.excludedIndices.delete(index);
+        } else {
+          this.excludedIndices.add(index);
+        }
+        this.render();
+      });
+
+      // Regenerate single card button
+      actions.createEl('button', { text: 'Regenerate' }).addEventListener('click', () => {
+        this.regenerateSingleCard(index);
+      });
+
       card.createEl('div', { text: question.questionText, cls: 'flashcard-generation-preview-question' });
       card.createEl('div', { text: question.answerText ?? '', cls: 'flashcard-generation-preview-answer' });
+      if (question.choices) {
+        const choicesEl = card.createEl('ul', { cls: 'flashcard-generation-preview-choices' });
+        for (const choice of question.choices) {
+          choicesEl.createEl('li', { text: choice });
+        }
+      }
       const fields = this.getExactFieldPreview(question.metadata);
       if (fields.length) {
         const fieldList = card.createEl('ul', { cls: 'flashcard-generation-preview-fields' });
@@ -329,7 +370,13 @@ export class FlashcardGenerationView extends ItemView {
         await database.setStudySetNotes(studySetId, [noteId]);
       }
 
-      const questionIds = await database.createQuestions(this.generatedQuestions.map((question) => ({
+      const questionsToSave = this.generatedQuestions.filter((_, index) => !this.excludedIndices.has(index));
+      if (questionsToSave.length === 0) {
+        new Notice('All cards are excluded — nothing to save');
+        return;
+      }
+
+      const questionIds = await database.createQuestions(questionsToSave.map((question) => ({
         ...question,
         noteId,
         studySetId,
@@ -358,6 +405,7 @@ export class FlashcardGenerationView extends ItemView {
 
       new Notice(`Saved ${questionIds.length} card(s) to spaced repetition`);
       this.generatedQuestions = [];
+      this.excludedIndices.clear();
       this.render();
     } catch (error) {
       console.error('Failed to save generated flashcards:', error);
@@ -454,4 +502,51 @@ export class FlashcardGenerationView extends ItemView {
 
     return `simple_${Math.abs(hash).toString(16)}_${content.length}`;
   }
+
+  private editCard(index: number): void {
+    const question = this.generatedQuestions[index];
+    const editModal = new SpacedRepetitionEditCardModal(
+      this.app,
+      question,
+      async (updated) => {
+        this.generatedQuestions[index] = updated;
+        this.excludedIndices.delete(index);
+        this.render();
+      },
+    );
+    editModal.open();
+  }
+
+  private async regenerateSingleCard(index: number): Promise<void> {
+    const questionTypes = [this.generatedQuestions[index].questionType];
+    try {
+      this.isGenerating = true;
+      this.render();
+      const file = this.sourceFile ?? ({ path: 'Pasted Flashcard Context.md', basename: 'Pasted Flashcard Context' } as TFile);
+      const newQuestions = await this.plugin.services.spacedRepetitionGenerator.generateQuestionsForNote({
+        file,
+        noteContent: this.context,
+        provider: this.plugin.settings.flashcardGenerationProvider,
+        model: this.plugin.settings.flashcardGenerationModel,
+        questionCount: 1,
+        questionTypes,
+        additionalInstructions: this.prompt,
+        outputLanguage: this.plugin.settings.defaultOutputLanguage || 'english',
+        temperature: this.plugin.settings.flashcardGenerationTemperature,
+        maxTokens: this.plugin.settings.flashcardGenerationMaxTokens,
+      });
+      if (newQuestions.length > 0) {
+        this.generatedQuestions[index] = newQuestions[0];
+        new Notice('Card regenerated');
+      } else {
+        new Notice('Regeneration returned no valid card');
+      }
+    } catch (error) {
+      console.error('Failed to regenerate card:', error);
+      new Notice(`Regeneration failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
+    } finally {
+      this.isGenerating = false;
+      this.render();
+    }
+  }
 }
```

======================================================================
### Step 10 — Consolidate flashcard systems
**Commit:** `cbb0678`

**Summary:** Removed legacy FlashcardGeneratorModal command. Added opt-in migration command. @deprecated on old classes.

```diff
diff --git a/src/commandCatalog.ts b/src/commandCatalog.ts
index cd1d43b..3ec6f66 100644
--- a/src/commandCatalog.ts
+++ b/src/commandCatalog.ts
@@ -185,10 +185,10 @@ export const PLUGIN_COMMAND_CATALOG: PluginCommandCatalogEntry[] = [
     description: 'Opens the flashcard generation side panel with editable context, prompt, preview, and spaced repetition save.',
   },
   {
-    id: 'generate-flashcards-legacy-modal',
-    name: 'Generate Markdown Flashcards from Context (Legacy Modal)',
+    id: 'migrate-legacy-flashcards',
+    name: 'Migrate Legacy Flashcard Files',
     group: 'Learning',
-    description: 'Opens the older modal that writes markdown flashcards to the flashcard folder.',
+    description: 'Scans the legacy flashcard folder and imports previously generated Markdown cards into the spaced-repetition database.',
   },
   {
     id: 'open-coding-exercises',
diff --git a/src/main.ts b/src/main.ts
index 5bc9472..87668d3 100644
--- a/src/main.ts
+++ b/src/main.ts
@@ -30,7 +30,6 @@ import { NoteDeleter } from './utils/NoteDeleter'; // Import the note deleter
 import { StandaloneTranscriptCleanupModal } from './modals/StandaloneTranscriptCleanupModal'; // Import the cleanup modal
 import { QuickQueryModal } from './modals/QuickQueryModal'; // Import the QuickQueryModal
 import { QuizGeneratorModal } from './modals/QuizGeneratorModal'; // Import the QuizGeneratorModal
-import { FlashcardGeneratorModal } from './modals/FlashcardGeneratorModal'; // Import the FlashcardGeneratorModal
 import { COMMAND_CHEATSHEET_NOTE_PATH, renderCommandCheatsheet } from './commandCatalog';
 import { SpacedRepetitionReviewMode, SpacedRepetitionReviewView } from './views/SpacedRepetitionReviewView';
 import { SpacedRepetitionDeckBrowserView } from './views/SpacedRepetitionDeckBrowserView';
@@ -693,12 +692,9 @@ export default class GptFreeTextGeneratorPlugin extends Plugin {
     });
 
     this.addCommand({
-      id: 'generate-flashcards-legacy-modal',
-      name: 'Generate Markdown Flashcards from Context (Legacy Modal)',
-      callback: () => {
-        const modal = new FlashcardGeneratorModal(this.app, this);
-        modal.open();
-      }
+      id: 'migrate-legacy-flashcards',
+      name: 'Migrate Legacy Flashcard Files to Spaced Repetition Database',
+      callback: () => this.migrateLegacyFlashcards(),
     });
 
     this.addCommand({
@@ -1004,6 +1000,99 @@ export default class GptFreeTextGeneratorPlugin extends Plugin {
     }
   }
 
+  /**
+   * One-time migration: scan the legacy flashcard folder for Markdown files
+   * written by the old FlashcardGeneratorModal and import them into the
+   * spaced-repetition database as self_check questions.
+   */
+  private async migrateLegacyFlashcards(): Promise<void> {
+    const flashcardFolder = this.settings.flashcardFolder || 'Flashcards';
+    if (!(await this.app.vault.adapter.exists(flashcardFolder))) {
+      new Notice(`Legacy flashcard folder "${flashcardFolder}" not found. Nothing to migrate.`);
+      return;
+    }
+
+    try {
+      const database = await this.services.ensureSpacedRepetitionDatabase();
+      const noteFolders = await this.app.vault.adapter.list(flashcardFolder);
+      let totalCards = 0;
+      let totalDecks = 0;
+
+      for (const notePath of noteFolders.folders) {
+        const deckFiles = await this.app.vault.adapter.list(notePath);
+        for (const deckPath of deckFiles.files) {
+          if (!deckPath.endsWith('.md')) continue;
+
+          const deckName = deckPath.split('/').pop()!.replace(/\.md$/, '');
+          const studySet = database.getStudySets().find((s) => s.name === deckName);
+          let studySetId = studySet?.id || '';
+          if (!studySetId) {
+            studySetId = await database.createStudySet({
+              name: deckName,
+              sourceType: 'manual',
+              sourceRule: { type: 'legacy-migration' },
+              tags: ['migrated'],
+            });
+          }
+
+          const file = this.app.vault.getAbstractFileByPath(deckPath);
+          if (!(file instanceof TFile)) continue;
+          const content = await this.app.vault.read(file);
+
+          // Parse Question::Answer entries (basic and multiline)
+          const cardRegex = /^(.+?)::((?:(?!^::).)*)/gms;
+          let match;
+          const questions: Array<{
+            noteId: string;
+            studySetId: string;
+            questionName: string | null;
+            questionText: string;
+            questionType: 'self_check';
+            answerText: string;
+            answerCheckMode: 'self';
+            metadata: Record<string, unknown>;
+          }> = [];
+
+          while ((match = cardRegex.exec(content)) !== null) {
+            const qText = match[1]?.trim();
+            const aText = match[2]?.trim();
+            if (!qText || !aText) continue;
+
+            const noteId = await database.upsertNoteFromFile(file, `legacy_${deckName}_${totalCards}`);
+            questions.push({
+              noteId,
+              studySetId,
+              questionName: null,
+              questionText: qText,
+              questionType: 'self_check',
+              answerText: aText,
+              answerCheckMode: 'self',
+              metadata: {
+                createdFrom: 'legacy-migration',
+                originalDeck: deckName,
+                originalFile: deckPath,
+              },
+            });
+            totalCards++;
+          }
+
+          if (questions.length > 0) {
+            await database.createQuestions(questions);
+            totalDecks++;
+          }
+        }
+      }
+
+      new Notice(
+        `Migrated ${totalCards} card(s) from ${totalDecks} legacy deck file(s). ` +
+        `Original Markdown files were left untouched. Review them, then delete the "${flashcardFolder}" directory once confirmed.`
+      );
+    } catch (error) {
+      console.error('Legacy flashcard migration failed:', error);
+      new Notice(`Migration failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
+    }
+  }
+
   onunload() {
     // Clean up services and views
     this.app.workspace.detachLeavesOfType(VIEW_TYPE_GENERATE_TEXT);
diff --git a/src/modals/FlashcardGeneratorModal.ts b/src/modals/FlashcardGeneratorModal.ts
index 57871a1..d8708cc 100644
--- a/src/modals/FlashcardGeneratorModal.ts
+++ b/src/modals/FlashcardGeneratorModal.ts
@@ -1,3 +1,10 @@
+/**
+ * @deprecated Superseded by the database-backed flashcard pipeline (SpacedRepetitionDatabase,
+ * FlashcardGenerationView, SpacedRepetitionManualQuestionModal, SpacedRepetitionCardManagementView).
+ * Kept temporarily so the one-time migration command can still parse files this class's format
+ * produced. Safe to delete once migration tooling is no longer needed by any supported upgrade path.
+ */
+
 /**
  * FlashcardGeneratorModal - Deep Flashcard Generation
  * 
diff --git a/src/utils/FlashcardManager.ts b/src/utils/FlashcardManager.ts
index d411db7..e41c9b0 100644
--- a/src/utils/FlashcardManager.ts
+++ b/src/utils/FlashcardManager.ts
@@ -1,3 +1,10 @@
+/**
+ * @deprecated Superseded by the database-backed flashcard pipeline (SpacedRepetitionDatabase,
+ * FlashcardGenerationView, SpacedRepetitionManualQuestionModal, SpacedRepetitionCardManagementView).
+ * Kept temporarily so the one-time migration command can still parse files this class's format
+ * produced. Safe to delete once migration tooling is no longer needed by any supported upgrade path.
+ */
+
 /**
  * FlashcardManager - Spaced Repetition Flashcard Management
  *
```

