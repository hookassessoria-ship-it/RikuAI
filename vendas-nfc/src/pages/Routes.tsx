import { useEffect, useMemo, useState } from "react";
import {
  MapPinned, Plus, ChevronRight, CalendarDays, Navigation, MapPin, Phone, ArrowUp, ArrowDown, Trash2, Star, StickyNote, Play, Square,
  Clock, Info, FileUp, CalendarClock, Store, Footprints, BadgeDollarSign, MoreVertical,
} from "lucide-react";
import { toast } from "sonner";
import type { AppData } from "@/hooks/useData";
import type { Establishment, Route, Stop, Settings } from "@/db/types";
import { STATUS_LABEL, STOP_STATUSES } from "@/db/types";
import { createRoute, addStop, moveStop, removeStop, updateStop, updateRoute, deleteRoute, startWork, endWork, ValidationError } from "@/db/actions";
import { dayKey, fmtDate, fmtLong, fmtTime, fmtWeekday, fmtDateTime } from "@/lib/dates";
import { mapsNavUrl, mapsSearchUrl, placeQuery, telUrl } from "@/lib/maps";
import { routeHours } from "@/lib/finance/engine";
import { pendingFollowUps } from "@/lib/finance/intel";
import { transportBudget } from "@/lib/finance/transport";
import { formatBRL, formatNumber } from "@/lib/money";
import { cn, norm } from "@/lib/utils";
import { go } from "@/hooks/useHashRoute";
import { useUI } from "@/components/UIProvider";
import { StatusPill, statusMeta } from "@/components/status";
import { Badge, Button, Card, Chips, Confirm, EmptyState, Field, IconButton, Input, NumberInput, Progress, SectionTitle, Sheet, Textarea } from "@/components/ui";
import { EstablishmentPicker } from "@/components/sheets/EstablishmentPicker";

// ============================================================================ Lista de rotas
export function RoutesList({ data, isDemo }: { data: AppData; isDemo: boolean }) {
  const [tab, setTab] = useState<"rotas" | "retornos">("rotas");
  const [creating, setCreating] = useState(false);
  const follow = useMemo(() => pendingFollowUps(data.visits, data.sales, data.establishments), [data]);
  const routes = [...data.routes].sort((a, b) => a.date.localeCompare(b.date));
  const today = dayKey(new Date());
  const upcoming = routes.filter((r) => r.date >= today);
  const past = routes.filter((r) => r.date < today).reverse();
  const ui = useUI();

  return (
    <div className="space-y-4">
      <Chips options={[{ value: "rotas", label: `Rotas (${routes.length})` }, { value: "retornos", label: `Retornos pendentes (${follow.length})` }]} value={tab} onChange={setTab} />
      {tab === "rotas" && (
        <>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => setCreating(true)}><Plus className="h-4 w-4" />Nova rota</Button>
            <Button onClick={() => go("importar")}><FileUp className="h-4 w-4" />Importar roteiros</Button>
            <Button onClick={() => ui.openVisit()}><Footprints className="h-4 w-4" />Visita avulsa</Button>
          </div>
          {routes.length === 0 && (
            <Card>
              <EmptyState icon={MapPinned} title="Nenhuma rota ainda" action={<Button variant="primary" onClick={() => go("importar")}><FileUp className="h-4 w-4" />Importar os 88 estabelecimentos</Button>}>
                Importe a planilha dos roteiros de terça a quinta (o arquivo original já vem incluído) ou crie uma rota manualmente.
              </EmptyState>
            </Card>
          )}
          {upcoming.length > 0 && <SectionTitle>Hoje e próximas</SectionTitle>}
          <div className="grid gap-3 md:grid-cols-2">{upcoming.map((r) => <RouteCard key={r.id} route={r} data={data} today={today} />)}</div>
          {past.length > 0 && <SectionTitle>Anteriores</SectionTitle>}
          <div className="grid gap-3 md:grid-cols-2">{past.map((r) => <RouteCard key={r.id} route={r} data={data} today={today} />)}</div>
        </>
      )}
      {tab === "retornos" && <FollowUps data={data} items={follow} />}
      <NewRouteSheet open={creating} onClose={() => setCreating(false)} isDemo={isDemo} />
    </div>
  );
}

function RouteCard({ route, data, today }: { route: Route; data: AppData; today: string }) {
  const stops = data.stops.filter((s) => s.routeId === route.id);
  const done = stops.filter((s) => s.status !== "pendente" && s.status !== "a_caminho").length;
  const sales = data.sales.filter((s) => s.routeId === route.id && s.status === "ativa").length;
  const isToday = route.date === today;
  return (
    <button type="button" onClick={() => go(`rotas/${route.id}`)} className={cn("card press w-full p-4 text-left", isToday && "ring-2 ring-primary/60")}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {isToday && <Badge tone="primary">Hoje</Badge>}
            <span className="text-xs font-semibold capitalize text-muted">{fmtWeekday(route.date)} · {fmtDate(route.date)}</span>
          </div>
          <div className="mt-1 truncate text-base font-bold">{route.name}</div>
          <div className="truncate text-xs text-subtle">{route.region || "Região não informada"}</div>
        </div>
        <ChevronRight className="mt-1 h-5 w-5 shrink-0 text-subtle" />
      </div>
      <div className="mt-3 flex items-center gap-3 text-xs text-muted">
        <span className="tabular"><strong className="text-foreground">{done}</strong>/{stops.length} paradas</span>
        <span className="tabular"><strong className="text-foreground">{sales}</strong> venda(s)</span>
      </div>
      <Progress className="mt-2" value={stops.length ? done / stops.length : 0} light={done === stops.length && stops.length ? "verde" : "amarelo"} label="Progresso da rota" />
    </button>
  );
}

function NewRouteSheet({ open, onClose, isDemo }: { open: boolean; onClose: () => void; isDemo: boolean }) {
  const [name, setName] = useState("");
  const [date, setDate] = useState(dayKey(new Date()));
  const [region, setRegion] = useState("");
  useEffect(() => { if (open) { setName(""); setDate(dayKey(new Date())); setRegion(""); } }, [open]);
  const save = async () => {
    try {
      const r = await createRoute({ name: name || `Rota ${fmtDate(date)}`, date, region }, isDemo);
      toast.success("Rota criada");
      onClose();
      go(`rotas/${r.id}`);
    } catch (e) {
      toast.error(e instanceof ValidationError ? e.message : "Não foi possível criar a rota.");
    }
  };
  return (
    <Sheet open={open} onClose={onClose} title="Nova rota" footer={<Button variant="primary" size="lg" className="w-full" onClick={save}>Criar rota</Button>}>
      <div className="space-y-4">
        <Field label="Nome"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Sexta – Av. Rio Verde" /></Field>
        <Field label="Data"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Região"><Input value={region} onChange={(e) => setRegion(e.target.value)} placeholder="Ex.: Vila São Tomaz · Aparecida de Goiânia" /></Field>
      </div>
    </Sheet>
  );
}

function FollowUps({ data, items }: { data: AppData; items: ReturnType<typeof pendingFollowUps> }) {
  const ui = useUI();
  if (!items.length)
    return <Card><EmptyState icon={CalendarClock} title="Nenhum retorno pendente">Paradas marcadas como “Retornar depois”, “Interessado” ou “Responsável ausente” aparecem aqui até virarem venda ou perda.</EmptyState></Card>;
  return (
    <div className="space-y-2">
      {items.map((f) => {
        const e = data.establishments.find((x) => x.id === f.establishmentId);
        return (
          <div key={f.establishmentId} className="card flex items-center gap-3 p-3">
            <div className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-xl", f.overdue ? "bg-bad-soft text-bad" : "bg-warn-soft text-warn")}><CalendarClock className="h-5 w-5" /></div>
            <div className="min-w-0 flex-1">
              <div className="truncate font-semibold">{f.name}</div>
              <div className="truncate text-xs text-muted">{STATUS_LABEL[f.outcome as keyof typeof STATUS_LABEL]} em {fmtDate(f.lastVisitAt)} · {f.followUpAt ? `retornar ${fmtDate(f.followUpAt)}${f.overdue ? " (atrasado)" : ""}` : "sem data"}</div>
            </div>
            {e && <IconButton label="Navegar" onClick={() => window.open(mapsNavUrl(placeQuery(e)), "_blank", "noopener")}><Navigation className="h-5 w-5 text-primary" /></IconButton>}
            <IconButton label="Reagendar" onClick={() => ui.openFollowUp(f.establishmentId)}><CalendarClock className="h-5 w-5" /></IconButton>
            <IconButton label="Registrar venda" onClick={() => ui.openSale({ establishmentId: f.establishmentId })}><BadgeDollarSign className="h-5 w-5 text-ok" /></IconButton>
          </div>
        );
      })}
    </div>
  );
}

// ============================================================================ Detalhe da rota (dia)
export function RouteDetail({ id, focusStop, data, settings, isDemo }: { id: string; focusStop?: string; data: AppData; settings: Settings; isDemo: boolean }) {
  const route = data.routes.find((r) => r.id === id);
  const ui = useUI();
  const [filter, setFilter] = useState<"todas" | "pendentes" | "feitas">("todas");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [q, setQ] = useState("");
  const stops = useMemo(() => data.stops.filter((s) => s.routeId === id).sort((a, b) => a.order - b.order), [data.stops, id]);
  const estById = useMemo(() => new Map(data.establishments.map((e) => [e.id, e])), [data.establishments]);
  useEffect(() => {
    if (focusStop) setTimeout(() => document.getElementById(`stop-${focusStop}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 150);
  }, [focusStop]);
  if (!route) return <Card><EmptyState icon={MapPinned} title="Rota não encontrada" action={<Button onClick={() => go("rotas")}>Voltar</Button>} /></Card>;

  const counts = Object.fromEntries(STOP_STATUSES.map((s) => [s, stops.filter((x) => x.status === s).length])) as Record<string, number>;
  const done = stops.length - counts.pendente - counts.a_caminho;
  const next = stops.find((s) => s.status === "pendente" || s.status === "a_caminho");
  const nextEst = next ? estById.get(next.establishmentId) : undefined;
  const sales = data.sales.filter((s) => s.routeId === id && s.status === "ativa");
  const tb = transportBudget(settings.uberBudget, data.expenses.filter((e) => e.routeId === id), [route]);
  const hours = routeHours(route);
  const visible = stops.filter((s) => {
    if (filter === "pendentes" && !(s.status === "pendente" || s.status === "a_caminho")) return false;
    if (filter === "feitas" && (s.status === "pendente" || s.status === "a_caminho")) return false;
    if (q) {
      const e = estById.get(s.establishmentId);
      return norm(`${e?.name} ${e?.address} ${e?.category}`).includes(norm(q));
    }
    return true;
  });

  return (
    <div className="space-y-4">
      <section className="card gradient-hero p-5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted"><CalendarDays className="h-3.5 w-3.5" />{fmtLong(route.date)}</div>
            <h2 className="mt-1 text-xl font-extrabold">{route.name}</h2>
            <div className="text-sm text-muted">{route.region || "Região não informada"}</div>
          </div>
          <IconButton label="Editar rota" onClick={() => setEditing(true)}><MoreVertical className="h-5 w-5" /></IconButton>
        </div>
        <div className="mt-4 flex flex-wrap gap-2 text-sm">
          {[
            [`${done}/${stops.length}`, "feitas", ""],
            [sales.length, sales.length === 1 ? "venda" : "vendas", sales.length ? "text-ok" : ""],
            [counts.ausente, counts.ausente === 1 ? "ausente" : "ausentes", ""],
            [counts.retornar + counts.interessado, counts.retornar + counts.interessado === 1 ? "retorno" : "retornos", ""],
            [counts.sem_interesse, counts.sem_interesse === 1 ? "perda" : "perdas", ""],
          ].map(([v, l, c]) => (
            <span key={l as string} className="rounded-xl bg-surface-raised/70 px-3 py-1.5"><strong className={cn("tabular", c as string)}>{v}</strong> <span className="text-muted">{l}</span></span>
          ))}
        </div>
        <Progress className="mt-3" value={stops.length ? done / stops.length : 0} light="verde" label="Progresso da rota" />
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted">
          <Clock className="h-3.5 w-3.5" />
          {route.workStart ? <>Jornada iniciada às {fmtTime(route.workStart)}{route.workEnd ? ` · encerrada às ${fmtTime(route.workEnd)}` : ""}</> : "Jornada não iniciada"}
          {hours != null && <Badge tone="primary">{formatNumber(hours, 1)} h</Badge>}
          {!route.workStart && <Button size="sm" variant="soft" onClick={() => startWork(route.id)}><Play className="h-3.5 w-3.5" />Iniciar jornada</Button>}
          {route.workStart && !route.workEnd && <Button size="sm" onClick={() => endWork(route.id)}><Square className="h-3.5 w-3.5" />Encerrar</Button>}
        </div>
        <div className="mt-2 text-xs text-muted">Transporte desta rota: {formatBRL(tb.paid)} pago · {formatBRL(tb.planned)} previsto</div>
      </section>

      {next && nextEst && (
        <section className="card border-primary/50 p-4 animate-slide-up">
          <div className="text-[11px] font-bold uppercase tracking-wider text-primary">Próxima parada · #{next.order}</div>
          <div className="mt-1 text-lg font-extrabold">{nextEst.name}</div>
          <div className="text-sm text-muted">{nextEst.address}</div>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <a className="press inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-primary px-3 text-sm font-semibold text-primary-foreground" href={mapsNavUrl(placeQuery(nextEst))} target="_blank" rel="noopener" onClick={() => next.status === "pendente" && updateStop(next.id, { status: "a_caminho", statusAt: new Date().toISOString() })}>
              <Navigation className="h-4 w-4" />Navegar
            </a>
            <Button onClick={() => ui.openStopStatus(next)}>Registrar visita</Button>
            <Button onClick={() => ui.openSale({ establishmentId: next.establishmentId, stopId: next.id, routeId: id })}>Venda</Button>
            <Button onClick={() => ui.openStopStatus(next, "sem_interesse")}>Perda</Button>
          </div>
        </section>
      )}

      <Card padded={false} className="p-4">
        <div className="flex items-start gap-2 text-sm text-muted"><Info className="mt-0.5 h-4 w-4 shrink-0" /><p>Mapa indisponível: os endereços não têm coordenadas verificadas e não há API de rotas configurada. A ordem das paradas é manual (sem otimização automática). Distâncias e tempos são <strong>estimativas não verificadas</strong>; use “Navegar” para a rota real no Google Maps.</p></div>
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        <Chips size="sm" options={[{ value: "todas", label: `Todas (${stops.length})` }, { value: "pendentes", label: `Pendentes (${counts.pendente + counts.a_caminho})` }, { value: "feitas", label: `Feitas (${done})` }]} value={filter} onChange={setFilter} />
        <Button size="sm" onClick={() => setAdding(true)}><Plus className="h-4 w-4" />Adicionar parada</Button>
      </div>
      {stops.length > 8 && <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filtrar paradas por nome, endereço ou categoria" aria-label="Filtrar paradas" />}

      {stops.length === 0 && <Card><EmptyState icon={Store} title="Rota sem paradas" action={<Button variant="primary" onClick={() => setAdding(true)}><Plus className="h-4 w-4" />Adicionar estabelecimento</Button>}>Adicione estabelecimentos já cadastrados ou cadastre novos.</EmptyState></Card>}

      <ol className="space-y-3">
        {visible.map((s) => {
          const e = estById.get(s.establishmentId);
          const idx = stops.findIndex((x) => x.id === s.id);
          const nextStop = stops[idx + 1];
          const nextE = nextStop ? estById.get(nextStop.establishmentId) : undefined;
          return e ? <StopCard key={s.id} stop={s} est={e} total={stops.length} index={idx} nextStop={nextStop} nextEst={nextE} highlight={s.id === focusStop} /> : null;
        })}
      </ol>

      <AddStopSheet open={adding} onClose={() => setAdding(false)} routeId={id} data={data} isDemo={isDemo} />
      <EditRouteSheet open={editing} onClose={() => setEditing(false)} route={route} onDelete={() => { setEditing(false); setConfirmDel(true); }} />
      <Confirm open={confirmDel} onClose={() => setConfirmDel(false)} danger title="Excluir rota?" confirmLabel="Excluir rota"
        message="As paradas desta rota serão removidas. Visitas e vendas já registradas continuam no histórico e nos indicadores."
        onConfirm={async () => { await deleteRoute(id); setConfirmDel(false); toast.success("Rota excluída"); go("rotas"); }} />
    </div>
  );
}

function StopCard({ stop, est, total, index, nextStop, nextEst, highlight }: { stop: Stop; est: Establishment; total: number; index: number; nextStop?: Stop; nextEst?: Establishment; highlight?: boolean }) {
  const ui = useUI();
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState(stop.notes);
  const m = statusMeta(stop.status);
  const tel = telUrl(est.phone);
  const finished = stop.status !== "pendente" && stop.status !== "a_caminho";
  return (
    <li id={`stop-${stop.id}`} className={cn("card overflow-hidden", highlight && "ring-2 ring-primary", finished && "opacity-90")}>
      <div className="flex gap-3 p-4">
        <div className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-xl text-sm font-black tabular", m.bg, m.fg)}>{stop.order}</div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="font-bold leading-snug">{est.name}</div>
              <div className="text-xs text-muted">{est.category}</div>
            </div>
            {est.priority != null && (
              <Badge tone={est.priority >= 80 ? "ok" : est.priority >= 70 ? "primary" : "neutral"} className="shrink-0">
                <Star className="h-3 w-3" />{est.priority}
              </Badge>
            )}
          </div>
          <div className="mt-1.5 flex items-start gap-1.5 text-sm text-muted"><MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span>{est.address}</span></div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-subtle">
            {est.phone ? (tel ? <a href={tel} className="inline-flex items-center gap-1 text-primary"><Phone className="h-3.5 w-3.5" />{est.phone}</a> : <span className="inline-flex items-center gap-1"><Phone className="h-3.5 w-3.5" />{est.phone}</span>) : <span>Telefone não confirmado</span>}
            <span>{est.ratingVerified && est.googleRating != null ? `Google ${est.googleRating.toLocaleString("pt-BR")}★ (${est.googleReviews ?? "?"} aval., verif. ${est.ratingCheckedAt ? fmtDate(est.ratingCheckedAt) : "—"})` : "Nota Google não verificada"}</span>
            <span>{est.hours ? `Horário: ${est.hours}${est.hoursVerified && est.hoursCheckedAt ? ` (verif. ${fmtDate(est.hoursCheckedAt)})` : " (não verificado)"}` : "Horário não confirmado"}</span>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <StatusPill status={stop.status} onClick={() => ui.openStopStatus(stop)} />
            {stop.status === "pendente" && <Button size="sm" variant="ghost" onClick={() => ui.openStopStatus(stop)}>Registrar</Button>}
            {stop.followUpAt && <Badge tone="warn"><CalendarClock className="h-3 w-3" />Retorno {fmtDate(stop.followUpAt)}</Badge>}
            {stop.statusAt && finished && <span className="text-[11px] text-subtle">{fmtDateTime(stop.statusAt)}</span>}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-3 border-t border-border text-xs font-semibold">
        <a href={mapsNavUrl(placeQuery(est))} target="_blank" rel="noopener" className="press flex items-center justify-center gap-1.5 py-2.5 text-primary">
          <Navigation className="h-4 w-4" />Navegar
        </a>
        <a href={est.mapsUrl || mapsSearchUrl(placeQuery(est))} target="_blank" rel="noopener" className="press flex items-center justify-center gap-1.5 border-x border-border py-2.5">
          <MapPin className="h-4 w-4" />No Maps
        </a>
        <button type="button" onClick={() => setOpen(!open)} className="press flex items-center justify-center gap-1.5 py-2.5" aria-expanded={open}>
          <StickyNote className="h-4 w-4" />Detalhes
        </button>
      </div>
      {open && (
        <div className="space-y-3 border-t border-border bg-surface-raised/40 p-4 text-sm animate-fade-in">
          {est.priorityReason && <p><strong>Motivo da prioridade:</strong> {est.priorityReason}</p>}
          {est.evidence && <p className="text-muted"><strong>Evidência:</strong> {est.evidence}</p>}
          {est.otherRating && <p className="text-muted"><strong>Nota em outra fonte (não Google, não confirmada):</strong> {est.otherRating}</p>}
          <div className="grid grid-cols-2 gap-2 text-xs text-muted">
            <div><strong className="text-foreground">Desde a anterior:</strong> {stop.legDistance || "—"} {stop.legTime && `· ${stop.legTime}`} <span className="text-subtle">(estimativa não verificada)</span></div>
            <div><strong className="text-foreground">Abordagem:</strong> {stop.approachTime || "—"}</div>
            {stop.window && <div className="col-span-2"><strong className="text-foreground">Janela sugerida:</strong> {stop.window}</div>}
          </div>
          {nextStop && nextEst && (
            <a href={mapsNavUrl(placeQuery(nextEst))} target="_blank" rel="noopener" className="press flex items-center gap-2 rounded-xl bg-primary-soft px-3 py-2 text-primary">
              <Footprints className="h-4 w-4" />Navegar até a próxima parada (#{nextStop.order} {nextEst.name}) · {nextStop.legDistance || "distância"} estimada
            </a>
          )}
          <Field label="Observações da parada">
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== stop.notes && updateStop(stop.id, { notes }).then(() => toast.success("Observação salva"))} placeholder="Ex.: falar com o dono após 15h" />
          </Field>
          {stop.lossReason && <p className="text-xs text-bad">Motivo da perda: {stop.lossReason}</p>}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={index === 0} onClick={() => moveStop(stop.id, index - 1)}><ArrowUp className="h-4 w-4" />Subir</Button>
            <Button size="sm" disabled={index === total - 1} onClick={() => moveStop(stop.id, index + 1)}><ArrowDown className="h-4 w-4" />Descer</Button>
            <MoveTo stop={stop} total={total} index={index} />
            <Button size="sm" onClick={() => ui.openFollowUp(est.id)}><CalendarClock className="h-4 w-4" />Retorno</Button>
            <Button size="sm" onClick={() => go(`estabelecimentos/${est.id}`)}><Store className="h-4 w-4" />Editar dados</Button>
            <Button size="sm" variant="ghost" className="text-bad" onClick={() => removeStop(stop.id).then(() => toast.success("Parada removida da rota"))}><Trash2 className="h-4 w-4" />Remover</Button>
          </div>
        </div>
      )}
    </li>
  );
}

function MoveTo({ stop, total, index }: { stop: Stop; total: number; index: number }) {
  const [v, setV] = useState<number | null>(index + 1);
  return (
    <div className="flex items-center gap-1">
      <div className="w-20"><NumberInput value={v} onChange={setV} aria-label="Nova posição" /></div>
      <Button size="sm" onClick={() => v && v >= 1 && v <= total && moveStop(stop.id, v - 1).then(() => toast.success(`Movida para a posição ${v}`))}>Mover</Button>
    </div>
  );
}

function AddStopSheet({ open, onClose, routeId, data, isDemo }: { open: boolean; onClose: () => void; routeId: string; data: AppData; isDemo: boolean }) {
  const [estId, setEstId] = useState<string | null>(null);
  useEffect(() => { if (open) setEstId(null); }, [open]);
  const save = async () => {
    if (!estId) return;
    try {
      await addStop(routeId, estId, isDemo);
      toast.success("Parada adicionada ao fim da rota");
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    }
  };
  return (
    <Sheet open={open} onClose={onClose} title="Adicionar parada" footer={<Button variant="primary" size="lg" className="w-full" disabled={!estId} onClick={save}>Adicionar à rota</Button>}>
      <EstablishmentPicker establishments={data.establishments} value={estId} onChange={setEstId} isDemo={isDemo} />
    </Sheet>
  );
}

function EditRouteSheet({ open, onClose, route, onDelete }: { open: boolean; onClose: () => void; route: Route; onDelete: () => void }) {
  const [name, setName] = useState(route.name);
  const [date, setDate] = useState(route.date);
  const [region, setRegion] = useState(route.region);
  const [notes, setNotes] = useState(route.notes);
  const [hours, setHours] = useState<number | null>(route.manualHours);
  useEffect(() => { if (open) { setName(route.name); setDate(route.date); setRegion(route.region); setNotes(route.notes); setHours(route.manualHours); } }, [open, route]);
  const save = async () => {
    await updateRoute(route.id, { name, date, region, notes, manualHours: hours });
    toast.success("Rota atualizada");
    onClose();
  };
  return (
    <Sheet open={open} onClose={onClose} title="Editar rota" footer={<div className="flex gap-2"><Button variant="danger" onClick={onDelete}><Trash2 className="h-4 w-4" /></Button><Button variant="primary" className="flex-1" onClick={save}>Salvar</Button></div>}>
      <div className="space-y-4">
        <Field label="Nome"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Data"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Região"><Input value={region} onChange={(e) => setRegion(e.target.value)} /></Field>
        <Field label="Horas trabalhadas (manual)" hint="Opcional. Se preenchido, substitui o cálculo por início/fim da jornada."><NumberInput value={hours} onChange={setHours} suffix="h" allowEmpty /></Field>
        <Field label="Observações"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
    </Sheet>
  );
}
