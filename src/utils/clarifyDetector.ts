// ═══════════════════════════════════════════════════════════
// clarifyDetector — Detect clarifying questions in AI responses
//
// Parses assistant messages for question + numbered/bulleted
// options patterns. Returns structured data for ClarifyCard.
//
// Supports Arabic and English patterns.
// ═══════════════════════════════════════════════════════════

export interface ClarifyOption {
  index: number;
  label: string;       // The option text (cleaned)
  raw: string;         // The original line
}

export interface ClarifyQuestion {
  question: string;    // The question text before options
  options: ClarifyOption[];
}

/**
 * Attempt to extract a clarifying question + options from an assistant message.
 * Returns null if no question pattern is detected.
 */
export function detectClarifyQuestion(text: string): ClarifyQuestion | null {
  if (!text || text.length < 20) return null;

  // Strip markdown bold/italic for cleaner parsing
  const clean = text.replace(/\*\*/g, '').replace(/\*/g, '');

  // ── Try to find numbered options: "1. Option" / "1) Option" / "1- Option" ──
  const numberedRegex = /(?:^|\n)\s*(\d+)\s*[.):\-–]\s+(.+)/g;
  const numberedMatches: ClarifyOption[] = [];
  let match: RegExpExecArray | null;

  while ((match = numberedRegex.exec(clean)) !== null) {
    numberedMatches.push({
      index: parseInt(match[1], 10),
      label: match[2].trim(),
      raw: match[0].trim(),
    });
  }

  // Need at least 2 options to consider it a clarifying question
  if (numberedMatches.length >= 2) {
    const question = extractQuestionBefore(clean, numberedMatches[0].raw);
    if (question) {
      return { question, options: numberedMatches };
    }
  }

  // ── Try bulleted options: "- Option" / "• Option" ──
  const bulletRegex = /(?:^|\n)\s*[-•●▪]\s+(.+)/g;
  const bulletMatches: ClarifyOption[] = [];
  let idx = 1;

  while ((match = bulletRegex.exec(clean)) !== null) {
    bulletMatches.push({
      index: idx++,
      label: match[1].trim(),
      raw: match[0].trim(),
    });
  }

  if (bulletMatches.length >= 2) {
    const question = extractQuestionBefore(clean, bulletMatches[0].raw);
    if (question) {
      return { question, options: bulletMatches };
    }
  }

  return null;
}

/**
 * Extract the question text that appears before the first option.
 * Returns null if no question-like text is found.
 */
function extractQuestionBefore(text: string, firstOptionRaw: string): string | null {
  const optionStart = text.indexOf(firstOptionRaw);
  if (optionStart <= 0) return null;

  // Get everything before the options
  let before = text.slice(0, optionStart).trim();

  // Remove trailing colons, dashes
  before = before.replace(/[:\-–]\s*$/, '').trim();

  // Must look like a question — has "?" or common question words
  const questionIndicators = [
    '?', '؟',
    // Arabic
    'تبي', 'تفضل', 'تختار', 'تريد', 'تحب', 'ودك', 'أي ', 'ايش', 'وش',
    'هل ', 'كيف', 'ليش', 'متى', 'وين', 'أيهم', 'موافق',
    // English
    'which', 'what', 'how', 'would', 'do you', 'should', 'prefer',
    'want', 'choose', 'select', 'pick', 'decide', 'option',
  ];

  const lowerBefore = before.toLowerCase();
  const hasQuestion = questionIndicators.some((q) => lowerBefore.includes(q));

  if (!hasQuestion) return null;

  // Take the last paragraph/sentence as the question (skip preamble)
  const paragraphs = before.split(/\n\n+/);
  const lastParagraph = paragraphs[paragraphs.length - 1].trim();

  // Limit question length — if too long, it's probably not a simple question
  if (lastParagraph.length > 500) return null;

  return lastParagraph;
}
