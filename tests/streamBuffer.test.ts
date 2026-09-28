import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStreamTextBuffer } from '@/lib/api/stream-buffer';

describe('createStreamTextBuffer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('publishes the first chunk immediately and batches subsequent appends', () => {
    const updates: string[] = [];
    const buf = createStreamTextBuffer((text) => updates.push(text), { intervalMs: 80 });

    buf.append('a');
    buf.append('b');
    buf.append('c');
    expect(updates).toEqual(['a']);

    vi.advanceTimersByTime(80);
    expect(updates).toEqual(['a', 'abc']);
    expect(buf.getText()).toBe('abc');

    buf.dispose();
  });

  it('flush emits immediately and clears the pending timer', () => {
    const updates: string[] = [];
    const buf = createStreamTextBuffer((text) => updates.push(text), { intervalMs: 80 });

    buf.append('hello');
    buf.append(' world');
    buf.flush();
    expect(updates).toEqual(['hello', 'hello world']);

    vi.advanceTimersByTime(80);
    expect(updates).toEqual(['hello', 'hello world']);

    buf.dispose();
  });

  it('dispose prevents further updates', () => {
    const updates: string[] = [];
    const buf = createStreamTextBuffer((text) => updates.push(text), { intervalMs: 80 });

    buf.append('x');
    buf.append('pending');
    buf.dispose();
    vi.advanceTimersByTime(80);
    expect(updates).toEqual(['x']);

    buf.append('y');
    buf.flush();
    expect(updates).toEqual(['x']);
  });

  it('reset cancels the old batch and publishes the next first chunk immediately', () => {
    const updates: string[] = [];
    const buf = createStreamTextBuffer((text) => updates.push(text));
    buf.append('old');
    buf.append(' pending');
    buf.reset();
    expect(buf.getText()).toBe('');
    buf.append('new');
    expect(updates).toEqual(['old', 'new']);
    vi.advanceTimersByTime(80);
    expect(updates).toEqual(['old', 'new']);
    buf.dispose();
  });

  it('empty appends do not consume the immediate first update', () => {
    const update = vi.fn();
    const buf = createStreamTextBuffer(update);
    buf.append('');
    expect(update).not.toHaveBeenCalled();
    buf.append('answer');
    expect(update).toHaveBeenCalledExactlyOnceWith('answer');
    buf.dispose();
  });
});
