// ============================================================================
// VOXEMBLY — Life Domain presets. Each domain bundles a base contextual prompt
// and a starter keyterm vocabulary that seeds the Prompt Composer.
// ============================================================================

import type { Domain } from "@/lib/types";
import { LANGUAGES } from "@/lib/types";

function domain(
  id: string,
  name: string,
  emoji: string,
  icon: string,
  prompt: string,
  keyterms: string[],
): Domain {
  return {
    id,
    label: name,
    name,
    icon,
    emoji,
    base_prompt: prompt,
    prompt,
    keyterms,
  };
}

export const DOMAINS: Domain[] = [
  domain("founder", "Founder", "🚀", "Rocket", "Startup founder dictating product strategy, fundraising, and team updates.", [
    "roadmap", "runway", "ARR", "MRR", "cap table", "term sheet", "burn rate", "GTM", "OKRs", "standup", "sprint",
  ]),
  domain("researcher", "Researcher", "🔬", "Microscope", "Academic researcher dictating hypotheses, citations, and experiment notes.", [
    "hypothesis", "ablation", "baseline", "arXiv", "p-value", "corpus", "benchmark", "citation", "methodology", "peer review",
  ]),
  domain("clinician", "Clinician", "🩺", "Stethoscope", "Clinician dictating a differential diagnosis, medications, and follow-up plan.", [
    "differential", "etiology", "prognosis", "mg", "PRN", "ECG", "hypertension", "titrate", "contraindication", "follow-up",
  ]),
  domain("engineer", "Engineer", "💻", "Code", "Software engineer dictating architecture decisions, PRs, and bug notes.", [
    "refactor", "endpoint", "latency", "PR", "merge conflict", "regression", "webhook", "throughput", "race condition", "rollback",
  ]),
  domain("student", "Student", "🎓", "GraduationCap", "Student dictating lecture notes, assignment plans, and study reminders.", [
    "syllabus", "midterm", "problem set", "office hours", "thesis", "lecture", "deadline", "rubric",
  ]),
  domain("parent", "Parent", "💜", "Heart", "Parent dictating family logistics, reminders, and memorable moments.", [
    "pediatrician", "carpool", "permission slip", "playdate", "recital", "vaccination", "PTA",
  ]),
];

export function domainById(id: string): Domain | undefined {
  return DOMAINS.find((d) => d.id === id);
}

export { LANGUAGES };

export function languageLabel(code?: string | null): string {
  if (!code) return "Auto-detect";
  return LANGUAGES.find((l) => l.code === code)?.name ?? code;
}
