import { Spread } from '@/lib/tarot/types';
import { spreads } from '@/lib/tarot/spreads';
import { getSpreadGuidance } from '@/lib/tarot/spread-guidance';
import { parseReadingContent } from '@/lib/interpretation';

/**
 * Agent 化 · 牌阵选择决策步
 *
 * 让 LLM 根据用户问题，从已有牌阵中挑选最合适的一个。
 * 模式与 buildFollowUpDecidePrompt 一致：严格要求 JSON-only 输出，
 * 由 extractSpreadChoiceJson 解析。
 *
 * 这是 Agent 全自动对话流的第一步：用户只需提出问题，
 * 由 Agent 决定使用哪个牌阵，省去用户手动选择的步骤。
 */

// ─── 牌阵清单摘要 ─────────────────────────────────────────────

interface SpreadOption {
  id: string;
  nameCn: string;
  positionCount: number;
  guidance: string;
}

function buildSpreadOptions(): SpreadOption[] {
  return spreads.map((spread: Spread) => {
    const guidance = getSpreadGuidance(spread.id);
    return {
      id: spread.id,
      nameCn: spread.nameCn,
      positionCount: spread.positions.length,
      guidance: guidance
        ? `适合：${guidance.suitableFor}\n  所需背景：${guidance.requiredContext}\n  边界：${guidance.boundary}`
        : spread.description,
    };
  });
}

// ─── Prompt 构建 ─────────────────────────────────────────────

export function buildSpreadChoicePrompt(question: string): string {
  const options = buildSpreadOptions();
  const optionsText = options
    .map((opt) => `- "${opt.id}"（${opt.nameCn}，${opt.positionCount}张）\n  ${opt.guidance}`)
    .join('\n');

  return `你正在协助一次塔罗占卜，需要根据问卜者的问题，为其挑选最合适的牌阵。

## 问卜者的问题
${question}

## 可选牌阵
${optionsText}

## 选择原则
- 先核对用户实际提供的背景和目标，再按以上适用条件选择；牌数多不代表更准确。
- 两个选项都已明确，且用户要比较它们时，才选二择一（"two-options"）；不要替用户补出 A 或 B。
- 已有具体事情和过去、当前进展，想了解后续趋势时，可选三张牌阵（"three-card"）。
- 只有已提供事件经过，且需要复盘影响与行动时，才选时间之流（"timeline"）；只问“什么时候”不满足条件。
- 有具体的两人互动且要梳理关系时，可选关系牌阵（"relationship"）；不能仅凭感情词就选它，也不能把读心当作选阵目的。
- 背景充分、目标和约束清楚，且确实涉及多个相互影响的方面，才选凯尔特十字（"celtic-cross"）；不能因问题复杂就选十张。
- 背景不足时优先单张牌（"single"），在 reason 中点明最需要补充的一项信息；不要用更多牌位填补事实缺口。
- reason 说明与用户问题相符的选择依据，不能编造事实或承诺准确结果。

仅输出一个 JSON 对象，禁止任何其他内容（不要 Markdown 代码块、不要解释、不要前后多余文字）：
{"spreadId":"three-card","reason":"<不超过 40 字的简短理由，说明为何选择此牌阵>"}`;
}

// ─── 解析 ───────────────────────────────────────────────────

export interface SpreadChoiceResult {
  spreadId: string;
  reason: string;
  fallbackReason?: 'invalid-output' | 'incomplete-output' | 'transient-error';
}

/** 所有合法的牌阵 id，用于校验 LLM 返回 */
const VALID_SPREAD_IDS = new Set(spreads.map((s: Spread) => s.id));

/** 决策未成功时先使用最少牌位，不用更多牌位补足未知背景。 */
const FALLBACK_SPREAD_ID = 'single';

/**
 * 从 LLM 文本输出中提取牌阵选择 JSON。
 * 只解析正式正文中的完整对象，避免选中思考过程或解释中的候选对象。
 */
export function extractSpreadChoiceJson(text: string): SpreadChoiceResult | null {
  try {
    const answer = parseReadingContent(text).answer.trim();
    const fenced = answer.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i);
    const parsed: unknown = JSON.parse(fenced ? fenced[1] : answer);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const value = parsed as Record<string, unknown>;
    if (
      typeof value.spreadId !== 'string' ||
      !VALID_SPREAD_IDS.has(value.spreadId) ||
      typeof value.reason !== 'string'
    )
      return null;
    return { spreadId: value.spreadId, reason: value.reason.slice(0, 120) };
  } catch {
    return null;
  }
}

/** 解析失败时的兜底选择 */
export function defaultSpreadChoice(
  question: string,
  fallbackReason: SpreadChoiceResult['fallbackReason'] = 'invalid-output',
): SpreadChoiceResult {
  // 保留现有调用协议；决策失败不代表已经判断问题背景是否充分。
  void question;
  return {
    spreadId: FALLBACK_SPREAD_ID,
    reason: '先用单张牌聚焦你最关心的具体问题。',
    fallbackReason,
  };
}
