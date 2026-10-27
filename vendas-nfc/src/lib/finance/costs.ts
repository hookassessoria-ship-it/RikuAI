/**
 * CUSTOS UNITÁRIOS E ESTOQUE
 * - Custo sugerido da placa = média ponderada dos lotes com custo conhecido até a data
 *   ((valor pago + frete) ÷ quantidade), quando o perfil de custo usa a média dos lotes;
 *   senão, o valor manual do perfil vigente. Demais componentes (embalagem, personalização,
 *   outros por unidade) vêm do perfil vigente; não informados contam R$ 0.
 * - Estoque: saldo = entradas − vendidas (líquidas de devoluções reintegradas) − perdas ± ajustes.
 *   Compras de estoque são saída de caixa; o custo só vira CPV quando a placa é vendida.
 */
import type { Cents } from "@/lib/money";
import type { CostProfile, StockLot, StockMove, Sale } from "@/db/types";

export function profileAt(profiles: CostProfile[], date: string): CostProfile | undefined {
  const d = date.slice(0, 10);
  return profiles
    .filter((p) => !p.deletedAt && p.validFrom <= d)
    .sort((a, b) => (a.validFrom === b.validFrom ? b.createdAt.localeCompare(a.createdAt) : b.validFrom.localeCompare(a.validFrom)))[0];
}

export function lotUnitCost(l: StockLot): Cents | null {
  if (l.totalPaid == null || l.qty <= 0) return null;
  return Math.round((l.totalPaid + (l.freight || 0)) / l.qty);
}

/** Média ponderada dos lotes com custo conhecido até a data (inclusive). */
export function lotAverageCost(lots: StockLot[], date?: string): { avg: Cents | null; lotsWithCost: number; lotsWithoutCost: number } {
  const ls = lots.filter((l) => !l.deletedAt && (!date || l.at <= date.slice(0, 10)));
  const known = ls.filter((l) => l.totalPaid != null && l.qty > 0);
  const qty = known.reduce((a, l) => a + l.qty, 0);
  const total = known.reduce((a, l) => a + (l.totalPaid as number) + (l.freight || 0), 0);
  return { avg: qty > 0 ? Math.round(total / qty) : null, lotsWithCost: known.length, lotsWithoutCost: ls.length - known.length };
}

export interface CostSuggestion {
  unitCost: Cents | null;
  placa: Cents | null;
  placaSource: "lotes" | "manual" | "pendente";
  extras: Cents;
  missingOptional: string[];
  explanation: string;
}

export function suggestUnitCost(profiles: CostProfile[], lots: StockLot[], date: string): CostSuggestion {
  const p = profileAt(profiles, date);
  const comps = p?.components ?? [];
  const manualPlaca = comps.find((c) => c.key === "placa")?.amount ?? null;
  const lotAvg = lotAverageCost(lots, date).avg;
  let placa: Cents | null = null;
  let placaSource: CostSuggestion["placaSource"] = "pendente";
  if ((p?.useLotAverage ?? true) && lotAvg != null) { placa = lotAvg; placaSource = "lotes"; }
  else if (manualPlaca != null) { placa = manualPlaca; placaSource = "manual"; }
  const optional = comps.filter((c) => c.key !== "placa");
  const extras = optional.reduce((a, c) => a + (c.amount ?? 0), 0);
  const missingOptional = optional.filter((c) => c.amount == null).map((c) => c.label);
  const unitCost = placa == null ? null : placa + extras;
  const explanation =
    placa == null
      ? "Custo da placa não informado: cadastre um lote com valor pago ou informe o custo em Finanças › Custos."
      : `${placaSource === "lotes" ? "Placa (média dos lotes)" : "Placa (valor manual)"} + demais componentes${missingOptional.length ? ` (não informados: ${missingOptional.join(", ")} = R$ 0)` : ""}`;
  return { unitCost, placa, placaSource, extras, missingOptional, explanation };
}

export interface StockSummary {
  initial: number;
  entries: number;
  sold: number;
  returnedToStock: number;
  losses: number;
  adjustments: number;
  reserved: number;
  balance: number;
  available: number;
  avgCost: Cents | null;
  stockValue: Cents | null;
  cashSpent: Cents;
  lotsWithoutCost: number;
}

export function stockSummary(lots: StockLot[], moves: StockMove[], sales: Sale[]): StockSummary {
  const ls = lots.filter((l) => !l.deletedAt);
  const initial = ls.filter((l) => l.isInitial).reduce((a, l) => a + l.qty, 0);
  const entries = ls.filter((l) => !l.isInitial).reduce((a, l) => a + l.qty, 0);
  let sold = 0, returnedToStock = 0;
  for (const s of sales) {
    if (s.deletedAt || s.status !== "ativa") continue;
    sold += s.items.reduce((a, i) => a + i.qty, 0);
    if (s.refund?.returnedToStock) returnedToStock += s.refund.unitsReturned;
  }
  const mv = moves.filter((m) => !m.deletedAt);
  const losses = mv.filter((m) => m.type === "perda").reduce((a, m) => a + m.qty, 0);
  const adjustments = mv.filter((m) => m.type === "ajuste").reduce((a, m) => a + m.qty, 0);
  const reserved = Math.max(0, mv.filter((m) => m.type === "reserva").reduce((a, m) => a + m.qty, 0) - mv.filter((m) => m.type === "liberacao").reduce((a, m) => a + m.qty, 0));
  const balance = initial + entries - sold + returnedToStock - losses + adjustments;
  const { avg, lotsWithoutCost } = lotAverageCost(ls);
  const cashSpent = ls.filter((l) => !l.isInitial).reduce((a, l) => a + (l.totalPaid ?? 0) + (l.freight || 0), 0);
  return {
    initial, entries, sold, returnedToStock, losses, adjustments, reserved, balance,
    available: balance - reserved, avgCost: avg, stockValue: avg == null ? null : Math.max(balance, 0) * avg, cashSpent, lotsWithoutCost,
  };
}
