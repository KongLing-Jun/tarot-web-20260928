/**
 * SSE 流解析工具 — 从 useReading 抽出以便单元测试
 */

import { parseReadingContent } from '@/lib/interpretation';

export type FollowUpDecision = 'direct' | 'draw';

export interface ParsedSseChunk {
  content: string;
  thinking: string;
  error: string | null;
  isDone: boolean;
  /** 如果模型因 token 上限停止，返回 true */
  truncated: boolean;
  finishReason?: string;
  persistence?: 'saved' | 'failed';
  malformed?: boolean;
  /** New protocol bytes arrived, but no checked answer record is ready yet. */
  groundingProgress?: boolean;
}

export interface DecisionResult {
  decision: FollowUpDecision;
  drawCount: number;
  reason: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function extractTextValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(extractTextValue).join('');
  if (!isRecord(value)) return '';
  const candidateKeys = [
    'text',
    'content',
    'value',
    'output_text',
    'thinking',
    'reasoning',
  ] as const;
  for (const key of candidateKeys) {
    const extracted = extractTextValue(value[key]);
    if (extracted) return extracted;
  }
  return '';
}

function isThinkingType(type: unknown): boolean {
  if (typeof type !== 'string') return false;
  const normalized = type.toLowerCase();
  return normalized.includes('think') || normalized.includes('reason');
}

function extractContentText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (isRecord(item) && isThinkingType(item.type)) return '';
        return extractTextValue(item);
      })
      .join('');
  }
  if (isRecord(value) && isThinkingType(value.type)) return '';
  return extractTextValue(value);
}

function extractThinkingText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (isRecord(item) && !isThinkingType(item.type)) return '';
        return extractTextValue(item);
      })
      .join('');
  }
  if (!isRecord(value)) return '';
  if (isThinkingType(value.type)) return extractTextValue(value);
  const thinkingKeys = ['reasoning_content', 'reasoning', 'thinking'] as const;
  for (const key of thinkingKeys) {
    const extracted = extractThinkingText(value[key]);
    if (extracted) return extracted;
  }
  return '';
}

function extractContentThinking(value: unknown): string {
  if (Array.isArray(value)) return value.map(extractContentThinking).join('');
  return isRecord(value) && isThinkingType(value.type) ? extractTextValue(value) : '';
}
function pickFirstNonEmpty(...values: string[]): string {
  return values.find((value) => value.length > 0) ?? '';
}

function extractErrorMessage(value: unknown): string | null {
  if (typeof value === 'string' && value) return value;
  if (isRecord(value) && typeof value.message === 'string' && value.message) return value.message;
  return null;
}

export function parseSseChunk(data: string): ParsedSseChunk {
  if (data === '[DONE]') {
    return { content: '', thinking: '', error: null, isDone: true, truncated: false };
  }

  try {
    const parsedUnknown: unknown = JSON.parse(data);
    if (!isRecord(parsedUnknown)) {
      return { content: '', thinking: '', error: null, isDone: false, truncated: false };
    }

    const choices = Array.isArray(parsedUnknown.choices) ? parsedUnknown.choices : [];
    const firstChoice = choices.length > 0 && isRecord(choices[0]) ? choices[0] : null;
    const delta = firstChoice && isRecord(firstChoice.delta) ? firstChoice.delta : null;
    const message = firstChoice && isRecord(firstChoice.message) ? firstChoice.message : null;

    const content = pickFirstNonEmpty(
      extractContentText(delta?.content),
      extractContentText(message?.content),
      extractContentText(parsedUnknown.content),
    );

    const thinking = pickFirstNonEmpty(
      extractThinkingText(delta?.reasoning_content),
      extractThinkingText(delta?.reasoning),
      extractThinkingText(delta?.thinking),
      extractThinkingText(message?.reasoning_content),
      extractThinkingText(message?.reasoning),
      extractThinkingText(message?.thinking),
      extractThinkingText(parsedUnknown.reasoning_content),
      extractThinkingText(parsedUnknown.reasoning),
      extractThinkingText(parsedUnknown.thinking),
      extractContentThinking(delta?.content),
      extractContentThinking(message?.content),
      extractContentThinking(parsedUnknown.content),
    );

    const error = extractErrorMessage(parsedUnknown.error);

    // 检测 finish_reason: "length" —— 表示模型因 token 上限被截断
    const finishReason = firstChoice ? firstChoice.finish_reason : null;
    const truncated = finishReason === 'length';

    return {
      content,
      thinking,
      error,
      isDone: false,
      truncated,
      ...(parsedUnknown.groundingProgress === true ? { groundingProgress: true } : {}),
      ...(typeof finishReason === 'string' ? { finishReason } : {}),
      ...(parsedUnknown.persistence === 'saved' || parsedUnknown.persistence === 'failed'
        ? { persistence: parsedUnknown.persistence }
        : {}),
    };
  } catch {
    return {
      content: '',
      thinking: '',
      error: null,
      isDone: false,
      truncated: false,
      malformed: true,
    };
  }
}

export function extractDecisionJson(text: string): DecisionResult | null {
  try {
    const answer = parseReadingContent(text).answer.trim();
    const fenced = answer.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i);
    const parsed: unknown = JSON.parse(fenced ? fenced[1] : answer);
    if (!isRecord(parsed)) return null;
    const { decision, drawCount } = parsed;
    if (decision !== 'direct' && decision !== 'draw') return null;
    if (typeof drawCount !== 'number' || !Number.isInteger(drawCount)) return null;
    if (decision === 'direct' ? drawCount !== 0 : drawCount < 1 || drawCount > 3) return null;
    if (typeof parsed.reason !== 'string') return null;
    const reason = parsed.reason.slice(0, 120);
    return { decision, drawCount, reason };
  } catch {
    return null;
  }
}

/** Incremental SSE framing, shared by browser and recorder. Only data fields are emitted. */
export function createSseDecoder(): { push(text: string): string[]; finish(): string[] } {
  let buffer = '';
  let data: string[] = [];
  const line = (value: string, events: string[]): void => {
    if (!value) {
      if (data.length) events.push(data.join('\n'));
      data = [];
    } else if (value === 'data' || value.startsWith('data:')) {
      const field = value === 'data' ? '' : value.slice(5);
      data.push(field.startsWith(' ') ? field.slice(1) : field);
    }
  };
  const drain = (final: boolean): string[] => {
    const events: string[] = [];
    let index: number;
    while ((index = buffer.search(/[\r\n]/)) >= 0) {
      if (!final && buffer[index] === '\r' && index === buffer.length - 1) break;
      const width = buffer[index] === '\r' && buffer[index + 1] === '\n' ? 2 : 1;
      line(buffer.slice(0, index), events);
      buffer = buffer.slice(index + width);
    }
    if (final) {
      if (buffer) line(buffer, events);
      buffer = '';
      line('', events);
    }
    return events;
  };
  return {
    push(text) {
      buffer += text;
      return drain(false);
    },
    finish() {
      return drain(true);
    },
  };
}
