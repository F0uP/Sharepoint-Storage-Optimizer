/** Provider metadata shared by the browser (settings UI) and the server (API calls). */
export const PROVIDER_IDS = ["openai", "gemini"] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export const AI_PROVIDERS: Record<
  ProviderId,
  { label: string; defaultModel: string; keyUrl: string; keyPlaceholder: string }
> = {
  openai: {
    label: "OpenAI",
    defaultModel: "gpt-5.4-mini",
    keyUrl: "https://platform.openai.com/api-keys",
    keyPlaceholder: "sk-proj-…",
  },
  gemini: {
    label: "Google Gemini",
    defaultModel: "gemini-3.8-flash",
    keyUrl: "https://aistudio.google.com/apikey",
    keyPlaceholder: "AIza…",
  },
};

/** Header that carries an API key entered in the UI to this app's own server route. */
export const AI_KEY_HEADER = "x-ai-api-key";

/** Model ids like `gpt-5.4-mini`, `gemini-3.8-flash` or `models/gemini-…`. */
export const MODEL_PATTERN = /^[A-Za-z0-9][\w.:/-]{0,99}$/;

export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === "string" && (PROVIDER_IDS as readonly string[]).includes(value);
}
