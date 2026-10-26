import { describe, it, expect, vi } from 'vitest';
import app from '../server/index';
import {
  cleanTranscriptForAi,
  budgetTranscriptForPrompt,
  buildTransformPrompt,
  verifyQuoteAgainstTranscript,
  postProcessTransformOutput,
  validateTransformOutput,
  executeBoundedAiChat,
  MAX_TRANSCRIPT_INPUT_CHARS,
} from '../server/utils/aiTransform';
import {
  buildTranscriptScopeKey,
  createScopedResultCache,
} from '../utils/transformCache';

describe('1. Transcript cleaning, timeline preservation, and budgeting', () => {
  it('removes stage artifacts safely while preserving word order, speaker labels, code, and [inaudible]', () => {
    const raw =
      'Host: Welcome back [Music] [Background music] everyone! Guest: Thanks (applause) ♪ in 2024 arr[0] was [inaudible] during testing [Laughter].';
    const res = cleanTranscriptForAi(raw);

    expect(res.cleanedText).toBe(
      'Host: Welcome back everyone! Guest: Thanks in 2024 arr[0] was [inaudible] during testing .'
    );
    expect(res.cleanedText).toContain('Host:');
    expect(res.cleanedText).toContain('Guest:');
    expect(res.cleanedText).toContain('[inaudible]');
    expect(res.cleanedText).toContain('arr[0]');
    expect(res.cleanedText).not.toMatch(/music|applause|laughter|♪/i);
  });

  it('handles empty inputs and malformed segments predictably while preserving valid ~30s timestamps', () => {
    expect(cleanTranscriptForAi('').wordCount).toBe(0);
    expect(cleanTranscriptForAi('[Music] [Applause] ♪').wordCount).toBe(0);

    const malformedSegments = [
      null,
      'bad',
      { start: -5, text: 12345 },
      { start: 0, text: 'Host: First opening claim here.' },
      { start: 12, text: '[Music] Supporting detail immediately after.' },
      { start: 35, text: 'Guest: Second major timestamped point.' },
    ];
    const plain =
      'Host: First opening claim here. Supporting detail immediately after. Guest: Second major timestamped point.';

    const cleaned = cleanTranscriptForAi(plain, malformedSegments);
    expect(cleaned.hasTimestamps).toBe(true);
    expect(cleaned.timelineText).toContain('[00:00] Host: First opening claim here.');
    expect(cleaned.timelineText).toContain('[00:35] Guest: Second major timestamped point.');
    expect(cleaned.cleanedText).not.toContain('[00:00]');
  });

  it('retains beginning, middle, and conclusion on long transcripts and marks truncation explicitly', () => {
    const head = 'BEGINNING_THESIS ' + 'alpha '.repeat(450);
    const mid = 'MIDDLE_EVIDENCE ' + 'beta '.repeat(450);
    const tail = 'gamma '.repeat(450) + 'FINAL_CONCLUSION';
    const longText = `${head}${mid}${tail}`;

    const budgeted = budgetTranscriptForPrompt(longText, 1200);
    expect(budgeted.truncated).toBe(true);
    expect(budgeted.omittedChars).toBeGreaterThan(0);
    expect(budgeted.text).toContain('BEGINNING_THESIS');
    expect(budgeted.text).toContain('FINAL_CONCLUSION');
    expect(budgeted.text).toContain('[... OMITTED TRANSCRIPT SECTION ...]');
    // Middle section around midpoint is retained
    expect(budgeted.text).toContain('beta');
  });
});

describe('2. Domain-general prompts, proportional scaling, and stance/uncertainty rules', () => {
  it('scales output targets proportionally for very short, short, and long transcripts without overfitting', () => {
    const veryShortSummary = buildTransformPrompt(
      'summary',
      'Rust Borrow Checker Basics',
      'Rust checks lifetimes at compile time so dangling pointers fail before runtime.',
      45,
      false
    );
    expect(veryShortSummary.temperature).toBe(0.15);
    expect(veryShortSummary.messages[1].content).toContain('2 to 3 bullet points');
    // Must remain strictly domain-general (no hardcoded philosophy examples)
    expect(veryShortSummary.messages[0].content.toLowerCase()).not.toContain('rand');
    expect(veryShortSummary.messages[0].content.toLowerCase()).not.toContain('altruism');
    expect(veryShortSummary.messages[0].content.toLowerCase()).not.toContain('objectivism');

    const truncatedLongBlog = buildTransformPrompt(
      'blog',
      'Deep Systems Lecture',
      'Sampled excerpt text',
      4200,
      true
    );
    expect(truncatedLongBlog.messages[1].content).toContain('SOURCE LIMITATION');
    expect(truncatedLongBlog.messages[1].content).toContain('450 to 650 words');
  });
});

describe('3. Contiguous quotation verification (negation, qualifiers, punctuation, multilingual, invented words)', () => {
  const source =
    "Dr. Rivera argues that intermittent fasting isn't magic; it doesn't melt fat if total calories stay excessive. Critics falsely claim fasting destroys muscle overnight. In reality, moderate protein intake preserves lean mass—even during 16-hour fasts! In ambiguous cases, results remain [inaudible] and uncertain. Advokates self nness in raw captions.";

  it('accepts exact contiguous passages despite capitalization and harmless punctuation differences', () => {
    expect(
      verifyQuoteAgainstTranscript(
        'Moderate protein intake preserves lean mass, even during 16-hour fasts.',
        source
      )
    ).toBe(true);

    expect(
      verifyQuoteAgainstTranscript(
        "Dr. Rivera argues that intermittent fasting isn't magic",
        source
      )
    ).toBe(true);
  });

  it('rejects changed or inverted negation inside a quotation', () => {
    // "isn't" changed to "is"
    expect(
      verifyQuoteAgainstTranscript(
        'Dr. Rivera argues that intermittent fasting is magic',
        source
      )
    ).toBe(false);

    // "doesn't" changed to "does"
    expect(
      verifyQuoteAgainstTranscript(
        'it does melt fat if total calories stay excessive',
        source
      )
    ).toBe(false);
  });

  it('rejects quotations that clip off an immediately governing negation, conditional, or critic attribution', () => {
    // Clipped after "doesn't"
    expect(
      verifyQuoteAgainstTranscript('melt fat if total calories stay excessive', source)
    ).toBe(false);

    // Clipped after "Critics falsely claim"
    expect(
      verifyQuoteAgainstTranscript('fasting destroys muscle overnight', source)
    ).toBe(false);

    // Clipped right after conditional "if"
    expect(
      verifyQuoteAgainstTranscript('total calories stay excessive', source)
    ).toBe(false);
  });

  it('rejects omitted middle qualifiers, invented words, and silent ASR word rewrites', () => {
    // Omitted middle words ("preserves lean mass" -> skipped "moderate protein intake")
    expect(
      verifyQuoteAgainstTranscript('In reality, preserves lean mass during fasts', source)
    ).toBe(false);

    // Invented word ("clinically")
    expect(
      verifyQuoteAgainstTranscript('moderate protein intake clinically preserves lean mass', source)
    ).toBe(false);

    // Silently repaired ASR ("self nness" -> "selfishness") must NOT pass as an exact verbatim quote
    expect(
      verifyQuoteAgainstTranscript('Advocates selfishness in raw captions', source)
    ).toBe(false);
  });

  it('preserves and verifies multilingual quotations (Spanish & Arabic)', () => {
    const multilingualSource =
      'La ciencia demuestra que la energía solar reduce costos a largo plazo. المعرفة أساس التقدم العلمي في المجتمع الحديث.';
    expect(
      verifyQuoteAgainstTranscript(
        'la energía solar reduce costos a largo plazo',
        multilingualSource
      )
    ).toBe(true);
    expect(
      verifyQuoteAgainstTranscript(
        'المعرفة أساس التقدم العلمي في المجتمع الحديث',
        multilingualSource
      )
    ).toBe(true);
  });
});

describe('4 & 5. Post-processing safety and output validation across modes', () => {
  it('preserves code exponentiation, comments, and multilingual text while cleaning Markdown prose', () => {
    const rawBlog = `Here is the article:\n\n**Fast Exponentiation in Python**\n\nIn Python, compute powers using 2 ** 3 ** 2 directly:\n\`\`\`python\n# Keep comment intact\nresult = 2 ** 3 ** 2\n\`\`\`\n\n### Conclusión Práctica\nFunciona muy rápido.`;

    const out = postProcessTransformOutput(rawBlog, 'blog', 'source');
    expect(out).not.toContain('Here is the article:');
    expect(out).toContain('Fast Exponentiation in Python');
    expect(out).toContain('2 ** 3 ** 2 directly');
    expect(out).toContain('# Keep comment intact\nresult = 2 ** 3 ** 2');
    expect(out).toContain('Conclusión Práctica');
  });

  it('strips screenplay cues in script mode without deleting genuine spoken parentheticals', () => {
    const rawScript = `HOOK\n(Upbeat music starts playing)\nNarrator: "Did you know most batteries lose capacity from heat (not charge cycles)?"\n\nBODY\n(Cut to split-screen graphic)\n• Keep lithium cells cool to double lifespan.\n\nCTA\nHow hot does your phone get while charging?`;

    const out = postProcessTransformOutput(rawScript, 'script', 'source');
    expect(out).not.toContain('(Upbeat music');
    expect(out).not.toContain('(Cut to split-screen');
    expect(out).not.toContain('Narrator:');
    expect(out).not.toContain('• ');
    expect(out).toContain('(not charge cycles)');
    expect(validateTransformOutput(out, 'script', 120).valid).toBe(true);
  });

  it('omits unverified quotes in notes mode and inserts honest fallback notice if none verify', () => {
    const src = ' compilers translate high level source code into machine instructions efficiently ';
    const rawNotes = `Core Topic\nCompiler fundamentals.\n\nKey Concepts & Definitions\n• Compiler: Translates high-level source code into machine instructions.\n\nExact Quotations\n• "Compilers magically optimize every slow algorithm automatically."\n\nComprehension Questions\n• Q: What does a compiler translate?\n  A: High-level source code into machine instructions.`;

    const out = postProcessTransformOutput(rawNotes, 'notes', src, {
      truncated: true,
      wordCount: 3500,
    });
    expect(out).not.toContain('magically optimize');
    expect(out).toContain('None verified word-for-word from transcript');
    expect(out).toContain(
      '[Note: Generated from beginning, middle, and conclusion excerpts of a long 3,500-word transcript.]'
    );
    expect(validateTransformOutput(out, 'notes', 3500).valid).toBe(true);
  });

  it('rejects empty, refusal, or structurally broken outputs during validation', () => {
    expect(validateTransformOutput('', 'summary', 100).valid).toBe(false);
    expect(validateTransformOutput('Too short', 'blog', 100).valid).toBe(false);
    expect(
      validateTransformOutput(
        'As an AI language model, I cannot fulfill this request.',
        'summary',
        100
      ).valid
    ).toBe(false);
    // Summary without any bullets fails validation
    expect(
      validateTransformOutput(
        'Executive Summary\nJust one paragraph without takeaways or structure at all.',
        'summary',
        150
      ).valid
    ).toBe(false);
  });
});

describe('6. Client-side scoped cache separation and invalidation', () => {
  it('separates modes, videos, and edited transcripts, and never caches empty/failed outputs', () => {
    const cache = createScopedResultCache(10);
    const scopeVideoA = buildTranscriptScopeKey('youtube', 'vid_A', 'Original transcript words.');
    const scopeVideoAEdited = buildTranscriptScopeKey('youtube', 'vid_A', 'Edited transcript words.');
    const scopeVideoB = buildTranscriptScopeKey('youtube', 'vid_B', 'Original transcript words.');

    expect(scopeVideoA).not.toBe(scopeVideoAEdited);
    expect(scopeVideoA).not.toBe(scopeVideoB);

    expect(cache.set(scopeVideoA, 'transform', 'summary', 'Summary for A')).toBe(true);
    expect(cache.set(scopeVideoA, 'transform', 'script', 'Script for A')).toBe(true);
    expect(cache.set(scopeVideoB, 'transform', 'summary', 'Summary for B')).toBe(true);

    // Reject empty or whitespace strings
    expect(cache.set(scopeVideoA, 'transform', 'blog', '')).toBe(false);
    expect(cache.set(scopeVideoA, 'transform', 'blog', '   \n  ')).toBe(false);
    expect(cache.get(scopeVideoA, 'transform', 'blog')).toBeUndefined();

    // Modes and videos stay isolated
    expect(cache.get(scopeVideoA, 'transform', 'summary')).toBe('Summary for A');
    expect(cache.get(scopeVideoA, 'transform', 'script')).toBe('Script for A');
    expect(cache.get(scopeVideoB, 'transform', 'summary')).toBe('Summary for B');

    // Editing transcript invalidates old scope lookup automatically
    expect(cache.get(scopeVideoAEdited, 'transform', 'summary')).toBeUndefined();
  });
});

describe('7 & 8. Bounded fallback, cost controls, and HTTP endpoint behavior with mocked AI', () => {
  const sampleTranscript =
    'Solar microgrids allow rural clinics to keep vaccine refrigerators running during grid outages, though battery replacement every seven years remains a major budget challenge.';

  it('uses primary 8B model first and succeeds in 1 call across all 4 modes', async () => {
    const mockResponses: Record<string, string> = {
      summary:
        'Executive Summary\nThe speaker explains how solar microgrids support rural clinics.\n\nKey Takeaways\n• Reliability: Keeps vaccine fridges running during outages.\n• Cost Qualification: Battery replacement every seven years strains budgets.\n\nBottom Line\nMicrogrids improve uptime but require long-term battery budgeting.',
      script:
        'HOOK\nHow do rural clinics keep vaccines cold when the power grid fails?\n\nBODY\nSolar microgrids keep refrigerators running through outages, though replacing batteries every seven years remains a major budget hurdle.\n\nCTA\nHow should clinics fund long-term battery replacements?',
      blog:
        'Solar Microgrids in Rural Clinics\n\nAccording to the speaker, solar microgrids keep critical vaccine refrigerators running during outages.\n\nThe Seven-Year Battery Challenge\n\nHowever, replacing batteries every seven years remains a major budget constraint that planners must address.',
      notes:
        'Core Topic\nThe speaker discusses solar microgrids and battery replacement costs for rural clinics.\n\nKey Concepts & Definitions\n• Solar Microgrids: Used to keep vaccine refrigerators running during outages.\n\nExact Quotations\n• "keep vaccine refrigerators running during grid outages"\n\nComprehension Questions\n• Q: What remains a major budget challenge?\n  A: Battery replacement every seven years.',
    };

    for (const mode of ['summary', 'script', 'blog', 'notes'] as const) {
      const runSpy = vi.fn().mockResolvedValue({ response: mockResponses[mode] });
      const res = await app.request(
        '/api/transform',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: sampleTranscript, videoTitle: 'Clinic Power', mode }),
        },
        { AI: { run: runSpy } } as any
      );

      expect(res.status).toBe(200);
      const json: any = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.model).toBe('@cf/meta/llama-3.1-8b-instruct-fast');
      expect(runSpy).toHaveBeenCalledTimes(1);
    }
  });

  it('falls back to 70B ONLY on model deprecation (5028) or upstream 5xx, bounded by maxTotalCalls', async () => {
    const runSpy = vi
      .fn()
      .mockRejectedValueOnce(new Error('5028: model was deprecated'))
      .mockResolvedValueOnce({
        response:
          'Executive Summary\nMicrogrids power clinics.\n\nKey Takeaways\n• Uptime: Runs vaccine fridges.\n\nBottom Line\nBattery replacement every 7 years is costly.',
      });

    const res = await app.request(
      '/api/transform',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: sampleTranscript, mode: 'summary' }),
      },
      { AI: { run: runSpy } } as any
    );

    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.data.model).toBe('@cf/meta/llama-3.3-70b-instruct-fp8-fast');
    expect(runSpy).toHaveBeenCalledTimes(2);
  });

  it('NEVER escalates to 70B on rate limits (429), neuron quota errors, invalid inputs (400), or auth errors (401)', async () => {
    // Case A: Rate limit / daily neuron quota
    const quotaSpy = vi
      .fn()
      .mockRejectedValue(new Error('429 Too Many Requests: daily limit of 10000 neurons exceeded'));
    const quotaRes = await app.request(
      '/api/transform',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: sampleTranscript, mode: 'summary' }),
      },
      { AI: { run: quotaSpy } } as any
    );
    expect(quotaRes.status).toBe(429);
    expect(quotaSpy).toHaveBeenCalledTimes(1); // Did NOT call 70B!

    // Case B: Invalid context/parameter error
    const badParamSpy = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error('Invalid parameter: context length exceeded'), { status: 400 }));
    const badParamRes = await app.request(
      '/api/transform',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: sampleTranscript, mode: 'summary' }),
      },
      { AI: { run: badParamSpy } } as any
    );
    expect(badParamRes.status).toBe(400);
    expect(badParamSpy).toHaveBeenCalledTimes(1); // Did NOT call 70B!

    // Case C: Auth error containing a secret token -> must NOT call 70B and must NOT leak secret
    const authSpy = vi
      .fn()
      .mockRejectedValue(new Error('401 Unauthorized for token sk_live_supersecret999'));
    const authRes = await app.request(
      '/api/transform',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: sampleTranscript, mode: 'summary' }),
      },
      { AI: { run: authSpy } } as any
    );
    expect(authRes.status).toBe(503);
    expect(authSpy).toHaveBeenCalledTimes(1);
    const authJson: any = await authRes.json();
    expect(JSON.stringify(authJson)).not.toContain('sk_live_supersecret999');
  });

  it('retries malformed/empty output at most once on 8B without escalating to 70B, and caps total attempts at 3', async () => {
    const malformedSpy = vi.fn().mockResolvedValue({ response: '' });
    const res = await app.request(
      '/api/transform',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: sampleTranscript, mode: 'summary' }),
      },
      { AI: { run: malformedSpy } } as any
    );

    expect(res.status).toBe(422);
    // Called 8B twice (initial + 1 controlled retry), never called 70B
    expect(malformedSpy).toHaveBeenCalledTimes(2);
    expect(malformedSpy.mock.calls[0][0]).toBe('@cf/meta/llama-3.1-8b-instruct-fast');
    expect(malformedSpy.mock.calls[1][0]).toBe('@cf/meta/llama-3.1-8b-instruct-fast');

    // Even if every upstream model throws 503, total calls never exceed 3
    const upstreamFailSpy = vi.fn().mockRejectedValue(new Error('503 Service Unavailable'));
    await expect(
      executeBoundedAiChat({
        ai: { run: upstreamFailSpy },
        messages: [{ role: 'user', content: 'test' }],
        maxTokens: 100,
        temperature: 0.1,
        models: ['m1', 'm2', 'm3', 'm4', 'm5'],
        maxTotalCalls: 3,
      })
    ).rejects.toThrow();
    expect(upstreamFailSpy).toHaveBeenCalledTimes(3);
  });

  it('rejects invalid modes, malformed JSON, empty noise transcripts, and oversized payloads before calling AI', async () => {
    const neverCalledSpy = vi.fn();
    const env = { AI: { run: neverCalledSpy } } as any;

    const badJson = await app.request(
      '/api/transform',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad' },
      env
    );
    expect(badJson.status).toBe(400);

    const badMode = await app.request(
      '/api/transform',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: sampleTranscript, mode: 'unsupported_mode' }),
      },
      env
    );
    expect(badMode.status).toBe(400);

    const noiseOnly = await app.request(
      '/api/transform',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: '[Music] [Applause] ♪', mode: 'summary' }),
      },
      env
    );
    expect(noiseOnly.status).toBe(400);

    const oversized = await app.request(
      '/api/transform',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'a'.repeat(MAX_TRANSCRIPT_INPUT_CHARS + 100), mode: 'summary' }),
      },
      env
    );
    expect(oversized.status).toBe(413);

    expect(neverCalledSpy).not.toHaveBeenCalled();
  });
});

describe('9. Meaning preservation, incomplete speech, and exact-quote regressions', () => {
  const cvTranscript =
    'We capture camera frames with OpenCV and run classification with TensorFlow. Python is commonly used to build server-side applications like web apps with the framework. Keep the request payload small so latency stays low.';

  const analogyTranscript =
    'A cache is basically a sticky note on your monitor so you do not walk down to the basement filing cabinet every five minutes. Keep the sticky note small or it covers your screen.';

  it('1 & 2. instructs prompts against absent libraries/entities and against guessing missing details in incomplete phrases', () => {
    for (const mode of ['summary', 'script', 'blog', 'thread', 'notes'] as const) {
      const spec = buildTransformPrompt(mode, 'Vision Pipeline', cvTranscript, 36);
      const sys = spec.messages[0].content;

      // Forbids introducing absent libraries, frameworks, or named entities
      expect(sys).toMatch(/Do NOT introduce any facts, examples, named entities, libraries, frameworks/i);
      // Instructs rewriting incomplete speech naturally without guessing omitted frameworks/names
      expect(sys).toMatch(/omit or generalize unrecoverable fragments/i);
      expect(sys).toMatch(/NEVER guess which framework or name was omitted/i);
    }

    // Exact-quote validator also rejects quotes injecting absent libraries (RAPIDS) or guessed frameworks (Django)
    expect(
      verifyQuoteAgainstTranscript(
        'We capture camera frames with OpenCV, TensorFlow, and RAPIDS',
        cvTranscript
      )
    ).toBe(false);
    expect(
      verifyQuoteAgainstTranscript(
        'build server-side applications like web apps with the Django framework',
        cvTranscript
      )
    ).toBe(false);
  });

  it('3. instructs prompts to preserve the speaker’s own explanations rather than replacing them with textbook definitions', () => {
    const notesSpec = buildTransformPrompt('notes', 'Caching Intro', analogyTranscript, 35);
    const sys = notesSpec.messages[0].content;
    const userTask = notesSpec.messages[1].content;

    expect(sys).toMatch(
      /Do NOT silently correct, challenge, or replace the speaker's explanations with textbook definitions/i
    );
    expect(userTask).toMatch(
      /preserving what the speaker actually taught—do NOT silently replace the speaker's explanations or analogies with independent textbook definitions/i
    );
  });

  it('4. rejects combined/spliced statements inside Exact Quotations while keeping genuine continuous quotes', () => {
    // Spliced across non-adjacent sentences without ellipsis
    expect(
      verifyQuoteAgainstTranscript(
        'We capture camera frames with OpenCV Keep the request payload small',
        cvTranscript
      )
    ).toBe(false);

    // Spliced using mid-quote ellipsis
    expect(
      verifyQuoteAgainstTranscript(
        'We capture camera frames with OpenCV ... and run classification with TensorFlow',
        cvTranscript
      )
    ).toBe(false);

    const rawNotes = [
      'Core Topic',
      'The speaker explains caching using a monitor sticky-note analogy.',
      '',
      'Key Concepts & Definitions',
      '• Cache: Described by the speaker as a sticky note on your monitor that avoids trips to a basement filing cabinet.',
      '',
      'Exact Quotations',
      '• "A cache is basically a sticky note on your monitor"',
      '• "A cache is basically a sticky note ... Keep the sticky note small"',
      '• "A CPU L1 cache stores 64-byte cache lines using LRU eviction"',
      '',
      'Comprehension Questions',
      '• Q: Why does the speaker say to keep the sticky note small?',
      '  A: Otherwise it covers up your monitor screen.',
    ].join('\n');

    const processed = postProcessTransformOutput(rawNotes, 'notes', analogyTranscript);
    expect(processed).toContain('• "A cache is basically a sticky note on your monitor"');
    expect(processed).not.toContain('sticky note ... Keep');
    expect(processed).not.toContain('CPU L1 cache');
  });

  it('5. keeps all five output formats (summary, script, blog, thread, notes) working end-to-end', async () => {
    const threadResponse = [
      '1/3 Most slow apps repeat the same expensive lookup over and over.',
      '2/3 Think of a cache like a sticky note on your monitor so you avoid walking to the basement filing cabinet every five minutes.',
      '3/3 Keep that sticky note small so it never clutters your screen.',
    ].join('\n\n');

    const runSpy = vi.fn().mockResolvedValue({ response: threadResponse });
    const res = await app.request(
      '/api/transform',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: analogyTranscript, videoTitle: 'Caching Analogy', mode: 'thread' }),
      },
      { AI: { run: runSpy } } as any
    );

    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.mode).toBe('thread');
    expect(json.data.result).toContain('1/3');
    expect(json.data.result).toContain('sticky note on your monitor');
  });
});
