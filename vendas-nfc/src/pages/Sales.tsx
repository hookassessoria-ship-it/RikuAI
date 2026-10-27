import { useMemo, useState, useEffect } from "react";
import { BadgeDollarSign, Plus, Undo2, Ban, Pencil, History, Wallet, Search } from "lucide-react";
import { toast } from "sonner";
import { useLiveQuery } from "dexie-react-hooks";
import type { AppData } from "@/hooks/useData";
import type { Sale, Settings } from "@/db/types";
import { PAYMENT_STATUS_LABEL } from "@/db/types";
import { db } from "@/db/db";
import { addPayment, cancelSale, refundSale, updateSale, ValidationError } from "@/db/actions";
import { calcSale, linkedTransportBySale, aggregate } from "@/lib/finance/engine";
import { formatBRL, formatPct } from "@/lib/money";
import { dayKey, fmtDate, fmtDateTime, fmtLong, fmtTime, toLocalInput, fromLocalInput, periodRange } from "@/lib/dates";
import { cn, groupBy, norm } from "@/lib/utils";
import { useUI } from "@/components/UIProvider";
import { usePeriod } from "@/hooks/usePeriod";
import { PeriodPicker } from "./Overview";
import { Badge, Button, Card, Chips, Confirm, EmptyState, Field, Input, MoneyInput, NumberInput, Select, Sheet, Stat, Stepper, Textarea, Toggle } from "@/components/ui";

const payTone = { pendente: "warn", parcial: "warn", pago: "ok", estornado: "bad" } as const;

export function SalesPage({ data, settings }: { data: AppData; settings: Settings }) {
  const ui = useUI();
  const [period, setPeriod] = usePeriod("semana");
  const [filter, setFilter] = useState<"todas" | "pendente" | "parcial" | "pago" | "estornado" | "cancelada">("todas");
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const range = periodRange(period);
  const linked = useMemo(() => linkedTransportBySale(data.expenses), [data.expenses]);
  const paysBySale = useMemo(() => groupBy(data.payments, (p) => p.saleId), [data.payments]);
  const rows = useMemo(() => {
    return data.sales
      .filter((s) => new Date(s.at) >= range.start && new Date(s.at) < range.end)
      .map((s) => ({ s, c: calcSale(s, paysBySale.get(s.id) ?? [], linked.get(s.id) ?? 0) }))
      .filter(({ s, c }) => (filter === "todas" ? true : filter === "cancelada" ? s.status === "cancelada" : s.status === "ativa" && c.paymentStatus === filter))
      .filter(({ s }) => !q || norm(`${s.customerName} ${s.notes}`).includes(norm(q)))
      .sort((a, b) => b.s.at.localeCompare(a.s.at));
  }, [data.sales, range.start, range.end, filter, q, paysBySale, linked]);
  const sum = useMemo(() => aggregate({ sales: data.sales, payments: data.payments, expenses: data.expenses, visits: data.visits, routes: data.routes, stockLots: data.stockLots }, range), [data, range]);
  const byDay = groupBy(rows, (r) => dayKey(r.s.at));
  const open = data.sales.find((s) => s.id === openId);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" size="lg" onClick={() => ui.openSale()}><Plus className="h-5 w-5" />Registrar venda</Button>
      </div>
      <PeriodPicker value={period} onChange={setPeriod} />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Contratado" value={formatBRL(sum.contractedValue)} sub={`${sum.contractedOrders} pedido(s)`} />
        <Stat label="Receita reconhecida" value={formatBRL(sum.net)} sub={`${sum.unitsSold} placa(s) entregue(s)`} />
        <Stat label="Recebido" value={formatBRL(sum.received)} sub="dinheiro efetivo" tone="ok" />
        <Stat label="A receber (total)" value={formatBRL(sum.receivables)} sub="todas as vendas" tone={sum.receivables > 0 ? "warn" : undefined} />
      </div>
      <p className="px-1 text-xs text-subtle">Contratado = pedidos válidos pela data da venda · Reconhecida = pedidos entregues (− descontos e estornos) · Recebido = pagamentos no período.</p>
      <div className="flex flex-wrap items-center gap-2">
        <Chips size="sm" options={[{ value: "todas", label: "Todas" }, { value: "pendente", label: "Pendentes" }, { value: "parcial", label: "Parciais" }, { value: "pago", label: "Pagas" }, { value: "estornado", label: "Estornadas" }, { value: "cancelada", label: "Canceladas" }]} value={filter} onChange={setFilter} />
      </div>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar cliente" className="pl-10" aria-label="Buscar venda" />
      </div>
      {rows.length === 0 ? (
        <Card><EmptyState icon={BadgeDollarSign} title="Nenhuma venda neste filtro" action={<Button variant="primary" onClick={() => ui.openSale()}>Registrar venda</Button>}>Use o botão acima ou marque “Venda fechada” numa parada da rota. Preço sugerido: {formatBRL(settings.defaultPrice)}.</EmptyState></Card>
      ) : (
        [...byDay.entries()].map(([day, list]) => (
          <div key={day}>
            <div className="mb-2 mt-4 px-1 text-xs font-bold uppercase tracking-wider text-muted">{fmtLong(day)}</div>
            <div className="space-y-2">
              {list.map(({ s, c }) => (
                <button key={s.id} type="button" onClick={() => setOpenId(s.id)} className={cn("card press flex w-full items-center gap-3 p-3 text-left", s.status === "cancelada" && "opacity-60")}>
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary"><BadgeDollarSign className="h-5 w-5" /></div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold">{s.customerName}</div>
                    <div className="truncate text-xs text-muted">{fmtTime(s.at)} · {c.units} placa(s) · {settings.paymentMethods.find((m) => m.id === s.paymentMethod)?.label ?? s.paymentMethod}{!s.delivered && " · a entregar"}</div>
                  </div>
                  <div className="text-right">
                    <div className={cn("font-bold tabular", s.status === "cancelada" && "line-through")}>{formatBRL(c.net)}</div>
                    {s.status === "cancelada" ? <Badge tone="neutral">Cancelada</Badge> : <Badge tone={payTone[c.paymentStatus]}>{PAYMENT_STATUS_LABEL[c.paymentStatus]}</Badge>}
                  </div>
                </button>
              ))}
            </div>
          </div>
        ))
      )}
      {open && <SaleDetail sale={open} data={data} settings={settings} onClose={() => setOpenId(null)} />}
    </div>
  );
}

function SaleDetail({ sale, data, settings, onClose }: { sale: Sale; data: AppData; settings: Settings; onClose: () => void }) {
  const pays = data.payments.filter((p) => p.saleId === sale.id);
  const linked = data.expenses.filter((e) => e.saleId === sale.id && e.status === "pago").reduce((a, e) => a + e.amount, 0);
  const c = calcSale(sale, pays, linked);
  const [mode, setMode] = useState<null | "pagar" | "estornar" | "cancelar" | "editar" | "historico">(null);
  const history = useLiveQuery(() => db.audit.where("entityId").equals(sale.id).toArray(), [sale.id]);
  const method = settings.paymentMethods.find((m) => m.id === sale.paymentMethod)?.label ?? sale.paymentMethod;
  const active = sale.status === "ativa";
  return (
    <Sheet open onClose={onClose} title={sale.customerName} subtitle={`${fmtDateTime(sale.at)} · ${sale.origin}`}>
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {sale.status === "cancelada" ? <Badge tone="neutral">Cancelada: {sale.cancelReason}</Badge> : <Badge tone={payTone[c.paymentStatus]}>{PAYMENT_STATUS_LABEL[c.paymentStatus]}</Badge>}
          {!sale.delivered && <Badge tone="warn">A entregar (receita ainda não reconhecida)</Badge>}
          {c.costPending && <Badge tone="warn">Custo pendente</Badge>}
          {c.feePending && <Badge tone="warn">Taxa não informada</Badge>}
          {sale.isDemo && <Badge tone="demo">Demonstração</Badge>}
        </div>
        <div className="rounded-2xl border border-border p-3 text-sm">
          <Line k={`${c.units} × ${formatBRL(sale.items[0]?.unitPrice ?? 0)}`} v={formatBRL(c.gross)} />
          {c.discount > 0 && <Line k="Desconto" v={`− ${formatBRL(c.discount)}`} />}
          {c.refund > 0 && <Line k={`Estorno (${sale.refund?.reason})`} v={`− ${formatBRL(c.refund)}`} />}
          <Line strong k="Receita líquida" v={formatBRL(c.net)} />
          <Line k={`Custo das placas (${c.cogsUnits} un.)`} v={c.cogs == null ? "pendente" : `− ${formatBRL(c.cogs)}`} />
          <Line k={`Taxa ${method}${sale.feePct != null ? ` (${formatPct(sale.feePct, 2)} + ${formatBRL(sale.feeFixed)})` : ""}`} v={c.fee == null ? "não informada" : `− ${formatBRL(c.fee)}`} />
          {c.commission > 0 && <Line k="Comissão" v={`− ${formatBRL(c.commission)}`} />}
          {c.tax > 0 && <Line k="Tributos variáveis" v={`− ${formatBRL(c.tax)}`} />}
          {c.other > 0 && <Line k="Outros custos do pedido" v={`− ${formatBRL(c.other)}`} />}
          {c.transport > 0 && <Line k="Transporte vinculado" v={`− ${formatBRL(c.transport)}`} />}
          <Line strong k="Contribuição" v={c.contribution == null ? "pendente" : formatBRL(c.contribution)} />
        </div>
        <div className="rounded-2xl border border-border p-3 text-sm">
          <div className="mb-1 font-semibold">Pagamentos</div>
          {pays.length === 0 && <p className="text-xs text-subtle">Nenhum pagamento registrado.</p>}
          {pays.map((p) => <Line key={p.id} k={`${fmtDateTime(p.at)} · ${settings.paymentMethods.find((m) => m.id === p.method)?.label ?? p.method}${p.note ? ` · ${p.note}` : ""}`} v={formatBRL(p.amount)} />)}
          <Line strong k="Saldo em aberto" v={formatBRL(Math.max(c.due - c.paid, 0))} />
        </div>
        {sale.notes && <p className="text-sm text-muted">{sale.notes}</p>}
        {active && (
          <div className="grid grid-cols-2 gap-2">
            <Button disabled={c.paymentStatus === "pago" || c.paymentStatus === "estornado"} onClick={() => setMode("pagar")}><Wallet className="h-4 w-4" />Receber</Button>
            <Button onClick={() => setMode("editar")}><Pencil className="h-4 w-4" />Editar</Button>
            <Button disabled={!!sale.refund} onClick={() => setMode("estornar")}><Undo2 className="h-4 w-4" />Estornar</Button>
            <Button variant="ghost" className="text-bad" onClick={() => setMode("cancelar")}><Ban className="h-4 w-4" />Cancelar</Button>
            {!sale.delivered && <Button className="col-span-2" variant="soft" onClick={() => updateSale(sale.id, { delivered: true }, "Placa entregue").then(() => toast.success("Entrega registrada"))}>Marcar como entregue</Button>}
          </div>
        )}
        <Button variant="ghost" className="w-full" onClick={() => setMode(mode === "historico" ? null : "historico")}><History className="h-4 w-4" />Histórico de alterações ({history?.length ?? 0})</Button>
        {mode === "historico" && (
          <ul className="space-y-1 text-xs text-muted">
            {(history ?? []).sort((a, b) => b.at.localeCompare(a.at)).map((h) => <li key={h.id} className="rounded-lg bg-surface-raised px-3 py-2"><strong className="text-foreground">{fmtDateTime(h.at)}</strong> · {h.action} · {h.summary}</li>)}
          </ul>
        )}
      </div>
      {mode === "pagar" && <PaySheet sale={sale} open={c.due - c.paid} settings={settings} onClose={() => setMode(null)} />}
      {mode === "estornar" && <RefundSheet sale={sale} max={c.netBeforeRefund} units={c.units} paid={c.paid} onClose={() => setMode(null)} />}
      {mode === "editar" && <EditSaleSheet sale={sale} settings={settings} onClose={() => setMode(null)} />}
      <CancelSheet open={mode === "cancelar"} sale={sale} onClose={() => setMode(null)} onDone={onClose} />
    </Sheet>
  );
}

function Line({ k, v, strong }: { k: string; v: React.ReactNode; strong?: boolean }) {
  return <div className={cn("flex items-center justify-between gap-3 py-0.5", strong && "mt-1 border-t border-border pt-1.5 font-bold")}><span className="text-muted">{k}</span><span className="tabular">{v}</span></div>;
}

function PaySheet({ sale, open, settings, onClose }: { sale: Sale; open: number; settings: Settings; onClose: () => void }) {
  const [amount, setAmount] = useState<number | null>(open);
  const [method, setMethod] = useState(sale.paymentMethod);
  const save = async () => {
    try {
      await addPayment(sale.id, amount ?? 0, method);
      toast.success("Recebimento registrado");
      onClose();
    } catch (e) {
      toast.error(e instanceof ValidationError ? e.message : "Erro ao registrar.");
    }
  };
  return (
    <Sheet open onClose={onClose} title="Registrar recebimento" subtitle={`Em aberto: ${formatBRL(open)}`} footer={<Button variant="primary" size="lg" className="w-full" onClick={save}>Salvar</Button>}>
      <div className="space-y-4">
        <Field label="Valor recebido"><MoneyInput value={amount} onChange={setAmount} /></Field>
        <Field label="Forma"><Chips size="sm" options={settings.paymentMethods.filter((m) => m.active).map((m) => ({ value: m.id, label: m.label }))} value={method} onChange={setMethod} /></Field>
      </div>
    </Sheet>
  );
}

function RefundSheet({ sale, max, units, paid, onClose }: { sale: Sale; max: number; units: number; paid: number; onClose: () => void }) {
  const [amount, setAmount] = useState<number | null>(max);
  const [ret, setRet] = useState(units);
  const [toStock, setToStock] = useState(true);
  const [money, setMoney] = useState(paid > 0);
  const [reason, setReason] = useState("");
  const save = async () => {
    try {
      await refundSale(sale.id, { amount: amount ?? 0, unitsReturned: ret, returnedToStock: toStock && ret > 0, reason: reason || "Não informado", returnMoney: money });
      toast.success("Estorno registrado");
      onClose();
    } catch (e) {
      toast.error(e instanceof ValidationError ? e.message : "Erro ao estornar.");
    }
  };
  return (
    <Sheet open onClose={onClose} title="Estornar venda" subtitle="Reduz a receita na data do estorno. A venda continua no histórico." footer={<Button variant="danger" size="lg" className="w-full" onClick={save}>Confirmar estorno</Button>}>
      <div className="space-y-4">
        <Field label="Valor estornado" hint={`Máximo ${formatBRL(max)}`}><MoneyInput value={amount} onChange={setAmount} /></Field>
        <Field label="Placas devolvidas"><Stepper value={ret} min={0} max={units} onChange={setRet} /></Field>
        <Toggle checked={toStock} onChange={setToStock} label="Placas voltaram para o estoque" hint="Se não voltarem (danificadas), o custo continua no CPV." />
        <Toggle checked={money} onChange={setMoney} label="Devolver o dinheiro ao cliente" hint={`Já recebido: ${formatBRL(paid)}. Gera um pagamento negativo.`} />
        <Field label="Motivo"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex.: placa com defeito" /></Field>
      </div>
    </Sheet>
  );
}

function CancelSheet({ open, sale, onClose, onDone }: { open: boolean; sale: Sale; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  useEffect(() => { if (open) setReason(""); }, [open]);
  return (
    <Confirm open={open} onClose={onClose} danger title="Cancelar lançamento?" confirmLabel="Cancelar venda"
      message={<div className="space-y-3"><p>Use para anular um lançamento feito por engano ou uma venda desfeita antes da entrega. Ela sai dos indicadores, mas fica no histórico. Pagamentos deste lançamento são anulados. Se o cliente devolveu uma placa já paga, use <strong>Estornar</strong>.</p><Field label="Motivo (obrigatório)"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} /></Field></div>}
      onConfirm={async () => {
        try {
          await cancelSale(sale.id, reason);
          toast.success("Venda cancelada");
          onClose();
          onDone();
        } catch (e) {
          toast.error(e instanceof ValidationError ? e.message : "Erro ao cancelar.");
        }
      }} />
  );
}

function EditSaleSheet({ sale, settings, onClose }: { sale: Sale; settings: Settings; onClose: () => void }) {
  const it = sale.items[0];
  const [qty, setQty] = useState(it.qty);
  const [price, setPrice] = useState<number | null>(it.unitPrice);
  const [cost, setCost] = useState<number | null>(it.unitCost);
  const [discount, setDiscount] = useState<number | null>(sale.discount);
  const [method, setMethod] = useState(sale.paymentMethod);
  const [feePct, setFeePct] = useState<number | null>(sale.feePct);
  const [at, setAt] = useState(toLocalInput(sale.at));
  const [notes, setNotes] = useState(sale.notes);
  const [reason, setReason] = useState("");
  const save = async () => {
    try {
      await updateSale(sale.id, { qty, unitPrice: price ?? 0, unitCost: cost, discount: discount ?? 0, paymentMethod: method, feePct, at: fromLocalInput(at), notes }, reason || "Edição");
      toast.success("Venda atualizada (alteração registrada no histórico)");
      onClose();
    } catch (e) {
      toast.error(e instanceof ValidationError ? e.message : "Erro ao salvar.");
    }
  };
  return (
    <Sheet open onClose={onClose} title="Editar venda" footer={<Button variant="primary" size="lg" className="w-full" onClick={save}>Salvar alterações</Button>}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Placas"><Stepper value={qty} onChange={setQty} /></Field>
          <Field label="Preço unitário"><MoneyInput value={price} onChange={setPrice} /></Field>
          <Field label="Custo unitário"><MoneyInput value={cost} onChange={setCost} placeholder="pendente" /></Field>
          <Field label="Desconto"><MoneyInput value={discount} onChange={setDiscount} /></Field>
        </div>
        <Field label="Forma de pagamento"><Select value={method} onChange={setMethod} options={settings.paymentMethods.map((m) => ({ value: m.id, label: m.label }))} /></Field>
        <Field label="Taxa (%)"><NumberInput value={feePct} onChange={setFeePct} suffix="%" allowEmpty /></Field>
        <Field label="Data e hora"><Input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} /></Field>
        <Field label="Observações"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        <Field label="Motivo da alteração"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex.: preço digitado errado" /></Field>
        <p className="text-xs text-subtle">Venda de {fmtDate(sale.at)}. Pagamentos não são alterados por esta edição.</p>
      </div>
    </Sheet>
  );
}

