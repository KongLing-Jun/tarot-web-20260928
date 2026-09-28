type InterpretationSegmentType = 'answer' | 'thinking';

interface InterpretationSegment {
  type: InterpretationSegmentType;
  markdown: string;
}

const THINKING_TAG_PATTERN = /<\/?(think|thinking)>/gi;

function appendSegment(
  segments: InterpretationSegment[],
  type: InterpretationSegmentType,
  markdown: string,
): void {
  if (!markdown.trim()) return;

  const normalizedMarkdown = type === 'thinking' ? markdown.trim() : markdown;
  const last = segments.at(-1);

  if (last && last.type === type) {
    last.markdown += normalizedMarkdown;
    return;
  }

  segments.push({ type, markdown: normalizedMarkdown });
}

export function parseInterpretationSegments(rawContent: string): InterpretationSegment[] {
  const segments: InterpretationSegment[] = [];
  let activeType: InterpretationSegmentType = 'answer';
  let cursor = 0;

  for (const match of rawContent.matchAll(THINKING_TAG_PATTERN)) {
    const tag = match[0].toLowerCase();
    const index = match.index ?? 0;

    appendSegment(segments, activeType, rawContent.slice(cursor, index));
    activeType = tag.startsWith('</') ? 'answer' : 'thinking';
    cursor = index + match[0].length;
  }

  appendSegment(segments, activeType, rawContent.slice(cursor));
  return segments;
}

/**
 * 把模型多轮交错产生的 thinking / answer 段合并：
 * - thinking 合并成独立区段（每段间空一行）
 * - answer 拼成连续正文，避免被思考块切碎、视觉错乱
 */
export function mergeSegments(segments: InterpretationSegment[]): {
  thinking: string;
  answer: string;
} {
  const thinkingChunks: string[] = [];
  const answerChunks: string[] = [];

  for (const seg of segments) {
    if (seg.type === 'thinking') {
      thinkingChunks.push(seg.markdown);
    } else {
      answerChunks.push(seg.markdown);
    }
  }

  return {
    thinking: thinkingChunks.join('\n\n'),
    answer: answerChunks.join(''),
  };
}

export interface ReadingSections {
  core: string;
  actions: string | null;
  cards: string | null;
}

// 这三个标题是模型输出协议；界面标题可独立调整。
export const READING_SECTION_TITLES = ['核心解读', '可采取的行动', '各牌说明'] as const;

/** 只暂存可能尚未收齐的标签；请求结束时调用方仍使用完整原文。 */
function withoutPendingThinkingTag(content: string): string {
  const start = content.lastIndexOf('<');
  if (start < 0) return content;
  const tail = content.slice(start).toLowerCase();
  return ['<think>', '</think>', '<thinking>', '</thinking>'].some(
    (tag) => tag.startsWith(tail) && tag !== tail,
  )
    ? content.slice(0, start)
    : content;
}

function withoutPendingHeading(answer: string): string {
  const start = answer.lastIndexOf('\n') + 1;
  const tail = answer.slice(start).trimStart();
  return tail && READING_SECTION_TITLES.some((title) => `## ${title}`.startsWith(tail))
    ? answer.slice(0, start)
    : answer;
}

/** 识别协议章节的有效前缀；未知/重复标题或前言使整篇回退为原文。 */
function splitReadingSections(answer: string): ReadingSections | null {
  const headings: Array<{ title: string; start: number; end: number }> = [];
  let offset = 0;
  let fence: { char: string; length: number } | null = null;
  for (const line of answer.match(/[^\n]*\n|[^\n]+$/g) ?? []) {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (marker) {
      if (!fence) fence = { char: marker[1][0], length: marker[1].length };
      else if (
        marker[1][0] === fence.char &&
        marker[1].length >= fence.length &&
        line.slice(marker[0].length).trim() === ''
      )
        fence = null;
    } else if (!fence) {
      const heading = line.match(/^ {0,3}##[ \t]+(.+?)[ \t]*\r?\n?$/);
      if (heading) headings.push({ title: heading[1], start: offset, end: offset + line.length });
    }
    offset += line.length;
  }
  if (!headings.length || answer.slice(0, headings[0].start).trim()) return null;
  const orders = [READING_SECTION_TITLES, ['核心解读', '各牌说明', '可采取的行动']];
  if (!orders.some((order) => headings.every((heading, i) => heading.title === order[i])))
    return null;

  const result: ReadingSections = { core: '', actions: null, cards: null };
  const keys = { 核心解读: 'core', 可采取的行动: 'actions', 各牌说明: 'cards' } as const;
  headings.forEach((heading, i) => {
    const key = keys[heading.title as keyof typeof keys];
    result[key] = answer.slice(heading.end, headings[i + 1]?.start ?? answer.length);
  });
  return result;
}

export function parseReadingContent(
  content: string,
  streaming = false,
): {
  thinking: string;
  answer: string;
  sections: ReadingSections | null;
} {
  const parsed = mergeSegments(
    parseInterpretationSegments(streaming ? withoutPendingThinkingTag(content) : content),
  );
  const answer = streaming ? withoutPendingHeading(parsed.answer) : parsed.answer;
  return { ...parsed, answer, sections: splitReadingSections(answer) };
}
