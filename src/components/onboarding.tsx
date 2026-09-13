"use client";

/**
 * Flow A — "Boot your Cognitive Twin" (< 90 seconds).
 *
 * Four steps, all keyboard + screen-reader operable:
 *   1. Identity      — display name (seeds the `prompt`'s subject)
 *   2. Languages     — primary + up to two secondaries from the 18-language matrix
 *                      (Universal-3.5 Pro code-switches natively; we state the languages inside the
 *                      `prompt` because `language_code` is ignored when a custom prompt is set)
 *   3. Life Domains  — 1–3 bundles of default keyterms + a base contextual prompt
 *   4. Seed dictation — one 45-second utterance that seeds the graph and the keyterm vocabulary,
 *                      then immediately shows the first Thoughtform (the instant wow moment)
 *
 * The seed dictation is genuinely optional: without an ASSEMBLYAI_API_KEY (or with the mic denied)
 * the wizard still completes, because locking a user out of their own app over a missing key is
 * hostile. We say so honestly instead.
 */

import * as React from "react";
import { LANGUAGES, type SyncRegion } from "@/lib/types";
import { DOMAINS } from "@/lib/twin/composer";
import { useTwin } from "@/lib/store/twin";
import { cn } from "@/lib/utils";
import { Badge, Button, Field, Input, Kbd, Progress, Segmented, Select, Spinner } from "@/components/ui";

const STEPS = ["Identity", "Languages", "Domains", "Seed"] as const;
type Step = (typeof STEPS)[number];

export function Onboarding({ onMicPrepare }: { onMicPrepare: () => Promise<boolean> }) {
  const profile = useTwin((s) => s.profile);
  const setProfile = useTwin((s) => s.setProfile);
  const toast = useTwin((s) => s.toast);

  const [step, setStep] = React.useState(0);
  const [name, setName] = React.useState(profile.display_name);
  const [primary, setPrimary] = React.useState(profile.primary_language || "en");
  const [secondaries, setSecondaries] = React.useState<string[]>(profile.secondary_languages);
  const [domains, setDomains] = React.useState<string[]>(profile.domains.length ? profile.domains : ["founder"]);
  const [region, setRegion] = React.useState<SyncRegion>(profile.region || "global");
  const [acronyms, setAcronyms] = React.useState(profile.private_acronyms.join(", "));
  const [micState, setMicState] = React.useState<"unknown" | "granted" | "denied">("unknown");
  const [busy, setBusy] = React.useState(false);
  const [health, setHealth] = React.useState<{ dictation?: { configured: boolean } } | null>(null);

  const headingRef = React.useRef<HTMLHeadingElement>(null);
  const current: Step = STEPS[step];

  React.useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then(setHealth)
      .catch(() => setHealth(null));
  }, []);

  // Move focus to the step heading on every transition so screen-reader users are never lost.
  React.useEffect(() => {
    headingRef.current?.focus();
  }, [step]);

  const dictationOff = health?.dictation?.configured === false;

  function toggleSecondary(code: string) {
    setSecondaries((prev) => {
      if (prev.includes(code)) return prev.filter((c) => c !== code);
      if (prev.length >= 2) {
        toast("info", "Two secondary languages is the cap", "Universal-3.5 Pro code-switches best across a small, declared set.");
        return prev;
      }
      return [...prev, code];
    });
  }

  function toggleDomain(id: string) {
    setDomains((prev) => {
      if (prev.includes(id)) return prev.length === 1 ? prev : prev.filter((d) => d !== id);
      if (prev.length >= 3) {
        toast("info", "Three Life Domains is the cap", "Each domain adds keyterms; too many dilutes the bias.");
        return prev;
      }
      return [...prev, id];
    });
  }

  async function requestMic() {
    setBusy(true);
    const ok = await onMicPrepare();
    setMicState(ok ? "granted" : "denied");
    setBusy(false);
  }

  async function finish() {
    setBusy(true);
    await setProfile({
      display_name: name.trim() || "You",
      primary_language: primary,
      secondary_languages: secondaries.filter((c) => c !== primary),
      domains,
      region,
      private_acronyms: acronyms
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 40),
      onboarded_at: Date.now(),
    });
    setBusy(false);
  }

  const canAdvance = current === "Identity" ? true : current === "Languages" ? Boolean(primary) : current === "Domains" ? domains.length > 0 : true;

  const seedKeyterms = React.useMemo(() => {
    const out: string[] = ["VOXEMBLY", "Thoughtform", "Cognitive Twin", "AssemblyAI"];
    for (const id of domains) {
      const d = DOMAINS.find((x) => x.id === id);
      if (d) out.push(...d.keyterms);
    }
    for (const a of acronyms.split(",").map((s) => s.trim()).filter(Boolean)) out.push(a);
    return [...new Set(out)];
  }, [domains, acronyms]);

  const seedPrompt = React.useMemo(() => {
    const dNames = domains.map((id) => DOMAINS.find((x) => x.id === id)?.name.toLowerCase()).filter(Boolean);
    const langs = [primary, ...secondaries.filter((c) => c !== primary)];
    const langPhrase =
      langs.length > 1
        ? `Speech in ${langs.map((c) => LANGUAGES.find((l) => l.code === c)?.name ?? c).join(", ")} with code-switching between them`
        : `Speech in ${LANGUAGES.find((l) => l.code === primary)?.name ?? primary}`;
    return `${name.trim() || "A"} ${dNames.join(" and ")} dictating personal notes. ${langPhrase}.`;
  }, [domains, name, primary, secondaries]);

  return (
    <main className="grid-bg min-h-dvh overflow-y-auto" id="main">
      <div className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col px-4 py-8 sm:px-6 sm:py-12">
        {/* brand */}
        <header className="flex items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-vox-cyan to-vox-violet text-base font-black text-background" aria-hidden="true">
            V
          </span>
          <div className="min-w-0">
            <h1 className="text-lg font-bold tracking-tight sm:text-xl">VOXEMBLY</h1>
            <p className="text-xs text-muted-foreground">Voice is the new compiler.</p>
          </div>
          <Badge tone="cyan" className="ml-auto hidden sm:inline-flex">
            universal-3-5-pro
          </Badge>
        </header>

        {/* progress */}
        <nav aria-label="Onboarding progress" className="mt-8">
          <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-medium">
            {STEPS.map((s, i) => (
              <li key={s} className="flex items-center gap-2">
                <span
                  aria-current={i === step ? "step" : undefined}
                  className={cn(
                    "rounded-full px-2.5 py-0.5 transition-colors",
                    i === step ? "bg-primary text-primary-foreground" : i < step ? "bg-vox-emerald/15 text-vox-emerald" : "bg-secondary/70 text-muted-foreground",
                  )}
                >
                  {i + 1}. {s}
                </span>
                {i < STEPS.length - 1 && (
                  <span className="text-muted-foreground/40" aria-hidden="true">
                    →
                  </span>
                )}
              </li>
            ))}
          </ol>
          <Progress value={(step + 1) / STEPS.length} label={`Step ${step + 1} of ${STEPS.length}`} />
        </nav>

        {/* step body */}
        <section className="mt-8 flex-1" aria-live="polite">
          <h2 ref={headingRef} tabIndex={-1} className="text-2xl font-bold tracking-tight text-balance sm:text-3xl">
            {current === "Identity" && "Boot your Cognitive Twin"}
            {current === "Languages" && "How do you think?"}
            {current === "Domains" && "Pick your Life Domains"}
            {current === "Seed" && "Speak once. Watch it compile."}
          </h2>

          {/* ─────────── 1. Identity ─────────── */}
          {current === "Identity" && (
            <div className="mt-2 space-y-6">
              <p className="max-w-xl text-sm leading-relaxed text-muted-foreground">
                Every dictation you make becomes a <strong className="text-foreground">Thoughtform</strong> — a typed, versioned commit with intent, entities,
                actions and a graph mutation. Your name and context are composed into the <code className="font-mono text-vox-cyan">prompt</code> sent with every
                request, which is why accuracy compounds instead of resetting.
              </p>

              <div className="grid gap-5 sm:grid-cols-2">
                <Field label="What should we call you?" htmlFor="ob-name" hint="Used as the subject of the composed prompt.">
                  <Input id="ob-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Priya Shah" autoFocus autoComplete="name" />
                </Field>

                <Field
                  label="Data residency"
                  hint="Picks the Sync endpoint. Global routes to the nearest region; US and EU keep audio in-region."
                >
                  <Segmented<SyncRegion>
                    value={region}
                    onChange={setRegion}
                    ariaLabel="Sync STT region"
                    options={[
                      { value: "global", label: "Global", hint: "sync.assemblyai.com — nearest region" },
                      { value: "us", label: "US", hint: "sync.us.assemblyai.com — us-west-2 / us-east-1" },
                      { value: "eu", label: "EU", hint: "sync.eu.assemblyai.com — eu-north-1" },
                    ]}
                  />
                </Field>
              </div>

              <Field
                label="Private acronyms & jargon (optional)"
                htmlFor="ob-acronyms"
                hint="Comma-separated. These go straight into keyterms_prompt with exact spelling — the single biggest accuracy lever for names the model has never seen."
              >
                <Input id="ob-acronyms" value={acronyms} onChange={(e) => setAcronyms(e.target.value)} placeholder="ARR, DMR, Graphiti, Kenji Tanaka" />
              </Field>
            </div>
          )}

          {/* ─────────── 2. Languages ─────────── */}
          {current === "Languages" && (
            <div className="mt-2 space-y-6">
              <p className="max-w-xl text-sm leading-relaxed text-muted-foreground">
                Universal-3.5 Pro handles an 18-language matrix with native code-switching. Declare a primary plus up to two secondaries and you can switch
                mid-sentence — the composed prompt names them so the model expects it.
              </p>

              <Field label="Primary language" htmlFor="ob-primary">
                <Select id="ob-primary" value={primary} onChange={(e) => setPrimary(e.target.value)}>
                  {LANGUAGES.map((l) => (
                    <option key={l.code} value={l.code}>
                      {l.name} — {l.native}
                    </option>
                  ))}
                </Select>
              </Field>

              <fieldset>
                <legend className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Secondary languages <span className="normal-case text-muted-foreground/70">(up to 2, for code-switching)</span>
                </legend>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {LANGUAGES.filter((l) => l.code !== primary).map((l) => {
                    const on = secondaries.includes(l.code);
                    return (
                      <button
                        key={l.code}
                        type="button"
                        role="checkbox"
                        aria-checked={on}
                        onClick={() => toggleSecondary(l.code)}
                        className={cn(
                          "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                          on ? "border-vox-violet bg-vox-violet/15 text-vox-violet" : "border-border text-muted-foreground hover:border-border hover:bg-secondary/60 hover:text-foreground",
                        )}
                      >
                        {l.native}
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            </div>
          )}

          {/* ─────────── 3. Domains ─────────── */}
          {current === "Domains" && (
            <div className="mt-2 space-y-5">
              <p className="max-w-xl text-sm leading-relaxed text-muted-foreground">
                Each Life Domain is a bundle of pinned keyterms plus a base contextual prompt. Pick 1–3 — they seed the vocabulary before you have any history,
                and the graph takes over from there.
              </p>

              <div role="group" aria-label="Life Domains" className="grid gap-3 sm:grid-cols-2">
                {DOMAINS.map((d) => {
                  const on = domains.includes(d.id);
                  return (
                    <button
                      key={d.id}
                      type="button"
                      role="checkbox"
                      aria-checked={on}
                      onClick={() => toggleDomain(d.id)}
                      className={cn(
                        "rounded-xl border p-3 text-left transition-colors",
                        on ? "border-primary bg-primary/10" : "border-border bg-card/60 hover:border-border hover:bg-secondary/40",
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-lg" aria-hidden="true">
                          {d.emoji}
                        </span>
                        <span className="text-sm font-semibold">{d.name}</span>
                        {on && (
                          <span className="ml-auto text-vox-emerald" aria-hidden="true">
                            ✓
                          </span>
                        )}
                      </div>
                      <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-muted-foreground">{d.prompt}</p>
                      <p className="mt-1.5 font-mono text-[10px] text-muted-foreground/70">{d.keyterms.length} keyterms</p>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* ─────────── 4. Seed ─────────── */}
          {current === "Seed" && (
            <div className="mt-2 space-y-6">
              <p className="max-w-xl text-sm leading-relaxed text-muted-foreground">
                One 45-second utterance seeds your whole Twin. Say:{" "}
                <em className="text-foreground">
                  “Introduce yourself, your projects, your key people, and what you’re working on this week.”
                </em>{" "}
                That single dictation typically produces 30–60 graph nodes and the initial keyterm vocabulary.
              </p>

              {/* the composed config, shown before the first request */}
              <div className="rounded-xl border border-border bg-card/60 p-4">
                <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Your first dictation will be sent with</h3>
                <dl className="mt-2 space-y-3 text-xs">
                  <div>
                    <dt className="font-mono text-[10px] text-vox-cyan">prompt</dt>
                    <dd className="mt-0.5 leading-snug text-muted-foreground">{seedPrompt}</dd>
                  </div>
                  <div>
                    <dt className="font-mono text-[10px] text-vox-violet">keyterms_prompt</dt>
                    <dd className="mt-1 flex flex-wrap gap-1">
                      {seedKeyterms.slice(0, 14).map((k) => (
                        <Badge key={k} tone="violet">
                          {k}
                        </Badge>
                      ))}
                      {seedKeyterms.length > 14 && <Badge tone="neutral">+{seedKeyterms.length - 14} more</Badge>}
                    </dd>
                  </div>
                </dl>
              </div>

              {/* microphone */}
              <div className="flex flex-wrap items-center gap-3">
                <Button variant={micState === "granted" ? "outline" : "primary"} onClick={() => void requestMic()} loading={busy} disabled={micState === "granted"}>
                  {micState === "granted" ? "Microphone ready ✓" : "Allow microphone"}
                </Button>
                {micState === "denied" && (
                  <p role="alert" className="text-xs text-vox-rose">
                    Permission denied. You can still continue — grant it later from your browser’s site settings.
                  </p>
                )}
                {micState === "unknown" && <p className="text-xs text-muted-foreground">Asked once, then reused — so key-down is instant.</p>}
              </div>

              {dictationOff && (
                <p role="alert" className="rounded-lg border border-vox-amber/40 bg-vox-amber/10 px-3 py-2 text-xs leading-relaxed text-vox-amber">
                  <strong>ASSEMBLYAI_API_KEY is not configured.</strong> You can finish setup and explore the Studio, but nothing will transcribe until you add the
                  key to <code className="font-mono">.env.local</code> and restart. See the README’s Setup section.
                </p>
              )}

              <p className="text-xs leading-relaxed text-muted-foreground">
                In the Studio, hold <Kbd>Space</Kbd> (or the Orb) and speak. Release to commit. <Kbd>Esc</Kbd> cancels. Every action also has a voice command, so
                the app is fully operable without a keyboard.
              </p>
            </div>
          )}
        </section>

        {/* nav */}
        <footer className="mt-8 flex items-center justify-between gap-3 border-t border-border/60 pt-5">
          <Button variant="ghost" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>
            Back
          </Button>

          <div className="flex items-center gap-2">
            <span className="hidden text-[11px] text-muted-foreground sm:inline">
              Step {step + 1} of {STEPS.length}
            </span>
            {step < STEPS.length - 1 ? (
              <Button variant="primary" onClick={() => setStep((s) => s + 1)} disabled={!canAdvance}>
                Continue
              </Button>
            ) : (
              <Button variant="primary" onClick={() => void finish()} loading={busy}>
                Enter the Studio
              </Button>
            )}
          </div>
        </footer>

        {busy && (
          <p className="sr-only" role="status">
            <Spinner className="h-3 w-3" /> Working…
          </p>
        )}
      </div>
    </main>
  );
}
