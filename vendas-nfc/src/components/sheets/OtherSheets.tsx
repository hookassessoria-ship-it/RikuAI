import { useEffect, useState } from "react";
import { CalendarClock, Receipt, Check } from "lucide-react";
import { toast } from "sonner";
import { addExpense, setStopStatus, recordVisit, scheduleFollowUp, PossibleDuplicateError, ValidationError } from "@/db/actions";
import { EXPENSE_CATEGORIES, LOSS_REASONS, STATUS_LABEL, type ExpenseCategory, type StopStatus, type VisitOutcome } from "@/db/types";
import { dayKey, addDays, fmtDate } from "@/lib/dates";
import { formatBRL, type Cents } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { AppData } from "@/hooks/useData";
import { Button, Chips, Confirm, Field, Input, MoneyInput, Select, Sheet, Textarea, Toggle } from "../ui";
import { EstablishmentPicker } from "./EstablishmentPicker";
import { STATUS_META } from "../status";

// ---------------------------------------------------------------- Despesa
export function ExpenseSheet({ open, onClose, data, isDemo, defaults }: { open: boolean; onClose: () => void; data: AppData; isDemo: boolean; defaults?: { category?: ExpenseCategory; routeId?: string | null; status?: "pago" | "previsto" } }) {
  const [at, setAt] = useState(dayKey(new Date()));
  const [category, setCategory] = useState<ExpenseCategory>("uber");
  const [amount, setAmount] = useState<Cents | null>(null);
  const [status, setStatus] = useState<"pago" | "previsto">("pago");
  const [description, setDescription] = useState("");
  const [routeId, setRouteId] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [dup, setDup] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setAt(dayKey(new Date()));
    setCategory(defaults?.category ?? "uber");
    setAmount(null);
    setStatus(defaults?.status ?? "pago");
    setDescription("");
    const today = data.routes.find((r) => r.date === dayKey(new Date()));
    setRouteId(defaults?.routeId ?? today?.id ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const submit = async (allowDuplicate = false) => {
    setSaving(true);
    try {
      await addExpense({ at, category, amount: amount ?? 0, description, routeId: routeId || null, status, isDemo }, { allowDuplicate });
      toast.success(status === "previsto" ? "Previsão registrada" : "Despesa registrada", { description: `${formatBRL(amount)} · salva neste aparelho` });
      setDup(null);
      onClose();
    } catch (e) {
      if (e instanceof PossibleDuplicateError) setDup(e.message);
      else if (e instanceof ValidationError) toast.error(e.message);
      else toast.error("Não foi possível salvar.");
    } finally {
      setSaving(false);
    }
  };
  const routes = [...data.routes].sort((a, b) => b.date.localeCompare(a.date));
  return (
    <>
      <Sheet open={open} onClose={onClose} title="Registrar despesa" subtitle="Compras de estoque ficam em Finanças › Estoque (não são despesa)."
        footer={<Button variant="primary" size="lg" className="w-full" onClick={() => submit()} loading={saving}><Receipt className="h-5 w-5" />Salvar {status === "previsto" ? "previsão" : "despesa"}</Button>}>
        <div className="space-y-4">
          <Field label="Valor"><MoneyInput value={amount} onChange={setAmount} autoFocus /></Field>
          <Field label="Categoria">
            <Chips size="sm" options={(Object.keys(EXPENSE_CATEGORIES) as ExpenseCategory[]).map((k) => ({ value: k, label: EXPENSE_CATEGORIES[k] }))} value={category} onChange={setCategory} />
          </Field>
          <Field label="Situação" hint={status === "previsto" ? "Estimativa: não entra no resultado; conta no orçamento de transporte como previsto." : "Valor efetivamente pago."}>
            <Chips options={[{ value: "pago", label: "Pago" }, { value: "previsto", label: "Previsto (estimativa)" }]} value={status} onChange={setStatus} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Data"><Input type="date" value={at} onChange={(e) => setAt(e.target.value)} /></Field>
            <Field label="Rota (opcional)">
              <Select value={routeId} onChange={setRouteId} options={[{ value: "", label: "Sem rota" }, ...routes.map((r) => ({ value: r.id, label: `${r.name}` }))]} />
            </Field>
          </div>
          <Field label="Descrição (opcional)"><Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ex.: Uber até o Garavelo" /></Field>
        </div>
      </Sheet>
      <Confirm open={!!dup} onClose={() => setDup(null)} onConfirm={() => submit(true)} title="Possível duplicidade" message={<>{dup} Registrar mesmo assim?</>} confirmLabel="Registrar" loading={saving} />
    </>
  );
}

// ---------------------------------------------------------------- Status da parada / visita
const FOLLOW_CHIPS = [
  { value: "1", label: "Amanhã" },
  { value: "2", label: "Em 2 dias" },
  { value: "7", label: "Próx. semana" },
];

export function StatusSheet({ open, onClose, title, current, onPick, mode = "stop", initialFocus }: {
  open: boolean;
  onClose: () => void;
  title: string;
  current?: StopStatus;
  onPick: (status: StopStatus, extra: { contact?: boolean; demo?: boolean; lossReason?: string; followUpAt?: string | null; notes?: string }) => Promise<void> | void;
  mode?: "stop" | "visit";
  initialFocus?: StopStatus | null;
}) {
  const [step, setStep] = useState<StopStatus | null>(null);
  const [contact, setContact] = useState<boolean | null>(null);
  const [demo, setDemo] = useState(false);
  const [other, setOther] = useState("");
  const [follow, setFollow] = useState<string>("");
  const [notes, setNotes] = useState("");
  useEffect(() => {
    if (open) {
      setStep(initialFocus ?? null);
      setContact(null);
      setDemo(false);
      setOther("");
      setFollow(dayKey(addDays(new Date(), 1)));
      setNotes("");
    }
  }, [open, initialFocus]);
  const statuses = (mode === "visit" ? STATUS_META.filter((s) => s.key !== "pendente" && s.key !== "a_caminho") : STATUS_META);
  const commit = async (s: StopStatus, extra: Parameters<typeof onPick>[1] = {}) => {
    await onPick(s, { ...(contact != null ? { contact } : {}), demo: demo || undefined, notes: notes || undefined, ...extra });
    onClose();
  };
  const pick = (s: StopStatus) => {
    if (s === "sem_interesse" || s === "retornar" || s === "interessado") setStep(s);
    else commit(s);
  };
  return (
    <Sheet open={open} onClose={onClose} title={title} subtitle={step ? STATUS_LABEL[step] : "Um toque registra a visita. Corrija em até 30 min sem duplicar."}>
      {!step && (
        <>
          <div className="mb-3 grid grid-cols-2 gap-2">
            <Toggle checked={contact === true} onChange={(v) => setContact(v)} label="Falei com o responsável" />
            <Toggle checked={demo} onChange={setDemo} label="Fiz demonstração" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            {statuses.map((s) => (
              <button key={s.key} type="button" onClick={() => pick(s.key)}
                className={cn("press flex min-h-[60px] items-center gap-2.5 rounded-2xl border px-3 py-2 text-left text-sm font-semibold transition-colors", current === s.key ? "border-primary bg-primary-soft" : "border-border bg-surface-raised hover:bg-surface-overlay")}>
                <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-xl", s.bg)}><s.Icon className={cn("h-4.5 w-4.5", s.fg)} style={{ width: 18, height: 18 }} /></span>
                <span className="leading-tight">{STATUS_LABEL[s.key]}</span>
              </button>
            ))}
          </div>
          <Field label="Observação (opcional)" className="mt-3"><Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ex.: dono volta às 15h" /></Field>
        </>
      )}
      {step === "sem_interesse" && (
        <div className="space-y-3">
          <p className="text-sm text-muted">Motivo da perda (toque para salvar):</p>
          <div className="grid gap-2">
            {LOSS_REASONS.filter((r) => r !== "Outro").map((r) => (
              <Button key={r} className="justify-start" onClick={() => commit("sem_interesse", { lossReason: r })}>{r}</Button>
            ))}
          </div>
          <Field label="Outro motivo"><Input value={other} onChange={(e) => setOther(e.target.value)} placeholder="Descreva" /></Field>
          <div className="flex gap-2">
            <Button className="flex-1" onClick={() => setStep(null)}>Voltar</Button>
            <Button className="flex-1" variant="primary" onClick={() => commit("sem_interesse", { lossReason: other.trim() || "Não informado" })}>Salvar</Button>
          </div>
        </div>
      )}
      {(step === "retornar" || step === "interessado") && (
        <div className="space-y-3">
          <Field label={step === "retornar" ? "Quando retornar?" : "Agendar retorno (opcional)"}>
            <Chips size="sm" options={FOLLOW_CHIPS} value={null} onChange={(v) => setFollow(dayKey(addDays(new Date(), Number(v))))} />
          </Field>
          <Field label="Data do retorno" hint={follow ? fmtDate(follow) : undefined}><Input type="date" value={follow} onChange={(e) => setFollow(e.target.value)} /></Field>
          <Field label="Observação"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ex.: falar com a gerente Ana" /></Field>
          <div className="flex gap-2">
            <Button className="flex-1" onClick={() => setStep(null)}>Voltar</Button>
            {step === "interessado" && <Button className="flex-1" onClick={() => commit("interessado", { followUpAt: null })}>Sem data</Button>}
            <Button className="flex-1" variant="primary" onClick={() => commit(step, { followUpAt: follow || null })}><Check className="h-4 w-4" />Salvar</Button>
          </div>
        </div>
      )}
    </Sheet>
  );
}

export async function applyStopStatus(stopId: string, status: StopStatus, extra: Parameters<typeof setStopStatus>[2]) {
  try {
    await setStopStatus(stopId, status, extra);
    toast.success(STATUS_LABEL[status], { description: "Visita salva neste aparelho" });
  } catch (e) {
    toast.error(e instanceof Error ? e.message : "Não foi possível salvar.");
  }
}

// ---------------------------------------------------------------- Visita avulsa
export function VisitSheet({ open, onClose, data, isDemo, onSale }: { open: boolean; onClose: () => void; data: AppData; isDemo: boolean; onSale: (establishmentId: string) => void }) {
  const [estId, setEstId] = useState<string | null>(null);
  const [statusOpen, setStatusOpen] = useState(false);
  useEffect(() => { if (open) setEstId(null); }, [open]);
  const est = data.establishments.find((e) => e.id === estId);
  return (
    <>
      <Sheet open={open && !statusOpen} onClose={onClose} title="Registrar visita" subtitle="Visita fora de uma rota planejada"
        footer={<Button variant="primary" size="lg" className="w-full" disabled={!estId} onClick={() => setStatusOpen(true)}>Escolher resultado</Button>}>
        <EstablishmentPicker establishments={data.establishments} value={estId} onChange={setEstId} isDemo={isDemo} />
      </Sheet>
      <StatusSheet open={statusOpen} mode="visit" onClose={() => { setStatusOpen(false); onClose(); }} title={est?.name ?? "Visita"}
        onPick={async (s, extra) => {
          if (!estId) return;
          if (s === "venda") { onSale(estId); return; }
          await recordVisit(estId, s as VisitOutcome, extra, isDemo);
          toast.success(STATUS_LABEL[s], { description: "Visita salva neste aparelho" });
        }} />
    </>
  );
}

// ---------------------------------------------------------------- Retorno
export function FollowUpSheet({ open, onClose, data, isDemo, establishmentId }: { open: boolean; onClose: () => void; data: AppData; isDemo: boolean; establishmentId?: string | null }) {
  const [estId, setEstId] = useState<string | null>(null);
  const [date, setDate] = useState(dayKey(addDays(new Date(), 1)));
  const [notes, setNotes] = useState("");
  useEffect(() => {
    if (open) { setEstId(establishmentId ?? null); setDate(dayKey(addDays(new Date(), 1))); setNotes(""); }
  }, [open, establishmentId]);
  const save = async () => {
    if (!estId) return;
    await scheduleFollowUp(estId, date, notes, isDemo);
    toast.success("Retorno agendado", { description: fmtDate(date) });
    onClose();
  };
  return (
    <Sheet open={open} onClose={onClose} title="Agendar retorno"
      footer={<Button variant="primary" size="lg" className="w-full" disabled={!estId} onClick={save}><CalendarClock className="h-5 w-5" />Agendar</Button>}>
      <div className="space-y-4">
        <Field label="Estabelecimento"><EstablishmentPicker establishments={data.establishments} value={estId} onChange={setEstId} isDemo={isDemo} /></Field>
        <Field label="Quando"><Chips size="sm" options={FOLLOW_CHIPS} value={null} onChange={(v) => setDate(dayKey(addDays(new Date(), Number(v))))} /></Field>
        <Field label="Data"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Observação"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Opcional" /></Field>
      </div>
    </Sheet>
  );
}
