import type {
  AgentKind,
  CompileResult,
  CompiledThoughtform,
  Entity,
  GraphMutation,
  Intent,
  NodeType,
  ThoughtAction,
} from "@/lib/types";
import { INTENTS } from "@/lib/types";
import { MODELS, chat, groqConfigured } from "@/lib/llm/groq";
import { extractJson } from "@/lib/utils";

const SYSTEM = `You are the VOXEMBLY Intent Kernel. Convert a raw voice transcript into a strict JSON Thoughtform.
Return ONLY a JSON object with EXACTLY these fields:
{
  "intent": one of ["note","task","decision","question","idea","meeting","emotion","command","memory"],
  "title": string (<=80 chars),
  "polished_text": string (<=300 chars, remove fillers/false starts/disfluencies, keep meaning),
  "sentiment": { "valence": number -1..1, "label": "positive"|"neutral"|"negative" },
  "entities": [{ "name": string, "type": one of ["Person","Project","Concept","Location","Task","Decision","Emotion","Memory","Entity","Domain"] }],
  "actions": [{ "kind": one of ["calendar","reminder","message","pr_draft","note","search"], "title": string, "when": optional ISO string, "target": optional string, "status": "proposed" }],
  "graph_mutations": [{ "op": "add_node"|"add_edge", "id": string?, "type": nodeType?, "label": string?, "from": string?, "to": string?, "weight": number? }],
  "suggested_agents": subset of ["researcher","executor","devils_advocate","historian","scheduler","emotion_curator"],
  "language_detected": string,
  "keyterms_learned": string[]
}
Rules: proper nouns become Person/Project/Entity nodes. Decisions/ideas spawn devils_advocate. Questions/ideas spawn researcher. Tasks/commands spawn executor. Tasks/meetings spawn scheduler. Memory/decision/meeting spawn historian. Emotion spawns emotion_curator. Output valid JSON only.`;

export async function compileTranscript(rawText: string): Promise<CompileResult> {
  const t0 = Date.now();
  if (groqConfigured()) {
    try {
      const { text } = await chat(
        [
          { role: "system", content: SYSTEM },
          { role: "user", content: `Transcript: """${rawText}"""` },
        ],
        { model: MODELS.fast, json: true, temperature: 0.2, maxTokens: 800 },
      );
      const parsed = extractJson<Partial<CompiledThoughtform>>(text);
      if (parsed && parsed.polished_text) {
        return { compiled: normalize(parsed, rawText), compile_ms: Date.now() - t0, degraded: false };
      }
    } catch {
      /* fall through */
    }
  }
  return { compiled: heuristicCompile(rawText), compile_ms: Date.now() - t0, degraded: true };
}

function normalize(p: Partial<CompiledThoughtform>, raw: string): CompiledThoughtform {
  const intent: Intent = INTENTS.includes(p.intent as Intent) ? (p.intent as Intent) : "note";
  const entities: Entity[] = Array.isArray(p.entities)
    ? p.entities.filter((e) => e && e.name).map((e) => ({ name: String(e.name), type: (e.type as NodeType) || "Entity" }))
    : [];
  const actions: ThoughtAction[] = Array.isArray(p.actions)
    ? p.actions.filter((a) => a && a.title).map((a) => ({
        kind: a.kind || "note",
        title: a.title,
        when: a.when ?? null,
        target: a.target,
        status: a.status || "proposed",
      }))
    : [];
  const graph_mutations: GraphMutation[] = Array.isArray(p.graph_mutations)
    ? p.graph_mutations.filter((m) => m && m.op)
    : deriveMutations(entities);
  const suggested_agents = Array.isArray(p.suggested_agents)
    ? (p.suggested_agents.filter(Boolean) as AgentKind[])
    : agentsFor(intent);
  const valence =
    typeof p.sentiment === "object" && p.sentiment && typeof p.sentiment.valence === "number"
      ? p.sentiment.valence
      : 0;
  const label = valence > 0.2 ? "positive" : valence < -0.2 ? "negative" : "neutral";
  const polished = String(p.polished_text || raw).slice(0, 300);
  return {
    intent,
    title: String(p.title || polished.split(/[.!?]/)[0] || "Thoughtform").slice(0, 80),
    polished_text: polished,
    entities,
    actions,
    suggested_agents,
    sentiment: { valence, label },
    language_detected: p.language_detected || "en",
    keyterms_learned: Array.isArray(p.keyterms_learned) ? p.keyterms_learned.map(String).slice(0, 24) : entities.map((e) => e.name),
    graph_mutations: graph_mutations.length ? graph_mutations : deriveMutations(entities),
  };
}

const FILLERS = /\b(um|uh|like|you know|kind of|sort of|honestly|so|basically|i mean|actually)\b/gi;

export function heuristicCompile(raw: string): CompiledThoughtform {
  const polished = raw
    .replace(FILLERS, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.!?])/g, "$1")
    .replace(/^[,\s]+/, "")
    .trim();
  const lower = raw.toLowerCase();
  let intent: Intent = "note";
  if (/\b(remind|schedule|book|set up|todo|to-do|assign)\b/.test(lower)) intent = "task";
  else if (/\bdecision|decide|we should|let's (go|move|migrate)\b/.test(lower)) intent = "decision";
  else if (/\?|^(what|why|how|when|who|should we)\b/.test(lower)) intent = "question";
  else if (/\bidea|what if|imagine|concept\b/.test(lower)) intent = "idea";
  else if (/\bmeeting|standup|sync|call with\b/.test(lower)) intent = "meeting";
  else if (/\bi feel|i'm feeling|excited|worried|anxious|happy|proud\b/.test(lower)) intent = "emotion";
  else if (/^(voxembly|checkout|branch|merge|publish|convene)\b/.test(lower)) intent = "command";
  else if (/\bremember|last week|previously|i said|recall\b/.test(lower)) intent = "memory";

  const propers = Array.from(
    new Set(
      (raw.match(/\b([A-Z][a-zA-Z0-9]+(?:\s[A-Z][a-zA-Z0-9]+)*)\b/g) || []).filter(
        (w) => !["I", "I'm", "So", "Um", "Uh", "Let's", "Decision", "Honestly"].includes(w),
      ),
    ),
  ).slice(0, 8);
  const entities: Entity[] = propers.map((name) => ({
    name,
    type: /priya|kenji|leo|alvarez|smith|dr\b/i.test(name) ? "Person" : /voxembly|thoughtform|neo4j|falkordb/i.test(name) ? "Project" : "Entity",
  }));
  const actions: ThoughtAction[] = [];
  if (intent === "task") actions.push({ kind: "reminder", title: polished.slice(0, 80), status: "proposed" });
  const valence = intent === "emotion" ? (/worried|anxious|bad|sad/.test(lower) ? -0.4 : 0.5) : 0.1;
  return {
    intent,
    title: (polished.split(/[.!?]/)[0] || "Thoughtform").slice(0, 80),
    polished_text: polished.slice(0, 300),
    entities,
    actions,
    suggested_agents: agentsFor(intent),
    sentiment: { valence, label: valence > 0.2 ? "positive" : valence < -0.2 ? "negative" : "neutral" },
    language_detected: "en",
    keyterms_learned: entities.map((e) => e.name),
    graph_mutations: deriveMutations(entities),
  };
}

function deriveMutations(entities: Entity[]): GraphMutation[] {
  return entities.map((e, i) => ({
    op: "add_node",
    id: e.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 24) || `n${i}`,
    type: e.type,
    label: e.name,
  }));
}

export function agentsFor(intent: Intent): AgentKind[] {
  const map: Record<Intent, AgentKind[]> = {
    note: [],
    task: ["executor", "scheduler"],
    decision: ["devils_advocate", "historian"],
    question: ["researcher"],
    idea: ["researcher", "devils_advocate"],
    meeting: ["scheduler", "historian"],
    emotion: ["emotion_curator"],
    command: ["executor"],
    memory: ["historian"],
  };
  return map[intent] || [];
}
