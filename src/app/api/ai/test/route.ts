import { authErrorResponse, privateJson, requireUser } from "@/lib/auth";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const TEST_PROMPT = "Reply with: Band Setlist AI is connected.";
const TEST_MODEL = process.env.OPENAI_TEST_MODEL || "gpt-5-nano";

function extractResponseText(payload: unknown) {
  if (!payload || typeof payload !== "object") return null;
  const outputText = (payload as { output_text?: unknown }).output_text;
  if (typeof outputText === "string" && outputText.trim()) return outputText.trim();

  const output = (payload as { output?: unknown }).output;
  if (!Array.isArray(output)) return null;
  const parts: string[] = [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const contentItem of content) {
      if (!contentItem || typeof contentItem !== "object") continue;
      const text = (contentItem as { text?: unknown }).text;
      if (typeof text === "string" && text.trim()) parts.push(text.trim());
    }
  }
  return parts.join(" ").trim() || null;
}

export async function POST() {
  try {
    await requireUser();
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return privateJson({ ok: false, error: "OPENAI_API_KEY is not configured" });
    }

    const response = await fetch(OPENAI_RESPONSES_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: TEST_MODEL,
        input: TEST_PROMPT,
        max_output_tokens: 32,
      }),
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const error =
        payload && typeof payload === "object" && "error" in payload
          ? (payload as { error?: { message?: string } }).error?.message
          : null;
      return privateJson({ ok: false, error: error || `OpenAI test failed (${response.status})` }, { status: response.status });
    }

    return privateJson({ ok: true, message: extractResponseText(payload) || "" });
  } catch (error) {
    return authErrorResponse(error);
  }
}
