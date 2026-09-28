import {
  INTENT_TASKS,
  TURN_ACTIONS,
  type IntentCandidate,
  type IntentMessage,
  type ResponsePlan,
  type SupportedValue,
} from './types';

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('意图识别返回了无效结构');
  }
  return value as Record<string, unknown>;
}

function text(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('意图识别缺少有效文本');
  return value;
}

function list<T>(value: unknown, parse: (item: unknown) => T): T[] {
  if (!Array.isArray(value)) throw new Error('意图识别返回了无效列表');
  return value.map(parse);
}

/** Structural and provenance validation; this cannot prove semantic entailment. */
export function parseIntentCandidate(value: unknown, messages: IntentMessage[]): IntentCandidate {
  if (!messages.length || new Set(messages.map((message) => message.id)).size !== messages.length) {
    throw new Error('意图识别消息来源无效');
  }
  const input = object(value);
  const task = INTENT_TASKS.find((item) => item === input.task);
  const turnAction = TURN_ACTIONS.find((item) => item === input.turnAction);
  if (!task || !turnAction || typeof input.wantsAdvice !== 'boolean') {
    throw new Error('意图识别返回了无效任务或行为');
  }
  const supported = (item: unknown): SupportedValue => {
    const entry = object(item);
    const source = object(entry.source);
    const messageId = text(source.messageId);
    const quote = text(source.quote);
    const message = messages.find((candidate) => candidate.id === messageId);
    if (!message || !message.text.includes(quote)) throw new Error('意图依据无法在用户原文中找到');
    return { value: text(entry.value), source: { messageId, quote } };
  };
  const result: IntentCandidate = {
    task,
    turnAction,
    subject: input.subject === null ? null : supported(input.subject),
    goal: input.goal === null ? null : supported(input.goal),
    facts: list(input.facts, supported),
    constraints: list(input.constraints, supported),
    wantsAdvice: input.wantsAdvice,
    missingInformation: list(input.missingInformation, (item) => {
      const missing = object(item);
      return {
        field: text(missing.field),
        effectOnAnswer: text(missing.effectOnAnswer),
        question: text(missing.question),
      };
    }),
  };
  const evidence = [result.subject, result.goal, ...result.facts, ...result.constraints].filter(
    (entry): entry is SupportedValue => entry !== null,
  );
  const latestId = messages[messages.length - 1].id;
  if (turnAction === 'correct' && !evidence.some((entry) => entry.source.messageId === latestId)) {
    throw new Error('纠正意图必须引用最新用户消息');
  }
  if (
    turnAction === 'switch-topic' &&
    evidence.some((entry) => entry.source.messageId !== latestId)
  ) {
    throw new Error('新话题不能继承旧话题事实');
  }
  return result;
}

export function createResponsePlan(
  candidate: IntentCandidate,
  hasExistingCards: boolean,
): ResponsePlan {
  const clarification =
    candidate.missingInformation[0]?.question ??
    (candidate.task === 'unknown' ? '你这次最希望我帮你梳理什么？' : null);
  const mode = clarification
    ? 'clarify'
    : candidate.task === 'emotional-support'
      ? 'support'
      : candidate.task === 'explain-cards'
        ? 'explanation'
        : 'reading';
  return {
    mode,
    clarification,
    includeAction: mode === 'reading' && candidate.wantsAdvice,
    reuseExistingCards:
      hasExistingCards &&
      candidate.turnAction !== 'switch-topic' &&
      (candidate.turnAction === 'correct' ||
        candidate.task === 'emotional-support' ||
        candidate.task === 'explain-cards'),
  };
}
