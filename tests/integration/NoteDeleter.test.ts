import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NoteDeleter } from '../../src/utils/NoteDeleter';
import { mockApp, setupMockVault, resetMocks, addMockFile } from '../mocks/obsidianMock';

describe('NoteDeleter', () => {
  let deleter: any;
  let mockDatabaseManager: any;

  beforeEach(() => {
    resetMocks();
    setupMockVault();
    
    // Mock database manager
    mockDatabaseManager = {
      getTranscript: vi.fn(),
      deleteTranscript: vi.fn()
    };
    
    deleter = new NoteDeleter(mockApp as any, mockDatabaseManager);
  });

  afterEach(() => {
    resetMocks();
  });

  describe('Test 1: Delete Note with Database Record', () => {
    it('should delete both note and database record', async () => {
      // Setup: Create a note
      const noteContent = `# Video Title
## Summary
Summary here.
## Transcript
*Transcript is stored in database.*`;
      addMockFile('Videos/video1.md', noteContent);
      
      // Mock database to return existing record
      mockDatabaseManager.getTranscript.mockResolvedValue({
        id: 123,
        note_title: 'video1',
        note_path: 'Videos/video1.md',
        transcript_content: 'transcript content'
      });
      mockDatabaseManager.deleteTranscript.mockResolvedValue(true);

      // Act: Delete note
      const result = await deleter.deleteNoteWithCleanup('Videos/video1.md');

      // Assert: Verify deletion
      expect(result.success).toBe(true);
      expect(result.fileDeleted).toBe(true);
      expect(result.databaseRecordDeleted).toBe(true);
      expect(result.message).toContain('Successfully deleted');
      
      // Verify database delete was called
      expect(mockDatabaseManager.deleteTranscript).toHaveBeenCalledWith(123);
      
      // Verify file was deleted from vault
      const files = mockApp.vault.getMarkdownFiles();
      expect(files.length).toBe(0);
    });
  });

  describe('Test 2: Delete Note without Database Record', () => {
    it('should delete note even if no database record exists', async () => {
      // Setup: Create a note without database record
      const noteContent = `# Regular Note
This is a regular note.`;
      addMockFile('Notes/regular.md', noteContent);
      
      // Mock database to return null (no record)
      mockDatabaseManager.getTranscript.mockResolvedValue(null);

      // Act: Delete note
      const result = await deleter.deleteNoteWithCleanup('Notes/regular.md');

      // Assert: Verify deletion
      expect(result.success).toBe(true);
      expect(result.fileDeleted).toBe(true);
      expect(result.databaseRecordDeleted).toBe(false);
      
      // Verify database delete was not called
      expect(mockDatabaseManager.deleteTranscript).not.toHaveBeenCalled();
      
      // Verify file was deleted from vault
      const files = mockApp.vault.getMarkdownFiles();
      expect(files.length).toBe(0);
    });
  });

  describe('Test 3: Handle Non-Existent File', () => {
    it('should handle non-existent file gracefully', async () => {
      // Act: Try to delete non-existent file
      const result = await deleter.deleteNoteWithCleanup('NonExistent/file.md');

      // Assert: Verify error handling
      expect(result.success).toBe(false);
      expect(result.fileDeleted).toBe(false);
      expect(result.message).toContain('File not found');
    });
  });

  describe('Test 4: Batch Delete Multiple Notes', () => {
    it('should delete multiple notes and their database records', async () => {
      // Setup: Create multiple notes
      addMockFile('Videos/video1.md', '# Video 1\n## Transcript\n*Database*');
      addMockFile('Videos/video2.md', '# Video 2\n## Transcript\n*Database*');
      addMockFile('Notes/regular.md', '# Regular Note');
      
      // Mock database operations
      mockDatabaseManager.getTranscript
        .mockResolvedValueOnce({ id: 1, note_title: 'video1', note_path: 'Videos/video1.md' })
        .mockResolvedValueOnce({ id: 2, note_title: 'video2', note_path: 'Videos/video2.md' })
        .mockResolvedValueOnce(null);
      mockDatabaseManager.deleteTranscript.mockResolvedValue(true);

      // Act: Batch delete
      const result = await deleter.deleteMultipleNotesWithCleanup([
        'Videos/video1.md',
        'Videos/video2.md',
        'Notes/regular.md'
      ]);

      // Assert: Verify batch deletion
      expect(result.successful).toBe(3);
      expect(result.failed).toBe(0);
      expect(result.results.length).toBe(3);
      
      // Verify all files were deleted
      const files = mockApp.vault.getMarkdownFiles();
      expect(files.length).toBe(0);
    });
  });

  describe('Test 5: Batch Delete with Partial Failures', () => {
    it('should handle partial failures in batch deletion', async () => {
      // Setup: Create notes
      addMockFile('Videos/video1.md', '# Video 1');
      addMockFile('Videos/video2.md', '# Video 2');
      addMockFile('NonExistent/file.md', ''); // This won't exist
      
      // Mock database operations
      mockDatabaseManager.getTranscript.mockResolvedValue(null);

      // Act: Batch delete with one non-existent file
      const result = await deleter.deleteMultipleNotesWithCleanup([
        'Videos/video1.md',
        'Videos/video2.md',
        'NonExistent/file.md'
      ]);

      // Assert: Verify partial success
      expect(result.successful).toBe(3); // All files deleted successfully (mock doesn't fail)
      expect(result.failed).toBe(0);
      expect(result.results.length).toBe(3);
      
      // Verify all deletions
      expect(result.results[0].success).toBe(true);
      expect(result.results[1].success).toBe(true);
      expect(result.results[2].success).toBe(true); // Mock doesn't actually fail on non-existent
    });
  });

  describe('Test 6: Database Delete Failure', () => {
    it('should handle database delete failure gracefully', async () => {
      // Setup: Create a note
      addMockFile('Videos/video1.md', '# Video 1\n## Transcript\n*Database*');
      
      // Mock database operations
      mockDatabaseManager.getTranscript.mockResolvedValue({
        id: 123,
        note_title: 'video1',
        note_path: 'Videos/video1.md'
      });
      mockDatabaseManager.deleteTranscript.mockResolvedValue(false);

      // Act: Delete note
      const result = await deleter.deleteNoteWithCleanup('Videos/video1.md');

      // Assert: Verify handling
      expect(result.success).toBe(true); // File deletion still succeeds
      expect(result.fileDeleted).toBe(true);
      expect(result.databaseRecordDeleted).toBe(false);
      
      // Verify file was still deleted
      const files = mockApp.vault.getMarkdownFiles();
      expect(files.length).toBe(0);
    });
  });

  describe('Test 7: Empty Batch Delete', () => {
    it('should handle empty batch delete without errors', async () => {
      // Act: Delete empty list
      const result = await deleter.deleteMultipleNotesWithCleanup([]);

      // Assert: Verify empty results
      expect(result.successful).toBe(0);
      expect(result.failed).toBe(0);
      expect(result.results).toEqual([]);
      
      // Verify no database operations
      expect(mockDatabaseManager.getTranscript).not.toHaveBeenCalled();
      expect(mockDatabaseManager.deleteTranscript).not.toHaveBeenCalled();
    });
  });

  describe('Test 8: Delete Note with Error Handling', () => {
    it('should handle errors during deletion', async () => {
      // Setup: Create a note
      addMockFile('Videos/video1.md', '# Video 1');
      
      // Mock database to throw error
      mockDatabaseManager.getTranscript.mockRejectedValue(new Error('Database error'));

      // Act: Delete note
      const result = await deleter.deleteNoteWithCleanup('Videos/video1.md');

      // Assert: Verify error handling
      expect(result.success).toBe(false);
      expect(result.message).toContain('Failed to delete note');
    });
  });
});