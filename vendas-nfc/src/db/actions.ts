/**
 * Operações de escrita. Toda alteração relacionada acontece numa transação Dexie
 * (tudo ou nada) e gera registro de auditoria quando envolve dinheiro.
 */
import { db } from "./db";
import type {
  ID, BaseRow, Establishment, Route, Stop, Visit, Sale, Payment, Expense, CostProfile, CostComponent,
  StockLot, StockMove, GoalRule, Settings, AuditEntry, StopStatus, VisitOutcome, ExpenseCategory, ImportBatch,
} from "./types";
import { CONTACT_OUTCOMES } from "./types";
import { uid } from "@/lib/utils";
import type { Cents } from "@/lib/money";
import { calcSale, saleGross, saleUnits } from "@/lib/finance/engine";
import { suggestUnitCost } from "@/lib/finance/costs";
import { defaultGoalRules } from "@/lib/finance/goals";
import { dedupeKey, type ParsedRow, type RoutePreview } from "@/lib/import/parse";
import { segmentOf } from "@/lib/segments";

export const PRODUCT_ID = "placa-nfc-padrao";
export const DEFAULT_PRICE: Cents = 6990;

export class PossibleDuplicateError extends Error {
  constructor(message: string, public existingId: ID) {
    super(message);
    this.name = "PossibleDuplicateError";
  }
}
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

const now = () => new Date().toISOString();
export function base(isDemo: boolean): BaseRow {
  const t = now();
  return { id: uid(), createdAt: t, updatedAt: t, deletedAt: null, isDemo };
}

async function audit(entity: string, entityId: ID, action: AuditEntry["action"], summary: string, before: unknown, after: unknown, isDemo: boolean) {
  await db.audit.add({ id: uid(), entity, entityId, action, at: now(), summary, before: before ?? null, after: after ?? null, isDemo });
}
async function touch() {
  await db.settings.update("app", { lastChangeAt: now() });
}

// ---------------------------------------------------------------- Configuração inicial
export const DEFAULT_COMPONENTS: CostComponent[] = [
  { key: "placa", label: "Placa (aquisição/fabricação)", amount: null },
  { key: "embalagem", label: "Embalagem", amount: null },
  { key: "personalizacao", label: "Personalização", amount: null },
  { key: "outros_unidade", label: "Outros custos por unidade", amount: null },
];

export function defaultSettings(): Settings {
  return {
    id: "app",
    defaultPrice: DEFAULT_PRICE,
    uberBudget: 8000,
    transportBudgetSince: null,
    paymentMethods: [
      { id: "pix", label: "Pix", feePct: null, feeFixed: 0, active: true },
      { id: "dinheiro", label: "Dinheiro", feePct: 0, feeFixed: 0, active: true },
      { id: "credito", label: "Cartão de crédito", feePct: null, feeFixed: 0, active: true },
      { id: "debito", label: "Cartão de débito", feePct: null, feeFixed: 0, active: true },
      { id: "transferencia", label: "Transferência", feePct: null, feeFixed: 0, active: true },
      { id: "outro", label: "Outro", feePct: null, feeFixed: 0, active: true },
    ],
    commissionPct: 0,
    taxPct: 0,
    workWeekdays: [2, 3, 4],
    minSample: 10,
    viewMode: "real",
    appearance: "dark",
    lastBackupAt: null,
    lastChangeAt: null,
    storagePersisted: null,
    onboardingDone: false,
  };
}

/** Idempotente: cria configurações, produto, perfil de custo pendente e metas padrão. */
export async function ensureSetup() {
  await db.transaction("rw", [db.settings, db.products, db.costProfiles, db.goals], async () => {
    if (!(await db.settings.get("app"))) await db.settings.put(defaultSettings());
    if (!(await db.products.get(PRODUCT_ID))) {
      const t = now();
      await db.products.put({ id: PRODUCT_ID, name: "Placa adesiva NFC padrão (avaliação Google)", defaultPrice: DEFAULT_PRICE, active: true, createdAt: t, updatedAt: t, deletedAt: null, isDemo: false });
    }
    const real = await db.costProfiles.filter((p) => !p.isDemo).count();
    if (real === 0) {
      await db.costProfiles.put({ ...base(false), productId: PRODUCT_ID, validFrom: "2000-01-01", useLotAverage: true, components: DEFAULT_COMPONENTS, notes: "Perfil inicial: custos ainda não informados." });
    }
    if ((await db.goals.count()) === 0) await db.goals.bulkPut(defaultGoalRules(now()));
  });
}

export async function getSettings(): Promise<Settings> {
  return (await db.settings.get("app")) ?? defaultSettings();
}

export async function updateSettings(patch: Partial<Settings>, summary?: string) {
  const before = await getSettings();
  await db.settings.put({ ...before, ...patch, id: "app" });
  if (summary) await audit("configuracoes", "app", "editar", summary, before, patch, false);
}

// ---------------------------------------------------------------- Estabelecimentos
export type EstablishmentInput = Partial<Omit<Establishment, keyof BaseRow | "dedupeKey">> & { name: string; address: string };

export function newEstablishment(input: EstablishmentInput, isDemo: boolean): Establishment {
  const category = input.category?.trim() || "Não informada";
  const bairro = input.bairro?.trim() ?? "";
  const city = input.city?.trim() ?? "";
  return {
    ...base(isDemo),
    name: input.name.trim(),
    category,
    segment: input.segment || segmentOf(category),
    address: input.address.trim(),
    bairro,
    city,
    region: input.region || [bairro, city].filter(Boolean).join(" · "),
    phone: input.phone ?? "",
    googleRating: input.googleRating ?? null,
    googleReviews: input.googleReviews ?? null,
    ratingVerified: input.ratingVerified ?? false,
    ratingCheckedAt: input.ratingCheckedAt ?? null,
    otherRating: input.otherRating ?? "",
    hours: input.hours ?? "",
    hoursVerified: input.hoursVerified ?? false,
    hoursCheckedAt: input.hoursCheckedAt ?? null,
    mapsUrl: input.mapsUrl ?? "",
    priority: input.priority ?? null,
    priorityReason: input.priorityReason ?? "",
    evidence: input.evidence ?? "",
    sources: input.sources ?? "",
    notes: input.notes ?? "",
    responsible: input.responsible ?? "",
    origin: input.origin ?? (isDemo ? "demo" : "manual"),
    importBatchId: input.importBatchId ?? null,
    dedupeKey: dedupeKey(input.name, input.address),
  };
}

export async function findEstablishmentByKey(key: string, isDemo: boolean) {
  return db.establishments.where("dedupeKey").equals(key).filter((e) => !e.deletedAt && e.isDemo === isDemo).first();
}

export async function addEstablishment(input: EstablishmentInput, isDemo = false): Promise<Establishment> {
  if (!input.name?.trim()) throw new ValidationError("Informe o nome do estabelecimento.");
  if (!input.address?.trim()) throw new ValidationError("Informe o endereço.");
  const e = newEstablishment(input, isDemo);
  const existing = await findEstablishmentByKey(e.dedupeKey, isDemo);
  if (existing) throw new PossibleDuplicateError(`Já existe "${existing.name}" com nome e endereço equivalentes.`, existing.id);
  await db.establishments.add(e);
  await touch();
  return e;
}

export async function updateEstablishment(id: ID, patch: Partial<Establishment>) {
  const cur = await db.establishments.get(id);
  if (!cur) throw new ValidationError("Estabelecimento não encontrado.");
  const next: Establishment = { ...cur, ...patch, updatedAt: now() };
  if (patch.category && !patch.segment) next.segment = segmentOf(patch.category);
  if (patch.name || patch.address) next.dedupeKey = dedupeKey(next.name, next.address);
  if (patch.bairro !== undefined || patch.city !== undefined) next.region = [next.bairro, next.city].filter(Boolean).join(" · ");
  // Nota Google só é verificada quando o usuário confirma explicitamente.
  if (patch.googleRating !== undefined && patch.ratingVerified === undefined) next.ratingVerified = false;
  await db.establishments.put(next);
  await touch();
}

// ---------------------------------------------------------------- Rotas e paradas
export async function createRoute(input: { name: string; date: string; region?: string; notes?: string }, isDemo = false): Promise<Route> {
  if (!input.name.trim()) throw new ValidationError("Dê um nome para a rota.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new ValidationError("Informe a data da rota.");
  const r: Route = { ...base(isDemo), name: input.name.trim(), date: input.date, region: input.region ?? "", notes: input.notes ?? "", workStart: null, workEnd: null, manualHours: null, importBatchId: null };
  await db.routes.add(r);
  await touch();
  return r;
}

export async function updateRoute(id: ID, patch: Partial<Route>) {
  await db.routes.update(id, { ...patch, updatedAt: now() });
  await touch();
}

export async function deleteRoute(id: ID) {
  await db.transaction("rw", [db.routes, db.stops, db.settings], async () => {
    const t = now();
    await db.routes.update(id, { deletedAt: t, updatedAt: t });
    await db.stops.where("routeId").equals(id).modify({ deletedAt: t, updatedAt: t });
    await touch();
  });
}

async function routeStops(routeId: ID) {
  return (await db.stops.where("routeId").equals(routeId).toArray()).filter((s) => !s.deletedAt).sort((a, b) => a.order - b.order);
}

export function newStop(routeId: ID, establishmentId: ID, order: number, isDemo: boolean, extra: Partial<Stop> = {}): Stop {
  return {
    ...base(isDemo), routeId, establishmentId, order, status: "pendente", statusAt: null, legDistance: "", legTime: "", legVerified: false,
    plannedTime: "", approachTime: "", window: "", followUpAt: null, notes: "", lossReason: "", lastVisitId: null, ...extra,
  };
}

export async function addStop(routeId: ID, establishmentId: ID, isDemo = false): Promise<Stop> {
  return db.transaction("rw", [db.stops, db.settings], async () => {
    const stops = await routeStops(routeId);
    if (stops.some((s) => s.establishmentId === establishmentId)) throw new ValidationError("Este estabelecimento já está nesta rota.");
    const s = newStop(routeId, establishmentId, (stops.at(-1)?.order ?? 0) + 1, isDemo);
    await db.stops.add(s);
    await touch();
    return s;
  });
}

/** Move a parada para a nova posição (0-based) e renumera a rota. */
export async function moveStop(stopId: ID, toIndex: number) {
  await db.transaction("rw", [db.stops, db.settings], async () => {
    const stop = await db.stops.get(stopId);
    if (!stop) return;
    const stops = await routeStops(stop.routeId);
    const from = stops.findIndex((s) => s.id === stopId);
    const to = Math.max(0, Math.min(stops.length - 1, toIndex));
    if (from < 0 || from === to) return;
    const [x] = stops.splice(from, 1);
    stops.splice(to, 0, x);
    const t = now();
    await Promise.all(stops.map((s, i) => db.stops.update(s.id, { order: i + 1, updatedAt: t })));
    await touch();
  });
}

export async function removeStop(stopId: ID) {
  await db.transaction("rw", [db.stops, db.settings], async () => {
    const stop = await db.stops.get(stopId);
    if (!stop) return;
    const t = now();
    await db.stops.update(stopId, { deletedAt: t, updatedAt: t });
    const stops = await routeStops(stop.routeId);
    await Promise.all(stops.map((s, i) => db.stops.update(s.id, { order: i + 1 })));
    await touch();
  });
}

export async function updateStop(stopId: ID, patch: Partial<Stop>) {
  await db.stops.update(stopId, { ...patch, updatedAt: now() });
  await touch();
}

export interface VisitExtra {
  contact?: boolean;
  demo?: boolean;
  lossReason?: string;
  followUpAt?: string | null;
  notes?: string;
  at?: string;
}

const CORRECTION_WINDOW_MS = 30 * 60 * 1000;
const isOutcome = (s: StopStatus): s is VisitOutcome => s !== "pendente" && s !== "a_caminho";

/**
 * Altera o status de uma parada com um toque.
 * - Status de desfecho cria uma visita (histórico). Se a última visita desta parada foi registrada
 *   há menos de 30 min, ela é corrigida em vez de duplicada.
 * - Voltar para "pendente"/"a caminho" logo após um registro desfaz a visita recente.
 */
export async function setStopStatus(stopId: ID, status: StopStatus, extra: VisitExtra = {}): Promise<ID | null> {
  return db.transaction("rw", [db.stops, db.visits, db.settings], async () => {
    const stop = await db.stops.get(stopId);
    if (!stop) throw new ValidationError("Parada não encontrada.");
    const t = extra.at ?? now();
    const last = stop.lastVisitId ? await db.visits.get(stop.lastVisitId) : undefined;
    const recent = last && !last.deletedAt && Date.now() - new Date(last.createdAt).getTime() < CORRECTION_WINDOW_MS;
    let visitId: ID | null = stop.lastVisitId;
    if (isOutcome(status)) {
      const fields = {
        outcome: status,
        contact: extra.contact ?? CONTACT_OUTCOMES.includes(status),
        demo: extra.demo ?? status === "venda",
        lossReason: status === "sem_interesse" ? extra.lossReason ?? "" : "",
        followUpAt: extra.followUpAt ?? null,
        notes: extra.notes ?? "",
      };
      if (recent && last) {
        await db.visits.update(last.id, { ...fields, updatedAt: now() });
        visitId = last.id;
      } else {
        const v: Visit = { ...base(stop.isDemo), establishmentId: stop.establishmentId, routeId: stop.routeId, stopId: stop.id, at: t, ...fields };
        await db.visits.add(v);
        visitId = v.id;
      }
    } else if (recent && last) {
      await db.visits.update(last.id, { deletedAt: now() });
      visitId = null;
    }
    await db.stops.update(stopId, {
      status, statusAt: t, lastVisitId: visitId, updatedAt: now(),
      lossReason: status === "sem_interesse" ? extra.lossReason ?? stop.lossReason : stop.lossReason,
      followUpAt: extra.followUpAt !== undefined ? extra.followUpAt : stop.followUpAt,
      notes: extra.notes ? extra.notes : stop.notes,
    });
    await touch();
    return visitId;
  });
}

/** Visita avulsa (fora de rota). */
export async function recordVisit(establishmentId: ID, outcome: VisitOutcome, extra: VisitExtra = {}, isDemo = false): Promise<Visit> {
  const v: Visit = {
    ...base(isDemo), establishmentId, routeId: null, stopId: null, at: extra.at ?? now(), outcome,
    contact: extra.contact ?? CONTACT_OUTCOMES.includes(outcome), demo: extra.demo ?? outcome === "venda",
    lossReason: extra.lossReason ?? "", followUpAt: extra.followUpAt ?? null, notes: extra.notes ?? "",
  };
  await db.visits.add(v);
  await touch();
  return v;
}

export async function scheduleFollowUp(establishmentId: ID, date: string, notes = "", isDemo = false) {
  await db.transaction("rw", [db.visits, db.stops, db.settings], async () => {
    const visits = (await db.visits.where("establishmentId").equals(establishmentId).toArray()).filter((v) => !v.deletedAt).sort((a, b) => b.at.localeCompare(a.at));
    const last = visits[0];
    if (last) await db.visits.update(last.id, { followUpAt: date, notes: notes || last.notes, updatedAt: now() });
    else await db.visits.add({ ...base(isDemo), establishmentId, routeId: null, stopId: null, at: now(), outcome: "retornar", contact: false, demo: false, lossReason: "", followUpAt: date, notes });
    const stops = (await db.stops.where("establishmentId").equals(establishmentId).toArray()).filter((s) => !s.deletedAt);
    await Promise.all(stops.map((s) => db.stops.update(s.id, { followUpAt: date })));
    await touch();
  });
}

export async function startWork(routeId: ID) {
  await updateRoute(routeId, { workStart: now(), workEnd: null });
}
export async function endWork(routeId: ID) {
  await updateRoute(routeId, { workEnd: now() });
}

// ---------------------------------------------------------------- Vendas
export interface SaleInput {
  establishmentId: ID | null;
  customerName?: string;
  at?: string;
  qty: number;
  unitPrice: Cents;
  discount?: Cents;
  paymentMethod: string;
  paymentStatus: "pendente" | "parcial" | "pago";
  paidAmount?: Cents;
  unitCost: Cents | null;
  feePct: number | null;
  feeFixed?: Cents;
  commissionPct?: number;
  taxPct?: number;
  otherVariable?: Cents;
  transportCost?: Cents | null;
  transportCategory?: ExpenseCategory;
  delivered?: boolean;
  routeId?: ID | null;
  stopId?: ID | null;
  visitId?: ID | null;
  /** Venda fechada numa visita fora de rota: registra a visita para contar na conversão. */
  recordVisit?: boolean;
  origin?: string;
  notes?: string;
  clientRequestId: string;
  isDemo?: boolean;
}

export function validateSaleInput(i: SaleInput): string | null {
  if (!i.establishmentId && !i.customerName?.trim()) return "Informe o estabelecimento ou o nome do cliente.";
  if (!Number.isInteger(i.qty) || i.qty < 1) return "A quantidade deve ser um número inteiro maior que zero.";
  if (!(i.unitPrice >= 0)) return "Preço unitário inválido.";
  const gross = i.qty * i.unitPrice;
  if ((i.discount ?? 0) < 0 || (i.discount ?? 0) > gross) return "O desconto não pode ser negativo nem maior que o valor do pedido.";
  if (i.paymentStatus === "parcial") {
    const net = gross - (i.discount ?? 0);
    if (!i.paidAmount || i.paidAmount <= 0 || i.paidAmount >= net) return "No pagamento parcial, informe um valor maior que zero e menor que o total.";
  }
  if (i.unitCost != null && i.unitCost < 0) return "Custo unitário inválido.";
  if (i.feePct != null && (i.feePct < 0 || i.feePct > 100)) return "Taxa percentual inválida.";
  return null;
}

export async function createSale(input: SaleInput, opts: { allowDuplicate?: boolean } = {}): Promise<Sale> {
  const err = validateSaleInput(input);
  if (err) throw new ValidationError(err);
  const isDemo = !!input.isDemo;
  return db.transaction("rw", [db.sales, db.payments, db.expenses, db.stops, db.visits, db.establishments, db.audit, db.settings], async () => {
    // 1) Idempotência: o mesmo formulário enviado duas vezes não gera duas vendas.
    const same = await db.sales.where("clientRequestId").equals(input.clientRequestId).first();
    if (same) return same;
    const at = input.at ?? now();
    const est = input.establishmentId ? await db.establishments.get(input.establishmentId) : undefined;
    const customerName = est?.name ?? input.customerName?.trim() ?? "";
    const gross = input.qty * input.unitPrice;
    // 2) Provável duplicidade: mesmo cliente, mesmo valor e quantidade em até 15 min.
    if (!opts.allowDuplicate) {
      const t0 = new Date(at).getTime();
      const candidates = await db.sales.filter((s) => !s.deletedAt && s.status === "ativa" && s.isDemo === isDemo &&
        (input.establishmentId ? s.establishmentId === input.establishmentId : s.customerName.toLowerCase() === customerName.toLowerCase())).toArray();
      const dup = candidates.find((s) => saleGross(s) === gross && saleUnits(s) === input.qty && Math.abs(new Date(s.at).getTime() - t0) < 15 * 60 * 1000);
      if (dup) throw new PossibleDuplicateError("Já existe uma venda igual para este cliente nos últimos 15 minutos.", dup.id);
    }
    // 3) Visita vinculada (quando a venda nasce de uma parada).
    let visitId = input.visitId ?? null;
    let routeId = input.routeId ?? null;
    if (input.stopId) {
      const stop = await db.stops.get(input.stopId);
      if (stop) {
        routeId = stop.routeId;
        const last = stop.lastVisitId ? await db.visits.get(stop.lastVisitId) : undefined;
        const recent = last && !last.deletedAt && Date.now() - new Date(last.createdAt).getTime() < CORRECTION_WINDOW_MS;
        if (recent && last) {
          await db.visits.update(last.id, { outcome: "venda", contact: true, demo: true, updatedAt: now() });
          visitId = last.id;
        } else {
          const v: Visit = { ...base(isDemo), establishmentId: stop.establishmentId, routeId: stop.routeId, stopId: stop.id, at, outcome: "venda", contact: true, demo: true, lossReason: "", followUpAt: null, notes: "" };
          await db.visits.add(v);
          visitId = v.id;
        }
        await db.stops.update(stop.id, { status: "venda", statusAt: at, lastVisitId: visitId, followUpAt: null, updatedAt: now() });
      }
    } else if (input.recordVisit && input.establishmentId && !visitId) {
      const v: Visit = { ...base(isDemo), establishmentId: input.establishmentId, routeId: null, stopId: null, at, outcome: "venda", contact: true, demo: true, lossReason: "", followUpAt: null, notes: "" };
      await db.visits.add(v);
      visitId = v.id;
    }
    const delivered = input.delivered ?? true;
    const sale: Sale = {
      ...base(isDemo),
      establishmentId: input.establishmentId,
      customerName,
      at,
      delivered,
      deliveredAt: delivered ? at : null,
      items: [{ productId: PRODUCT_ID, qty: input.qty, unitPrice: input.unitPrice, unitCost: input.unitCost }],
      discount: input.discount ?? 0,
      paymentMethod: input.paymentMethod,
      feePct: input.feePct,
      feeFixed: input.feeFixed ?? 0,
      commissionPct: input.commissionPct ?? 0,
      taxPct: input.taxPct ?? 0,
      otherVariable: input.otherVariable ?? 0,
      status: "ativa",
      cancelReason: "",
      cancelledAt: null,
      refund: null,
      routeId,
      stopId: input.stopId ?? null,
      visitId,
      origin: input.origin ?? (input.stopId ? "Rota" : "Venda avulsa"),
      notes: input.notes ?? "",
      clientRequestId: input.clientRequestId,
    };
    await db.sales.add(sale);
    const net = gross - (input.discount ?? 0);
    if (input.paymentStatus === "pago" && net > 0) {
      await db.payments.add({ ...base(isDemo), saleId: sale.id, at, amount: net, method: input.paymentMethod, note: "Pagamento no ato" });
    } else if (input.paymentStatus === "parcial" && input.paidAmount) {
      await db.payments.add({ ...base(isDemo), saleId: sale.id, at, amount: input.paidAmount, method: input.paymentMethod, note: "Pagamento parcial" });
    }
    if (input.transportCost && input.transportCost > 0) {
      await db.expenses.add({ ...base(isDemo), at: at.slice(0, 10), category: input.transportCategory ?? "uber", amount: input.transportCost, description: `Transporte atribuído à venda para ${customerName}`, routeId, saleId: sale.id, status: "pago", estimate: null });
    }
    await audit("venda", sale.id, "criar", `Venda para ${customerName}: ${input.qty} × ${(input.unitPrice / 100).toFixed(2)}`, null, sale, isDemo);
    await touch();
    return sale;
  });
}

export type SalePatch = Partial<Pick<Sale, "customerName" | "at" | "discount" | "paymentMethod" | "feePct" | "feeFixed" | "commissionPct" | "taxPct" | "otherVariable" | "delivered" | "notes" | "establishmentId">> & {
  qty?: number;
  unitPrice?: Cents;
  unitCost?: Cents | null;
};

export async function updateSale(id: ID, patch: SalePatch, reason = "Edição") {
  await db.transaction("rw", [db.sales, db.audit, db.settings], async () => {
    const cur = await db.sales.get(id);
    if (!cur) throw new ValidationError("Venda não encontrada.");
    if (cur.status === "cancelada") throw new ValidationError("Venda cancelada não pode ser editada.");
    const item = { ...cur.items[0] };
    if (patch.qty !== undefined) item.qty = patch.qty;
    if (patch.unitPrice !== undefined) item.unitPrice = patch.unitPrice;
    if (patch.unitCost !== undefined) item.unitCost = patch.unitCost;
    const { qty: _q, unitPrice: _p, unitCost: _c, ...rest } = patch;
    const next: Sale = { ...cur, ...rest, items: [item, ...cur.items.slice(1)], updatedAt: now() };
    if (patch.delivered !== undefined) next.deliveredAt = patch.delivered ? cur.deliveredAt ?? now() : null;
    const gross = saleGross(next);
    if (!Number.isInteger(item.qty) || item.qty < 1) throw new ValidationError("Quantidade inválida.");
    if (next.discount < 0 || next.discount > gross) throw new ValidationError("Desconto inválido.");
    await db.sales.put(next);
    await audit("venda", id, "editar", reason, cur, next, cur.isDemo);
    await touch();
  });
}

/** Cancela (anula) um lançamento. Pagamentos do lançamento são anulados; transporte vinculado vira despesa operacional. */
export async function cancelSale(id: ID, reason: string) {
  if (!reason.trim()) throw new ValidationError("Informe o motivo do cancelamento.");
  await db.transaction("rw", [db.sales, db.payments, db.expenses, db.stops, db.visits, db.audit, db.settings], async () => {
    const cur = await db.sales.get(id);
    if (!cur || cur.status === "cancelada") return;
    const t = now();
    await db.sales.update(id, { status: "cancelada", cancelReason: reason, cancelledAt: t, updatedAt: t });
    await db.payments.where("saleId").equals(id).modify({ deletedAt: t, updatedAt: t });
    await db.expenses.where("saleId").equals(id).modify({ saleId: null, updatedAt: t });
    if (cur.stopId) await db.stops.update(cur.stopId, { status: "conversa", updatedAt: t });
    if (cur.visitId) await db.visits.update(cur.visitId, { outcome: "conversa", notes: "Venda cancelada", updatedAt: t });
    await audit("venda", id, "cancelar", `Cancelada: ${reason}`, cur, { status: "cancelada", cancelReason: reason }, cur.isDemo);
    await touch();
  });
}

export async function refundSale(id: ID, r: { amount: Cents; unitsReturned: number; returnedToStock: boolean; reason: string; returnMoney: boolean; at?: string }) {
  await db.transaction("rw", [db.sales, db.payments, db.audit, db.settings], async () => {
    const cur = await db.sales.get(id);
    if (!cur || cur.status !== "ativa") throw new ValidationError("Só vendas ativas podem ser estornadas.");
    if (cur.refund) throw new ValidationError("Esta venda já possui estorno registrado.");
    const pays = await db.payments.where("saleId").equals(id).toArray();
    const c = calcSale(cur, pays);
    if (r.amount <= 0 || r.amount > c.netBeforeRefund) throw new ValidationError("Valor do estorno deve ser maior que zero e até o valor da venda.");
    if (r.unitsReturned < 0 || r.unitsReturned > c.units) throw new ValidationError("Quantidade devolvida inválida.");
    const at = r.at ?? now();
    const refund = { at, amount: r.amount, unitsReturned: r.unitsReturned, returnedToStock: r.returnedToStock, reason: r.reason };
    await db.sales.update(id, { refund, updatedAt: now() });
    if (r.returnMoney && c.paid > 0) {
      await db.payments.add({ ...base(cur.isDemo), saleId: id, at, amount: -Math.min(r.amount, c.paid), method: cur.paymentMethod, note: `Devolução (estorno): ${r.reason}` });
    }
    await audit("venda", id, "estornar", `Estorno de ${(r.amount / 100).toFixed(2)}: ${r.reason}`, cur.refund, refund, cur.isDemo);
    await touch();
  });
}

export async function addPayment(saleId: ID, amount: Cents, method: string, at?: string) {
  await db.transaction("rw", [db.sales, db.payments, db.audit, db.settings], async () => {
    const sale = await db.sales.get(saleId);
    if (!sale || sale.status !== "ativa") throw new ValidationError("Venda não encontrada ou cancelada.");
    const pays = await db.payments.where("saleId").equals(saleId).toArray();
    const c = calcSale(sale, pays);
    const open = c.due - c.paid;
    if (amount <= 0) throw new ValidationError("Informe um valor maior que zero.");
    if (amount > open) throw new ValidationError(`O valor excede o saldo em aberto (${(open / 100).toFixed(2).replace(".", ",")}).`);
    const p: Payment = { ...base(sale.isDemo), saleId, at: at ?? now(), amount, method, note: "" };
    await db.payments.add(p);
    await audit("venda", saleId, "pagamento", `Recebimento de ${(amount / 100).toFixed(2)} (${method})`, null, p, sale.isDemo);
    await touch();
  });
}

/** Aplica o custo vigente na data de cada venda às vendas com custo pendente. */
export async function applyPendingCosts(isDemo: boolean): Promise<number> {
  return db.transaction("rw", [db.sales, db.costProfiles, db.stockLots, db.audit, db.settings], async () => {
    const profiles = (await db.costProfiles.toArray()).filter((p) => p.isDemo === isDemo);
    const lots = (await db.stockLots.toArray()).filter((l) => l.isDemo === isDemo);
    const pending = (await db.sales.toArray()).filter((s) => s.isDemo === isDemo && !s.deletedAt && s.items.some((i) => i.unitCost == null));
    let n = 0;
    for (const s of pending) {
      const sug = suggestUnitCost(profiles, lots, s.at);
      if (sug.unitCost == null) continue;
      const items = s.items.map((i) => (i.unitCost == null ? { ...i, unitCost: sug.unitCost } : i));
      await db.sales.update(s.id, { items, updatedAt: now() });
      await audit("venda", s.id, "editar", `Custo unitário aplicado: ${((sug.unitCost as number) / 100).toFixed(2)} (${sug.explanation})`, s.items, items, isDemo);
      n++;
    }
    if (n) await touch();
    return n;
  });
}

/** Aplica a taxa atual do meio de pagamento às vendas com taxa pendente. */
export async function applyPendingFees(isDemo: boolean): Promise<number> {
  const settings = await getSettings();
  return db.transaction("rw", [db.sales, db.audit, db.settings], async () => {
    const pending = (await db.sales.toArray()).filter((s) => s.isDemo === isDemo && !s.deletedAt && s.feePct == null);
    let n = 0;
    for (const s of pending) {
      const m = settings.paymentMethods.find((x) => x.id === s.paymentMethod);
      if (!m || m.feePct == null) continue;
      await db.sales.update(s.id, { feePct: m.feePct, feeFixed: m.feeFixed, updatedAt: now() });
      await audit("venda", s.id, "editar", `Taxa aplicada: ${m.feePct}% + ${(m.feeFixed / 100).toFixed(2)} (${m.label})`, null, { feePct: m.feePct, feeFixed: m.feeFixed }, isDemo);
      n++;
    }
    if (n) await touch();
    return n;
  });
}

// ---------------------------------------------------------------- Despesas
export interface ExpenseInput {
  at: string;
  category: ExpenseCategory;
  amount: Cents;
  description?: string;
  routeId?: ID | null;
  saleId?: ID | null;
  status?: "previsto" | "pago";
  isDemo?: boolean;
}

export async function addExpense(input: ExpenseInput, opts: { allowDuplicate?: boolean } = {}): Promise<Expense> {
  if (!(input.amount > 0)) throw new ValidationError("Informe um valor maior que zero.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.at)) throw new ValidationError("Informe a data.");
  const isDemo = !!input.isDemo;
  return db.transaction("rw", [db.expenses, db.audit, db.settings], async () => {
    if (!opts.allowDuplicate) {
      const recent = await db.expenses.filter((e) => !e.deletedAt && e.isDemo === isDemo && e.at === input.at && e.category === input.category && e.amount === input.amount && Date.now() - new Date(e.createdAt).getTime() < 5 * 60 * 1000).first();
      if (recent) throw new PossibleDuplicateError("Uma despesa idêntica acabou de ser registrada.", recent.id);
    }
    const e: Expense = { ...base(isDemo), at: input.at, category: input.category, amount: input.amount, description: input.description ?? "", routeId: input.routeId ?? null, saleId: input.saleId ?? null, status: input.status ?? "pago", estimate: input.status === "previsto" ? input.amount : null };
    await db.expenses.add(e);
    await audit("despesa", e.id, "criar", `${e.status === "previsto" ? "Previsão" : "Despesa"}: ${e.category} ${(e.amount / 100).toFixed(2)}`, null, e, isDemo);
    await touch();
    return e;
  });
}

/** Converte uma estimativa em valor pago (mantém a estimativa original para comparação). */
export async function confirmExpensePaid(id: ID, paidAmount: Cents, at?: string) {
  await db.transaction("rw", [db.expenses, db.audit, db.settings], async () => {
    const cur = await db.expenses.get(id);
    if (!cur) throw new ValidationError("Despesa não encontrada.");
    if (!(paidAmount > 0)) throw new ValidationError("Informe o valor pago.");
    const next = { status: "pago" as const, amount: paidAmount, estimate: cur.estimate ?? cur.amount, at: at ?? cur.at, updatedAt: now() };
    await db.expenses.update(id, next);
    await audit("despesa", id, "editar", `Valor pago confirmado: ${(paidAmount / 100).toFixed(2)} (estimado ${(cur.amount / 100).toFixed(2)})`, cur, next, cur.isDemo);
    await touch();
  });
}

export async function updateExpense(id: ID, patch: Partial<Expense>) {
  await db.transaction("rw", [db.expenses, db.audit, db.settings], async () => {
    const cur = await db.expenses.get(id);
    if (!cur) throw new ValidationError("Despesa não encontrada.");
    if (patch.amount !== undefined && !(patch.amount > 0)) throw new ValidationError("Valor inválido.");
    await db.expenses.update(id, { ...patch, updatedAt: now() });
    await audit("despesa", id, "editar", "Despesa editada", cur, patch, cur.isDemo);
    await touch();
  });
}

export async function deleteExpense(id: ID) {
  await db.transaction("rw", [db.expenses, db.audit, db.settings], async () => {
    const cur = await db.expenses.get(id);
    if (!cur) return;
    await db.expenses.update(id, { deletedAt: now() });
    await audit("despesa", id, "excluir", `Despesa excluída: ${cur.category} ${(cur.amount / 100).toFixed(2)}`, cur, null, cur.isDemo);
    await touch();
  });
}

// ---------------------------------------------------------------- Custos e estoque
export async function saveCostProfile(input: { validFrom: string; useLotAverage: boolean; components: CostComponent[]; notes?: string }, isDemo = false) {
  await db.transaction("rw", [db.costProfiles, db.audit, db.settings], async () => {
    const p: CostProfile = { ...base(isDemo), productId: PRODUCT_ID, validFrom: input.validFrom, useLotAverage: input.useLotAverage, components: input.components, notes: input.notes ?? "" };
    await db.costProfiles.add(p);
    await audit("custo", p.id, "criar", `Nova configuração de custo válida a partir de ${input.validFrom}`, null, p, isDemo);
    await touch();
  });
}

export async function addLot(input: { at: string; qty: number; totalPaid: Cents | null; freight?: Cents; supplier?: string; notes?: string; isInitial?: boolean }, isDemo = false): Promise<StockLot> {
  if (!Number.isInteger(input.qty) || input.qty <= 0) throw new ValidationError("Quantidade deve ser um inteiro maior que zero.");
  if (input.totalPaid != null && input.totalPaid < 0) throw new ValidationError("Valor pago inválido.");
  const l: StockLot = { ...base(isDemo), productId: PRODUCT_ID, at: input.at, qty: input.qty, totalPaid: input.totalPaid, freight: input.freight ?? 0, supplier: input.supplier ?? "", notes: input.notes ?? "", isInitial: !!input.isInitial };
  await db.transaction("rw", [db.stockLots, db.audit, db.settings], async () => {
    await db.stockLots.add(l);
    await audit("estoque", l.id, "criar", `Lote de ${l.qty} un. (${l.totalPaid == null ? "custo não informado" : (l.totalPaid / 100).toFixed(2)})`, null, l, isDemo);
    await touch();
  });
  return l;
}

export async function updateLot(id: ID, patch: Partial<StockLot>) {
  await db.transaction("rw", [db.stockLots, db.audit, db.settings], async () => {
    const cur = await db.stockLots.get(id);
    if (!cur) return;
    await db.stockLots.update(id, { ...patch, updatedAt: now() });
    await audit("estoque", id, patch.deletedAt ? "excluir" : "editar", patch.deletedAt ? "Lote excluído" : "Lote editado", cur, patch, cur.isDemo);
    await touch();
  });
}

export async function addStockMove(input: { type: StockMove["type"]; qty: number; at: string; reason?: string }, isDemo = false) {
  if (!Number.isInteger(input.qty) || input.qty === 0 || (input.type !== "ajuste" && input.qty < 0)) throw new ValidationError("Quantidade inválida.");
  const m: StockMove = { ...base(isDemo), productId: PRODUCT_ID, type: input.type, qty: input.qty, at: input.at, reason: input.reason ?? "" };
  await db.transaction("rw", [db.stockMoves, db.audit, db.settings], async () => {
    await db.stockMoves.add(m);
    await audit("estoque", m.id, "criar", `${input.type} de ${input.qty} un.`, null, m, isDemo);
    await touch();
  });
}

// ---------------------------------------------------------------- Metas
export async function saveGoal(rule: GoalRule) {
  const cur = await db.goals.get(rule.id);
  await db.goals.put({ ...rule, isDefault: false, updatedAt: now() });
  await audit("meta", rule.id, "editar", `Regra de ${rule.indicator} (${rule.period}) alterada`, cur, rule, false);
}

export async function resetGoals() {
  await db.transaction("rw", [db.goals], async () => {
    await db.goals.clear();
    await db.goals.bulkPut(defaultGoalRules(now()));
  });
}

// ---------------------------------------------------------------- Importação
export interface CommitResult {
  batch: ImportBatch;
  createdEstablishments: number;
  reusedEstablishments: number;
  routesCreated: number;
  stopsCreated: number;
  stopsSkipped: number;
  invalid: number;
}

export async function commitImport(fileName: string, rows: ParsedRow[], routes: RoutePreview[], opts: { createRoutes: boolean }): Promise<CommitResult> {
  return db.transaction("rw", [db.establishments, db.routes, db.stops, db.importBatches, db.audit, db.settings], async () => {
    const batchId = uid();
    const keyToId = new Map<string, ID>();
    let created = 0, reused = 0, routesCreated = 0, stopsCreated = 0, stopsSkipped = 0;
    const invalid = rows.filter((r) => r.status === "invalido").length;
    for (const r of rows) {
      if (r.status === "invalido") continue;
      if (keyToId.has(r.key)) continue;
      const existing = await findEstablishmentByKey(r.key, false);
      if (existing) { keyToId.set(r.key, existing.id); reused++; continue; }
      const e = newEstablishment({
        name: r.name, category: r.category, segment: r.segment, address: r.address, bairro: r.bairro, city: r.city, region: r.region,
        phone: r.phone, googleRating: r.rating, googleReviews: r.reviews, ratingVerified: false, otherRating: r.otherRating,
        hours: r.hours, hoursVerified: false, mapsUrl: r.mapsUrl, priority: r.priority, priorityReason: r.reason,
        evidence: r.evidence, sources: r.sources, notes: r.notes, responsible: r.responsible, origin: "importado", importBatchId: batchId,
      }, false);
      await db.establishments.add(e);
      keyToId.set(r.key, e.id);
      created++;
    }
    if (opts.createRoutes) {
      for (const rp of routes) {
        let route = rp.date
          ? (await db.routes.where("date").equals(rp.date).toArray()).find((x) => !x.deletedAt && !x.isDemo && x.name === rp.name)
          : undefined;
        if (!route) {
          route = { ...base(false), name: rp.name, date: rp.date ?? new Date().toISOString().slice(0, 10), region: rp.region, notes: `Importado de ${fileName}`, workStart: null, workEnd: null, manualHours: null, importBatchId: batchId };
          await db.routes.add(route);
          routesCreated++;
        }
        const existingStops = (await db.stops.where("routeId").equals(route.id).toArray()).filter((s) => !s.deletedAt);
        const have = new Set(existingStops.map((s) => s.establishmentId));
        let nextOrder = existingStops.reduce((a, s) => Math.max(a, s.order), 0);
        const routeRows = rows.filter((r) => r.status !== "invalido" && r.dayRaw === rp.key).sort((a, b) => (a.order ?? 9999) - (b.order ?? 9999));
        for (const r of routeRows) {
          const eid = keyToId.get(r.key);
          if (!eid || have.has(eid)) { stopsSkipped++; continue; }
          have.add(eid);
          nextOrder += 1;
          await db.stops.add(newStop(route.id, eid, nextOrder, false, {
            legDistance: r.legDistance, legTime: r.legTime, plannedTime: r.planned, approachTime: r.approach, window: r.window, notes: r.notes,
          }));
          stopsCreated++;
        }
      }
    }
    const batch: ImportBatch = {
      id: batchId, at: now(), fileName, imported: created, existing: reused,
      skipped: rows.filter((r) => r.status === "duplicado_no_arquivo").length + stopsSkipped, invalid, routes: routesCreated, stops: stopsCreated,
      details: rows.filter((r) => r.status === "invalido").map((r) => `Linha ${r.line}: ${r.errors.join(", ")}`),
    };
    await db.importBatches.add(batch);
    await audit("importacao", batchId, "importar", `${fileName}: ${created} novos, ${reused} já existentes, ${invalid} inválidos, ${stopsCreated} paradas`, null, batch, false);
    await touch();
    return { batch, createdEstablishments: created, reusedEstablishments: reused, routesCreated, stopsCreated, stopsSkipped, invalid };
  });
}
