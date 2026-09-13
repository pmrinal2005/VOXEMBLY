import type { AgentKind, AgentOutput } from "@/lib/types";
import { ALL_AGENTS } from "@/lib/types";
import { MODELS, chat, groqConfigured } from "@/lib/llm/groq";
import { extractJson } from "@/lib/utils";
import { formatHitsForPrompt, webSearch } from "@/lib/kernel/search";

export interface AgentSpec {
  agent: AgentKind;
  model: string;
  role: string;
  system: string;
}

export const AGENT_SPECS: Record<AgentKind, AgentSpec> = {
  researcher: {
    agent: "researcher",
    model: MODELS.reasoner,
    role: "Gathers evidence & cited findings",
    system:
      'You are the Researcher. Return JSON {headline, bullets[], citations?:[{title,url}]}. Surface 2-3 concise findings. Be specific.',
  },
  executor: {
    agent: "executor",
    model: MODELS.tools,
    role: "Turns intent into concrete actions",
    system:
      'You are the Executor. Return JSON {headline, bullets[], actions?:[{kind,title,when,target}]}. Propose exact next actions.',
  },
  devils_advocate: {
    agent: "devils_advocate",
    model: MODELS.contrarian,
    role: "Adversarial risk register",
    system:
      'You are the Devil\'s Advocate. Return JSON {headline, bullets[], risk_register?:[{risk,severity,mitigation}]}. Ruthlessly critique.',
  },
  historian: {
    agent: "historian",
    model: MODELS.reasoner,
    role: "Recalls related past context",
    system:
      'You are the Historian. Return JSON {headline, bullets[], related?:[{commit,when,why}]}. Relate this thought to prior context.',
  },
  scheduler: {
    agent: "scheduler",
    model: MODELS.multilingual,
    role: "Extracts dates & reminders",
    system:
      'You are the Scheduler. Return JSON {headline, bullets[], schedule?:[{title,iso,human}]}. Normalize datetimes to ISO-8601.',
  },
  emotion_curator: {
    agent: "emotion_curator",
    model: MODELS.fast,
    role: "Reads valence & suggests support",
    system:
      'You are the Emotion Curator. Return JSON {headline, bullets[], valence, arousal}. One brief supportive reflection.',
  },
};

export async function runAgent(agent: AgentKind, thought: string, context = ""): Promise<{
  agent: AgentKind;
  model: string;
  provider: string;
  output: AgentOutput;
  latency_ms: number;
}> {
  const spec = AGENT_SPECS[agent] ?? AGENT_SPECS.researcher;
  const t0 = Date.now();
  let extra = context;
  if (agent === "researcher") {
    try {
      const search = await webSearch(thought.slice(0, 180));
      extra += `\nWeb:\n${formatHitsForPrompt(search.hits)}`;
    } catch {
      /* ignore */
    }
  }
  if (groqConfigured()) {
    try {
      const { text, model } = await chat(
        [
          { role: "system", content: spec.system },
          { role: "user", content: `Thought: """${thought}"""${extra ? `\nContext: ${extra}` : ""}` },
        ],
        { model: spec.model, temperature: 0.5, maxTokens: 400, json: true },
      );
      const parsed = extractJson<Partial<AgentOutput>>(text);
      const output: AgentOutput = {
        headline: parsed?.headline || text.slice(0, 120) || placeholder(agent, thought).headline,
        bullets: parsed?.bullets?.length ? parsed.bullets : [text.slice(0, 240)],
        citations: parsed?.citations,
        risk_register: parsed?.risk_register,
        schedule: parsed?.schedule,
        actions: parsed?.actions,
        related: parsed?.related,
        valence: parsed?.valence,
        arousal: parsed?.arousal,
        raw: text,
      };
      return { agent, model, provider: "groq", output, latency_ms: Date.now() - t0 };
    } catch {
      /* fall through */
    }
  }
  return {
    agent,
    model: spec.model,
    provider: "simulated",
    output: placeholder(agent, thought),
    latency_ms: Date.now() - t0,
  };
}

export async function runCouncil(agents: AgentKind[], thought: string, context = "") {
  const fleet = (agents.length ? agents : ALL_AGENTS.slice(0, 4)).filter((a) => a in AGENT_SPECS);
  return Promise.all(fleet.map((a) => runAgent(a, thought, context)));
}

function placeholder(agent: AgentKind, thought: string): AgentOutput {
  const t = thought.slice(0, 60);
  switch (agent) {
    case "researcher":
      return { headline: `Angles on “${t}…”`, bullets: ["Prior art", "Comparable approaches", "Strongest counter-evidence. (Simulated — set GROQ_API_KEY.)"] };
    case "executor":
      return { headline: "Proposed actions", bullets: ["Draft the update", "Create a calendar hold", "File a follow-up reminder"], actions: [{ kind: "reminder", title: "Follow up", when: new Date(Date.now() + 86400000).toISOString() }] };
    case "devils_advocate":
      return { headline: "Risk register", bullets: ["Hidden dependency", "Reversibility cost", "Opportunity cost"], risk_register: [{ risk: "Hidden dependency", severity: "med", mitigation: "Spike it today" }] };
    case "historian":
      return { headline: "This echoes earlier thinking", bullets: ["Verify it doesn't contradict a prior decision."] };
    case "scheduler":
      return { headline: "No explicit datetime", bullets: ["Suggest a reminder for tomorrow 09:00 local."], schedule: [{ title: "Follow up", iso: new Date(Date.now() + 86400000).toISOString(), human: "tomorrow 9:00" }] };
    case "emotion_curator":
      return { headline: "Valence slightly positive", bullets: ["Momentum is good — keep the cadence."], valence: 0.3, arousal: 0.4 };
    default:
      return { headline: "Simulated agent output", bullets: [] };
  }
}
