"use client";

import { motion } from "framer-motion";
import { clamp } from "@/lib/utils";

// Circular latency dial that renders request_time_ms from AssemblyAI responses.
export default function LatencyDial({
  ms,
  size = 56,
  label = "MS SERVER",
}: {
  ms: number;
  size?: number;
  label?: string;
}) {
  const stroke = 4;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  // 0..300ms mapped to the arc (300ms = the "natural voice" ceiling).
  const pct = clamp(ms / 300, 0, 1);
  const color = ms < 150 ? "#00CBD6" : ms < 250 ? "#F59E0B" : "#EC4899";

  return (
    <div className="flex items-center gap-2" title={`${ms} ms server-reported latency`}>
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={r} stroke="#1E293B" strokeWidth={stroke} fill="none" />
          <motion.circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke={color}
            strokeWidth={stroke}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={c}
            initial={false}
            animate={{ strokeDashoffset: c * (1 - pct) }}
            transition={{ type: "spring", stiffness: 120, damping: 18 }}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="font-mono text-[13px] font-semibold" style={{ color }}>
            {ms > 0 ? ms : "—"}
          </span>
        </div>
      </div>
      <span className="label-caps leading-tight">{label}</span>
    </div>
  );
}
