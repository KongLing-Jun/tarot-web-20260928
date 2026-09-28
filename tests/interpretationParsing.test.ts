import { describe, expect, it } from 'vitest';
import { parseReadingContent } from '@/lib/interpretation';

describe('解读分段', () => {
  it.each([
    ['## 核心解读\n事情', { core: '事情', actions: null, cards: null }],
    ['## 核心解读\n事情\n## 各牌说明\n牌义', { core: '事情\n', actions: null, cards: '牌义' }],
  ] as const)('识别可选行动章节且保留正文：%s', (content, sections) => {
    expect(parseReadingContent(content)).toMatchObject({ answer: content, sections });
  });

  it.each([
    '## 核心解读\n事情\n## 可采取的行动\n步骤\n## 各牌说明\n牌义',
    '## 核心解读\r\n事情\r\n## 各牌说明\r\n牌义\r\n## 可采取的行动\r\n步骤',
  ])('兼容新旧顺序且不丢内容', (content) => {
    const { sections } = parseReadingContent(content);
    expect(sections?.core.trim()).toBe('事情');
    expect(sections?.actions?.trim()).toBe('步骤');
    expect(sections?.cards?.trim()).toBe('牌义');
  });

  it('逐字符接收时不显示结构标题和思考标签碎片', () => {
    const content =
      '<thinking>内部说明</thinking>\n## 核心解读\n事情\n## 可采取的行动\n步骤\n## 各牌说明\n牌义';
    for (let end = 1; end <= content.length; end++) {
      const parsed = parseReadingContent(content.slice(0, end), true);
      expect(parsed.answer).not.toMatch(/<\/?(?:t|th|thi|thin|think|thinki|thinkin|thinking)>?$/i);
      const visible = parsed.sections
        ? Object.values(parsed.sections).filter(Boolean).join('')
        : parsed.answer;
      expect(visible).not.toContain('##');
    }
    expect(parseReadingContent(content, true).sections?.cards).toBe('牌义');
  });

  it('结束和中断时保留未能识别的尾部', () => {
    expect(parseReadingContent('普通正文\n## 可采', true).answer).toBe('普通正文\n');
    expect(parseReadingContent('普通正文\n## 可采').answer).toBe('普通正文\n## 可采');
    expect(parseReadingContent('正文<thin', true).answer).toBe('正文');
    expect(parseReadingContent('正文<thin').answer).toBe('正文<thin');
  });

  it.each([
    '',
    '自由文本',
    '前言\n## 核心解读\n事情',
    '## 核心解读\n事情\n## 未知标题\n内容',
    '## 核心解读\n事情\n## 核心解读\n重复',
    '## 各牌说明\n牌义\n## 核心解读\n事情',
  ])('未知、旧版和异常结构原文保留：%s', (content) => {
    expect(parseReadingContent(content)).toMatchObject({ answer: content, sections: null });
  });

  it('支持未完成章节，忽略代码块内的标题', () => {
    const core = '事情\n```markdown\n## 不是真正章节\n```\n';
    expect(
      parseReadingContent(`## 核心解读\n${core}## 可采取的行动\n第一步`, true).sections,
    ).toEqual({ core, actions: '第一步', cards: null });
  });

  it('思考与正文分别保留', () => {
    expect(
      parseReadingContent('<think>依据一</think>正文<thinking>依据二</thinking>继续'),
    ).toMatchObject({ thinking: '依据一\n\n依据二', answer: '正文继续' });
  });
});
