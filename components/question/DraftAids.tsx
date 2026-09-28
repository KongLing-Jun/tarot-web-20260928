'use client';

export function appendDraft(draft: string, text: string): string {
  if (draft.includes(text)) return draft;
  return draft.trim() ? `${draft}\n${text}` : text;
}

const GUIDANCE = [
  ['发生了什么', '发生的事情是：'],
  ['最在意什么', '我最在意的是：'],
  ['想获得什么帮助', '我希望得到的帮助是：'],
] as const;
const FEELINGS = ['焦虑', '委屈', '难过', '犹豫', '烦躁', '平静', '不确定'];

export const FOLLOW_UP_AIDS = [
  ['这个理解不符合', '这个理解不符合我的情况，我想纠正的是：'],
  ['补充情况', '我想补充一些情况：'],
  ['具体怎么做', '结合刚才的建议，我具体可以怎么做？'],
] as const;

export const PROGRESS_AIDS = [
  ['记录尝试', '我尝试了：\n实际结果是：'],
  ['更新进展', '这件事有了新的进展：'],
] as const;

export function DraftAids({ onPick }: { onPick: (text: string) => void }) {
  return (
    <aside className="space-y-4 font-body text-base text-bone-dim" aria-label="可跳过的提问辅助">
      <p>可以直接写，也可以借助下面的提示。所有内容都能修改或删除。</p>
      <div className="flex flex-wrap gap-2" aria-label="整理问题">
        {GUIDANCE.map(([label, text]) => (
          <button
            data-small-action="text"
            key={label}
            type="button"
            className="btn-ink px-3 py-2 text-sm"
            onClick={() => onPick(text)}
          >
            {label}
          </button>
        ))}
      </div>
      <p>此刻的感受（可选），也可以在草稿里写下其他感受：</p>
      <div className="flex flex-wrap gap-2" aria-label="可选感受">
        {FEELINGS.map((feeling) => (
          <button
            data-small-action="text"
            key={feeling}
            type="button"
            className="btn-ink px-3 py-2 text-sm"
            onClick={() =>
              onPick(feeling === '不确定' ? '我还不确定自己的感受。' : `我现在感到${feeling}。`)
            }
          >
            {feeling}
          </button>
        ))}
      </div>
      <details>
        <summary className="cursor-pointer py-2 text-gold">示例问题 · 先填草稿再修改</summary>
        <div className="flex flex-wrap gap-2 py-2">
          {['面对眼前的选择，我该如何决定？', '我想梳理这段关系中的困扰，可以从哪里开始？'].map(
            (text) => (
              <button
                data-small-action="text"
                key={text}
                type="button"
                className="btn-ink px-3 py-2 text-left text-sm"
                onClick={() => onPick(text)}
              >
                {text}
              </button>
            ),
          )}
        </div>
      </details>
    </aside>
  );
}
