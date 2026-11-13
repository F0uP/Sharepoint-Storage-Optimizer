import { execFile } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { compressImage, compressVideo, findFfmpeg, isFfmpegPath, loadSharp, uploadToSession, videoArgs } from "./media.mjs";

const run = promisify(execFile);
const root = path.resolve(import.meta.dirname, "..");
const ffmpeg = await findFfmpeg();
const sharp = loadSharp(root);

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "spo-media-test-"));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("isFfmpegPath", () => {
  it("only accepts paths to an ffmpeg binary", () => {
    expect(isFfmpegPath("C:/Tools/ffmpeg/bin/ffmpeg.exe")).toBe(true);
    expect(isFfmpegPath("/opt/homebrew/bin/ffmpeg")).toBe(true);
    expect(isFfmpegPath("C:/Windows/System32/cmd.exe")).toBe(false);
    expect(isFfmpegPath("/bin/sh")).toBe(false);
  });
});

describe("videoArgs", () => {
  it("re-encodes to H.264/AAC in the same container", () => {
    const args = videoArgs("in.mov", "out.mov", "balanced");
    expect(args).toEqual(expect.arrayContaining(["-c:v", "libx264", "-crf", "23", "-c:a", "aac", "-movflags", "+faststart"]));
    expect(args.at(-1)).toBe("out.mov");
  });

  it("downscales to Full HD in strong mode and skips mp4-only flags for other containers", () => {
    const args = videoArgs("in.mkv", "out.mkv", "strong");
    expect(args).toEqual(expect.arrayContaining(["-crf", "28", "-vf", "scale='min(1920,iw)':-2"]));
    expect(args).not.toContain("-movflags");
  });
});

describe.skipIf(!ffmpeg.available)("compressVideo (ffmpeg)", () => {
  it("makes a high-bitrate video considerably smaller", async () => {
    const input = path.join(dir, "input.mp4");
    const output = path.join(dir, "output.mp4");
    // 3 s of noise at near-lossless quality – a stand-in for raw camera footage
    await run(ffmpeg.path!, [
      "-hide_banner", "-y", "-f", "lavfi", "-i", "testsrc2=duration=3:size=1280x720:rate=30",
      "-c:v", "libx264", "-qp", "4", "-pix_fmt", "yuv420p", input,
    ]);
    const fractions: number[] = [];
    await compressVideo(ffmpeg.path!, input, output, "balanced", (f) => fractions.push(f));
    const before = (await stat(input)).size;
    const after = (await stat(output)).size;
    expect(after).toBeLessThan(before * 0.5);
    expect(Math.max(...fractions)).toBeGreaterThan(0.5);
  }, 120_000);
});

describe.skipIf(!sharp)("compressImage (sharp)", () => {
  it("recompresses a large JPEG", async () => {
    const input = path.join(dir, "photo.jpg");
    const output = path.join(dir, "photo-small.jpg");
    const width = 3000;
    const height = 2000;
    const noise = Buffer.alloc(width * height * 3);
    for (let i = 0; i < noise.length; i++) noise[i] = (i * 2654435761) % 251;
    const create = sharp as unknown as (input: Buffer, options: object) => { jpeg(o: object): { toFile(f: string): Promise<unknown> } };
    await create(noise, { raw: { width, height, channels: 3 } }).jpeg({ quality: 100 }).toFile(input);
    await compressImage(sharp!, input, output, "strong");
    expect((await stat(output)).size).toBeLessThan((await stat(input)).size * 0.8);
  }, 60_000);
});

describe("uploadToSession", () => {
  it("refuses targets outside SharePoint", async () => {
    await expect(uploadToSession(path.join(dir, "x"), "https://evil.example.com/upload")).rejects.toThrow(/nicht erlaubt/);
  });
});
