import { describe, it, expect } from 'vitest';
import {
  cleanTranscriptForAi,
  budgetTranscriptForPrompt,
  buildTransformPrompt,
  isQuoteGroundedInTranscript,
  postProcessTransformOutput,
} from '../server/utils/aiTransform';

const OBJECTIVISM_RAW = `objectivism it’s a guide To Living here developed by this writer wondering who needs a philosophy she answered that to deal with real life we need a view of the world and our place in it now some people have strong opinions on [Music] objectivism it’s a philosophy that’s controversial because it Advocates self nness and says altruism is evil but we’ll get back to that rand’s philosophy looks something like this it starts with the idea that reality is objective the universe is what it is not what we want it to be and wishing otherwise won’t make it so next it states that our reason is all we have and all we need for understanding the world around us and if reason is an absolute you can’t accept contradictions it also says your highest moral purpose should be the pursuit of your own selfish [Music] happiness now selfishness can be misinterpreted it doesn’t mean exploit others for your own gain it means realize your Highest Potential by pursuing rational ends and live in harmony with others by respecting their right to their own life and happiness the result of this philosophy is a life of Reason purpose self-esteem a philosophy for living on Earth if you know that this life is all that you have would you make the most of it?`;

describe('aiTransform utilities', () => {
  it('strips [Music] and non-speech caption noise cleanly', () => {
    const { cleanedText, wordCount } = cleanTranscriptForAi(OBJECTIVISM_RAW);
    expect(cleanedText).not.toContain('[Music]');
    expect(cleanedText).toContain('strong opinions on objectivism');
    expect(cleanedText).toContain('your own selfish happiness');
    expect(wordCount).toBeGreaterThan(180);
    expect(wordCount).toBeLessThan(230);
  });

  it('preserves head, middle, and conclusion when budgeting long transcripts', () => {
    const intro = 'INTRO_MARKER ' + 'alpha '.repeat(400);
    const middle = 'MIDDLE_MARKER ' + 'beta '.repeat(400);
    const ending = 'gamma '.repeat(400) + 'CONCLUSION_MARKER';
    const longTranscript = `${intro}${middle}${ending}`;

    const budgeted = budgetTranscriptForPrompt(longTranscript, 1200);
    expect(budgeted.truncated).toBe(true);
    expect(budgeted.text.length).toBeLessThanOrEqual(1200);
    expect(budgeted.text).toContain('INTRO_MARKER');
    expect(budgeted.text).toContain('CONCLUSION_MARKER');
  });

  it('scales prompt constraints and temperatures appropriately by mode and word count', () => {
    const summarySpec = buildTransformPrompt('summary', 'Ayn Rand - Objectivism', 'sample text', 190);
    expect(summarySpec.temperature).toBe(0.15);
    expect(summarySpec.maxTokens).toBe(450);
    expect(summarySpec.messages[0].content).toContain('CLOSED-BOOK SOURCE');
    expect(summarySpec.messages[1].content).toContain('4 to 5');

    const notesSpec = buildTransformPrompt('notes', 'Ayn Rand - Objectivism', 'sample text', 190);
    expect(notesSpec.temperature).toBe(0.1);
    expect(notesSpec.messages[1].content).toContain('Self-Test Questions');
  });

  it('verifies grounded verbatim quotes while rejecting fabricated quotes', () => {
    const { cleanedText } = cleanTranscriptForAi(OBJECTIVISM_RAW);

    expect(
      isQuoteGroundedInTranscript(
        'If you know that this life is all that you have, would you make the most of it?',
        cleanedText
      )
    ).toBe(true);

    // Tolerates 1-word ASR repair ("self nness" -> "selfishness")
    expect(
      isQuoteGroundedInTranscript(
        'It is a philosophy that is controversial because it advocates selfishness and says altruism is evil.',
        cleanedText
      )
    ).toBe(true);

    // Rejects invented external definition
    expect(
      isQuoteGroundedInTranscript(
        'Sacrificing your own interests for the benefit of others is morally unjustifiable.',
        cleanedText
      )
    ).toBe(false);
  });

  it('post-processes script stage directions and strips ungrounded quotes from notes', () => {
    const { cleanedText } = cleanTranscriptForAi(OBJECTIVISM_RAW);

    const rawScript = `**HOOK (0-3s)**
(Upbeat background music starts playing.)
Narrator: "What if everything you were taught about altruism being noble is backwards?"

**BODY (3-42s)**
(Cut to animated graphics)
• Reality is objective, not wishful thinking.`;

    const cleanScript = postProcessTransformOutput(rawScript, 'script', cleanedText);
    expect(cleanScript).not.toContain('**');
    expect(cleanScript).not.toContain('(Upbeat background music');
    expect(cleanScript).not.toContain('(Cut to animated');
    expect(cleanScript).not.toContain('Narrator:');
    expect(cleanScript).not.toContain('• ');
    expect(cleanScript).toContain('What if everything you were taught');

    const rawNotes = `Core Topic
Ayn Rand's Objectivism

Verbatim Quotes
• "If reason is an absolute, you can't accept contradictions."
• "Sacrificing your personal freedom for the collective good destroys human spirit."

Self-Test Questions
• Q: What is reality?
  A: Objective.`;

    const cleanNotes = postProcessTransformOutput(rawNotes, 'notes', cleanedText);
    expect(cleanNotes).toContain("If reason is an absolute, you can't accept contradictions.");
    expect(cleanNotes).not.toContain('Sacrificing your personal freedom');
  });
});

