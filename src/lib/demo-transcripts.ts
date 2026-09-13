// ============================================================================
// Demo transcripts — used when the mic is unavailable or ASSEMBLYAI_API_KEY is
// missing, so the full Push-to-Think loop is always demoable end-to-end.
// ============================================================================

export interface DemoTranscript {
  raw: string;
  words: { text: string; confidence: number }[];
}

const RAW_LINES = [
  "so um I'm thinking about branching the VOXEMBLY sprint, like let's move the agent council latency task to Priya and Kenji, but you know I'm a bit worried about the Neo4j rate limits",
  "uh convene council on migrating auth to passkeys, I mean should we ship it this sprint",
  "let's decide, um, whether we stay on Neo4j Aura or migrate to FalkorDB on a Hugging Face Space",
  "remind me to review the AssemblyAI latency dial with Leo tomorrow at ten am",
  "idea: what if every Thoughtform could be forked and merged like a git branch for your mind",
  "I'm honestly really excited about how fast the dictation round trip feels now, it's like a hundred and thirty four milliseconds",
];

export function pickDemoTranscript(): DemoTranscript {
  const raw = RAW_LINES[Math.floor(Math.random() * RAW_LINES.length)];
  const words = raw.split(/\s+/).map((text) => ({
    text,
    // Simulate realistic per-word confidence with a few uncertain words.
    confidence:
      /^(um|uh|like|you|know|i|mean|so)$/i.test(text) || Math.random() < 0.12
        ? 0.55 + Math.random() * 0.25
        : 0.9 + Math.random() * 0.1,
  }));
  return { raw, words };
}
