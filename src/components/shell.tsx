"use client";

/**
 * The VOXEMBLY app shell — responsive chrome for the Studio.
 *
 * Layout contract:
 *   • ≥1280px (xl) — collapsible sidebar rail + 12-column bento grid + docked timeline.
 *   • 1024–1280px (lg) — sidebar collapses to a 60px icon rail by default; bento reflows to 2 columns.
 *   • 768–1024px (md) — sidebar becomes an overlay drawer; bento stacks to a single wide column with
 *     the Twin canvas and detail panel side by side.
 *   • <768px (mobile) — drawer sidebar, single-column bento, and a bottom tab bar that swaps between
 *     the four surfaces (Commits / Twin / Thoughtform / Timeline). The Orb floats above the tab bar
 *     so Push-to-Think is always one thumb away.
 *
 * Accessibility: the drawer is a real modal dialog (focus trap, Escape, restore focus, inert
 * background), the rail buttons keep accessible names when their labels are visually hidden, the tab
 * bar is a real `tablist`, and no surface is reachable by pointer only.
 */

import * as React from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui";

/* ───────────────────────────── Bento primitives ───────────────────────────── */

/**
 * A bento cell. `span` maps to a 12-column grid on xl, 6 on lg, 1 below — so a card declares its
 * intent once ("I want half the row") instead of repeating breakpoint soup at every call site.
 */
export function Bento({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-12", className)} {...props}>
      {children}
    </div>
  );
}

const SPANS: Record<number, string> = {
  3: "xl:col-span-3",
  4: "xl:col-span-4",
  5: "xl:col-span-5",
  6: "xl:col-span-6",
  7: "xl:col-span-7",
  8: "xl:col-span-8",
  9: "xl:col-span-9",
  12: "md:col-span-2 xl:col-span-12",
};

export function BentoCard({
  span = 4,
  title,
  subtitle,
  actions,
  footer,
  padded = true,
  scroll = false,
  className,
  bodyClassName,
  as: Tag = "section",
  children,
  ...props
}: {
  /** columns on xl (out of 12) */
  span?: 3 | 4 | 5 | 6 | 7 | 8 | 9 | 12;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  footer?: React.ReactNode;
  padded?: boolean;
  scroll?: boolean;
  bodyClassName?: string;
  as?: "section" | "div" | "article";
} & React.HTMLAttributes<HTMLElement>) {
  return (
    <Tag
      className={cn(
        "flex min-w-0 flex-col overflow-hidden rounded-2xl border border-border/70 bg-card/70 backdrop-blur-sm",
        "transition-colors hover:border-border",
        SPANS[span],
        className,
      )}
      {...props}
    >
      {(title || actions) && (
        <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border/50 px-3 py-2 sm:px-4">
          <div className="min-w-0">
            {title && <h2 className="truncate text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</h2>}
            {subtitle && <p className="truncate text-[10px] text-muted-foreground/70">{subtitle}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
        </header>
      )}
      <div className={cn("min-h-0 flex-1", padded && "p-3 sm:p-4", scroll && "scrollbar-thin overflow-y-auto", bodyClassName)}>{children}</div>
      {footer && <footer className="shrink-0 border-t border-border/50 px-3 py-2 sm:px-4">{footer}</footer>}
    </Tag>
  );
}

/* ───────────────────────────── Icons (inline, no dependency) ───────────────────────────── */

type IconName = "commits" | "twin" | "council" | "timeline" | "settings" | "menu" | "close" | "chevron" | "branch" | "merge" | "sparkle" | "wave";

export function Icon({ name, className }: { name: IconName; className?: string }) {
  const common = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.9, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  const paths: Record<IconName, React.ReactNode> = {
    commits: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M3 12h6M15 12h6" />
      </>
    ),
    twin: (
      <>
        <circle cx="12" cy="5" r="2.2" />
        <circle cx="5" cy="17" r="2.2" />
        <circle cx="19" cy="17" r="2.2" />
        <path d="M10.4 6.7 6.6 15.3M13.6 6.7l3.8 8.6M7.2 17h9.6" />
      </>
    ),
    council: (
      <>
        <circle cx="8" cy="9" r="2.4" />
        <circle cx="16" cy="9" r="2.4" />
        <path d="M3.5 19a4.6 4.6 0 0 1 9 0M11.5 19a4.6 4.6 0 0 1 9 0" />
      </>
    ),
    timeline: (
      <>
        <path d="M3 7h18M3 12h18M3 17h18" />
        <circle cx="8" cy="7" r="1.6" fill="currentColor" stroke="none" />
        <circle cx="15" cy="12" r="1.6" fill="currentColor" stroke="none" />
        <circle cx="11" cy="17" r="1.6" fill="currentColor" stroke="none" />
      </>
    ),
    settings: (
      <>
        <circle cx="12" cy="12" r="2.8" />
        <path d="M12 2.8v2.4M12 18.8v2.4M4.5 12H2.1M21.9 12h-2.4M6.7 6.7 5 5M19 19l-1.7-1.7M6.7 17.3 5 19M19 5l-1.7 1.7" />
      </>
    ),
    menu: <path d="M4 7h16M4 12h16M4 17h16" />,
    close: <path d="M18 6 6 18M6 6l12 12" />,
    chevron: <path d="m9 6 6 6-6 6" />,
    branch: (
      <>
        <circle cx="7" cy="6" r="2.2" />
        <circle cx="7" cy="18" r="2.2" />
        <circle cx="17" cy="10" r="2.2" />
        <path d="M7 8.2v7.6M9.2 6h3.6a2 2 0 0 1 2 2v0" />
      </>
    ),
    merge: (
      <>
        <circle cx="7" cy="6" r="2.2" />
        <circle cx="7" cy="18" r="2.2" />
        <circle cx="17" cy="14" r="2.2" />
        <path d="M7 8.2v7.6M9.2 18h3.6a2 2 0 0 0 2-2v0" />
      </>
    ),
    sparkle: <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />,
    wave: <path d="M4 12v-2M8 12V7M12 12V4M16 12V8M20 12v-3M4 12v2M8 12v5M12 12v8M16 12v4M20 12v3" />,
  };
  return (
    <svg {...common} className={cn("h-[18px] w-[18px]", className)}>
      {paths[name]}
    </svg>
  );
}

/* ───────────────────────────── Sidebar ───────────────────────────── */

export interface NavItem {
  id: string;
  label: string;
  icon: IconName;
  badge?: React.ReactNode;
  onSelect: () => void;
  active?: boolean;
}

/**
 * The collapsible sidebar. One component serves three presentations:
 *   • expanded  (xl default)  — full labels + the rich panels below the nav
 *   • collapsed (lg default)  — 60px icon rail, labels become accessible names + tooltips
 *   • drawer    (<lg)         — overlay dialog with the expanded presentation
 */
export function Sidebar({
  collapsed,
  onToggleCollapsed,
  nav,
  header,
  children,
  footer,
  inDrawer = false,
  onClose,
}: {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  nav: NavItem[];
  header?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  inDrawer?: boolean;
  onClose?: () => void;
}) {
  const showLabels = inDrawer || !collapsed;

  return (
    <div
      className={cn(
        "flex h-full min-h-0 flex-col border-r border-border/60 bg-card/40 backdrop-blur-md",
        inDrawer ? "w-[min(88vw,320px)]" : collapsed ? "w-[60px]" : "w-[288px]",
        !inDrawer && "transition-[width] duration-200 ease-out",
      )}
    >
      {/* brand / header */}
      <div className={cn("flex shrink-0 items-center gap-2 border-b border-border/50 px-2.5 py-2.5", showLabels && "px-3")}>
        <span
          className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-vox-cyan to-vox-violet text-xs font-black text-background"
          aria-hidden="true"
        >
          V
        </span>
        {showLabels && (
          <div className="min-w-0 leading-none">
            <p className="truncate text-sm font-bold tracking-tight">VOXEMBLY</p>
            <p className="truncate text-[10px] text-muted-foreground">Voice is the new compiler.</p>
          </div>
        )}
        {inDrawer ? (
          <Button variant="ghost" size="icon" className="ml-auto" onClick={onClose} aria-label="Close navigation">
            <Icon name="close" />
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="icon"
            className={cn("ml-auto h-7 w-7", collapsed && "absolute left-1/2 top-[46px] hidden -translate-x-1/2")}
            onClick={onToggleCollapsed}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!collapsed}
          >
            <Icon name="chevron" className={cn("h-4 w-4 transition-transform", !collapsed && "rotate-180")} />
          </Button>
        )}
      </div>

      {/* nav */}
      <nav aria-label="Studio sections" className="shrink-0 px-1.5 py-2">
        <ul className="space-y-0.5">
          {nav.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={item.onSelect}
                aria-current={item.active ? "page" : undefined}
                title={showLabels ? undefined : item.label}
                className={cn(
                  "group relative flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-sm font-medium transition-colors",
                  showLabels ? "justify-start" : "justify-center",
                  item.active ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
                )}
              >
                <Icon name={item.icon} className="shrink-0" />
                {showLabels ? (
                  <>
                    <span className="min-w-0 truncate">{item.label}</span>
                    {item.badge != null && <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground">{item.badge}</span>}
                  </>
                ) : (
                  <span className="sr-only">{item.label}</span>
                )}
                {!showLabels && item.badge != null && (
                  <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-vox-cyan" aria-hidden="true" />
                )}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      {/* rich panels — only meaningful when there is room for labels */}
      {showLabels && (
        <>
          {header && <div className="shrink-0 border-y border-border/50 px-3 py-2">{header}</div>}
          <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">{children}</div>
          {footer && <div className="shrink-0 border-t border-border/50 px-3 py-2">{footer}</div>}
        </>
      )}

      {/* collapsed rail keeps the expand affordance reachable at the bottom too */}
      {!showLabels && (
        <div className="mt-auto shrink-0 px-1.5 pb-2">
          <Button variant="ghost" size="icon" className="w-full" onClick={onToggleCollapsed} aria-label="Expand sidebar">
            <Icon name="chevron" className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}

/* ───────────────────────────── Drawer (mobile sidebar) ───────────────────────────── */

const FOCUSABLE = 'a[href],button:not([disabled]),textarea,input,select,[tabindex]:not([tabindex="-1"])';

export function Drawer({ open, onClose, label, children }: { open: boolean; onClose: () => void; label: string; children: React.ReactNode }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const restoreTo = React.useRef<HTMLElement | null>(null);

  React.useEffect(() => {
    if (!open) return;
    restoreTo.current = document.activeElement as HTMLElement | null;
    const node = ref.current;
    (node?.querySelector<HTMLElement>(FOCUSABLE) ?? node)?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !node) return;
      const items = [...node.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = prev;
      restoreTo.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 lg:hidden">
      <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <div ref={ref} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1} className="absolute inset-y-0 left-0 animate-fade-up shadow-2xl">
        {children}
      </div>
    </div>
  );
}

/* ───────────────────────────── Mobile tab bar ───────────────────────────── */

export function MobileTabBar({ items, value, onChange }: { items: { id: string; label: string; icon: IconName; badge?: number }[]; value: string; onChange: (id: string) => void }) {
  return (
    <div
      role="tablist"
      aria-label="Studio surfaces"
      className="flex shrink-0 items-stretch border-t border-border/60 bg-card/80 backdrop-blur-md lg:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {items.map((it) => {
        const active = value === it.id;
        return (
          <button
            key={it.id}
            role="tab"
            type="button"
            aria-selected={active}
            onClick={() => onChange(it.id)}
            className={cn(
              "relative flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-medium transition-colors",
              active ? "text-primary" : "text-muted-foreground",
            )}
          >
            <Icon name={it.icon} className="h-5 w-5" />
            {it.label}
            {it.badge ? (
              <span className="absolute right-[22%] top-1 min-w-[16px] rounded-full bg-vox-cyan px-1 font-mono text-[9px] font-bold leading-4 text-background" aria-hidden="true">
                {it.badge > 99 ? "99+" : it.badge}
              </span>
            ) : null}
            {active && <span className="absolute inset-x-4 top-0 h-0.5 rounded-full bg-primary" aria-hidden="true" />}
          </button>
        );
      })}
    </div>
  );
}

/* ───────────────────────────── Collapsible dock (timeline) ───────────────────────────── */

export function Dock({
  open,
  onToggle,
  label,
  summary,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  label: string;
  summary?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section aria-label={label} className="shrink-0 border-t border-border/60 bg-card/40 backdrop-blur-sm">
      <div className="flex items-center gap-2 px-3 py-1.5">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="flex items-center gap-1.5 rounded-md px-1 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
        >
          <Icon name="chevron" className={cn("h-3.5 w-3.5 transition-transform", open ? "-rotate-90" : "rotate-90")} />
          {label}
        </button>
        {summary && <div className="min-w-0 flex-1 truncate text-[10px] text-muted-foreground">{summary}</div>}
      </div>
      <div className={cn("overflow-hidden transition-[height] duration-200", open ? "h-[132px]" : "h-0")}>{open && children}</div>
    </section>
  );
}

/* ───────────────────────────── Stat pill (topbar) ───────────────────────────── */

export function Pill({ tone = "neutral", children, title }: { tone?: "neutral" | "cyan" | "violet" | "amber" | "rose" | "emerald"; children: React.ReactNode; title?: string }) {
  const tones = {
    neutral: "border-border bg-secondary/60 text-muted-foreground",
    cyan: "border-vox-cyan/40 bg-vox-cyan/10 text-vox-cyan",
    violet: "border-vox-violet/40 bg-vox-violet/10 text-vox-violet",
    amber: "border-vox-amber/40 bg-vox-amber/10 text-vox-amber",
    rose: "border-vox-rose/40 bg-vox-rose/10 text-vox-rose",
    emerald: "border-vox-emerald/40 bg-vox-emerald/10 text-vox-emerald",
  };
  return (
    <span title={title} className={cn("inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10px] font-medium leading-tight", tones[tone])}>
      {children}
    </span>
  );
}
