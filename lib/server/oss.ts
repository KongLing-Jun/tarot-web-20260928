import OSS from 'ali-oss';
import { getServerSetting, getServerNumber } from '@/lib/api/server-config';

// Import only from server code and administrative scripts.
export function getOssConfig() {
  const read = (key: string) => {
    const value = getServerSetting(key);
    if (!value) throw new Error(`缺少服务端配置：${key}`);
    return value;
  };
  const region = read('OSS_REGION').replace(/^oss-/, '');
  const endpoint = read('OSS_ENDPOINT');
  const publicBaseUrl = read('OSS_PUBLIC_BASE_URL').replace(/\/+$/, '');
  for (const value of [endpoint, publicBaseUrl]) {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
      throw new Error('OSS 地址必须是无凭据的 HTTPS 地址');
    }
  }
  return {
    region: `oss-${region}`,
    endpoint,
    publicBaseUrl,
    bucket: read('OSS_BUCKET'),
    accessKeyId: read('ALIBABA_CLOUD_ACCESS_KEY_ID'),
    accessKeySecret: read('ALIBABA_CLOUD_ACCESS_KEY_SECRET'),
  };
}

export function createOssClient() {
  const { publicBaseUrl: _publicBaseUrl, ...config } = getOssConfig();
  void _publicBaseUrl;
  return new OSS({
    ...config,
    secure: true,
    authorizationV4: true,
    timeout: getServerNumber('OSS_TIMEOUT_MS'),
  });
}

export function ossObjectUrl(objectKey: string): string {
  return `${getOssConfig().publicBaseUrl}/${objectKey.split('/').map(encodeURIComponent).join('/')}`;
}

export async function putOssImage(
  objectKey: string,
  data: Buffer,
  contentType: string,
): Promise<string> {
  await createOssClient().put(objectKey, data, {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
  return ossObjectUrl(objectKey);
}
