'use client';

import { useEffect, useState, type RefObject } from 'react';

// 输入栏可能在提问、仪式和解读阶段挂载不同节点，阶段变化时重新测量。
export function useComposerViewport(ref: RefObject<HTMLDivElement | null>, phase: string) {
  const [keyboardInset, setKeyboardInset] = useState(0);
  const [composerHeight, setComposerHeight] = useState(0);
  useEffect(() => {
    const viewport = window.visualViewport;
    const update = () => {
      const inset = viewport
        ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)
        : 0;
      setKeyboardInset(inset > 80 ? inset : 0);
      setComposerHeight(ref.current?.getBoundingClientRect().height ?? 0);
    };
    const observer = new ResizeObserver(update);
    if (ref.current) observer.observe(ref.current);
    update();
    viewport?.addEventListener('resize', update);
    viewport?.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    return () => {
      observer.disconnect();
      viewport?.removeEventListener('resize', update);
      viewport?.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [ref, phase]);
  return { keyboardInset, composerHeight };
}
