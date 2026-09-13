// ============================================================================
// VOXEMBLY — Life Domain presets. Each domain bundles a base contextual prompt
// and a starter keyterm vocabulary that seeds the Prompt Composer.
// ============================================================================

import type { Domain } from "@/lib/types";

export const DOMAINS: Domain[] = [
  {
    id: "founder",
    label: "Founder",
    icon: "Rocket",
    base_prompt:
      "Startup founder dictating product strategy, fundraising, and team updates.",
    keyterms: [
      "roadmap",
      "runway",
      "ARR",
      "MRR",
      "cap table",
      "term sheet",
      "burn rate",
      "GTM",
      "OKRs",
      "standup",
      "sprint",
    ],
  },
  {
    id: "researcher",
    label: "Researcher",
    icon: "Microscope",
    base_prompt:
      "Academic researcher dictating hypotheses, citations, and experiment notes.",
    keyterms: [
      "hypothesis",
      "ablation",
      "baseline",
      "arXiv",
      "p-value",
      "corpus",
      "benchmark",
      "citation",
      "methodology",
      "peer review",
    ],
  },
  {
    id: "clinician",
    label: "Clinician",
    icon: "Stethoscope",
    base_prompt:
      "Clinician dictating a differential diagnosis, medications, and follow-up plan.",
    keyterms: [
      "differential",
      "etiology",
      "prognosis",
      "mg",
      "PRN",
      "ECG",
      "hypertension",
      "titrate",
      "contraindication",
      "follow-up",
    ],
  },
  {
    id: "engineer",
    label: "Engineer",
    icon: "Code",
    base_prompt:
      "Software engineer dictating architecture decisions, PRs, and bug notes.",
    keyterms: [
      "refactor",
      "endpoint",
      "latency",
      "PR",
      "merge conflict",
      "regression",
      "webhook",
      "throughput",
      "race condition",
      "rollback",
    ],
  },
  {
    id: "student",
    label: "Student",
    icon: "GraduationCap",
    base_prompt:
      "Student dictating lecture notes, assignment plans, and study reminders.",
    keyterms: [
      "syllabus",
      "midterm",
      "problem set",
      "office hours",
      "thesis",
      "lecture",
      "deadline",
      "rubric",
    ],
  },
  {
    id: "parent",
    label: "Parent",
    icon: "Heart",
    base_prompt:
      "Parent dictating family logistics, reminders, and memorable moments.",
    keyterms: [
      "pediatrician",
      "carpool",
      "permission slip",
      "playdate",
      "recital",
      "vaccination",
      "PTA",
    ],
  },
];

export function domainById(id: string): Domain | undefined {
  return DOMAINS.find((d) => d.id === id);
}

/** Supported languages (Universal-3.5 Pro 18-language matrix). */
export const LANGUAGES: { code: string; label: string }[] = [
  { code: "en", label: "English" },
  { code: "es", label: "Spanish" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "it", label: "Italian" },
  { code: "pt", label: "Portuguese" },
  { code: "nl", label: "Dutch" },
  { code: "hi", label: "Hindi" },
  { code: "ja", label: "Japanese" },
  { code: "zh", label: "Chinese" },
  { code: "ko", label: "Korean" },
  { code: "ru", label: "Russian" },
  { code: "tr", label: "Turkish" },
  { code: "pl", label: "Polish" },
  { code: "uk", label: "Ukrainian" },
  { code: "vi", label: "Vietnamese" },
  { code: "id", label: "Indonesian" },
  { code: "ar", label: "Arabic" },
];

export function languageLabel(code?: string): string {
  if (!code) return "Auto-detect";
  return LANGUAGES.find((l) => l.code === code)?.label ?? code;
}
