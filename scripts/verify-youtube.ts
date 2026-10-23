import { YouTubeProvider } from '../src/server/providers/youtube.ts';

async function verify() {
  const provider = new YouTubeProvider();
  const testUrl = 'https://www.youtube.com/watch?v=jNQXAC9IVRw'; // "Me at the zoo" - First YouTube video, has captions

  console.log(`[Verify] Testing real transcript extraction for: ${testUrl}`);
  try {
    const result = await provider.getTranscript(testUrl, 'en', {} as any);
    console.log(`[Verify] SUCCESS!`);
    console.log(`Title: ${result.videoTitle}`);
    console.log(`Provider: ${result.provider}`);
    console.log(`Source Type: ${result.sourceType}`);
    console.log(`Language: ${result.language}`);
    console.log(`Duration: ${result.videoDurationSeconds}s`);
    console.log(`Segment count: ${result.segments.length}`);
    console.log(`First segment:`, result.segments[0]);
    console.log(`Full text preview: "${result.fullText.slice(0, 100)}..."`);
    console.log(`SRT preview:\n${result.srt.slice(0, 150)}...`);
  } catch (err) {
    console.error(`[Verify] Extraction failed:`, err);
  }
}

verify();

