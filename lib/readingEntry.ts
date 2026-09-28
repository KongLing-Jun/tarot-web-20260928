import { getSpreadById, spreads } from '@/lib/tarot/spreads';
import type { Spread } from '@/lib/tarot/types';

export const generalSpreads = ['single', 'three-card', 'timeline', 'celtic-cross'].map((id) =>
  spreads.find((spread) => spread.id === id)!,
);

export const readingScenes = [
  {
    id: 'relationship',
    title: '关系走向',
    description: '看清相处中的连接与距离',
    spreadId: 'relationship',
    placeholder: '说说你们是什么关系，最近相处如何……\n可以补充一次具体互动，以及你最在意的问题。',
    openings: [
      {
        title: '最近相处有了变化',
        text: '我们是……关系，最近相处中出现的变化是……，我最在意的是……',
        icon: 0,
      },
      {
        title: '一次互动让我在意',
        text: '最近我们之间发生了……，这让我感到……，我想梳理的是……',
        icon: 2,
      },
      {
        title: '想改善彼此的相处',
        text: '我希望我们能够……，目前相处中让我困扰的是……，我尝试过……',
        icon: 3,
      },
    ],
  },
  {
    id: 'two-options',
    title: '二选一',
    description: '比较两个选择的可能走向',
    spreadId: 'two-options',
    placeholder: '写下你正在犹豫的两个选项……\n可以补充各自的条件、你最看重什么，以及有哪些限制。',
    openings: [
      {
        title: '两个选择都吸引我',
        text: '选择 A 是……，吸引我的地方是……；选择 B 是……，吸引我的地方是……。我最看重的是……',
        icon: 0,
      },
      {
        title: '担心选择后的代价',
        text: '我在……和……之间犹豫。两种选择让我担心的分别是……，目前需要顾及的限制是……',
        icon: 2,
      },
      {
        title: '不清楚该优先考虑什么',
        text: '两个选项分别是……。我既希望……，又在意……，最难取舍的地方是……',
        icon: 3,
      },
    ],
  },
  {
    id: 'progress',
    title: '事情进展',
    description: '梳理事情的经过与后续趋势',
    spreadId: 'three-card',
    placeholder:
      '说说你正在关注的事情，目前进展到哪里……\n可以补充之前发生了什么，以及接下来最在意的问题。',
    openings: [
      {
        title: '事情正在推进',
        text: '我正在推进……，之前已经……，目前进展到……，接下来最在意的是……',
        icon: 0,
      },
      {
        title: '进展出现了变化',
        text: '这件事原本……，最近发生了……，现在的情况是……，我想了解后续值得留意什么。',
        icon: 2,
      },
      {
        title: '正在等待下一步反馈',
        text: '我已经为……做了……，目前收到的反馈是……，接下来还在等待……，我最关心的是……',
        icon: 3,
      },
    ],
  },
  {
    id: 'preparation',
    title: '临场准备',
    description: '为即将面对的事，找到一个提醒',
    spreadId: 'single',
    placeholder: '说说你即将面对的一件事……\n可以补充你希望做到什么，以及此刻最在意的地方。',
    openings: [
      {
        title: '准备一次重要表达',
        text: '我即将进行……，希望表达清楚的是……，目前最在意的是……。这次我值得留意什么？',
        icon: 0,
      },
      {
        title: '面对一次新的尝试',
        text: '我准备第一次尝试……，已经做的准备是……，让我有些不确定的是……。我可以带着什么提醒开始？',
        icon: 2,
      },
      {
        title: '准备一次见面或沟通',
        text: '我即将和……见面或沟通，背景是……，希望达成的是……。我在交流中值得留意什么？',
        icon: 3,
      },
    ],
  },
  {
    id: 'stuck',
    title: '反复卡住',
    description: '梳理反复出现的困扰，寻找调整的方向',
    spreadId: 'timeline',
    placeholder:
      '说说哪件事让你感觉总在原地打转……\n可以补充这种情况从什么时候开始、你尝试过什么，以及最近一次发生了什么。',
    openings: [
      {
        title: '同样的情况又发生了',
        text: '最近又发生了……，之前也出现过类似的情况……。这几次的相似之处是……，我想梳理其中有哪些值得留意的影响。',
        icon: 0,
      },
      {
        title: '尝试调整仍然卡住',
        text: '我想改善的是……，已经尝试过……，当时的变化是……，但现在仍然卡在……。接下来我可以从哪里调整？',
        icon: 2,
      },
      {
        title: '想梳理事情的来龙去脉',
        text: '这件事最初是……，后来经历了……，现在让我困扰的是……。我希望梳理过去的影响，以及接下来值得留意的方向。',
        icon: 3,
      },
    ],
  },
] as const;

export type ReadingScene = (typeof readingScenes)[number];
export interface ReadingEntry {
  identity: string;
  spread?: Spread;
  scene?: ReadingScene;
  warning?: string;
}

/** Parse only entry parameters; drafts never come from arbitrary URL text. */
export function resolveReadingEntry(params: Pick<URLSearchParams, 'getAll'>): ReadingEntry {
  const scenes = params.getAll('scene');
  const selected = params.getAll('spread');
  if (scenes.length) {
    const scene = readingScenes.find((item) => item.id === scenes[0]);
    if (scenes.length !== 1 || selected.length || !scene) {
      return { identity: 'general', warning: '场景入口无效，请写下问题后重新选择牌阵。' };
    }
    return { identity: `scene:${scene.id}`, scene, spread: getSpreadById(scene.spreadId) };
  }
  if (selected.length) {
    const spread = selected.length === 1 ? getSpreadById(selected[0]) : undefined;
    return spread
      ? { identity: `spread:${spread.id}`, spread }
      : { identity: 'general', warning: '未找到该牌阵，请重新选择。' };
  }
  return { identity: 'general' };
}
