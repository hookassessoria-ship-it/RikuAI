import { useEffect, useMemo, useState } from "react";
import { Receipt, Plus, Trash2, Package, Calculator, Car, PiggyBank, CheckCircle2, AlertTriangle, Layers } from "lucide-react";
import { toast } from "sonner";
import type { AppData } from "@/hooks/useData";
import type { CostComponent, Expense, Settings, StockMove } from "@/db/types";
import { EXPENSE_CATEGORIES, TRANSPORT_CATEGORIES } from "@/db/types";
import {
  addLot, addStockMove, applyPendingCosts, applyPendingFees, confirmExpensePaid, deleteExpense, saveCostProfile, updateLot,
  updateSettings, ValidationError, DEFAULT_COMPONENTS,
} from "@/db/actions";
import { aggregate, type Dataset } from "@/lib/finance/engine";
import { suggestUnitCost, stockSummary, lotUnitCost, profileAt } from "@/lib/finance/costs";
import { transportBudget } from "@/lib/finance/transport";
import { simulate, discountTable } from "@/lib/finance/simulator";
import { evaluate, findRule, indicatorByKey } from "@/lib/finance/goals";
import { formatBRL, formatPct, type Cents } from "@/lib/money";
import { dayKey, fmtDate, periodRange } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { go } from "@/hooks/useHashRoute";
import { usePeriod } from "@/hooks/usePeriod";
import { useUI } from "@/components/UIProvider";
import { PeriodPicker } from "./Overview";
import { MetricValue } from "@/components/Kpi";
import { Badge, Button, Card, Chips, Confirm, EmptyState, Field, Input, LightBadge, MoneyInput, NumberInput, Progress, Sheet, Stat, Toggle } from "@/components/ui";

const TABS = [
  { value: "resumo", label: "Resumo" },
  { value: "despesas", label: "Despesas" },
  { value: "custos", label: "Custos" },
  { value: "estoque", label: "Estoque" },
  { value: "transporte", label: "Transporte" },
  { value: "simulador", label: "Simulador" },
] as const;
type Tab = (typeof TABS)[number]["value"];

export function FinancePage({ tab, data, ds, settings, isDemo }: { tab?: string; data: AppData; ds: Dataset; settings: Settings; isDemo: boolean }) {
  const t = (TABS.find((x) => x.value === tab)?.value ?? "resumo") as Tab;
  return (
    <div className="space-y-4">
      <div className="no-scrollbar -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <Chips className="flex-nowrap" size="sm" options={TABS.map((x) => ({ value: x.value, label: x.label }))} value={t} onChange={(v) => go(`financas/${v}`)} />
      </div>
      {t === "resumo" && <Summary ds={ds} />}
      {t === "despesas" && <Expenses data={data} />}
      {t === "custos" && <Costs data={data} settings={settings} isDemo={isDemo} />}
      {t === "estoque" && <Stock data={data} isDemo={isDemo} />}
      {t === "transporte" && <Transport data={data} ds={ds} settings={settings} />}
      {t === "simulador" && <Simulator data={data} settings={settings} />}
    </div>
  );
}

// ---------------------------------------------------------------- Resumo (DRE gerencial)
function Summary({ ds }: { ds: Dataset }) {
  const [period, setPeriod] = usePeriod("semana");
  const s = useMemo(() => aggregate(ds, periodRange(period)), [ds, period]);
  const L = ({ k, v, strong, neg, sub }: { k: string; v: React.ReactNode; strong?: boolean; neg?: boolean; sub?: string }) => (
    <div className={cn("flex items-start justify-between gap-3 py-2", strong && "border-t border-border font-bold")}>
      <span className={cn(!strong && "text-muted")}>{k}{sub && <span className="block text-[11px] font-normal text-subtle">{sub}</span>}</span>
      <span className={cn("tabular", neg && "text-muted")}>{v}</span>
    </div>
  );
  return (
    <div className="space-y-4">
      <PeriodPicker value={period} onChange={setPeriod} />
      <Card title="Demonstrativo de resultado (gerencial)" subtitle="Base de competência: receita na entrega, custos e despesas na data em que ocorrem.">
        <div className="text-sm">
          <L k="Receita bruta" v={formatBRL(s.gross)} sub={`${s.ordersRecognized} pedido(s), ${s.unitsSold} placa(s)`} />
          <L k="(−) Descontos" v={formatBRL(-s.discounts)} neg />
          <L k="(−) Estornos" v={formatBRL(-s.refunds)} neg />
          <L strong k="Receita líquida" v={formatBRL(s.net)} />
          <L k="(−) Custo das placas vendidas (CPV)" neg v={s.cogs.state === "pendente" ? <Badge tone="warn">pendente ({s.costPendingSales} venda(s) sem custo)</Badge> : formatBRL(s.cogs.value == null ? 0 : -s.cogs.value)} />
          <L strong k="Margem bruta" v={<span>{s.grossMargin.state === "pendente" ? "Pendente" : formatBRL(s.grossMargin.value)} <span className="text-xs font-normal text-muted">{s.grossMarginPct.state === "ok" ? formatPct(s.grossMarginPct.value) : ""}</span></span>} />
          <L k="(−) Taxas de pagamento" v={formatBRL(-s.fees)} neg sub={s.feePendingSales ? `${s.feePendingSales} venda(s) com taxa não informada` : undefined} />
          <L k="(−) Comissões e tributos variáveis" v={formatBRL(-(s.commission + s.tax))} neg />
          <L k="(−) Outros custos por pedido" v={formatBRL(-s.otherVariable)} neg />
          <L k="(−) Transporte vinculado a vendas" v={formatBRL(-s.transportLinked)} neg />
          <L strong k="Margem de contribuição" v={<span>{s.contribution.state === "pendente" ? "Pendente" : formatBRL(s.contribution.value)} <span className="text-xs font-normal text-muted">{s.contributionPct.state !== "sem_dados" && s.contributionPct.state !== "pendente" ? formatPct(s.contributionPct.value) : ""}</span></span>} />
          <L k="(−) Despesas operacionais pagas" v={formatBRL(-s.opExpenses)} neg sub={s.plannedExpenses ? `Previstas (fora do resultado): ${formatBRL(s.plannedExpenses)}` : undefined} />
          <L strong k="Resultado operacional estimado" v={<MetricValue m={s.opResult} f="brl" size="md" />} sub="Não é lucro líquido contábil nem após impostos." />
        </div>
        {s.costPendingSales > 0 && <p className="mt-2 rounded-xl bg-warn-soft px-3 py-2 text-xs text-warn">{s.costPendingSales} venda(s) sem custo unitário: margens e resultado estão incompletos. <button className="underline" onClick={() => go("financas/custos")}>Informar custo</button></p>}
      </Card>
      <Card title="Caixa do período" subtitle="Dinheiro que entrou e saiu (inclui compras de estoque).">
        <div className="text-sm">
          <L k="Recebimentos" v={formatBRL(s.received)} />
          <L k="(−) Compras de estoque" v={formatBRL(-s.stockPurchases)} neg sub="Não é despesa: vira CPV quando a placa é vendida." />
          <L k="(−) Despesas pagas" v={formatBRL(-s.expensesPaid)} neg />
          <L strong k="Saldo de caixa do período" v={<span className={cn(s.cashResult < 0 && "text-bad")}>{formatBRL(s.cashResult)}</span>} />
          <L k="A receber (todas as vendas)" v={formatBRL(s.receivables)} />
        </div>
      </Card>
      <div className="grid grid-cols-2 gap-3">
        <Card title="Ponto de equilíbrio"><MetricValue m={s.breakEvenRevenue} f="brl" size="md" /><p className="mt-1 text-xs text-subtle">{s.breakEvenRevenue.reason ?? `≈ ${s.breakEvenUnits.value ?? "—"} placas. Despesas operacionais do período ÷ margem de contribuição %.`}</p></Card>
        <Card title="CAC simplificado"><MetricValue m={s.cac} f="brl" size="md" /><p className="mt-1 text-xs text-subtle">{s.cac.reason ?? `${formatBRL(s.commercialExpenses)} em despesas comerciais (Uber, transporte, alimentação em campo, materiais de demonstração, marketing) ÷ ${s.newCustomers} cliente(s) novo(s).`}</p></Card>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Despesas
function Expenses({ data }: { data: AppData }) {
  const ui = useUI();
  const [del, setDel] = useState<Expense | null>(null);
  const [pay, setPay] = useState<Expense | null>(null);
  const list = [...data.expenses].sort((a, b) => b.at.localeCompare(a.at) || b.createdAt.localeCompare(a.createdAt));
  const routeName = (id: string | null) => data.routes.find((r) => r.id === id)?.name;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={() => ui.openExpense()}><Plus className="h-4 w-4" />Nova despesa</Button>
        <Button onClick={() => ui.openExpense({ category: "uber", status: "previsto" })}>Prever Uber</Button>
      </div>
      <p className="px-1 text-xs text-subtle">Compras de placas e embalagens em quantidade vão em <button className="underline" onClick={() => go("financas/estoque")}>Estoque</button> para não descontar o custo duas vezes.</p>
      {list.length === 0 ? <Card><EmptyState icon={Receipt} title="Nenhuma despesa registrada">Registre Uber, alimentação em campo, materiais de demonstração e outras despesas. Cada uma pode ser ligada a uma rota.</EmptyState></Card> : (
        <div className="space-y-2">
          {list.map((e) => (
            <div key={e.id} className="card flex items-center gap-3 p-3">
              <div className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-xl", e.status === "previsto" ? "bg-warn-soft text-warn" : "bg-primary-soft text-primary")}>{TRANSPORT_CATEGORIES.includes(e.category) ? <Car className="h-5 w-5" /> : <Receipt className="h-5 w-5" />}</div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">{EXPENSE_CATEGORIES[e.category]}{e.description && <span className="font-normal text-muted"> · {e.description}</span>}</div>
                <div className="truncate text-xs text-subtle">{fmtDate(e.at)}{routeName(e.routeId) && ` · ${routeName(e.routeId)}`}{e.saleId && " · vinculada a venda"}{e.estimate != null && e.status === "pago" && ` · estimado ${formatBRL(e.estimate)}`}</div>
              </div>
              <div className="text-right">
                <div className="font-bold tabular">{formatBRL(e.amount)}</div>
                {e.status === "previsto" ? <button className="text-xs font-semibold text-primary" onClick={() => setPay(e)}>Confirmar pago</button> : <Badge tone="ok">Pago</Badge>}
              </div>
              <button aria-label="Excluir despesa" className="press grid h-9 w-9 place-items-center rounded-lg text-subtle hover:text-bad" onClick={() => setDel(e)}><Trash2 className="h-4 w-4" /></button>
            </div>
          ))}
        </div>
      )}
      <Confirm open={!!del} onClose={() => setDel(null)} danger title="Excluir despesa?" confirmLabel="Excluir" message="A exclusão fica registrada no histórico de alterações." onConfirm={async () => { if (del) await deleteExpense(del.id); setDel(null); toast.success("Despesa excluída"); }} />
      {pay && <ConfirmPaidSheet expense={pay} onClose={() => setPay(null)} />}
    </div>
  );
}

function ConfirmPaidSheet({ expense, onClose }: { expense: Expense; onClose: () => void }) {
  const [v, setV] = useState<Cents | null>(expense.amount);
  const [at, setAt] = useState(expense.at);
  return (
    <Sheet open onClose={onClose} title="Valor efetivamente pago" subtitle={`Estimativa: ${formatBRL(expense.amount)}`}
      footer={<Button variant="primary" size="lg" className="w-full" onClick={async () => { try { await confirmExpensePaid(expense.id, v ?? 0, at); toast.success("Pagamento confirmado"); onClose(); } catch (e) { toast.error(e instanceof Error ? e.message : "Erro"); } }}>Confirmar</Button>}>
      <div className="space-y-4">
        <Field label="Valor pago"><MoneyInput value={v} onChange={setV} /></Field>
        <Field label="Data"><Input type="date" value={at} onChange={(e) => setAt(e.target.value)} /></Field>
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------- Custos
function Costs({ data, settings, isDemo }: { data: AppData; settings: Settings; isDemo: boolean }) {
  const today = dayKey(new Date());
  const current = profileAt(data.costProfiles, today);
  const [validFrom, setValidFrom] = useState(today);
  const [useLots, setUseLots] = useState(current?.useLotAverage ?? true);
  const [comps, setComps] = useState<CostComponent[]>(current?.components ?? DEFAULT_COMPONENTS);
  useEffect(() => { if (current) { setComps(current.components); setUseLots(current.useLotAverage); } }, [current?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const sug = suggestUnitCost(data.costProfiles, data.stockLots, today);
  const pendingCost = data.sales.filter((s) => s.status === "ativa" && s.items.some((i) => i.unitCost == null)).length;
  const pendingFee = data.sales.filter((s) => s.status === "ativa" && s.feePct == null).length;
  const [methods, setMethods] = useState(settings.paymentMethods);
  const [newMethod, setNewMethod] = useState("");
  useEffect(() => setMethods(settings.paymentMethods), [settings.paymentMethods]);
  const save = async () => {
    await saveCostProfile({ validFrom, useLotAverage: useLots, components: comps }, isDemo);
    toast.success("Nova configuração de custo salva", { description: `Vale a partir de ${fmtDate(validFrom)}. Vendas antigas mantêm o custo aplicado.` });
  };
  return (
    <div className="space-y-4">
      <Card title="Custo unitário vigente" subtitle="Usado como sugestão editável em cada venda.">
        <div className="flex items-center gap-3">
          {sug.unitCost == null ? <AlertTriangle className="h-6 w-6 text-warn" /> : <CheckCircle2 className="h-6 w-6 text-ok" />}
          <div>
            <div className="text-2xl font-extrabold tabular">{sug.unitCost == null ? "Pendente" : formatBRL(sug.unitCost)}</div>
            <div className="text-xs text-muted">{sug.explanation}</div>
          </div>
        </div>
        {(pendingCost > 0 || pendingFee > 0) && (
          <div className="mt-3 flex flex-wrap gap-2">
            {pendingCost > 0 && <Button size="sm" variant="soft" disabled={sug.unitCost == null} onClick={async () => { const n = await applyPendingCosts(isDemo); toast.success(`Custo aplicado a ${n} venda(s)`); }}>Aplicar custo a {pendingCost} venda(s) pendente(s)</Button>}
            {pendingFee > 0 && <Button size="sm" variant="soft" onClick={async () => { const n = await applyPendingFees(isDemo); toast.success(n ? `Taxa aplicada a ${n} venda(s)` : "Informe a taxa do meio de pagamento abaixo primeiro"); }}>Aplicar taxas a {pendingFee} venda(s)</Button>}
          </div>
        )}
      </Card>

      <Card title="Componentes do custo por placa" subtitle="Cada alteração cria uma nova versão com data de início (histórico preservado).">
        <div className="space-y-3">
          <Toggle checked={useLots} onChange={setUseLots} label="Custo da placa = média ponderada dos lotes de estoque" hint="Quando houver lotes com valor pago. Senão, usa o valor manual abaixo." />
          {comps.map((c, i) => (
            <Field key={c.key} label={c.label} hint={c.key === "placa" ? "Obrigatório para calcular margens e lucro." : "Opcional. Vazio = não informado (considerado R$ 0)."}>
              <MoneyInput value={c.amount} onChange={(v) => setComps(comps.map((x, j) => (j === i ? { ...x, amount: v } : x)))} placeholder={c.key === "placa" ? "pendente" : "não informado"} />
            </Field>
          ))}
          <Field label="Válido a partir de"><Input type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} /></Field>
          <Button variant="primary" className="w-full" onClick={save}>Salvar nova versão de custo</Button>
        </div>
        {data.costProfiles.length > 0 && (
          <div className="mt-4 space-y-1 text-xs text-muted">
            <div className="font-semibold text-foreground">Versões</div>
            {[...data.costProfiles].sort((a, b) => b.validFrom.localeCompare(a.validFrom) || b.createdAt.localeCompare(a.createdAt)).map((p) => (
              <div key={p.id} className="flex justify-between rounded-lg bg-surface-raised px-3 py-1.5">
                <span>desde {p.validFrom === "2000-01-01" ? "o início" : fmtDate(p.validFrom)}{p.useLotAverage ? " · média dos lotes" : ""}</span>
                <span className="tabular">{p.components.map((c) => (c.amount == null ? "—" : formatBRL(c.amount))).join(" + ")}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title="Taxas por forma de pagamento" subtitle="Vazio = não informado (a contribuição fica marcada como incompleta).">
        <div className="space-y-3">
          {methods.map((m, i) => (
            <div key={m.id} className="grid grid-cols-[1fr_96px_110px] items-end gap-2">
              <Field label={m.label}><Toggle checked={m.active} onChange={(v) => setMethods(methods.map((x, j) => (j === i ? { ...x, active: v } : x)))} label={m.active ? "Ativa" : "Inativa"} /></Field>
              <Field label="%"><NumberInput value={m.feePct} allowEmpty onChange={(v) => setMethods(methods.map((x, j) => (j === i ? { ...x, feePct: v } : x)))} placeholder="—" /></Field>
              <Field label="Fixa"><MoneyInput value={m.feeFixed} allowEmpty={false} onChange={(v) => setMethods(methods.map((x, j) => (j === i ? { ...x, feeFixed: v ?? 0 } : x)))} /></Field>
            </div>
          ))}
          <div className="flex gap-2">
            <Input value={newMethod} onChange={(e) => setNewMethod(e.target.value)} placeholder="Nova forma (ex.: Link de pagamento)" />
            <Button onClick={() => { if (!newMethod.trim()) return; setMethods([...methods, { id: `m-${Date.now()}`, label: newMethod.trim(), feePct: null, feeFixed: 0, active: true }]); setNewMethod(""); }}>Adicionar</Button>
          </div>
          <Button variant="primary" className="w-full" onClick={async () => { await updateSettings({ paymentMethods: methods }, "Taxas/formas de pagamento alteradas"); toast.success("Formas de pagamento salvas"); }}>Salvar formas e taxas</Button>
        </div>
      </Card>

      <Card title="Comissão e tributos variáveis (padrão das novas vendas)">
        <DefaultsForm settings={settings} />
      </Card>
    </div>
  );
}

function DefaultsForm({ settings }: { settings: Settings }) {
  const [c, setC] = useState<number | null>(settings.commissionPct);
  const [t, setT] = useState<number | null>(settings.taxPct);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Comissão (%)" hint="0 = não aplicável"><NumberInput value={c} onChange={setC} suffix="%" /></Field>
        <Field label="Tributos variáveis (%)" hint="0 = não aplicável (ex.: MEI com DAS fixo)"><NumberInput value={t} onChange={setT} suffix="%" /></Field>
      </div>
      <Button className="w-full" onClick={async () => { await updateSettings({ commissionPct: c ?? 0, taxPct: t ?? 0 }, "Comissão/tributos padrão alterados"); toast.success("Padrões salvos"); }}>Salvar</Button>
    </div>
  );
}

// ---------------------------------------------------------------- Estoque
function Stock({ data, isDemo }: { data: AppData; isDemo: boolean }) {
  const st = stockSummary(data.stockLots, data.stockMoves, data.sales);
  const [lotOpen, setLotOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Saldo atual" value={`${st.balance} un.`} tone={st.balance < 0 ? "bad" : st.balance <= 5 ? "warn" : "ok"} sub={st.reserved ? `${st.available} disponíveis · ${st.reserved} reservadas` : "disponíveis"} />
        <Stat label="Custo médio" value={st.avgCost == null ? "Pendente" : formatBRL(st.avgCost)} sub={st.lotsWithoutCost ? `${st.lotsWithoutCost} lote(s) sem custo` : "por placa"} />
        <Stat label="Valor em estoque" value={st.stockValue == null ? "—" : formatBRL(st.stockValue)} sub="saldo × custo médio" />
        <Stat label="Gasto em estoque" value={formatBRL(st.cashSpent)} sub="compras (saída de caixa)" />
      </div>
      <Card title="Movimentação">
        <div className="grid grid-cols-3 gap-2 text-center text-sm sm:grid-cols-6">
          {[["Inicial", st.initial], ["Entradas", st.entries], ["Vendidas", st.sold], ["Devolvidas", st.returnedToStock], ["Perdas", st.losses], ["Ajustes", st.adjustments]].map(([k, v]) => (
            <div key={k as string} className="rounded-xl bg-surface-raised py-2"><div className="text-lg font-extrabold tabular">{v}</div><div className="text-[11px] text-subtle">{k}</div></div>
          ))}
        </div>
        <p className="mt-3 text-xs text-subtle">Saldo = inicial + entradas − vendidas + devolvidas ao estoque − perdas ± ajustes. As vendas baixam o estoque automaticamente.</p>
      </Card>
      {st.balance < 0 && <p className="rounded-xl bg-bad-soft px-3 py-2 text-sm text-bad">Saldo negativo: registre a quantidade inicial ou os lotes comprados.</p>}
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={() => setLotOpen(true)}><Package className="h-4 w-4" />Registrar lote / estoque inicial</Button>
        <Button onClick={() => setMoveOpen(true)}><Layers className="h-4 w-4" />Perda, ajuste ou reserva</Button>
      </div>
      {data.stockLots.length === 0 ? <Card><EmptyState icon={Package} title="Nenhum lote cadastrado">Informe quantas placas você tem hoje (estoque inicial) e, se souber, quanto pagou. Lotes com valor pago calculam o custo médio por placa automaticamente.</EmptyState></Card> : (
        <Card title="Lotes">
          <div className="space-y-2">
            {[...data.stockLots].sort((a, b) => b.at.localeCompare(a.at)).map((l) => (
              <div key={l.id} className="flex items-center gap-3 rounded-xl bg-surface-raised px-3 py-2 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">{l.qty} un. {l.isInitial && <Badge tone="primary">inicial</Badge>}</div>
                  <div className="text-xs text-subtle">{fmtDate(l.at)}{l.supplier && ` · ${l.supplier}`}</div>
                </div>
                <div className="text-right text-xs">
                  <div className="font-bold tabular">{l.totalPaid == null ? "custo não informado" : formatBRL(l.totalPaid + l.freight)}</div>
                  <div className="text-subtle">{lotUnitCost(l) == null ? "—" : `${formatBRL(lotUnitCost(l))}/un.`}</div>
                </div>
                <button aria-label="Excluir lote" className="press grid h-9 w-9 place-items-center rounded-lg text-subtle hover:text-bad" onClick={() => updateLot(l.id, { deletedAt: new Date().toISOString() }).then(() => toast.success("Lote excluído"))}><Trash2 className="h-4 w-4" /></button>
              </div>
            ))}
          </div>
        </Card>
      )}
      {data.stockMoves.length > 0 && (
        <Card title="Perdas, ajustes e reservas">
          {[...data.stockMoves].sort((a, b) => b.at.localeCompare(a.at)).map((m) => (
            <div key={m.id} className="flex justify-between py-1 text-sm"><span className="text-muted">{fmtDate(m.at)} · {m.type}{m.reason && ` · ${m.reason}`}</span><span className="tabular">{m.qty}</span></div>
          ))}
        </Card>
      )}
      <LotSheet open={lotOpen} onClose={() => setLotOpen(false)} isDemo={isDemo} first={data.stockLots.length === 0} />
      <MoveSheet open={moveOpen} onClose={() => setMoveOpen(false)} isDemo={isDemo} />
    </div>
  );
}

function LotSheet({ open, onClose, isDemo, first }: { open: boolean; onClose: () => void; isDemo: boolean; first: boolean }) {
  const [qty, setQty] = useState<number | null>(null);
  const [paid, setPaid] = useState<Cents | null>(null);
  const [freight, setFreight] = useState<Cents | null>(null);
  const [at, setAt] = useState(dayKey(new Date()));
  const [supplier, setSupplier] = useState("");
  const [initial, setInitial] = useState(first);
  useEffect(() => { if (open) { setQty(null); setPaid(null); setFreight(null); setAt(dayKey(new Date())); setSupplier(""); setInitial(first); } }, [open, first]);
  const unit = qty && paid != null ? Math.round((paid + (freight ?? 0)) / qty) : null;
  return (
    <Sheet open={open} onClose={onClose} title="Registrar lote de placas"
      footer={<Button variant="primary" size="lg" className="w-full" onClick={async () => { try { await addLot({ at, qty: qty ?? 0, totalPaid: paid, freight: freight ?? 0, supplier, isInitial: initial }, isDemo); toast.success("Lote registrado"); onClose(); } catch (e) { toast.error(e instanceof ValidationError ? e.message : "Erro"); } }}>Salvar lote</Button>}>
      <div className="space-y-4">
        <Field label="Quantidade de placas"><NumberInput value={qty} onChange={(v) => setQty(v == null ? null : Math.round(v))} suffix="un." allowEmpty /></Field>
        <Field label="Valor total pago pelas placas" hint="Deixe vazio se ainda não souber (o custo fica pendente)."><MoneyInput value={paid} onChange={setPaid} placeholder="não informado" /></Field>
        <Field label="Frete de aquisição"><MoneyInput value={freight} onChange={setFreight} /></Field>
        {unit != null && <p className="rounded-xl bg-primary-soft px-3 py-2 text-sm text-primary">Custo por placa deste lote: <strong>{formatBRL(unit)}</strong></p>}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Data"><Input type="date" value={at} onChange={(e) => setAt(e.target.value)} /></Field>
          <Field label="Fornecedor"><Input value={supplier} onChange={(e) => setSupplier(e.target.value)} /></Field>
        </div>
        <Toggle checked={initial} onChange={setInitial} label="É o estoque inicial" hint="Estoque que você já tinha: entra no saldo e no custo médio, mas não conta como compra no caixa do período." />
      </div>
    </Sheet>
  );
}

function MoveSheet({ open, onClose, isDemo }: { open: boolean; onClose: () => void; isDemo: boolean }) {
  const [type, setType] = useState<StockMove["type"]>("perda");
  const [qty, setQty] = useState<number | null>(1);
  const [reason, setReason] = useState("");
  return (
    <Sheet open={open} onClose={onClose} title="Movimentar estoque"
      footer={<Button variant="primary" size="lg" className="w-full" onClick={async () => { try { await addStockMove({ type, qty: Math.round(qty ?? 0), at: dayKey(new Date()), reason }, isDemo); toast.success("Movimentação registrada"); onClose(); } catch (e) { toast.error(e instanceof ValidationError ? e.message : "Erro"); } }}>Salvar</Button>}>
      <div className="space-y-4">
        <Field label="Tipo"><Chips size="sm" options={[{ value: "perda", label: "Perda/dano" }, { value: "ajuste", label: "Ajuste (±)" }, { value: "reserva", label: "Reservar" }, { value: "liberacao", label: "Liberar reserva" }]} value={type} onChange={setType} /></Field>
        <Field label="Quantidade" hint={type === "ajuste" ? "Use número negativo para reduzir." : undefined}><NumberInput value={qty} onChange={setQty} suffix="un." /></Field>
        <Field label="Motivo"><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------- Transporte
function Transport({ data, ds, settings }: { data: AppData; ds: Dataset; settings: Settings }) {
  const ui = useUI();
  const b = transportBudget(settings.uberBudget, data.expenses, data.routes, settings.transportBudgetSince ?? undefined);
  const [budget, setBudget] = useState<Cents | null>(settings.uberBudget);
  const [since, setSince] = useState(settings.transportBudgetSince ?? "");
  const all = aggregate(ds, periodRange("tudo"));
  const def = indicatorByKey("orcamento_transporte")!;
  const evb = evaluate(def, findRule(data.goals, "orcamento_transporte", "total"), { value: b.usedPct, state: b.usedPct == null ? "sem_dados" : "ok" });
  return (
    <div className="space-y-4">
      <Card title="Orçamento de transporte" action={<LightBadge light={evb.light} label={evb.label} />}>
        <div className="text-[30px] font-black tabular">{formatBRL(b.balance)} <span className="text-sm font-semibold text-muted">de saldo</span></div>
        <Progress className="mt-2" value={b.usedPct == null ? null : b.usedPct / 100} light={evb.light} label="Uso do orçamento" />
        <div className="mt-3 grid grid-cols-3 gap-2">
          <Stat label="Pago" value={formatBRL(b.paid)} sub="valor real" />
          <Stat label="Previsto" value={formatBRL(b.planned)} sub="estimativas" />
          <Stat label="Orçamento" value={formatBRL(b.budget)} sub={b.usedPct == null ? "—" : `${formatPct(b.usedPct, 0)} usado`} />
        </div>
        <p className="mt-2 text-xs text-subtle">{evb.rule}. Estimativas são valores digitados por você (não são cotações). {b.estimateDiff !== 0 && `Diferença pago − estimado: ${formatBRL(b.estimateDiff)}.`}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => ui.openExpense({ category: "uber", status: "previsto" })}><Plus className="h-4 w-4" />Prever corrida</Button>
          <Button onClick={() => ui.openExpense({ category: "uber", status: "pago" })}>Registrar corrida paga</Button>
        </div>
      </Card>
      <div className="grid grid-cols-2 gap-3">
        <Card title="Por visita"><MetricValue m={all.transportPerVisit} f="brl" size="md" /><p className="text-xs text-subtle">Transporte pago ÷ visitas realizadas</p></Card>
        <Card title="Por venda"><MetricValue m={all.transportPerSale} f="brl" size="md" /><p className="text-xs text-subtle">Transporte pago ÷ pedidos</p></Card>
      </div>
      <Card title="Por rota / dia">
        {b.byRoute.length === 0 ? <p className="text-sm text-subtle">Nenhum transporte registrado.</p> : b.byRoute.map((r) => (
          <div key={r.routeId ?? "none"} className="flex items-center justify-between border-b border-border py-2 text-sm last:border-0">
            <span className="min-w-0 truncate">{r.name}{r.date && <span className="text-xs text-subtle"> · {fmtDate(r.date)}</span>}</span>
            <span className="tabular text-muted">{formatBRL(r.paid)} pago · {formatBRL(r.planned)} prev.</span>
          </div>
        ))}
      </Card>
      <Card title="Ajustar orçamento" subtitle="Valor total disponível para Uber/transporte nesta operação.">
        <div className="space-y-3">
          <Field label="Orçamento total"><MoneyInput value={budget} onChange={setBudget} /></Field>
          <Field label="Contar despesas a partir de" hint="Para uma nova operação, informe a data de início. Vazio = todas as despesas de transporte."><Input type="date" value={since} onChange={(e) => setSince(e.target.value)} /></Field>
          <Button className="w-full" onClick={async () => { await updateSettings({ uberBudget: budget ?? 0, transportBudgetSince: since || null }, "Orçamento de transporte alterado"); toast.success("Orçamento salvo"); }}>Salvar</Button>
        </div>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- Simulador
export function Simulator({ data, settings }: { data: AppData; settings: Settings }) {
  const sug = suggestUnitCost(data.costProfiles, data.stockLots, dayKey(new Date()));
  const [price, setPrice] = useState<Cents | null>(settings.defaultPrice);
  const [cost, setCost] = useState<Cents | null>(sug.unitCost);
  const [fee, setFee] = useState<number | null>(0);
  const [feeFixed, setFeeFixed] = useState<Cents | null>(0);
  const [disc, setDisc] = useState<number | null>(0);
  const [qty, setQty] = useState<number | null>(30);
  const [transport, setTransport] = useState<Cents | null>(settings.uberBudget);
  const [fixed, setFixed] = useState<Cents | null>(0);
  const [target, setTarget] = useState<Cents | null>(100000);
  const [minPct, setMinPct] = useState<number | null>(40);
  const input = { price: price ?? 0, unitCost: cost, feePct: fee ?? 0, feeFixedPerOrder: feeFixed ?? 0, discountPct: disc ?? 0, qty: Math.max(1, Math.round(qty ?? 1)), transport: transport ?? 0, fixedCosts: fixed ?? 0, profitTarget: target ?? 0, minContributionPct: minPct ?? 0 };
  const r = simulate(input);
  const table = discountTable(input);
  return (
    <div className="space-y-4">
      <Card title="Premissas" subtitle="Altere qualquer valor: tudo é recalculado na hora. Nada é salvo.">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Preço por placa"><MoneyInput value={price} onChange={setPrice} /></Field>
          <Field label="Custo unitário" hint={sug.unitCost == null ? "Não informado ainda" : "Vigente"}><MoneyInput value={cost} onChange={setCost} placeholder="pendente" /></Field>
          <Field label="Taxas variáveis (%)"><NumberInput value={fee} onChange={setFee} suffix="%" /></Field>
          <Field label="Taxa fixa por pedido"><MoneyInput value={feeFixed} onChange={setFeeFixed} /></Field>
          <Field label="Desconto (%)"><NumberInput value={disc} onChange={setDisc} suffix="%" /></Field>
          <Field label="Placas vendidas"><NumberInput value={qty} onChange={setQty} suffix="un." /></Field>
          <Field label="Transporte do período"><MoneyInput value={transport} onChange={setTransport} /></Field>
          <Field label="Custos fixos do período"><MoneyInput value={fixed} onChange={setFixed} /></Field>
          <Field label="Meta de resultado"><MoneyInput value={target} onChange={setTarget} /></Field>
          <Field label="Contribuição mínima (%)"><NumberInput value={minPct} onChange={setMinPct} suffix="%" /></Field>
        </div>
      </Card>
      {r.alerts.length > 0 && (
        <div className="space-y-2">{r.alerts.map((a) => <p key={a} className={cn("rounded-xl px-3 py-2 text-sm", r.incomplete && a.includes("não informado") ? "bg-warn-soft text-warn" : "bg-bad-soft text-bad")}><AlertTriangle className="mr-1 inline h-4 w-4" />{a}</p>)}</div>
      )}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Stat label="Receita" value={formatBRL(r.revenue)} sub={`${input.qty} × ${formatBRL(r.netPrice)}`} />
        <Stat label="Contribuição/placa" value={formatBRL(r.contributionPerUnit)} tone={r.contributionPerUnit <= 0 ? "bad" : undefined} sub={r.incomplete ? "incompleta (sem custo)" : `custos variáveis ${formatBRL(r.variablePerUnit)}`} />
        <Stat label="Margem de contribuição" value={r.contributionPct == null ? "—" : formatPct(r.contributionPct)} tone={r.contributionPct != null && r.contributionPct < (minPct ?? 0) ? "warn" : undefined} />
        <Stat label="Contribuição do volume" value={formatBRL(r.orderContribution)} />
        <Stat label="Resultado estimado" value={formatBRL(r.periodResult)} tone={r.periodResult < 0 ? "bad" : "ok"} sub="após transporte e fixos" />
        <Stat label="Placas para a meta" value={r.unitsForTarget ?? "inalcançável"} sub={r.unitsForBreakEven != null ? `${r.unitsForBreakEven} para empatar` : undefined} />
      </div>
      <Card title="Efeito do desconto sobre a margem">
        <div className="space-y-1 text-sm">
          <div className="grid grid-cols-4 gap-2 text-[11px] font-bold uppercase text-subtle"><span>Desconto</span><span>Preço</span><span>Contrib./placa</span><span>Placas p/ meta</span></div>
          {table.map((t) => (
            <div key={t.discountPct} className={cn("grid grid-cols-4 gap-2 rounded-lg px-1 py-1.5 tabular", t.discountPct === (disc ?? 0) && "bg-primary-soft")}>
              <span>{t.discountPct}%</span><span>{formatBRL(t.netPrice)}</span>
              <span className={cn(t.contributionPct != null && t.contributionPct < (minPct ?? 0) && "text-warn", t.contributionPerUnit <= 0 && "text-bad")}>{formatBRL(t.contributionPerUnit)} {t.contributionPct != null && <span className="text-xs text-subtle">({formatPct(t.contributionPct, 0)})</span>}</span>
              <span>{t.unitsForTarget ?? "—"}</span>
            </div>
          ))}
        </div>
        {r.incomplete && <p className="mt-2 text-xs text-warn">Sem o custo da placa, a contribuição mostrada é só preço − taxas. Informe o custo para um resultado real.</p>}
      </Card>
      <p className="px-1 text-xs text-subtle"><Calculator className="mr-1 inline h-3.5 w-3.5" />Fórmulas: contribuição/placa = preço com desconto − custo − taxas; placas para a meta = (meta + fixos + transporte) ÷ contribuição/placa. <PiggyBank className="ml-1 inline h-3.5 w-3.5" /></p>
    </div>
  );
}
