/**
 * MOTOR FINANCEIRO E COMERCIAL
 * ============================================================================
 * Todas as fórmulas do aplicativo ficam aqui (funções puras e testadas).
 * Componentes visuais NUNCA calculam indicadores por conta própria.
 * Valores monetários em centavos (inteiros).
 *
 * DEFINIÇÕES ADOTADAS
 * - Pedido válido: venda com status "ativa". Vendas canceladas são registros anulados
 *   (erro de lançamento/desistência antes da entrega) e não entram em nenhum cálculo.
 * - Venda contratada: pedido válido, pela data da venda (entregue ou não).
 * - Receita reconhecida: pedido válido ENTREGUE, na data de entrega (deliveredAt).
 * - Recebimento: dinheiro efetivamente recebido (pagamentos), pela data do pagamento.
 *   Devoluções de dinheiro em estornos entram como pagamentos negativos.
 * - Estorno: devolução total ou parcial de uma venda reconhecida. Reduz a receita na data do estorno.
 *
 * FÓRMULAS
 * - Receita bruta = Σ quantidade × preço unitário (pedidos reconhecidos no período).
 * - Receita líquida = receita bruta − descontos − estornos do período.
 * - CPV (custo dos produtos vendidos) = Σ custo unitário aplicado × unidades que saíram do estoque.
 *   Unidades devolvidas e reintegradas ao estoque têm o custo revertido na data do estorno.
 *   Se alguma venda do período não tiver custo unitário → CPV "pendente".
 * - Margem bruta = receita líquida − CPV; % = margem bruta ÷ receita líquida × 100.
 * - Custos variáveis do pedido = taxa do meio de pagamento + comissão + tributos variáveis
 *   + outros custos por pedido + transporte vinculado à venda.
 *   Premissa: a taxa do meio de pagamento não é devolvida em estornos.
 * - Margem de contribuição = receita líquida − CPV − custos variáveis; % = MC ÷ receita líquida × 100.
 * - Resultado operacional estimado = MC − despesas operacionais pagas do período
 *   (despesas não vinculadas a vendas). NÃO é lucro líquido contábil nem após impostos.
 * - Compras de estoque são saída de caixa, não despesa: viram custo apenas quando a placa é vendida (CPV).
 * - Ticket médio = receita líquida ÷ pedidos. Receita média por placa = receita líquida ÷ placas vendidas.
 * - Conversão = pedidos válidos vinculados a uma visita ÷ visitas realizadas × 100.
 * - CAC simplificado = despesas comerciais pagas (Uber, transporte público, alimentação em campo,
 *   materiais de demonstração e marketing) ÷ novos clientes do período.
 * - Ponto de equilíbrio (receita) = despesas operacionais do período ÷ MC%.
 *   Premissa: todas as despesas operacionais do período são tratadas como fixas do período.
 *   Em unidades = despesas ÷ contribuição média por placa. Só existe se MC > 0 e o custo estiver completo.
 */
import type { Cents } from "@/lib/money";
import { inRange, dayKey, daysOf, type Range, type DayKey } from "@/lib/dates";
import type { Sale, Payment, Expense, Visit, Route, StockLot, PaymentStatus, VisitOutcome } from "@/db/types";
import { REALIZED_OUTCOMES, TRANSPORT_CATEGORIES, COMMERCIAL_CATEGORIES } from "@/db/types";

// ---------------------------------------------------------------------------
// Métrica com estado de completude
// ---------------------------------------------------------------------------
export type MetricState = "ok" | "parcial" | "pendente" | "sem_dados";
export interface Metric {
  value: number | null;
  state: MetricState;
  reason?: string;
}
const ok = (value: number): Metric => ({ value, state: "ok" });
const noData = (reason: string): Metric => ({ value: null, state: "sem_dados", reason });

function withCompleteness(value: number | null, costPending: boolean, feePending: boolean): Metric {
  if (value == null) return noData("Sem dados no período");
  if (costPending) return { value, state: "pendente", reason: "Custo unitário das placas pendente: valor calculado sem esse custo" };
  if (feePending) return { value, state: "parcial", reason: "Taxa do meio de pagamento não informada em alguma venda (considerada R$ 0)" };
  return ok(value);
}

// ---------------------------------------------------------------------------
// Venda individual
// ---------------------------------------------------------------------------
export interface SaleCalc {
  valid: boolean;
  gross: Cents;
  discount: Cents;
  netBeforeRefund: Cents;
  refund: Cents;
  net: Cents;
  units: number;
  unitsReturned: number;
  unitsSold: number;
  cogsUnits: number;
  avgUnitCost: Cents | null;
  cogs: Cents | null;
  fee: Cents | null;
  commission: Cents;
  tax: Cents;
  other: Cents;
  transport: Cents;
  variableExCogs: Cents; // taxa pendente tratada como 0
  contribution: Cents | null; // null quando custo pendente
  contributionKnown: Cents; // tratando custo pendente como 0
  costPending: boolean;
  feePending: boolean;
  paid: Cents;
  due: Cents;
  paymentStatus: PaymentStatus;
}

export function saleUnits(s: Pick<Sale, "items">): number {
  return s.items.reduce((a, i) => a + i.qty, 0);
}

export function saleGross(s: Pick<Sale, "items">): Cents {
  return s.items.reduce((a, i) => a + Math.round(i.qty * i.unitPrice), 0);
}

/** Custo médio unitário do pedido (null se algum item não tiver custo). */
export function saleAvgUnitCost(s: Pick<Sale, "items">): Cents | null {
  const units = saleUnits(s);
  if (units === 0) return 0;
  if (s.items.some((i) => i.unitCost == null)) return null;
  return s.items.reduce((a, i) => a + (i.unitCost as number) * i.qty, 0) / units;
}

export function calcSale(sale: Sale, payments: Payment[] = [], linkedTransport: Cents = 0): SaleCalc {
  const valid = sale.status === "ativa" && !sale.deletedAt;
  const gross = saleGross(sale);
  const discount = Math.min(Math.max(sale.discount || 0, 0), gross);
  const netBeforeRefund = gross - discount;
  const refund = sale.refund ? Math.min(Math.max(sale.refund.amount, 0), netBeforeRefund) : 0;
  const net = netBeforeRefund - refund;
  const units = saleUnits(sale);
  const unitsReturned = sale.refund ? Math.min(sale.refund.unitsReturned || 0, units) : 0;
  const unitsSold = units - unitsReturned;
  const cogsUnits = units - (sale.refund?.returnedToStock ? unitsReturned : 0);
  const avgUnitCost = saleAvgUnitCost(sale);
  const costPending = avgUnitCost == null;
  const cogs = costPending ? null : Math.round((avgUnitCost as number) * cogsUnits);
  const feePending = sale.feePct == null;
  const fee = feePending ? null : Math.round((netBeforeRefund * (sale.feePct as number)) / 100) + (sale.feeFixed || 0);
  const commission = Math.round((net * (sale.commissionPct || 0)) / 100);
  const tax = Math.round((net * (sale.taxPct || 0)) / 100);
  const other = sale.otherVariable || 0;
  const variableExCogs = (fee ?? 0) + commission + tax + other + linkedTransport;
  const contributionKnown = net - (cogs ?? 0) - variableExCogs;
  const contribution = costPending ? null : contributionKnown;
  const paid = payments.filter((p) => !p.deletedAt).reduce((a, p) => a + p.amount, 0);
  const due = net;
  let paymentStatus: PaymentStatus;
  if (sale.refund && netBeforeRefund > 0 && refund >= netBeforeRefund) paymentStatus = "estornado";
  else if (due <= 0) paymentStatus = "pago";
  else if (paid <= 0) paymentStatus = "pendente";
  else if (paid < due) paymentStatus = "parcial";
  else paymentStatus = "pago";
  return {
    valid, gross, discount, netBeforeRefund, refund, net, units, unitsReturned, unitsSold, cogsUnits,
    avgUnitCost, cogs, fee, commission, tax, other, transport: linkedTransport, variableExCogs,
    contribution, contributionKnown, costPending, feePending, paid, due, paymentStatus,
  };
}

// ---------------------------------------------------------------------------
// Agregação por período
// ---------------------------------------------------------------------------
export interface Dataset {
  sales: Sale[];
  payments: Payment[];
  expenses: Expense[];
  visits: Visit[];
  routes: Route[];
  stockLots: StockLot[];
}

export interface Summary {
  range: Range;
  // vendas
  ordersRecognized: number;
  unitsSold: number;
  gross: Cents;
  discounts: Cents;
  refunds: Cents;
  net: Cents;
  contractedOrders: number;
  contractedValue: Cents;
  undeliveredValue: Cents;
  received: Cents;
  receivables: Cents; // a receber (todos os pedidos válidos, saldo atual)
  // custos
  cogs: Metric;
  fees: Cents;
  commission: Cents;
  tax: Cents;
  otherVariable: Cents;
  transportLinked: Cents;
  variableCosts: Cents;
  grossMargin: Metric;
  grossMarginPct: Metric;
  contribution: Metric;
  contributionPct: Metric;
  opExpenses: Cents;
  plannedExpenses: Cents;
  opResult: Metric;
  costPendingSales: number;
  feePendingSales: number;
  // médias
  ticket: Metric;
  revenuePerUnit: Metric;
  contributionPerUnit: Metric;
  // comercial
  visitsRealized: number;
  visitsClosedPlace: number;
  contacts: number;
  demos: number;
  salesFromVisits: number;
  conversion: Metric;
  contactRate: Metric;
  demoRate: Metric;
  // produtividade
  hours: number;
  routesWithoutHours: number;
  salesPerHour: Metric;
  contributionPerHour: Metric;
  revenuePerVisit: Metric;
  contributionPerVisit: Metric;
  salesPerVisit: Metric;
  // transporte / aquisição
  transportPaid: Cents;
  transportPerVisit: Metric;
  transportPerSale: Metric;
  commercialExpenses: Cents;
  newCustomers: number;
  cac: Metric;
  breakEvenRevenue: Metric;
  breakEvenUnits: Metric;
  // caixa
  stockPurchases: Cents;
  expensesPaid: Cents;
  cashResult: Cents;
}

/** Transporte (despesas pagas) vinculado a cada venda. */
export function linkedTransportBySale(expenses: Expense[]): Map<string, Cents> {
  const m = new Map<string, Cents>();
  for (const e of expenses) {
    if (e.deletedAt || e.status !== "pago" || !e.saleId) continue;
    m.set(e.saleId, (m.get(e.saleId) ?? 0) + e.amount);
  }
  return m;
}

export function routeHours(r: Route): number | null {
  if (r.manualHours != null) return r.manualHours;
  if (r.workStart && r.workEnd) {
    const h = (new Date(r.workEnd).getTime() - new Date(r.workStart).getTime()) / 3600000;
    return h > 0 ? h : null;
  }
  return null;
}

export const isRealized = (o: VisitOutcome) => REALIZED_OUTCOMES.includes(o);

export function aggregate(ds: Dataset, range: Range): Summary {
  const sales = ds.sales.filter((s) => !s.deletedAt);
  const validSales = sales.filter((s) => s.status === "ativa");
  const validIds = new Set(validSales.map((s) => s.id));
  const paymentsBySale = new Map<string, Payment[]>();
  for (const p of ds.payments) {
    if (p.deletedAt) continue;
    const a = paymentsBySale.get(p.saleId);
    if (a) a.push(p);
    else paymentsBySale.set(p.saleId, [p]);
  }

  let ordersRecognized = 0, unitsSold = 0, gross = 0, discounts = 0, refunds = 0;
  let cogs = 0, fees = 0, commission = 0, tax = 0, otherVariable = 0;
  let costPendingSales = 0, feePendingSales = 0;
  let contractedOrders = 0, contractedValue = 0, undeliveredValue = 0, receivables = 0;

  for (const s of validSales) {
    const c = calcSale(s, paymentsBySale.get(s.id) ?? [], 0);
    if (inRange(s.at, range)) {
      contractedOrders++;
      contractedValue += c.netBeforeRefund;
      if (!s.delivered) undeliveredValue += c.netBeforeRefund;
    }
    if (c.paymentStatus !== "estornado") receivables += Math.max(c.due - c.paid, 0);
    // Evento de reconhecimento (entrega)
    if (s.delivered && inRange(s.deliveredAt ?? s.at, range)) {
      ordersRecognized++;
      unitsSold += c.units;
      gross += c.gross;
      discounts += c.discount;
      if (c.costPending) costPendingSales++;
      else cogs += Math.round((c.avgUnitCost as number) * c.units);
      if (c.feePending) feePendingSales++;
      else fees += c.fee as number;
      commission += Math.round((c.netBeforeRefund * (s.commissionPct || 0)) / 100);
      tax += Math.round((c.netBeforeRefund * (s.taxPct || 0)) / 100);
      otherVariable += c.other;
    }
    // Evento de estorno
    if (s.refund && s.delivered && inRange(s.refund.at, range)) {
      refunds += c.refund;
      unitsSold -= c.unitsReturned;
      if (s.refund.returnedToStock && c.avgUnitCost != null) cogs -= Math.round(c.avgUnitCost * c.unitsReturned);
      commission -= Math.round((c.refund * (s.commissionPct || 0)) / 100);
      tax -= Math.round((c.refund * (s.taxPct || 0)) / 100);
    }
  }

  const net = gross - discounts - refunds;
  const received = ds.payments
    .filter((p) => !p.deletedAt && inRange(p.at, range))
    .reduce((a, p) => a + p.amount, 0);

  // Despesas
  let transportLinked = 0, opExpenses = 0, plannedExpenses = 0, transportPaid = 0, commercialExpenses = 0, expensesPaid = 0;
  for (const e of ds.expenses) {
    if (e.deletedAt || !inRange(e.at, range)) continue;
    if (e.status === "previsto") { plannedExpenses += e.amount; continue; }
    expensesPaid += e.amount;
    const isLinked = !!e.saleId && validIds.has(e.saleId);
    if (isLinked) transportLinked += e.amount;
    else opExpenses += e.amount;
    if (TRANSPORT_CATEGORIES.includes(e.category)) transportPaid += e.amount;
    if (COMMERCIAL_CATEGORIES.includes(e.category)) commercialExpenses += e.amount;
  }

  const variableCosts = fees + commission + tax + otherVariable + transportLinked;
  const costPending = costPendingSales > 0;
  const feePending = feePendingSales > 0;
  const hasRevenue = ordersRecognized > 0 || refunds > 0;

  const grossMarginVal = hasRevenue ? net - cogs : null;
  const contributionVal = hasRevenue ? net - cogs - variableCosts : null;
  const grossMargin = withCompleteness(grossMarginVal, costPending, false);
  const contribution = withCompleteness(contributionVal, costPending, feePending);
  const pctOf = (v: number | null): number | null => (v == null || net <= 0 ? null : (v / net) * 100);
  const grossMarginPct = net <= 0 ? noData("Receita líquida zero: percentual indefinido") : withCompleteness(pctOf(grossMarginVal), costPending, false);
  const contributionPct = net <= 0 ? noData("Receita líquida zero: percentual indefinido") : withCompleteness(pctOf(contributionVal), costPending, feePending);
  const opResultVal = hasRevenue || opExpenses > 0 ? (contributionVal ?? 0) - opExpenses : null;
  const opResult = withCompleteness(opResultVal, costPending && hasRevenue, feePending);

  // Visitas
  const visits = ds.visits.filter((v) => !v.deletedAt && inRange(v.at, range));
  const realized = visits.filter((v) => isRealized(v.outcome));
  const visitsRealized = realized.length;
  const visitsClosedPlace = visits.filter((v) => v.outcome === "fechado").length;
  const contacts = realized.filter((v) => v.contact).length;
  const demos = realized.filter((v) => v.demo).length;
  const salesFromVisits = validSales.filter((s) => s.visitId && inRange(s.at, range)).length;
  const rate = (n: number, d: number, what: string): Metric => (d === 0 ? noData(`Nenhuma ${what} no período`) : ok((n / d) * 100));

  // Horas
  let hours = 0, routesWithoutHours = 0;
  for (const r of ds.routes) {
    if (r.deletedAt || !inRange(r.date, range)) continue;
    const h = routeHours(r);
    if (h == null) routesWithoutHours++;
    else hours += h;
  }
  const perHour = (v: number | null, base: Metric | null = null): Metric => {
    if (hours <= 0) return noData("Registre o início e o fim da jornada (ou as horas) nas rotas");
    if (v == null) return noData("Sem dados no período");
    if (base && base.state !== "ok") return { value: v / hours, state: base.state, reason: base.reason };
    return ok(v / hours);
  };
  const perVisit = (v: number | null, base: Metric | null = null): Metric => {
    if (visitsRealized === 0) return noData("Nenhuma visita realizada no período");
    if (v == null) return ok(0);
    if (base && base.state !== "ok") return { value: v / visitsRealized, state: base.state, reason: base.reason };
    return ok(v / visitsRealized);
  };

  // Clientes novos (primeira venda válida dentro do período)
  const firstSale = new Map<string, string>();
  for (const s of validSales) {
    const key = s.establishmentId ?? `nome:${s.customerName.trim().toLowerCase()}`;
    const prev = firstSale.get(key);
    if (!prev || s.at < prev) firstSale.set(key, s.at);
  }
  const newCustomers = [...firstSale.values()].filter((at) => inRange(at, range)).length;

  // Ponto de equilíbrio
  let breakEvenRevenue: Metric, breakEvenUnits: Metric;
  if (costPending && hasRevenue) {
    breakEvenRevenue = breakEvenUnits = noData("Custo unitário pendente: não é possível calcular sem distorcer o resultado");
  } else if (!hasRevenue || contributionPct.value == null) {
    breakEvenRevenue = breakEvenUnits = noData("Sem vendas no período para estimar a margem de contribuição");
  } else if ((contributionVal ?? 0) <= 0) {
    breakEvenRevenue = breakEvenUnits = noData("Margem de contribuição zero ou negativa: não existe ponto de equilíbrio com estes preços e custos");
  } else {
    const r = breakEven(opExpenses, contributionPct.value, unitsSold > 0 ? (contributionVal as number) / unitsSold : null);
    breakEvenRevenue = { value: r.revenue, state: feePending ? "parcial" : "ok", reason: feePending ? contribution.reason : undefined };
    breakEvenUnits = { value: r.units, state: feePending ? "parcial" : "ok", reason: feePending ? contribution.reason : undefined };
  }

  const stockPurchases = ds.stockLots
    .filter((l) => !l.deletedAt && !l.isInitial && inRange(l.at, range))
    .reduce((a, l) => a + (l.totalPaid ?? 0) + (l.freight ?? 0), 0);

  return {
    range,
    ordersRecognized, unitsSold, gross, discounts, refunds, net,
    contractedOrders, contractedValue, undeliveredValue, received, receivables,
    cogs: hasRevenue ? withCompleteness(cogs, costPending, false) : noData("Sem vendas no período"),
    fees, commission, tax, otherVariable, transportLinked, variableCosts,
    grossMargin, grossMarginPct, contribution, contributionPct,
    opExpenses, plannedExpenses, opResult, costPendingSales, feePendingSales,
    ticket: ordersRecognized === 0 ? noData("Nenhum pedido no período") : ok(net / ordersRecognized),
    revenuePerUnit: unitsSold <= 0 ? noData("Nenhuma placa vendida no período") : ok(net / unitsSold),
    contributionPerUnit: unitsSold <= 0 ? noData("Nenhuma placa vendida no período") : withCompleteness((contributionVal ?? 0) / unitsSold, costPending, feePending),
    visitsRealized, visitsClosedPlace, contacts, demos, salesFromVisits,
    conversion: rate(salesFromVisits, visitsRealized, "visita realizada"),
    contactRate: rate(contacts, visitsRealized, "visita realizada"),
    demoRate: rate(demos, visitsRealized, "visita realizada"),
    hours, routesWithoutHours,
    salesPerHour: perHour(ordersRecognized),
    contributionPerHour: perHour(contributionVal, contribution),
    revenuePerVisit: perVisit(net),
    contributionPerVisit: perVisit(contributionVal, contribution),
    salesPerVisit: perVisit(ordersRecognized),
    transportPaid,
    transportPerVisit: visitsRealized === 0 ? noData("Nenhuma visita realizada no período") : ok(transportPaid / visitsRealized),
    transportPerSale: ordersRecognized === 0 ? noData("Nenhuma venda no período") : ok(transportPaid / ordersRecognized),
    commercialExpenses, newCustomers,
    cac: newCustomers === 0 ? noData("Dados insuficientes: nenhum cliente novo no período") : ok(commercialExpenses / newCustomers),
    breakEvenRevenue, breakEvenUnits,
    stockPurchases, expensesPaid,
    cashResult: received - stockPurchases - expensesPaid,
  };
}

/** Ponto de equilíbrio. Retorna null quando a margem não permite (≤ 0). */
export function breakEven(fixedCosts: Cents, contributionPct: number, contributionPerUnit: Cents | null) {
  if (!(contributionPct > 0)) return { revenue: null, units: null };
  const revenue = Math.round(fixedCosts / (contributionPct / 100));
  const units = contributionPerUnit && contributionPerUnit > 0 ? Math.ceil(fixedCosts / contributionPerUnit) : null;
  return { revenue, units };
}

// ---------------------------------------------------------------------------
// Séries diárias
// ---------------------------------------------------------------------------
export interface DayPoint {
  day: DayKey;
  net: number;
  contribution: number | null;
  contributionKnown: number;
  orders: number;
  units: number;
  visits: number;
  salesFromVisits: number;
  conversion: number | null;
  cogs: number;
  variable: number;
  opExpenses: number;
  received: number;
  costPending: boolean;
}

export function dailySeries(ds: Dataset, range: Range): DayPoint[] {
  return daysOf(range).map((day) => {
    const [y, m, d] = day.split("-").map(Number);
    const r = { start: new Date(y, m - 1, d), end: new Date(y, m - 1, d + 1) };
    const s = aggregate(ds, r);
    const contributionKnown = s.contribution.value ?? 0;
    return {
      day,
      net: s.net,
      contribution: s.contribution.state === "pendente" ? null : s.contribution.value,
      contributionKnown,
      orders: s.ordersRecognized,
      units: s.unitsSold,
      visits: s.visitsRealized,
      salesFromVisits: s.salesFromVisits,
      conversion: s.conversion.value,
      cogs: s.cogs.value ?? 0,
      variable: s.variableCosts,
      opExpenses: s.opExpenses,
      received: s.received,
      costPending: s.costPendingSales > 0,
    };
  });
}

/** Dias com atividade comercial (visita ou venda). */
export function activeDays(ds: Dataset, range: Range): DayKey[] {
  const set = new Set<string>();
  for (const v of ds.visits) if (!v.deletedAt && inRange(v.at, range)) set.add(dayKey(v.at));
  for (const s of ds.sales) if (!s.deletedAt && s.status === "ativa" && inRange(s.at, range)) set.add(dayKey(s.at));
  return [...set].sort();
}

// ---------------------------------------------------------------------------
// Projeção simples do mês
// ---------------------------------------------------------------------------
export interface Projection {
  activeDays: number;
  remainingWorkDays: number;
  mtdNet: Cents;
  mtdContribution: Cents | null;
  projectedNet: Cents | null;
  projectedContribution: Cents | null;
  projectedResult: Cents | null;
  confidence: "insuficiente" | "baixa" | "moderada";
  note: string;
}

export function projectMonth(ds: Dataset, now: Date, workWeekdays: number[]): Projection {
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const mtd = aggregate(ds, { start, end: tomorrow });
  const act = activeDays(ds, { start, end: tomorrow }).length;
  let remaining = 0;
  for (let d = tomorrow; d < end; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
    if (workWeekdays.includes(d.getDay())) remaining++;
  }
  const confidence: Projection["confidence"] = act < 3 ? "insuficiente" : act < 10 ? "baixa" : "moderada";
  if (act === 0) {
    return {
      activeDays: 0, remainingWorkDays: remaining, mtdNet: mtd.net, mtdContribution: mtd.contribution.value,
      projectedNet: null, projectedContribution: null, projectedResult: null, confidence,
      note: "Sem dias com atividade no mês: não há ritmo para projetar.",
    };
  }
  const perDay = mtd.net / act;
  const contribPending = mtd.contribution.state === "pendente";
  const projectedNet = Math.round(mtd.net + perDay * remaining);
  const projectedContribution = contribPending || mtd.contribution.value == null
    ? null
    : Math.round(mtd.contribution.value + (mtd.contribution.value / act) * remaining);
  const projectedResult = projectedContribution == null ? null : projectedContribution - mtd.opExpenses - Math.round((mtd.opExpenses / act) * remaining);
  return {
    activeDays: act, remainingWorkDays: remaining, mtdNet: mtd.net, mtdContribution: mtd.contribution.value,
    projectedNet, projectedContribution, projectedResult, confidence,
    note: `Média de ${act} ${act === 1 ? "dia" : "dias"} com atividade × ${remaining} ${remaining === 1 ? "dia útil restante" : "dias úteis restantes"} (conforme dias de trabalho configurados). Projeção, não é resultado realizado.`,
  };
}
