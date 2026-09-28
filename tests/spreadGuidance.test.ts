import { describe, expect, it } from 'vitest';
import { spreads } from '@/lib/tarot/spreads';
import {
  getSpreadGuidance,
  getSpreadPositionGuidance,
  spreadGuidance,
} from '@/lib/tarot/spread-guidance';
import {
  buildSpreadChoicePrompt,
  defaultSpreadChoice,
  extractSpreadChoiceJson,
} from '@/lib/agent/spreadChoice';

describe('牌阵用途与选择', () => {
  it('每一种实际牌阵都有场景、所需背景、示例及边界，未知牌阵不套用其他说明', () => {
    expect(Object.keys(spreadGuidance).sort()).toEqual(spreads.map((spread) => spread.id).sort());
    for (const spread of spreads) {
      const guidance = getSpreadGuidance(spread.id)!;
      for (const value of Object.values(guidance)) expect(value.trim().length).toBeGreaterThan(0);
    }
    expect(getSpreadGuidance('unknown')).toBeUndefined();
  });

  it('自动选阵使用与页面同一份适用条件和能力边界', () => {
    const prompt = buildSpreadChoicePrompt('我想换工作，怎么选？');
    for (const guidance of Object.values(spreadGuidance)) {
      expect(prompt).toContain(guidance.suitableFor);
      expect(prompt).toContain(guidance.requiredContext);
      expect(prompt).toContain(guidance.boundary);
    }
    expect(prompt).toContain('两个选项都已明确');
    expect(prompt).toContain('已提供事件经过');
    expect(prompt).toContain('不能仅凭感情词');
    expect(prompt).toContain('不能因问题复杂就选十张');
    expect(prompt).toContain('背景不足时优先单张牌');
    expect(prompt).not.toContain('默认均衡选择');
  });

  it('所有实际牌位都有象征视角说明，不改变原有牌阵数据', () => {
    for (const spread of spreads) {
      for (const position of spread.positions) {
        expect(getSpreadPositionGuidance(position.id)?.trim().length).toBeGreaterThan(0);
      }
    }
    expect(getSpreadPositionGuidance('relationship-2')).toContain('不能确认对方真实心理');
    expect(getSpreadPositionGuidance('celtic-4')).toContain('不保证会发生');
    expect(getSpreadPositionGuidance('unknown')).toBeUndefined();
    expect(spreads.find((spread) => spread.id === 'celtic-cross')!.positions[3].description).toBe(
      '即将发生的事情',
    );
  });

  it('保留选择结果协议，解析失败以单张先聚焦问题', () => {
    expect(extractSpreadChoiceJson('{"spreadId":"single","reason":"先聚焦当前问题"}')).toEqual({
      spreadId: 'single',
      reason: '先聚焦当前问题',
    });
    expect(defaultSpreadChoice('怎么选')).toEqual({
      spreadId: 'single',
      reason: '先用单张牌聚焦你最关心的具体问题。',
      fallbackReason: 'invalid-output',
    });
  });
});
