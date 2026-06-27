// Thin OpenRouter chat client for the agent-simulation harness ONLY.
// The my-kioku CLI never calls this — it's a test driver that makes a small model
// follow SKILL.md. Credentials come from the environment (.env, gitignored); the
// key is never hardcoded or logged.

export interface ChatOptions {
  system?: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
  /** Ask the model for a JSON object response (OpenRouter response_format). */
  json?: boolean;
  /** Per-call timeout in ms (default 45s) — a slow model can't hang the harness. */
  timeoutMs?: number;
}

export interface ChatResult {
  content: string;
  totalTokens: number;
}

/** Read required OpenRouter config from env; throw a clear error if missing. */
export function openRouterEnv(): {
  apiKey: string;
  model: string;
  referer: string;
  title: string;
} {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENROUTER_API_KEY not set. Copy .env.example → .env and fill it in (the sim needs it; the CLI does not).",
    );
  }
  return {
    apiKey,
    model: process.env.OPENROUTER_MODEL ?? "qwen/qwen3.6-flash",
    referer: process.env.OPENROUTER_REFERER ?? "https://github.com/phuc-nt/my-kioku",
    title: process.env.OPENROUTER_TITLE ?? "my-kioku-agent-sim",
  };
}

/** One chat completion. Throws on HTTP/API error so the harness fails loudly. */
export async function chat(opts: ChatOptions): Promise<ChatResult> {
  const env = openRouterEnv();
  const messages = [
    ...(opts.system ? [{ role: "system", content: opts.system }] : []),
    { role: "user", content: opts.user },
  ];
  const body: Record<string, unknown> = {
    model: env.model,
    messages,
    max_tokens: opts.maxTokens ?? 800,
    temperature: opts.temperature ?? 0,
  };
  if (opts.json) body.response_format = { type: "json_object" };

  // Per-call timeout so a slow model (long-body entries) can't hang the harness.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 45_000);
  let res: Response;
  try {
    res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": env.referer,
        "X-Title": env.title,
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    throw new Error(`OpenRouter HTTP ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as {
    error?: { message: string };
    choices?: { message?: { content?: string } }[];
    usage?: { total_tokens?: number };
  };
  if (data.error) throw new Error(`OpenRouter error: ${data.error.message}`);
  return {
    content: data.choices?.[0]?.message?.content ?? "",
    totalTokens: data.usage?.total_tokens ?? 0,
  };
}

/** Parse a JSON object from a model reply, tolerating ```json fences / prose. */
export function parseJsonReply<T>(content: string): T | null {
  // Strip code fences if present, then grab the first {...} or [...] block.
  const cleaned = content.replace(/```(?:json)?/gi, "").trim();
  const start = cleaned.search(/[[{]/);
  if (start < 0) return null;
  // Find the matching last bracket of the same kind.
  const open = cleaned[start];
  const close = open === "{" ? "}" : "]";
  const end = cleaned.lastIndexOf(close);
  if (end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}
