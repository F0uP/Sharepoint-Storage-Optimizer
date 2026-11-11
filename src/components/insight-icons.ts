import {
  CopyIcon,
  EraserIcon,
  FilmIcon,
  HistoryIcon,
  HourglassIcon,
  ImageIcon,
  PackageIcon,
  SparklesIcon,
  type LucideIcon,
} from "lucide-react";
import type { InsightId } from "@/lib/analysis";

export const INSIGHT_ICONS: Record<InsightId, LucideIcon> = {
  duplicates: CopyIcon,
  versions: HistoryIcon,
  videos: FilmIcon,
  stale: HourglassIcon,
  archives: PackageIcon,
  images: ImageIcon,
  junk: EraserIcon,
  ai: SparklesIcon,
};
