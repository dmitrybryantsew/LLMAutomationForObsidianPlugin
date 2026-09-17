import { describe, expect, it } from 'vitest';
import { PLUGIN_COMMAND_CATALOG, renderCommandCheatsheet } from '../../src/commandCatalog';
import { VIEW_TYPE_STUDY_HUB, VIEW_TYPE_QUIZ_HUB } from '../../src/constants';

describe('StudyHub and Command Catalog', () => {
  it('registers open-study-hub and open-quiz-hub commands in catalog', () => {
    const studyHubCmd = PLUGIN_COMMAND_CATALOG.find((c) => c.id === 'open-study-hub');
    const quizHubCmd = PLUGIN_COMMAND_CATALOG.find((c) => c.id === 'open-quiz-hub');

    expect(studyHubCmd).toBeDefined();
    expect(studyHubCmd?.name).toBe('Open Study Hub');
    expect(studyHubCmd?.group).toBe('Learning');

    expect(quizHubCmd).toBeDefined();
    expect(quizHubCmd?.name).toBe('Open Quiz Hub');
    expect(quizHubCmd?.group).toBe('Learning');
  });

  it('includes new study commands in rendered cheatsheet note', () => {
    const cheatsheet = renderCommandCheatsheet();

    expect(cheatsheet).toContain('`open-study-hub`');
    expect(cheatsheet).toContain('`open-quiz-hub`');
    expect(cheatsheet).toContain('Open Study Hub');
    expect(cheatsheet).toContain('Open Quiz Hub');
  });

  it('defines correct view type identifiers', () => {
    expect(VIEW_TYPE_STUDY_HUB).toBe('llm-automation-study-hub');
    expect(VIEW_TYPE_QUIZ_HUB).toBe('llm-automation-quiz-hub');
  });
});
