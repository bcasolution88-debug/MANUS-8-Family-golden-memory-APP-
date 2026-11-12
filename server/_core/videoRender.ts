/**
 * P7 — server-side slideshow renderer (ffmpeg).
 *
 * Turns N photos (+ optional title card) into an H.264 MP4 with Ken Burns
 * zoom and cross-fades. Everything runs in a temp dir and is cleaned up.
 *
 *   downloads (signed URLs) → per-slide clips (zoompan) → xfade chain → mp4 + poster
 *
 * Requires `ffmpeg` on PATH (Debian: apt install ffmpeg fonts-noto-cjk).
 */
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

export type RenderTransition = "fade" | "slideleft" | "wipeleft" | "circleopen" | "dissolve";

/**
 * P8 — procedurally generated background music (no licensed assets needed).
 * Each mood is a small chord of sine voices with gentle tremolo, low-passed
 * and faded in / out. Deterministic and royalty-free.
 */
export type MusicMood = "none" | "romance" | "joy" | "adventure" | "celebration" | "classic";

interface MusicVoice {
  freq: number;
  tremoloHz: number;
  tremoloDepth: number;
  volume: number;
}

const MUSIC_PRESETS: Record<Exclude<MusicMood, "none">, { voices: MusicVoice[]; lowpass: number }> = {
  // A minor pad (A3 C4 E4)
  romance: { voices: [{ freq: 220, tremoloHz: 0.35, tremoloDepth: 0.3, volume: 0.12 }, { freq: 261.6, tremoloHz: 0.25, tremoloDepth: 0.35, volume: 0.08 }, { freq: 329.6, tremoloHz: 0.2, tremoloDepth: 0.3, volume: 0.06 }], lowpass: 900 },
  // C major, brighter and bouncier (C4 E4 G4)
  joy: { voices: [{ freq: 261.6, tremoloHz: 2.0, tremoloDepth: 0.5, volume: 0.1 }, { freq: 329.6, tremoloHz: 1.5, tremoloDepth: 0.4, volume: 0.08 }, { freq: 392, tremoloHz: 1.0, tremoloDepth: 0.4, volume: 0.07 }], lowpass: 1800 },
  // D sus / open fifths (D3 A3 D4)
  adventure: { voices: [{ freq: 146.8, tremoloHz: 0.5, tremoloDepth: 0.4, volume: 0.13 }, { freq: 220, tremoloHz: 0.8, tremoloDepth: 0.5, volume: 0.09 }, { freq: 293.7, tremoloHz: 1.2, tremoloDepth: 0.4, volume: 0.06 }], lowpass: 1400 },
  // G major with faster pulse (G3 B3 D4 G4)
  celebration: { voices: [{ freq: 196, tremoloHz: 3.0, tremoloDepth: 0.6, volume: 0.1 }, { freq: 246.9, tremoloHz: 2.5, tremoloDepth: 0.5, volume: 0.08 }, { freq: 293.7, tremoloHz: 2.0, tremoloDepth: 0.5, volume: 0.07 }, { freq: 392, tremoloHz: 1.5, tremoloDepth: 0.4, volume: 0.05 }], lowpass: 2200 },
  // F major, slow and warm (F3 A3 C4)
  classic: { voices: [{ freq: 174.6, tremoloHz: 0.2, tremoloDepth: 0.25, volume: 0.13 }, { freq: 220, tremoloHz: 0.15, tremoloDepth: 0.3, volume: 0.09 }, { freq: 261.6, tremoloHz: 0.12, tremoloDepth: 0.25, volume: 0.06 }], lowpass: 800 },
};

export const MUSIC_MOODS = ["none", "romance", "joy", "adventure", "celebration", "classic"] as const satisfies readonly MusicMood[];

export interface RenderSlide {
  /** Fully qualified URL (signed) or local file path. */
  source: string;
  /** Optional caption drawn at the bottom. */
  caption?: string;
}

export interface RenderOptions {
  slides: RenderSlide[];
  title?: string;
  subtitle?: string;
  /** Seconds each photo stays on screen (incl. transition). 2–6. */
  secondsPerSlide?: number;
  transition?: RenderTransition;
  /** Accent colour for the title card, hex without '#'. */
  accent?: string;
  /** P8: generated background music mood (default "none"). */
  music?: MusicMood;
  /**
   * P10: user-supplied soundtrack (signed URL or local path, mp3/m4a/wav/aac,
   * ≤ 20 MB). Takes precedence over `music`; looped / trimmed to the video.
   */
  musicSource?: string;
  width?: number;
  height?: number;
  fps?: number;
  onProgress?: (done: number, total: number, stage: string) => void;
}

export interface RenderResult {
  videoPath: string;
  posterPath: string;
  durationSeconds: number;
  width: number;
  height: number;
  /** P8: whether an audio track was muxed in. */
  hasAudio: boolean;
  /** Call to delete the temp dir. */
  cleanup: () => Promise<void>;
}

const FONT_CANDIDATES = [
  "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
  "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
  "/usr/share/fonts/truetype/noto/NotoSansCJK-Bold.ttc",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
];

let cachedFont: string | null | undefined;
async function findFont(): Promise<string | null> {
  if (cachedFont !== undefined) return cachedFont;
  for (const candidate of FONT_CANDIDATES) {
    try {
      await access(candidate);
      cachedFont = candidate;
      return candidate;
    } catch {
      /* try next */
    }
  }
  cachedFont = null;
  return null;
}

let ffmpegAvailable: boolean | undefined;
export async function isFfmpegAvailable(): Promise<boolean> {
  if (ffmpegAvailable !== undefined) return ffmpegAvailable;
  try {
    await run("ffmpeg", ["-version"]);
    ffmpegAvailable = true;
  } catch {
    ffmpegAvailable = false;
  }
  return ffmpegAvailable;
}

function run(cmd: string, args: string[], timeoutMs = 120_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${cmd} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(`${cmd} exited ${code}: ${err.slice(-800)}`));
    });
  });
}

/** Escape text for ffmpeg drawtext (colons, quotes, backslashes, percent). */
function escapeDrawtext(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'")
    .replace(/%/g, "\\%")
    .replace(/\n/g, " ");
}

/** P10: soundtrack download (20 MB cap). */
async function downloadAudio(url: string, dest: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download soundtrack (${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength > MUSIC_MAX_BYTES) throw new Error("Soundtrack too large");
  await writeFile(dest, buf);
}

export const MUSIC_MAX_BYTES = 20 * 1024 * 1024;
export const MUSIC_CONTENT_TYPES = ["audio/mpeg", "audio/mp4", "audio/x-m4a", "audio/aac", "audio/wav", "audio/x-wav", "audio/ogg"] as const;

async function download(url: string, dest: string): Promise<void> {
  if (!/^https?:\/\//.test(url)) {
    // Local path — copy by reading (keeps the API uniform).
    await writeFile(dest, await readFile(url));
    return;
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download slide (${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength > 40 * 1024 * 1024) throw new Error("Slide image too large");
  await writeFile(dest, buf);
}

export async function renderSlideshow(opts: RenderOptions): Promise<RenderResult> {
  if (opts.slides.length === 0) throw new Error("At least one slide is required");
  if (opts.slides.length > 12) throw new Error("At most 12 slides are supported");

  const width = opts.width ?? 1280;
  const height = opts.height ?? 720;
  const fps = opts.fps ?? 25;
  const perSlide = Math.min(6, Math.max(2, opts.secondsPerSlide ?? 3));
  const xfade = 0.5;
  const transition: RenderTransition = opts.transition ?? "fade";
  const accent = (opts.accent ?? "D4AF37").replace(/[^0-9a-fA-F]/g, "").padEnd(6, "0").slice(0, 6);
  const font = await findFont();
  const music: MusicMood = opts.musicSource ? "none" : (opts.music ?? "none");
  const hasCustomMusic = !!opts.musicSource;
  const dir = await mkdtemp(path.join(tmpdir(), "gm-studio-"));
  const cleanup = () => rm(dir, { recursive: true, force: true });
  const report = (done: number, total: number, stage: string) => opts.onProgress?.(done, total, stage);

  try {
    const clips: string[] = [];
    const totalSteps = opts.slides.length * 2 + (opts.title ? 1 : 0) + 2 + (music !== "none" || hasCustomMusic ? 1 : 0);
    let step = 0;

    // 1. Title card
    if (opts.title) {
      const titleClip = path.join(dir, "c_title.mp4");
      const filters: string[] = [];
      if (font) {
        filters.push(
          `drawtext=fontfile='${font}':text='${escapeDrawtext(opts.title)}':fontcolor=0x${accent}:fontsize=${Math.round(height * 0.09)}:x=(w-text_w)/2:y=(h-text_h)/2-${Math.round(height * 0.06)}`,
        );
        if (opts.subtitle) {
          filters.push(
            `drawtext=fontfile='${font}':text='${escapeDrawtext(opts.subtitle)}':fontcolor=white:fontsize=${Math.round(height * 0.04)}:x=(w-text_w)/2:y=(h-text_h)/2+${Math.round(height * 0.07)}`,
          );
        }
      }
      filters.push("fade=t=in:st=0:d=0.6", "format=yuv420p");
      await run("ffmpeg", [
        "-hide_banner", "-loglevel", "error", "-y",
        "-f", "lavfi", "-i", `color=c=0x1a1a1a:s=${width}x${height}:d=${perSlide}`,
        "-vf", filters.join(","),
        "-r", String(fps), "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
        titleClip,
      ]);
      clips.push(titleClip);
      report(++step, totalSteps, "title");
    }

    // 2. Slides
    const frames = perSlide * fps;
    for (let i = 0; i < opts.slides.length; i++) {
      const slide = opts.slides[i]!;
      const src = path.join(dir, `s${i}.img`);
      await download(slide.source, src);
      report(++step, totalSteps, "download");
      const clip = path.join(dir, `c${i}.mp4`);
      // Alternate zoom-in / zoom-out for a gentle Ken Burns feel.
      const zoomExpr = i % 2 === 0 ? `min(1+0.0015*on,1.15)` : `max(1.15-0.0015*on,1)`;
      const vf: string[] = [
        `scale=${width}:${height}:force_original_aspect_ratio=increase`,
        `crop=${width}:${height}`,
        `zoompan=z='${zoomExpr}':d=${frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${width}x${height}:fps=${fps}`,
      ];
      if (slide.caption && font) {
        vf.push(
          `drawtext=fontfile='${font}':text='${escapeDrawtext(slide.caption)}':fontcolor=white:fontsize=${Math.round(height * 0.045)}:box=1:boxcolor=0x00000088:boxborderw=14:x=(w-text_w)/2:y=h-text_h-${Math.round(height * 0.08)}`,
        );
      }
      vf.push("format=yuv420p");
      await run("ffmpeg", [
        "-hide_banner", "-loglevel", "error", "-y",
        "-i", src,
        "-vf", vf.join(","),
        "-t", String(perSlide), "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
        clip,
      ]);
      clips.push(clip);
      report(++step, totalSteps, "slide");
    }

    // 3. Concatenate with xfade chain
    const silent = path.join(dir, "silent.mp4");
    const out = path.join(dir, "out.mp4");
    let durationSeconds = perSlide;
    if (clips.length === 1) {
      await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", clips[0]!, "-c", "copy", "-movflags", "+faststart", silent]);
    } else {
      const inputs = clips.flatMap((c) => ["-i", c]);
      const parts: string[] = [];
      let prev = "[0:v]";
      let offset = perSlide - xfade;
      for (let i = 1; i < clips.length; i++) {
        const label = i === clips.length - 1 ? "[v]" : `[v${i}]`;
        parts.push(`${prev}[${i}:v]xfade=transition=${transition}:duration=${xfade}:offset=${offset.toFixed(2)}${label}`);
        prev = label;
        offset += perSlide - xfade;
      }
      durationSeconds = clips.length * perSlide - (clips.length - 1) * xfade;
      await run(
        "ffmpeg",
        [
          "-hide_banner", "-loglevel", "error", "-y",
          ...inputs,
          "-filter_complex", parts.join(";"),
          "-map", "[v]",
          "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p",
          "-movflags", "+faststart",
          silent,
        ],
        300_000,
      );
    }
    report(++step, totalSteps, "concat");

    // 3a. P10: user-supplied soundtrack → loop/trim to length, fade, mux
    let hasAudio = false;
    if (hasCustomMusic) {
      const track = path.join(dir, "music_src");
      if (/^https?:\/\//.test(opts.musicSource!)) await downloadAudio(opts.musicSource!, track);
      else await writeFile(track, await readFile(opts.musicSource!));
      const fadeOutAt = Math.max(0, durationSeconds - 2).toFixed(2);
      await run("ffmpeg", [
        "-hide_banner", "-loglevel", "error", "-y",
        "-i", silent,
        "-stream_loop", "-1", "-i", track,
        "-filter_complex", `[1:a]volume=0.8,afade=t=in:st=0:d=1.5,afade=t=out:st=${fadeOutAt}:d=2[a]`,
        "-map", "0:v", "-map", "[a]",
        "-c:v", "copy", "-c:a", "aac", "-b:a", "128k", "-shortest",
        "-movflags", "+faststart",
        out,
      ], 300_000);
      hasAudio = true;
      report(++step, totalSteps, "music");
    } else if (music !== "none") {
      // 3b. P8: generated background music → mux (video stream copied)
      const preset = MUSIC_PRESETS[music];
      const inputs = preset.voices.flatMap((v) => [
        "-f", "lavfi", "-i",
        `sine=frequency=${v.freq}:sample_rate=44100,tremolo=f=${v.tremoloHz}:d=${v.tremoloDepth},volume=${v.volume}`,
      ]);
      const mixIn = preset.voices.map((_, i) => `[${i + 1}:a]`).join("");
      const fadeOutAt = Math.max(0, durationSeconds - 2).toFixed(2);
      await run("ffmpeg", [
        "-hide_banner", "-loglevel", "error", "-y",
        "-i", silent,
        ...inputs,
        "-filter_complex", `${mixIn}amix=inputs=${preset.voices.length}:duration=longest,lowpass=f=${preset.lowpass},afade=t=in:st=0:d=1.5,afade=t=out:st=${fadeOutAt}:d=2[a]`,
        "-map", "0:v", "-map", "[a]",
        "-c:v", "copy", "-c:a", "aac", "-b:a", "96k", "-shortest",
        "-movflags", "+faststart",
        out,
      ]);
      hasAudio = true;
      report(++step, totalSteps, "music");
    } else {
      await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", silent, "-c", "copy", "-movflags", "+faststart", out]);
    }

    // 4. Poster frame (first real slide, after the title card)
    const poster = path.join(dir, "poster.jpg");
    const posterAt = Math.min(durationSeconds - 0.1, (opts.title ? perSlide : 0) + 0.8);
    await run("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y",
      "-ss", posterAt.toFixed(2), "-i", out,
      "-frames:v", "1", "-vf", "scale=640:-2", "-q:v", "4",
      poster,
    ]);
    report(++step, totalSteps, "poster");

    return { videoPath: out, posterPath: poster, durationSeconds, width, height, hasAudio, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
