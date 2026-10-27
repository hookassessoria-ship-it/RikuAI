import { describe, it, expect } from "vitest";
import { aggregate, calcSale, breakEven, projectMonth, type Dataset } from "./engine";
import { simulate, discountTable } from "./simulator";
import { suggestUnitCost, stockSummary, lotAverageCost } from "./costs";
import { transportBudget } from "./transport";
import type { Sale, Payment, Expense, Visit, Route, StockLot, CostProfile } from "@/db/types";

const T = "2026-10-27T13:00:00.000Z"; // 10h em Goiânia
const DAY = { start: new Date(2026, 9, 27), end: new Date(2026, 9, 28) };
const base = (id: string) => ({ id, createdAt: T, updatedAt: T, deletedAt: null, isDemo: false });

function sale(p: Partial<Sale> & { qty?: number; price?: number; cost?: number | null } = {}): Sale {
  const { qty = 1, price = 6990, cost = 2000, ...rest } = p;
  return {
    ...base(rest.id ?? "s1"), establishmentId: "e1", customerName: "Barbearia X", at: T, delivered: true, deliveredAt: T,
    items: [{ productId: "p", qty, unitPrice: price, unitCost: cost }], discount: 0, paymentMethod: "pix",
    feePct: 0, feeFixed: 0, commissionPct: 0, taxPct: 0, otherVariable: 0, status: "ativa", cancelReason: "", cancelledAt: null,
    refund: null, routeId: null, stopId: null, visitId: null, origin: "", notes: "", clientRequestId: rest.id ?? "s1", ...rest,
  };
}
const pay = (saleId: string, amount: number, id = `p-${saleId}-${amount}`, at = T): Payment => ({ ...base(id), saleId, at, amount, method: "pix", note: "" });
const exp = (p: Partial<Expense>): Expense => ({ ...base(p.id ?? "x1"), at: "2026-10-27", category: "uber", amount: 2000, description: "", routeId: null, saleId: null, status: "pago", estimate: null, ...p });
const visit = (id: string, outcome: Visit["outcome"], extra: Partial<Visit> = {}): Visit => ({ ...base(id), establishmentId: "e" + id, routeId: "r1", stopId: null, at: T, outcome, contact: ["conversa", "interessado", "venda", "sem_interesse"].includes(outcome), demo: outcome === "venda", lossReason: "", followUpAt: null, notes: "", ...extra });
const ds = (p: Partial<Dataset>): Dataset => ({ sales: [], payments: [], expenses: [], visits: [], routes: [], stockLots: [], ...p });

describe("1. venda de uma placa por R$ 69,90", () => {
  it("receita, CPV, margens e ticket", () => {
    const s = sale({ cost: 2000 });
    const r = aggregate(ds({ sales: [s], payments: [pay("s1", 6990)] }), DAY);
    expect(r.gross).toBe(6990);
    expect(r.net).toBe(6990);
    expect(r.unitsSold).toBe(1);
    expect(r.ordersRecognized).toBe(1);
    expect(r.cogs).toEqual({ value: 2000, state: "ok" });
    expect(r.grossMargin.value).toBe(4990);
    expect(r.contribution.value).toBe(4990);
    expect(r.contributionPct.value).toBeCloseTo(71.388, 2);
    expect(r.ticket.value).toBe(6990);
    expect(r.revenuePerUnit.value).toBe(6990);
    expect(r.received).toBe(6990);
    expect(calcSale(s, [pay("s1", 6990)]).paymentStatus).toBe("pago");
  });
});

describe("2. várias placas no mesmo pedido", () => {
  it("ticket por pedido ≠ receita por placa", () => {
    const r = aggregate(ds({ sales: [sale({ qty: 3 })] }), DAY);
    expect(r.gross).toBe(20970);
    expect(r.unitsSold).toBe(3);
    expect(r.ordersRecognized).toBe(1);
    expect(r.ticket.value).toBe(20970);
    expect(r.revenuePerUnit.value).toBe(6990);
    expect(r.cogs.value).toBe(6000);
  });
});

describe("3. desconto", () => {
  it("reduz receita líquida, não a bruta", () => {
    const r = aggregate(ds({ sales: [sale({ qty: 2, discount: 990 })] }), DAY);
    expect(r.gross).toBe(13980);
    expect(r.discounts).toBe(990);
    expect(r.net).toBe(12990);
    expect(r.contribution.value).toBe(12990 - 4000);
  });
  it("desconto maior que o pedido é limitado ao valor bruto", () => {
    expect(calcSale(sale({ discount: 999999 })).net).toBe(0);
  });
});

describe("4. taxa de pagamento", () => {
  it("entra como custo variável e reduz a contribuição", () => {
    const r = aggregate(ds({ sales: [sale({ feePct: 4.99, feeFixed: 50, paymentMethod: "credito" })] }), DAY);
    const fee = Math.round(6990 * 0.0499) + 50; // 349 + 50
    expect(r.fees).toBe(fee);
    expect(r.grossMargin.value).toBe(4990); // margem bruta não inclui taxa
    expect(r.contribution.value).toBe(4990 - fee);
  });
  it("taxa não informada → contribuição 'parcial'", () => {
    const r = aggregate(ds({ sales: [sale({ feePct: null })] }), DAY);
    expect(r.contribution.state).toBe("parcial");
    expect(r.feePendingSales).toBe(1);
  });
});

describe("5. custo unitário pendente", () => {
  it("CPV, margens e resultado ficam 'pendente' e o ponto de equilíbrio não é calculado", () => {
    const r = aggregate(ds({ sales: [sale({ cost: null })], expenses: [exp({ amount: 1000, category: "alimentacao" })] }), DAY);
    expect(r.costPendingSales).toBe(1);
    expect(r.cogs.state).toBe("pendente");
    expect(r.contribution.state).toBe("pendente");
    expect(r.contributionPct.state).toBe("pendente");
    expect(r.opResult.state).toBe("pendente");
    expect(r.breakEvenRevenue.state).toBe("sem_dados");
    expect(r.net).toBe(6990); // receita continua correta
  });
});

describe("6. venda não paga", () => {
  it("é receita reconhecida, mas não é dinheiro recebido", () => {
    const s = sale({});
    const r = aggregate(ds({ sales: [s] }), DAY);
    expect(r.net).toBe(6990);
    expect(r.received).toBe(0);
    expect(r.receivables).toBe(6990);
    expect(calcSale(s, []).paymentStatus).toBe("pendente");
  });
  it("venda não entregue é contratada, mas não reconhecida", () => {
    const r = aggregate(ds({ sales: [sale({ delivered: false, deliveredAt: null })] }), DAY);
    expect(r.contractedOrders).toBe(1);
    expect(r.contractedValue).toBe(6990);
    expect(r.ordersRecognized).toBe(0);
    expect(r.net).toBe(0);
  });
});

describe("7. pagamento parcial", () => {
  it("status parcial e saldo a receber", () => {
    const s = sale({});
    const c = calcSale(s, [pay("s1", 3000)]);
    expect(c.paymentStatus).toBe("parcial");
    const r = aggregate(ds({ sales: [s], payments: [pay("s1", 3000)] }), DAY);
    expect(r.received).toBe(3000);
    expect(r.receivables).toBe(3990);
  });
});

describe("8. estorno e cancelamento", () => {
  it("cancelada não entra em nada", () => {
    const r = aggregate(ds({ sales: [sale({ status: "cancelada" })] }), DAY);
    expect(r.ordersRecognized).toBe(0);
    expect(r.net).toBe(0);
    expect(r.contribution.state).toBe("sem_dados");
  });
  it("estorno total devolve receita e custo (placa reintegrada) e devolve dinheiro", () => {
    const s = sale({ refund: { at: T, amount: 6990, unitsReturned: 1, returnedToStock: true, reason: "defeito" } });
    const pays = [pay("s1", 6990), pay("s1", -6990, "dev")];
    expect(calcSale(s, pays).paymentStatus).toBe("estornado");
    const r = aggregate(ds({ sales: [s], payments: pays }), DAY);
    expect(r.gross).toBe(6990);
    expect(r.refunds).toBe(6990);
    expect(r.net).toBe(0);
    expect(r.unitsSold).toBe(0);
    expect(r.cogs.value).toBe(0);
    expect(r.received).toBe(0);
  });
  it("estorno sem reintegração mantém o custo (perda)", () => {
    const s = sale({ refund: { at: T, amount: 6990, unitsReturned: 1, returnedToStock: false, reason: "quebrou" } });
    const r = aggregate(ds({ sales: [s] }), DAY);
    expect(r.cogs.value).toBe(2000);
    expect(r.contribution.value).toBe(-2000);
  });
  it("estorno em outro período reduz a receita na data do estorno", () => {
    const s = sale({ refund: { at: "2026-10-29T13:00:00.000Z", amount: 2000, unitsReturned: 0, returnedToStock: false, reason: "abatimento" } });
    expect(aggregate(ds({ sales: [s] }), DAY).net).toBe(6990);
    const later = aggregate(ds({ sales: [s] }), { start: new Date(2026, 9, 29), end: new Date(2026, 9, 30) });
    expect(later.net).toBe(-2000);
    expect(later.refunds).toBe(2000);
  });
});

describe("9. despesa de Uber", () => {
  it("despesa operacional reduz o resultado e alimenta transporte por venda/visita", () => {
    const r = aggregate(ds({ sales: [sale({})], expenses: [exp({ amount: 2500 })], visits: [visit("1", "venda"), visit("2", "ausente")] }), DAY);
    expect(r.opExpenses).toBe(2500);
    expect(r.opResult.value).toBe(4990 - 2500);
    expect(r.transportPaid).toBe(2500);
    expect(r.transportPerSale.value).toBe(2500);
    expect(r.transportPerVisit.value).toBe(1250);
  });
  it("Uber vinculado à venda vira custo variável (não conta duas vezes)", () => {
    const r = aggregate(ds({ sales: [sale({})], expenses: [exp({ amount: 2500, saleId: "s1" })] }), DAY);
    expect(r.transportLinked).toBe(2500);
    expect(r.opExpenses).toBe(0);
    expect(r.contribution.value).toBe(4990 - 2500);
    expect(r.opResult.value).toBe(4990 - 2500);
  });
  it("Uber previsto não entra no resultado", () => {
    const r = aggregate(ds({ expenses: [exp({ status: "previsto" })] }), DAY);
    expect(r.opExpenses).toBe(0);
    expect(r.plannedExpenses).toBe(2000);
  });
  it("orçamento de transporte: pago + previsto vs R$ 80", () => {
    const b = transportBudget(8000, [exp({ id: "a", amount: 2300 }), exp({ id: "b", amount: 2500, status: "previsto" }), exp({ id: "c", category: "alimentacao", amount: 3000 })], []);
    expect(b.paid).toBe(2300);
    expect(b.planned).toBe(2500);
    expect(b.balance).toBe(8000 - 4800);
    expect(b.usedPct).toBeCloseTo(60);
  });
});

describe("10. margem negativa", () => {
  it("custo maior que o preço → contribuição negativa e sem ponto de equilíbrio", () => {
    const r = aggregate(ds({ sales: [sale({ price: 3000, cost: 4000 })], expenses: [exp({ amount: 1000, category: "marketing" })] }), DAY);
    expect(r.contribution.value).toBe(-1000);
    expect(r.contributionPct.value).toBeCloseTo(-33.33, 1);
    expect(r.breakEvenRevenue.value).toBeNull();
    expect(r.breakEvenRevenue.reason).toMatch(/zero ou negativa/);
  });
});

describe("11. receita zero", () => {
  it("percentuais e médias mostram 'sem dados' em vez de dividir por zero", () => {
    const r = aggregate(ds({ expenses: [exp({})] }), DAY);
    expect(r.net).toBe(0);
    expect(r.contributionPct.value).toBeNull();
    expect(r.contributionPct.state).toBe("sem_dados");
    expect(r.ticket.state).toBe("sem_dados");
    expect(r.conversion.state).toBe("sem_dados");
    expect(r.opResult.value).toBe(-2000);
    expect(r.cac.state).toBe("sem_dados");
  });
  it("venda 100% descontada não gera percentual", () => {
    const r = aggregate(ds({ sales: [sale({ discount: 6990 })] }), DAY);
    expect(r.net).toBe(0);
    expect(r.contributionPct.state).toBe("sem_dados");
  });
});

describe("12. ponto de equilíbrio", () => {
  it("margem positiva", () => {
    const r = breakEven(10000, 50, 3000);
    expect(r.revenue).toBe(20000);
    expect(r.units).toBe(4);
  });
  it("margem zero e negativa não têm ponto de equilíbrio", () => {
    expect(breakEven(10000, 0, 0)).toEqual({ revenue: null, units: null });
    expect(breakEven(10000, -10, -500)).toEqual({ revenue: null, units: null });
  });
  it("calculado no agregado com despesas do período", () => {
    const r = aggregate(ds({ sales: [sale({ qty: 2 })], expenses: [exp({ amount: 4990 })] }), DAY);
    // MC = 13980 − 4000 = 9980; MC% ≈ 71,39%; equilíbrio = 4990 / 0,7139 ≈ 6990
    expect(r.breakEvenRevenue.value).toBe(6990);
    expect(r.breakEvenUnits.value).toBe(1); // 4990 ÷ 4990 de contribuição por placa = 1 placa
  });
});

describe("13. mudança de preço e custo", () => {
  it("simulador recalcula contribuição, unidades para meta e alerta de margem", () => {
    const base = { price: 6990, unitCost: 2000, feePct: 0, feeFixedPerOrder: 0, discountPct: 0, qty: 1, transport: 8000, fixedCosts: 0, profitTarget: 50000, minContributionPct: 40 };
    const a = simulate(base);
    expect(a.contributionPerUnit).toBe(4990);
    expect(a.unitsForTarget).toBe(Math.ceil(58000 / 4990));
    const b = simulate({ ...base, price: 3990, unitCost: 2500 });
    expect(b.contributionPerUnit).toBe(1490);
    expect(b.alerts.join(" ")).toMatch(/abaixo do limite/);
    const c = simulate({ ...base, unitCost: null });
    expect(c.incomplete).toBe(true);
    expect(c.alerts[0]).toMatch(/não informado/);
    const t = discountTable(base, [0, 10]);
    expect(t[1].netPrice).toBe(6291);
    expect(t[1].contributionPerUnit).toBe(4291);
  });
  it("custo por versão: vendas antigas usam o custo da época; lotes viram média ponderada", () => {
    const prof = (id: string, validFrom: string, placa: number | null, useLotAverage = false): CostProfile => ({ ...base(id), productId: "p", validFrom, useLotAverage, notes: "", components: [{ key: "placa", label: "Placa", amount: placa }, { key: "embalagem", label: "Embalagem", amount: 100 }] });
    const profiles = [prof("a", "2026-10-01", 1500), prof("b", "2026-11-01", 1800)];
    expect(suggestUnitCost(profiles, [], "2026-10-27").unitCost).toBe(1600);
    expect(suggestUnitCost(profiles, [], "2026-11-05").unitCost).toBe(1900);
    expect(suggestUnitCost([prof("c", "2026-10-01", null)], [], "2026-10-27").unitCost).toBeNull();
    const lot = (id: string, qty: number, totalPaid: number | null, freight = 0): StockLot => ({ ...base(id), productId: "p", at: "2026-10-20", qty, totalPaid, freight, supplier: "", notes: "", isInitial: false });
    const lots = [lot("l1", 10, 15000), lot("l2", 30, 60000, 3000)];
    expect(lotAverageCost(lots).avg).toBe(Math.round((15000 + 63000) / 40));
    const s = suggestUnitCost([prof("d", "2026-10-01", 9999, true)], lots, "2026-10-27");
    expect(s.placaSource).toBe("lotes");
    expect(s.unitCost).toBe(1950 + 100);
  });
});

describe("conversão, contato e demonstração", () => {
  it("visitas pendentes não contam; fechado não entra no denominador", () => {
    const visits = [visit("1", "venda"), visit("2", "ausente"), visit("3", "sem_interesse"), visit("4", "fechado"), visit("5", "conversa", { demo: true })];
    const r = aggregate(ds({ visits, sales: [sale({ visitId: "1" })] }), DAY);
    expect(r.visitsRealized).toBe(4);
    expect(r.visitsClosedPlace).toBe(1);
    expect(r.salesFromVisits).toBe(1);
    expect(r.conversion.value).toBe(25);
    expect(r.contactRate.value).toBe(75);
    expect(r.demoRate.value).toBe(50);
  });
});

describe("produtividade e projeção", () => {
  it("contribuição por hora usa as horas de jornada das rotas", () => {
    const route: Route = { ...base("r1"), name: "R", date: "2026-10-27", region: "", notes: "", workStart: "2026-10-27T12:00:00.000Z", workEnd: "2026-10-27T20:00:00.000Z", manualHours: null, importBatchId: null };
    const r = aggregate(ds({ sales: [sale({ qty: 2 })], routes: [route] }), DAY);
    expect(r.hours).toBe(8);
    expect(r.contributionPerHour.value).toBeCloseTo(9980 / 8);
    expect(r.salesPerHour.value).toBeCloseTo(1 / 8);
  });
  it("projeção informa dias considerados e confiança insuficiente com amostra mínima", () => {
    const p = projectMonth(ds({ sales: [sale({})], visits: [visit("1", "venda")] }), new Date(2026, 9, 27, 18), [2, 3, 4]);
    expect(p.activeDays).toBe(1);
    expect(p.remainingWorkDays).toBe(2); // 28 e 29/10 (qua e qui)
    expect(p.confidence).toBe("insuficiente");
    expect(p.projectedNet).toBe(6990 * 3);
  });
});

describe("estoque", () => {
  it("saldo = entradas − vendidas + devolvidas − perdas ± ajustes; compra de estoque não é despesa", () => {
    const lots: StockLot[] = [{ ...base("l1"), productId: "p", at: "2026-10-20", qty: 50, totalPaid: 100000, freight: 0, supplier: "", notes: "", isInitial: false }];
    const sales = [sale({ id: "a", qty: 3 }), sale({ id: "b", qty: 1, refund: { at: T, amount: 6990, unitsReturned: 1, returnedToStock: true, reason: "" } }), sale({ id: "c", qty: 5, status: "cancelada" })];
    const st = stockSummary(lots, [{ ...base("m"), productId: "p", at: "2026-10-27", type: "perda", qty: 2, reason: "" }], sales);
    expect(st.sold).toBe(4);
    expect(st.balance).toBe(50 - 4 + 1 - 2);
    expect(st.avgCost).toBe(2000);
    const r = aggregate(ds({ sales: [sales[0]], stockLots: lots }), { start: new Date(2026, 9, 1), end: new Date(2026, 10, 1) });
    expect(r.opExpenses).toBe(0); // compra de estoque não é despesa
    expect(r.stockPurchases).toBe(100000); // mas é saída de caixa
    expect(r.cogs.value).toBe(6000);
  });
});
