// Initial-question UX limits; existing history and follow-up API limits are separate.
export const QUESTION_MAX_CHARACTERS = 500;
export const QUESTION_WARNING_CHARACTERS = 400;

const segmenter =
  typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter('zh', { granularity: 'grapheme' })
    : null;

export function countQuestionCharacters(value: string): number {
  const normalized = value.replace(/\r\n/g, '\n');
  // Older WebViews fall back to code points, keeping surrogate-pair emoji intact.
  const characters = (segmenter?.segment(normalized) ?? normalized)[Symbol.iterator]();
  let count = 0;
  while (!characters.next().done) count += 1;
  return count;
}
