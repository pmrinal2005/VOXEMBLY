"use client";

// Cognitive Twin canvas — lightweight SVG force-directed graph (no heavy deps).
// Animates node focus; colors by node kind; click a node to focus.

import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import type { GraphEdge, GraphNode } from "@/lib/types";
import { NODE_COLORS } from "@/lib/utils";

interface Props {
  nodes: GraphNode[];
  edges: GraphEdge[];
  onNodeClick?: (n: GraphNode) => void;
  focusLabel?: string;
}

interface Pt {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export default function GraphCanvas({ nodes, edges, onNodeClick, focusLabel }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ w: 640, h: 420 });
  const [pts, setPts] = useState<Record<string, Pt>>({});
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setDims({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    setDims({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // Initialize positions (seeded by any provided x/y, else spread on a circle).
  const nodeIds = nodes.map((n) => n.id).join(",");
  useEffect(() => {
    const cx = dims.w / 2;
    const cy = dims.h / 2;
    const next: Record<string, Pt> = {};
    nodes.forEach((n, i) => {
      const existing = pts[n.id];
      if (existing) {
        next[n.id] = existing;
      } else {
        const angle = (i / Math.max(1, nodes.length)) * Math.PI * 2;
        next[n.id] = {
          id: n.id,
          x: cx + (n.x ?? Math.cos(angle) * 140),
          y: cy + (n.y ?? Math.sin(angle) * 120),
          vx: 0,
          vy: 0,
        };
      }
    });
    setPts(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeIds, dims.w, dims.h]);

  // Simple force simulation.
  useEffect(() => {
    if (!dims.w) return;
    const cx = dims.w / 2;
    const cy = dims.h / 2;
    let iter = 0;

    const step = () => {
      iter++;
      setPts((prev) => {
        const arr = Object.values(prev);
        if (!arr.length) return prev;
        const map = { ...prev };

        // Repulsion
        for (let i = 0; i < arr.length; i++) {
          const a = map[arr[i].id];
          let fx = 0;
          let fy = 0;
          for (let j = 0; j < arr.length; j++) {
            if (i === j) continue;
            const b = map[arr[j].id];
            let dx = a.x - b.x;
            let dy = a.y - b.y;
            let d2 = dx * dx + dy * dy;
            if (d2 < 1) d2 = 1;
            const f = 2600 / d2;
            fx += (dx / Math.sqrt(d2)) * f;
            fy += (dy / Math.sqrt(d2)) * f;
          }
          // Center gravity
          fx += (cx - a.x) * 0.006;
          fy += (cy - a.y) * 0.006;
          a.vx = (a.vx + fx) * 0.82;
          a.vy = (a.vy + fy) * 0.82;
        }

        // Spring attraction along edges
        for (const e of edges) {
          const a = map[e.source];
          const b = map[e.target];
          if (!a || !b) continue;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const target = 110;
          const f = (dist - target) * 0.012;
          const fx = (dx / dist) * f;
          const fy = (dy / dist) * f;
          a.vx += fx;
          a.vy += fy;
          b.vx -= fx;
          b.vy -= fy;
        }

        for (const p of Object.values(map)) {
          p.x = Math.max(30, Math.min(dims.w - 30, p.x + p.vx));
          p.y = Math.max(30, Math.min(dims.h - 30, p.y + p.vy));
        }
        return map;
      });

      if (iter < 220) rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeIds, edges.length, dims.w, dims.h]);

  const edgeLines = useMemo(
    () =>
      edges
        .map((e) => ({ e, a: pts[e.source], b: pts[e.target] }))
        .filter((x) => x.a && x.b),
    [edges, pts]
  );

  return (
    <div ref={wrapRef} className="relative h-full w-full overflow-hidden">
      <svg width="100%" height="100%" className="absolute inset-0">
        <defs>
          <radialGradient id="node-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="white" stopOpacity="0.25" />
            <stop offset="100%" stopColor="white" stopOpacity="0" />
          </radialGradient>
        </defs>
        {edgeLines.map(({ e, a, b }) => (
          <line
            key={e.id}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            stroke="#334155"
            strokeOpacity={0.55}
            strokeWidth={1}
          />
        ))}
        {nodes.map((n) => {
          const p = pts[n.id];
          if (!p) return null;
          const color = NODE_COLORS[n.kind] ?? "#94A3B8";
          const isFocus = focusLabel && n.label === focusLabel;
          const r = n.kind === "Project" ? 12 : 9;
          return (
            <g
              key={n.id}
              transform={`translate(${p.x},${p.y})`}
              className="cursor-pointer"
              onClick={() => onNodeClick?.(n)}
            >
              <motion.circle
                r={r + 10}
                fill={color}
                initial={{ opacity: 0 }}
                animate={{ opacity: isFocus ? 0.28 : 0.14 }}
              />
              <motion.circle
                r={r}
                fill={color}
                stroke={isFocus ? "#ffffff" : "rgba(255,255,255,0.25)"}
                strokeWidth={isFocus ? 2 : 1}
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", stiffness: 260, damping: 20 }}
              />
              <text
                y={r + 15}
                textAnchor="middle"
                className="pointer-events-none select-none"
                fill="#94A3B8"
                fontSize={10}
                style={{ fontFamily: "var(--font-inter)" }}
              >
                {n.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
