/**
 * SIMULADOR DE PREÇO E RENTABILIDADE (funções puras).
 * contribuição por unidade = preço líquido − custo unitário − taxa variável (% sobre o preço líquido + fixa por pedido rateada)
 * unidades para a meta = ⌈(meta de resultado + custos fixos + transporte) ÷ contribuição por unidade⌉
 */
import type { Cents } from "@/lib/money";

export interface SimInput {
  price: Cents; // preço por placa
  unitCost: Cents | null; // null = custo pendente
  feePct: number; // taxas variáveis em % sobre a receita
  feeFixedPerOrder: Cents;
  discountPct: number; // desconto em % sobre o preço
  qty: number; // placas no pedido / período simulado
  transport: Cents; // despesas de transporte do período
  fixedCosts: Cents; // custos fixos do período
  profitTarget: Cents; // meta de resultado do período
  minContributionPct: number; // alerta se abaixo
}

export interface SimResult {
  incomplete: boolean;
  netPrice: Cents;
  revenue: Cents;
  variablePerUnit: Cents;
  contributionPerUnit: Cents;
  contributionPct: number | null;
  orderContribution: Cents;
  periodResult: Cents;
  unitsForTarget: number | null;
  unitsForBreakEven: number | null;
  alerts: string[];
}

export function simulate(i: SimInput): SimResult {
  const qty = Math.max(1, Math.floor(i.qty || 1));
  const netPrice = Math.round(i.price * (1 - (i.discountPct || 0) / 100));
  const revenue = netPrice * qty;
  const feePerUnit = Math.round((netPrice * (i.feePct || 0)) / 100) + Math.round((i.feeFixedPerOrder || 0) / qty);
  const cost = i.unitCost ?? 0;
  const variablePerUnit = cost + feePerUnit;
  const contributionPerUnit = netPrice - variablePerUnit;
  const contributionPct = netPrice > 0 ? (contributionPerUnit / netPrice) * 100 : null;
  const orderContribution = contributionPerUnit * qty;
  const periodResult = orderContribution - (i.transport || 0) - (i.fixedCosts || 0);
  const need = (i.profitTarget || 0) + (i.fixedCosts || 0) + (i.transport || 0);
  const unitsForTarget = contributionPerUnit > 0 ? Math.ceil(need / contributionPerUnit) : null;
  const unitsForBreakEven = contributionPerUnit > 0 ? Math.ceil(((i.fixedCosts || 0) + (i.transport || 0)) / contributionPerUnit) : null;
  const alerts: string[] = [];
  const incomplete = i.unitCost == null;
  if (incomplete) alerts.push("Custo unitário da placa não informado: resultados calculados sem esse custo (estimativa incompleta).");
  if (contributionPerUnit <= 0) alerts.push("Contribuição por placa zero ou negativa: cada venda não cobre os custos variáveis.");
  else if (contributionPct != null && contributionPct < i.minContributionPct)
    alerts.push(`Margem de contribuição (${contributionPct.toFixed(1).replace(".", ",")}%) abaixo do limite definido (${i.minContributionPct}%).`);
  if (unitsForTarget == null) alerts.push("Meta inalcançável com estes preços e custos.");
  return { incomplete, netPrice, revenue, variablePerUnit, contributionPerUnit, contributionPct, orderContribution, periodResult, unitsForTarget, unitsForBreakEven, alerts };
}

/** Efeito de descontos sobre a margem (tabela). */
export function discountTable(base: SimInput, discounts = [0, 5, 10, 15, 20, 30]) {
  return discounts.map((d) => {
    const r = simulate({ ...base, discountPct: d });
    return { discountPct: d, netPrice: r.netPrice, contributionPerUnit: r.contributionPerUnit, contributionPct: r.contributionPct, unitsForTarget: r.unitsForTarget };
  });
}
