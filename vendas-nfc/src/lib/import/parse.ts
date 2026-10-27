/**
 * IMPORTADOR DE ROTEIROS (CSV / XLSX)
 * - Detecta colunas por sinônimos e permite remapear.
 * - Valida nome/endereço, evita duplicar estabelecimentos (chave normalizada nome + endereço).
 * - Notas/avaliações importadas NUNCA viram dado verificado; distâncias são sempre estimativas.
 */
import Papa from "papaparse";
import { norm } from "@/lib/utils";
import { segmentOf } from "@/lib/segments";

export interface RawTable {
  name: string;
  headers: string[];
  rows: string[][];
}

export type FieldKey =
  | "name" | "category" | "address" | "bairro" | "city" | "phone" | "rating" | "reviews" | "otherRating" | "hours"
  | "mapsUrl" | "priority" | "reason" | "evidence" | "sources" | "legTime" | "legDistance" | "approach" | "window"
  | "planned" | "day" | "order" | "status" | "responsible" | "notes";

export const FIELDS: { key: FieldKey; label: string; required?: boolean; aliases: string[] }[] = [
  { key: "name", label: "Nome", required: true, aliases: ["nome", "estabelecimento", "empresa", "cliente", "razao social", "nome fantasia"] },
  { key: "category", label: "Categoria", aliases: ["categoria", "segmento", "tipo", "ramo"] },
  { key: "address", label: "Endereço", required: true, aliases: ["endereco", "endereco completo", "logradouro"] },
  { key: "bairro", label: "Bairro", aliases: ["bairro", "setor"] },
  { key: "city", label: "Cidade", aliases: ["cidade", "municipio"] },
  { key: "phone", label: "Telefone", aliases: ["telefone publico", "telefone", "whatsapp", "fone", "contato"] },
  { key: "rating", label: "Nota Google", aliases: ["nota google", "nota", "avaliacao google"] },
  { key: "reviews", label: "Qtde. de avaliações", aliases: ["quantidade de avaliacoes", "avaliacoes", "numero de avaliacoes", "qtd avaliacoes"] },
  { key: "otherRating", label: "Nota em outra fonte", aliases: ["nota em outra fonte nao google", "nota em outra fonte"] },
  { key: "hours", label: "Horário", aliases: ["horario", "horario de funcionamento", "funcionamento"] },
  { key: "mapsUrl", label: "Link Google Maps", aliases: ["link google maps", "google maps", "maps", "link maps", "link"] },
  { key: "priority", label: "Prioridade", aliases: ["prioridade comercial 0 100", "prioridade comercial", "prioridade", "score"] },
  { key: "reason", label: "Motivo / justificativa", aliases: ["justificativa", "motivo", "motivo para visitar", "por que visitar"] },
  { key: "evidence", label: "Evidência de funcionamento", aliases: ["evidencia de funcionamento", "evidencia"] },
  { key: "sources", label: "Fontes", aliases: ["fontes", "fonte"] },
  { key: "legTime", label: "Tempo a pé desde a anterior", aliases: ["tempo a pe desde a visita anterior", "tempo a pe", "tempo de caminhada"] },
  { key: "legDistance", label: "Distância desde a anterior", aliases: ["distancia desde a visita anterior", "distancia"] },
  { key: "approach", label: "Tempo de abordagem", aliases: ["tempo estimado da abordagem", "tempo de abordagem"] },
  { key: "window", label: "Janela recomendada", aliases: ["janela recomendada sugestao por segmento", "janela recomendada", "horario recomendado"] },
  { key: "planned", label: "Chegada prevista", aliases: ["chegada prevista cenario realista", "chegada prevista"] },
  { key: "day", label: "Dia / rota", aliases: ["dia", "data", "rota", "roteiro"] },
  { key: "order", label: "Ordem da visita", aliases: ["ordem da visita", "ordem", "sequencia", "#"] },
  { key: "status", label: "Status da visita", aliases: ["status da visita", "status"] },
  { key: "responsible", label: "Responsável", aliases: ["nome do responsavel", "responsavel"] },
  { key: "notes", label: "Observações", aliases: ["observacoes", "observacao", "obs", "notas"] },
];

export type Mapping = Record<FieldKey, number | null>;

const cell = (v: unknown): string => {
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString();
  return String(v).trim();
};

export function parseCsvText(text: string, name = "arquivo.csv"): RawTable {
  const res = Papa.parse<string[]>(text.replace(/^﻿/, ""), { skipEmptyLines: "greedy", delimiter: "" });
  const all = (res.data as unknown[][]).map((r) => r.map(cell));
  return { name, headers: all[0] ?? [], rows: all.slice(1) };
}

/** Converte planilhas (lista de linhas) em tabelas, achando a linha de cabeçalho. */
export function sheetsToTables(sheets: { sheet: string; data: unknown[][] }[]): RawTable[] {
  const out: RawTable[] = [];
  for (const s of sheets) {
    const rows = s.data.map((r) => (r ?? []).map(cell));
    let h = rows.findIndex((r) => scoreHeader(r) >= 2);
    if (h < 0) continue;
    out.push({ name: s.sheet, headers: rows[h], rows: rows.slice(h + 1).filter((r) => r.some((c) => c !== "")) });
  }
  return out;
}

function scoreHeader(r: string[]): number {
  const hs = r.map(norm);
  return FIELDS.filter((f) => f.aliases.some((a) => hs.includes(a))).length;
}

export function autoMap(headers: string[]): Mapping {
  const hs = headers.map(norm);
  const used = new Set<number>();
  const m = {} as Mapping;
  for (const f of FIELDS) {
    let idx: number | null = null;
    for (const a of f.aliases) {
      const i = hs.findIndex((h, j) => !used.has(j) && h === a);
      if (i >= 0) { idx = i; break; }
    }
    if (idx == null) {
      for (const a of f.aliases) {
        if (a.length < 5) continue;
        const i = hs.findIndex((h, j) => !used.has(j) && h.startsWith(a));
        if (i >= 0) { idx = i; break; }
      }
    }
    if (idx != null) used.add(idx);
    m[f.key] = idx;
  }
  return m;
}

const UNCONFIRMED = /^(nao confirmad|nao verificad|nao informad|n a$|na$)/;
export function cleanText(v: string): string {
  const s = (v ?? "").trim();
  return UNCONFIRMED.test(norm(s)) || s === "—" ? "" : s;
}
const stripParen = (s: string) => s.replace(/\s*\((estimativa|rota|sugest)[^)]*\)\s*/gi, "").trim();

export function parseRating(v: string): number | null {
  const s = cleanText(v);
  if (!s) return null;
  const m = s.replace(",", ".").match(/(\d(?:\.\d)?)/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return n >= 0 && n <= 5 ? n : null;
}
export function parseIntSafe(v: string): number | null {
  const s = cleanText(v).replace(/\./g, "");
  const m = s.match(/-?\d+/);
  return m ? parseInt(m[0], 10) : null;
}

/** "Terça-feira, 27/10/2026" | "2026-10-27" | "27/10" → "2026-10-27" (ou null). */
export function parseDay(v: string, fallbackYear = new Date().getFullYear()): string | null {
  const s = (v ?? "").trim();
  let m = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/);
  if (m) {
    const y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : fallbackYear;
    return `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  return null;
}

export function dedupeKey(name: string, address: string): string {
  const n = norm(name.split(" / ")[0].split(" (")[0]).replace(/\b(ltda|me|eireli|unidade|parque amazonia|garavelo)\b/g, "").replace(/\s+/g, " ").trim();
  const a = norm(address.split(" (")[0]).replace(/\b(av|avenida|r|rua|al|alameda|qd|quadra|lt|lote|sala|n|no|cep|s n|sn)\b/g, " ").replace(/\s+/g, " ").trim();
  return `${n}|${a}`;
}

export function cityClean(c: string): string {
  return c.replace(/\s*\(.*\)\s*/, "").trim();
}

export interface ParsedRow {
  line: number;
  name: string;
  category: string;
  segment: string;
  address: string;
  bairro: string;
  city: string;
  region: string;
  phone: string;
  rating: number | null;
  reviews: number | null;
  otherRating: string;
  hours: string;
  mapsUrl: string;
  priority: number | null;
  reason: string;
  evidence: string;
  sources: string;
  legTime: string;
  legDistance: string;
  approach: string;
  window: string;
  planned: string;
  dayRaw: string;
  date: string | null;
  order: number | null;
  responsible: string;
  notes: string;
  key: string;
  errors: string[];
  warnings: string[];
  status: "novo" | "existente" | "duplicado_no_arquivo" | "invalido";
}

export function parseRows(table: RawTable, mapping: Mapping, existingKeys: Set<string>): ParsedRow[] {
  const get = (r: string[], k: FieldKey) => (mapping[k] == null ? "" : (r[mapping[k] as number] ?? "").trim());
  const seen = new Set<string>();
  return table.rows.map((r, i) => {
    const name = get(r, "name");
    const address = cleanText(get(r, "address"));
    const category = cleanText(get(r, "category")) || "Não informada";
    const bairro = cleanText(get(r, "bairro"));
    const city = cityClean(cleanText(get(r, "city")));
    const errors: string[] = [];
    const warnings: string[] = [];
    if (!name) errors.push("Nome vazio");
    if (!address) errors.push("Endereço vazio");
    if (name && name.length < 2) errors.push("Nome muito curto");
    const rating = parseRating(get(r, "rating"));
    const reviews = parseIntSafe(get(r, "reviews"));
    if (rating != null) warnings.push("Nota importada como NÃO verificada");
    const dayRaw = get(r, "day");
    const date = dayRaw ? parseDay(dayRaw) : null;
    if (dayRaw && !date) warnings.push(`Dia "${dayRaw}" sem data reconhecível: a rota será criada sem data`);
    const key = dedupeKey(name, address);
    let status: ParsedRow["status"] = "novo";
    if (errors.length) status = "invalido";
    else if (existingKeys.has(key)) status = "existente";
    else if (seen.has(key)) status = "duplicado_no_arquivo";
    if (status !== "invalido") seen.add(key);
    const prio = parseIntSafe(get(r, "priority"));
    return {
      line: i + 2, name, category, segment: segmentOf(category), address, bairro, city,
      region: [bairro, city].filter(Boolean).join(" · "),
      phone: cleanText(get(r, "phone")),
      rating, reviews: rating == null ? null : reviews,
      otherRating: cleanText(get(r, "otherRating")),
      hours: cleanText(get(r, "hours")),
      mapsUrl: get(r, "mapsUrl").startsWith("http") ? get(r, "mapsUrl") : "",
      priority: prio != null && prio >= 0 && prio <= 100 ? prio : null,
      reason: cleanText(get(r, "reason")),
      evidence: cleanText(get(r, "evidence")),
      sources: cleanText(get(r, "sources")),
      legTime: stripParen(cleanText(get(r, "legTime"))),
      legDistance: stripParen(cleanText(get(r, "legDistance"))),
      approach: cleanText(get(r, "approach")),
      window: cleanText(get(r, "window")),
      planned: cleanText(get(r, "planned")),
      dayRaw, date,
      order: parseIntSafe(get(r, "order")),
      responsible: cleanText(get(r, "responsible")),
      notes: cleanText(get(r, "notes")),
      key, errors, warnings, status,
    };
  });
}

export interface RoutePreview {
  key: string;
  name: string;
  date: string | null;
  region: string;
  stops: number;
}

export function detectRoutes(rows: ParsedRow[]): RoutePreview[] {
  const m = new Map<string, ParsedRow[]>();
  for (const r of rows) {
    if (r.status === "invalido" || !r.dayRaw) continue;
    const arr = m.get(r.dayRaw);
    if (arr) arr.push(r);
    else m.set(r.dayRaw, [r]);
  }
  return [...m.entries()].map(([k, rs]) => {
    const counts = new Map<string, number>();
    for (const r of rs) counts.set(r.region, (counts.get(r.region) ?? 0) + 1);
    const region = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
    return { key: k, name: k, date: rs[0].date, region, stops: rs.length };
  }).sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
}

export function summarize(rows: ParsedRow[]) {
  return {
    total: rows.length,
    novos: rows.filter((r) => r.status === "novo").length,
    existentes: rows.filter((r) => r.status === "existente").length,
    duplicados: rows.filter((r) => r.status === "duplicado_no_arquivo").length,
    invalidos: rows.filter((r) => r.status === "invalido").length,
  };
}

export async function readFileTables(file: File): Promise<RawTable[]> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".csv") || name.endsWith(".txt") || file.type === "text/csv") {
    return [parseCsvText(await file.text(), file.name)];
  }
  if (name.endsWith(".xlsx")) {
    const { default: readXlsxFile } = await import("read-excel-file/browser");
    const sheets = await readXlsxFile(file);
    return sheetsToTables(sheets as { sheet: string; data: unknown[][] }[]);
  }
  throw new Error("Formato não suportado. Use .csv ou .xlsx.");
}
