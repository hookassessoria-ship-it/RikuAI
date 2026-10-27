import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell, ComposedChart, Line, ReferenceLine, Legend,
} from "recharts";
import type { DayPoint } from "@/lib/finance/engine";
import { formatBRL, formatPct } from "@/lib/money";
import { fmtShort, fmtWeekdayShort } from "@/lib/dates";

const C = {
  primary: "hsl(var(--primary))",
  ok: "hsl(var(--success))",
  bad: "hsl(var(--danger))",
  warn: "hsl(var(--warning))",
  c2: "hsl(var(--chart-2))",
  c3: "hsl(var(--chart-3))",
  neutral: "hsl(var(--neutral))",
};
const tooltipStyle = {
  contentStyle: { background: "hsl(var(--surface-raised))", border: "1px solid hsl(var(--border))", borderRadius: 12, color: "hsl(var(--foreground))", fontSize: 12 },
  labelStyle: { color: "hsl(var(--foreground-muted))", fontWeight: 600 },
  cursor: { fill: "hsl(var(--surface-overlay) / 0.5)" },
};
const dayLabel = (d: string) => `${fmtWeekdayShort(d)} ${fmtShort(d)}`;
const brlAxis = (v: number) => (Math.abs(v) >= 100000 ? `${Math.round(v / 100000)}k` : `${Math.round(v / 100)}`);
const H = 210;

export function RevenueChart({ data }: { data: DayPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={H}>
      <BarChart data={data} margin={{ top: 8, right: 4, left: -14, bottom: 0 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis dataKey="day" tickFormatter={fmtShort} tickLine={false} axisLine={false} minTickGap={12} />
        <YAxis tickFormatter={brlAxis} tickLine={false} axisLine={false} width={44} />
        <Tooltip {...tooltipStyle} labelFormatter={dayLabel} formatter={(v: number, n) => [formatBRL(v), n === "net" ? "Faturamento" : "Recebido"]} />
        <Legend formatter={(v) => (v === "net" ? "Faturamento" : "Recebido")} wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="net" fill={C.primary} radius={[6, 6, 0, 0]} maxBarSize={28} />
        <Bar dataKey="received" fill={C.c2} radius={[6, 6, 0, 0]} maxBarSize={28} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function ContributionChart({ data }: { data: DayPoint[] }) {
  const rows = data.map((d) => ({ day: d.day, value: d.contribution ?? d.contributionKnown, pending: d.contribution == null && d.orders > 0 }));
  return (
    <ResponsiveContainer width="100%" height={H}>
      <BarChart data={rows} margin={{ top: 8, right: 4, left: -14, bottom: 0 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis dataKey="day" tickFormatter={fmtShort} tickLine={false} axisLine={false} minTickGap={12} />
        <YAxis tickFormatter={brlAxis} tickLine={false} axisLine={false} width={44} />
        <ReferenceLine y={0} stroke="hsl(var(--foreground-subtle))" />
        <Tooltip {...tooltipStyle} labelFormatter={dayLabel} formatter={(v: number, _n, p) => [formatBRL(v), (p?.payload as { pending: boolean }).pending ? "Contribuição (sem custo das placas — pendente)" : "Contribuição"]} />
        <Bar dataKey="value" radius={[6, 6, 0, 0]} maxBarSize={28}>
          {rows.map((r) => (
            <Cell key={r.day} fill={r.pending ? C.neutral : r.value < 0 ? C.bad : C.ok} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function OrdersUnitsChart({ data }: { data: DayPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={H}>
      <BarChart data={data} margin={{ top: 8, right: 4, left: -12, bottom: 0 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis dataKey="day" tickFormatter={fmtShort} tickLine={false} axisLine={false} minTickGap={12} />
        <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={30} />
        <Tooltip {...tooltipStyle} labelFormatter={dayLabel} formatter={(v: number, n) => [v, n === "orders" ? "Pedidos" : "Placas"]} />
        <Legend formatter={(v) => (v === "orders" ? "Pedidos" : "Placas")} wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="orders" fill={C.primary} radius={[6, 6, 0, 0]} maxBarSize={24} />
        <Bar dataKey="units" fill={C.c3} radius={[6, 6, 0, 0]} maxBarSize={24} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function ConversionChart({ data, target }: { data: DayPoint[]; target?: number | null }) {
  return (
    <ResponsiveContainer width="100%" height={H}>
      <ComposedChart data={data} margin={{ top: 8, right: 0, left: -10, bottom: 0 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis dataKey="day" tickFormatter={fmtShort} tickLine={false} axisLine={false} minTickGap={12} />
        <YAxis yAxisId="v" allowDecimals={false} tickLine={false} axisLine={false} width={30} />
        <YAxis yAxisId="c" orientation="right" tickFormatter={(v) => `${v}%`} tickLine={false} axisLine={false} width={40} domain={[0, (max: number) => Math.max(20, Math.ceil(max / 10) * 10)]} />
        <Tooltip {...tooltipStyle} labelFormatter={dayLabel} formatter={(v: number, n) => (n === "conversion" ? [formatPct(v), "Conversão"] : [v, "Visitas realizadas"])} />
        <Legend formatter={(v) => (v === "conversion" ? "Conversão" : "Visitas")} wrapperStyle={{ fontSize: 12 }} />
        <Bar yAxisId="v" dataKey="visits" fill="hsl(var(--surface-overlay))" stroke="hsl(var(--border))" radius={[6, 6, 0, 0]} maxBarSize={26} />
        <Line yAxisId="c" dataKey="conversion" stroke={C.primary} strokeWidth={2.5} dot={{ r: 3 }} connectNulls={false} />
        {target != null && <ReferenceLine yAxisId="c" y={target} stroke={C.ok} strokeDasharray="5 4" label={{ value: `meta ${target}%`, fill: "hsl(var(--success))", fontSize: 11, position: "insideTopRight" }} />}
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function RevenueVsCostsChart({ data }: { data: DayPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={H + 20}>
      <ComposedChart data={data} margin={{ top: 8, right: 4, left: -14, bottom: 0 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis dataKey="day" tickFormatter={fmtShort} tickLine={false} axisLine={false} minTickGap={12} />
        <YAxis tickFormatter={brlAxis} tickLine={false} axisLine={false} width={44} />
        <Tooltip {...tooltipStyle} labelFormatter={dayLabel} formatter={(v: number, n) => [formatBRL(v), ({ cogs: "CPV (custo das placas)", variable: "Custos variáveis", opExpenses: "Despesas operacionais", net: "Faturamento" } as Record<string, string>)[n as string] ?? n]} />
        <Legend formatter={(v) => ({ cogs: "CPV", variable: "Variáveis", opExpenses: "Despesas", net: "Faturamento" } as Record<string, string>)[v] ?? v} wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="cogs" stackId="c" fill={C.c3} maxBarSize={28} />
        <Bar dataKey="variable" stackId="c" fill={C.warn} maxBarSize={28} />
        <Bar dataKey="opExpenses" stackId="c" fill={C.bad} radius={[6, 6, 0, 0]} maxBarSize={28} />
        <Line dataKey="net" stroke={C.ok} strokeWidth={2.5} dot={{ r: 3 }} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function GoalChart({ data, target, label }: { data: { day: string; value: number | null }[]; target: number | null; label: string }) {
  return (
    <ResponsiveContainer width="100%" height={H}>
      <BarChart data={data} margin={{ top: 8, right: 4, left: -12, bottom: 0 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis dataKey="day" tickFormatter={fmtShort} tickLine={false} axisLine={false} minTickGap={12} />
        <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={30} />
        <Tooltip {...tooltipStyle} labelFormatter={dayLabel} formatter={(v: number) => [v, label]} />
        {target != null && <ReferenceLine y={target} stroke={C.ok} strokeDasharray="5 4" label={{ value: `meta ${target}`, fill: "hsl(var(--success))", fontSize: 11, position: "insideTopRight" }} />}
        <Bar dataKey="value" radius={[6, 6, 0, 0]} maxBarSize={28}>
          {data.map((d) => (
            <Cell key={d.day} fill={target == null || d.value == null ? C.primary : d.value >= target ? C.ok : d.value >= target * 0.66 ? C.warn : C.bad} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function HBarChart({ rows, valueLabel, f }: { rows: { label: string; value: number; n: number; dim?: boolean }[]; valueLabel: string; f: (v: number) => string }) {
  const h = Math.max(120, rows.length * 38 + 20);
  return (
    <ResponsiveContainer width="100%" height={h}>
      <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 12, left: 4, bottom: 4 }}>
        <XAxis type="number" hide />
        <YAxis type="category" dataKey="label" width={118} tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
        <Tooltip {...tooltipStyle} formatter={(v: number, _n, p) => [`${f(v)} (n=${(p?.payload as { n: number }).n})`, valueLabel]} />
        <Bar dataKey="value" radius={[0, 6, 6, 0]} maxBarSize={22}>
          {rows.map((r) => (
            <Cell key={r.label} fill={r.dim ? C.neutral : C.primary} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
