'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  groupChatExchanges,
  messagePreview,
  messageStatus,
  type ChatHistoryExchange,
  type ChatHistoryMessage,
} from '@/lib/chatHistory';
import { InterpretationBody } from '../reading/Interpretation';
import { RitualIcon } from '../drawing/RitualScene';
import theme from './HistoryArchive.module.css';
import styles from './ChatHistoryArchive.module.css';

const time = (value: string) =>
  new Date(value).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
const day = (value: string) =>
  new Date(value).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });

export function ChatHistoryArchive({ messages }: { messages: ChatHistoryMessage[] }) {
  const groups = useMemo(() => groupChatExchanges(messages), [messages]);
  const days = new Map<string, ChatHistoryExchange[]>();
  for (const group of groups) {
    const date = day(group.createdAt);
    if (!days.has(date)) days.set(date, []);
    days.get(date)!.push(group);
  }
  return (
    <div className={styles.archive}>
      {[...days].map(([date, entries]) => (
        <section key={date} aria-label={date}>
          <div className={theme.month}>
            <h2>
              <RitualIcon name="calendar" />
              {date}
            </h2>
            <span className={theme.monthRule} aria-hidden="true" />
          </div>
          {entries.map((group) => (
            <Exchange key={group.id} group={group} initiallyOpen={group.id === groups[0]?.id} />
          ))}
        </section>
      ))}
    </div>
  );
}

function Exchange({
  group,
  initiallyOpen,
}: {
  group: ChatHistoryExchange;
  initiallyOpen: boolean;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  const id = useId();
  const questions = group.messages.filter((message) => message.role === 'user');
  const replies = group.messages.filter((message) => message.role === 'assistant');
  const question =
    questions[0]?.content || (replies.length ? '回复记录（提问尚未载入）' : '未记录提问');
  const reply = replies[0];
  const status = reply && messageStatus(reply);
  return (
    <article className={styles.exchange} data-open={open}>
      <button
        type="button"
        className={styles.toggle}
        aria-expanded={open}
        aria-controls={id}
        aria-label={`${open ? '收起' : '展开'}对话：${question}`}
        onClick={() => setOpen((value) => !value)}
      >
        <span className={styles.userStamp}>
          {questions.length ? '我' : '回复'} ·{' '}
          <time dateTime={questions[0]?.createdAt ?? group.createdAt}>
            {time(questions[0]?.createdAt ?? group.createdAt)}
          </time>
        </span>
        <span className={styles.toggleHint}>
          {open && '收起'}
          <RitualIcon name={open ? 'chevron-left' : 'chevron-right'} />
        </span>
        <span className={styles.question}>{question}</span>
        {!open && (
          <span className={styles.preview}>
            回复：{reply ? messagePreview(reply.content) || '尚无回复内容' : '回复尚未载入'}
          </span>
        )}
        {!open && status && (
          <span className={styles.status}>
            {status}
            {reply?.content.trim() ? ' · 内容已保存' : ''}
          </span>
        )}
      </button>
      <div id={id} className={styles.exchangeBody} hidden={!open}>
        {open && (
          <>
            {questions.slice(1).map((message) => (
              <p key={message.id} className={styles.extraQuestion}>
                我 · {time(message.createdAt)}
                <br />
                {message.content}
              </p>
            ))}
            {replies.map((message) => (
              <SavedReply key={message.id} message={message} />
            ))}
            {!replies.length && <p className={styles.status}>回复尚未载入，可加载更早记录查看。</p>}
          </>
        )}
      </div>
    </article>
  );
}

function SavedReply({ message }: { message: ChatHistoryMessage }) {
  const [expanded, setExpanded] = useState(false);
  const [overflow, setOverflow] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const status = messageStatus(message);
  const preview = messagePreview(message.content);
  useEffect(() => {
    const element = contentRef.current;
    if (!element || expanded) return;
    const measure = () => setOverflow(element.scrollHeight > element.clientHeight + 2);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [message.content, expanded]);
  return (
    <section className={styles.reply} aria-label={`回复 ${time(message.createdAt)}`}>
      <div className={styles.replyStamp}>
        回复 · <time dateTime={message.createdAt}>{time(message.createdAt)}</time>
        <RitualIcon name="feather" />
      </div>
      {preview ? (
        <>
          <div
            id={id}
            ref={contentRef}
            className={`${styles.prose} ${!expanded ? styles.excerpt : ''}`}
          >
            <InterpretationBody content={message.content} />
          </div>
          {(overflow || expanded) && (
            <button
              type="button"
              className={styles.expand}
              aria-expanded={expanded}
              aria-controls={id}
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded ? '收起回复' : '展开完整回复'}
              <RitualIcon name={expanded ? 'chevron-left' : 'chevron-right'} />
            </button>
          )}
        </>
      ) : (
        <p className={styles.status}>尚无回复内容</p>
      )}
      {status && (
        <p className={styles.status}>
          {status}
          {preview ? ' · 内容已保存' : ''}
        </p>
      )}
    </section>
  );
}
