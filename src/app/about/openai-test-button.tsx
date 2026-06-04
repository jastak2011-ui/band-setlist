"use client";

import { useState } from "react";

type TestState =
  | { status: "idle"; message: string }
  | { status: "testing"; message: string }
  | { status: "success"; message: string }
  | { status: "error"; message: string };

export function OpenAiTestButton() {
  const [state, setState] = useState<TestState>({ status: "idle", message: "" });

  async function testConnection() {
    setState({ status: "testing", message: "Testing..." });
    try {
      const response = await fetch("/api/ai/test", {
        method: "POST",
        credentials: "same-origin",
      });
      const text = await response.text();
      const json = text ? (JSON.parse(text) as { ok?: boolean; message?: string; error?: string }) : null;
      if (!response.ok || !json?.ok) {
        setState({ status: "error", message: json?.error || `OpenAI connection test failed (${response.status}).` });
        return;
      }
      setState({ status: "success", message: json.message || "Band Setlist AI is connected." });
    } catch (error) {
      const message = error instanceof Error ? error.message : "OpenAI connection test failed.";
      setState({ status: "error", message });
    }
  }

  const tone =
    state.status === "success"
      ? "text-emerald-300"
      : state.status === "error"
        ? "text-red-300"
        : "text-[var(--muted)]";

  return (
    <div className="card">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-medium text-[var(--accent)]">OpenAI Connection Debug</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">Admin utility for verifying the deployed Render OpenAI API key.</p>
        </div>
        <button type="button" className="btn btn-primary" disabled={state.status === "testing"} onClick={() => void testConnection()}>
          {state.status === "testing" ? "Testing..." : "Test OpenAI Connection"}
        </button>
      </div>
      {state.message ? <p className={`mt-3 text-sm ${tone}`}>{state.message}</p> : null}
    </div>
  );
}
