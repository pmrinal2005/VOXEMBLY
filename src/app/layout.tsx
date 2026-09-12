import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const jetbrains = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains", display: "swap" });

export const metadata: Metadata = {
  title: "VOXEMBLY — The Voice-Native Cognition OS",
  description:
    "Voice is the new compiler. Every dictation becomes a typed, versioned, executable Thoughtform that mutates your knowledge graph, dispatches agents, and time-travels like Git for your mind.",
  applicationName: "VOXEMBLY",
  keywords: ["dictation", "AssemblyAI", "knowledge graph", "agents", "voice", "Thoughtform"],
};

export const viewport: Viewport = {
  themeColor: "#0a0f1c",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrains.variable} dark`} suppressHydrationWarning>
      <body className="min-h-dvh font-sans antialiased">
        <a
          href="#main"
          className="sr-only-focusable fixed left-4 top-4 z-[100] rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
        >
          Skip to main content
        </a>
        {children}
      </body>
    </html>
  );
}
