// ============================================================================
// VOXEMBLY — Compile pass (SERVER-SIDE). The "cleanup + Intent Kernel" step.
//
// Takes the raw transcript and returns a strict-JSON CompileResult: intent,
// polished_text (filler-free), sentiment, entities, actions, graph_mutations,
// and spawned_agents. Uses Groq llama-3.1-8b-instant. When Groq is not
// configured, a deterministic heuristic compiler keeps the demo working.
// ============================================================================

import type {
  AgentKind,
  CompileResult,
  Entity,
  GraphMutation,
  Intent,
  ThoughtAction,
} from "@/lib/types";
import { INTENTS } from "@/lib/types";
import { MODELS, chat, groqConfigured } from "@/lib/llm/groq";
import { extractJson } from "@/lib/utils";

const SYSTEM = `You are the VOXEMBLY Intent Kernel. Convert a raw voice transcript into a strict JSON Thoughtform.
Return ONLY a JSON object with EXACTLY these fields:
{
  "intent": one of ["note","task","decision","question","idea","meeting","emotion","command","memory"],
  "polished_text": string (<=300 chars, remove fillers/false starts/disfluencies, keep meaning),
  "sentiment": number between -1 and 1,
  "entities": [{ "name": string, "kind": one of ["Person","Project","Concept","Location","Task","Decision","Emotion","Memory","Entity","Domain"] }],
  "actions": [{ "kind": one of ["calendar","reminder","message","pr","note","search"], "title": string, "when": optional ISO string, "target": optional string }],
  "graph_mutations": [{ "op": "add_node"|"add_edge", "kind": nodeKind?, "label": string?, "from": string?, "to": string?, "rel": string? }],
  "spawned_agents": subset of ["Researcher","Executor","DevilsAdvocate","Historian","Scheduler","EmotionCurator"]
}
Rules: proper nouns become Person/Project/Entity nodes. Decisions/ideas spawn DevilsAdvocate. Questions/ideas spawn Researcher. Tasks/commands spawn Executor. Tasks/meetings spawn Scheduler. Memory/decision/meeting spawn Historian. Emotion spawns EmotionCurator. Output valid JSON only, no prose.`;

export async function compileTranscript(rawText: string): Promise<CompileResult> {
  if (groqConfigured()) {
    try {
      const { text } = await chat(
        [
          { role: "system", content: SYSTEM },
          { role: "user", content: `Transcript: """${rawText}"""` },
        ],
        { model: MODELS.fast, json: true, temperature: 0.2, maxTokens: 700 },
      );
      const parsed = extractJson<Partial<CompileResult>>(text);
      if (parsed && parsed.polished_text) return normalize(parsed, rawText);
    } catch {
      /* fall through to heuristic */
    }
  }
  return heuristicCompile(rawText);
}

function normalize(p: Partial<CompileResult>, raw: string): CompileResult {
  const intent: Intent = INTENTS.includes(p.intent as Intent)
    ? (p.intent as Intent)
    : "note";
  const entities: Entity[] = Array.isArray(p.entities)
    ? p.entities
        .filter((e) => e && e.name)
        .map((e) => ({ name: String(e.name), kind: (e.kind as any) || "Entity" }))
    : [];
  const actions: ThoughtAction[] = Array.isArray(p.actions)
    ? p.actions.filter((a) => a && a.title).map((a) => ({ ...a }))
    : [];
  const graph_mutations: GraphMutation[] = Array.isArray(p.graph_mutations)
    ? p.graph_mutations.filter((m) => m && m.op)
    : deriveMutations(entities);
  const spawned_agents = Array.isArray(p.spawned_agents)
    ? (p.spawned_agents.filter(Boolean) as AgentKind[])
    : agentsFor(intent);
  return {
    intent,
    polished_text: String(p.polished_text || raw).slice(0, 300),
    sentiment: typeof p.sentiment === "number" ? Math.max(-1, Math.min(1, p.sentiment)) : 0,
    entities,
    actions,
    graph_mutations: graph_mutations.length ? graph_mutations : deriveMutations(entities),
    spawned_agents,
  };
}

// ---- Heuristic fallback (no API key) ---------------------------------------

const FILLERS = /\b(um|uh|like|you know|kind of|sort of|honestly|so|basically|i mean|actually)\b/gi;

export function heuristicCompile(raw: string): CompileResult {
  const polished = raw
    .replace(FILLERS, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.!?])/g, "$1")
    .replace(/^[,\s]+/, "")
    .trim();

  const lower = raw.toLowerCase();
  let intent: Intent = "note";
  if (/\b(remind|schedule|book|set up|todo|to-do)\b/.test(lower)) intent = "task";
  else if (/\bdecision|decide|we should|let's (go|move|migrate)\b/.test(lower)) intent = "decision";
  else if (/\?|^(what|why|how|when|who|should we)\b/.test(lower)) intent = "question";
  else if (/\bidea|what if|imagine|concept\b/.test(lower)) intent = "idea";
  else if (/\bmeeting|standup|sync|call with\b/.test(lower)) intent = "meeting";
  else if (/\bi feel|i'm feeling|excited|worried|anxious|happy|proud\b/.test(lower)) intent = "emotion";
  else if (/^(voxembly|checkout|branch|merge|publish|convene)\b/.test(lower)) intent = "command";
  else if (/\bremember|last week|previously|i said|recall\b/.test(lower)) intent = "memory";

  // crude proper-noun entity extraction
  const propers = Array.from(
    new Set(
      (raw.match(/\b([A-Z][a-zA-Z0-9]+)\b/g) || []).filter(
        (w) => !["I", "I'm", "So", "Um", "Uh", "Let's", "Decision", "Honestly"].includes(w),
      ),
    ),
  ).slice(0, 8);
  const entities: Entity[] = propers.map((name) => ({
    name,
    kind: /priya|kenji|leo|alvarez|smith/i.test(name) ? "Person" : "Entity",
  }));

  const actions: ThoughtAction[] = [];
  if (intent === "task") {
    actions.push({ kind: "reminder", title: polished.slice(0, 80) });
  }

  const sentiment =
    intent === "emotion"
      ? /worried|anxious|bad|sad|frustrated/.test(lower)
        ? -0.4
        : 0.5
      : 0;

  return {
    intent,
    polished_text: polished.slice(0, 300),
    sentiment,
    entities,
    actions,
    graph_mutations: deriveMutations(entities),
    spawned_agents: agentsFor(intent),
  };
}

function deriveMutations(entities: Entity[]): GraphMutation[] {
  return entities.map((e) => ({ op: "add_node", kind: e.kind, label: e.name }));
}

export function agentsFor(intent: Intent): AgentKind[] {
  const map: Record<Intent, AgentKind[]> = {
    note: [],
    task: ["Executor", "Scheduler"],
    decision: ["DevilsAdvocate", "Historian"],
    question: ["Researcher"],
    idea: ["Researcher", "DevilsAdvocate"],
    meeting: ["Scheduler", "Historian"],
    emotion: ["EmotionCurator"],
    command: ["Executor"],
    memory: ["Historian"],
  };
  return map[intent] || [];
}
