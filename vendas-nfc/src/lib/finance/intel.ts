/**
 * INTELIGÊNCIA COMERCIAL
 * Rankings só são exibidos para grupos com amostra mínima (configurável, padrão 10 visitas).
 * Sempre informamos o número de observações (n) para não tirar conclusões de amostras pequenas.
 */
import type { Cents } from "@/lib/money";
import { formatBRL, formatPct } from "@/lib/money";
import { inRange, dayKey, diffDays, WEEKDAYS, type Range } from "@/lib/dates";
import type { Establishment, Expense, Sale, Visit, ExpenseCategory } from "@/db/types";
import { EXPENSE_CATEGORIES } from "@/db/types";
import { calcSale, isRealized, linkedTransportBySale, type Dataset } from "./engine";

export type GroupBy = "region" | "segment" | "weekday";

export interface GroupStat {
  key: string;
  label: string;
  visits: number;
  contacts: number;
  demos: number;
  salesFromVisits: number;
  orders: number;
  net: Cents;
  contribution: Cents | null;
  costPending: boolean;
  conversion: number | null;
  revenuePerVisit: Cents | null;
  contributionPerVisit: Cents | null;
  ticket: Cents | null;
  sufficient: boolean;
}

function groupKey(by: GroupBy, est: Establishment | undefined, at: string): { key: string; label: string } {
  if (by === "weekday") {
    const d = new Date(at).getDay();
    return { key: String(d), label: WEEKDAYS[d] };
  }
  if (!est) return { key: "_sem", label: "Sem estabelecimento" };
  const v = by === "region" ? est.region : est.segment;
  return { key: v || "_sem", label: v || "Não informado" };
}

export function breakdown(ds: Dataset, ests: Establishment[], range: Range, by: GroupBy, minSample: number): GroupStat[] {
  const estById = new Map(ests.map((e) => [e.id, e]));
  const map = new Map<string, GroupStat>();
  const get = (k: { key: string; label: string }) => {
    let g = map.get(k.key);
    if (!g) {
      g = { key: k.key, label: k.label, visits: 0, contacts: 0, demos: 0, salesFromVisits: 0, orders: 0, net: 0, contribution: 0, costPending: false, conversion: null, revenuePerVisit: null, contributionPerVisit: null, ticket: null, sufficient: false };
      map.set(k.key, g);
    }
    return g;
  };
  for (const v of ds.visits) {
    if (v.deletedAt || !inRange(v.at, range) || !isRealized(v.outcome)) continue;
    const g = get(groupKey(by, estById.get(v.establishmentId), v.at));
    g.visits++;
    if (v.contact) g.contacts++;
    if (v.demo) g.demos++;
  }
  const linked = linkedTransportBySale(ds.expenses);
  for (const s of ds.sales) {
    if (s.deletedAt || s.status !== "ativa" || !s.delivered || !inRange(s.deliveredAt ?? s.at, range)) continue;
    const g = get(groupKey(by, s.establishmentId ? estById.get(s.establishmentId) : undefined, s.at));
    const c = calcSale(s, [], linked.get(s.id) ?? 0);
    g.orders++;
    if (s.visitId) g.salesFromVisits++;
    g.net += c.net;
    if (c.contribution == null) g.costPending = true;
    else if (g.contribution != null) g.contribution += c.contribution;
  }
  return [...map.values()]
    .map((g) => {
      const contribution = g.costPending ? null : g.contribution;
      return {
        ...g,
        contribution,
        conversion: g.visits ? (g.salesFromVisits / g.visits) * 100 : null,
        revenuePerVisit: g.visits ? g.net / g.visits : null,
        contributionPerVisit: g.visits && contribution != null ? contribution / g.visits : null,
        ticket: g.orders ? g.net / g.orders : null,
        sufficient: g.visits >= minSample,
      };
    })
    .sort((a, b) => b.visits - a.visits || b.net - a.net);
}

export function funnel(ds: Dataset, range: Range) {
  const vs = ds.visits.filter((v) => !v.deletedAt && inRange(v.at, range));
  const realized = vs.filter((v) => isRealized(v.outcome));
  const sales = ds.sales.filter((s) => !s.deletedAt && s.status === "ativa" && s.visitId && inRange(s.at, range));
  return [
    { key: "visitas", label: "Visitas realizadas", value: realized.length },
    { key: "contato", label: "Falou com o responsável", value: realized.filter((v) => v.contact).length },
    { key: "demo", label: "Demonstração feita", value: realized.filter((v) => v.demo).length },
    { key: "venda", label: "Venda fechada", value: sales.length },
  ];
}

export function lossReasons(visits: Visit[], range: Range) {
  const m = new Map<string, number>();
  for (const v of visits) {
    if (v.deletedAt || v.outcome !== "sem_interesse" || !inRange(v.at, range)) continue;
    const k = v.lossReason || "Não informado";
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count);
}

export interface FollowUp {
  establishmentId: string;
  name: string;
  outcome: string;
  followUpAt: string | null;
  lastVisitAt: string;
  overdue: boolean;
  stopId: string | null;
  routeId: string | null;
}

/** Estabelecimentos cuja última visita pede retorno e que ainda não compraram depois dela. */
export function pendingFollowUps(visits: Visit[], sales: Sale[], ests: Establishment[], now = new Date()): FollowUp[] {
  const last = new Map<string, Visit>();
  for (const v of visits) {
    if (v.deletedAt) continue;
    const p = last.get(v.establishmentId);
    if (!p || v.at > p.at) last.set(v.establishmentId, v);
  }
  const today = dayKey(now);
  const out: FollowUp[] = [];
  for (const [eid, v] of last) {
    if (!["retornar", "interessado", "ausente"].includes(v.outcome) && !v.followUpAt) continue;
    if (v.outcome === "venda" || v.outcome === "sem_interesse" || v.outcome === "fechado") continue;
    const boughtAfter = sales.some((s) => !s.deletedAt && s.status === "ativa" && s.establishmentId === eid && s.at >= v.at);
    if (boughtAfter) continue;
    const e = ests.find((x) => x.id === eid);
    out.push({
      establishmentId: eid, name: e?.name ?? "Estabelecimento", outcome: v.outcome, followUpAt: v.followUpAt, lastVisitAt: v.at,
      overdue: !!v.followUpAt && v.followUpAt.slice(0, 10) < today, stopId: v.stopId, routeId: v.routeId,
    });
  }
  return out.sort((a, b) => (a.followUpAt ?? "9999").localeCompare(b.followUpAt ?? "9999"));
}

/** Tempo médio (dias) entre a primeira visita e o fechamento, e retornos necessários. */
export function closingStats(visits: Visit[], sales: Sale[], range: Range) {
  const days: number[] = [];
  const returns: number[] = [];
  for (const s of sales) {
    if (s.deletedAt || s.status !== "ativa" || !s.establishmentId || !inRange(s.at, range)) continue;
    const vs = visits.filter((v) => !v.deletedAt && v.establishmentId === s.establishmentId && v.at <= s.at && isRealized(v.outcome)).sort((a, b) => a.at.localeCompare(b.at));
    if (!vs.length) continue;
    days.push(diffDays(vs[0].at, s.at));
    returns.push(vs.length - 1);
  }
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  return { n: days.length, avgDays: avg(days), avgReturns: avg(returns), sameDayPct: days.length ? (days.filter((d) => d === 0).length / days.length) * 100 : null };
}

export function expenseByCategory(expenses: Expense[], range: Range) {
  const m = new Map<ExpenseCategory, Cents>();
  for (const e of expenses) {
    if (e.deletedAt || e.status !== "pago" || !inRange(e.at, range)) continue;
    m.set(e.category, (m.get(e.category) ?? 0) + e.amount);
  }
  return m;
}

export interface Recommendation {
  tone: "positivo" | "atencao" | "alerta" | "info";
  title: string;
  detail: string;
}

export function recommendations(args: {
  regions: GroupStat[];
  segments: GroupStat[];
  weekdays: GroupStat[];
  expensesNow: Map<ExpenseCategory, Cents>;
  expensesPrev: Map<ExpenseCategory, Cents> | null;
  minSample: number;
  totalVisits: number;
  totalOrders: number;
  atRisk: { label: string; light: string; action: string }[];
  monthGoal: { target: Cents; mtd: Cents; ticket: Cents | null } | null;
}): Recommendation[] {
  const out: Recommendation[] = [];
  const { minSample } = args;

  const regionOk = args.regions.filter((g) => g.sufficient && g.key !== "_sem");
  if (regionOk.length >= 2) {
    const best = [...regionOk].sort((a, b) => (b.conversion ?? 0) - (a.conversion ?? 0))[0];
    out.push({ tone: "positivo", title: `Melhor conversão observada: ${best.label}`, detail: `${formatPct(best.conversion)} em ${best.visits} visitas (n=${best.visits}). Compare com as demais regiões antes de redistribuir as rotas.` });
  } else {
    out.push({ tone: "info", title: "Regiões: amostra insuficiente", detail: `Rankings por região aparecem quando pelo menos 2 regiões tiverem ${minSample}+ visitas. Hoje: ${regionOk.length} região(ões) com amostra suficiente.` });
  }

  const segOk = args.segments.filter((g) => g.sufficient && g.key !== "_sem");
  if (segOk.length >= 2) {
    const withContrib = segOk.filter((g) => g.contributionPerVisit != null);
    if (withContrib.length >= 2) {
      const best = [...withContrib].sort((a, b) => (b.contributionPerVisit ?? 0) - (a.contributionPerVisit ?? 0))[0];
      out.push({ tone: "positivo", title: `Maior contribuição por visita: ${best.label}`, detail: `${formatBRL(Math.round(best.contributionPerVisit ?? 0))} por visita (n=${best.visits} visitas).` });
    } else {
      const best = [...segOk].sort((a, b) => (b.revenuePerVisit ?? 0) - (a.revenuePerVisit ?? 0))[0];
      out.push({ tone: "info", title: `Maior faturamento por visita: ${best.label}`, detail: `${formatBRL(Math.round(best.revenuePerVisit ?? 0))} por visita (n=${best.visits}). Contribuição indisponível enquanto o custo unitário estiver pendente.` });
    }
  } else {
    out.push({ tone: "info", title: "Segmentos: amostra insuficiente", detail: `Precisa de 2+ segmentos com ${minSample}+ visitas para comparar.` });
  }

  if (args.totalOrders >= 5) {
    const best = [...args.weekdays].sort((a, b) => b.orders - a.orders)[0];
    if (best && best.orders > 0) out.push({ tone: "info", title: `Dia com mais vendas: ${best.label}`, detail: `${best.orders} de ${args.totalOrders} pedidos no período. Ainda é amostra pequena; confirme com mais semanas.` });
  } else {
    out.push({ tone: "info", title: "Dia da semana: dados insuficientes", detail: `São necessárias pelo menos 5 vendas no período para comparar dias (hoje: ${args.totalOrders}).` });
  }

  if (args.expensesPrev) {
    for (const [cat, now] of args.expensesNow) {
      const prev = args.expensesPrev.get(cat) ?? 0;
      if (now - prev > 1000 && (prev === 0 || now / prev > 1.2)) {
        out.push({ tone: "atencao", title: `Despesa em alta: ${EXPENSE_CATEGORIES[cat]}`, detail: `${formatBRL(now)} no período contra ${formatBRL(prev)} no período anterior equivalente.` });
      }
    }
  }

  for (const r of args.atRisk.slice(0, 3)) {
    out.push({ tone: r.light === "vermelho" ? "alerta" : "atencao", title: `Meta em risco: ${r.label}`, detail: r.action });
  }

  if (args.monthGoal) {
    const missing = args.monthGoal.target - args.monthGoal.mtd;
    if (missing <= 0) out.push({ tone: "positivo", title: "Meta mensal de faturamento atingida", detail: `${formatBRL(args.monthGoal.mtd)} de ${formatBRL(args.monthGoal.target)}.` });
    else if (args.monthGoal.ticket && args.monthGoal.ticket > 0) {
      const n = Math.ceil(missing / args.monthGoal.ticket);
      out.push({ tone: "info", title: `Faltam ${n} ${n === 1 ? "venda" : "vendas"} para a meta do mês`, detail: `Faltam ${formatBRL(missing)} considerando o ticket médio de ${formatBRL(Math.round(args.monthGoal.ticket))}.` });
    }
  }
  if (args.totalVisits === 0) out.push({ tone: "info", title: "Comece registrando visitas", detail: "Toque no status de cada parada da rota. Cada toque vira uma visita e alimenta todos os indicadores." });
  return out;
}


