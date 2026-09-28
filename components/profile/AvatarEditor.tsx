'use client';

import { useRef, useState, type FormEvent } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useUser } from '../session/UserSession';
import { DEFAULT_AVATAR } from '@/lib/auth/profile';
import { prepareAvatar } from '@/lib/auth/avatar';

export function AvatarEditor({ currentAvatar }: { currentAvatar: string }) {
  const router = useRouter();
  const { updateProfile } = useUser();
  const [avatarUrl, setAvatarUrl] = useState(currentAvatar);
  const [saving, setSaving] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const busy = saving || processing;

  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy || avatarUrl === currentAvatar) return;
    setSaving(true);
    setError('');
    try {
      await updateProfile({ avatarUrl });
      router.push('/profile');
    } catch (error) {
      setError(error instanceof Error ? error.message : '保存失败，请重试');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} aria-label="更换头像" aria-busy={busy}>
      <fieldset disabled={busy} className="flex flex-col items-center gap-6 disabled:opacity-70">
        <Image
          unoptimized
          src={avatarUrl}
          width={256}
          height={256}
          alt="新头像预览"
          className="h-48 w-48 sm:h-64 sm:w-64 rounded-full object-cover border border-[var(--gold-faint)] bg-[var(--ink-veil)]"
        />
        <p id="avatar-hint" className="max-w-sm text-center text-sm text-bone-dim leading-relaxed">
          JPG、PNG 或 WebP，最大 5 MB。
          <br />
          图片将居中裁剪为正方形。
        </p>
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          className="btn-ink w-full sm:w-auto px-8 py-3 text-gold-warm"
        >
          {processing ? '正在处理…' : '选择图片'}
        </button>
        <input
          ref={fileInput}
          aria-label="上传头像"
          aria-describedby="avatar-hint"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={async (event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = '';
            if (!file) return;
            setProcessing(true);
            setError('');
            try {
              setAvatarUrl(await prepareAvatar(file));
            } catch (error) {
              setError(error instanceof Error ? error.message : '无法读取图片，请重试');
            } finally {
              setProcessing(false);
            }
          }}
        />
        <button
          data-small-action="text"
          type="button"
          onClick={() => {
            setAvatarUrl(DEFAULT_AVATAR);
            setError('');
          }}
          disabled={avatarUrl === DEFAULT_AVATAR}
          className="text-sm text-bone-dim py-2 disabled:opacity-40"
        >
          恢复默认头像
        </button>
        {error && (
          <p role="alert" className="text-center text-sm text-gold-warm">
            {error}
          </p>
        )}
        <div className="flex w-full flex-wrap justify-center gap-4 border-t border-[var(--ink-line)] pt-6">
          <button
            type="submit"
            disabled={avatarUrl === currentAvatar}
            className="btn-ink px-6 py-3 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving ? '正在保存…' : '保存头像'}
          </button>
          <button
            data-small-action="text"
            type="button"
            onClick={() => router.push('/profile')}
            className="px-6 py-3 text-sm text-bone-dim"
          >
            取消
          </button>
        </div>
      </fieldset>
    </form>
  );
}
