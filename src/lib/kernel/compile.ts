/**
 * Cleanup Pass + Intent Kernel classification (server-side).
 * One Groq call (llama-3.1-8b-instant) turns a verbatim Sync STT transcript into a strict CompiledThoughtform.
 */
import { chat, extractJSON, GROQ_MODELS } from "@/lib/llm/groq";
import { AGENTS, INTENTS, NODE_TYPES, type AgentKind, type CompiledThoughtform, type Entity, type GraphMutation, type Intent, type NodeType } from "@/lib/types";

export interface CompileContext {
  domain?: string;
  project?: string | null;
  people?: string[];
  recentTitles?: string[];
  branch?: string;
  normalizeTo?: string | null; // ISO code or null (keep source language)
  localePack?: "none" | "keigo" | "usted" | "hinglish";
  knownNodeLabels?: string[];
}

const LOCALE_PACKS: Record<string, string> = {
  none: "",
  keigo: "If the output language is Japanese, write polished_text in polite keigo (丁寧語/謙譲語) suitable for business email.",
  usted: "If the output language is Spanish, use the formal 'usted' register in polished_text; never 'tú' or 'vosotros'.",
  hinglish: "If the speaker mixed Hindi and English, keep Hindi words in Devanagari and English words in Latin script; do not translate either.",
};

export function buildCompileSystemPrompt(ctx: CompileContext): string {
  const normalize = ctx.normalizeTo
    ? `Normalise polished_text into language "${ctx.normalizeTo}" while preserving quoted phrases in their original language.`
    : "Keep polished_text in the language(s) the speaker used (preserve code-switching).";
  return `You are the VOXEMBLY Intent Kernel. You receive a VERBATIM speech transcript (fillers, false starts, self-corrections included) and must return ONE strict JSON object — no prose, no markdown.

Schema:
{
  "intent": one of ${JSON.stringify(INTENTS)},
  "title": string (≤ 8 words, sentence case),
  "polished_text": string (≤ 300 chars; remove fillers "um/uh/like/you know", disfluencies, repeated words, false starts; keep meaning, first person, proper nouns; never add facts),
  "entities": [{ "name": string, "type": one of ${JSON.stringify(NODE_TYPES)}, "description": string }],
  "actions": [{ "kind": "calendar"|"reminder"|"message"|"pr_draft"|"note"|"search"|"other", "title": string, "when": ISO-8601 or null, "target": string|null, "payload": string|null, "status": "proposed" }],
  "graph_mutations": [
     { "op": "add_node", "id": kebab-case-id, "type": NodeType, "label": string, "description": string } |
     { "op": "add_edge", "id": kebab-case-id, "from": node-id, "to": node-id, "label": verb phrase, "weight": 0..1 } |
     { "op": "invalidate_edge", "id": existing-edge-id }
  ],
  "suggested_agents": subset of ${JSON.stringify(AGENTS)},
  "sentiment": { "valence": -1..1, "label": "negative"|"neutral"|"positive" },
  "language_detected": ISO-639-1 code(s) joined by "+" e.g. "en" or "en+es",
  "command": null | { "verb": "checkout"|"branch"|"merge"|"council"|"publish"|"search"|"undo"|"switch"|"ambient", "args": string[] },
  "keyterms_learned": string[] (new proper nouns / jargon worth biasing future transcriptions toward; ≤ 12; each ≤ 6 words; exact spelling)
}

Rules:
- Always include a node for the current speaker as {"id":"me","type":"Person","label":"Me"} only if you add edges from it.
- Every entity must also appear as an add_node mutation (same id = kebab-case of name). Connect entities to each other or to "me" with add_edge when the transcript implies a relation.
- Intent guide: task = actionable to-do; decision = a choice made; question = wants an answer; idea = proposal/insight; meeting = recap of a conversation; emotion = primarily feelings; command = an instruction to VOXEMBLY itself (e.g. "checkout my Tuesday brain", "branch this into Plan A and Plan B", "convene council", "publish this"); memory = a fact to remember; note = everything else.
- Agents guide: question/idea → researcher; task/command → executor; decision/idea → devils_advocate; memory/decision/meeting → historian; task/meeting with time expressions → scheduler; emotion → emotion_curator. Suggest 1–4.
- For "branch this into X and Y" set command {"verb":"branch","args":["X","Y"]}. For "checkout <ref>" set {"verb":"checkout","args":["<ref>"]}. For "merge <branch>" set {"verb":"merge","args":["<branch>"]}.
- ${normalize}
- ${LOCALE_PACKS[ctx.localePack ?? "none"] ?? ""}

Context about the speaker (use to resolve names/spellings, do not invent):
- Domain: ${ctx.domain ?? "general"}
- Current project: ${ctx.project ?? "none"}
- Active branch: ${ctx.branch ?? "main"}
- Known people: ${(ctx.people ?? []).slice(0, 20).join(", ") || "none"}
- Known graph nodes: ${(ctx.knownNodeLabels ?? []).slice(0, 40).join(", ") || "none"}
- Recent thoughtforms: ${(ctx.recentTitles ?? []).slice(0, 5).join(" | ") || "none"}`;
}

const kebab = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "node";

/** Defensive normalisation so the UI never sees a malformed Thoughtform. */
export function normalizeCompiled(raw: unknown, transcript: string): CompiledThoughtform {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const intent = (INTENTS as readonly string[]).includes(String(r.intent)) ? (r.intent as Intent) : "note";
  const entitiesIn = Array.isArray(r.entities) ? r.entities : [];
  const entities: Entity[] = entitiesIn
    .map((e) => {
      const o = (e ?? {}) as Record<string, unknown>;
      const name = String(o.name ?? "").trim();
      if (!name) return null;
      const type = (NODE_TYPES as readonly string[]).includes(String(o.type)) ? (o.type as NodeType) : "Entity";
      return { name, type, description: o.description ? String(o.description) : undefined };
    })
    .filter(Boolean) as Entity[];

  const mutsIn = Array.isArray(r.graph_mutations) ? r.graph_mutations : [];
  const mutations: GraphMutation[] = [];
  const nodeIds = new Set<string>();
  for (const m of mutsIn) {
    const o = (m ?? {}) as Record<string, unknown>;
    if (o.op === "add_node" && o.label) {
      const id = kebab(String(o.id ?? o.label));
      const type = (NODE_TYPES as readonly string[]).includes(String(o.type)) ? (o.type as NodeType) : "Entity";
      mutations.push({ op: "add_node", id, type, label: String(o.label), description: o.description ? String(o.description) : undefined });
      nodeIds.add(id);
    } else if (o.op === "add_edge" && o.from && o.to) {
      const from = kebab(String(o.from));
      const to = kebab(String(o.to));
      if (from === to) continue;
      mutations.push({
        op: "add_edge",
        id: kebab(String(o.id ?? `${from}-${o.label ?? "rel"}-${to}`)),
        from,
        to,
        label: String(o.label ?? "related to"),
        weight: typeof o.weight === "number" ? Math.max(0, Math.min(1, o.weight)) : 0.6,
      });
    } else if (o.op === "invalidate_edge" && o.id) {
      mutations.push({ op: "invalidate_edge", id: kebab(String(o.id)) });
    }
  }
  // Ensure every entity has a node.
  for (const e of entities) {
    const id = kebab(e.name);
    if (!nodeIds.has(id)) {
      mutations.unshift({ op: "add_node", id, type: e.type, label: e.name, description: e.description });
      nodeIds.add(id);
    }
  }
  // Edges referencing unknown nodes get a "me" anchor if needed.
  const needsMe = mutations.some((m) => m.op === "add_edge" && (m.from === "me" || m.to === "me"));
  if (needsMe && !nodeIds.has("me")) mutations.unshift({ op: "add_node", id: "me", type: "Person", label: "Me" });

  const agentsIn = Array.isArray(r.suggested_agents) ? r.suggested_agents : [];
  let agents = agentsIn.filter((a) => (AGENTS as readonly string[]).includes(String(a))) as AgentKind[];
  if (!agents.length) {
    const d: Record<Intent, AgentKind[]> = {
      note: ["historian"],
      task: ["executor", "scheduler"],
      decision: ["devils_advocate", "historian"],
      question: ["researcher"],
      idea: ["researcher", "devils_advocate"],
      meeting: ["historian", "scheduler"],
      emotion: ["emotion_curator"],
      command: ["executor"],
      memory: ["historian"],
    };
    agents = d[intent];
  }
  agents = [...new Set(agents)].slice(0, 4);

  const sent = (r.sentiment ?? {}) as Record<string, unknown>;
  const valence = typeof sent.valence === "number" ? Math.max(-1, Math.min(1, sent.valence)) : 0;
  const label = valence > 0.2 ? "positive" : valence < -0.2 ? "negative" : "neutral";

  const actionsIn = Array.isArray(r.actions) ? r.actions : [];
  const actions = actionsIn
    .map((a) => {
      const o = (a ?? {}) as Record<string, unknown>;
      if (!o.title) return null;
      const kinds = ["calendar", "reminder", "message", "pr_draft", "note", "search", "other"];
      return {
        kind: (kinds.includes(String(o.kind)) ? o.kind : "other") as "other",
        title: String(o.title),
        when: o.when ? String(o.when) : null,
        target: o.target ? String(o.target) : null,
        payload: o.payload ? String(o.payload) : null,
        status: "proposed" as const,
      };
    })
    .filter(Boolean) as CompiledThoughtform["actions"];

  const cmd = r.command && typeof r.command === "object" ? (r.command as Record<string, unknown>) : null;
  const command = cmd && cmd.verb ? { verb: String(cmd.verb), args: Array.isArray(cmd.args) ? cmd.args.map(String) : [] } : null;

  const polished = String(r.polished_text ?? "").trim() || transcript.trim();
  const title = String(r.title ?? "").trim() || polished.split(/\s+/).slice(0, 7).join(" ");

  return {
    intent: command && intent !== "command" ? "command" : intent,
    polished_text: polished.slice(0, 400),
    title,
    entities,
    actions,
    graph_mutations: mutations,
    suggested_agents: agents,
    sentiment: { valence, label },
    language_detected: String(r.language_detected ?? "en"),
    command,
    keyterms_learned: (Array.isArray(r.keyterms_learned) ? r.keyterms_learned : [])
      .map((k) => String(k).trim())
      .filter((k) => k && k.split(/\s+/).length <= 6)
      .slice(0, 12),
  };
}

/** Local fallback compiler (no LLM available) — keeps the loop alive. */
export function heuristicCompile(transcript: string): CompiledThoughtform {
  const fillers = /\b(um+|uh+|erm|hmm+|like,|you know,|i mean,|sort of|kind of|basically|actually)\b[,\s]*/gi;
  const polished = transcript.replace(fillers, "").replace(/\s{2,}/g, " ").replace(/\b(\w+)\s+\1\b/gi, "$1").trim();
  const lower = polished.toLowerCase();
  let intent: Intent = "note";
  if (/\b(checkout|branch this|merge|convene|publish|switch to)\b/.test(lower)) intent = "command";
  else if (/\?$/.test(polished) || /^(what|why|how|when|who|where|is|are|can|should)\b/.test(lower)) intent = "question";
  else if (/\b(decide|decided|decision|we will|let's go with|going with)\b/.test(lower)) intent = "decision";
  else if (/\b(remind|todo|to-do|need to|must|should|schedule|tomorrow|next week|by friday)\b/.test(lower)) intent = "task";
  else if (/\b(idea|what if|maybe we could|imagine)\b/.test(lower)) intent = "idea";
  else if (/\b(meeting|standup|call with|synced with)\b/.test(lower)) intent = "meeting";
  else if (/\b(feel|feeling|anxious|excited|worried|happy|tired|frustrated)\b/.test(lower)) intent = "emotion";
  else if (/\b(remember|note to self|don't forget)\b/.test(lower)) intent = "memory";

  const caps = [...polished.matchAll(/\b([A-Z][a-zA-Z0-9]+(?:\s[A-Z][a-zA-Z0-9]+)?)\b/g)].map((m) => m[1]);
  const seen = new Set<string>();
  const entities: Entity[] = [];
  for (const c of caps) {
    if (seen.has(c) || ["I", "The", "We", "Let", "Plan", "Convene", "VOXEMBLY"].includes(c)) continue;
    seen.add(c);
    entities.push({ name: c, type: "Entity" });
    if (entities.length >= 6) break;
  }
  let command: CompiledThoughtform["command"] = null;
  const br = lower.match(/branch this into (.+?) and (.+?)[.!]?$/);
  if (br) command = { verb: "branch", args: [br[1], br[2]] };
  const co = lower.match(/checkout (.+?)[.!]?$/);
  if (co) command = { verb: "checkout", args: [co[1]] };
  if (/convene (the )?council/.test(lower)) command = { verb: "council", args: [] };
  if (/publish (this|it)/.test(lower)) command = { verb: "publish", args: [] };
  const mg = lower.match(/merge (.+?)[.!]?$/);
  if (mg) command = { verb: "merge", args: [mg[1]] };

  return normalizeCompiled(
    {
      intent,
      title: polished.split(/\s+/).slice(0, 7).join(" "),
      polished_text: polished,
      entities,
      actions: [],
      graph_mutations: entities.map((e) => ({ op: "add_node", id: kebab(e.name), type: e.type, label: e.name })),
      suggested_agents: [],
      sentiment: { valence: 0, label: "neutral" },
      language_detected: "en",
      command,
      keyterms_learned: entities.map((e) => e.name),
    },
    transcript,
  );
}

export async function compileThoughtform(transcript: string, ctx: CompileContext) {
  const t0 = performance.now();
  try {
    const res = await chat({
      model: GROQ_MODELS.fast,
      json: true,
      temperature: 0.1,
      max_tokens: 1200,
      messages: [
        { role: "system", content: buildCompileSystemPrompt(ctx) },
        { role: "user", content: `VERBATIM TRANSCRIPT:\n"""${transcript}"""\n\nReturn the JSON object now.` },
      ],
    });
    const parsed = extractJSON(res.content);
    const compiled = normalizeCompiled(parsed, transcript);
    return { compiled, model: res.model, provider: res.provider, compile_ms: Math.round(performance.now() - t0), degraded: false as const };
  } catch (e) {
    return {
      compiled: heuristicCompile(transcript),
      model: "heuristic",
      provider: "local" as const,
      compile_ms: Math.round(performance.now() - t0),
      degraded: true as const,
      reason: (e as Error).message,
    };
  }
}
