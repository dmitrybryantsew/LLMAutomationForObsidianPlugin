export interface ParsedQuizQuestion {
  id: string;
  number: number;
  questionText: string;
  choices: Array<{ key: string; text: string }>;
  correctAnswerKey: string;
  explanation: string;
  userAnswer?: string;
  isCorrect?: boolean;
}

export interface ParsedQuiz {
  title: string;
  topic: string;
  difficulty: string;
  filePath: string;
  questions: ParsedQuizQuestion[];
  rawContent: string;
}

/**
 * Parses markdown quiz notes into structured quiz objects with questions,
 * multiple-choice options, and answers/explanations from callouts or sections.
 */
export function parseQuizMarkdown(defaultTitle: string, filePath: string, content: string): ParsedQuiz {
  const lines = content.split(/\r?\n/);
  let title = defaultTitle;
  let topic = 'General';
  let difficulty = 'Medium';

  // Parse title or metadata
  const titleMatch = content.match(/^#\s+(.+)$/m);
  if (titleMatch) {
    title = titleMatch[1].trim();
    const metaMatch = title.match(/Quiz:\s*(.+?)(?:\s*\((Easy|Medium|Hard)\))?$/i);
    if (metaMatch) {
      topic = metaMatch[1].trim();
      if (metaMatch[2]) difficulty = metaMatch[2].trim();
    }
  }

  // Locate answers callout or section
  const answersMap = new Map<number, { key: string; explanation: string }>();
  const answerCalloutRegex = />\s*\[!(?:faq|note|info|example|tip)\]-?\s*Answers?/i;
  let inAnswersSection = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (answerCalloutRegex.test(line) || /^##\s*Answers?/i.test(line)) {
      inAnswersSection = true;
      continue;
    }

    if (inAnswersSection) {
      const cleaned = line.replace(/^[>\s*-]+/, '').trim();
      const ansMatch = cleaned.match(/^(\d+)[\.\)]\s*([A-Da-d])[\)\.\:\-]?\s*(.*)$/);
      if (ansMatch) {
        const qNum = parseInt(ansMatch[1], 10);
        answersMap.set(qNum, {
          key: ansMatch[2].toUpperCase(),
          explanation: ansMatch[3]?.trim() || '',
        });
      }
    }
  }

  // Parse questions
  const questions: ParsedQuizQuestion[] = [];
  let currentQ: Partial<ParsedQuizQuestion> | null = null;
  let qNumber = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Stop parsing questions before answers section
    if (answerCalloutRegex.test(line) || /^##\s*Answers?/i.test(line)) {
      if (currentQ && currentQ.questionText) {
        finalizeQuestion(currentQ, questions, answersMap);
        currentQ = null;
      }
      break;
    }

    // Check for question start (e.g. "1. What is..." or "### Question 1: What is...")
    const qStartMatch = line.match(/^(?:###?\s*(?:Question\s*)?)?(\d+)[\.\:]\s*(.+)$/);
    if (qStartMatch && !line.startsWith('>')) {
      if (currentQ && currentQ.questionText) {
        finalizeQuestion(currentQ, questions, answersMap);
      }
      qNumber = parseInt(qStartMatch[1], 10);
      currentQ = {
        id: `q-${qNumber}`,
        number: qNumber,
        questionText: qStartMatch[2].trim(),
        choices: [],
      };
      continue;
    }

    // Check for choice line (e.g. "A) Option" or "- A. Option" or "[A] Option")
    const choiceMatch = line.match(/^[-*]?\s*[\(\[]?([A-Da-d])[\)\.\]\:]\s*(.+)$/);
    if (choiceMatch && currentQ) {
      currentQ.choices = currentQ.choices || [];
      currentQ.choices.push({
        key: choiceMatch[1].toUpperCase(),
        text: choiceMatch[2].trim(),
      });
      continue;
    }

    // Continuation of question text if not a choice
    if (currentQ && line && !line.startsWith('#')) {
      currentQ.questionText += ' ' + line;
    }
  }

  if (currentQ && currentQ.questionText) {
    finalizeQuestion(currentQ, questions, answersMap);
  }

  return {
    title,
    topic,
    difficulty,
    filePath,
    questions,
    rawContent: content,
  };
}

function finalizeQuestion(
  draft: Partial<ParsedQuizQuestion>,
  list: ParsedQuizQuestion[],
  answersMap: Map<number, { key: string; explanation: string }>
): void {
  const num = draft.number || list.length + 1;
  const ansInfo = answersMap.get(num);

  list.push({
    id: draft.id || `q-${num}`,
    number: num,
    questionText: draft.questionText?.trim() || `Question ${num}`,
    choices: draft.choices || [],
    correctAnswerKey: ansInfo?.key || '',
    explanation: ansInfo?.explanation || '',
  });
}
