import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // VOXEMBLY dark palette (grounded in the reference dashboard)
        base: {
          950: "#060913", // deepest background
          900: "#0B0F19", // app background
          850: "#0E1424", // panel background
          800: "#0F172A", // card background
          700: "#111a30",
        },
        line: {
          DEFAULT: "#1E293B", // subtle slate borders
          soft: "#172033",
        },
        ink: {
          DEFAULT: "#E5EDF7", // primary text
          muted: "#94A3B8",  // secondary labels
          faint: "#475569",  // auxiliary
        },
        // Node / accent semantic colors
        vox: {
          teal: "#00CBD6",
          tealDim: "#00A5B5",
          green: "#10B981",
          amber: "#F59E0B",
          purple: "#A78BFA",
          pink: "#EC4899",
        },
      },
      fontFamily: {
        sans: ["var(--font-inter)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      borderRadius: {
        xl: "0.75rem",
        "2xl": "1rem",
      },
      boxShadow: {
        panel: "0 1px 0 0 rgba(255,255,255,0.02) inset, 0 8px 24px -12px rgba(0,0,0,0.6)",
        glow: "0 0 0 1px rgba(0,203,214,0.25), 0 0 24px -4px rgba(0,203,214,0.35)",
      },
      keyframes: {
        "pulse-ring": {
          "0%": { transform: "scale(0.9)", opacity: "0.7" },
          "70%": { transform: "scale(1.6)", opacity: "0" },
          "100%": { transform: "scale(1.6)", opacity: "0" },
        },
        "fade-in": {
          "0%": { opacity: "0", transform: "translateY(6px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
      },
      animation: {
        "pulse-ring": "pulse-ring 1.6s cubic-bezier(0.4,0,0.2,1) infinite",
        "fade-in": "fade-in 0.35s ease-out both",
        shimmer: "shimmer 2.4s linear infinite",
      },
    },
  },
  plugins: [],
};

export default config;
