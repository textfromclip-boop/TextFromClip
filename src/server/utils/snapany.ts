export interface SnapAnyMediaResult {
  title?: string;
  author?: string;
  cover?: string;
  audioUrls: string[];
  videoUrls: string[];
}

const SNAPANY_API_URL = 'https://api.snapany.com/openapi/v1/extract/post';
const SNAPANY_YT_PROXY_URL = 'https://api.snapany.com/openapi/v1/youtube/proxy-download';

// Default key provided by administrator if not injected in env
export const DEFAULT_SNAPANY_KEY = 'sk_snapany_1e1edxpzly6nlcd2icd6g3pk424xeisd';

export async function extractMediaWithSnapAny(
  url: string,
  apiKey: string,
  isYouTube: boolean = false
): Promise<SnapAnyMediaResult | null> {
  const key = apiKey || DEFAULT_SNAPANY_KEY;
  if (!key) return null;

  try {
    const headers = {
      Authorization: `Bearer ${key.trim()}`,
      'Content-Type': 'application/json',
    };

    const res = await fetch(SNAPANY_API_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({ url }),
    });

    if (!res.ok) {
      const errText = await res.text();
      let errJson: any = null;
      try {
        errJson = JSON.parse(errText);
      } catch {}

      if (errJson?.code === 'insufficient_credits') {
        throw new Error(
          'Media extraction credits exhausted on SnapAny. Please top up your SnapAny account balance at platform.snapany.com.'
        );
      }
      return null;
    }

    const data: any = await res.json();
    if (!data) return null;

    const audioUrls: string[] = [];
    const videoUrls: string[] = [];

    if (Array.isArray(data.medias)) {
      for (const m of data.medias) {
        const targetUrl = m.proxy_url || m.resource_url || m.url;
        if (typeof targetUrl === 'string' && targetUrl.startsWith('http')) {
          if (m.media_type === 'audio') {
            audioUrls.push(targetUrl);
          } else {
            videoUrls.push(targetUrl);
          }
        }
      }
    }

    // If it's YouTube and no direct media was found, try YouTube proxy download
    if (isYouTube && audioUrls.length === 0 && videoUrls.length === 0) {
      try {
        const proxyRes = await fetch(SNAPANY_YT_PROXY_URL, {
          method: 'POST',
          headers,
          body: JSON.stringify({ url }),
        });
        if (proxyRes.ok) {
          const proxyData: any = await proxyRes.json();
          if (Array.isArray(proxyData?.medias)) {
            for (const m of proxyData.medias) {
              const targetUrl = m.proxy_url || m.resource_url || m.url;
              if (typeof targetUrl === 'string' && targetUrl.startsWith('http')) {
                if (m.media_type === 'audio') {
                  audioUrls.push(targetUrl);
                } else {
                  videoUrls.push(targetUrl);
                }
              }
            }
          }
        }
      } catch {
        // Fall through
      }
    }

    if (audioUrls.length === 0 && videoUrls.length === 0) {
      return null;
    }

    return {
      title: data.title || undefined,
      author: data.author || undefined,
      cover: data.cover || undefined,
      audioUrls,
      videoUrls,
    };
  } catch (err: any) {
    if (err.message && err.message.includes('SnapAny')) {
      throw err;
    }
    return null;
  }
}
