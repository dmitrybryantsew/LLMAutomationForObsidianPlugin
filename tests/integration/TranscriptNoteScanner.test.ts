import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TranscriptNoteScanner } from '../../src/utils/TranscriptNoteScanner';
import { mockApp, setupMockVault, resetMocks, addMockFile } from '../mocks/obsidianMock';

describe('TranscriptNoteScanner', () => {
  let scanner: TranscriptNoteScanner;

  beforeEach(() => {
    resetMocks();
    setupMockVault();
    scanner = new TranscriptNoteScanner(mockApp as any);
  });

  afterEach(() => {
    resetMocks();
  });

  describe('Test 1: Scan Vault with AI-Generated Notes', () => {
    it('should identify notes with embedded transcripts', async () => {
      // Setup: Create a note with embedded transcript
      const noteContent = `# Video Title

## Tags
#tag1 #tag2

## Summary
This is a summary of the video.

## Full Transcript
<details>
<summary>Click to expand</summary>

This is the transcript content with more than 50 characters to ensure it's detected.
</details>
`;
      addMockFile('Videos/video1.md', noteContent);

      // Act: Scan vault
      const result = await scanner.scanVault();

      // Assert: Verify detection
      expect(result.totalNotes).toBe(1);
      expect(result.notesWithTranscript).toBe(1);
      expect(result.notesWithDatabaseTranscript).toBe(0);
      expect(result.notePaths).toContain('Videos/video1.md');
    });
  });

  describe('Test 2: Scan Vault with Database Transcripts', () => {
    it('should identify notes with database-stored transcripts', async () => {
      // Setup: Create a note with database transcript indicator
      const noteContent = `# Video Title

## Tags
#tag1 #tag2

## Summary
This is a summary of the video.

## Transcript
*Transcript is stored in database. Click 'View Transcript' button to view.*
`;
      addMockFile('Videos/video2.md', noteContent);

      // Act: Scan vault
      const result = await scanner.scanVault();

      // Assert: Verify detection
      expect(result.totalNotes).toBe(1);
      expect(result.notesWithTranscript).toBe(0);
      expect(result.notesWithDatabaseTranscript).toBe(1);
      expect(result.notePaths).toContain('Videos/video2.md');
    });
  });

  describe('Test 3: Scan Vault with Standalone Transcript Files', () => {
    it('should identify standalone transcript files (transcript without summary)', async () => {
      // Setup: Create a standalone transcript file
      const transcriptContent = `---
title: Video Title
author: Channel Name
---

# Video Title

## Description
Video description here.

## Transcript
<details>
<summary>Click to expand</summary>

This is the transcript content with more than 50 characters to ensure it's detected.
</details>
`;
      addMockFile('Transcripts/video3.md', transcriptContent);

      // Act: Scan vault
      const result = await scanner.scanVault();

      // Assert: Verify detection
      expect(result.totalNotes).toBe(1);
      expect(result.standaloneTranscriptFiles).toBe(1);
      expect(result.standaloneTranscriptPaths).toContain('Transcripts/video3.md');
    });
  });

  describe('Test 4: Mixed Content Detection', () => {
    it('should correctly categorize mixed note types', async () => {
      // Setup: Create various note types
      const noteWithEmbedded = `# Video 1
## Summary
Summary here.
## Full Transcript
<details><summary>Click to expand</summary>
Transcript content with more than 50 characters to ensure detection.
</details>`;
      
      const noteWithDatabase = `# Video 2
## Summary
Summary here.
## Transcript
*Transcript is stored in database.*`;
      
      const standaloneTranscript = `# Video 3
## Transcript
<details><summary>Click to expand</summary>
Transcript content with more than 50 characters to ensure detection.
</details>`;
      
      const regularNote = `# Regular Note
This is just a regular note without transcripts.`;

      addMockFile('Videos/video1.md', noteWithEmbedded);
      addMockFile('Videos/video2.md', noteWithDatabase);
      addMockFile('Transcripts/video3.md', standaloneTranscript);
      addMockFile('Notes/regular.md', regularNote);

      // Act: Scan vault
      const result = await scanner.scanVault();

      // Assert: Verify correct categorization
      expect(result.totalNotes).toBe(4);
      expect(result.notesWithTranscript).toBe(1);
      expect(result.notesWithDatabaseTranscript).toBe(1);
      expect(result.standaloneTranscriptFiles).toBe(1);
      expect(result.notePaths.length).toBe(2); // Only AI-generated notes
      expect(result.standaloneTranscriptPaths.length).toBe(1);
    });
  });

  describe('Test 5: Empty Vault', () => {
    it('should handle empty vault correctly', async () => {
      // Act: Scan empty vault
      const result = await scanner.scanVault();

      // Assert: Verify empty results
      expect(result.totalNotes).toBe(0);
      expect(result.notesWithTranscript).toBe(0);
      expect(result.notesWithDatabaseTranscript).toBe(0);
      expect(result.standaloneTranscriptFiles).toBe(0);
      expect(result.legacyTranscriptFiles).toBe(0);
      expect(result.notePaths).toEqual([]);
      expect(result.standaloneTranscriptPaths).toEqual([]);
      expect(result.legacyTranscriptPaths).toEqual([]);
    });
  });

  describe('Test 6: Transcript Content Threshold', () => {
    it('should not detect transcript if content is too short (< 50 chars)', async () => {
      // Setup: Create note with short transcript
      const noteContent = `# Video Title
## Summary
Summary here.
## Full Transcript
<details><summary>Click to expand</summary>
Short
</details>`;
      addMockFile('Videos/video1.md', noteContent);

      // Act: Scan vault
      const result = await scanner.scanVault();

      // Assert: Verify not detected as having transcript
      expect(result.totalNotes).toBe(1);
      expect(result.notesWithTranscript).toBe(0);
    });
  });

  describe('Test 7: AI-Generated Note Detection', () => {
    it('should require title, summary, and transcript sections', async () => {
      // Setup: Create note missing summary
      const noteWithoutSummary = `# Video Title
## Full Transcript
<details><summary>Click to expand</summary>
Transcript content with more than 50 characters to ensure detection.
</details>`;
      addMockFile('Videos/video1.md', noteWithoutSummary);

      // Act: Scan vault
      const result = await scanner.scanVault();

      // Assert: Verify not detected as AI-generated
      expect(result.notesWithTranscript).toBe(0);
      expect(result.standaloneTranscriptFiles).toBe(1); // Should be detected as standalone
    });
  });

  describe('Test 8: Legacy Transcript Files Detection', () => {
    it('should detect legacy transcript files from earlier plugin versions', async () => {
      // Setup: Create a legacy transcript file
      const legacyTranscript = `---
title: Legacy Video Title
video_url: https://youtube.com/watch?v=legacy123
author: Legacy Channel
---

# Legacy Transcript

This is a legacy transcript file from an earlier version of the plugin. It has substantial content that should be detected as a legacy transcript file that needs cleanup.
`;
      addMockFile('Transcripts/transcript.md', legacyTranscript);

      // Act: Scan vault
      const result = await scanner.scanVault();

      // Assert: Verify detection
      expect(result.totalNotes).toBe(1);
      expect(result.legacyTranscriptFiles).toBe(1);
      expect(result.legacyTranscriptPaths).toContain('Transcripts/transcript.md');
      expect(result.standaloneTranscriptFiles).toBe(0); // Not standalone because it has summary structure
    });
  });

  describe('Test 9: Legacy Transcript with Different Names', () => {
    it('should detect legacy transcripts with various naming patterns', async () => {
      // Setup: Create legacy transcripts with different names
      const transcript1 = `---
title: Video 1
video_url: https://youtube.com/1
---

# Transcript 1

This is a legacy transcript file from an earlier version of the plugin. It contains substantial content that should be detected as a legacy transcript file that needs cleanup. The content is long enough to meet the 200 character threshold required for detection. This ensures that short files with "transcript" in the name are not falsely identified as legacy transcripts.`;
      
      const transcript2 = `---
title: Video 2
video_url: https://youtube.com/2
---

# My Video Transcript

This is another legacy transcript file from an earlier version of the plugin. It also contains substantial content that should be detected as a legacy transcript file. The content is long enough to meet the 200 character threshold required for detection. This file has a different naming pattern but should still be identified correctly by the scanner.`;

      addMockFile('Old/transcript.md', transcript1);
      addMockFile('Archive/my-video-transcript.md', transcript2);

      // Act: Scan vault
      const result = await scanner.scanVault();

      // Assert: Verify detection
      expect(result.legacyTranscriptFiles).toBe(2);
      expect(result.legacyTranscriptPaths.length).toBe(2);
    });
  });

  describe('Test 10: Non-Transcript Files Ignored', () => {
    it('should not mark regular files as legacy transcripts', async () => {
      // Setup: Create regular files with "transcript" in name but no transcript content
      const regularNote = `# My Notes
This is just a regular note about transcripts but not actually a transcript file.`;
      
      addMockFile('Notes/about-transcripts.md', regularNote);

      // Act: Scan vault
      const result = await scanner.scanVault();

      // Assert: Verify not detected as legacy
      expect(result.legacyTranscriptFiles).toBe(0);
      expect(result.standaloneTranscriptFiles).toBe(0);
    });
  });

  describe('Test 11: All File Types Together', () => {
    it('should correctly categorize all types of transcript files', async () => {
      // Setup: Create all types
      const aiGenerated = `# Video 1
## Summary
Summary.
## Full Transcript
<details><summary>Click to expand</summary>
Transcript content with more than 50 characters to ensure detection.
</details>`;
      
      const databaseStored = `# Video 2
## Summary
Summary.
## Transcript
*Transcript is stored in database.*`;
      
      const standalone = `# Video 3
## Transcript
<details><summary>Click to expand</summary>
Transcript content with more than 50 characters to ensure detection.
</details>`;
      
      const legacy = `---
title: Legacy Video
video_url: https://youtube.com/legacy
---

# Legacy Transcript

This is a legacy transcript file from an earlier version of the plugin with substantial content. The content is long enough to meet the 200 character threshold required for detection. This ensures that the file is correctly identified as a legacy transcript file that needs cleanup. The scanner should correctly categorize this file separately from standalone transcripts.`;

      addMockFile('Videos/video1.md', aiGenerated);
      addMockFile('Videos/video2.md', databaseStored);
      addMockFile('Transcripts/video3.md', standalone);
      addMockFile('Old/transcript.md', legacy);

      // Act: Scan vault
      const result = await scanner.scanVault();

      // Assert: Verify correct categorization
      expect(result.totalNotes).toBe(4);
      expect(result.notesWithTranscript).toBe(1);
      expect(result.notesWithDatabaseTranscript).toBe(1);
      expect(result.standaloneTranscriptFiles).toBe(1);
      expect(result.legacyTranscriptFiles).toBe(1);
      expect(result.notePaths.length).toBe(2);
      expect(result.standaloneTranscriptPaths.length).toBe(1);
      expect(result.legacyTranscriptPaths.length).toBe(1);
    });
  });
});