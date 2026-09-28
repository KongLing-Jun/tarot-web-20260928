export function loginReturnPath(value: string | null): string {
  if (
    !value ||
    value.length > 2000 ||
    !value.startsWith('/') ||
    /[\\\u0000-\u001f\u007f]/.test(value)
  )
    return '/';
  try {
    const url = new URL(value, 'https://tarot.invalid');
    if (url.origin !== 'https://tarot.invalid' || /^\/api(?:\/|$)/.test(url.pathname)) return '/';
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return '/';
  }
}
