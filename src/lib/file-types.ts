import {
  FileArchiveIcon,
  FileIcon,
  FileTextIcon,
  FilmIcon,
  ImageIcon,
  MusicIcon,
  type LucideIcon,
} from "lucide-react";
import type { FileCategory } from "./types";

const EXT: Record<Exclude<FileCategory, "other">, string[]> = {
  video: ["mp4", "mov", "avi", "mkv", "wmv", "m4v", "webm", "mpg", "mpeg", "3gp", "flv", "mts", "m2ts", "vob"],
  image: [
    "jpg", "jpeg", "png", "gif", "bmp", "tif", "tiff", "heic", "heif", "webp", "svg", "psd", "ai", "eps",
    "raw", "cr2", "cr3", "nef", "arw", "dng", "orf", "rw2", "raf",
  ],
  audio: ["mp3", "wav", "m4a", "aac", "flac", "ogg", "wma", "aiff", "aif"],
  archive: ["zip", "rar", "7z", "tar", "gz", "tgz", "bz2", "xz", "iso", "dmg", "cab", "img"],
  document: [
    "doc", "docx", "docm", "xls", "xlsx", "xlsm", "xlsb", "ppt", "pptx", "pptm", "pdf", "txt", "rtf", "odt",
    "ods", "odp", "csv", "one", "vsd", "vsdx", "msg", "eml", "md", "pages", "numbers", "key", "pub", "xml", "json",
  ],
};

const EXT_LOOKUP = new Map<string, FileCategory>(
  Object.entries(EXT).flatMap(([cat, exts]) => exts.map((e) => [e, cat as FileCategory] as const)),
);

export const RAW_IMAGE_EXT = new Set(["raw", "cr2", "cr3", "nef", "arw", "dng", "orf", "rw2", "raf", "psd", "tif", "tiff"]);
export const INSTALLER_EXT = new Set(["exe", "msi", "dmg", "pkg", "iso", "apk", "msix", "appx", "img"]);
/** Formats the desktop app can re-encode in place (same container/extension, so links keep working). */
export const COMPRESSIBLE_VIDEO_EXT = new Set(["mp4", "m4v", "mov", "mkv", "mts", "m2ts"]);
export const COMPRESSIBLE_IMAGE_EXT = new Set(["jpg", "jpeg", "png", "webp"]);

export function isCompressible(f: { category: FileCategory; ext: string }) {
  return (f.category === "video" && COMPRESSIBLE_VIDEO_EXT.has(f.ext)) || (f.category === "image" && COMPRESSIBLE_IMAGE_EXT.has(f.ext));
}
export const OFFICE_EXT = new Set(["docx", "docm", "xlsx", "xlsm", "xlsb", "pptx", "pptm", "doc", "xls", "ppt", "one", "vsdx", "pdf"]);

export function getExtension(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i + 1).toLowerCase() : "";
}

export function categorize(name: string, mimeType?: string, facets?: { video?: boolean; image?: boolean; audio?: boolean }): FileCategory {
  if (facets?.video) return "video";
  if (facets?.image) return "image";
  if (facets?.audio) return "audio";
  const byExt = EXT_LOOKUP.get(getExtension(name));
  if (byExt) return byExt;
  if (mimeType?.startsWith("video/")) return "video";
  if (mimeType?.startsWith("image/")) return "image";
  if (mimeType?.startsWith("audio/")) return "audio";
  return "other";
}

export const CATEGORY_ORDER: FileCategory[] = ["video", "image", "document", "archive", "audio", "other"];

export const CATEGORY_META: Record<FileCategory, { label: string; plural: string; color: string; icon: LucideIcon }> = {
  video: { label: "Video", plural: "Videos", color: "var(--chart-1)", icon: FilmIcon },
  image: { label: "Bild", plural: "Bilder", color: "var(--chart-2)", icon: ImageIcon },
  document: { label: "Dokument", plural: "Dokumente", color: "var(--chart-3)", icon: FileTextIcon },
  archive: { label: "Archiv", plural: "Archive", color: "var(--chart-4)", icon: FileArchiveIcon },
  audio: { label: "Audio", plural: "Audio", color: "var(--chart-5)", icon: MusicIcon },
  other: { label: "Sonstige", plural: "Sonstige", color: "var(--chart-6)", icon: FileIcon },
};
