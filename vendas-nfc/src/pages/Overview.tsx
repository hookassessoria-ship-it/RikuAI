import { useMemo } from "react";
import { BarChart3, Footprints, AlertCircle, FileUp, Wallet, ChevronRight, Sparkles } from "lucide-react";
import type { AppData } from "@/hooks/useData";
import type { Dataset } from "@/lib/finance/engine";
import { aggregate, projectMonth } from "@/lib/finance/engine";
import { transportBudget } from "@/lib/finance/transport";
import { breakdown } from "@/lib/finance/intel";
import { useMetrics, goalPeriodOf, evalFor } from "@/hooks/useMetrics";
import { usePeriod } from "@/hooks/usePeriod";
import { periodRange, PERIOD_LABELS, fmtLong, type PeriodKey } from "@/lib/dates";
import { formatBRL, formatPct } from "@/lib/money";
import type { Settings } from "@/db/types";
import { Kpi } from "@/components/Kpi";
import { Badge, Button, Card, Chips, EmptyState, LightBadge, Progress, SectionTitle, Stat } from "@/components/ui";
import { RevenueChart, ContributionChart, OrdersUnitsChart, ConversionChart, RevenueVsCostsChart, GoalChart, HBarChart } from "@/components/charts/Charts";
import { go } from "@/hooks/useHashRoute";
import { useUI } from "@/components/UIProvider";
import { findRule } from "@/lib/finance/goals";
import { cn } from "@/lib/utils";

export const PERIOD_OPTIONS: { value: PeriodKey; label: string }[] = (["hoje", "ontem", "semana", "7d", "mes", "mes_passado", "30d", "tudo"] as PeriodKey[]).map((k) => ({ value: k, label: PERIOD_LABELS[k] }));

export function PeriodPicker({ value, onChange }: { value: PeriodKey; onChange: (p: PeriodKey) => void }) {
  return (
    <div className="no-scrollbar -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <Chips size="sm" className="flex-nowrap" options={PERIOD_OPTIONS} value={value} onChange={onChange} />
    </div>
  );
}

export function Overview({ data, ds, settings }: { data: AppData; ds: Dataset; settings: Settings }) {
  const [period, setPeriod] = usePeriod("semana");
  const m = useMetrics(ds, period);
  const ui = useUI();
  const today = useMemo(() => aggregate(ds, periodRange("hoje")), [ds]);
  const total = useMemo(() => aggregate(ds, periodRange("tudo")), [ds]);
  const proj = useMemo(() => projectMonth(ds, new Date(), settings.workWeekdays), [ds, settings.workWeekdays]);
  const budget = useMemo(() => transportBudget(settings.uberBudget, data.expenses, data.routes, settings.transportBudgetSince ?? undefined), [settings.uberBudget, data.expenses, data.routes]);
  const regions = useMemo(() => (m ? breakdown(ds, data.establishments, m.range, "region", settings.minSample) : []), [ds, data.establishments, m, settings.minSample]);
  const segments = useMemo(() => (m ? breakdown(ds, data.establishments, m.range, "segment", settings.minSample) : []), [ds, data.establishments, m, settings.minSample]);
  if (!m) return null;
  const s = m.summary;
  const p = m.prev;
  const gp = goalPeriodOf(m.granularity, period);
  const ev = (k: string) => evalFor(k, data.goals, gp, s, budget.usedPct);
  const visitsToday = evalFor("visitas", data.goals, "dia", today);
  const revenueToday = evalFor("faturamento", data.goals, "dia", today);
  const hasSales = data.sales.some((x) => x.status === "ativa");
  const hasVisits = data.visits.length > 0;
  const pending = pendingItems(data, settings);
  const periodLabel = m.label.toLowerCase();
  const visitRule = findRule(data.goals, "visitas", "dia");
  const convRule = gp ? findRule(data.goals, "conversao", gp) : undefined;

  return (
    <div className="space-y-4">
      {/* Hoje */}
      <section className="card gradient-hero overflow-hidden p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs font-bold uppercase tracking-wider text-muted">Hoje · {fmtLong(new Date())}</div>
            <div className="mt-1 text-[34px] font-black leading-10 tracking-tight tabular">{formatBRL(today.net)}</div>
            <div className="text-sm text-muted">faturamento de hoje · {formatBRL(today.received)} recebido</div>
          </div>
          {revenueToday && <LightBadge light={revenueToday.light} label={revenueToday.light === "sem_meta" ? "Sem meta diária" : revenueToday.label} />}
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2">
          <Stat label="Placas" value={today.unitsSold} sub={`${today.ordersRecognized} pedido(s)`} />
          <Stat label="Visitas" value={today.visitsRealized} sub={visitRule?.target ? `meta ${visitRule.target}` : "sem meta"} />
          <Stat label="Despesas" value={formatBRL(today.opExpenses + today.transportLinked)} sub="pagas hoje" />
        </div>
        {visitsToday && visitRule?.target != null && (
          <div className="mt-3">
            <div className="mb-1 flex justify-between text-xs text-muted"><span>Meta diária de visitas</span><span className="tabular">{today.visitsRealized}/{visitRule.target}</span></div>
            <Progress value={today.visitsRealized / visitRule.target} light={today.visitsRealized === 0 ? "sem_dados" : visitsToday.light} label="Meta diária de visitas" />
          </div>
        )}
        <div className="mt-4 grid grid-cols-2 gap-2 sm:flex">
          <Button variant="primary" onClick={() => ui.openSale()}>Registrar venda</Button>
          <Button onClick={() => (ui.nextStop ? go(`rotas/${ui.nextStop.routeId}/${ui.nextStop.stop.id}`) : go("rotas"))}><Footprints className="h-4 w-4" />{ui.nextStop ? "Próxima parada" : "Ver rotas"}</Button>
        </div>
      </section>

      {pending.length > 0 && (
        <Card title="Dados pendentes" subtitle="Sem eles, os resultados aparecem como estimativa incompleta.">
          <ul className="space-y-2">
            {pending.map((x) => (
              <li key={x.text}>
                <button type="button" onClick={() => go(x.to)} className="press flex w-full items-center gap-3 rounded-xl bg-surface-raised px-3 py-2.5 text-left text-sm">
                  <AlertCircle className={cn("h-4 w-4 shrink-0", x.tone === "bad" ? "text-bad" : "text-warn")} />
                  <span className="flex-1">{x.text}</span>
                  <ChevronRight className="h-4 w-4 text-subtle" />
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <PeriodPicker value={period} onChange={setPeriod} />

      <SectionTitle>Vendas · {periodLabel}</SectionTitle>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Kpi label="Faturamento" f="brl" metric={{ value: s.net, state: s.ordersRecognized || s.refunds ? "ok" : "sem_dados", reason: "Nenhuma venda entregue no período" }} prev={p && { value: p.net, state: "ok" }} period={m.label} evaluation={ev("faturamento")}
          definition="Receita líquida reconhecida: placas entregues × preço − descontos − estornos. Não é lucro." />
        <Kpi label="Dinheiro recebido" f="brl" metric={{ value: s.received, state: "ok" }} prev={p && { value: p.received, state: "ok" }} period={m.label}
          definition={`Pagamentos efetivamente recebidos no período (devoluções descontadas). Vendas pendentes não entram. A receber (todas as vendas): ${formatBRL(s.receivables)}.`} />
        <Kpi label="Placas vendidas" f="int" metric={{ value: s.unitsSold, state: "ok" }} prev={p && { value: p.unitsSold, state: "ok" }} period={m.label} evaluation={ev("placas")}
          definition="Unidades entregues, descontadas as devoluções." />
        <Kpi label="Pedidos" f="int" metric={{ value: s.ordersRecognized, state: "ok" }} prev={p && { value: p.ordersRecognized, state: "ok" }} period={m.label}
          definition={`Pedidos válidos entregues (não confunda com placas). Contratados no período: ${s.contractedOrders} (${formatBRL(s.contractedValue)}).`} />
        <Kpi label="Ticket médio" f="brl" metric={s.ticket} prev={p?.ticket ?? null} period={m.label} evaluation={ev("ticket_medio")}
          definition="Receita líquida ÷ número de pedidos." />
        <Kpi label="Receita por placa" f="brl" metric={s.revenuePerUnit} prev={p?.revenuePerUnit ?? null} period={m.label}
          definition="Receita líquida ÷ placas vendidas." />
      </div>

      <SectionTitle>Rentabilidade · {periodLabel}</SectionTitle>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Kpi label="Custo das placas (CPV)" f="brl" metric={s.cogs} pendingLabel={`${s.costPendingSales} venda(s) sem custo; custo conhecido`} prev={p?.cogs ?? null} higherIsBetter={false} period={m.label}
          definition="Custo unitário aplicado em cada venda × placas que saíram do estoque. Compras de estoque não entram aqui de novo (já viram CPV quando vendidas)." />
        <Kpi label="Margem de contribuição" f="brl" metric={s.contribution} prev={p?.contribution ?? null} period={m.label}
          definition="Receita líquida − CPV − taxas, comissões, tributos variáveis, outros custos do pedido e transporte vinculado às vendas. Não desconta despesas fixas.">
          <div className="mt-1 text-xs text-muted">{s.contributionPct.state === "sem_dados" ? "—" : s.contributionPct.state === "pendente" ? "% indisponível até informar o custo" : `${formatPct(s.contributionPct.value)} da receita`}</div>
          {ev("margem_contribuicao_pct") && <div className="mt-1"><LightBadge light={ev("margem_contribuicao_pct")!.light} label={`Margem: ${ev("margem_contribuicao_pct")!.label}`} /></div>}
        </Kpi>
        <Kpi label="Despesas operacionais" f="brl" metric={{ value: s.opExpenses, state: "ok" }} prev={p && { value: p.opExpenses, state: "ok" }} higherIsBetter={false} period={m.label}
          definition={`Despesas pagas não vinculadas a vendas (Uber, alimentação, materiais…). Previstas (estimativas) não entram: ${formatBRL(s.plannedExpenses)}.`} />
        <Kpi label="Resultado operacional" f="brl" metric={s.opResult} pendingLabel="sem custo das placas" prev={p?.opResult ?? null} period={m.label} evaluation={ev("resultado_operacional")}
          definition="Margem de contribuição − despesas operacionais do período. Estimativa gerencial: não é lucro líquido contábil nem após impostos." />
        <Kpi label="Resultado acumulado" f="brl" metric={total.opResult} period="Todo o histórico"
          definition="Resultado operacional estimado desde o primeiro registro." />
        <Kpi label="Despesas de hoje" f="brl" metric={{ value: today.opExpenses + today.transportLinked, state: "ok" }} higherIsBetter={false} period="Hoje"
          definition="Despesas pagas hoje, incluindo transporte vinculado a vendas." />
      </div>

      <SectionTitle>Comercial · {periodLabel}</SectionTitle>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Kpi label="Visitas realizadas" f="int" metric={{ value: s.visitsRealized, state: "ok" }} prev={p && { value: p.visitsRealized, state: "ok" }} period={m.label} evaluation={ev("visitas")}
          definition={`Paradas com desfecho (visitado, ausente, conversa, interessado, retornar, venda, sem interesse). Pendentes e "a caminho" não contam. Estabelecimento fechado: ${s.visitsClosedPlace} (fora do cálculo).`} />
        <Kpi label="Vendas fechadas" f="int" metric={{ value: s.salesFromVisits, state: "ok" }} prev={p && { value: p.salesFromVisits, state: "ok" }} period={m.label}
          definition="Pedidos válidos vinculados a uma visita registrada." />
        <Kpi label="Conversão" f="pct" metric={s.conversion} prev={p?.conversion ?? null} period={m.label} evaluation={ev("conversao")} className="col-span-2 lg:col-span-1"
          definition="Vendas fechadas em visitas ÷ visitas realizadas × 100." />
      </div>

      <SectionTitle>Projeção do mês</SectionTitle>
      <Card>
        {proj.projectedNet == null ? (
          <p className="text-sm text-muted">{proj.note}</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="Realizado no mês" value={formatBRL(proj.mtdNet)} sub="faturamento" />
              <Stat label="Projeção faturamento" value={formatBRL(proj.projectedNet)} sub="fim do mês" />
              <Stat label="Projeção contribuição" value={proj.projectedContribution == null ? "Pendente" : formatBRL(proj.projectedContribution)} sub={proj.projectedContribution == null ? "falta custo unitário" : "fim do mês"} />
              <Stat label="Projeção resultado" value={proj.projectedResult == null ? "Pendente" : formatBRL(proj.projectedResult)} tone={proj.projectedResult != null && proj.projectedResult < 0 ? "bad" : undefined} sub="operacional estimado" />
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted">
              <Badge tone={proj.confidence === "moderada" ? "primary" : "warn"}>Confiança {proj.confidence}</Badge>
              <span>{proj.note}</span>
            </div>
          </>
        )}
      </Card>

      <SectionTitle>Gráficos · {periodLabel}</SectionTitle>
      {!hasSales && !hasVisits ? (
        <Card>
          <EmptyState icon={BarChart3} title="Ainda não há resultados para mostrar"
            action={<div className="flex flex-wrap justify-center gap-2"><Button variant="primary" onClick={() => go("importar")}><FileUp className="h-4 w-4" />Importar roteiros</Button><Button onClick={() => go("rotas")}>Abrir rotas</Button></div>}>
            Os gráficos aparecem quando houver registros reais: <strong>marque o status das paradas</strong> (cada toque vira uma visita) e <strong>registre vendas</strong>. Para visualizar o painel completo antes disso, ative os dados de demonstração em Configurações.
          </EmptyState>
        </Card>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          <ChartCard title="Faturamento diário" empty={!hasSales} emptyText="Registre vendas para ver o faturamento por dia."><RevenueChart data={m.series} /></ChartCard>
          <ChartCard title="Contribuição diária" subtitle="Cinza = custo das placas pendente" empty={!hasSales} emptyText="Registre vendas para ver a contribuição."><ContributionChart data={m.series} /></ChartCard>
          <ChartCard title="Pedidos e placas por dia" empty={!hasSales} emptyText="Registre vendas para comparar pedidos e placas."><OrdersUnitsChart data={m.series} /></ChartCard>
          <ChartCard title="Conversão de visitas em vendas" empty={!hasVisits} emptyText="Marque o status das paradas para medir a conversão."><ConversionChart data={m.series} target={convRule?.green ?? convRule?.target ?? null} /></ChartCard>
          <ChartCard title="Faturamento × custos" empty={!hasSales} emptyText="Registre vendas e despesas para comparar."><RevenueVsCostsChart data={m.series} /></ChartCard>
          <ChartCard title="Evolução da meta de visitas" subtitle={visitRule?.target ? `Meta diária: ${visitRule.target}` : "Sem meta diária definida"} empty={!hasVisits} emptyText="Sem visitas registradas.">
            <GoalChart data={m.series.map((d) => ({ day: d.day, value: d.visits }))} target={visitRule?.target ?? null} label="Visitas" />
          </ChartCard>
          <ChartCard title="Faturamento por região" subtitle="n = visitas realizadas" empty={!regions.some((r) => r.net > 0)} emptyText="Sem vendas no período.">
            <HBarChart rows={regions.filter((r) => r.net > 0 || r.visits > 0).slice(0, 8).map((r) => ({ label: r.label, value: r.net, n: r.visits, dim: !r.sufficient }))} valueLabel="Faturamento" f={(v) => formatBRL(v)} />
          </ChartCard>
          <ChartCard title="Faturamento por categoria" subtitle={`Barras cinza: amostra < ${settings.minSample} visitas`} empty={!segments.some((r) => r.net > 0)} emptyText="Sem vendas no período.">
            <HBarChart rows={segments.filter((r) => r.net > 0 || r.visits > 0).slice(0, 9).map((r) => ({ label: r.label, value: r.net, n: r.visits, dim: !r.sufficient }))} valueLabel="Faturamento" f={(v) => formatBRL(v)} />
          </ChartCard>
        </div>
      )}

      <Card className="flex items-center gap-3">
        <Wallet className="h-5 w-5 text-primary" />
        <div className="min-w-0 flex-1 text-sm">
          <div className="font-semibold">Orçamento de transporte</div>
          <div className="text-xs text-muted">{formatBRL(budget.paid)} pago + {formatBRL(budget.planned)} previsto de {formatBRL(budget.budget)} · saldo {formatBRL(budget.balance)}</div>
          <Progress className="mt-2" value={budget.usedPct == null ? null : budget.usedPct / 100} light={evalFor("orcamento_transporte", data.goals, "total", s, budget.usedPct)?.light ?? "sem_meta"} label="Uso do orçamento de transporte" />
        </div>
        <Button size="sm" onClick={() => go("financas/transporte")}>Ver</Button>
      </Card>
      <p className="px-1 text-center text-xs text-subtle"><Sparkles className="mr-1 inline h-3.5 w-3.5" />Toque no ⓘ de qualquer card para ver a fórmula, o período e a regra do semáforo.</p>
    </div>
  );
}

function ChartCard({ title, subtitle, empty, emptyText, children }: { title: string; subtitle?: string; empty: boolean; emptyText: string; children: React.ReactNode }) {
  return (
    <Card title={title} subtitle={subtitle}>
      {empty ? <div className="grid h-[180px] place-items-center rounded-xl border border-dashed border-border px-6 text-center text-sm text-subtle">{emptyText}</div> : children}
    </Card>
  );
}

export function pendingItems(data: AppData, settings: Settings) {
  const out: { text: string; to: string; tone: "warn" | "bad" }[] = [];
  const profile = [...data.costProfiles].sort((a, b) => b.validFrom.localeCompare(a.validFrom))[0];
  const placa = profile?.components.find((c) => c.key === "placa")?.amount ?? null;
  const lotWithCost = data.stockLots.some((l) => l.totalPaid != null);
  if (placa == null && !lotWithCost) out.push({ text: "Custo unitário da placa não informado (margens e lucro ficam pendentes)", to: "financas/custos", tone: "bad" });
  const costPending = data.sales.filter((s) => s.status === "ativa" && s.items.some((i) => i.unitCost == null)).length;
  if (costPending) out.push({ text: `${costPending} venda(s) com custo pendente: aplicar custo informado`, to: "financas/custos", tone: "warn" });
  const feeUnknown = settings.paymentMethods.filter((m) => m.active && m.feePct == null).map((m) => m.label);
  if (feeUnknown.length) out.push({ text: `Taxas não informadas: ${feeUnknown.join(", ")}`, to: "configuracoes", tone: "warn" });
  if (!data.stockLots.length) out.push({ text: "Estoque não cadastrado (quantidade inicial e lotes)", to: "financas/estoque", tone: "warn" });
  if (!data.establishments.length) out.push({ text: "Nenhum estabelecimento: importe os 88 do roteiro", to: "importar", tone: "warn" });
  return out;
}
