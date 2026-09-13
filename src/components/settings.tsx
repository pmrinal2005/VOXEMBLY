"use client";

/**
 * Settings — profile, accessibility, audio format, the live DMR benchmark, system health,
 * the voice-command grammar reference, and Twin export / reset.
 *
 * The DMR panel (§9, §3.3) runs the Deep Memory Retrieval eval against the user's *own* Twin, in the
 * browser, with no API call — so the "Memory Recall %" shown on stage is real and re-runnable.
 */

import * as React from "react";
import { LANGUAGES, type LatencyMode, type Profile, type SyncRegion } from "@/lib/types";
import { DOMAINS } from "@/lib/twin/composer";
import { useTwin } from "@/lib/store/twin";
import { runDMR, type DMRResult } from "@/lib/kernel/dmr";
import * as store from "@/lib/store/db";
import { cn, download, formatDateTime } from "@/lib/utils";
import { Badge, Button, Field, Input, Modal, Progress, Segmented, Select, Stat, Switch } from "@/components/ui";

type Tab = "profile" | "a11y" | "memory" | "system" | "voice";

const TABS: { id: Tab; label: string }[] = [
  { id: "profile", label: "Profile" },
  { id: "a11y", label: "Accessibility" },
  { id: "memory", label: "Memory" },
  { id: "system", label: "System" },
  { id: "voice", label: "Voice & Keys" },
];

export interface HealthPayload {
  ok?: boolean;
  degraded?: string[];
  dictation?: { configured: boolean; model?: string; region?: string; endpoint?: string };
  llm?: { groq_configured?: boolean; gateway_configured?: boolean; cooling?: string[]; compile_fallback?: string };
  embeddings?: { jina_configured?: boolean; fallback?: string };
  search?: { searxng?: boolean; brave?: boolean; fallback?: string };
  persistence?: { mode?: string; publish_shared?: boolean };
}

const VOICE_GRAMMAR: { say: string; does: string }[] = [
  { say: "“VOXEMBLY, checkout my Tuesday brain”", does: "Time-travels the Twin to the last commit before that day" },
  { say: "“checkout HEAD~3”  ·  “checkout f3a1c2”", does: "Relative or hash-prefix time travel" },
  { say: "“branch this into Plan A and Plan B”", does: "Forks the selected commit into two branches" },
  { say: "“merge plan-a into main”", does: "Replays a branch onto another as a two-parent merge commit" },
  { say: "“switch to plan-b”", does: "Changes the active branch" },
  { say: "“convene the council”", does: "Dispatches the specialist agent fleet on the selection" },
  { say: "“research <topic>”", does: "Runs the Researcher agent only" },
  { say: "“publish this”", does: "Creates the public /t/{hash} artifact" },
  { say: "“start ambient”  ·  “stop ambient”", does: "Toggles continuous VAD-segmented capture" },
  { say: "“return to head”", does: "Leaves the detached time-travel view" },
];

const SHORTCUTS: { keys: string; does: string }[] = [
  { keys: "Hold Space", does: "Push-to-Think (dictate)" },
  { keys: "Esc", does: "Cancel the in-flight dictation" },
  { keys: "A", does: "Toggle Ambient Mode" },
  { keys: "C", does: "Convene the Council on the selection" },
  { keys: "B", does: "Branch from the selection" },
  { keys: "M", does: "Merge a branch" },
  { keys: "?", does: "Open this panel" },
];

export function SettingsModal({
  open,
  onClose,
  usePCM,
  onUsePCM,
  health,
}: {
  open: boolean;
  onClose: () => void;
  usePCM: boolean;
  onUsePCM: (v: boolean) => void;
  health: HealthPayload | null;
}) {
  const profile = useTwin((s) => s.profile);
  const setProfile = useTwin((s) => s.setProfile);
  const thoughtforms = useTwin((s) => s.thoughtforms);
  const toast = useTwin((s) => s.toast);
  const reset = useTwin((s) => s.reset);

  const [tab, setTab] = React.useState<Tab>("profile");
  const [dmr, setDmr] = React.useState<DMRResult | null>(null);
  const [dmrBusy, setDmrBusy] = React.useState(false);
  const [confirmReset, setConfirmReset] = React.useState(false);

  // Restore the last DMR result so the panel is populated the moment it opens.
  React.useEffect(() => {
    if (!open) return;
    void store.getMeta<DMRResult>("dmr:last").then((r) => {
      if (r) setDmr(r);
    });
  }, [open]);

  async function runBenchmark() {
    setDmrBusy(true);
    // Yield a frame so the spinner paints before the (synchronous) eval runs.
    await new Promise((r) => setTimeout(r, 30));
    const result = runDMR(thoughtforms, 5, 40);
    setDmr(result);
    await store.setMeta("dmr:last", result);
    setDmrBusy(false);
    toast(
      result.degraded ? "info" : "success",
      result.degraded ? "Benchmark skipped" : `Memory Recall ${(result.recall * 100).toFixed(0)}%`,
      result.degraded ?? `${result.hits}/${result.probes} probes recovered their source commit in the top ${result.k}. MRR ${result.mrr.toFixed(2)}.`,
    );
  }

  const patch = (p: Partial<Profile>) => void setProfile(p);

  return (
    <Modal open={open} onClose={onClose} title="Settings" description="Profile, accessibility, the live memory benchmark, and system health." size="lg">
      {/* tabs */}
      <div role="tablist" aria-label="Settings sections" className="scrollbar-thin -mx-1 flex gap-1 overflow-x-auto pb-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            type="button"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
              tab === t.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="mt-4" role="tabpanel" aria-label={TABS.find((t) => t.id === tab)?.label}>
        {/* ─────────── Profile ─────────── */}
        {tab === "profile" && (
          <div className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Display name" htmlFor="st-name" hint="Subject of the composed prompt.">
                <Input id="st-name" value={profile.display_name} onChange={(e) => patch({ display_name: e.target.value })} />
              </Field>

              <Field label="Primary language" htmlFor="st-lang">
                <Select id="st-lang" value={profile.primary_language} onChange={(e) => patch({ primary_language: e.target.value })}>
                  {LANGUAGES.map((l) => (
                    <option key={l.code} value={l.code}>
                      {l.name} — {l.native}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            <Field label="Data residency" hint="Global routes to the nearest region; US / EU pin the audio in-region.">
              <Segmented<SyncRegion>
                value={profile.region}
                onChange={(r) => patch({ region: r })}
                ariaLabel="Sync STT region"
                options={[
                  { value: "global", label: "Global", hint: "sync.assemblyai.com" },
                  { value: "us", label: "US", hint: "sync.us.assemblyai.com" },
                  { value: "eu", label: "EU", hint: "sync.eu.assemblyai.com" },
                ]}
              />
            </Field>

            <fieldset>
              <legend className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Life Domains (1–3)</legend>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {DOMAINS.map((d) => {
                  const on = profile.domains.includes(d.id);
                  return (
                    <button
                      key={d.id}
                      type="button"
                      role="checkbox"
                      aria-checked={on}
                      onClick={() => {
                        const next = on ? profile.domains.filter((x) => x !== d.id) : [...profile.domains, d.id].slice(0, 3);
                        if (!next.length) return;
                        patch({ domains: next });
                      }}
                      className={cn(
                        "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                        on ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
                      )}
                    >
                      <span aria-hidden="true">{d.emoji}</span> {d.name}
                    </button>
                  );
                })}
              </div>
            </fieldset>

            <Field
              label="Private acronyms & jargon"
              htmlFor="st-acr"
              hint="Comma-separated, exact spelling. Injected into keyterms_prompt at the highest priority after your domain vocabulary."
            >
              <Input
                id="st-acr"
                value={profile.private_acronyms.join(", ")}
                onChange={(e) => patch({ private_acronyms: e.target.value.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 40) })}
              />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Normalize output to" htmlFor="st-norm" hint="Dictate in any configured language, get the polished text in this one.">
                <Select id="st-norm" value={profile.normalize_to ?? ""} onChange={(e) => patch({ normalize_to: e.target.value || null })}>
                  <option value="">Keep the spoken language</option>
                  {LANGUAGES.map((l) => (
                    <option key={l.code} value={l.code}>
                      {l.name}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label="Cultural rewrite pack" htmlFor="st-locale" hint="Swaps the cleanup-pass system prompt for a locale-aware register.">
                <Select id="st-locale" value={profile.locale_pack} onChange={(e) => patch({ locale_pack: e.target.value as Profile["locale_pack"] })}>
                  <option value="none">None</option>
                  <option value="keigo">Japanese — keigo (polite register)</option>
                  <option value="usted">Spanish — formal usted</option>
                  <option value="hinglish">Hindi — Devanagari + Latin bilingual</option>
                </Select>
              </Field>
            </div>
          </div>
        )}

        {/* ─────────── Accessibility ─────────── */}
        {tab === "a11y" && (
          <div className="space-y-1 divide-y divide-border/40">
            <Switch
              checked={profile.high_contrast}
              onChange={(v) => patch({ high_contrast: v })}
              label="High-contrast theme"
              description="Pure-black surfaces, AAA text contrast, brighter focus ring."
            />
            <Switch
              checked={profile.reduce_motion}
              onChange={(v) => patch({ reduce_motion: v })}
              label="Reduce motion"
              description="Freezes the force simulation, the Orb pulse and the Diff Ribbon animation. Your OS preference is also honoured automatically."
            />
            <Switch
              checked={usePCM}
              onChange={onUsePCM}
              label="Send raw PCM instead of WAV"
              description="16-bit S16LE at 16 kHz with no RIFF header — about 15% less payload, so slightly lower latency on mobile. Both formats are accepted by the API."
            />

            <div className="pt-4">
              <Field
                label="Latency mode"
                hint="min_latency favours speed for users with attention or tremor needs; max_accuracy favours correctness for clinical and legal dictation."
              >
                <Segmented<LatencyMode>
                  value={profile.latency_mode}
                  onChange={(m) => patch({ latency_mode: m })}
                  ariaLabel="Latency mode"
                  options={[
                    { value: "min_latency", label: "Min latency" },
                    { value: "balanced", label: "Balanced" },
                    { value: "max_accuracy", label: "Max accuracy" },
                  ]}
                />
              </Field>
            </div>

            <div className="pt-4">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Built-in guarantees</h4>
              <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-muted-foreground">
                <li>• Every action is reachable by keyboard, by pointer, by touch long-press, and by voice command.</li>
                <li>• The transcript and every status change are announced through <code className="font-mono">aria-live</code> regions.</li>
                <li>• The Twin canvas has an equivalent keyboard-navigable node list — nothing exists only inside the canvas.</li>
                <li>• Low-confidence words carry a dotted underline as well as a tint, so colour is never the only signal.</li>
                <li>• Dictations recorded offline queue in IndexedDB and replay automatically on reconnect.</li>
              </ul>
            </div>
          </div>
        )}

        {/* ─────────── Memory / DMR ─────────── */}
        {tab === "memory" && (
          <div className="space-y-5">
            <p className="text-xs leading-relaxed text-muted-foreground">
              The Deep Memory Retrieval eval follows the Zep/Graphiti methodology (arXiv:2501.13956): probes are generated from your own Thoughtforms, then scored
              on whether retrieval surfaces the correct source commit in the top&nbsp;k. It runs entirely in your browser — no API call, no cost, deterministic.
            </p>

            <div className="flex flex-wrap items-center gap-3">
              <Button variant="primary" onClick={() => void runBenchmark()} loading={dmrBusy}>
                Run benchmark
              </Button>
              <span className="text-xs text-muted-foreground">
                {thoughtforms.length} thoughtform{thoughtforms.length === 1 ? "" : "s"} in the Twin
              </span>
            </div>

            {dmr && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3 rounded-xl border border-border bg-card/60 p-4 sm:grid-cols-4">
                  <Stat label="Memory recall" value={`${(dmr.recall * 100).toFixed(0)}%`} tone={dmr.recall >= 0.8 ? "emerald" : dmr.recall >= 0.5 ? "amber" : "rose"} sub={`target ≥ 80%`} />
                  <Stat label="MRR" value={dmr.mrr.toFixed(2)} sub="mean reciprocal rank" />
                  <Stat label="Probes" value={`${dmr.hits}/${dmr.probes}`} sub={`top-${dmr.k} retrieval`} />
                  <Stat label="Ran" value={new Date(dmr.ran_at).toLocaleTimeString()} sub={formatDateTime(dmr.ran_at)} mono={false} />
                </div>

                <Progress value={dmr.recall} label="Memory recall" tone={dmr.recall >= 0.8 ? "emerald" : "amber"} />

                {dmr.degraded && <p className="text-xs text-vox-amber">{dmr.degraded}</p>}

                {dmr.per_probe.length > 0 && (
                  <div className="scrollbar-thin max-h-64 overflow-y-auto rounded-xl border border-border">
                    <table className="w-full text-left text-xs">
                      <caption className="sr-only">Per-probe Deep Memory Retrieval results</caption>
                      <thead className="sticky top-0 bg-card">
                        <tr className="border-b border-border/60 text-[10px] uppercase tracking-wider text-muted-foreground">
                          <th scope="col" className="px-3 py-2 font-semibold">Probe</th>
                          <th scope="col" className="px-3 py-2 font-semibold">Kind</th>
                          <th scope="col" className="px-3 py-2 font-semibold">Rank</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/40">
                        {dmr.per_probe.map((p) => (
                          <tr key={p.id}>
                            <td className="max-w-[280px] truncate px-3 py-1.5">{p.question}</td>
                            <td className="px-3 py-1.5">
                              <Badge tone="neutral">{p.kind}</Badge>
                            </td>
                            <td className={cn("px-3 py-1.5 font-mono", p.hit ? "text-vox-emerald" : "text-vox-rose")}>{p.hit ? `#${p.rank}` : "miss"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ─────────── System ─────────── */}
        {tab === "system" && (
          <div className="space-y-5">
            {health?.degraded && health.degraded.length > 0 && (
              <div role="alert" className="rounded-lg border border-vox-amber/40 bg-vox-amber/10 p-3">
                <h4 className="text-xs font-semibold text-vox-amber">Degraded capabilities</h4>
                <ul className="mt-1 space-y-0.5 text-xs text-vox-amber/90">
                  {health.degraded.map((d) => (
                    <li key={d}>• {d}</li>
                  ))}
                </ul>
              </div>
            )}

            <dl className="divide-y divide-border/40 text-xs">
              <Row
                label="Dictation (Sync STT)"
                ok={Boolean(health?.dictation?.configured)}
                value={health?.dictation?.configured ? `${health.dictation.model} · ${health.dictation.endpoint}` : "ASSEMBLYAI_API_KEY missing"}
              />
              <Row
                label="LLM (cleanup + Council)"
                ok={Boolean(health?.llm?.groq_configured || health?.llm?.gateway_configured)}
                value={
                  health?.llm?.groq_configured
                    ? "GroqCloud round-robin"
                    : health?.llm?.gateway_configured
                      ? "AssemblyAI LLM Gateway"
                      : `no key — ${health?.llm?.compile_fallback ?? "local heuristic"}`
                }
              />
              <Row
                label="Embeddings"
                ok={true}
                value={health?.embeddings?.jina_configured ? "Jina v4" : `${health?.embeddings?.fallback ?? "local hash embeddings"} (no key needed)`}
              />
              <Row
                label="Web search (Researcher)"
                ok={true}
                value={health?.search?.searxng ? "SearXNG" : health?.search?.brave ? "Brave Search" : (health?.search?.fallback ?? "DuckDuckGo + Wikipedia")}
              />
              <Row label="Persistence" ok={true} value={health?.persistence?.mode ?? "indexeddb (Local Twin)"} />
              <Row
                label="Shared publishing"
                ok={Boolean(health?.persistence?.publish_shared)}
                value={health?.persistence?.publish_shared ? "Supabase — /t/{hash} works anywhere" : "local only — add SUPABASE_SERVICE_ROLE_KEY to share"}
              />
            </dl>

            {health?.llm?.cooling && health.llm.cooling.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Cooling down (rate-limited): <span className="font-mono">{health.llm.cooling.join(", ")}</span>
              </p>
            )}

            <div className="flex flex-wrap gap-2 border-t border-border/60 pt-4">
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  const dump = await store.exportTwin();
                  download(`voxembly-twin-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(dump, null, 2), "application/json");
                  toast("success", "Twin exported", "Full commit DAG, branches and profile as JSON.");
                }}
              >
                Export Twin (JSON)
              </Button>

              {confirmReset ? (
                <>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={async () => {
                      await reset();
                      setConfirmReset(false);
                      toast("success", "Local Twin wiped", "Commits, branches, drafts and published artifacts cleared.");
                    }}
                  >
                    Yes, wipe everything
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setConfirmReset(false)}>
                    Cancel
                  </Button>
                </>
              ) : (
                <Button variant="ghost" size="sm" onClick={() => setConfirmReset(true)}>
                  Reset local Twin…
                </Button>
              )}
            </div>
          </div>
        )}

        {/* ─────────── Voice & Keys ─────────── */}
        {tab === "voice" && (
          <div className="space-y-6">
            <section>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Keyboard shortcuts</h4>
              <dl className="mt-2 grid gap-x-6 gap-y-1.5 text-xs sm:grid-cols-2">
                {SHORTCUTS.map((s) => (
                  <div key={s.keys} className="flex items-baseline gap-2">
                    <dt>
                      <kbd className="rounded border border-border bg-secondary/80 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-muted-foreground">{s.keys}</kbd>
                    </dt>
                    <dd className="text-muted-foreground">{s.does}</dd>
                  </div>
                ))}
              </dl>
            </section>

            <section>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Voice command grammar</h4>
              <p className="mt-1 text-xs text-muted-foreground">
                Recognised by the Intent Kernel and, if the LLM pass is degraded, by a local regex grammar — so zero-keyboard operability never depends on an API
                being up.
              </p>
              <dl className="mt-2 divide-y divide-border/40 text-xs">
                {VOICE_GRAMMAR.map((v) => (
                  <div key={v.say} className="grid gap-0.5 py-1.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] sm:gap-3">
                    <dt className="font-medium text-foreground">{v.say}</dt>
                    <dd className="text-muted-foreground">{v.does}</dd>
                  </div>
                ))}
              </dl>
            </section>
          </div>
        )}
      </div>
    </Modal>
  );
}

function Row({ label, ok, value }: { label: string; ok: boolean; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <dt className="flex items-center gap-2 font-medium">
        <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", ok ? "bg-vox-emerald" : "bg-vox-rose")} aria-hidden="true" />
        {label}
        <span className="sr-only">{ok ? "configured" : "not configured"}</span>
      </dt>
      <dd className="min-w-0 break-words text-right font-mono text-[11px] text-muted-foreground">{value}</dd>
    </div>
  );
}
