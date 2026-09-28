import { numberSetting, readSettings } from '@/scripts/config.mjs';

/** Public timeout policy only; never return the underlying runtime settings. */
export function getStreamSettings() {
  const config = readSettings();
  const upstreamTimeoutMs = numberSetting(config, 'UPSTREAM_TIMEOUT_MS');
  const chunkTimeoutMs = numberSetting(config, 'STREAM_CHUNK_TIMEOUT_MS');
  const heartbeatMs = numberSetting(config, 'STREAM_HEARTBEAT_MS');
  const totalTimeoutMs = Object.hasOwn(config, 'STREAM_TOTAL_TIMEOUT_MS')
    ? numberSetting(config, 'STREAM_TOTAL_TIMEOUT_MS')
    : upstreamTimeoutMs + chunkTimeoutMs;
  const maxRetries = Object.hasOwn(config, 'STREAM_MAX_RETRIES') ? config.STREAM_MAX_RETRIES : 2;
  if (!Number.isSafeInteger(maxRetries) || maxRetries < 0)
    throw new Error('STREAM_MAX_RETRIES 必须是非负整数');
  const retryBaseMs = Object.hasOwn(config, 'STREAM_RETRY_BASE_MS')
    ? numberSetting(config, 'STREAM_RETRY_BASE_MS')
    : 1000;
  return {
    upstreamTimeoutMs,
    chunkTimeoutMs,
    heartbeatMs,
    totalTimeoutMs,
    maxRetries,
    retryBaseMs,
  };
}

export function getPublicStreamSettings() {
  const settings = getStreamSettings();
  return {
    connectTimeoutMs: settings.upstreamTimeoutMs + settings.heartbeatMs,
    streamIdleTimeoutMs: settings.chunkTimeoutMs + settings.heartbeatMs,
    progressTimeoutMs: settings.chunkTimeoutMs,
    totalTimeoutMs: settings.totalTimeoutMs + settings.heartbeatMs,
    maxRetries: settings.maxRetries,
    retryBaseMs: settings.retryBaseMs,
  };
}
