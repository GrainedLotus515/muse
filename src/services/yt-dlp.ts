import { execFile } from "child_process";
import { promisify } from "util";
import debug from "../utils/debug.js";

const execFileAsync = promisify(execFile);

export interface YtDlpVideoFormat {
  format_id: string;
  url: string;
  ext: string;
  acodec: string;
  vcodec: string;
  abr?: number;
  asr?: number;
  tbr?: number;
  format_note?: string;
  quality?: number;
}

export interface YtDlpVideoInfo {
  id: string;
  title: string;
  url: string;
  formats: YtDlpVideoFormat[];
  duration: number;
  is_live: boolean;
  thumbnail?: string;
  uploader?: string;
  channel?: string;
}

export class YtDlpError extends Error {
  constructor(
    message: string,
    public readonly stderr?: string,
  ) {
    super(message);
    this.name = "YtDlpError";
  }
}

export default class YtDlpService {
  private readonly ytDlpPath: string;

  constructor(ytDlpPath = "yt-dlp") {
    this.ytDlpPath = ytDlpPath;
  }

  /**
   * Get video information using yt-dlp
   * @param url YouTube video URL or ID
   * @returns Video information including available formats
   */
  async getInfo(url: string): Promise<YtDlpVideoInfo> {
    const startTime = Date.now();
    debug(`[yt-dlp] Fetching info for: ${url}`);

    try {
      const { stdout, stderr } = await execFileAsync(
        this.ytDlpPath,
        [
          "--dump-json",
          "--no-playlist",
          "--no-warnings",
          "--skip-download",
          url,
        ],
        {
          maxBuffer: 10 * 1024 * 1024, // 10MB buffer
          timeout: 30000, // 30 second timeout
        },
      );

      if (stderr) {
        debug(`[yt-dlp] stderr: ${stderr}`);
      }

      const info = JSON.parse(stdout) as YtDlpVideoInfo;
      const elapsed = Date.now() - startTime;

      debug(`[yt-dlp] Successfully fetched info in ${elapsed}ms`);
      debug(`[yt-dlp] Title: ${info.title}`);
      debug(`[yt-dlp] Duration: ${info.duration}s`);
      debug(`[yt-dlp] Formats available: ${info.formats.length}`);
      debug(`[yt-dlp] Is live: ${String(info.is_live)}`);

      return info;
    } catch (error: unknown) {
      const elapsed = Date.now() - startTime;
      const err = error as {
        code?: string;
        stderr?: string;
        message: string;
        path?: string;
      };

      debug(`[yt-dlp] Error after ${elapsed}ms: ${err.message}`);

      if (err.stderr) {
        debug(`[yt-dlp] stderr: ${err.stderr}`);
      }

      if (err.code === "ENOENT") {
        throw new YtDlpError(
          "Failed to fetch video info: yt-dlp binary not found. Install yt-dlp (e.g. `pip install yt-dlp`) or set its path via the YT_DLP_PATH env var.",
        );
      }

      throw new YtDlpError(
        `Failed to fetch video info: ${err.message}`,
        err.stderr,
      );
    }
  }

  /**
   * Get the best audio format URL from video info
   * @param info Video information from getInfo
   * @returns Best audio format URL and metadata
   */
  getBestAudioFormat(
    info: YtDlpVideoInfo,
  ): { url: string; format: YtDlpVideoFormat } | null {
    debug(
      `[yt-dlp] Selecting best audio format from ${info.formats.length} available formats`,
    );

    // For live streams, prefer specific formats
    if (info.is_live) {
      const liveFormats = info.formats
        .filter((f) => f.acodec !== "none" && f.vcodec === "none" && f.url)
        .sort((a, b) => (b.abr ?? 0) - (a.abr ?? 0));

      if (liveFormats.length > 0) {
        debug(
          `[yt-dlp] Selected live audio format: ${liveFormats[0].format_id} (${liveFormats[0].abr ?? 0} kbps)`,
        );
        return { url: liveFormats[0].url, format: liveFormats[0] };
      }
    }

    // Prefer opus codec in webm container (best for Discord)
    const opusFormats = info.formats.filter(
      (f) =>
        f.acodec === "opus" &&
        f.ext === "webm" &&
        f.vcodec === "none" &&
        f.url &&
        f.asr === 48_000, // 48kHz sample rate
    );

    if (opusFormats.length > 0) {
      const bestOpus = opusFormats.sort(
        (a, b) => (b.abr ?? 0) - (a.abr ?? 0),
      )[0];
      debug(
        `[yt-dlp] Selected opus format: ${bestOpus.format_id} (${bestOpus.abr ?? 0} kbps)`,
      );
      return { url: bestOpus.url, format: bestOpus };
    }

    // Fallback to best audio-only format
    const audioOnlyFormats = info.formats
      .filter((f) => f.acodec !== "none" && f.vcodec === "none" && f.url)
      .sort((a, b) => (b.abr ?? b.tbr ?? 0) - (a.abr ?? a.tbr ?? 0));

    if (audioOnlyFormats.length > 0) {
      debug(
        `[yt-dlp] Selected audio-only format: ${audioOnlyFormats[0].format_id} (${audioOnlyFormats[0].abr ?? audioOnlyFormats[0].tbr ?? 0} kbps)`,
      );
      return { url: audioOnlyFormats[0].url, format: audioOnlyFormats[0] };
    }

    debug("[yt-dlp] No suitable audio format found");
    return null;
  }

  /**
   * Check if yt-dlp is available on the system
   * @returns true if yt-dlp is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      const { stdout } = await execFileAsync(this.ytDlpPath, ["--version"], {
        timeout: 5000,
      });
      debug(`[yt-dlp] Version: ${stdout.trim()}`);
      return true;
    } catch {
      debug("[yt-dlp] Not available on system");
      return false;
    }
  }

  /**
   * Get direct stream URL for a video
   * @param url YouTube video URL or ID
   * @returns Direct stream URL
   */
  async getStreamUrl(url: string): Promise<string> {
    debug(`[yt-dlp] Getting stream URL for: ${url}`);

    try {
      const { stdout, stderr } = await execFileAsync(
        this.ytDlpPath,
        [
          "--get-url",
          "--format",
          "bestaudio",
          "--no-playlist",
          "--no-warnings",
          url,
        ],
        {
          timeout: 30000,
        },
      );

      if (stderr) {
        debug(`[yt-dlp] stderr: ${stderr}`);
      }

      const streamUrl = stdout.trim();
      debug(`[yt-dlp] Got stream URL (length: ${streamUrl.length})`);

      return streamUrl;
    } catch (error: unknown) {
      const err = error as {
        code?: string;
        stderr?: string;
        message: string;
        path?: string;
      };
      debug(`[yt-dlp] Failed to get stream URL: ${err.message}`);

      if (err.code === "ENOENT") {
        throw new YtDlpError(
          "Failed to get stream URL: yt-dlp binary not found. Install yt-dlp or configure its path via YT_DLP_PATH.",
        );
      }

      throw new YtDlpError(
        `Failed to get stream URL: ${err.message}`,
        err.stderr,
      );
    }
  }
}
