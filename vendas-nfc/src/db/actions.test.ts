import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { AppDB, setDatabase, db } from "./db";
import {
  ensureSetup, createSale, cancelSale, refundSale, addPayment, addExpense, confirmExpensePaid, setStopStatus, createRoute,
  addEstablishment, addStop, moveStop, commitImport, applyPendingCosts, applyPendingFees, saveCostProfile, addLot,
  PossibleDuplicateError, ValidationError, DEFAULT_COMPONENTS, updateSettings, getSettings, updateSale,
} from "./actions";
import { seedDemo, clearDemo, countDemo } from "./demo";
import { exportBackup, restoreBackup, validateBackup } from "./backup";
import { parseCsvText, autoMap, parseRows, detectRoutes, summarize, sheetsToTables } from "@/lib/import/parse";
import { aggregate, calcSale } from "@/lib/finance/engine";
import { uid } from "@/lib/utils";

let name = "";
beforeEach(async () => {
  name = "test-" + uid();
  setDatabase(new AppDB(name));
  await ensureSetup();
});

async function loadAll(isDemo = false) {
  const f = <T extends { isDemo: boolean }>(xs: T[]) => xs.filter((x) => x.isDemo === isDemo);
  return {
    sales: f(await db.sales.toArray()), payments: f(await db.payments.toArray()), expenses: f(await db.expenses.toArray()),
    visits: f(await db.visits.toArray()), routes: f(await db.routes.toArray()), stockLots: f(await db.stockLots.toArray()),
  };
}
const ALL = { start: new Date(2000, 0, 1), end: new Date(2100, 0, 1) };

async function quickEstablishment() {
  return addEstablishment({ name: "Barbearia Teste", address: "Rua 1, Qd. 2", category: "Barbearia", bairro: "Centro", city: "Goiânia" });
}

describe("vendas", () => {
  it("registra venda paga com preço padrão e custo pendente", async () => {
    const e = await quickEstablishment();
    const s = await createSale({ establishmentId: e.id, qty: 1, unitPrice: 6990, paymentMethod: "dinheiro", paymentStatus: "pago", unitCost: null, feePct: 0, clientRequestId: "r1" });
    expect(s.customerName).toBe("Barbearia Teste");
    const ds = await loadAll();
    const sum = aggregate(ds, ALL);
    expect(sum.net).toBe(6990);
    expect(sum.received).toBe(6990);
    expect(sum.contribution.state).toBe("pendente");
  });

  it("14. evita duplicidade: mesmo formulário (idempotência) e venda igual em 15 min", async () => {
    const e = await quickEstablishment();
    const input = { establishmentId: e.id, qty: 1, unitPrice: 6990, paymentMethod: "pix", paymentStatus: "pago" as const, unitCost: 2000, feePct: 0, clientRequestId: "same" };
    const a = await createSale(input);
    const b = await createSale(input);
    expect(b.id).toBe(a.id);
    expect(await db.sales.count()).toBe(1);
    expect(await db.payments.count()).toBe(1);
    await expect(createSale({ ...input, clientRequestId: "other" })).rejects.toBeInstanceOf(PossibleDuplicateError);
    const c = await createSale({ ...input, clientRequestId: "other" }, { allowDuplicate: true });
    expect(c.id).not.toBe(a.id);
  });

  it("valida campos obrigatórios", async () => {
    await expect(createSale({ establishmentId: null, qty: 1, unitPrice: 6990, paymentMethod: "pix", paymentStatus: "pago", unitCost: null, feePct: 0, clientRequestId: "x" })).rejects.toBeInstanceOf(ValidationError);
    await expect(createSale({ establishmentId: null, customerName: "A", qty: 0, unitPrice: 6990, paymentMethod: "pix", paymentStatus: "pago", unitCost: null, feePct: 0, clientRequestId: "y" })).rejects.toThrow(/quantidade/i);
  });

  it("pagamento parcial, complemento e bloqueio de pagamento acima do saldo", async () => {
    const s = await createSale({ establishmentId: null, customerName: "Cliente A", qty: 2, unitPrice: 6990, paymentMethod: "pix", paymentStatus: "parcial", paidAmount: 5000, unitCost: 2000, feePct: 0, clientRequestId: "p" });
    let pays = await db.payments.where("saleId").equals(s.id).toArray();
    expect(calcSale(s, pays).paymentStatus).toBe("parcial");
    await expect(addPayment(s.id, 999999, "pix")).rejects.toThrow(/excede/);
    await addPayment(s.id, 13980 - 5000, "pix");
    pays = await db.payments.where("saleId").equals(s.id).toArray();
    expect(calcSale((await db.sales.get(s.id))!, pays).paymentStatus).toBe("pago");
  });

  it("venda pendente não conta como recebida", async () => {
    await createSale({ establishmentId: null, customerName: "Cliente B", qty: 1, unitPrice: 6990, paymentMethod: "pix", paymentStatus: "pendente", unitCost: 2000, feePct: 0, clientRequestId: "pend" });
    const sum = aggregate(await loadAll(), ALL);
    expect(sum.received).toBe(0);
    expect(sum.receivables).toBe(6990);
  });

  it("cancelamento anula receita e pagamento, mantendo histórico", async () => {
    const s = await createSale({ establishmentId: null, customerName: "Cliente C", qty: 1, unitPrice: 6990, paymentMethod: "pix", paymentStatus: "pago", unitCost: 2000, feePct: 0, transportCost: 1500, clientRequestId: "c" });
    await expect(cancelSale(s.id, "")).rejects.toThrow(/motivo/);
    await cancelSale(s.id, "Lançado por engano");
    const sum = aggregate(await loadAll(), ALL);
    expect(sum.net).toBe(0);
    expect(sum.received).toBe(0);
    expect(sum.opExpenses).toBe(1500); // transporte foi gasto de verdade: vira despesa operacional
    const audit = await db.audit.where("entityId").equals(s.id).toArray();
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(["criar", "cancelar"]));
    expect((await db.sales.get(s.id))?.status).toBe("cancelada");
  });

  it("estorno com devolução do dinheiro e reintegração ao estoque", async () => {
    const s = await createSale({ establishmentId: null, customerName: "Cliente D", qty: 1, unitPrice: 6990, paymentMethod: "pix", paymentStatus: "pago", unitCost: 2000, feePct: 0, clientRequestId: "d" });
    await refundSale(s.id, { amount: 6990, unitsReturned: 1, returnedToStock: true, reason: "Cliente desistiu", returnMoney: true });
    const sum = aggregate(await loadAll(), ALL);
    expect(sum.net).toBe(0);
    expect(sum.received).toBe(0);
    expect(sum.cogs.value).toBe(0);
    await expect(refundSale(s.id, { amount: 10, unitsReturned: 0, returnedToStock: false, reason: "x", returnMoney: false })).rejects.toThrow(/já possui/);
  });

  it("edição registra auditoria antes/depois", async () => {
    const s = await createSale({ establishmentId: null, customerName: "Cliente E", qty: 1, unitPrice: 6990, paymentMethod: "pix", paymentStatus: "pendente", unitCost: null, feePct: 0, clientRequestId: "e" });
    await updateSale(s.id, { qty: 2, discount: 990 }, "Cliente levou mais uma");
    const cur = (await db.sales.get(s.id))!;
    expect(cur.items[0].qty).toBe(2);
    const a = (await db.audit.where("entityId").equals(s.id).toArray()).find((x) => x.action === "editar")!;
    expect(a.summary).toBe("Cliente levou mais uma");
    expect((a.before as { items: { qty: number }[] }).items[0].qty).toBe(1);
  });

  it("aplica custo e taxa às vendas pendentes quando informados depois", async () => {
    await createSale({ establishmentId: null, customerName: "Cliente F", qty: 1, unitPrice: 6990, paymentMethod: "pix", paymentStatus: "pago", unitCost: null, feePct: null, clientRequestId: "f" });
    expect(await applyPendingCosts(false)).toBe(0); // ainda sem custo informado
    await saveCostProfile({ validFrom: "2000-01-01", useLotAverage: true, components: DEFAULT_COMPONENTS.map((c) => ({ ...c, amount: c.key === "placa" ? 1800 : c.key === "embalagem" ? 200 : null })) });
    expect(await applyPendingCosts(false)).toBe(1);
    const st = await getSettings();
    await updateSettings({ paymentMethods: st.paymentMethods.map((m) => (m.id === "pix" ? { ...m, feePct: 0 } : m)) });
    expect(await applyPendingFees(false)).toBe(1);
    const sum = aggregate(await loadAll(), ALL);
    expect(sum.contribution).toEqual({ value: 6990 - 2000, state: "ok" });
  });

  it("lote de estoque com custo vira a sugestão de custo da placa (média ponderada)", async () => {
    await addLot({ at: "2026-10-20", qty: 100, totalPaid: 150000, freight: 5000 });
    expect(await applyPendingCosts(false)).toBe(0);
    await createSale({ establishmentId: null, customerName: "Cliente G", qty: 1, unitPrice: 6990, paymentMethod: "dinheiro", paymentStatus: "pago", unitCost: null, feePct: 0, clientRequestId: "g" });
    expect(await applyPendingCosts(false)).toBe(1);
    expect((await db.sales.toArray())[0].items[0].unitCost).toBe(1550);
  });
});

describe("despesas e transporte", () => {
  it("previsão convertida em valor pago guarda a estimativa", async () => {
    const e = await addExpense({ at: "2026-10-29", category: "uber", amount: 2500, status: "previsto" });
    await expect(addExpense({ at: "2026-10-29", category: "uber", amount: 2500, status: "previsto" })).rejects.toBeInstanceOf(PossibleDuplicateError);
    await confirmExpensePaid(e.id, 2230);
    const cur = (await db.expenses.get(e.id))!;
    expect(cur.status).toBe("pago");
    expect(cur.amount).toBe(2230);
    expect(cur.estimate).toBe(2500);
  });
});

describe("rotas, paradas e visitas", () => {
  it("status com um toque cria visita; correção rápida não duplica; voltar a pendente desfaz", async () => {
    const e = await quickEstablishment();
    const r = await createRoute({ name: "Terça", date: "2026-10-27" });
    const st = await addStop(r.id, e.id);
    await setStopStatus(st.id, "ausente");
    expect(await db.visits.count()).toBe(1);
    await setStopStatus(st.id, "conversa", { demo: true });
    const vs = await db.visits.toArray();
    expect(vs.length).toBe(1);
    expect(vs[0].outcome).toBe("conversa");
    expect(vs[0].contact).toBe(true);
    await setStopStatus(st.id, "pendente");
    expect((await db.visits.toArray()).filter((v) => !v.deletedAt).length).toBe(0);
  });

  it("venda a partir da parada vincula visita e conta na conversão", async () => {
    const e = await quickEstablishment();
    const r = await createRoute({ name: "Terça", date: "2026-10-27" });
    const st = await addStop(r.id, e.id);
    await setStopStatus(st.id, "conversa");
    await createSale({ establishmentId: e.id, stopId: st.id, qty: 1, unitPrice: 6990, paymentMethod: "pix", paymentStatus: "pago", unitCost: 2000, feePct: 0, clientRequestId: "v" });
    expect((await db.stops.get(st.id))?.status).toBe("venda");
    const sum = aggregate(await loadAll(), ALL);
    expect(sum.visitsRealized).toBe(1);
    expect(sum.salesFromVisits).toBe(1);
    expect(sum.conversion.value).toBe(100);
  });

  it("venda em visita avulsa registra a visita e conta na conversão", async () => {
    const e = await quickEstablishment();
    await createSale({ establishmentId: e.id, recordVisit: true, qty: 1, unitPrice: 6990, paymentMethod: "pix", paymentStatus: "pago", unitCost: 2000, feePct: 0, clientRequestId: "avulsa" });
    const sum = aggregate(await loadAll(), ALL);
    expect(sum.visitsRealized).toBe(1);
    expect(sum.salesFromVisits).toBe(1);
  });

  it("reordena paradas e impede estabelecimento repetido na rota", async () => {
    const r = await createRoute({ name: "R", date: "2026-10-27" });
    const ids = [];
    for (const n of ["A", "B", "C"]) {
      const e = await addEstablishment({ name: `Loja ${n}`, address: `Rua ${n}` });
      ids.push((await addStop(r.id, e.id)).id);
    }
    await moveStop(ids[2], 0);
    const order = (await db.stops.where("routeId").equals(r.id).toArray()).sort((a, b) => a.order - b.order).map((s) => s.id);
    expect(order).toEqual([ids[2], ids[0], ids[1]]);
    const s0 = (await db.stops.get(ids[0]))!;
    await expect(addStop(r.id, s0.establishmentId)).rejects.toThrow(/já está/);
  });

  it("não duplica estabelecimento com nome/endereço equivalentes", async () => {
    await addEstablishment({ name: "Vintage Barbearia Pub", address: "Av. Alexandre de Morais, nº 1806, Qd. 06" });
    await expect(addEstablishment({ name: "vintage barbearia pub", address: "Avenida Alexandre de Morais 1806 Quadra 06" })).rejects.toBeInstanceOf(PossibleDuplicateError);
  });
});

describe("15. persistência após recarregar", () => {
  it("dados continuam no IndexedDB ao reabrir o banco (simula atualizar a página)", async () => {
    const s = await createSale({ establishmentId: null, customerName: "Persistente", qty: 1, unitPrice: 6990, paymentMethod: "pix", paymentStatus: "pago", unitCost: 2000, feePct: 0, clientRequestId: "persist" });
    db.close();
    const reopened = new AppDB(name);
    setDatabase(reopened);
    await reopened.open();
    expect((await reopened.sales.get(s.id))?.customerName).toBe("Persistente");
    expect(await reopened.payments.count()).toBe(1);
    expect((await reopened.settings.get("app"))?.defaultPrice).toBe(6990);
  });
});

describe("16. separação de dados (demo × real)", () => {
  it("demonstração nunca entra nos números reais e pode ser removida", async () => {
    await createSale({ establishmentId: null, customerName: "Real", qty: 1, unitPrice: 6990, paymentMethod: "pix", paymentStatus: "pago", unitCost: 2000, feePct: 0, clientRequestId: "real" });
    const info = await seedDemo(new Date(2026, 9, 27, 12));
    expect(info.sales).toBeGreaterThan(0);
    const real = aggregate(await loadAll(false), ALL);
    expect(real.ordersRecognized).toBe(1);
    const demo = aggregate(await loadAll(true), ALL);
    expect(demo.ordersRecognized).toBe(info.sales);
    expect(await countDemo()).toBeGreaterThan(0);
    await clearDemo();
    expect(await countDemo()).toBe(0);
    expect(await db.sales.count()).toBe(1);
    const ests = await db.establishments.toArray();
    expect(ests.every((e) => !e.name.startsWith("Exemplo demo"))).toBe(true);
  });
});

describe("importação dos roteiros originais", () => {
  const csv = readFileSync(resolve(__dirname, "../../public/dados/planilha_prospeccao.csv"), "utf-8");

  it("detecta colunas, 88 estabelecimentos, 3 dias e mantém notas como não verificadas", () => {
    const t = parseCsvText(csv, "planilha_prospeccao.csv");
    const m = autoMap(t.headers);
    expect(m.name).not.toBeNull();
    expect(m.address).not.toBeNull();
    expect(m.day).not.toBeNull();
    expect(m.order).not.toBeNull();
    const rows = parseRows(t, m, new Set());
    const s = summarize(rows);
    expect(s.total).toBe(88);
    expect(s.invalidos).toBe(0);
    expect(s.novos).toBe(88);
    expect(rows.every((r) => r.rating == null)).toBe(true); // "Não verificada" → sem nota
    expect(rows.find((r) => r.name === "Odonto Amazonas")?.otherRating).toMatch(/dentmap/);
    expect(rows[0].legDistance).not.toMatch(/estimativa/);
    const routes = detectRoutes(rows);
    expect(routes.map((r) => [r.date, r.stops])).toEqual([["2026-10-27", 28], ["2026-10-28", 30], ["2026-10-29", 30]]);
    expect(routes[2].region).toMatch(/Garavelo/);
  });

  it("importa, cria rotas/paradas e não duplica ao importar de novo", async () => {
    const t = parseCsvText(csv, "planilha_prospeccao.csv");
    const rows = parseRows(t, autoMap(t.headers), new Set());
    const r1 = await commitImport("planilha_prospeccao.csv", rows, detectRoutes(rows), { createRoutes: true });
    expect(r1.createdEstablishments).toBe(88);
    expect(r1.routesCreated).toBe(3);
    expect(r1.stopsCreated).toBe(88);
    const ests = await db.establishments.toArray();
    expect(ests.every((e) => e.ratingVerified === false)).toBe(true);
    const stops = await db.stops.toArray();
    expect(stops.every((s) => s.legVerified === false)).toBe(true);
    const keys = new Set(ests.map((e) => e.dedupeKey));
    const rows2 = parseRows(t, autoMap(t.headers), keys);
    expect(summarize(rows2).existentes).toBe(88);
    const r2 = await commitImport("planilha_prospeccao.csv", rows2, detectRoutes(rows2), { createRoutes: true });
    expect(r2.createdEstablishments).toBe(0);
    expect(r2.routesCreated).toBe(0);
    expect(r2.stopsCreated).toBe(0);
    expect(await db.establishments.count()).toBe(88);
  });

  it("aceita XLSX original (abas de cada dia) e linhas inválidas são reportadas", async () => {
    const readXlsx = (await import("read-excel-file/node")).default;
    const sheets = await readXlsx(readFileSync(resolve(__dirname, "../../public/dados/planilha_prospeccao.xlsx")));
    const tables = sheetsToTables(sheets as { sheet: string; data: unknown[][] }[]);
    const names = tables.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["Terça 27-10", "Quarta 28-10", "Quinta 29-10"]));
    const tue = tables.find((t) => t.name === "Terça 27-10")!;
    expect(parseRows(tue, autoMap(tue.headers), new Set()).length).toBe(28);
    const bad = parseCsvText("Nome;Endereço;Categoria\n;Rua X;Bar\nLoja Y;;Loja\n", "x.csv");
    const s = summarize(parseRows(bad, autoMap(bad.headers), new Set()));
    expect(s.invalidos).toBe(2);
  });
});

describe("backup", () => {
  it("exporta e restaura todos os dados; rejeita arquivo inválido", async () => {
    await createSale({ establishmentId: null, customerName: "Backup", qty: 1, unitPrice: 6990, paymentMethod: "pix", paymentStatus: "pago", unitCost: 2000, feePct: 0, clientRequestId: "bk" });
    const b = await exportBackup();
    expect(b.counts.sales).toBe(1);
    expect(validateBackup({ format: "outro" })).toMatch(/não é um backup/);
    setDatabase(new AppDB("restore-" + uid()));
    await restoreBackup(JSON.parse(JSON.stringify(b)));
    expect((await db.sales.toArray())[0].customerName).toBe("Backup");
  });
});
