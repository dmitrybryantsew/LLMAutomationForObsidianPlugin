# Backup System Manual Test Cases

## Overview
This document contains manual test cases for verifying the backup and recovery functionality in the GPT4Free Text Generator Plugin.

**IMPORTANT:** Tests 1-14 are now fully automated. See [`tests/integration/TagManager.test.ts`](../integration/TagManager.test.ts) and [`tests/integration/PathManager.test.ts`](../integration/PathManager.test.ts) for automated test implementations.

Only tests 15-18 (edge cases) require manual testing in a real Obsidian environment.

## Prerequisites
- Obsidian installed with the plugin loaded
- Plugin is enabled and working
- Access to the vault file system
- Ability to view/edit JSON files

---

## Automated Tests (Reference Only)

The following tests are fully automated and can be run with `npm test`:

### TagManager Automated Tests
- **Test 1:** Backup Creation - Verifies backup is created when tags are saved
- **Test 2:** Backup Rotation - Verifies only 3 most recent backups are kept
- **Test 3:** Restore from Backup - Verifies tags can be restored from backup
- **Test 4:** Auto-Recovery - Verifies automatic recovery from corrupted file
- **Test 5:** Validation - Verifies invalid data is rejected before saving
- **Test 6:** Atomic Writes - Verifies atomic write pattern is used
- **Test 7:** Tag Normalization - Verifies tags are normalized correctly
- **Test 14:** Get Available Backups - Verifies backups are listed and sorted

### PathManager Automated Tests
- **Test 8:** Backup Creation - Verifies backup is created when structure is saved
- **Test 9:** Backup Rotation - Verifies only 3 most recent backups are kept
- **Test 10:** Restore from Backup - Verifies structure can be restored from backup
- **Test 11:** Auto-Recovery - Verifies automatic recovery from corrupted file
- **Test 12:** Validation - Verifies invalid data is rejected before saving
- **Test 13:** Atomic Writes - Verifies atomic write pattern is used
- **Test 14:** Get Available Backups - Verifies backups are listed and sorted

---

## Manual Test Cases (Edge Cases Only)

### Test 15: Empty Backup Folder
**Objective:** Verify behavior when no backups exist.

**Steps:**
1. Open Obsidian and ensure plugin is loaded
2. Navigate to `Paths/tags_backups/` and `Paths/backups/`
3. Delete all backup files
4. Corrupt the main files (`custom_tags.json` and `path_structure.json`)
5. Reload the plugin
6. Observe the behavior

**Expected Results:**
- Plugin detects corrupted files
- No backups available for recovery
- Plugin starts with empty/default structure
- Appropriate error message logged to console
- No crash or undefined behavior

**Pass/Fail:** ☐ Pass / ☐ Fail

**Notes:** This test is difficult to mock reliably as it tests real file system behavior when backups are missing.

---

### Test 16: Backup Folder Missing
**Objective:** Verify behavior when backup folder doesn't exist.

**Steps:**
1. Open Obsidian and ensure plugin is loaded
2. Delete `Paths/tags_backups/` and `Paths/backups/` folders
3. Trigger a save operation (add tags or structure items)
4. Verify the backup folders are recreated

**Expected Results:**
- Backup folders are automatically created
- Save operation succeeds
- Backup file is created in the new folder
- No error occurs

**Pass/Fail:** ☐ Pass / ☐ Fail

**Notes:** This tests real file system folder creation behavior which is difficult to mock accurately.

---

### Test 17: Concurrent Saves
**Objective:** Verify behavior when multiple save operations occur simultaneously.

**Steps:**
1. Open Obsidian and ensure plugin is loaded
2. Quickly trigger multiple save operations (add tags rapidly or create multiple structure items)
3. Monitor the backup folder
4. Check the main files for corruption

**Expected Results:**
- All saves complete successfully
- Backups are created for each save
- No file corruption occurs
- Atomic writes prevent race conditions

**Pass/Fail:** ☐ Pass / ☐ Fail

**Notes:** This tests real-world concurrent file access patterns which are difficult to simulate in a mocked environment.

---

### Test 18: Large Data Sets
**Objective:** Verify performance with large amounts of data.

**Steps:**
1. Open Obsidian and ensure plugin is loaded
2. Generate content to create 100+ tags
3. Add multiple domains with deep hierarchies (subjects, topics, series, authors, content)
4. Trigger save operations
5. Measure the time taken for:
   - Backup creation
   - Save operation
   - Restore operation

**Expected Results:**
- Operations complete in reasonable time (< 5 seconds)
- No performance degradation
- Backups are created successfully
- All data is preserved

**Pass/Fail:** ☐ Pass / ☐ Fail

**Notes:** This tests real-world performance with large datasets which requires actual Obsidian environment.

---

## Running Automated Tests

### Install Dependencies
```bash
npm install
```

### Run All Tests
```bash
npm test
```

### Run Tests with UI
```bash
npm run test:ui
```

### Run Tests with Coverage
```bash
npm run test:coverage
```

---

## Test Results Summary

| Test ID | Test Name | Type | Status | Notes |
|---------|-----------|------|--------|-------|
| 1 | Backup Creation (Tags) | Automated | ☐ | Run with `npm test` |
| 2 | Backup Rotation (Tags) | Automated | ☐ | Run with `npm test` |
| 3 | Restore from Backup (Tags) | Automated | ☐ | Run with `npm test` |
| 4 | Auto-Recovery (Tags) | Automated | ☐ | Run with `npm test` |
| 5 | Validation (Tags) | Automated | ☐ | Run with `npm test` |
| 6 | Atomic Writes (Tags) | Automated | ☐ | Run with `npm test` |
| 7 | Tag Normalization | Automated | ☐ | Run with `npm test` |
| 8 | Backup Creation (Paths) | Automated | ☐ | Run with `npm test` |
| 9 | Backup Rotation (Paths) | Automated | ☐ | Run with `npm test` |
| 10 | Restore from Backup (Paths) | Automated | ☐ | Run with `npm test` |
| 11 | Auto-Recovery (Paths) | Automated | ☐ | Run with `npm test` |
| 12 | Validation (Paths) | Automated | ☐ | Run with `npm test` |
| 13 | Atomic Writes (Paths) | Automated | ☐ | Run with `npm test` |
| 14 | Get Available Backups | Automated | ☐ | Run with `npm test` |
| 15 | Empty Backup Folder | Manual | ☐ | See test details above |
| 16 | Backup Folder Missing | Manual | ☐ | See test details above |
| 17 | Concurrent Saves | Manual | ☐ | See test details above |
| 18 | Large Data Sets | Manual | ☐ | See test details above |

**Overall Automated Pass/Fail:** ☐ Pass / ☐ Fail
**Overall Manual Pass/Fail:** ☐ Pass / ☐ Fail

**Tester:** ___________________
**Date:** ___________________
**Environment:** ___________________
**Obsidian Version:** ___________________
**Plugin Version:** ___________________