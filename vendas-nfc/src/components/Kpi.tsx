import type { ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Metric } from "@/lib/finance/engine";
import type { Evaluation } from "@/lib/finance/goals";
import { Badge, InfoTip, LightBadge, Progress, LIGHT_STYLE } from "./ui";
import { formatBRL, formatPct, formatNumber } from "@/lib/money";

export type Fmt = "brl" | "pct" | "int" | "dec" | "brl_h";
export function fmt(v: number | null | undefined, f: Fmt): string {
  if (v == null || !Number.isFinite(v)) return "—";
  switch (f) {
    case "brl": return formatBRL(Math.round(v));
    case "brl_h": return `${formatBRL(Math.round(v))}/h`;
    case "pct": return formatPct(v);
    case "int": return formatNumber(v, 0);
    case "dec": return formatNumber(v, 2);
  }
}

/** Variação vs período anterior equivalente. */
export function Delta({ now, prev, higherIsBetter = true, f = "brl" }: { now: number | null; prev: number | null; higherIsBetter?: boolean; f?: Fmt }) {
  if (now == null || prev == null) return <span className="text-xs text-subtle">sem comparação</span>;
  const diff = now - prev;
  if (diff === 0) return <span className="inline-flex items-center gap-1 whitespace-nowrap text-xs text-subtle"><Minus className="h-3 w-3" />igual ao anterior</span>;
  const good = higherIsBetter ? diff > 0 : diff < 0;
  const pct = prev !== 0 ? (diff / Math.abs(prev)) * 100 : null;
  const Icon = diff > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={cn("inline-flex items-center gap-0.5 whitespace-nowrap text-xs font-semibold", good ? "text-ok" : "text-bad")} title="Comparado ao período anterior equivalente">
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {pct != null ? `${diff > 0 ? "+" : ""}${formatPct(pct, 0)}` : `${diff > 0 ? "+" : ""}${fmt(diff, f)}`}
      <span className="ml-0.5 font-normal text-subtle">vs ant.</span>
    </span>
  );
}

export function MetricValue({ m, f, size = "lg", pendingLabel = "sem custo das placas" }: { m: Metric; f: Fmt; size?: "lg" | "md"; pendingLabel?: string }) {
  const big = size === "lg" ? "text-[26px] leading-8" : "text-xl";
  if (m.state === "pendente")
    return (
      <div>
        <div className={cn("font-extrabold tracking-tight text-neutral", big)}>Pendente</div>
        <div className="text-xs text-subtle">{pendingLabel}: {fmt(m.value, f)}</div>
      </div>
    );
  if (m.state === "sem_dados" || m.value == null) return <div className={cn("font-extrabold tracking-tight text-subtle", big)}>—</div>;
  return (
    <div className="flex items-baseline gap-2">
      <div className={cn("font-extrabold tracking-tight tabular", big, m.value < 0 && (f === "brl" || f === "pct") && "text-bad")}>{fmt(m.value, f)}</div>
      {m.state === "parcial" && <Badge tone="warn">incompleto</Badge>}
    </div>
  );
}

export function Kpi({
  label, metric, f, definition, period, prev, higherIsBetter = true, evaluation, children, className, icon, pendingLabel,
}: {
  label: string;
  metric: Metric;
  f: Fmt;
  definition: ReactNode;
  period: string;
  prev?: Metric | null;
  higherIsBetter?: boolean;
  evaluation?: Evaluation | null;
  children?: ReactNode;
  className?: string;
  icon?: ReactNode;
  pendingLabel?: string;
}) {
  const light = evaluation?.light;
  return (
    <div className={cn("card relative overflow-hidden p-4 animate-slide-up", className)}>
      {light && (light === "verde" || light === "amarelo" || light === "vermelho") && (
        <div className={cn("absolute inset-y-0 left-0 w-1", LIGHT_STYLE[light].bar)} aria-hidden />
      )}
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          {icon && <span className="text-subtle">{icon}</span>}
          <span className="line-clamp-2 text-[11px] font-bold uppercase leading-tight tracking-wider text-muted">{label}</span>
        </div>
        <InfoTip title={label}>
          <p>{definition}</p>
          <p><strong>Período:</strong> {period}.</p>
          {metric.reason && <p><strong>Observação:</strong> {metric.reason}</p>}
          {evaluation && <p><strong>Regra do semáforo:</strong> {evaluation.rule}</p>}
        </InfoTip>
      </div>
      <div className="mt-1.5">
        <MetricValue m={metric} f={f} pendingLabel={pendingLabel} />
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
        {prev !== undefined && <Delta now={metric.state === "sem_dados" ? null : metric.value} prev={prev && prev.state !== "sem_dados" ? prev.value : null} higherIsBetter={higherIsBetter} f={f} />}
        {evaluation && <LightBadge light={evaluation.light} label={evaluation.label} />}
      </div>
      {evaluation?.progress != null && <Progress className="mt-2" value={evaluation.progress} light={evaluation.light} label={`Progresso de ${label}`} />}
      {children}
    </div>
  );
}
