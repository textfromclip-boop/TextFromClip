import { VideoProviderAdapter, ProviderCapability } from './base';
import { TranscriptResult, CloudflareBindings } from '../../types';
import { generateSrt, generateVtt } from '../utils/formatters';
import { parseTikTokSubtitlePayload } from './tiktok';
import { transcribeMediaWithWhisper } from '../utils/whisper-fallback';

export interface InstagramShortcodeMedia {
  id?: string;
  shortcode?: string;
  is_video?: boolean;
  video_url?: string;
  video_duration?: number;
  video_subtitles_uri?: string;
  owner?: {
    username?: string;
  };
  edge_media_to_caption?: {
    edges?: Array<{ node?: { text?: string } }>;
  };
}

export interface InstagramMediaPayload {
  graphql?: {
    shortcode_media?: InstagramShortcodeMedia;
  };
  data?: {
    xdt_shortcode_media?: InstagramShortcodeMedia;
  };
  items?: Array<{
    pk?: string;
    code?: string;
    video_duration?: number;
    video_versions?: Array<{ url?: string }>;
    video_subtitles_uri?: string;
    user?: { username?: string };
    caption?: { text?: string };
  }>;
  require_login?: boolean;
  status?: string;
  message?: string;
}

const MOBILE_SAFARI_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Sec-Fetch-Site': 'same-origin',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Dest': 'empty',
};

export class InstagramProvider implements VideoProviderAdapter {
  id = 'instagram';
  name = 'Instagram Reels';

  capabilities: ProviderCapability = {
    id: 'instagram',
    name: 'Instagram Reels & Videos',
    supportsCaptions: true,
    supportsAiWhisper: true,
    exampleUrl: 'https://www.instagram.com/reel/C1234567890/',
  };

  matches(url: string): boolean {
    try {
      const parsed = new URL(url);
      const host = parsed.hostname.toLowerCase();
      return host === 'instagram.com' || host === 'www.instagram.com';
    } catch {
      return false;
    }
  }

  extractVideoId(url: string): string | null {
    try {
      const parsed = new URL(url);
      const match = parsed.pathname.match(/\/(?:reel|reels|p)\/([a-zA-Z0-9_-]+)/);
      if (match && match[1]) {
        return match[1];
      }
    } catch {
      return null;
    }
    return null;
  }

  async getTranscript(
    url: string,
    preferredLanguage: string = 'en',
    env: CloudflareBindings
  ): Promise<TranscriptResult> {
    const shortcode = this.extractVideoId(url);
    if (!shortcode) {
      throw new Error('Could not extract a valid Instagram Reel or post shortcode from the URL.');
    }

    const igHeaders: Record<string, string> = {
      ...MOBILE_SAFARI_HEADERS,
      'X-IG-App-ID': '936619743392459',
      'X-ASBD-ID': '129477',
      'X-IG-WWW-Claim': '0',
      Referer: `https://www.instagram.com/reel/${shortcode}/`,
    };

    if (env.IG_SESSION_ID) {
      igHeaders['Cookie'] = `sessionid=${env.IG_SESSION_ID}`;
    }

    let mediaData: InstagramMediaPayload | null = null;

    // 1. Attempt Instagram's ?__a=1&__d=dis JSON query endpoint
    try {
      const a1Res = await fetch(`https://www.instagram.com/reel/${shortcode}/?__a=1&__d=dis`, {
        headers: igHeaders,
        redirect: 'manual',
      });
      if (a1Res.ok && (a1Res.headers.get('content-type') || '').includes('application/json')) {
        mediaData = (await a1Res.json()) as InstagramMediaPayload;
      }
    } catch {
      // Fall through to GraphQL query
    }

    // 2. Fallback to Instagram internal GraphQL query (doc_id=10015901848480474)
    if (!mediaData || mediaData.require_login || mediaData.status === 'fail') {
      try {
        const gqlBody = new URLSearchParams({
          variables: JSON.stringify({ shortcode }),
          doc_id: '10015901848480474',
          lsd: 'AVqbxe3J_YA',
        });
        const gqlRes = await fetch('https://www.instagram.com/api/graphql', {
          method: 'POST',
          headers: {
            ...igHeaders,
            'Content-Type': 'application/x-www-form-urlencoded',
            'X-FB-LSD': 'AVqbxe3J_YA',
          },
          body: gqlBody.toString(),
          redirect: 'manual',
        });
        if (gqlRes.ok && (gqlRes.headers.get('content-type') || '').includes('application/json')) {
          mediaData = (await gqlRes.json()) as InstagramMediaPayload;
        }
      } catch {
        // Handled below
      }
    }

    if (!mediaData || mediaData.require_login || mediaData.status === 'fail') {
      throw new Error(
        'Instagram Reels public caption retrieval is blocked by Meta authentication requirements (require_login: true). In accordance with our accuracy policy, we never generate synthetic mock transcripts. Please upload or link directly via YouTube or direct MP4/audio URL.'
      );
    }

    const firstItem = mediaData.items?.[0];
    const node: InstagramShortcodeMedia | undefined =
      mediaData.graphql?.shortcode_media ??
      mediaData.data?.xdt_shortcode_media ??
      (firstItem
        ? {
            id: firstItem.pk,
            shortcode: firstItem.code || shortcode,
            video_url: firstItem.video_versions?.[0]?.url,
            video_duration: firstItem.video_duration,
            video_subtitles_uri: firstItem.video_subtitles_uri,
            owner: { username: firstItem.user?.username },
            edge_media_to_caption: firstItem.caption?.text
              ? { edges: [{ node: { text: firstItem.caption.text } }] }
              : undefined,
          }
        : undefined);

    if (!node) {
      throw new Error(
        'Instagram Reels public caption retrieval is blocked by Meta authentication requirements. No media metadata was returned for this Reel.'
      );
    }

    const author = node.owner?.username ? `@${node.owner.username}` : 'Instagram';
    const postCaption = node.edge_media_to_caption?.edges?.[0]?.node?.text?.trim() || '';
    const videoTitle = postCaption
      ? `${author}: ${postCaption.slice(0, 110)}${postCaption.length > 110 ? '…' : ''}`
      : `${author} — Instagram Reel ${shortcode}`;
    const durationSeconds = Number(node.video_duration) || 0;

    // 3. Primary path: Native subtitle track if exposed by Instagram
    if (node.video_subtitles_uri) {
      const subRes = await fetch(node.video_subtitles_uri, { headers: MOBILE_SAFARI_HEADERS });
      if (subRes.ok) {
        const subText = await subRes.text();
        const segments = parseTikTokSubtitlePayload(subText);
        if (segments.length > 0) {
          const fullText = segments.map((s) => s.text).join(' ').trim();
          return {
            id: crypto.randomUUID(),
            provider: 'instagram',
            videoId: shortcode,
            videoTitle,
            videoDurationSeconds: durationSeconds,
            sourceType: 'captions',
            language: preferredLanguage,
            segments,
            fullText,
            srt: generateSrt(segments),
            vtt: generateVtt(segments),
            createdAt: Date.now(),
          };
        }
      }
    }

    // 4. Fallback path: Cloudflare Workers AI Whisper (@cf/openai/whisper) using video_url
    if (node.video_url) {
      return transcribeMediaWithWhisper({
        provider: 'instagram',
        videoId: shortcode,
        videoTitle,
        videoDurationSeconds: durationSeconds,
        language: preferredLanguage,
        candidateMediaUrls: [node.video_url],
        mediaHeaders: MOBILE_SAFARI_HEADERS,
        env,
      });
    }

    throw new Error(
      'Neither a native subtitle track nor a downloadable video stream was returned by Instagram for this Reel.'
    );
  }
}
