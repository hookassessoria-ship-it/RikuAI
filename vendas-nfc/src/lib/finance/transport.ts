/**
 * ORÇAMENTO DE TRANSPORTE
 * Considera despesas das categorias de transporte (Uber e transporte público).
 * - Pago: valor efetivamente pago (status "pago").
 * - Previsto: estimativas ainda não pagas (status "previsto"). Não é cotação.
 * - Saldo = orçamento − pago − previsto.
 */
import type { Cents } from "@/lib/money";
import type { Expense, Route } from "@/db/types";
import { TRANSPORT_CATEGORIES } from "@/db/types";

export interface TransportBudget {
  budget: Cents;
  paid: Cents;
  planned: Cents;
  committed: Cents;
  balance: Cents;
  usedPct: number | null;
  byRoute: { routeId: string | null; name: string; date: string | null; paid: Cents; planned: Cents }[];
  estimateDiff: Cents; // pago − estimado (despesas que tinham estimativa)
}

export function transportBudget(budget: Cents, expenses: Expense[], routes: Route[], since?: string): TransportBudget {
  const xs = expenses.filter((e) => !e.deletedAt && TRANSPORT_CATEGORIES.includes(e.category) && (!since || e.at >= since));
  const paid = xs.filter((e) => e.status === "pago").reduce((a, e) => a + e.amount, 0);
  const planned = xs.filter((e) => e.status === "previsto").reduce((a, e) => a + e.amount, 0);
  const committed = paid + planned;
  const map = new Map<string, { paid: number; planned: number }>();
  for (const e of xs) {
    const k = e.routeId ?? "";
    const cur = map.get(k) ?? { paid: 0, planned: 0 };
    if (e.status === "pago") cur.paid += e.amount;
    else cur.planned += e.amount;
    map.set(k, cur);
  }
  const byRoute = [...map.entries()].map(([k, v]) => {
    const r = routes.find((x) => x.id === k);
    return { routeId: k || null, name: r ? r.name : "Sem rota vinculada", date: r?.date ?? null, ...v };
  }).sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
  const estimateDiff = xs.filter((e) => e.status === "pago" && e.estimate != null).reduce((a, e) => a + e.amount - (e.estimate as number), 0);
  return { budget, paid, planned, committed, balance: budget - committed, usedPct: budget > 0 ? (committed / budget) * 100 : null, byRoute, estimateDiff };
}
