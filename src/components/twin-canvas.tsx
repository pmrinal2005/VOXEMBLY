"use client";

/**
 * The Cognitive Twin canvas (§3.7.4) — a force-directed graph of the temporal knowledge graph.
 *
 * Implemented as a self-contained canvas + Verlet/Barnes-Hut-free force simulation (~120 LOC) rather
 * than pulling in react-force-graph + three.js (≈900 KB). Reasons: it keeps the bundle tiny, it runs
 * in one rAF loop we can pause for `prefers-reduced-motion`, and — critically — it lets new nodes
 * literally fly in from the Orb's screen position when a Thoughtform commits, which is the demo beat.
 *
 * Accessibility: the canvas is decorative-with-fallback. An equivalent, fully keyboard-navigable
 * node list is always rendered for screen readers (and toggleable for sighted keyboard users), so no
 * information exists only inside the canvas.
 */

import * as React from "react";
import type { GraphEdge, GraphNode } from "@/lib/types";
import { NODE_COLORS } from "@/lib/twin/graph";
import { cn } from "@/lib/utils";
import { Badge, Button, Empty } from "@/components/ui";

interface Sim {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  node: GraphNode;
  born: number;
}

export function TwinCanvas({
  nodes,
  edges,
  highlight,
  reduceMotion,
  onSelectNode,
  selectedNode,
  className,
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** node ids added by the newest commit — these fly in and glow */
  highlight: string[];
  reduceMotion: boolean;
  onSelectNode?: (id: string | null) => void;
  selectedNode?: string | null;
  className?: string;
}) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const simRef = React.useRef<Map<string, Sim>>(new Map());
  const rafRef = React.useRef<number>(0);
  const hoverRef = React.useRef<string | null>(null);
  const [showList, setShowList] = React.useState(false);
  const highlightSet = React.useMemo(() => new Set(highlight), [highlight]);

  // Keep the simulation node set in sync with the graph, seeding newcomers at the Orb (bottom-centre).
  React.useEffect(() => {
    const sim = simRef.current;
    const w = wrapRef.current?.clientWidth ?? 600;
    const h = wrapRef.current?.clientHeight ?? 420;
    const live = new Set(nodes.map((n) => n.id));

    for (const n of nodes) {
      const existing = sim.get(n.id);
      if (existing) {
        existing.node = n;
        existing.r = radiusFor(n);
        continue;
      }
      const fromOrb = highlightSet.has(n.id);
      sim.set(n.id, {
        id: n.id,
        // New nodes enter from the Orb's position; older ones scatter around the centre.
        x: fromOrb ? w / 2 + (Math.random() - 0.5) * 20 : w / 2 + (Math.random() - 0.5) * w * 0.6,
        y: fromOrb ? h + 30 : h / 2 + (Math.random() - 0.5) * h * 0.6,
        vx: 0,
        vy: fromOrb ? -2.6 : 0,
        r: radiusFor(n),
        node: n,
        born: performance.now(),
      });
    }
    for (const id of [...sim.keys()]) if (!live.has(id)) sim.delete(id);
  }, [nodes, highlightSet]);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let w = 0;
    let h = 0;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const resize = () => {
      w = wrap.clientWidth;
      h = wrap.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    const step = () => {
      const sim = simRef.current;
      const list = [...sim.values()];

      // ── forces ──
      // repulsion (O(n²) is fine: the Twin canvas shows ≤ a few hundred nodes)
      for (let i = 0; i < list.length; i++) {
        const a = list[i];
        for (let j = i + 1; j < list.length; j++) {
          const b = list[j];
          let dx = b.x - a.x;
          let dy = b.y - a.y;
          let d2 = dx * dx + dy * dy;
          if (d2 < 1) {
            dx = Math.random() - 0.5;
            dy = Math.random() - 0.5;
            d2 = 1;
          }
          const d = Math.sqrt(d2);
          const force = (2600 * (a.r + b.r)) / 28 / d2;
          const fx = (dx / d) * force;
          const fy = (dy / d) * force;
          a.vx -= fx;
          a.vy -= fy;
          b.vx += fx;
          b.vy += fy;
        }
      }
      // springs along live edges
      for (const e of edges) {
        const a = sim.get(e.from);
        const b = sim.get(e.to);
        if (!a || !b) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.max(1, Math.hypot(dx, dy));
        const rest = 96 + (1 - (e.weight ?? 0.6)) * 46;
        const k = 0.0075 * (e.valid_to === null ? 1 : 0.3);
        const f = (d - rest) * k;
        const fx = (dx / d) * f;
        const fy = (dy / d) * f;
        a.vx += fx;
        a.vy += fy;
        b.vx -= fx;
        b.vy -= fy;
      }
      // gravity to centre + damping + integrate
      for (const n of list) {
        n.vx += (w / 2 - n.x) * 0.0016;
        n.vy += (h / 2 - n.y) * 0.0016;
        n.vx *= 0.86;
        n.vy *= 0.86;
        n.x += n.vx;
        n.y += n.vy;
        const pad = n.r + 6;
        n.x = Math.max(pad, Math.min(w - pad, n.x));
        n.y = Math.max(pad, Math.min(h - pad, n.y));
      }

      // ── paint ──
      ctx.clearRect(0, 0, w, h);
      const now = performance.now();

      for (const e of edges) {
        const a = sim.get(e.from);
        const b = sim.get(e.to);
        if (!a || !b) continue;
        const invalidated = e.valid_to !== null;
        const touches = hoverRef.current === e.from || hoverRef.current === e.to || selectedNode === e.from || selectedNode === e.to;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.strokeStyle = invalidated ? "rgba(148,163,184,0.14)" : touches ? "rgba(34,211,238,0.55)" : "rgba(148,163,184,0.26)";
        ctx.lineWidth = touches ? 1.8 : 1;
        if (invalidated) ctx.setLineDash([3, 4]);
        ctx.stroke();
        ctx.setLineDash([]);

        if (touches) {
          const mx = (a.x + b.x) / 2;
          const my = (a.y + b.y) / 2;
          ctx.font = "10px ui-monospace, monospace";
          ctx.fillStyle = "rgba(226,232,240,0.8)";
          ctx.textAlign = "center";
          ctx.fillText(e.label.slice(0, 28), mx, my - 4);
        }
      }

      for (const n of list) {
        const color = NODE_COLORS[n.node.type] ?? "#94a3b8";
        const isNew = highlightSet.has(n.id);
        const age = now - n.born;
        const pop = Math.min(1, age / 420);
        const r = n.r * (reduceMotion ? 1 : 0.4 + 0.6 * pop);
        const active = hoverRef.current === n.id || selectedNode === n.id;

        if (isNew && age < 2600 && !reduceMotion) {
          const glow = 1 - age / 2600;
          ctx.beginPath();
          ctx.arc(n.x, n.y, r + 8 + glow * 10, 0, Math.PI * 2);
          ctx.fillStyle = hexA(color, 0.12 * glow);
          ctx.fill();
        }

        ctx.beginPath();
        ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
        ctx.fillStyle = hexA(color, active ? 0.95 : 0.72);
        ctx.fill();
        ctx.lineWidth = active ? 2.5 : 1.2;
        ctx.strokeStyle = active ? "#e2e8f0" : hexA(color, 0.9);
        ctx.stroke();

        if (r > 8 || active) {
          ctx.font = `${active ? "600 " : ""}11px Inter, system-ui, sans-serif`;
          ctx.fillStyle = active ? "#f1f5f9" : "rgba(226,232,240,0.72)";
          ctx.textAlign = "center";
          ctx.fillText(truncateLabel(n.node.label, active ? 30 : 16), n.x, n.y + r + 12);
        }
      }

      rafRef.current = requestAnimationFrame(step);
    };

    rafRef.current = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
    };
  }, [edges, highlightSet, reduceMotion, selectedNode]);

  const pick = (clientX: number, clientY: number): string | null => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    let best: { id: string; d: number } | null = null;
    for (const n of simRef.current.values()) {
      const d = Math.hypot(n.x - x, n.y - y);
      if (d <= n.r + 8 && (!best || d < best.d)) best = { id: n.id, d };
    }
    return best?.id ?? null;
  };

  return (
    <div className={cn("relative h-full w-full", className)}>
      <div ref={wrapRef} className="absolute inset-0">
        <canvas
          ref={canvasRef}
          className="h-full w-full cursor-crosshair"
          role="img"
          aria-label={`Cognitive Twin graph: ${nodes.length} nodes, ${edges.filter((e) => e.valid_to === null).length} live edges. An equivalent keyboard-navigable list is available below.`}
          onPointerMove={(e) => {
            hoverRef.current = pick(e.clientX, e.clientY);
          }}
          onPointerLeave={() => {
            hoverRef.current = null;
          }}
          onClick={(e) => onSelectNode?.(pick(e.clientX, e.clientY))}
        />
      </div>

      {!nodes.length && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <Empty
            title="Your Twin is empty"
            hint="Hold the Orb and speak. Entities, people and projects you mention become nodes here, and feed the next dictation's keyterms."
          />
        </div>
      )}

      {/* Legend */}
      {nodes.length > 0 && (
        <div className="pointer-events-none absolute left-2 top-2 flex max-w-[70%] flex-wrap gap-1">
          {[...new Set(nodes.map((n) => n.type))].slice(0, 6).map((t) => (
            <span
              key={t}
              className="rounded-full border border-border/60 bg-background/70 px-1.5 py-0.5 text-[9px] font-medium backdrop-blur-sm"
              style={{ color: NODE_COLORS[t] }}
            >
              {t}
            </span>
          ))}
        </div>
      )}

      {/* Accessible equivalent — always in the a11y tree, visually toggleable. */}
      <div className="absolute bottom-2 right-2">
        <Button size="sm" variant="outline" onClick={() => setShowList((v) => !v)} aria-expanded={showList} className="bg-background/80 backdrop-blur-sm">
          {showList ? "Hide" : "List"} nodes ({nodes.length})
        </Button>
      </div>

      <div
        className={cn(
          "absolute inset-x-2 bottom-12 max-h-[55%] overflow-y-auto rounded-lg border border-border bg-background/95 p-2 backdrop-blur-sm scrollbar-thin",
          showList ? "block" : "sr-only-focusable",
        )}
      >
        <h4 className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Twin nodes (keyboard accessible)</h4>
        <ul className="space-y-0.5">
          {nodes
            .slice()
            .sort((a, b) => b.mentions - a.mentions)
            .map((n) => {
              const deg = edges.filter((e) => e.valid_to === null && (e.from === n.id || e.to === n.id)).length;
              return (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => onSelectNode?.(n.id)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-xs hover:bg-secondary/70",
                      selectedNode === n.id && "bg-secondary",
                    )}
                  >
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: NODE_COLORS[n.type] }} aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate font-medium">{n.label}</span>
                    <Badge tone="neutral">{n.type}</Badge>
                    <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                      {n.mentions}× · {deg} edge{deg === 1 ? "" : "s"}
                    </span>
                  </button>
                </li>
              );
            })}
        </ul>
      </div>
    </div>
  );
}

function radiusFor(n: GraphNode) {
  return Math.min(22, 6 + Math.sqrt(n.mentions) * 3.4 + (n.type === "Person" || n.type === "Project" ? 2.5 : 0));
}

function truncateLabel(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function hexA(hex: string, a: number) {
  const h = hex.replace("#", "");
  const v = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const r = parseInt(v.slice(0, 2), 16);
  const g = parseInt(v.slice(2, 4), 16);
  const b = parseInt(v.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}
