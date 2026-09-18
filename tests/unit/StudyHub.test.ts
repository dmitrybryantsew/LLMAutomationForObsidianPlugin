import { describe, expect, it } from 'vitest';
import { PLUGIN_COMMAND_CATALOG, renderCommandCheatsheet } from '../../src/commandCatalog';
import { VIEW_TYPE_STUDY_HUB, VIEW_TYPE_QUIZ_HUB } from '../../src/constants';

describe('StudyHub and Command Catalog', () => {
  it('registers open-study-hub, open-quiz-hub, toggle-study-focus, and toggle-coding-focus commands in catalog', () => {
    const studyHubCmd = PLUGIN_COMMAND_CATALOG.find((c) => c.id === 'open-study-hub');
    const quizHubCmd = PLUGIN_COMMAND_CATALOG.find((c) => c.id === 'open-quiz-hub');
    const toggleFocusCmd = PLUGIN_COMMAND_CATALOG.find((c) => c.id === 'toggle-study-focus');
    const toggleCodingFocusCmd = PLUGIN_COMMAND_CATALOG.find((c) => c.id === 'toggle-coding-focus');

    expect(studyHubCmd).toBeDefined();
    expect(studyHubCmd?.name).toBe('Open Study Hub');
    expect(studyHubCmd?.group).toBe('Learning');

    expect(quizHubCmd).toBeDefined();
    expect(quizHubCmd?.name).toBe('Open Quiz Hub');
    expect(quizHubCmd?.group).toBe('Learning');

    expect(toggleFocusCmd).toBeDefined();
    expect(toggleFocusCmd?.name).toBe('Toggle Study Hub Focus Mode');
    expect(toggleFocusCmd?.group).toBe('Learning');

    expect(toggleCodingFocusCmd).toBeDefined();
    expect(toggleCodingFocusCmd?.name).toBe('Toggle Coding Practice Focus Mode');
    expect(toggleCodingFocusCmd?.group).toBe('Learning');
  });

  it('includes new study commands in rendered cheatsheet note', () => {
    const cheatsheet = renderCommandCheatsheet();

    expect(cheatsheet).toContain('`open-study-hub`');
    expect(cheatsheet).toContain('`open-quiz-hub`');
    expect(cheatsheet).toContain('`toggle-study-focus`');
    expect(cheatsheet).toContain('`toggle-coding-focus`');
    expect(cheatsheet).toContain('Open Study Hub');
    expect(cheatsheet).toContain('Open Quiz Hub');
    expect(cheatsheet).toContain('Toggle Study Hub Focus Mode');
    expect(cheatsheet).toContain('Toggle Coding Practice Focus Mode');
  });

  it('defines correct view type identifiers', () => {
    expect(VIEW_TYPE_STUDY_HUB).toBe('llm-automation-study-hub');
    expect(VIEW_TYPE_QUIZ_HUB).toBe('llm-automation-quiz-hub');
  });
});
