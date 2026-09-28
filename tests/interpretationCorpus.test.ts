import { describe, expect, it } from 'vitest';
import { validateInterpretationQuality } from '@/lib/interpretation-quality';
import { spreads } from '@/lib/tarot/spreads';
import {
  corpusAnswer,
  corpusCards,
  interpretationQualityCorpus,
} from './fixtures/interpretation-quality-corpus';

describe('离线固定牌面质量集', () => {
  it('覆盖当前全部六种牌阵', () => {
    expect(interpretationQualityCorpus.map((sample) => sample.spreadId).sort()).toEqual(
      spreads.map((spread) => spread.id).sort(),
    );
  });
  for (const sample of interpretationQualityCorpus) {
    it(`${sample.id}: 结构及牌面通过，交换方向可检出`, () => {
      const answer = corpusAnswer(sample);
      const context = { mode: 'initial' as const, drawnCards: corpusCards(sample.spreadId) };
      expect(validateInterpretationQuality(answer, context)).toEqual({
        needsRetry: false,
        issues: [],
      });
      expect(
        validateInterpretationQuality(answer.replace('（正位）', '（逆位）'), context),
      ).toMatchObject({
        needsRetry: true,
        issues: [expect.objectContaining({ code: 'orientation-mismatch' })],
      });
    });
  }
  it('事实或语义错误即使结构正确也可能通过：不将规则冒充语义保证', () => {
    const sample = interpretationQualityCorpus[3];
    const falseClaim = corpusAnswer(sample).replace(sample.core, sample.unacceptable);
    expect(
      validateInterpretationQuality(falseClaim, {
        mode: 'initial',
        drawnCards: corpusCards(sample.spreadId),
      }).needsRetry,
    ).toBe(false);
  });
});
