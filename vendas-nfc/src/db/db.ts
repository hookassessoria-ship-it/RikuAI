import Dexie, { type Table } from "dexie";
import type {
  Establishment, Route, Stop, Visit, Sale, Payment, Expense, Product, CostProfile, StockLot, StockMove,
  GoalRule, Settings, AuditEntry, ImportBatch,
} from "./types";

/**
 * Banco local (IndexedDB via Dexie). Os dados persistem no navegador do aparelho,
 * sobrevivem a recarregar/fechar a página e funcionam sem internet.
 * Não há sincronização com nuvem: use Configurações › Backup para copiar entre aparelhos.
 */
export class AppDB extends Dexie {
  establishments!: Table<Establishment, string>;
  routes!: Table<Route, string>;
  stops!: Table<Stop, string>;
  visits!: Table<Visit, string>;
  sales!: Table<Sale, string>;
  payments!: Table<Payment, string>;
  expenses!: Table<Expense, string>;
  products!: Table<Product, string>;
  costProfiles!: Table<CostProfile, string>;
  stockLots!: Table<StockLot, string>;
  stockMoves!: Table<StockMove, string>;
  goals!: Table<GoalRule, string>;
  settings!: Table<Settings, string>;
  audit!: Table<AuditEntry, string>;
  importBatches!: Table<ImportBatch, string>;

  constructor(name = "vendas-nfc") {
    super(name);
    this.version(1).stores({
      establishments: "id, dedupeKey, isDemo, region, segment",
      routes: "id, date, isDemo",
      stops: "id, routeId, establishmentId, isDemo",
      visits: "id, establishmentId, stopId, routeId, at, isDemo",
      sales: "id, establishmentId, at, isDemo, status, clientRequestId",
      payments: "id, saleId, at, isDemo",
      expenses: "id, at, category, routeId, saleId, isDemo",
      products: "id",
      costProfiles: "id, productId, validFrom, isDemo",
      stockLots: "id, productId, at, isDemo",
      stockMoves: "id, productId, at, isDemo",
      goals: "id, indicator, period",
      settings: "id",
      audit: "id, entity, entityId, at",
      importBatches: "id, at",
    });
  }
}

export let db = new AppDB();

/** Apenas para testes: troca a instância (simula recarregar a página). */
export function setDatabase(instance: AppDB) {
  db = instance;
}
