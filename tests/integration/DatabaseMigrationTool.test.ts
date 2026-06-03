import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DatabaseMigrationTool } from '../../src/utils/DatabaseMigrationTool';
import { DatabaseManager } from '../../src/database/DatabaseManager';
import { mockApp, setupMockVault, resetMocks, addMockFile } from '../mocks/obsidianMock';

describe('DatabaseMigrationTool', () => {
  let migration: DatabaseMigrationTool;
  let mockDatabaseManager: any;

  beforeEach(() => {
    resetMocks();
    setupMockVault();
    
    // Mock database manager
    mockDatabaseManager = {
      getTranscript: vi.fn(),
      saveTranscript: vi.fn(),
      updateTranscript: vi.fn()
    };
    
    migration = new DatabaseMigrationTool(mockApp as any, mockDatabaseManager);
  });

  afterEach(() => {
    resetMocks();
  });

  describe('Test 1: Migrate Single Note to Database', () => {
    it('should successfully migrate a note with embedded transcript', async () => {
      // Setup: Create a note with embedded transcript
      const noteContent = `---
title: Video Title
video_url: https://youtube.com/watch?v=123
author: Channel Name
---

# Video Title

## Tags
#tag1 #tag2

## Summary
This is a summary of the video.

## Full Transcript
<details>
<summary>Click to expand</summary>

This is the transcript content with more than 50 characters to ensure it's detected and migrated properly.
</details>
`;
      const file = addMockFile('Videos/video1.md', noteContent);
      
      // Mock database operations
      mockDatabaseManager.getTranscript.mockResolvedValue(null);
      mockDatabaseManager.saveTranscript.mockResolvedValue(12345);

      // Act: Migrate transcripts
      const result = await migration.migrateAllNotes();

      // Assert: Verify migration
      expect(result.totalProcessed).toBe(1);
      expect(result.successfulMigrations).toBe(1);
      expect(result.failedMigrations).toBe(0);
      expect(result.skippedMigrations).toBe(0);
      
      // Verify database save was called
      expect(mockDatabaseManager.saveTranscript).toHaveBeenCalled();
      const saveCall = mockDatabaseManager.saveTranscript.mock.calls[0][0];
      expect(saveCall.note_path).toBe('Videos/video1.md');
      expect(saveCall.transcript_content).toContain('transcript content');
      expect(saveCall.video_url).toBe('https://youtube.com/watch?v=123');
      expect(saveCall.video_title).toBe('Video Title');
      expect(saveCall.video_channel).toBe('Channel Name');
      
      // Verify note was updated to remove transcript
      expect(file.content).toContain('*Transcript is stored in database');
      expect(file.content).not.toContain('This is the transcript content');
    });
  });

  describe('Test 2: Skip Already Migrated Notes', () => {
    it('should skip notes that are already in database', async () => {
      // Setup: Create a note with embedded transcript
      const noteContent = `# Video Title
## Summary
Summary here.
## Full Transcript
<details><summary>Click to expand</summary>
Transcript content with more than 50 characters to ensure detection.
</details>`;
      addMockFile('Videos/video1.md', noteContent);
      
      // Mock database to return existing record
      mockDatabaseManager.getTranscript.mockResolvedValue({
        id: 123,
        note_title: 'video1',
        note_path: 'Videos/video1.md',
        transcript_content: 'existing transcript'
      });

      // Act: Migrate transcripts
      const result = await migration.migrateAllNotes();

      // Assert: Verify skip
      expect(result.totalProcessed).toBe(1);
      expect(result.skippedMigrations).toBe(1);
      expect(result.successfulMigrations).toBe(0);
      
      // Verify save was not called
      expect(mockDatabaseManager.saveTranscript).not.toHaveBeenCalled();
    });
  });

  describe('Test 3: Handle Migration Failure', () => {
    it('should handle migration errors gracefully', async () => {
      // Setup: Create a note with malformed content (transcript too short)
      const noteContent = `# Video Title
## Summary
Summary here.
## Full Transcript
<details><summary>Click to expand</summary>
Short
</details>`;
      addMockFile('Videos/video1.md', noteContent);
      
      mockDatabaseManager.getTranscript.mockResolvedValue(null);

      // Act: Migrate transcripts
      const result = await migration.migrateAllNotes();

      // Assert: Verify failure handling - short transcripts are not processed
      expect(result.totalProcessed).toBe(0); // Not processed because transcript is too short
      expect(result.failedMigrations).toBe(0);
      expect(result.successfulMigrations).toBe(0);
    });
  });

  describe('Test 4: Batch Migration', () => {
    it('should migrate multiple notes correctly', async () => {
      // Setup: Create multiple notes
      const note1 = `# Video 1
## Summary
Summary 1.
## Full Transcript
<details><summary>Click to expand</summary>
Transcript 1 content with more than 50 characters to ensure detection.
</details>`;
      
      const note2 = `# Video 2
## Summary
Summary 2.
## Full Transcript
<details><summary>Click to expand</summary>
Transcript 2 content with more than 50 characters to ensure detection.
</details>`;
      
      addMockFile('Videos/video1.md', note1);
      addMockFile('Videos/video2.md', note2);
      
      mockDatabaseManager.getTranscript.mockResolvedValue(null);
      mockDatabaseManager.saveTranscript.mockResolvedValue(Date.now());

      // Act: Migrate transcripts
      const result = await migration.migrateAllNotes();

      // Assert: Verify batch migration
      expect(result.totalProcessed).toBe(2);
      expect(result.successfulMigrations).toBe(2);
      expect(result.failedMigrations).toBe(0);
      
      // Verify both notes were saved to database
      expect(mockDatabaseManager.saveTranscript).toHaveBeenCalledTimes(2);
    });
  });

  describe('Test 5: Extract Transcript Data', () => {
    it('should extract transcript and metadata from note', async () => {
      // Setup: Create note with full metadata
      const noteContent = `---
title: My Video Title
video_url: https://youtube.com/watch?v=abc123
author: My Channel
---

# My Video Title

## Summary
Video summary.

## Full Transcript
<details>
<summary>Click to expand</summary>

This is the actual transcript content that should be extracted and saved to the database.
</details>
`;
      addMockFile('Videos/my-video.md', noteContent);
      
      mockDatabaseManager.getTranscript.mockResolvedValue(null);
      mockDatabaseManager.saveTranscript.mockResolvedValue(123);

      // Act: Migrate
      await migration.migrateAllNotes();

      // Assert: Verify extraction
      const saveCall = mockDatabaseManager.saveTranscript.mock.calls[0][0];
      expect(saveCall.note_path).toBe('Videos/my-video.md');
      expect(saveCall.transcript_content).toContain('actual transcript content');
      expect(saveCall.video_url).toBe('https://youtube.com/watch?v=abc123');
      expect(saveCall.video_title).toBe('My Video Title');
      expect(saveCall.video_channel).toBe('My Channel');
    });
  });

  describe('Test 6: Update Note After Migration', () => {
    it('should replace transcript section with database indicator', async () => {
      // Setup: Create note with transcript (must be 50+ chars to be detected)
      const noteContent = `# Video Title
## Summary
Summary here.
## Full Transcript
<details><summary>Click to expand</summary>

This transcript should be removed after migration and replaced with database indicator text.
</details>`;
      const file = addMockFile('Videos/video1.md', noteContent);
      
      mockDatabaseManager.getTranscript.mockResolvedValue(null);
      mockDatabaseManager.saveTranscript.mockResolvedValue(123);

      // Act: Migrate
      await migration.migrateAllNotes();

      // Assert: Verify note update
      expect(file.content).toContain('*Transcript is stored in database');
      expect(file.content).not.toContain('This transcript should be removed');
      expect(file.content).not.toContain('<details>');
    });
  });

  describe('Test 7: Empty Vault', () => {
    it('should handle empty vault without errors', async () => {
      // Act: Migrate empty vault
      const result = await migration.migrateAllNotes();

      // Assert: Verify empty results
      expect(result.totalProcessed).toBe(0);
      expect(result.successfulMigrations).toBe(0);
      expect(result.failedMigrations).toBe(0);
      expect(result.skippedMigrations).toBe(0);
      expect(mockDatabaseManager.saveTranscript).not.toHaveBeenCalled();
    });
  });

  describe('Test 8: Update Existing Record with Description', () => {
    it('should update existing record with description and detailed summaries', async () => {
      // Setup: Create a note with transcript, description, and detailed summaries
      const noteContent = `---
title: Video Title
video_url: https://youtube.com/watch?v=123
author: Channel Name
---

# Video Title

## Summary
This is a summary of the video.

## Full Transcript
<details>
<summary>Click to expand</summary>

This is the transcript content with more than 50 characters to ensure it's detected and migrated properly.
</details>

## Description
<details>
<summary>Click to expand</summary>

This is the video description that should be migrated to the database.
</details>

## Detailed Summaries by Part
<details>
<summary>Part 1</summary>

This is the summary of part 1 of the video.
</details>
<details>
<summary>Part 2</summary>

This is the summary of part 2 of the video.
</details>
`;
      const file = addMockFile('Videos/video1.md', noteContent);
      
      // Mock database to return existing record without description/summaries
      mockDatabaseManager.getTranscript.mockResolvedValue({
        id: 12345,
        note_title: 'video1',
        note_path: 'Videos/video1.md',
        transcript_content: 'existing transcript',
        description: undefined,
        detailed_summaries: undefined
      });
      
      // Mock updateTranscript
      mockDatabaseManager.updateTranscript.mockResolvedValue(true);

      // Act: Migrate notes
      const result = await migration.migrateAllNotes();

      // Assert: Verify update
      expect(result.totalProcessed).toBe(1);
      expect(result.successfulMigrations).toBe(1);
      expect(result.skippedMigrations).toBe(0);
      expect(result.failedMigrations).toBe(0);
      
      // Verify updateTranscript was called
      expect(mockDatabaseManager.updateTranscript).toHaveBeenCalledWith(
        12345,
        expect.objectContaining({
          description: expect.stringContaining('video description'),
          detailed_summaries: expect.arrayContaining([
            expect.stringContaining('part 1'),
            expect.stringContaining('part 2')
          ])
        })
      );
      
      // Verify note was updated to remove description and detailed summaries
      expect(file.content).toContain('*Description is stored in database');
      expect(file.content).toContain('*Detailed summaries are stored in database');
      expect(file.content).not.toContain('This is the video description');
      expect(file.content).not.toContain('This is the summary of part 1');
    });
  });

  describe('Test 9: Skip Fully Migrated Note', () => {
    it('should skip note that already has all content in database', async () => {
      // Setup: Create a note with transcript, description, and detailed summaries
      const noteContent = `# Video Title
## Summary
Summary here.
## Full Transcript
<details><summary>Click to expand</summary>
Transcript content with more than 50 characters to ensure detection.
</details>
## Description
<details><summary>Click to expand</summary>
Description content here.
</details>
## Detailed Summaries by Part
<details><summary>Part 1</summary>
Part 1 summary.
</details>`;
      addMockFile('Videos/video1.md', noteContent);
      
      // Mock database to return existing record with all content
      mockDatabaseManager.getTranscript.mockResolvedValue({
        id: 123,
        note_title: 'video1',
        note_path: 'Videos/video1.md',
        transcript_content: 'existing transcript',
        description: 'existing description',
        detailed_summaries: ['existing summary 1']
      });

      // Act: Migrate notes
      const result = await migration.migrateAllNotes();

      // Assert: Verify skip
      expect(result.totalProcessed).toBe(1);
      expect(result.skippedMigrations).toBe(1);
      expect(result.successfulMigrations).toBe(0);
      
      // Verify save and update were not called
      expect(mockDatabaseManager.saveTranscript).not.toHaveBeenCalled();
      expect(mockDatabaseManager.updateTranscript).not.toHaveBeenCalled();
    });
  });
});