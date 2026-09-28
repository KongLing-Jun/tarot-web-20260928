/**
 * 安全的随机 ID 生成。
 *
 * crypto.randomUUID() 仅在安全上下文（HTTPS / localhost）可用；
 * 通过局域网 IP 或纯 HTTP 访问时它是 undefined，直接调用会抛错。
 * 这些 ID 只用作消息/占卜记录标识；服务端按登录用户隔离，不能用于身份认证。
 */
export function genId(): string {
  // 用户身份、会话令牌由服务端的 node:crypto 单独生成。
  return (
    globalThis.crypto?.randomUUID?.() ??
    `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  );
}
