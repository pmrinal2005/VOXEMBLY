// ============================================================================
// VOXEMBLY — Agent fleet (SERVER-SIDE). The Society-of-Mind Agent Council.
//
// Each specialist agent runs on a DIFFERENT free GroqCloud model. When Groq is
// unconfigured, each agent returns a crafted placeholder so the Council still
// demos (per plan §6.1: stub with beautiful placeholder cards).
// ============================================================================

import type { AgentKind } from "@/lib/types";
import { MODELS, chat, groqConfigured } from "@/lib/llm/groq";

export interface AgentSpec {
  agent: AgentKind;
  model: string;
  role: string;
  system: string;
}

export const AGENT_SPECS: Record<AgentKind, AgentSpec> = {
  Researcher: {
    agent: "Researcher",
    model: MODELS.reasoner,
    role: "Gathers evidence & cited findings",
    system:
      "You are the Researcher. Given a thought, surface 2-3 concise, concrete findings or angles worth investigating. Be specific. <=90 words.",
  },
  Executor: {
    agent: "Executor",
    model: MODELS.tools,
    role: "Turns intent into concrete actions",
    system:
      "You are the Executor. Propose the exact next actions (calendar events, messages, PRs, reminders) with concrete titles and timing. <=80 words.",
  },
  DevilsAdvocate: {
    agent: "DevilsAdvocate",
    model: MODELS.contrarian,
    role: "Adversarial risk register",
    system:
      "You are the Devil's Advocate. Ruthlessly critique the thought. List the top 2-3 risks or failure modes as a short risk register. <=90 words.",
  },
  Historian: {
    agent: "Historian",
    model: MODELS.reasoner,
    role: "Recalls related past context",
    system:
      "You are the Historian. Relate this thought to plausible prior context and note if it may repeat or contradict earlier decisions. <=80 words.",
  },
  Scheduler: {
    agent: "Scheduler",
    model: MODELS.multilingual,
    role: "Extracts dates & reminders",
    system:
      "You are the Scheduler. Extract any date/time expressions and normalize them to ISO 8601, then state the reminder(s) to set. <=70 words.",
  },
  EmotionCurator: {
    agent: "EmotionCurator",
    model: MODELS.fast,
    role: "Reads valence & suggests support",
    system:
      "You are the Emotion Curator. Assess the emotional valence and offer one brief, supportive, non-clinical reflection. <=60 words.",
  },
};

export interface AgentOutput {
  agent: AgentKind;
  model: string;
  output: string;
  citations?: { title: string; url: string }[];
}

/** Run a single agent over a thought. */
export async function runAgent(
  agent: AgentKind,
  thought: string,
  context = "",
): Promise<AgentOutput> {
  const spec = AGENT_SPECS[agent];
  if (groqConfigured()) {
    try {
      const { text, model } = await chat(
        [
          { role: "system", content: spec.system },
          {
            role: "user",
            content: `Thought: """${thought}"""${context ? `\nContext: ${context}` : ""}`,
          },
        ],
        { model: spec.model, temperature: 0.6, maxTokens: 300 },
      );
      return { agent, model, output: text.trim() || placeholder(agent, thought) };
    } catch {
      /* fall through */
    }
  }
  return { agent, model: spec.model, output: placeholder(agent, thought) };
}

/** Run the full council (a subset of agents) in parallel. */
export async function runCouncil(
  agents: AgentKind[],
  thought: string,
  context = "",
): Promise<AgentOutput[]> {
  return Promise.all(agents.map((a) => runAgent(a, thought, context)));
}

function placeholder(agent: AgentKind, thought: string): string {
  const t = thought.slice(0, 60);
  switch (agent) {
    case "Researcher":
      return `Three angles worth exploring on "${t}…": prior art, comparable approaches, and the strongest counter-evidence. (Simulated — set GROQ_API_KEY for live findings.)`;
    case "Executor":
      return `Proposed actions: 1) draft the update, 2) create a calendar hold, 3) file a follow-up reminder. (Simulated — set GROQ_API_KEY.)`;
    case "DevilsAdvocate":
      return `Risk register: (1) hidden dependency risk, (2) reversibility cost, (3) opportunity cost vs. alternatives. Reconsider before committing. (Simulated.)`;
    case "Historian":
      return `This echoes an earlier line of thinking; verify it doesn't contradict a prior decision on the same topic. (Simulated.)`;
    case "Scheduler":
      return `No explicit datetime detected — suggest setting a reminder for tomorrow 09:00 local. (Simulated.)`;
    case "EmotionCurator":
      return `Valence reads slightly positive. Momentum is good — keep the cadence. (Simulated.)`;
    default:
      return "Simulated agent output.";
  }
}
