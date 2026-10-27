import { useMemo, useRef, useState } from "react";
import { FileUp, FileSpreadsheet, CheckCircle2, AlertTriangle, Download, Database } from "lucide-react";
import { toast } from "sonner";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/db/db";
import type { AppData } from "@/hooks/useData";
import { FIELDS, autoMap, parseRows, detectRoutes, summarize, readFileTables, parseCsvText, sheetsToTables, type RawTable, type Mapping, type ParsedRow } from "@/lib/import/parse";
import { commitImport, type CommitResult } from "@/db/actions";
import { toCsv, downloadText } from "@/db/backup";
import { fmtDate, fmtDateTime } from "@/lib/dates";
import { formatBRL } from "@/lib/money";
import { STATUS_LABEL } from "@/db/types";
import { calcSale } from "@/lib/finance/engine";
import { cn } from "@/lib/utils";
import { go } from "@/hooks/useHashRoute";
import { Badge, Button, Card, Field, Select, SectionTitle, Stat, Toggle } from "@/components/ui";

const STATUS_TONE = { novo: "ok", existente: "neutral", duplicado_no_arquivo: "warn", invalido: "bad" } as const;
const STATUS_TXT = { novo: "Novo", existente: "Já existe", duplicado_no_arquivo: "Duplicado no arquivo", invalido: "Inválido" } as const;

export function ImportPage({ data, isDemo }: { data: AppData; isDemo: boolean }) {
  const [fileName, setFileName] = useState("");
  const [tables, setTables] = useState<RawTable[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Mapping | null>(null);
  const [createRoutes, setCreateRoutes] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CommitResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const realKeys = useLiveQuery(async () => new Set((await db.establishments.toArray()).filter((e) => !e.isDemo && !e.deletedAt).map((e) => e.dedupeKey)), [result]);
  const batches = useLiveQuery(() => db.importBatches.orderBy("at").reverse().toArray(), [result]);

  const load = (name: string, ts: RawTable[]) => {
    setFileName(name);
    setTables(ts);
    setResult(null);
    const withDay = ts.filter((t) => autoMap(t.headers).day != null);
    const sel = (withDay.length ? withDay : ts.slice(0, 1)).map((t) => t.name);
    setSelected(sel);
    const first = ts.find((t) => t.name === sel[0]);
    setMapping(first ? autoMap(first.headers) : null);
    if (!ts.length) toast.error("Nenhuma tabela com cabeçalho reconhecível no arquivo.");
  };
  const onFile = async (f: File) => {
    try {
      load(f.name, await readFileTables(f));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível ler o arquivo.");
    }
  };
  const loadBundled = async (kind: "csv" | "xlsx") => {
    setBusy(true);
    try {
      const url = `./dados/planilha_prospeccao.${kind}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error("Arquivo original não encontrado no app.");
      if (kind === "csv") load("planilha_prospeccao.csv", [parseCsvText(await res.text(), "planilha_prospeccao.csv")]);
      else {
        const { default: readXlsxFile } = await import("read-excel-file/browser");
        load("planilha_prospeccao.xlsx", sheetsToTables((await readXlsxFile(await res.blob())) as { sheet: string; data: unknown[][] }[]));
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao carregar o arquivo original.");
    } finally {
      setBusy(false);
    }
  };

  const chosen = tables.filter((t) => selected.includes(t.name));
  const sameHeaders = chosen.every((t) => t.headers.join("|") === chosen[0]?.headers.join("|"));
  const merged: RawTable | null = chosen.length && sameHeaders ? { name: chosen.map((t) => t.name).join(" + "), headers: chosen[0].headers, rows: chosen.flatMap((t) => t.rows) } : null;
  const rows: ParsedRow[] = useMemo(() => (merged && mapping && realKeys ? parseRows(merged, mapping, realKeys) : []), [merged, mapping, realKeys]); // eslint-disable-line react-hooks/exhaustive-deps
  const routes = useMemo(() => detectRoutes(rows), [rows]);
  const sum = summarize(rows);
  const missingRequired = mapping ? FIELDS.filter((f) => f.required && mapping[f.key] == null) : [];

  const confirm = async () => {
    setBusy(true);
    try {
      const r = await commitImport(fileName, rows, routes, { createRoutes: createRoutes && mapping?.day != null });
      setResult(r);
      toast.success("Importação concluída", { description: `${r.createdEstablishments} novos · ${r.stopsCreated} paradas` });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro na importação.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      {isDemo && <p className="rounded-xl bg-demo-soft px-3 py-2 text-sm text-demo">Você está no modo demonstração. A importação grava sempre nos dados <strong>reais</strong>.</p>}
      <Card title="1. Escolha o arquivo" subtitle="CSV ou XLSX. Os arquivos originais dos roteiros de 27 a 29/10/2026 já vêm incluídos no app.">
        <div className="grid gap-2 sm:grid-cols-3">
          <Button variant="primary" loading={busy} onClick={() => loadBundled("csv")}><FileSpreadsheet className="h-4 w-4" />Original (CSV, 88)</Button>
          <Button loading={busy} onClick={() => loadBundled("xlsx")}><FileSpreadsheet className="h-4 w-4" />Original (XLSX)</Button>
          <Button onClick={() => fileRef.current?.click()}><FileUp className="h-4 w-4" />Outro arquivo</Button>
        </div>
        <input ref={fileRef} type="file" accept=".csv,.xlsx,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
        {fileName && <p className="mt-3 text-sm text-muted">Arquivo: <strong>{fileName}</strong> · {tables.length} tabela(s) encontrada(s)</p>}
      </Card>

      {tables.length > 1 && (
        <Card title="2. Abas" subtitle="Abas com coluna “Dia” viram rotas. A aba de reservas pode ser importada só como estabelecimentos.">
          <div className="space-y-1">
            {tables.map((t) => (
              <Toggle key={t.name} checked={selected.includes(t.name)} label={`${t.name}`} hint={`${t.rows.length} linha(s)`}
                onChange={(v) => {
                  const next = v ? [...selected, t.name] : selected.filter((x) => x !== t.name);
                  setSelected(next);
                  const f = tables.find((x) => x.name === next[0]);
                  if (f) setMapping(autoMap(f.headers));
                }} />
            ))}
          </div>
          {!sameHeaders && <p className="mt-2 text-xs text-bad">As abas selecionadas têm colunas diferentes. Importe uma de cada vez.</p>}
        </Card>
      )}

      {merged && mapping && (
        <Card title={`${tables.length > 1 ? "3" : "2"}. Colunas`} subtitle="Detectadas automaticamente. Ajuste se os nomes forem diferentes.">
          <div className="grid gap-3 sm:grid-cols-2">
            {FIELDS.map((f) => (
              <Field key={f.key} label={`${f.label}${f.required ? " *" : ""}`}>
                <Select value={mapping[f.key] == null ? "" : String(mapping[f.key])} onChange={(v) => setMapping({ ...mapping, [f.key]: v === "" ? null : Number(v) })}
                  options={[{ value: "", label: "— não importar —" }, ...merged.headers.map((h, i) => ({ value: String(i), label: h || `Coluna ${i + 1}` }))]} />
              </Field>
            ))}
          </div>
          {missingRequired.length > 0 && <p className="mt-2 text-sm text-bad">Mapeie: {missingRequired.map((f) => f.label).join(", ")}.</p>}
        </Card>
      )}

      {rows.length > 0 && !result && (
        <>
          <SectionTitle>Prévia</SectionTitle>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            <Stat label="Linhas" value={sum.total} />
            <Stat label="Novos" value={sum.novos} tone="ok" />
            <Stat label="Já existentes" value={sum.existentes} sub="não serão duplicados" />
            <Stat label="Duplicados no arquivo" value={sum.duplicados} tone={sum.duplicados ? "warn" : undefined} />
            <Stat label="Inválidos" value={sum.invalidos} tone={sum.invalidos ? "bad" : undefined} sub="ignorados" />
          </div>
          {routes.length > 0 && (
            <Card title="Rotas detectadas (coluna Dia)">
              {routes.map((r) => <div key={r.key} className="flex justify-between border-b border-border py-1.5 text-sm last:border-0"><span>{r.name}<span className="text-xs text-subtle"> · {r.region}</span></span><span className="tabular text-muted">{r.date ? fmtDate(r.date) : "sem data"} · {r.stops} paradas</span></div>)}
              <Toggle checked={createRoutes} onChange={setCreateRoutes} label="Criar rotas e paradas na ordem do arquivo" hint="Rotas já importadas não são recriadas; paradas repetidas são ignoradas." />
            </Card>
          )}
          <p className="rounded-xl bg-primary-soft px-3 py-2 text-xs text-primary">Notas e avaliações do Google são importadas como <strong>não verificadas</strong>. Distâncias e tempos entre paradas ficam marcados como <strong>estimativas</strong>. Nenhuma estimativa vira dado confirmado.</p>
          <div className="card overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead><tr className="border-b border-border text-left text-[11px] font-bold uppercase text-subtle"><th className="px-3 py-2">Linha</th><th className="px-3 py-2">Situação</th><th className="px-3 py-2">Nome</th><th className="px-3 py-2">Categoria</th><th className="px-3 py-2">Endereço</th><th className="px-3 py-2">Dia/ordem</th></tr></thead>
              <tbody>
                {rows.slice(0, 120).map((r) => (
                  <tr key={r.line} className="border-b border-border last:border-0 align-top">
                    <td className="px-3 py-2 tabular text-subtle">{r.line}</td>
                    <td className="px-3 py-2"><Badge tone={STATUS_TONE[r.status]}>{STATUS_TXT[r.status]}</Badge>{r.errors.length > 0 && <div className="mt-1 text-xs text-bad">{r.errors.join(", ")}</div>}</td>
                    <td className="px-3 py-2 font-semibold">{r.name || "—"}</td>
                    <td className="px-3 py-2 text-muted">{r.category}</td>
                    <td className="px-3 py-2 text-muted">{r.address || "—"}</td>
                    <td className="px-3 py-2 text-xs text-muted">{r.date ? fmtDate(r.date) : "—"} {r.order != null && `#${r.order}`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="sticky bottom-24 z-10 lg:bottom-4">
            <Button variant="primary" size="lg" className="w-full" disabled={missingRequired.length > 0 || sum.novos + sum.existentes === 0} loading={busy} onClick={confirm}>
              <Database className="h-5 w-5" />Importar {sum.novos} novo(s){routes.length && createRoutes ? ` e ${routes.length} rota(s)` : ""}
            </Button>
          </div>
        </>
      )}

      {result && (
        <Card title="Resultado da importação">
          <div className="flex items-center gap-3"><CheckCircle2 className="h-8 w-8 text-ok" /><div className="text-sm"><strong>{result.createdEstablishments}</strong> estabelecimento(s) importado(s), <strong>{result.reusedEstablishments}</strong> já existiam (não duplicados), <strong>{result.invalid}</strong> inválido(s) ignorado(s). <strong>{result.routesCreated}</strong> rota(s) e <strong>{result.stopsCreated}</strong> parada(s) criadas{result.stopsSkipped ? `, ${result.stopsSkipped} parada(s) ignorada(s) por já existirem` : ""}.</div></div>
          {result.batch.details.length > 0 && <ul className="mt-2 list-disc pl-5 text-xs text-bad">{result.batch.details.map((d) => <li key={d}>{d}</li>)}</ul>}
          <div className="mt-3 flex gap-2"><Button variant="primary" onClick={() => go("rotas")}>Ver rotas</Button><Button onClick={() => { setTables([]); setResult(null); setFileName(""); }}>Importar outro</Button></div>
        </Card>
      )}

      <ExportCard data={data} />

      {batches && batches.length > 0 && (
        <Card title="Importações anteriores">
          {batches.map((b) => (
            <div key={b.id} className="flex items-center justify-between border-b border-border py-2 text-sm last:border-0">
              <span className="min-w-0 truncate">{b.fileName}<span className="block text-xs text-subtle">{fmtDateTime(b.at)}</span></span>
              <span className="text-right text-xs text-muted">{b.imported} novos · {b.existing} existentes · {b.invalid} inválidos<br />{b.routes} rotas · {b.stops} paradas</span>
            </div>
          ))}
        </Card>
      )}
      {!tables.length && !result && <p className={cn("px-1 text-center text-xs text-subtle")}><AlertTriangle className="mr-1 inline h-3.5 w-3.5" />Nenhum estabelecimento é criado sem a sua confirmação.</p>}
    </div>
  );
}

function ExportCard({ data }: { data: AppData }) {
  const est = () => downloadText("estabelecimentos.csv", toCsv(
    ["Nome", "Categoria", "Segmento", "Endereço", "Bairro", "Cidade", "Telefone", "Nota Google", "Avaliações", "Nota verificada", "Horário", "Prioridade", "Motivo", "Origem"],
    data.establishments.map((e) => [e.name, e.category, e.segment, e.address, e.bairro, e.city, e.phone, e.googleRating, e.googleReviews, e.ratingVerified ? "sim" : "não", e.hours, e.priority, e.priorityReason, e.origin]),
  ), "text/csv");
  const stops = () => {
    const rmap = new Map(data.routes.map((r) => [r.id, r]));
    const emap = new Map(data.establishments.map((e) => [e.id, e]));
    downloadText("rotas_e_paradas.csv", toCsv(
      ["Rota", "Data", "Ordem", "Estabelecimento", "Endereço", "Status", "Retorno", "Motivo de perda", "Distância (estimativa)", "Observações"],
      [...data.stops].sort((a, b) => (rmap.get(a.routeId)?.date ?? "").localeCompare(rmap.get(b.routeId)?.date ?? "") || a.order - b.order).map((s) => {
        const r = rmap.get(s.routeId);
        const e = emap.get(s.establishmentId);
        return [r?.name, r?.date, s.order, e?.name, e?.address, STATUS_LABEL[s.status], s.followUpAt, s.lossReason, s.legDistance, s.notes];
      }),
    ), "text/csv");
  };
  const sales = () => downloadText("vendas.csv", toCsv(
    ["Data", "Cliente", "Placas", "Preço unitário", "Desconto", "Receita líquida", "Custo unitário", "Forma", "Status pagamento", "Situação", "Recebido"],
    data.sales.map((s) => {
      const c = calcSale(s, data.payments.filter((p) => p.saleId === s.id));
      return [s.at, s.customerName, c.units, formatBRL(s.items[0]?.unitPrice), formatBRL(c.discount), formatBRL(c.net), s.items[0]?.unitCost == null ? "pendente" : formatBRL(s.items[0].unitCost), s.paymentMethod, c.paymentStatus, s.status, formatBRL(c.paid)];
    }),
  ), "text/csv");
  const expenses = () => downloadText("despesas.csv", toCsv(
    ["Data", "Categoria", "Valor", "Situação", "Estimativa", "Descrição", "Rota", "Venda vinculada"],
    data.expenses.map((e) => [e.at, e.category, formatBRL(e.amount), e.status, e.estimate == null ? "" : formatBRL(e.estimate), e.description, data.routes.find((r) => r.id === e.routeId)?.name ?? "", e.saleId ? "sim" : ""]),
  ), "text/csv");
  return (
    <Card title="Exportar dados (CSV)" subtitle="Para abrir no Excel ou Google Planilhas. O backup completo fica em Configurações.">
      <div className="grid grid-cols-2 gap-2">
        <Button onClick={est}><Download className="h-4 w-4" />Estabelecimentos</Button>
        <Button onClick={stops}><Download className="h-4 w-4" />Rotas e paradas</Button>
        <Button onClick={sales}><Download className="h-4 w-4" />Vendas</Button>
        <Button onClick={expenses}><Download className="h-4 w-4" />Despesas</Button>
      </div>
    </Card>
  );
}
