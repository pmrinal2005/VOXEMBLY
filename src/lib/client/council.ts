"use client";

// ============================================================================
// VOXEMBLY — Council client. Invokes /api/agents and yields per-agent events so
// the Agent Choir can flip cards in as each specialist returns.
// ============================================================================

import type { AgentKind } from "@/lib/types";

export interface CouncilEvent {
  agent: AgentKind;
  model: string;
  output: string;
  citations?: { title: string; url: string }[];
}

export interface CouncilResult {
  events: CouncilEvent[];
  synthesis: string;
}

/** Convene the council; resolves once all agents have returned. */
export async function convene(
  thought: string,
  agents: AgentKind[],
  context = "",
): Promise<CouncilResult> {
  const res = await fetch("/api/agents", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ thought, agents, context }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(t || res.statusText);
  }
  return res.json();
}
