import { driver, type DriveStep } from 'driver.js';
import styles from './ProductTour.module.css';

export interface TourEnd {
  reason: 'completed' | 'skipped' | 'interrupted';
  error?: string;
}

// Only trusted, static product copy belongs here: Driver.js renders strings as HTML.
const STOPS = [
  {
    target: 'conversation',
    title: '从一句心事开始',
    description:
      '写下正在困扰你的事。AI 会推荐牌阵、生成解读，你也可以接着追问，慢慢梳理自己的想法。',
  },
  {
    target: 'manual',
    title: '亲自选阵与抽牌',
    description:
      '想自己来，就从这里写下问题、选择牌阵，再洗牌与抽牌。下方「场景占卜」也能按主题开始。',
  },
  {
    target: 'daily',
    title: '留给今天的一张牌',
    description: '在「今日」查看每日一牌，写下当天的札记。给自己一点时间，留意此刻的感受。',
  },
  {
    target: 'library',
    title: '读懂与珍藏牌面',
    description:
      '在「牌典」浏览 78 张塔罗牌，查看关键词与正逆位含义。遇到喜欢的牌，可以点书签收藏。',
  },
  {
    target: 'history',
    title: '回看走过的轨迹',
    description:
      '在「轨迹」回看已保存的解读与聊天记录。想再看这份指引，随时到「我的」找到「新手指引」。',
  },
] as const;

function visibleTarget(target: string): HTMLElement | undefined {
  return Array.from(document.querySelectorAll<HTMLElement>(`[data-tour="${target}"]`)).find(
    (element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return (
        element.isConnected &&
        rect.width > 0 &&
        rect.height > 0 &&
        style.visibility !== 'hidden' &&
        style.display !== 'none'
      );
    },
  );
}

/** Wait for the existing, finite entry animations, never the ambient star field. */
export async function waitForTourTargets() {
  const entrances = new Set<Animation>();
  for (const stop of STOPS) {
    let element: HTMLElement | null = visibleTarget(stop.target) ?? null;
    while (element && element !== document.body) {
      for (const animation of element.getAnimations?.() ?? []) {
        if (
          animation.playState === 'running' &&
          Number.isFinite(animation.effect?.getComputedTiming().endTime)
        ) {
          entrances.add(animation);
        }
      }
      element = element.parentElement;
    }
  }
  await Promise.allSettled(Array.from(entrances, (animation) => animation.finished));
}

export function runProductTour({
  launcher,
  onEnd,
  restoreFocus,
}: {
  launcher: HTMLElement;
  onEnd: (result: TourEnd) => void;
  restoreFocus?: HTMLElement | null;
}): () => void {
  if (STOPS.some((stop) => !visibleTarget(stop.target))) throw new Error('Tour target unavailable');
  let ended = false;
  let error: string | undefined;
  let reason: TourEnd['reason'] = 'interrupted';
  let frame = 0;
  let dialog: HTMLElement | undefined;
  const backgrounds: { element: Element; hidden: string | null; inert: boolean }[] = [];

  // On short screens the wide homepage buttons leave no room at either side.
  // Keep the active button near the top, leaving space below for readable help.
  function prepareTarget(index: number) {
    if (index > 1 || window.innerHeight >= 480 || window.innerWidth >= 768) return;
    const element = visibleTarget(STOPS[index].target);
    if (!element) return;
    const top = element.getBoundingClientRect().top;
    if (top >= 16 && top <= 32) return;
    element.scrollIntoView({ block: 'start', behavior: 'instant' });
    window.scrollBy({ top: -24, behavior: 'instant' });
  }

  function finish() {
    if (ended) return;
    ended = true;
    cancelAnimationFrame(frame);
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('focusin', onFocus, true);
    document.removeEventListener('scroll', refresh, true);
    window.removeEventListener('resize', refresh);
    window.visualViewport?.removeEventListener('resize', refresh);
    window.visualViewport?.removeEventListener('scroll', refresh);
    observer.disconnect();
    for (const { element, hidden, inert } of backgrounds) {
      if (hidden === null) element.removeAttribute('aria-hidden');
      else element.setAttribute('aria-hidden', hidden);
      if (!inert) element.removeAttribute('inert');
    }
    onEnd({ reason, error });
    // Driver also restores its previous focus after onDestroyed. Run last.
    queueMicrotask(() => {
      const target = restoreFocus === undefined ? launcher : restoreFocus;
      if (
        target?.isConnected &&
        document.visibilityState !== 'hidden' &&
        target.getBoundingClientRect().width > 0
      )
        target.focus({ preventScroll: true });
    });
  }

  function acknowledge(outcome: 'completed' | 'skipped') {
    if (ended) return;
    reason = outcome;
    destroy();
  }

  function destroy() {
    tour.destroy();
    // Driver may skip onDestroyed before its first animation frame sets the
    // active step. Always restore the page and report the terminal outcome.
    finish();
  }

  function move(index: number) {
    if (index < 0 || index >= STOPS.length) return;
    if (!visibleTarget(STOPS[index].target)) {
      error = '这个入口暂时不可见，已结束指引。你可以稍后重新开启。';
      destroy();
      return;
    }
    prepareTarget(index);
    tour.moveTo(index);
  }

  const steps: DriveStep[] = STOPS.map((stop, index) => ({
    element: () => visibleTarget(stop.target)!,
    popover: {
      title: stop.title,
      description: stop.description,
      side: index < 2 ? 'bottom' : 'top',
      align: 'center',
    },
  }));
  const tour = driver({
    steps,
    animate: false,
    smoothScroll: false,
    allowClose: true,
    allowScroll: false,
    allowKeyboardControl: false,
    disableActiveInteraction: true,
    overlayColor: '#040308',
    overlayOpacity: 0.72,
    stagePadding: 5,
    stageRadius: 8,
    popoverOffset: 14,
    popoverClass: styles.popover,
    showProgress: true,
    progressText: '{{current}} / {{total}}',
    nextBtnText: '下一步',
    prevBtnText: '上一步',
    doneBtnText: '完成',
    onNextClick: () => move((tour.getActiveIndex() ?? 0) + 1),
    onPrevClick: () => move((tour.getActiveIndex() ?? 0) - 1),
    onDoneClick: () => acknowledge('completed'),
    onCloseClick: () => acknowledge('skipped'),
    overlayClickBehavior: () => acknowledge('skipped'),
    onDestroyed: finish,
    onPopoverRender: (popover, { index }) => {
      dialog = popover.wrapper;
      dialog.setAttribute('role', 'dialog');
      dialog.setAttribute('aria-modal', 'true');
      dialog.removeAttribute('aria-labelledby');
      dialog.setAttribute(
        'aria-label',
        `新手指引，第 ${(index ?? 0) + 1} 步，共 ${STOPS.length} 步：${STOPS[index ?? 0].title}`,
      );
      dialog.tabIndex = -1;
      popover.closeButton.textContent = '跳过';
      popover.closeButton.setAttribute('aria-label', '跳过，退出指引');
      popover.previousButton.disabled = index === 0;
      const eyebrow = document.createElement('p');
      eyebrow.className = styles.eyebrow;
      eyebrow.textContent = '初见 · 使用指引';
      popover.title.before(eyebrow);
      queueMicrotask(() => {
        if (!ended) {
          dialog?.focus({ preventScroll: true });
          refresh();
        }
      });
    },
  });

  function onKey(event: KeyboardEvent) {
    if (!dialog) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      acknowledge('skipped');
    } else if (event.key === 'Tab') {
      const buttons = Array.from(
        dialog.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
      ).filter((button) => button.getBoundingClientRect().width > 0);
      if (!buttons.length) return;
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.shiftKey
        ? index <= 0
          ? buttons.length - 1
          : index - 1
        : (index + 1) % buttons.length;
      event.preventDefault();
      event.stopImmediatePropagation();
      buttons[next].focus();
    } else if (!dialog.contains(event.target as Node)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }
  function onFocus(event: FocusEvent) {
    if (dialog && !dialog.contains(event.target as Node)) dialog.focus({ preventScroll: true });
  }
  function refresh() {
    if (ended || frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const stop = STOPS[tour.getActiveIndex() ?? 0];
      if (!visibleTarget(stop.target)) {
        error = '页面内容已变化，已结束指引。你可以重新开启。';
        destroy();
        return;
      }
      prepareTarget(tour.getActiveIndex() ?? 0);
      tour.refresh();
    });
  }
  const observer = new ResizeObserver(refresh);
  try {
    prepareTarget(0);
    tour.drive();
    for (const element of Array.from(document.body.children)) {
      if (
        element === dialog ||
        element.classList.contains('driver-overlay') ||
        ['SCRIPT', 'STYLE', 'LINK'].includes(element.tagName)
      )
        continue;
      backgrounds.push({
        element,
        hidden: element.getAttribute('aria-hidden'),
        inert: element.hasAttribute('inert'),
      });
      element.setAttribute('aria-hidden', 'true');
      element.setAttribute('inert', '');
    }
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('focusin', onFocus, true);
    document.addEventListener('scroll', refresh, true);
    window.addEventListener('resize', refresh);
    window.visualViewport?.addEventListener('resize', refresh);
    window.visualViewport?.addEventListener('scroll', refresh);
    STOPS.forEach((stop) => observer.observe(visibleTarget(stop.target)!));
    return destroy;
  } catch (cause) {
    destroy();
    throw cause;
  }
}
