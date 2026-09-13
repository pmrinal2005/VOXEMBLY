"use client";

/**
 * VOXEMBLY UI primitives — shadcn/ui-shaped API, hand-rolled on Radix-free markup so the bundle
 * stays tiny and every control is keyboard + screen-reader operable (WCAG 2.2 AA).
 *
 * Accessibility contract honoured by every primitive here:
 *  - visible focus ring (`:focus-visible` in globals.css, never removed)
 *  - real semantics (`button`, `dialog`, `role="switch"`, `aria-pressed`, `aria-live`)
 *  - Escape closes overlays, focus is trapped in modals and restored on close
 *  - nothing depends on hover or colour alone to convey state
 */

import * as React from "react";
import { cn } from "@/lib/utils";

/* ───────────────────────────── Button ───────────────────────────── */

type ButtonVariant = "primary" | "secondary" | "ghost" | "outline" | "destructive";
type ButtonSize = "sm" | "md" | "lg" | "icon";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-primary text-primary-foreground hover:bg-primary/90 shadow-[0_0_20px_-6px_hsl(var(--primary)/0.7)]",
  secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
  ghost: "hover:bg-secondary/70 text-foreground",
  outline: "border border-border bg-transparent hover:bg-secondary/60 text-foreground",
  destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-xs gap-1.5",
  md: "h-10 px-4 text-sm gap-2",
  lg: "h-12 px-6 text-base gap-2",
  icon: "h-9 w-9 p-0",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = "secondary", size = "md", loading, disabled, children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={props.type ?? "button"}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        "inline-flex select-none items-center justify-center whitespace-nowrap rounded-md font-medium transition-colors",
        "disabled:pointer-events-none disabled:opacity-50",
        BUTTON_VARIANTS[variant],
        BUTTON_SIZES[size],
        className,
      )}
      {...props}
    >
      {loading && <Spinner className="h-3.5 w-3.5" />}
      {children}
    </button>
  );
});

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cn("animate-spin", className)} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/* ───────────────────────────── Card ───────────────────────────── */

export function Card({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("rounded-xl border border-border/80 bg-card text-card-foreground", className)} {...props}>
      {children}
    </div>
  );
}

export function CardHeader({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("flex items-center justify-between gap-3 border-b border-border/60 px-4 py-3", className)} {...props}>
      {children}
    </div>
  );
}

export function CardTitle({ className, children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3 className={cn("text-sm font-semibold tracking-tight", className)} {...props}>
      {children}
    </h3>
  );
}

export function CardBody({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("px-4 py-3", className)} {...props}>
      {children}
    </div>
  );
}

/* ───────────────────────────── Badge ───────────────────────────── */

export function Badge({
  className,
  tone = "neutral",
  children,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: "neutral" | "cyan" | "violet" | "amber" | "rose" | "emerald" }) {
  const tones = {
    neutral: "border-border bg-secondary/70 text-muted-foreground",
    cyan: "border-vox-cyan/40 bg-vox-cyan/10 text-vox-cyan",
    violet: "border-vox-violet/40 bg-vox-violet/10 text-vox-violet",
    amber: "border-vox-amber/40 bg-vox-amber/10 text-vox-amber",
    rose: "border-vox-rose/40 bg-vox-rose/10 text-vox-rose",
    emerald: "border-vox-emerald/40 bg-vox-emerald/10 text-vox-emerald",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-tight",
        tones[tone],
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}

/* ───────────────────────────── Modal ───────────────────────────── */

const FOCUSABLE = 'a[href],button:not([disabled]),textarea,input,select,[tabindex]:not([tabindex="-1"])';

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
  labelledBy,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
  labelledBy?: string;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const restoreTo = React.useRef<HTMLElement | null>(null);
  const titleId = labelledBy ?? React.useId();

  React.useEffect(() => {
    if (!open) return;
    restoreTo.current = document.activeElement as HTMLElement | null;
    const node = ref.current;
    // Focus the first control inside the dialog so keyboard users land in the right place.
    const first = node?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? node)?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !node) return;
      // Focus trap.
      const items = [...node.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
      if (!items.length) return;
      const firstEl = items[0];
      const lastEl = items[items.length - 1];
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = prevOverflow;
      restoreTo.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  const widths = { sm: "max-w-md", md: "max-w-2xl", lg: "max-w-4xl", xl: "max-w-6xl" };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn(
          "relative z-10 flex max-h-[88vh] w-full flex-col overflow-hidden rounded-2xl border border-border glass shadow-2xl animate-fade-up",
          widths[size],
        )}
      >
        <header className="flex items-start justify-between gap-4 border-b border-border/60 px-5 py-4">
          <div>
            <h2 id={titleId} className="text-base font-semibold tracking-tight">
              {title}
            </h2>
            {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label={`Close ${title}`}>
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" />
            </svg>
          </Button>
        </header>
        <div className="scrollbar-thin flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <footer className="border-t border-border/60 px-5 py-3">{footer}</footer>}
      </div>
    </div>
  );
}

/* ───────────────────────────── Switch ───────────────────────────── */

export function Switch({
  checked,
  onChange,
  label,
  description,
  disabled,
  id,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
  id?: string;
}) {
  const autoId = React.useId();
  const inputId = id ?? autoId;
  const descId = `${inputId}-desc`;
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <div className="min-w-0">
        <label htmlFor={inputId} className="block text-sm font-medium">
          {label}
        </label>
        {description && (
          <p id={descId} className="mt-0.5 text-xs text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      <button
        id={inputId}
        role="switch"
        type="button"
        aria-checked={checked}
        aria-describedby={description ? descId : undefined}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative h-6 w-11 shrink-0 rounded-full border transition-colors disabled:opacity-50",
          checked ? "border-primary bg-primary/80" : "border-border bg-secondary",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 h-4.5 w-4.5 rounded-full bg-foreground transition-transform",
            checked ? "translate-x-[22px]" : "translate-x-0.5",
          )}
          style={{ height: 18, width: 18 }}
          aria-hidden="true"
        />
      </button>
    </div>
  );
}

/* ───────────────────────────── Select / Field ───────────────────────────── */

export function Field({
  label,
  hint,
  children,
  htmlFor,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export const inputClass =
  "w-full rounded-md border border-input bg-background/60 px-3 py-2 text-sm placeholder:text-muted-foreground/70 focus:border-primary";

export function Select({
  className,
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(inputClass, "appearance-none pr-8", className)} {...props}>
      {children}
    </select>
  );
}

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(inputClass, className)} {...props} />;
}

/* ───────────────────────────── Segmented control ───────────────────────────── */

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  className,
}: {
  value: T;
  options: { value: T; label: string; hint?: string }[];
  onChange: (v: T) => void;
  ariaLabel: string;
  className?: string;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className={cn("inline-flex rounded-lg border border-border bg-secondary/50 p-0.5", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          type="button"
          aria-checked={value === o.value}
          title={o.hint}
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
            value === o.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ───────────────────────────── Stat ───────────────────────────── */

export function Stat({
  label,
  value,
  sub,
  tone = "neutral",
  mono = true,
}: {
  label: string;
  value: React.ReactNode;
  sub?: string;
  tone?: "neutral" | "cyan" | "emerald" | "amber" | "rose";
  mono?: boolean;
}) {
  const tones = {
    neutral: "text-foreground",
    cyan: "text-vox-cyan",
    emerald: "text-vox-emerald",
    amber: "text-vox-amber",
    rose: "text-vox-rose",
  };
  return (
    <div className="min-w-0">
      <div className="truncate text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn("truncate text-lg font-semibold leading-tight", mono && "font-mono", tones[tone])}>{value}</div>
      {sub && <div className="truncate text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

/* ───────────────────────────── Tooltip (title-based, no JS deps) ───────────────────────────── */

export function Hint({ children, text }: { children: React.ReactNode; text: string }) {
  return (
    <span className="group relative inline-flex items-center" tabIndex={0} aria-label={text}>
      {children}
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-40 mb-2 w-max max-w-[260px] -translate-x-1/2 rounded-md border border-border bg-popover px-2 py-1 text-[11px] text-popover-foreground opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
      >
        {text}
      </span>
    </span>
  );
}

/* ───────────────────────────── Empty state ───────────────────────────── */

export function Empty({ icon, title, hint }: { icon?: React.ReactNode; title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      {icon && <div className="text-muted-foreground/60">{icon}</div>}
      <p className="text-sm font-medium text-muted-foreground">{title}</p>
      {hint && <p className="max-w-xs text-xs text-muted-foreground/70">{hint}</p>}
    </div>
  );
}

/* ───────────────────────────── Progress ───────────────────────────── */

export function Progress({ value, label, tone = "cyan" }: { value: number; label?: string; tone?: "cyan" | "emerald" | "amber" }) {
  const pct = Math.max(0, Math.min(100, value * 100));
  const tones = { cyan: "bg-vox-cyan", emerald: "bg-vox-emerald", amber: "bg-vox-amber" };
  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      className="h-1.5 w-full overflow-hidden rounded-full bg-secondary"
    >
      <div className={cn("h-full rounded-full transition-[width] duration-500", tones[tone])} style={{ width: `${pct}%` }} />
    </div>
  );
}

/* ───────────────────────────── Kbd ───────────────────────────── */

export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-border bg-secondary/80 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-muted-foreground">
      {children}
    </kbd>
  );
}
