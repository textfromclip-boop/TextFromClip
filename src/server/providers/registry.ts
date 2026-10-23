import { VideoProviderAdapter } from './base';
import { YouTubeProvider } from './youtube';
import { DirectMediaProvider } from './direct-media';
import { TikTokProvider } from './tiktok';
import { InstagramProvider } from './instagram';

export class ProviderRegistry {
  private static providers: VideoProviderAdapter[] = [
    new YouTubeProvider(),
    new DirectMediaProvider(),
    new TikTokProvider(),
    new InstagramProvider(),
  ];

  public static getProviders(): VideoProviderAdapter[] {
    return this.providers;
  }

  public static findProvider(url: string): VideoProviderAdapter | null {
    for (const provider of this.providers) {
      if (provider.matches(url)) {
        return provider;
      }
    }
    return null;
  }

  public static getPlatformList() {
    return this.providers.map((p) => ({
      id: p.id,
      name: p.name,
      capabilities: p.capabilities,
      isFullyOperational: p.id === 'youtube' || p.id === 'direct_media' || p.id === 'tiktok',
    }));
  }
}

