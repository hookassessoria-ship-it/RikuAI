import { useEffect, useMemo, useRef, useState } from "react";
import { Store, Search, Download, Upload, FlaskConical, Trash2, HardDrive, Moon, Sun, ShieldCheck, Plus, MapPin, Navigation, BadgeDollarSign } from "lucide-react";
import { toast } from "sonner";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/db/db";
import type { AppData } from "@/hooks/useData";
import type { Establishment, Settings } from "@/db/types";
import { STATUS_LABEL } from "@/db/types";
import { updateEstablishment, updateSettings, addEstablishment, PossibleDuplicateError, ValidationError } from "@/db/actions";
import { seedDemo, clearDemo, countDemo } from "@/db/demo";
import { exportBackup, restoreBackup, validateBackup, downloadText, type BackupFile } from "@/db/backup";
import { SEGMENTS } from "@/lib/segments";
import { fmtDate, fmtDateTime, dayKey, WEEKDAYS } from "@/lib/dates";
import { formatBRL } from "@/lib/money";
import { mapsNavUrl, mapsSearchUrl, placeQuery } from "@/lib/maps";
import { norm, cn } from "@/lib/utils";
import { go } from "@/hooks/useHashRoute";
import { useUI } from "@/components/UIProvider";
import { Badge, Button, Card, Chips, Confirm, EmptyState, Field, Input, MoneyInput, NumberInput, Select, Sheet, Textarea, Toggle } from "@/components/ui";

// ============================================================================ Estabelecimentos
export function EstablishmentsPage({ data, isDemo, openId }: { data: AppData; isDemo: boolean; openId?: string }) {
  const [q, setQ] = useState("");
  const [seg, setSeg] = useState("todos");
  const [creating, setCreating] = useState(false);
  const list = useMemo(() => data.establishments
    .filter((e) => (seg === "todos" ? true : e.segment === seg))
    .filter((e) => !q || norm(`${e.name} ${e.address} ${e.category} ${e.region}`).includes(norm(q)))
    .sort((a, b) => (b.priority ?? -1) - (a.priority ?? -1) || a.name.localeCompare(b.name)), [data.establishments, q, seg]);
  const open = data.establishments.find((e) => e.id === openId);
  const segs = [...new Set(data.establishments.map((e) => e.segment))].sort();
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={() => setCreating(true)}><Plus className="h-4 w-4" />Novo estabelecimento</Button>
        <Button onClick={() => go("importar")}>Importar planilha</Button>
      </div>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Buscar entre ${data.establishments.length} estabelecimentos`} className="pl-10" aria-label="Buscar estabelecimento" />
      </div>
      {segs.length > 1 && <div className="no-scrollbar -mx-4 overflow-x-auto px-4"><Chips size="sm" className="flex-nowrap" options={[{ value: "todos", label: "Todos" }, ...segs.map((s) => ({ value: s, label: s }))]} value={seg} onChange={setSeg} /></div>}
      {list.length === 0 ? <Card><EmptyState icon={Store} title="Nenhum estabelecimento" action={<Button variant="primary" onClick={() => go("importar")}>Importar os 88 do roteiro</Button>} /></Card> : (
        <div className="grid gap-2 md:grid-cols-2">
          {list.map((e) => {
            const sales = data.sales.filter((s) => s.establishmentId === e.id && s.status === "ativa").length;
            const visits = data.visits.filter((v) => v.establishmentId === e.id).length;
            return (
              <button key={e.id} type="button" onClick={() => go(`estabelecimentos/${e.id}`)} className="card press flex items-center gap-3 p-3 text-left">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary-soft text-sm font-black text-primary">{e.priority ?? "—"}</div>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold">{e.name}</div>
                  <div className="truncate text-xs text-muted">{e.category} · {e.region || e.address}</div>
                </div>
                <div className="text-right text-xs text-subtle">{visits} visita(s)<br />{sales ? <span className="font-semibold text-ok">{sales} venda(s)</span> : "sem venda"}</div>
              </button>
            );
          })}
        </div>
      )}
      {open && <EstablishmentSheet est={open} data={data} onClose={() => go("estabelecimentos")} />}
      <NewEstablishmentSheet open={creating} onClose={() => setCreating(false)} isDemo={isDemo} />
    </div>
  );
}

function EstablishmentSheet({ est, data, onClose }: { est: Establishment; data: AppData; onClose: () => void }) {
  const ui = useUI();
  const [f, setF] = useState(est);
  const [verified, setVerified] = useState(est.ratingVerified);
  const [hoursVerified, setHoursVerified] = useState(est.hoursVerified);
  useEffect(() => { setF(est); setVerified(est.ratingVerified); setHoursVerified(est.hoursVerified); }, [est]);
  const set = <K extends keyof Establishment>(k: K, v: Establishment[K]) => setF({ ...f, [k]: v });
  const visits = data.visits.filter((v) => v.establishmentId === est.id).sort((a, b) => b.at.localeCompare(a.at));
  const sales = data.sales.filter((s) => s.establishmentId === est.id);
  const save = async () => {
    const now = new Date().toISOString();
    await updateEstablishment(est.id, {
      name: f.name, category: f.category, segment: f.segment, address: f.address, bairro: f.bairro, city: f.city, phone: f.phone,
      googleRating: f.googleRating, googleReviews: f.googleReviews, ratingVerified: verified && f.googleRating != null,
      ratingCheckedAt: verified && f.googleRating != null ? (est.ratingVerified && est.googleRating === f.googleRating ? est.ratingCheckedAt : now) : null,
      hours: f.hours, hoursVerified: hoursVerified && !!f.hours, hoursCheckedAt: hoursVerified && f.hours ? (est.hoursVerified && est.hours === f.hours ? est.hoursCheckedAt : now) : null,
      priority: f.priority, priorityReason: f.priorityReason, responsible: f.responsible, notes: f.notes,
    });
    toast.success("Dados salvos");
    onClose();
  };
  return (
    <Sheet open onClose={onClose} title={est.name} subtitle={`${est.origin === "importado" ? "Importado" : "Cadastro manual"} · ${est.region}`} wide
      footer={<Button variant="primary" size="lg" className="w-full" onClick={save}>Salvar</Button>}>
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-2">
          <a className="press inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground" href={mapsNavUrl(placeQuery(est))} target="_blank" rel="noopener"><Navigation className="h-4 w-4" />Navegar</a>
          <a className="press inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-border bg-surface-raised text-sm font-semibold" href={est.mapsUrl || mapsSearchUrl(placeQuery(est))} target="_blank" rel="noopener"><MapPin className="h-4 w-4" />Maps</a>
          <Button onClick={() => ui.openSale({ establishmentId: est.id })}><BadgeDollarSign className="h-4 w-4" />Venda</Button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nome"><Input value={f.name} onChange={(e) => set("name", e.target.value)} /></Field>
          <Field label="Categoria"><Input value={f.category} onChange={(e) => set("category", e.target.value)} /></Field>
          <Field label="Segmento (análises)"><Select value={f.segment} onChange={(v) => set("segment", v)} options={SEGMENTS.map((s) => ({ value: s, label: s }))} /></Field>
          <Field label="Telefone"><Input value={f.phone} onChange={(e) => set("phone", e.target.value)} inputMode="tel" /></Field>
          <Field label="Endereço" className="sm:col-span-2"><Input value={f.address} onChange={(e) => set("address", e.target.value)} /></Field>
          <Field label="Bairro"><Input value={f.bairro} onChange={(e) => set("bairro", e.target.value)} /></Field>
          <Field label="Cidade"><Input value={f.city} onChange={(e) => set("city", e.target.value)} /></Field>
        </div>
        <Card title="Avaliações no Google" subtitle="Só marque como verificada depois de conferir no Google Maps.">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Nota"><NumberInput value={f.googleRating} onChange={(v) => set("googleRating", v)} allowEmpty placeholder="—" /></Field>
            <Field label="Nº de avaliações"><NumberInput value={f.googleReviews} onChange={(v) => set("googleReviews", v == null ? null : Math.round(v))} allowEmpty placeholder="—" /></Field>
          </div>
          <Toggle checked={verified} onChange={setVerified} label="Conferi no Google Maps agora" hint={est.ratingVerified && est.ratingCheckedAt ? `Verificada em ${fmtDate(est.ratingCheckedAt)}` : "Não verificada"} />
          {est.otherRating && <p className="mt-1 text-xs text-subtle">Outra fonte (não Google, não confirmada): {est.otherRating}</p>}
        </Card>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Horário de funcionamento"><Input value={f.hours} onChange={(e) => set("hours", e.target.value)} /></Field>
          <div className="pt-6"><Toggle checked={hoursVerified} onChange={setHoursVerified} label="Horário conferido" hint={est.hoursCheckedAt ? `em ${fmtDate(est.hoursCheckedAt)}` : "não verificado"} /></div>
          <Field label="Prioridade (0–100)"><NumberInput value={f.priority} onChange={(v) => set("priority", v == null ? null : Math.max(0, Math.min(100, Math.round(v))))} allowEmpty /></Field>
          <Field label="Responsável"><Input value={f.responsible} onChange={(e) => set("responsible", e.target.value)} placeholder="Nome do dono/gerente" /></Field>
        </div>
        <Field label="Motivo da prioridade"><Textarea value={f.priorityReason} onChange={(e) => set("priorityReason", e.target.value)} /></Field>
        <Field label="Observações"><Textarea value={f.notes} onChange={(e) => set("notes", e.target.value)} /></Field>
        {est.evidence && <p className="text-xs text-subtle"><strong>Evidência de funcionamento:</strong> {est.evidence}</p>}
        {est.sources && <p className="break-all text-xs text-subtle"><strong>Fontes:</strong> {est.sources}</p>}
        <Card title={`Histórico (${visits.length} visitas · ${sales.length} vendas)`}>
          {visits.length === 0 && sales.length === 0 ? <p className="text-sm text-subtle">Sem visitas ou vendas.</p> : (
            <ul className="space-y-1 text-sm">
              {visits.map((v) => <li key={v.id} className="flex justify-between gap-2"><span>{STATUS_LABEL[v.outcome]}{v.lossReason && ` · ${v.lossReason}`}</span><span className="text-xs text-subtle">{fmtDateTime(v.at)}</span></li>)}
              {sales.map((s) => <li key={s.id} className="flex justify-between gap-2 text-ok"><span>Venda {s.status === "cancelada" ? "(cancelada)" : ""}</span><span className="text-xs">{fmtDateTime(s.at)}</span></li>)}
            </ul>
          )}
        </Card>
      </div>
    </Sheet>
  );
}

function NewEstablishmentSheet({ open, onClose, isDemo }: { open: boolean; onClose: () => void; isDemo: boolean }) {
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [category, setCategory] = useState("");
  const [bairro, setBairro] = useState("");
  const [city, setCity] = useState("");
  const [phone, setPhone] = useState("");
  useEffect(() => { if (open) { setName(""); setAddress(""); setCategory(""); setBairro(""); setCity(""); setPhone(""); } }, [open]);
  const save = async () => {
    try {
      const e = await addEstablishment({ name, address, category, bairro, city, phone }, isDemo);
      toast.success("Estabelecimento cadastrado");
      onClose();
      go(`estabelecimentos/${e.id}`);
    } catch (err) {
      if (err instanceof PossibleDuplicateError) { toast.info(err.message); onClose(); go(`estabelecimentos/${err.existingId}`); }
      else toast.error(err instanceof ValidationError ? err.message : "Erro ao cadastrar");
    }
  };
  return (
    <Sheet open={open} onClose={onClose} title="Novo estabelecimento" footer={<Button variant="primary" size="lg" className="w-full" onClick={save}>Cadastrar</Button>}>
      <div className="space-y-3">
        <Field label="Nome *"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Endereço *"><Input value={address} onChange={(e) => setAddress(e.target.value)} /></Field>
        <Field label="Categoria"><Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Ex.: Barbearia" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Bairro"><Input value={bairro} onChange={(e) => setBairro(e.target.value)} /></Field>
          <Field label="Cidade"><Input value={city} onChange={(e) => setCity(e.target.value)} /></Field>
        </div>
        <Field label="Telefone"><Input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" /></Field>
      </div>
    </Sheet>
  );
}

// ============================================================================ Configurações
export function SettingsPage({ settings }: { settings: Settings }) {
  const [price, setPrice] = useState<number | null>(settings.defaultPrice);
  const [minSample, setMinSample] = useState<number | null>(settings.minSample);
  const [days, setDays] = useState<number[]>(settings.workWeekdays);
  const [demoCount, setDemoCount] = useState<number | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [restoreFile, setRestoreFile] = useState<BackupFile | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const persisted = useLiveQuery(async () => (navigator.storage?.persisted ? navigator.storage.persisted() : null), []);
  useEffect(() => { countDemo().then(setDemoCount); }, [settings.viewMode]);

  const doBackup = async () => {
    const b = await exportBackup();
    downloadText(`vendas-nfc-backup-${dayKey(new Date())}.json`, JSON.stringify(b), "application/json");
    await updateSettings({ lastBackupAt: new Date().toISOString() });
    toast.success("Backup baixado", { description: "Guarde o arquivo no iCloud/Google Drive ou envie para você mesmo." });
  };
  const onRestore = async (f: File) => {
    try {
      const data = JSON.parse(await f.text());
      const err = validateBackup(data);
      if (err) { toast.error(err); return; }
      setRestoreFile(data);
    } catch {
      toast.error("Arquivo de backup inválido.");
    }
  };
  return (
    <div className="space-y-4">
      <Card title="Venda">
        <div className="space-y-3">
          <Field label="Preço padrão da placa" hint="Sugestão editável em cada venda."><MoneyInput value={price} onChange={setPrice} /></Field>
          <Button onClick={async () => { await updateSettings({ defaultPrice: price ?? 6990 }, "Preço padrão alterado"); toast.success("Preço salvo"); }}>Salvar preço</Button>
          <p className="text-xs text-subtle">Custos, taxas por forma de pagamento, comissão e tributos ficam em <button className="underline" onClick={() => go("financas/custos")}>Finanças › Custos</button>. Orçamento de transporte em <button className="underline" onClick={() => go("financas/transporte")}>Finanças › Transporte</button> ({formatBRL(settings.uberBudget)}).</p>
        </div>
      </Card>

      <Card title="Análises e projeções">
        <div className="space-y-3">
          <Field label="Dias de trabalho (para projeção do mês)">
            <div className="flex flex-wrap gap-2">
              {WEEKDAYS.map((w, i) => (
                <button key={w} type="button" onClick={() => setDays(days.includes(i) ? days.filter((d) => d !== i) : [...days, i].sort())} className={cn("press h-9 rounded-full border px-3 text-xs font-semibold capitalize", days.includes(i) ? "border-primary bg-primary text-primary-foreground" : "border-border bg-surface-raised")}>{w.slice(0, 3)}</button>
              ))}
            </div>
          </Field>
          <Field label="Amostra mínima para rankings" hint="Grupos (região, categoria, dia) com menos visitas não são ranqueados."><NumberInput value={minSample} onChange={setMinSample} suffix="visitas" /></Field>
          <Button onClick={async () => { await updateSettings({ workWeekdays: days, minSample: Math.max(1, Math.round(minSample ?? 10)) }, "Parâmetros de análise alterados"); toast.success("Salvo"); }}>Salvar</Button>
        </div>
      </Card>

      <Card title="Aparência">
        <Chips options={[{ value: "dark", label: <span className="inline-flex items-center gap-1.5"><Moon className="h-4 w-4" />Escuro</span> }, { value: "light", label: <span className="inline-flex items-center gap-1.5"><Sun className="h-4 w-4" />Claro (sol forte)</span> }]} value={settings.appearance} onChange={(v) => updateSettings({ appearance: v })} />
      </Card>

      <Card title="Dados demonstrativos" subtitle="Registros fictícios, marcados como “Demonstração”, que nunca se misturam com os reais.">
        <div className="space-y-3">
          <Chips options={[{ value: "real", label: "Ver dados reais" }, { value: "demo", label: "Ver demonstração" }]} value={settings.viewMode} onChange={async (v) => { if (v === "demo" && !demoCount) { await seedDemo(); setDemoCount(await countDemo()); } await updateSettings({ viewMode: v }); toast.success(v === "demo" ? "Modo demonstração" : "Dados reais"); }} />
          <p className="text-xs text-subtle">{demoCount ? `${demoCount} registros de demonstração armazenados.` : "Nenhum dado de demonstração. Ao escolher “Ver demonstração”, eles são criados."}</p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={async () => { await seedDemo(); setDemoCount(await countDemo()); toast.success("Demonstração recriada"); }}><FlaskConical className="h-4 w-4" />Recriar demonstração</Button>
            <Button variant="ghost" className="text-bad" disabled={!demoCount} onClick={() => setConfirmRemove(true)}><Trash2 className="h-4 w-4" />Remover demonstração</Button>
          </div>
        </div>
      </Card>

      <Card title="Backup e armazenamento" subtitle="Os dados ficam neste navegador. Não há sincronização com nuvem.">
        <div className="space-y-3 text-sm">
          <div className="flex items-center gap-2 text-muted"><HardDrive className="h-4 w-4" />Último backup: {settings.lastBackupAt ? fmtDateTime(settings.lastBackupAt) : "nunca"}</div>
          <div className="flex items-center gap-2 text-muted"><ShieldCheck className="h-4 w-4" />Armazenamento persistente: {persisted == null ? "não suportado" : persisted ? "concedido" : "não concedido"}
            {persisted === false && <Button size="sm" variant="soft" onClick={async () => { const ok = await navigator.storage?.persist?.(); await updateSettings({ storagePersisted: !!ok }); toast[ok ? "success" : "info"](ok ? "Armazenamento persistente concedido" : "O navegador não concedeu. Instale o app na tela inicial e faça backups.") }}>Solicitar</Button>}
          </div>
          <p className="rounded-xl bg-warn-soft px-3 py-2 text-xs text-warn">No iPhone, o Safari pode apagar dados de sites não usados por alguns dias. Para proteger: toque em Compartilhar › <strong>Adicionar à Tela de Início</strong>, use o app por lá e faça backup regularmente. O backup também serve para levar os dados ao computador.</p>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="primary" onClick={doBackup}><Download className="h-4 w-4" />Baixar backup</Button>
            <Button onClick={() => fileRef.current?.click()}><Upload className="h-4 w-4" />Restaurar backup</Button>
          </div>
          <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={(e) => e.target.files?.[0] && onRestore(e.target.files[0])} />
        </div>
      </Card>

      <Confirm open={confirmRemove} onClose={() => setConfirmRemove(false)} danger title="Remover dados de demonstração?" confirmLabel="Remover"
        message="Apaga apenas os registros marcados como demonstração. Seus dados reais não são tocados."
        onConfirm={async () => { await clearDemo(); await updateSettings({ viewMode: "real" }); setDemoCount(0); setConfirmRemove(false); toast.success("Demonstração removida"); }} />
      <Confirm open={!!restoreFile} onClose={() => setRestoreFile(null)} danger title="Restaurar backup?" confirmLabel="Substituir dados"
        message={restoreFile && <>Todos os dados deste aparelho serão substituídos pelo backup de <strong>{fmtDateTime(restoreFile.exportedAt)}</strong> ({restoreFile.counts.sales ?? 0} vendas, {restoreFile.counts.establishments ?? 0} estabelecimentos). Faça um backup atual antes, se precisar.</>}
        onConfirm={async () => { if (!restoreFile) return; try { await restoreBackup(restoreFile); toast.success("Backup restaurado"); } catch (e) { toast.error(e instanceof Error ? e.message : "Falha ao restaurar"); } setRestoreFile(null); }} />
    </div>
  );
}

// ============================================================================ Histórico
export function HistoryPage({ isDemo }: { isDemo: boolean }) {
  const entries = useLiveQuery(() => db.audit.orderBy("at").reverse().limit(300).toArray(), []);
  const list = (entries ?? []).filter((e) => e.isDemo === isDemo);
  return (
    <Card title="Últimas alterações" subtitle="Vendas, pagamentos, estornos, cancelamentos, despesas, custos, metas e importações.">
      {list.length === 0 ? <p className="text-sm text-subtle">Nenhuma alteração registrada ainda.</p> : (
        <ul className="space-y-1.5">
          {list.map((e) => (
            <li key={e.id} className="rounded-xl bg-surface-raised px-3 py-2 text-sm">
              <div className="flex items-center justify-between gap-2"><Badge tone={e.action === "cancelar" || e.action === "excluir" || e.action === "estornar" ? "bad" : e.action === "criar" ? "ok" : "primary"}>{e.entity} · {e.action}</Badge><span className="text-xs text-subtle">{fmtDateTime(e.at)}</span></div>
              <div className="mt-1 text-muted">{e.summary}</div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ============================================================================ Definições
export function DefinitionsPage() {
  const items: [string, string][] = [
    ["Faturamento (receita líquida)", "Placas entregues × preço − descontos − estornos do período. Faturamento alto não significa lucro."],
    ["Receita bruta", "Soma de quantidade × preço unitário, antes de descontos e estornos."],
    ["Venda contratada × receita reconhecida × recebido", "Contratada: pedido válido pela data da venda. Reconhecida: pedido entregue. Recebido: dinheiro que entrou de fato (venda pendente não conta)."],
    ["CPV", "Custo unitário aplicado em cada venda × placas que saíram do estoque. Compras de estoque não são despesa: viram CPV quando a placa é vendida (sem desconto duplo)."],
    ["Margem bruta", "Receita líquida − CPV. Percentual = margem ÷ receita líquida × 100 (\"—\" se receita = 0)."],
    ["Margem de contribuição", "Receita líquida − CPV − taxas de pagamento − comissões − tributos variáveis − outros custos por pedido − transporte vinculado a vendas. Não desconta despesas fixas."],
    ["Resultado operacional estimado", "Margem de contribuição − despesas operacionais pagas no período. Não é lucro líquido contábil nem após impostos."],
    ["Ticket médio × receita por placa", "Ticket = receita líquida ÷ pedidos. Receita por placa = receita líquida ÷ placas vendidas."],
    ["Conversão", "Pedidos vinculados a visitas ÷ visitas realizadas × 100. Visitas pendentes ou “a caminho” não contam; estabelecimento fechado também não entra no denominador."],
    ["Taxa de contato e de demonstração", "Visitas em que você falou com o responsável (ou fez demonstração) ÷ visitas realizadas."],
    ["CAC simplificado", "Despesas comerciais pagas (Uber, transporte público, alimentação em campo, materiais de demonstração, marketing) ÷ clientes novos do período. Sem clientes novos: dados insuficientes."],
    ["Ponto de equilíbrio", "Despesas operacionais do período ÷ margem de contribuição %. Premissa: despesas operacionais do período tratadas como fixas. Não existe se a margem for zero ou negativa."],
    ["Produtividade", "Por hora usa as horas de jornada registradas nas rotas (início/fim ou manual)."],
    ["Projeção do mês", "Média por dia com atividade × dias de trabalho restantes. Mostra quantos dias foram considerados e a confiança. É projeção, não resultado."],
    ["Custo pendente", "Enquanto o custo da placa não for informado, margens e resultados aparecem como “Pendente” (o valor mostrado não inclui o custo das placas)."],
    ["Semáforo", "Cores definidas por regras numéricas editáveis em Metas. Sem dados = neutro."],
    ["Distâncias e mapa", "Não há API de rotas configurada: distâncias importadas são estimativas não verificadas. A navegação abre o Google Maps com a rota real."],
    ["Dados demonstrativos", "Fictícios, marcados como demonstração, nunca somados aos reais; podem ser removidos."],
  ];
  return (
    <div className="space-y-2">
      {items.map(([k, v]) => (
        <Card key={k}><div className="text-sm font-bold">{k}</div><p className="mt-1 text-sm text-muted">{v}</p></Card>
      ))}
    </div>
  );
}
