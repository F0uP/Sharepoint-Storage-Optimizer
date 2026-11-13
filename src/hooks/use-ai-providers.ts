import { useMemo } from "react";
import { aiProviders, useSettings } from "@/lib/settings";

/** AI providers usable right now (keys from the settings or server presets). */
export function useAiProviders() {
  const settings = useSettings((s) => s.settings);
  const server = useSettings((s) => s.server);
  return useMemo(() => aiProviders({ settings, server }), [settings, server]);
}
