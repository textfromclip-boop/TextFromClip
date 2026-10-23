export type SupportedPlatformId = 'youtube' | 'tiktok' | 'instagram';

export interface PlatformValidationResult {
  isValid: boolean;
  error?: string;
  detectedPlatform?: 'youtube' | 'tiktok' | 'instagram' | 'direct_media' | 'unknown';
}

/**
 * Detect which video platform a given URL belongs to, if any.
 */
export function detectPlatformFromUrl(
  rawUrl: string
): 'youtube' | 'tiktok' | 'instagram' | 'direct_media' | 'unknown' {
  try {
    const parsed = new URL(rawUrl.trim());
    const hostname = parsed.hostname.toLowerCase().replace(/^www\./, '');
    const pathname = parsed.pathname.toLowerCase();

    if (
      hostname === 'youtube.com' ||
      hostname.endsWith('.youtube.com') ||
      hostname === 'youtu.be' ||
      hostname === 'youtube-nocookie.com'
    ) {
      return 'youtube';
    }

    if (
      hostname === 'tiktok.com' ||
      hostname.endsWith('.tiktok.com') ||
      hostname === 'vm.tiktok.com' ||
      hostname === 'vt.tiktok.com'
    ) {
      return 'tiktok';
    }

    if (hostname === 'instagram.com' || hostname.endsWith('.instagram.com')) {
      return 'instagram';
    }

    if (/\.(mp4|webm|mp3|wav|m4a|ogg|aac)($|\?)/i.test(pathname)) {
      return 'direct_media';
    }

    return 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Validates that a user-entered URL matches the currently selected platform.
 * Rejects mismatched platforms, unsupported domains, and malformed inputs with clear messages.
 */
export function validateUrlForPlatform(
  rawUrl: string,
  platformId: SupportedPlatformId
): PlatformValidationResult {
  const trimmed = (rawUrl || '').trim();

  if (!trimmed) {
    const platformLabel =
      platformId === 'youtube'
        ? 'YouTube'
        : platformId === 'tiktok'
        ? 'TikTok'
        : 'Instagram Reel';
    return {
      isValid: false,
      error: `Please enter a ${platformLabel} link.`,
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return {
      isValid: false,
      error: 'Please enter a valid link starting with https://',
    };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      isValid: false,
      error: 'Invalid URL protocol. Links must start with https://',
    };
  }

  const detected = detectPlatformFromUrl(trimmed);

  if (platformId === 'youtube') {
    if (detected === 'youtube' || detected === 'direct_media') {
      return { isValid: true, detectedPlatform: detected };
    }
    if (detected === 'tiktok') {
      return {
        isValid: false,
        error: 'That link is from TikTok. Please switch to the TikTok tab or paste a YouTube link here.',
        detectedPlatform: detected,
      };
    }
    if (detected === 'instagram') {
      return {
        isValid: false,
        error: 'That link is from Instagram. Please switch to the Instagram tab or paste a YouTube link here.',
        detectedPlatform: detected,
      };
    }
    return {
      isValid: false,
      error: 'Unsupported platform. The YouTube tab accepts YouTube links and direct audio/video files (.mp4, .mp3).',
      detectedPlatform: detected,
    };
  }

  if (platformId === 'tiktok') {
    if (detected === 'tiktok') {
      return { isValid: true, detectedPlatform: detected };
    }
    if (detected === 'youtube') {
      return {
        isValid: false,
        error: 'That link is from YouTube. Please switch to the YouTube tab or paste a TikTok link here.',
        detectedPlatform: detected,
      };
    }
    if (detected === 'instagram') {
      return {
        isValid: false,
        error: 'That link is from Instagram. Please switch to the Instagram tab or paste a TikTok link here.',
        detectedPlatform: detected,
      };
    }
    return {
      isValid: false,
      error: 'Unsupported platform. The TikTok tab only accepts public TikTok video links.',
      detectedPlatform: detected,
    };
  }

  if (platformId === 'instagram') {
    if (detected === 'instagram') {
      return { isValid: true, detectedPlatform: detected };
    }
    if (detected === 'youtube') {
      return {
        isValid: false,
        error: 'That link is from YouTube. Please switch to the YouTube tab or paste an Instagram Reel link here.',
        detectedPlatform: detected,
      };
    }
    if (detected === 'tiktok') {
      return {
        isValid: false,
        error: 'That link is from TikTok. Please switch to the TikTok tab or paste an Instagram Reel link here.',
        detectedPlatform: detected,
      };
    }
    return {
      isValid: false,
      error: 'Unsupported platform. The Instagram tab only accepts public Instagram Reel links.',
      detectedPlatform: detected,
    };
  }

  return {
    isValid: false,
    error: 'Unsupported platform.',
    detectedPlatform: detected,
  };
}

