import { execFile, spawn } from "node:child_process";
import { open, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { isAllowedSource } from "./backup.mjs";

/**
 * Media compression for the desktop app: videos with ffmpeg (installed by the user – not bundled for
 * licensing reasons), images with sharp (already part of the bundled Next.js server).
 * Pure Node – unit-tested directly.
 */

export type Quality = "balanced" | "strong";

export interface FfmpegInfo {
  available: boolean;
  path?: string;
  version?: string;
}

function knownLocations(): string[] {
  if (process.platform === "win32") {
    const local = process.env.LOCALAPPDATA ?? "";
    return [path.join(local, "Microsoft", "WinGet", "Links", "ffmpeg.exe"), "C:\\ffmpeg\\bin\\ffmpeg.exe"];
  }
  // apps started from Finder don't get the shell's PATH
  return ["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/usr/bin/ffmpeg"];
}

function versionOf(bin: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(bin, ["-hide_banner", "-version"], { timeout: 8000, windowsHide: true }, (error, stdout) => {
      if (error) return resolve(null);
      const match = /ffmpeg version (\S+)/.exec(stdout);
      resolve(match ? match[1] : null);
    });
  });
}

export async function findFfmpeg(configured?: string): Promise<FfmpegInfo> {
  const candidates = [configured?.trim(), "ffmpeg", ...knownLocations()].filter((c): c is string => Boolean(c));
  for (const candidate of candidates) {
    const version = await versionOf(candidate);
    if (version) return { available: true, path: candidate, version };
  }
  return { available: false };
}

/** ffmpeg arguments: H.264/AAC in the same container, so name and links stay the same. */
export function videoArgs(input: string, output: string, quality: Quality): string[] {
  const ext = path.extname(output).slice(1).toLowerCase();
  return [
    "-hide_banner",
    "-y",
    "-i",
    input,
    "-map",
    "0:v:0",
    "-map",
    "0:a?",
    ...(quality === "strong" ? ["-vf", "scale='min(1920,iw)':-2"] : []),
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-crf",
    quality === "strong" ? "28" : "23",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-map_metadata",
    "0",
    ...(["mp4", "m4v", "mov"].includes(ext) ? ["-movflags", "+faststart"] : []),
    "-progress",
    "pipe:1",
    "-nostats",
    output,
  ];
}

function seconds(time: string): number {
  const [h, m, s] = time.split(":").map(Number);
  return h * 3600 + m * 60 + s;
}

export function compressVideo(
  ffmpeg: string,
  input: string,
  output: string,
  quality: Quality,
  onProgress?: (fraction: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, videoArgs(input, output, quality), { windowsHide: true });
    let duration = 0;
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-4000);
      const match = /Duration: (\d+:\d+:\d+\.\d+)/.exec(stderr);
      if (match && !duration) duration = seconds(match[1]);
    });
    child.stdout.on("data", (chunk: Buffer) => {
      const match = /out_time_us=(\d+)/.exec(chunk.toString());
      if (match && duration) onProgress?.(Math.min(1, Number(match[1]) / 1e6 / duration));
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg ist mit Code ${code} beendet: ${stderr.trim().split("\n").at(-1) ?? ""}`));
    });
  });
}

type SharpFactory = (input: string, options?: object) => {
  autoOrient(): ReturnType<SharpFactory>;
  resize(options: object): ReturnType<SharpFactory>;
  withMetadata(options?: object): ReturnType<SharpFactory>;
  jpeg(options: object): ReturnType<SharpFactory>;
  png(options: object): ReturnType<SharpFactory>;
  webp(options: object): ReturnType<SharpFactory>;
  toFile(file: string): Promise<unknown>;
};

/** sharp from the bundled server's node_modules (native build for this platform), or null. */
export function loadSharp(baseDir: string): SharpFactory | null {
  try {
    return createRequire(path.join(baseDir, "package.json"))("sharp") as SharpFactory;
  } catch {
    return null;
  }
}

export async function compressImage(sharp: SharpFactory, input: string, output: string, quality: Quality): Promise<void> {
  const ext = path.extname(output).slice(1).toLowerCase();
  const maxEdge = quality === "strong" ? 2560 : 4096;
  // rotate pixels according to EXIF, then mark them as upright – keeps the photo the right way round
  let image = sharp(input, { failOn: "none" })
    .autoOrient()
    .resize({ width: maxEdge, height: maxEdge, fit: "inside", withoutEnlargement: true })
    .withMetadata({ orientation: 1 });
  if (ext === "jpg" || ext === "jpeg") image = image.jpeg({ quality: quality === "strong" ? 70 : 82, mozjpeg: true });
  else if (ext === "png") image = image.png({ compressionLevel: 9, effort: 8, palette: quality === "strong", quality: 80 });
  else if (ext === "webp") image = image.webp({ quality: quality === "strong" ? 70 : 80 });
  else throw new Error(`Bildformat .${ext} wird nicht unterstützt`);
  await image.toFile(output);
}

/** 32 × 320 KiB – Graph requires chunk sizes in multiples of 320 KiB. */
const CHUNK = 32 * 320 * 1024;

/** Uploads a file into a Graph upload session (pre-authenticated URL) in chunks. */
export async function uploadToSession(file: string, uploadUrl: string, onProgress?: (done: number, total: number) => void) {
  if (uploadUrl.startsWith("data:") || !isAllowedSource(uploadUrl)) throw new Error("Upload-Ziel nicht erlaubt");
  const { size } = await stat(file);
  const handle = await open(file, "r");
  try {
    for (let start = 0; start < size; start += CHUNK) {
      const end = Math.min(size, start + CHUNK) - 1;
      const buffer = Buffer.alloc(end - start + 1);
      await handle.read(buffer, 0, buffer.length, start);
      const res = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Range": `bytes ${start}-${end}/${size}` },
        body: buffer,
      });
      if (![200, 201, 202].includes(res.status)) {
        const text = await res.text().catch(() => "");
        throw new Error(`Upload fehlgeschlagen (HTTP ${res.status}) ${text.slice(0, 200)}`);
      }
      onProgress?.(end + 1, size);
    }
  } finally {
    await handle.close();
  }
}
