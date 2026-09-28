export const NICKNAME_HINT = '1–40 个字符，支持中文、表情和空格，可随时修改';
export function isValidNickname(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    Array.from(value.trim()).length >= 1 &&
    Array.from(value.trim()).length <= 40 &&
    !/[\p{Cc}\p{Zl}\p{Zp}]/u.test(value)
  );
}
export const DEFAULT_AVATAR = '/avatars/default.svg';
export const MAX_AVATAR_BYTES = 512 * 1024;

// Count calendar days in Beijing time, including the account creation day.
export function companionDays(createdAt: string | undefined, now = new Date()): number {
  if (!createdAt) return 0;
  const created = new Date(createdAt).getTime();
  const current = now.getTime();
  if (!Number.isFinite(created) || !Number.isFinite(current) || created > current) return 0;
  const day = 24 * 60 * 60 * 1000;
  const offset = 8 * 60 * 60 * 1000;
  return Math.floor((current + offset) / day) - Math.floor((created + offset) / day) + 1;
}

export interface ProfileUpdate {
  nickname?: string;
  avatarUrl?: string;
}
