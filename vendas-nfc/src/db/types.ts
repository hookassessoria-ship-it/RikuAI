import type { Cents } from "@/lib/money";

export type ID = string;

/** Campos comuns. `isDemo` separa dados demonstrativos dos reais; nunca são misturados. */
export interface BaseRow {
  id: ID;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  isDemo: boolean;
}

// ---------------------------------------------------------------- Prospecção
export const STOP_STATUSES = [
  "pendente",
  "a_caminho",
  "visitado",
  "ausente",
  "conversa",
  "interessado",
  "retornar",
  "venda",
  "sem_interesse",
  "fechado",
] as const;
export type StopStatus = (typeof STOP_STATUSES)[number];
export type VisitOutcome = Exclude<StopStatus, "pendente" | "a_caminho">;

export const STATUS_LABEL: Record<StopStatus, string> = {
  pendente: "Pendente",
  a_caminho: "A caminho",
  visitado: "Visitado",
  ausente: "Responsável ausente",
  conversa: "Conversa realizada",
  interessado: "Interessado",
  retornar: "Retornar depois",
  venda: "Venda fechada",
  sem_interesse: "Sem interesse",
  fechado: "Fechado / endereço incorreto",
};

/** Visitas efetivamente realizadas (entram no denominador da conversão). */
export const REALIZED_OUTCOMES: VisitOutcome[] = ["visitado", "ausente", "conversa", "interessado", "retornar", "venda", "sem_interesse"];
/** Desfechos em que, por padrão, houve conversa com o responsável. */
export const CONTACT_OUTCOMES: VisitOutcome[] = ["conversa", "interessado", "venda", "sem_interesse"];

export const LOSS_REASONS = [
  "Preço",
  "Não vê valor",
  "Já usa placa/QR de avaliação",
  "Sem autonomia para decidir",
  "Sem dinheiro agora",
  "Não usa/não liga para o Google",
  "Outro",
];

export interface Establishment extends BaseRow {
  name: string;
  category: string; // categoria original
  segment: string; // macro-segmento para análises
  address: string;
  bairro: string;
  city: string;
  region: string; // ex.: "Parque Amazônia · Goiânia"
  phone: string;
  /** Nota Google só é considerada verificada quando ratingVerified = true. */
  googleRating: number | null;
  googleReviews: number | null;
  ratingVerified: boolean;
  ratingCheckedAt: string | null;
  otherRating: string; // nota em outra fonte (não Google), sempre não confirmada
  hours: string;
  hoursVerified: boolean;
  hoursCheckedAt: string | null;
  mapsUrl: string;
  priority: number | null;
  priorityReason: string;
  evidence: string;
  sources: string;
  notes: string;
  responsible: string;
  origin: "importado" | "manual" | "demo";
  importBatchId: ID | null;
  dedupeKey: string;
}

export interface Route extends BaseRow {
  name: string;
  date: string; // YYYY-MM-DD
  region: string;
  notes: string;
  workStart: string | null;
  workEnd: string | null;
  manualHours: number | null;
  importBatchId: ID | null;
}

export interface Stop extends BaseRow {
  routeId: ID;
  establishmentId: ID;
  order: number;
  status: StopStatus;
  statusAt: string | null;
  /** Distância/tempo até esta parada a partir da anterior (texto importado). Nunca verificado sem API de rotas. */
  legDistance: string;
  legTime: string;
  legVerified: false;
  plannedTime: string;
  approachTime: string;
  window: string;
  followUpAt: string | null;
  notes: string;
  lossReason: string;
  lastVisitId: ID | null;
}

export interface Visit extends BaseRow {
  establishmentId: ID;
  routeId: ID | null;
  stopId: ID | null;
  at: string;
  outcome: VisitOutcome;
  contact: boolean;
  demo: boolean;
  lossReason: string;
  followUpAt: string | null;
  notes: string;
}

// ---------------------------------------------------------------- Vendas
export type PaymentStatus = "pendente" | "parcial" | "pago" | "estornado";
export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  pendente: "Pendente",
  parcial: "Parcial",
  pago: "Pago",
  estornado: "Estornado",
};

export interface SaleItem {
  productId: ID;
  qty: number;
  unitPrice: Cents;
  /** Custo unitário aplicado à venda (snapshot). null = custo pendente. */
  unitCost: Cents | null;
}

export interface Refund {
  at: string;
  amount: Cents; // receita estornada
  unitsReturned: number;
  returnedToStock: boolean;
  reason: string;
}

export interface Sale extends BaseRow {
  establishmentId: ID | null;
  customerName: string;
  at: string; // data/hora da venda (contratação)
  delivered: boolean;
  deliveredAt: string | null; // data de reconhecimento da receita
  items: SaleItem[];
  discount: Cents;
  paymentMethod: string;
  /** Taxa do meio de pagamento (snapshot). feePct null = taxa pendente. */
  feePct: number | null;
  feeFixed: Cents;
  commissionPct: number;
  taxPct: number;
  otherVariable: Cents;
  status: "ativa" | "cancelada";
  cancelReason: string;
  cancelledAt: string | null;
  refund: Refund | null;
  routeId: ID | null;
  stopId: ID | null;
  visitId: ID | null;
  origin: string;
  notes: string;
  clientRequestId: string; // idempotência: evita gravar o mesmo formulário duas vezes
}

export interface Payment extends BaseRow {
  saleId: ID;
  at: string;
  amount: Cents; // negativo = devolução de dinheiro (estorno)
  method: string;
  note: string;
}

// ---------------------------------------------------------------- Financeiro
export const EXPENSE_CATEGORIES = {
  uber: "Uber / app de transporte",
  transporte_publico: "Transporte público",
  alimentacao: "Alimentação em campo",
  materiais_demo: "Materiais de demonstração",
  marketing: "Marketing",
  ferramentas: "Ferramentas",
  outros: "Outras despesas",
} as const;
export type ExpenseCategory = keyof typeof EXPENSE_CATEGORIES;
export const TRANSPORT_CATEGORIES: ExpenseCategory[] = ["uber", "transporte_publico"];
/** Despesas que entram no CAC comercial simplificado. */
export const COMMERCIAL_CATEGORIES: ExpenseCategory[] = ["uber", "transporte_publico", "alimentacao", "materiais_demo", "marketing"];

export interface Expense extends BaseRow {
  at: string; // YYYY-MM-DD
  category: ExpenseCategory;
  amount: Cents;
  description: string;
  routeId: ID | null;
  saleId: ID | null; // vinculada a uma venda = custo variável daquela venda
  /** "previsto" = estimativa (não entra no resultado); "pago" = valor efetivamente pago. */
  status: "previsto" | "pago";
  estimate: Cents | null; // valor estimado original (para comparar com o pago)
}

export interface Product extends BaseRow {
  name: string;
  defaultPrice: Cents;
  active: boolean;
}

export interface CostComponent {
  key: "placa" | "embalagem" | "personalizacao" | "outros_unidade";
  label: string;
  amount: Cents | null; // null = não informado
}

export interface CostProfile extends BaseRow {
  productId: ID;
  validFrom: string; // YYYY-MM-DD
  /** true = custo da placa vem da média ponderada dos lotes de estoque com custo conhecido. */
  useLotAverage: boolean;
  components: CostComponent[];
  notes: string;
}

export interface StockLot extends BaseRow {
  productId: ID;
  at: string; // YYYY-MM-DD
  qty: number;
  totalPaid: Cents | null; // null = custo do lote não informado
  freight: Cents;
  supplier: string;
  notes: string;
  isInitial: boolean;
}

export interface StockMove extends BaseRow {
  productId: ID;
  at: string;
  type: "perda" | "ajuste" | "reserva" | "liberacao";
  qty: number; // ajuste pode ser negativo
  reason: string;
}

// ---------------------------------------------------------------- Metas / configurações
export type GoalPeriod = "dia" | "semana" | "mes" | "total";
export interface GoalRule {
  id: ID;
  indicator: string;
  period: GoalPeriod;
  target: number | null;
  green: number | null; // limite de atenção: a partir daqui é verde (ou até aqui, se menor é melhor)
  critical: number | null; // abaixo (ou acima, se menor é melhor) = vermelho
  enabled: boolean;
  isDefault: boolean;
  updatedAt: string;
}

export interface PaymentMethod {
  id: string;
  label: string;
  feePct: number | null; // null = não informado
  feeFixed: Cents;
  active: boolean;
}

export interface Settings {
  id: "app";
  defaultPrice: Cents;
  uberBudget: Cents;
  /** Considera despesas de transporte a partir desta data (null = todas). */
  transportBudgetSince?: string | null;
  paymentMethods: PaymentMethod[];
  commissionPct: number;
  taxPct: number;
  workWeekdays: number[]; // 0 = domingo
  minSample: number;
  viewMode: "real" | "demo";
  appearance: "dark" | "light";
  lastBackupAt: string | null;
  lastChangeAt: string | null;
  storagePersisted: boolean | null;
  onboardingDone: boolean;
}

export interface AuditEntry {
  id: ID;
  entity: string;
  entityId: ID;
  action: "criar" | "editar" | "cancelar" | "estornar" | "excluir" | "importar" | "pagamento";
  at: string;
  summary: string;
  before: unknown;
  after: unknown;
  isDemo: boolean;
}

export interface ImportBatch {
  id: ID;
  at: string;
  fileName: string;
  imported: number;
  existing: number;
  skipped: number;
  invalid: number;
  routes: number;
  stops: number;
  details: string[];
}
