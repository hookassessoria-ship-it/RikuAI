/**
 * DADOS DEMONSTRATIVOS
 * - Todos os registros têm isDemo = true e só aparecem no "Modo demonstração".
 * - Nomes deixam explícito que são fictícios ("Exemplo demo …") para não parecerem leads reais.
 * - Nunca entram nos números do modo real; podem ser removidos a qualquer momento.
 */
import { db } from "./db";
import { base, newEstablishment, newStop, PRODUCT_ID, DEFAULT_COMPONENTS } from "./actions";
import type { Establishment, Route, Stop, Visit, Sale, Payment, Expense, VisitOutcome } from "./types";
import { CONTACT_OUTCOMES } from "./types";
import { dayKey, addDays, startOfDay } from "@/lib/dates";
import { uid } from "@/lib/utils";

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const SEGS = [
  ["Barbearia", "Barbearia"],
  ["Salão de beleza", "Beleza e estética"],
  ["Restaurante", "Alimentação"],
  ["Pet shop", "Pet e veterinária"],
  ["Oficina mecânica", "Automotivo"],
  ["Clínica odontológica", "Saúde"],
  ["Loja de roupas", "Varejo"],
];
const REGIONS = ["Região Demo Norte", "Região Demo Sul", "Região Demo Centro"];

export const DEMO_TABLES = ["establishments", "routes", "stops", "visits", "sales", "payments", "expenses", "costProfiles", "stockLots", "stockMoves", "audit"] as const;

export async function seedDemo(now = new Date()) {
  await clearDemo();
  const r = rng(20261027);
  const ests: Establishment[] = [];
  for (let i = 0; i < 36; i++) {
    const [cat, seg] = SEGS[i % SEGS.length];
    const region = REGIONS[i % REGIONS.length];
    ests.push(newEstablishment({
      name: `Exemplo demo ${String(i + 1).padStart(2, "0")} (${cat.toLowerCase()})`,
      category: cat, segment: seg, address: `Endereço fictício, nº ${100 + i}`, bairro: region, city: "Cidade Demo", region,
      priority: 50 + Math.round(r() * 45), priorityReason: "Registro fictício para demonstração.", origin: "demo",
    }, true));
  }
  const routes: Route[] = [];
  const stops: Stop[] = [];
  const visits: Visit[] = [];
  const sales: Sale[] = [];
  const payments: Payment[] = [];
  const expenses: Expense[] = [];
  const today = startOfDay(now);
  const days = [-13, -12, -11, -6, -5, -4, -1].map((d) => addDays(today, d));
  days.forEach((d, di) => {
    const route: Route = {
      ...base(true), name: `Rota demo ${di + 1}`, date: dayKey(d), region: REGIONS[di % REGIONS.length], notes: "Rota fictícia",
      workStart: new Date(d.getFullYear(), d.getMonth(), d.getDate(), 9, 0).toISOString(),
      workEnd: new Date(d.getFullYear(), d.getMonth(), d.getDate(), 17, 30).toISOString(), manualHours: null, importBatchId: null,
    };
    routes.push(route);
    const n = 10 + Math.floor(r() * 5);
    for (let k = 0; k < n; k++) {
      const e = ests[(di * 5 + k) % ests.length];
      const at = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 9 + Math.floor(k * 0.6), Math.floor(r() * 59)).toISOString();
      const x = r();
      const outcome: VisitOutcome = x < 0.12 ? "venda" : x < 0.25 ? "interessado" : x < 0.4 ? "ausente" : x < 0.55 ? "retornar" : x < 0.8 ? "sem_interesse" : x < 0.9 ? "conversa" : "fechado";
      const visit: Visit = {
        ...base(true), establishmentId: e.id, routeId: route.id, stopId: null, at, outcome,
        contact: CONTACT_OUTCOMES.includes(outcome), demo: outcome === "venda" || outcome === "interessado" || r() < 0.2,
        lossReason: outcome === "sem_interesse" ? ["Preço", "Não vê valor", "Já usa placa/QR de avaliação"][Math.floor(r() * 3)] : "",
        followUpAt: outcome === "retornar" || outcome === "interessado" ? dayKey(addDays(d, 3)) : null, notes: "",
      };
      const stop = newStop(route.id, e.id, k + 1, true, { status: outcome, statusAt: at, lastVisitId: visit.id, legDistance: "≈ 100–300 m (fictício)" });
      visit.stopId = stop.id;
      stops.push(stop);
      visits.push(visit);
      if (outcome === "venda") {
        const qty = r() < 0.2 ? 2 : 1;
        const discount = r() < 0.25 ? 1000 : 0;
        const method = ["pix", "dinheiro", "credito"][Math.floor(r() * 3)];
        const sale: Sale = {
          ...base(true), establishmentId: e.id, customerName: e.name, at, delivered: true, deliveredAt: at,
          items: [{ productId: PRODUCT_ID, qty, unitPrice: 6990, unitCost: 2000 }], discount, paymentMethod: method,
          feePct: method === "credito" ? 4.99 : 0, feeFixed: 0, commissionPct: 0, taxPct: 0, otherVariable: 0,
          status: "ativa", cancelReason: "", cancelledAt: null, refund: null, routeId: route.id, stopId: stop.id, visitId: visit.id,
          origin: "Rota", notes: "Venda fictícia", clientRequestId: uid(),
        };
        sales.push(sale);
        const net = qty * 6990 - discount;
        if (r() < 0.8) payments.push({ ...base(true), saleId: sale.id, at, amount: net, method, note: "" });
        else if (r() < 0.5) payments.push({ ...base(true), saleId: sale.id, at, amount: Math.round(net / 2), method, note: "Parcial" });
      }
    }
    if (di % 3 === 0) expenses.push({ ...base(true), at: dayKey(d), category: "uber", amount: 1800 + Math.round(r() * 700), description: "Uber fictício", routeId: route.id, saleId: null, status: "pago", estimate: 2500 });
    expenses.push({ ...base(true), at: dayKey(d), category: "alimentacao", amount: 2200 + Math.round(r() * 1000), description: "Almoço fictício", routeId: route.id, saleId: null, status: "pago", estimate: null });
  });
  expenses.push({ ...base(true), at: dayKey(addDays(today, 1)), category: "uber", amount: 2500, description: "Uber previsto (fictício)", routeId: null, saleId: null, status: "previsto", estimate: 2500 });
  await db.transaction("rw", [db.establishments, db.routes, db.stops, db.visits, db.sales, db.payments, db.expenses, db.costProfiles, db.stockLots], async () => {
    await db.establishments.bulkAdd(ests);
    await db.routes.bulkAdd(routes);
    await db.stops.bulkAdd(stops);
    await db.visits.bulkAdd(visits);
    await db.sales.bulkAdd(sales);
    await db.payments.bulkAdd(payments);
    await db.expenses.bulkAdd(expenses);
    await db.costProfiles.add({
      ...base(true), productId: PRODUCT_ID, validFrom: "2000-01-01", useLotAverage: false,
      components: DEFAULT_COMPONENTS.map((c) => ({ ...c, amount: c.key === "placa" ? 2000 : 0 })), notes: "Custo FICTÍCIO de demonstração (R$ 20,00).",
    });
    await db.stockLots.add({ ...base(true), productId: PRODUCT_ID, at: dayKey(addDays(today, -20)), qty: 50, totalPaid: 100000, freight: 0, supplier: "Fornecedor demo", notes: "Lote fictício", isInitial: false });
  });
  return { establishments: ests.length, routes: routes.length, visits: visits.length, sales: sales.length };
}

export async function clearDemo() {
  await db.transaction("rw", DEMO_TABLES.map((t) => db.table(t)), async () => {
    for (const t of DEMO_TABLES) await db.table(t).filter((x: { isDemo?: boolean }) => x.isDemo === true).delete();
  });
}

export async function countDemo(): Promise<number> {
  let n = 0;
  for (const t of DEMO_TABLES) n += await db.table(t).filter((x: { isDemo?: boolean }) => x.isDemo === true).count();
  return n;
}
