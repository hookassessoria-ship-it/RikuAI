import { useEffect, useMemo, useState } from "react";
import { ChevronDown, CircleDollarSign } from "lucide-react";
import { toast } from "sonner";
import { createSale, PossibleDuplicateError, ValidationError, PRODUCT_ID, type SaleInput } from "@/db/actions";
import type { Sale, ExpenseCategory } from "@/db/types";
import { EXPENSE_CATEGORIES, TRANSPORT_CATEGORIES } from "@/db/types";
import { calcSale } from "@/lib/finance/engine";
import { suggestUnitCost } from "@/lib/finance/costs";
import { formatBRL, formatPct, type Cents } from "@/lib/money";
import { toLocalInput, fromLocalInput } from "@/lib/dates";
import { uid, cn } from "@/lib/utils";
import type { AppData } from "@/hooks/useData";
import type { Settings } from "@/db/types";
import { Badge, Button, Chips, Confirm, Field, Input, MoneyInput, NumberInput, Select, Sheet, Stepper, Textarea, Toggle } from "../ui";
import { EstablishmentPicker } from "./EstablishmentPicker";

export interface SaleContext {
  establishmentId?: string | null;
  stopId?: string | null;
  routeId?: string | null;
  recordVisit?: boolean;
}

export function SaleSheet({ open, onClose, ctx, data, settings, isDemo }: { open: boolean; onClose: () => void; ctx: SaleContext; data: AppData; settings: Settings; isDemo: boolean }) {
  const [requestId, setRequestId] = useState(uid());
  const [estId, setEstId] = useState<string | null>(null);
  const [freeName, setFreeName] = useState("");
  const [qty, setQty] = useState(1);
  const [price, setPrice] = useState<Cents | null>(settings.defaultPrice);
  const [discount, setDiscount] = useState<Cents | null>(null);
  const [method, setMethod] = useState("pix");
  const [payStatus, setPayStatus] = useState<"pago" | "pendente" | "parcial">("pago");
  const [paid, setPaid] = useState<Cents | null>(null);
  const [more, setMore] = useState(false);
  const [at, setAt] = useState(toLocalInput(new Date()));
  const [unitCost, setUnitCost] = useState<Cents | null>(null);
  const [costTouched, setCostTouched] = useState(false);
  const [feePct, setFeePct] = useState<number | null>(null);
  const [feeFixed, setFeeFixed] = useState<Cents | null>(0);
  const [feeTouched, setFeeTouched] = useState(false);
  const [commission, setCommission] = useState<number | null>(settings.commissionPct);
  const [tax, setTax] = useState<number | null>(settings.taxPct);
  const [other, setOther] = useState<Cents | null>(null);
  const [transport, setTransport] = useState<Cents | null>(null);
  const [transportCat, setTransportCat] = useState<ExpenseCategory>("uber");
  const [delivered, setDelivered] = useState(true);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [dup, setDup] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setRequestId(uid());
    setEstId(ctx.establishmentId ?? null);
    setFreeName("");
    setQty(1);
    setPrice(settings.defaultPrice);
    setDiscount(null);
    setMethod(settings.paymentMethods.find((m) => m.active)?.id ?? "pix");
    setPayStatus("pago");
    setPaid(null);
    setMore(false);
    setAt(toLocalInput(new Date()));
    setCostTouched(false);
    setFeeTouched(false);
    setCommission(settings.commissionPct);
    setTax(settings.taxPct);
    setOther(null);
    setTransport(null);
    setDelivered(true);
    setNotes("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const suggestion = useMemo(() => suggestUnitCost(data.costProfiles, data.stockLots, fromLocalInput(at)), [data.costProfiles, data.stockLots, at]);
  useEffect(() => {
    if (!costTouched) setUnitCost(suggestion.unitCost);
  }, [suggestion.unitCost, costTouched]);
  const pm = settings.paymentMethods.find((m) => m.id === method);
  useEffect(() => {
    if (!feeTouched) {
      setFeePct(pm?.feePct ?? null);
      setFeeFixed(pm?.feeFixed ?? 0);
    }
  }, [pm, feeTouched]);

  const input: SaleInput = {
    establishmentId: estId, customerName: freeName, at: fromLocalInput(at), qty, unitPrice: price ?? 0, discount: discount ?? 0,
    paymentMethod: method, paymentStatus: payStatus, paidAmount: paid ?? undefined, unitCost, feePct, feeFixed: feeFixed ?? 0,
    commissionPct: commission ?? 0, taxPct: tax ?? 0, otherVariable: other ?? 0, transportCost: transport, transportCategory: transportCat,
    delivered, routeId: ctx.routeId ?? null, stopId: ctx.stopId ?? null, recordVisit: ctx.recordVisit, notes, clientRequestId: requestId, isDemo,
  };
  // Prévia calculada pelo mesmo motor usado nos indicadores.
  const preview = calcSale({
    id: "preview", createdAt: "", updatedAt: "", deletedAt: null, isDemo, establishmentId: estId, customerName: "", at: input.at!, delivered, deliveredAt: null,
    items: [{ productId: PRODUCT_ID, qty, unitPrice: price ?? 0, unitCost }], discount: discount ?? 0, paymentMethod: method, feePct, feeFixed: feeFixed ?? 0,
    commissionPct: commission ?? 0, taxPct: tax ?? 0, otherVariable: other ?? 0, status: "ativa", cancelReason: "", cancelledAt: null, refund: null,
    routeId: null, stopId: null, visitId: null, origin: "", notes: "", clientRequestId: "",
  } as Sale, [], transport ?? 0);

  const submit = async (allowDuplicate = false) => {
    setSaving(true);
    try {
      await createSale(input, { allowDuplicate });
      toast.success("Venda registrada", { description: `${formatBRL(preview.net)} · salva neste aparelho` });
      setDup(null);
      onClose();
    } catch (e) {
      if (e instanceof PossibleDuplicateError) setDup(e.message);
      else if (e instanceof ValidationError) toast.error(e.message);
      else toast.error("Não foi possível salvar a venda.");
    } finally {
      setSaving(false);
    }
  };

  const methods = settings.paymentMethods.filter((m) => m.active);
  return (
    <>
      <Sheet open={open} onClose={onClose} title="Registrar venda" subtitle={ctx.stopId ? "Vinculada à visita desta parada" : "Venda presencial"}
        footer={
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-xs text-subtle">Total do pedido</div>
              <div className="text-xl font-extrabold tabular">{formatBRL(preview.net)}</div>
            </div>
            <Button variant="primary" size="lg" onClick={() => submit()} loading={saving} className="min-w-[44%]">
              <CircleDollarSign className="h-5 w-5" />Salvar venda
            </Button>
          </div>
        }>
        <div className="space-y-4">
          <Field label="Cliente">
            <EstablishmentPicker establishments={data.establishments} value={estId} onChange={setEstId} isDemo={isDemo} allowFreeName freeName={freeName} onFreeName={setFreeName} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Placas"><Stepper value={qty} onChange={setQty} /></Field>
            <Field label="Preço unitário"><MoneyInput value={price} onChange={setPrice} allowEmpty={false} /></Field>
          </div>
          <Field label="Desconto no pedido (opcional)"><MoneyInput value={discount} onChange={setDiscount} /></Field>
          <Field label="Forma de pagamento">
            <Chips size="sm" options={methods.map((m) => ({ value: m.id, label: m.label }))} value={method} onChange={(v) => { setMethod(v); setFeeTouched(false); }} />
          </Field>
          <Field label="Pagamento" hint={payStatus === "pendente" ? "Venda pendente não conta como dinheiro recebido." : undefined}>
            <Chips options={[{ value: "pago", label: "Pago agora" }, { value: "pendente", label: "Pendente" }, { value: "parcial", label: "Parcial" }]} value={payStatus} onChange={setPayStatus} />
          </Field>
          {payStatus === "parcial" && <Field label="Valor recebido agora"><MoneyInput value={paid} onChange={setPaid} /></Field>}

          <div className="rounded-2xl border border-border bg-surface-raised/60 p-3 text-sm">
            <Row k="Receita do pedido" v={formatBRL(preview.net)} />
            <Row k="Custo das placas" v={preview.cogs == null ? <Badge tone="warn">pendente</Badge> : formatBRL(preview.cogs)} />
            <Row k="Taxas e variáveis" v={preview.feePending ? <span className="flex items-center gap-1.5 whitespace-nowrap">{formatBRL(preview.variableExCogs)}<Badge tone="warn">taxa ?</Badge></span> : formatBRL(preview.variableExCogs)} />
            <Row strong k="Contribuição" v={preview.contribution == null ? <span className="text-neutral">pendente (falta o custo)</span> : <span className={cn(preview.contribution < 0 && "text-bad")}>{formatBRL(preview.contribution)} {preview.net > 0 && `· ${formatPct((preview.contribution / preview.net) * 100)}`}</span>} />
          </div>

          <button type="button" onClick={() => setMore(!more)} className="press flex w-full items-center justify-between rounded-xl px-1 py-2 text-sm font-semibold text-primary">
            Mais detalhes (custo, taxas, data, transporte)
            <ChevronDown className={cn("h-4 w-4 transition-transform", more && "rotate-180")} />
          </button>
          {more && (
            <div className="space-y-4 animate-fade-in">
              <Field label="Data e hora"><Input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} /></Field>
              <Field label="Custo unitário aplicado" hint={suggestion.explanation}>
                <MoneyInput value={unitCost} onChange={(v) => { setUnitCost(v); setCostTouched(true); }} placeholder="pendente" />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Taxa do meio (%)" hint={pm?.feePct == null ? "Não configurada" : undefined}>
                  <NumberInput value={feePct} onChange={(v) => { setFeePct(v); setFeeTouched(true); }} suffix="%" allowEmpty placeholder="pendente" />
                </Field>
                <Field label="Taxa fixa"><MoneyInput value={feeFixed} onChange={(v) => { setFeeFixed(v); setFeeTouched(true); }} /></Field>
                <Field label="Comissão (%)"><NumberInput value={commission} onChange={setCommission} suffix="%" /></Field>
                <Field label="Tributos variáveis (%)"><NumberInput value={tax} onChange={setTax} suffix="%" /></Field>
              </div>
              <Field label="Outros custos deste pedido"><MoneyInput value={other} onChange={setOther} /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Transporte atribuível" hint="Vira despesa vinculada à venda."><MoneyInput value={transport} onChange={setTransport} /></Field>
                <Field label="Tipo">
                  <Select value={transportCat} onChange={(v) => setTransportCat(v as ExpenseCategory)} options={TRANSPORT_CATEGORIES.map((c) => ({ value: c, label: EXPENSE_CATEGORIES[c] }))} />
                </Field>
              </div>
              <Toggle checked={delivered} onChange={setDelivered} label="Placa entregue agora" hint="Desmarque se a entrega for depois (receita só é reconhecida na entrega)." />
              <Field label="Observações"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Opcional" /></Field>
            </div>
          )}
        </div>
      </Sheet>
      <Confirm open={!!dup} onClose={() => setDup(null)} onConfirm={() => submit(true)} title="Possível venda duplicada" message={<>{dup} Deseja registrar mesmo assim?</>} confirmLabel="Registrar mesmo assim" loading={saving} />
    </>
  );
}

function Row({ k, v, strong }: { k: string; v: React.ReactNode; strong?: boolean }) {
  return (
    <div className={cn("flex items-center justify-between gap-3 py-1", strong && "mt-1 border-t border-border pt-2 font-bold")}>
      <span className="text-muted">{k}</span>
      <span className="tabular">{v}</span>
    </div>
  );
}
