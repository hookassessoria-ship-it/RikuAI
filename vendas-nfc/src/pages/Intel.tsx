import { useMemo, useState } from "react";
import { Lightbulb, TrendingUp, AlertTriangle, Info, ThumbsUp, Filter, Clock, Repeat } from "lucide-react";
import type { AppData } from "@/hooks/useData";
import type { Dataset } from "@/lib/finance/engine";
import type { Settings } from "@/db/types";
import { aggregate } from "@/lib/finance/engine";
import { breakdown, funnel, lossReasons, pendingFollowUps, closingStats, expenseByCategory, recommendations, type GroupBy, type GroupStat } from "@/lib/finance/intel";
import { evalFor, goalPeriodOf } from "@/hooks/useMetrics";
import { usePeriod } from "@/hooks/usePeriod";
import { periodRange, previousRange, PERIOD_LABELS, startOfMonth, addDays, startOfDay } from "@/lib/dates";
import { formatBRL, formatPct, formatNumber } from "@/lib/money";
import { INDICATORS, findRule } from "@/lib/finance/goals";
import { transportBudget } from "@/lib/finance/transport";
import { cn } from "@/lib/utils";
import { PeriodPicker } from "./Overview";
import { MetricValue } from "@/components/Kpi";
import { Badge, Card, Chips, EmptyState, SectionTitle, Stat } from "@/components/ui";
import { go } from "@/hooks/useHashRoute";

export function IntelPage({ data, ds, settings }: { data: AppData; ds: Dataset; settings: Settings }) {
  const [period, setPeriod] = usePeriod("semana");
  const [by, setBy] = useState<GroupBy>("region");
  const range = periodRange(period);
  const prevR = previousRange(period);
  const s = useMemo(() => aggregate(ds, range), [ds, range]);
  const groups = useMemo(() => breakdown(ds, data.establishments, range, by, settings.minSample), [ds, data.establishments, range, by, settings.minSample]);
  const regions = useMemo(() => breakdown(ds, data.establishments, range, "region", settings.minSample), [ds, data.establishments, range, settings.minSample]);
  const segments = useMemo(() => breakdown(ds, data.establishments, range, "segment", settings.minSample), [ds, data.establishments, range, settings.minSample]);
  const weekdays = useMemo(() => breakdown(ds, data.establishments, range, "weekday", settings.minSample), [ds, data.establishments, range, settings.minSample]);
  const fun = funnel(ds, range);
  const losses = lossReasons(data.visits, range);
  const follow = pendingFollowUps(data.visits, data.sales, data.establishments);
  const closing = closingStats(data.visits, data.sales, range);
  const budget = transportBudget(settings.uberBudget, data.expenses, data.routes, settings.transportBudgetSince ?? undefined);
  const gp = goalPeriodOf(range.granularity, period);
  const atRisk = INDICATORS.map((d) => ({ d, e: evalFor(d.key, data.goals, d.key === "orcamento_transporte" ? "total" : gp, s, budget.usedPct) }))
    .filter((x) => x.e && (x.e.light === "vermelho" || x.e.light === "amarelo"))
    .map((x) => ({ label: x.d.label, light: x.e!.light, action: `${x.e!.label}: ${x.e!.action} (${x.e!.rule})` }));
  const monthRule = findRule(data.goals, "faturamento", "mes");
  const mtd = aggregate(ds, { start: startOfMonth(new Date()), end: addDays(startOfDay(new Date()), 1) });
  const recs = recommendations({
    regions, segments, weekdays,
    expensesNow: expenseByCategory(data.expenses, range),
    expensesPrev: prevR ? expenseByCategory(data.expenses, prevR) : null,
    minSample: settings.minSample, totalVisits: s.visitsRealized, totalOrders: s.ordersRecognized, atRisk,
    monthGoal: monthRule?.target ? { target: Math.round(monthRule.target * 100), mtd: mtd.net, ticket: mtd.ticket.value ?? (s.ticket.value ?? settings.defaultPrice) } : null,
  });
  const maxFun = Math.max(1, ...fun.map((f) => f.value));
  const toneIcon = { positivo: ThumbsUp, atencao: AlertTriangle, alerta: AlertTriangle, info: Info } as const;

  return (
    <div className="space-y-4">
      <PeriodPicker value={period} onChange={setPeriod} />

      <SectionTitle>Recomendações · {PERIOD_LABELS[period].toLowerCase()}</SectionTitle>
      <div className="grid gap-2 md:grid-cols-2">
        {recs.map((r, i) => {
          const Icon = toneIcon[r.tone];
          return (
            <div key={i} className={cn("card flex gap-3 p-4", r.tone === "alerta" && "border-bad/40", r.tone === "atencao" && "border-warn/40", r.tone === "positivo" && "border-ok/40")}>
              <Icon className={cn("mt-0.5 h-5 w-5 shrink-0", r.tone === "positivo" && "text-ok", r.tone === "atencao" && "text-warn", r.tone === "alerta" && "text-bad", r.tone === "info" && "text-primary")} />
              <div><div className="text-sm font-bold">{r.title}</div><div className="text-xs text-muted">{r.detail}</div></div>
            </div>
          );
        })}
      </div>

      <SectionTitle>Funil de prospecção</SectionTitle>
      <Card>
        {s.visitsRealized === 0 ? <EmptyState icon={Filter} title="Sem visitas no período">Marque o status das paradas na rota. “Falei com o responsável” e “Fiz demonstração” alimentam as taxas de contato e demonstração.</EmptyState> : (
          <div className="space-y-2">
            {fun.map((f, i) => (
              <div key={f.key}>
                <div className="mb-1 flex justify-between text-sm"><span className="font-semibold">{f.label}</span><span className="tabular text-muted">{f.value}{i > 0 && fun[0].value > 0 && ` · ${formatPct((f.value / fun[0].value) * 100)}`}</span></div>
                <div className="h-7 overflow-hidden rounded-lg bg-surface-overlay"><div className="h-full rounded-lg gradient-brand transition-all duration-700" style={{ width: `${(f.value / maxFun) * 100}%`, opacity: 1 - i * 0.15 }} /></div>
              </div>
            ))}
            <div className="grid grid-cols-3 gap-2 pt-2">
              <Stat label="Contato" value={<MetricValue m={s.contactRate} f="pct" size="md" />} sub="com responsável" />
              <Stat label="Demonstração" value={<MetricValue m={s.demoRate} f="pct" size="md" />} sub="das visitas" />
              <Stat label="Conversão" value={<MetricValue m={s.conversion} f="pct" size="md" />} sub="visita → venda" />
            </div>
          </div>
        )}
      </Card>

      <SectionTitle>Produtividade</SectionTitle>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Stat label="Faturamento/visita" value={<MetricValue m={s.revenuePerVisit} f="brl" size="md" />} />
        <Stat label="Contribuição/visita" value={<MetricValue m={s.contributionPerVisit} f="brl" size="md" />} />
        <Stat label="Vendas/visita" value={<MetricValue m={s.salesPerVisit} f="dec" size="md" />} />
        <Stat label="Vendas/hora" value={<MetricValue m={s.salesPerHour} f="dec" size="md" />} sub={s.hours ? `${formatNumber(s.hours, 1)} h registradas` : "registre a jornada"} />
        <Stat label="Contribuição/hora" value={<MetricValue m={s.contributionPerHour} f="brl_h" size="md" />} />
        <Stat label="Transporte/venda" value={<MetricValue m={s.transportPerSale} f="brl" size="md" />} />
        <Stat label="Visita → fechamento" value={closing.avgDays == null ? "—" : `${formatNumber(closing.avgDays, 1)} dia(s)`} sub={`n=${closing.n} vendas · ${closing.sameDayPct == null ? "—" : formatPct(closing.sameDayPct, 0)} no mesmo dia`} />
        <Stat label="Retornos até fechar" value={closing.avgReturns == null ? "—" : formatNumber(closing.avgReturns, 1)} sub={`n=${closing.n}`} />
      </div>
      {s.routesWithoutHours > 0 && <p className="px-1 text-xs text-subtle"><Clock className="mr-1 inline h-3.5 w-3.5" />{s.routesWithoutHours} rota(s) sem jornada registrada no período não entram nas métricas por hora.</p>}

      <SectionTitle>Desempenho por grupo</SectionTitle>
      <Chips size="sm" options={[{ value: "region", label: "Região" }, { value: "segment", label: "Categoria" }, { value: "weekday", label: "Dia da semana" }]} value={by} onChange={setBy} />
      <p className="px-1 text-xs text-subtle">Ranking só para grupos com {settings.minSample}+ visitas (ajuste em Configurações). Grupos com amostra menor aparecem marcados e não são ranqueados.</p>
      {groups.length === 0 ? <Card><EmptyState icon={TrendingUp} title="Sem dados no período" /></Card> : <GroupTable rows={groups} />}

      <div className="grid gap-3 lg:grid-cols-2">
        <Card title="Motivos de perda" subtitle={`n=${losses.reduce((a, l) => a + l.count, 0)} visitas sem interesse`}>
          {losses.length === 0 ? <p className="text-sm text-subtle">Nenhuma perda registrada no período.</p> : losses.map((l) => (
            <div key={l.reason} className="mb-2">
              <div className="flex justify-between text-sm"><span>{l.reason}</span><span className="tabular text-muted">{l.count}</span></div>
              <div className="h-2 overflow-hidden rounded-full bg-surface-overlay"><div className="h-full bg-bad" style={{ width: `${(l.count / losses[0].count) * 100}%` }} /></div>
            </div>
          ))}
        </Card>
        <Card title="Retornos pendentes" subtitle={`${follow.length} estabelecimento(s)`} action={<button className="text-xs font-semibold text-primary" onClick={() => go("rotas")}>Ver</button>}>
          {follow.length === 0 ? <p className="text-sm text-subtle">Nenhum retorno pendente.</p> : follow.slice(0, 6).map((f) => (
            <div key={f.establishmentId} className="flex items-center justify-between border-b border-border py-1.5 text-sm last:border-0">
              <span className="truncate">{f.name}</span>
              <Badge tone={f.overdue ? "bad" : "warn"}><Repeat className="h-3 w-3" />{f.followUpAt ? f.followUpAt.slice(8, 10) + "/" + f.followUpAt.slice(5, 7) : "sem data"}</Badge>
            </div>
          ))}
        </Card>
      </div>
      <p className="px-1 text-center text-xs text-subtle"><Lightbulb className="mr-1 inline h-3.5 w-3.5" />Conclusões só aparecem com amostra suficiente. Com poucos registros, os números servem de acompanhamento, não de regra.</p>
    </div>
  );
}

function GroupTable({ rows }: { rows: GroupStat[] }) {
  const ranked = [...rows].sort((a, b) => Number(b.sufficient) - Number(a.sufficient) || (b.conversion ?? -1) - (a.conversion ?? -1));
  let rank = 0;
  return (
    <div className="card overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b border-border text-left text-[11px] font-bold uppercase tracking-wide text-subtle">
            <th className="px-3 py-2">#</th><th className="px-3 py-2">Grupo</th><th className="px-3 py-2 text-right">Visitas (n)</th><th className="px-3 py-2 text-right">Vendas</th>
            <th className="px-3 py-2 text-right">Conversão</th><th className="px-3 py-2 text-right">Ticket</th><th className="px-3 py-2 text-right">Fat./visita</th><th className="px-3 py-2 text-right">Contrib./visita</th>
          </tr>
        </thead>
        <tbody>
          {ranked.map((g) => (
            <tr key={g.key} className={cn("border-b border-border last:border-0", !g.sufficient && "text-muted")}>
              <td className="px-3 py-2 tabular">{g.sufficient ? ++rank : "—"}</td>
              <td className="px-3 py-2 font-semibold capitalize">{g.label}{!g.sufficient && <Badge tone="neutral" className="ml-2">amostra pequena</Badge>}</td>
              <td className="px-3 py-2 text-right tabular">{g.visits}</td>
              <td className="px-3 py-2 text-right tabular">{g.orders}</td>
              <td className="px-3 py-2 text-right tabular">{g.conversion == null ? "—" : formatPct(g.conversion)}</td>
              <td className="px-3 py-2 text-right tabular">{g.ticket == null ? "—" : formatBRL(Math.round(g.ticket))}</td>
              <td className="px-3 py-2 text-right tabular">{g.revenuePerVisit == null ? "—" : formatBRL(Math.round(g.revenuePerVisit))}</td>
              <td className="px-3 py-2 text-right tabular">{g.costPending ? <span className="text-neutral">pendente</span> : g.contributionPerVisit == null ? "—" : formatBRL(Math.round(g.contributionPerVisit))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
