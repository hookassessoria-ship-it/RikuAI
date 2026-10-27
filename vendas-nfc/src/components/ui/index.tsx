import { useEffect, useId, useRef, useState, type ReactNode, type ButtonHTMLAttributes, type InputHTMLAttributes } from "react";
import { X, Info, CheckCircle2, AlertTriangle, XOctagon, MinusCircle, Clock3, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { parseBRL, centsToInput, type Cents } from "@/lib/money";
import type { Light } from "@/lib/finance/goals";

// ---------------------------------------------------------------- Botões
type BtnVariant = "primary" | "secondary" | "ghost" | "danger" | "soft";
export function Button({ variant = "secondary", size = "md", className, loading, children, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: "sm" | "md" | "lg"; loading?: boolean }) {
  return (
    <button
      {...p}
      disabled={p.disabled || loading}
      className={cn(
        "press inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-colors disabled:opacity-50 disabled:pointer-events-none select-none",
        size === "sm" && "h-9 px-3 text-sm",
        size === "md" && "h-11 px-4 text-sm",
        size === "lg" && "h-14 px-5 text-base",
        variant === "primary" && "bg-primary text-primary-foreground shadow-[0_8px_24px_-10px_hsl(var(--primary)/0.8)] hover:brightness-110",
        variant === "secondary" && "bg-surface-raised text-foreground border border-border hover:bg-surface-overlay",
        variant === "ghost" && "text-foreground hover:bg-surface-raised",
        variant === "danger" && "bg-bad text-white hover:brightness-110",
        variant === "soft" && "bg-primary-soft text-primary hover:brightness-110",
        className,
      )}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  );
}

export function IconButton({ label, className, children, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button {...p} aria-label={label} title={label} className={cn("press grid h-10 w-10 place-items-center rounded-xl text-foreground hover:bg-surface-raised disabled:opacity-40", className)}>
      {children}
    </button>
  );
}

// ---------------------------------------------------------------- Superfícies
export function Card({ title, subtitle, action, className, children, padded = true }: { title?: ReactNode; subtitle?: ReactNode; action?: ReactNode; className?: string; children?: ReactNode; padded?: boolean }) {
  return (
    <section className={cn("card animate-slide-up", padded && "p-4 sm:p-5", className)}>
      {(title || action) && (
        <header className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            {title && <h2 className="text-[13px] font-bold uppercase tracking-wider text-muted">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-subtle">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function Badge({ tone = "neutral", children, className }: { tone?: "neutral" | "ok" | "warn" | "bad" | "primary" | "demo"; children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold leading-5",
        tone === "neutral" && "bg-neutral-soft text-neutral",
        tone === "ok" && "bg-ok-soft text-ok",
        tone === "warn" && "bg-warn-soft text-warn",
        tone === "bad" && "bg-bad-soft text-bad",
        tone === "primary" && "bg-primary-soft text-primary",
        tone === "demo" && "bg-demo-soft text-demo",
        className,
      )}
    >
      {children}
    </span>
  );
}

// ---------------------------------------------------------------- Semáforo
export const LIGHT_STYLE: Record<Light, { tone: "ok" | "warn" | "bad" | "neutral"; Icon: typeof CheckCircle2; bar: string }> = {
  verde: { tone: "ok", Icon: CheckCircle2, bar: "bg-ok" },
  amarelo: { tone: "warn", Icon: AlertTriangle, bar: "bg-warn" },
  vermelho: { tone: "bad", Icon: XOctagon, bar: "bg-bad" },
  sem_dados: { tone: "neutral", Icon: MinusCircle, bar: "bg-neutral" },
  sem_meta: { tone: "neutral", Icon: MinusCircle, bar: "bg-neutral" },
  pendente: { tone: "neutral", Icon: Clock3, bar: "bg-neutral" },
};

export function LightBadge({ light, label }: { light: Light; label: string }) {
  const s = LIGHT_STYLE[light];
  return (
    <Badge tone={s.tone}>
      <s.Icon className="h-3.5 w-3.5" aria-hidden />
      {label}
    </Badge>
  );
}

export function Progress({ value, light = "sem_meta", className, label }: { value: number | null; light?: Light; className?: string; label?: string }) {
  const pct = value == null ? 0 : Math.max(0, Math.min(1, value)) * 100;
  return (
    <div className={cn("h-2 w-full overflow-hidden rounded-full bg-surface-overlay", className)} role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <div className={cn("h-full rounded-full transition-[width] duration-700 ease-out", value == null ? "bg-transparent" : LIGHT_STYLE[light].bar)} style={{ width: `${pct}%` }} />
    </div>
  );
}

// ---------------------------------------------------------------- Sheet (gaveta inferior / modal)
export function Sheet({ open, onClose, title, subtitle, children, footer, wide }: { open: boolean; onClose: () => void; title: ReactNode; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    setTimeout(() => ref.current?.focus(), 30);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/55 animate-fade-in" onClick={onClose} />
      <div
        ref={ref}
        tabIndex={-1}
        className={cn(
          "relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-3xl border border-border bg-surface shadow-2xl outline-none animate-sheet-in sm:rounded-3xl sm:animate-pop",
          wide ? "sm:max-w-3xl" : "sm:max-w-lg",
        )}
      >
        <div className="mx-auto mt-2 h-1.5 w-10 rounded-full bg-surface-overlay sm:hidden" />
        <header className="flex items-start justify-between gap-3 px-5 pb-3 pt-3">
          <div className="min-w-0">
            <h3 className="text-lg font-extrabold tracking-tight">{title}</h3>
            {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
          </div>
          <IconButton label="Fechar" onClick={onClose}>
            <X className="h-5 w-5" />
          </IconButton>
        </header>
        <div className="flex-1 overflow-y-auto px-5 pb-4">{children}</div>
        {footer && <footer className="border-t border-border bg-surface px-5 py-3 pb-safe">{footer}</footer>}
      </div>
    </div>
  );
}

export function Confirm({ open, onClose, onConfirm, title, message, confirmLabel = "Confirmar", danger, loading }: { open: boolean; onClose: () => void; onConfirm: () => void; title: string; message: ReactNode; confirmLabel?: string; danger?: boolean; loading?: boolean }) {
  return (
    <Sheet open={open} onClose={onClose} title={title}
      footer={<div className="flex gap-2"><Button className="flex-1" onClick={onClose}>Voltar</Button><Button className="flex-1" variant={danger ? "danger" : "primary"} onClick={onConfirm} loading={loading}>{confirmLabel}</Button></div>}>
      <div className="text-sm text-muted">{message}</div>
    </Sheet>
  );
}

// ---------------------------------------------------------------- Formulários
export function Field({ label, hint, error, children, className }: { label: string; hint?: ReactNode; error?: string | null; children: ReactNode; className?: string }) {
  return (
    <label className={cn("block", className)}>
      <span className="mb-1.5 block text-[13px] font-semibold text-muted">{label}</span>
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-subtle">{hint}</span>}
      {error && <span className="mt-1 block text-xs font-medium text-bad">{error}</span>}
    </label>
  );
}

export const inputCls = "h-12 w-full rounded-xl border border-border bg-surface-raised px-3.5 text-[16px] text-foreground placeholder:text-subtle outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/30";

export function Input(p: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...p} className={cn(inputCls, p.className)} />;
}

export function Textarea(p: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...p} className={cn(inputCls, "h-auto min-h-[84px] py-3", p.className)} />;
}

export function Select({ options, value, onChange, className, ...p }: { options: { value: string; label: string }[]; value: string; onChange: (v: string) => void; className?: string } & Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "onChange" | "value">) {
  return (
    <select {...p} value={value} onChange={(e) => onChange(e.target.value)} className={cn(inputCls, "appearance-none pr-8", className)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/** Campo de dinheiro em BRL. `value` em centavos; null = vazio (não informado). */
export function MoneyInput({ value, onChange, placeholder = "0,00", allowEmpty = true, className, ...p }: { value: Cents | null; onChange: (c: Cents | null) => void; placeholder?: string; allowEmpty?: boolean; className?: string } & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">) {
  const [text, setText] = useState(centsToInput(value));
  const last = useRef(value);
  useEffect(() => {
    if (value !== last.current) {
      setText(centsToInput(value));
      last.current = value;
    }
  }, [value]);
  return (
    <div className={cn("relative", className)}>
      <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-semibold text-subtle">R$</span>
      <input
        {...p}
        inputMode="decimal"
        value={text}
        placeholder={placeholder}
        onChange={(e) => {
          const t = e.target.value.replace(/[^\d,.-]/g, "");
          setText(t);
          const c = t.trim() === "" ? (allowEmpty ? null : 0) : parseBRL(t);
          if (c !== null || t.trim() === "") {
            last.current = c;
            onChange(c);
          }
        }}
        className={cn(inputCls, "pl-10 tabular")}
      />
    </div>
  );
}

export function NumberInput({ value, onChange, suffix, step = "any", allowEmpty = false, ...p }: { value: number | null; onChange: (v: number | null) => void; suffix?: string; step?: string; allowEmpty?: boolean } & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">) {
  const [text, setText] = useState(value == null ? "" : String(value).replace(".", ","));
  const last = useRef(value);
  useEffect(() => {
    if (value !== last.current) {
      setText(value == null ? "" : String(value).replace(".", ","));
      last.current = value;
    }
  }, [value]);
  return (
    <div className="relative">
      <input
        {...p}
        inputMode="decimal"
        step={step}
        value={text}
        onChange={(e) => {
          const t = e.target.value.replace(/[^\d,.-]/g, "");
          setText(t);
          if (t.trim() === "") {
            last.current = allowEmpty ? null : 0;
            onChange(allowEmpty ? null : 0);
            return;
          }
          const n = Number(t.replace(",", "."));
          if (Number.isFinite(n)) {
            last.current = n;
            onChange(n);
          }
        }}
        className={cn(inputCls, "tabular", suffix && "pr-10")}
      />
      {suffix && <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-sm font-semibold text-subtle">{suffix}</span>}
    </div>
  );
}

export function Stepper({ value, onChange, min = 1, max = 999 }: { value: number; onChange: (v: number) => void; min?: number; max?: number }) {
  return (
    <div className="flex h-12 items-center overflow-hidden rounded-xl border border-border bg-surface-raised">
      <button type="button" aria-label="Diminuir" className="press h-full w-12 text-xl font-bold disabled:opacity-30" disabled={value <= min} onClick={() => onChange(Math.max(min, value - 1))}>−</button>
      <input inputMode="numeric" aria-label="Quantidade" className="h-full w-full min-w-0 bg-transparent text-center text-lg font-bold tabular outline-none" value={value} onChange={(e) => {
        const n = parseInt(e.target.value.replace(/\D/g, "") || "0", 10);
        onChange(Math.min(max, Math.max(min, n || min)));
      }} />
      <button type="button" aria-label="Aumentar" className="press h-full w-12 text-xl font-bold disabled:opacity-30" disabled={value >= max} onClick={() => onChange(Math.min(max, value + 1))}>+</button>
    </div>
  );
}

export function Chips<T extends string>({ options, value, onChange, className, size = "md" }: { options: { value: T; label: ReactNode; tone?: string }[]; value: T | null; onChange: (v: T) => void; className?: string; size?: "sm" | "md" }) {
  return (
    <div className={cn("flex flex-wrap gap-2", className)} role="radiogroup">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "press shrink-0 whitespace-nowrap rounded-full border font-semibold transition-colors",
            size === "md" ? "h-10 px-4 text-sm" : "h-8 px-3 text-xs",
            value === o.value ? "border-primary bg-primary text-primary-foreground" : "border-border bg-surface-raised text-foreground hover:bg-surface-overlay",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; hint?: ReactNode }) {
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <label htmlFor={id} className="min-w-0 cursor-pointer">
        <span className="block text-sm font-semibold">{label}</span>
        {hint && <span className="block text-xs text-subtle">{hint}</span>}
      </label>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn("press relative h-7 w-12 shrink-0 rounded-full transition-colors", checked ? "bg-primary" : "bg-surface-overlay")}
      >
        <span className={cn("absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform", checked ? "translate-x-[22px]" : "translate-x-0.5")} />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------- Estados
export function EmptyState({ icon: Icon, title, children, action }: { icon: typeof Info; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-4 py-8 text-center animate-fade-in">
      <div className="mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-primary-soft text-primary">
        <Icon className="h-7 w-7" />
      </div>
      <h3 className="text-base font-bold">{title}</h3>
      {children && <div className="mt-1 max-w-sm text-sm text-muted">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function InfoTip({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" aria-label={`Como é calculado: ${title}`} onClick={(e) => { e.stopPropagation(); setOpen(true); }} className="press -m-1 grid h-7 w-7 place-items-center rounded-lg text-subtle hover:text-foreground">
        <Info className="h-4 w-4" />
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title={title}>
        <div className="space-y-2 pb-2 text-sm text-muted">{children}</div>
      </Sheet>
    </>
  );
}

export function Spinner() {
  return (
    <div className="grid min-h-[50vh] place-items-center">
      <Loader2 className="h-7 w-7 animate-spin text-primary" />
    </div>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-2 mt-6 flex items-center justify-between px-1">
      <h2 className="text-[13px] font-bold uppercase tracking-wider text-muted">{children}</h2>
      {action}
    </div>
  );
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "ok" | "warn" | "bad" | "neutral" }) {
  return (
    <div className="min-w-0 rounded-2xl bg-surface-raised/70 p-3">
      <div className="line-clamp-2 text-[10.5px] font-semibold uppercase leading-tight tracking-wide text-subtle">{label}</div>
      <div className={cn("mt-0.5 truncate text-lg font-extrabold tabular", tone === "ok" && "text-ok", tone === "warn" && "text-warn", tone === "bad" && "text-bad")}>{value}</div>
      {sub && <div className="truncate text-xs text-subtle">{sub}</div>}
    </div>
  );
}
