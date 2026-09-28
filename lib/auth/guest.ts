import { apiFetch } from '@/lib/api/client';

const STORAGE_KEY = 'tarot_guest_credential';
let memoryCredential: string | undefined;
let pendingLogin: Promise<void> | undefined;

function guestCredential(): string {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && /^[a-f0-9]{64}$/.test(stored)) return (memoryCredential = stored);
  } catch {
    /* Storage may be disabled; retain this tab's identity in memory. */
  }
  memoryCredential ??= Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
  try {
    localStorage.setItem(STORAGE_KEY, memoryCredential);
  } catch {
    /* Use memory. */
  }
  return memoryCredential;
}

export function loginAsGuest(): Promise<void> {
  // Strict Mode and route transitions must share the same cookie exchange.
  pendingLogin ??= apiFetch<void>('/api/auth/guest', {
    method: 'POST',
    body: JSON.stringify({ credential: guestCredential() }),
  }).finally(() => {
    pendingLogin = undefined;
  });
  return pendingLogin;
}
