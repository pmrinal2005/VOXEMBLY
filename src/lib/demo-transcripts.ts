// ============================================================================
// VOXEMBLY — Demo transcripts. Used ONLY when no ASSEMBLYAI_API_KEY is set, so
// the whole loop (compile → graph → agents → timeline) remains demoable with
// zero configuration. The UI clearly labels these as "simulated".
// ============================================================================

import type { Word } from "@/lib/types";

export interface DemoClip {
  raw: string;
  words: string[]; // spoken words, will get synthetic confidences
  language_code?: string;
}

export const DEMO_CLIPS: DemoClip[] = [
  {
    raw:
      "Um, I'm thinking about, like, branching the VOXEMBLY sprint. Let's move the agent council latency task to Priya and Kenji, but, uh, I'm kind of worried about the Neo4j rate limits.",
    words:
      "Um I'm thinking about like branching the VOXEMBLY sprint Let's move the agent council latency task to Priya and Kenji but uh I'm kind of worried about the Neo4j rate limits".split(
        " ",
      ),
  },
  {
    raw:
      "So, remind me to email Dr. Alvarez about the cardiology follow-up tomorrow at 9 AM, and, um, book a room for the review.",
    words:
      "So remind me to email Dr Alvarez about the cardiology follow-up tomorrow at 9 AM and um book a room for the review".split(
        " ",
      ),
  },
  {
    raw:
      "I have an idea for VOXEMBLY: what if every Thoughtform could be forked and merged like Git branches, you know, for cognition itself.",
    words:
      "I have an idea for VOXEMBLY what if every Thoughtform could be forked and merged like Git branches you know for cognition itself".split(
        " ",
      ),
  },
  {
    raw:
      "Decision: we should migrate the graph from Aura to FalkorDB because, honestly, the three day inactivity shutdown keeps biting us.",
    words:
      "Decision we should migrate the graph from Aura to FalkorDB because honestly the three day inactivity shutdown keeps biting us".split(
        " ",
      ),
  },
  {
    raw:
      "Honestly I'm feeling pretty good about the demo today, the latency dial looks incredible and the agent choir is a real wow moment.",
    words:
      "Honestly I'm feeling pretty good about the demo today the latency dial looks incredible and the agent choir is a real wow moment".split(
        " ",
      ),
  },
];

/** Pick a demo clip (round-robin by count) and synthesize word confidences. */
export function pickDemoClip(seq: number): {
  raw: string;
  words: Word[];
  confidence: number;
  language_code?: string;
} {
  const clip = DEMO_CLIPS[seq % DEMO_CLIPS.length];
  const words: Word[] = clip.words.map((t) => {
    // Lower confidence for proper nouns / uncommon tokens to feed the heatmap.
    const uncommon = /^[A-Z0-9]/.test(t) && t.length > 3;
    const base = uncommon ? 0.62 + Math.random() * 0.2 : 0.9 + Math.random() * 0.09;
    return { text: t, confidence: Math.min(0.99, base) };
  });
  const confidence = words.reduce((a, w) => a + w.confidence, 0) / words.length;
  return { raw: clip.raw, words, confidence, language_code: clip.language_code };
}
