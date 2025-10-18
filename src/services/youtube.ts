import { Innertube, UniversalCache } from "youtubei.js";
import debug from "../utils/debug.js";

export interface YouTubeFormat {
  itag: number;
  url: string;
  mimeType: string;
  bitrate: number;
  audioBitrate?: number;
  audioSampleRate?: string;
  audioChannels?: number;
  quality: string;
  qualityLabel?: string;
  hasAudio: boolean;
  hasVideo: boolean;
  container: string;
  codecs: string;
  audioCodec?: string;
  videoCodec?: string;
  isLive: boolean;
}

export interface YouTubeVideoInfo {
  id: string;
  title: string;
  author: string;
  lengthSeconds: number;
  isLive: boolean;
  thumbnails: Array<{ url: string; width: number; height: number }>;
  formats: YouTubeFormat[];
  description?: string;
  viewCount?: number;
}

export class YouTubeError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "YouTubeError";
  }
}

/* eslint-disable @typescript-eslint/member-ordering */
export default class YouTubeService {
  private innertube: Innertube | null = null;
  private initPromise: Promise<void> | null = null;

  /**
   * Initialize the YouTube.js client
   * This is called automatically when needed
   */
  private async init(): Promise<void> {
    if (this.innertube) {
      return;
    }

    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = (async () => {
      try {
        debug("[YouTube.js] Initializing client...");
        const startTime = Date.now();

        this.innertube = await Innertube.create({
          cache: new UniversalCache(false),
          generate_session_locally: true,
        });

        const elapsed = Date.now() - startTime;
        debug(`[YouTube.js] Client initialized in ${elapsed}ms`);
      } catch (error: unknown) {
        const err = error as Error;
        debug(`[YouTube.js] Initialization failed: ${err.message}`);
        throw new YouTubeError(
          `Failed to initialize YouTube client: ${err.message}`,
        );
      }
    })();

    return this.initPromise;
  }

  /**
   * Get video information including available formats
   * @param videoId YouTube video ID or URL
   * @returns Video information
   */
  async getInfo(videoId: string): Promise<YouTubeVideoInfo> {
    await this.init();

    if (!this.innertube) {
      throw new YouTubeError("YouTube client not initialized");
    }

    const startTime = Date.now();
    debug(`[YouTube.js] Fetching info for: ${videoId}`);

    try {
      // Clean the video ID if it's a URL
      const cleanId = this.extractVideoId(videoId);

      const info = await this.innertube.getInfo(cleanId);
      const elapsed = Date.now() - startTime;

      debug(`[YouTube.js] Successfully fetched info in ${elapsed}ms`);
      debug(`[YouTube.js] Title: ${info.basic_info.title ?? "Unknown"}`);
      debug(`[YouTube.js] Author: ${info.basic_info.author ?? "Unknown"}`);
      debug(`[YouTube.js] Duration: ${info.basic_info.duration ?? 0}s`);
      debug(`[YouTube.js] Is live: ${String(info.basic_info.is_live)}`);

      // Extract and parse formats
      const formats = await this.parseFormats(info);
      debug(`[YouTube.js] Formats available: ${formats.length}`);

      return {
        id: info.basic_info.id ?? cleanId,
        title: info.basic_info.title ?? "Unknown Title",
        author: info.basic_info.author ?? "Unknown Author",
        lengthSeconds: info.basic_info.duration ?? 0,
        isLive: info.basic_info.is_live ?? false,
        thumbnails:
          info.basic_info.thumbnail?.map((t) => ({
            url: t.url,
            width: t.width,
            height: t.height,
          })) ?? [],
        formats,
        description: info.basic_info.short_description,
        viewCount: info.basic_info.view_count
          ? parseInt(String(info.basic_info.view_count), 10)
          : undefined,
      };
    } catch (error: unknown) {
      const elapsed = Date.now() - startTime;
      const err = error as { message: string; code?: string };

      debug(`[YouTube.js] Error after ${elapsed}ms: ${err.message}`);

      throw new YouTubeError(
        `Failed to fetch video info: ${err.message}`,
        err.code,
      );
    }
  }

  /**
   * Parse formats from YouTube.js response
   */
  /* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
  private async parseFormats(info: any): Promise<YouTubeFormat[]> {
    const formats: YouTubeFormat[] = [];

    try {
      // Get streaming data
      const streamingData = info.streaming_data;

      if (!streamingData) {
        debug("[YouTube.js] No streaming data available");
        return formats;
      }

      // Parse adaptive formats (audio and video separate)
      if (streamingData.adaptive_formats) {
        for (const format of streamingData.adaptive_formats) {
          const parsed = await this.parseFormat(
            format,
            info.basic_info.is_live || false,
          );

          if (parsed) {
            formats.push(parsed);
          }
        }
      }

      // Parse combined formats (audio + video)
      if (streamingData.formats) {
        for (const format of streamingData.formats) {
          const parsed = await this.parseFormat(
            format,
            info.basic_info.is_live || false,
          );

          if (parsed) {
            formats.push(parsed);
          }
        }
      }

      debug(`[YouTube.js] Parsed ${formats.length} total formats`);
    } catch (error: unknown) {
      const err = error as Error;
      debug(`[YouTube.js] Error parsing formats: ${err.message}`);
    }

    return formats;
  }
  /* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */

  /**
   * Parse a single format object
   */
  /* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
  private async parseFormat(
    format: any,
    isLive: boolean,
  ): Promise<YouTubeFormat | null> {
    const mimeType = format.mime_type ?? "";
    const mimeTypeParts = mimeType.split(";");
    const baseType = mimeTypeParts[0] ?? "";
    const container = baseType.split("/")[1] ?? "unknown";
    const codecsMatch = mimeType.match(/codecs="([^"]+)"/);
    const codecs = codecsMatch ? codecsMatch[1] : "";

    const audioCodec = this.extractAudioCodec(codecs);
    const videoCodec = this.extractVideoCodec(codecs);

    let url = typeof format.url === "string" ? format.url : "";

    if (!url && typeof format.decipher === "function") {
      try {
        url = await format.decipher(this.innertube?.session.player);
      } catch (error: unknown) {
        const err = error as Error;
        debug(
          `[YouTube.js] Failed to decipher format ${format.itag ?? "unknown"}: ${err.message}`,
        );
      }
    }

    if (!url) {
      debug(
        `[YouTube.js] Skipping format ${format.itag ?? "unknown"} due to missing URL`,
      );
      return null;
    }

    return {
      itag: format.itag ?? 0,
      url,
      mimeType,
      bitrate: format.bitrate ?? 0,
      audioBitrate: format.audio_bitrate,
      audioSampleRate: format.audio_sample_rate,
      audioChannels: format.audio_channels,
      quality: format.quality ?? "unknown",
      qualityLabel: format.quality_label,
      hasAudio: format.has_audio ?? false,
      hasVideo: format.has_video ?? false,
      container,
      codecs,
      audioCodec,
      videoCodec,
      isLive,
    };
  }
  /* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */

  /**
   * Extract audio codec from codecs string
   */
  private extractAudioCodec(codecs: string): string | undefined {
    const audioCodecs = ["opus", "mp4a", "vorbis", "aac"];
    const lowerCodecs = codecs.toLowerCase();

    for (const codec of audioCodecs) {
      if (lowerCodecs.includes(codec)) {
        return codec;
      }
    }

    return undefined;
  }

  /**
   * Extract video codec from codecs string
   */
  private extractVideoCodec(codecs: string): string | undefined {
    const videoCodecs = ["avc1", "vp9", "vp8", "av01"];
    const lowerCodecs = codecs.toLowerCase();

    for (const codec of videoCodecs) {
      if (lowerCodecs.includes(codec)) {
        return codec;
      }
    }

    return undefined;
  }

  /**
   * Get the best audio format for Discord playback
   * Prioritizes: opus @ 48kHz > highest bitrate audio-only
   */
  getBestAudioFormat(info: YouTubeVideoInfo): YouTubeFormat | null {
    debug(
      `[YouTube.js] Selecting best audio format from ${info.formats.length} available formats`,
    );

    const audioFormats = info.formats.filter((f) => f.hasAudio && !f.hasVideo);

    if (audioFormats.length === 0) {
      debug("[YouTube.js] No audio-only formats available");
      return null;
    }

    debug(`[YouTube.js] Found ${audioFormats.length} audio-only formats`);

    // For live streams, prefer specific high-quality formats
    if (info.isLive) {
      const liveFormats = audioFormats
        .filter((f) => f.isLive)
        .sort((a, b) => (b.audioBitrate ?? 0) - (a.audioBitrate ?? 0));

      if (liveFormats.length > 0) {
        debug(
          `[YouTube.js] Selected live audio format: itag ${liveFormats[0].itag} (${liveFormats[0].audioBitrate ?? 0} kbps)`,
        );
        return liveFormats[0];
      }
    }

    // Prefer opus codec in webm container @ 48kHz (best for Discord)
    const opusFormats = audioFormats.filter(
      (f) =>
        f.audioCodec === "opus" &&
        f.container === "webm" &&
        f.audioSampleRate === "48000",
    );

    if (opusFormats.length > 0) {
      const bestOpus = opusFormats.sort(
        (a, b) => (b.audioBitrate ?? 0) - (a.audioBitrate ?? 0),
      )[0];
      debug(
        `[YouTube.js] Selected opus format: itag ${bestOpus.itag} (${bestOpus.audioBitrate ?? 0} kbps)`,
      );
      return bestOpus;
    }

    // Fallback to highest bitrate audio format
    const bestAudio = audioFormats.sort(
      (a, b) => (b.audioBitrate ?? 0) - (a.audioBitrate ?? 0),
    )[0];
    debug(
      `[YouTube.js] Selected best audio format: itag ${bestAudio.itag} (${bestAudio.audioBitrate ?? 0} kbps)`,
    );

    return bestAudio;
  }

  /**
   * Extract video ID from URL or return as-is if already an ID
   */
  private extractVideoId(videoIdOrUrl: string): string {
    // Already a video ID
    if (
      videoIdOrUrl.length === 11 &&
      !videoIdOrUrl.includes("/") &&
      !videoIdOrUrl.includes("?")
    ) {
      return videoIdOrUrl;
    }

    // Try to extract from URL
    const patterns = [
      /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/,
      /^([a-zA-Z0-9_-]{11})$/,
    ];

    for (const pattern of patterns) {
      const match = videoIdOrUrl.match(pattern);
      if (match?.[1]) {
        return match[1];
      }
    }

    // Return as-is and let YouTube.js handle the error
    return videoIdOrUrl;
  }

  /**
   * Download audio stream
   * @param videoId YouTube video ID or URL
   * @returns Readable stream
   */
  async downloadAudio(videoId: string): Promise<ReadableStream<Uint8Array>> {
    await this.init();

    if (!this.innertube) {
      throw new YouTubeError("YouTube client not initialized");
    }

    const cleanId = this.extractVideoId(videoId);
    debug(`[YouTube.js] Downloading audio for: ${cleanId}`);

    try {
      const stream = await this.innertube.download(cleanId, {
        type: "audio",
        quality: "best",
        format: "opus",
      });

      debug("[YouTube.js] Audio stream created successfully");
      return stream;
    } catch (error: unknown) {
      const err = error as Error;
      debug(`[YouTube.js] Failed to create audio stream: ${err.message}`);
      throw new YouTubeError(`Failed to download audio: ${err.message}`);
    }
  }

  /**
   * Search for videos
   * @param query Search query
   * @param limit Maximum number of results
   * @returns Array of video info
   */
  async search(query: string, limit = 10): Promise<YouTubeVideoInfo[]> {
    await this.init();

    if (!this.innertube) {
      throw new YouTubeError("YouTube client not initialized");
    }

    debug(`[YouTube.js] Searching for: ${query} (limit: ${limit})`);

    try {
      const results = await this.innertube.search(query, {
        type: "video",
      });

      const videos: YouTubeVideoInfo[] = [];

      // Fetch video info in parallel instead of sequentially
      const videoPromises = results.videos
        .slice(0, limit)
        .filter((item) => item.type === "Video" && "id" in item && item.id)
        .map(async (item) => {
          if ("id" in item && item.id) {
            try {
              return await this.getInfo(item.id);
            } catch (error: unknown) {
              debug(
                `[YouTube.js] Failed to get info for video ${item.id}: ${(error as Error).message}`,
              );
              return null;
            }
          }

          return null;
        });

      const results_ = await Promise.all(videoPromises);
      videos.push(...results_.filter((v): v is YouTubeVideoInfo => v !== null));

      debug(`[YouTube.js] Found ${videos.length} videos`);
      return videos;
    } catch (error: unknown) {
      const err = error as Error;
      debug(`[YouTube.js] Search failed: ${err.message}`);
      throw new YouTubeError(`Search failed: ${err.message}`);
    }
  }
}
