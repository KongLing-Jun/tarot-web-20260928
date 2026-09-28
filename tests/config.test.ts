// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { numberSetting } from '../scripts/config.mjs';

describe('backend runtime configuration', () => {
  it('requires numeric settings in the runtime file without falling back to defaults', () => {
    expect(() => numberSetting({}, 'MAX_OUTPUT_TOKENS')).toThrow(
      'model.config.json 缺少 MAX_OUTPUT_TOKENS',
    );
    expect(numberSetting({ MAX_OUTPUT_TOKENS: 3 }, 'MAX_OUTPUT_TOKENS')).toBe(3);
  });

  it.each([null, 0, -1, 1.5, '10', '', false, 2_147_483_648])(
    'rejects invalid numeric settings: %s',
    (value) => {
      expect(() => numberSetting({ MAX_OUTPUT_TOKENS: value }, 'MAX_OUTPUT_TOKENS')).toThrow();
    },
  );
});
