import type { TestLog } from './index';
export function summarizeTest(log: TestLog) {
  const ids = [
    ...new Set(
      log.events
        .filter((e) => e.kind === 'question.candidate' && e.questionId)
        .map((e) => e.questionId!),
    ),
  ];
  const questions = ids.map((questionId) => {
    const events = log.events.filter((e) => e.questionId === questionId);
    const candidate = events.filter((e) => e.kind === 'question.candidate').at(-1);
    const visible = events.filter((e) => e.kind === 'quick.visible').sort((a, b) => a.at - b.at)[0];
    const generation =
      visible &&
      events.find((e) => e.kind === 'generation.started' && e.requestId === visible.requestId);
    return {
      questionId,
      question: candidate?.question,
      displayed: !!visible,
      terminal: visible
        ? 'displayed'
        : events.some((e) => e.kind === 'quick.ready')
          ? 'ready'
          : events.some((e) => e.kind === 'question.cancelled')
            ? 'cancelled'
            : events.some((e) => e.kind === 'question.skipped')
              ? 'skipped'
              : events.some((e) => ['generation.failed', 'pipeline.failed'].includes(e.kind))
                ? 'failed'
                : 'pending',
      latencyMs: visible?.sourceAt === undefined ? null : visible.at - visible.sourceAt,
      speculativeLeadMs:
        visible?.sourceAt === undefined || !generation ? null : visible.sourceAt - generation.at,
      cancelledAttempts: events.filter(
        (e) => e.kind === 'generation.cancelled' || e.kind === 'draft.discarded',
      ).length,
      failures: events
        .filter((e) => e.kind === 'generation.failed' || e.kind === 'pipeline.failed')
        .map((e) => e.reason),
      feedback: events.filter((e) => e.kind === 'feedback').map((e) => e.feedback),
    };
  });
  const latency = questions
    .map((q) => q.latencyMs)
    .filter((x): x is number => x !== null && x >= 0)
    .sort((a, b) => a - b);
  const median = latency.length
    ? (latency[Math.floor((latency.length - 1) / 2)] + latency[Math.floor(latency.length / 2)]) / 2
    : null;
  return {
    note: 'Observed VAD-frame to rendered-QUICK latency, including silence detection. Human review must mark usefulness, eligibility, relevance, grounding, maturity and speakability; no automatic quality pass. Unanswered candidates include incomplete or suppressed questions.',
    truncated: log.truncated,
    candidateQuestions: questions.length,
    displayedQuestions: questions.filter((q) => q.displayed).length,
    missingAnswers: questions.filter((q) => !q.displayed).map((q) => q.questionId),
    nonterminalQuestions: questions
      .filter((q) => q.terminal === 'pending')
      .map((q) => q.questionId),
    failedQuestions: questions.filter((q) => q.terminal === 'failed').map((q) => q.questionId),
    cancelledQuestions: questions
      .filter((q) => q.terminal === 'cancelled')
      .map((q) => q.questionId),
    unmeasuredAnswers: questions
      .filter((q) => q.displayed && q.latencyMs === null)
      .map((q) => q.questionId),
    measuredAnswers: latency.length,
    p50Ms: median,
    p95Ms: latency.length ? latency[Math.ceil(latency.length * 0.95) - 1] : null,
    latencySampleLargeEnough: latency.length >= 20 && !log.truncated,
    questions,
  };
}
