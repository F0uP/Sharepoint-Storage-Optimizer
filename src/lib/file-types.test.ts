import { describe, expect, it } from "vitest";
import { categorize, getExtension } from "./file-types";

describe("getExtension", () => {
  it("returns the lower-case last extension", () => {
    expect(getExtension("Report.PDF")).toBe("pdf");
    expect(getExtension("backup.tar.gz")).toBe("gz");
  });

  it("ignores dotfiles and names without extension", () => {
    expect(getExtension(".DS_Store")).toBe("");
    expect(getExtension("README")).toBe("");
  });
});

describe("categorize", () => {
  it.each([
    ["clip.MP4", "video"],
    ["photo.heic", "image"],
    ["shooting.cr3", "image"],
    ["song.flac", "audio"],
    ["backup.7z", "archive"],
    ["budget.xlsx", "document"],
    ["setup.exe", "other"],
  ])("%s → %s", (name, category) => {
    expect(categorize(name)).toBe(category);
  });

  it("prefers Graph facets over the extension", () => {
    expect(categorize("noext", undefined, { video: true })).toBe("video");
    expect(categorize("noext", undefined, { image: true })).toBe("image");
  });

  it("falls back to the MIME type", () => {
    expect(categorize("download", "video/quicktime")).toBe("video");
    expect(categorize("download", "image/png")).toBe("image");
    expect(categorize("download", "application/octet-stream")).toBe("other");
  });
});
