"use client";

import type { AgentKind, AgentOutput, AgentStatus, Thoughtform } from "@/lib/types";
import type { CouncilSynthesis } from "@/components/council";

export type CouncilEvent =
  | {
      type: "result";
      agent: AgentKind;
      model: string;
      provider: string;
      status: AgentStatus;
      output?: AgentOutput;
      error?: string;
      latency_ms: number;
    }
  | { type: "synthesizing" }
  | { type: "synthesis"; synthesis: CouncilSynthesis }
  | { type: "done"; paused?: boolean };

export async function convene(
  tf: Thoughtform,
  agents: AgentKind[] | undefined,
  onEvent: (e: CouncilEvent) => void,
): Promise<void> {
  const fleet = agents?.length ? agents : tf.compiled.suggested_agents;
  const res = await fetch("/api/agents", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" },
    body: JSON.stringify({
      thought: tf.compiled.polished_text,
      title: tf.compiled.title,
      intent: tf.compiled.intent,
      agents: fleet,
      context: tf.raw_text,
      hash: tf.commit_hash,
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(t || res.statusText);
  }
  const ctype = res.headers.get("content-type") || "";
  if (ctype.includes("ndjson") && res.body) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          onEvent(JSON.parse(line) as CouncilEvent);
        } catch {
          /* skip */
        }
      }
    }
    if (buf.trim()) {
      try {
        onEvent(JSON.parse(buf) as CouncilEvent);
      } catch {
        /* skip */
      }
    }
    return;
  }
  const json = (await res.json()) as {
    events?: CouncilEvent[];
    synthesis?: CouncilSynthesis;
    paused?: boolean;
  };
  for (const e of json.events || []) onEvent(e);
  if (json.synthesis) {
    onEvent({ type: "synthesizing" });
    onEvent({ type: "synthesis", synthesis: json.synthesis });
  }
  onEvent({ type: "done", paused: json.paused });
}
