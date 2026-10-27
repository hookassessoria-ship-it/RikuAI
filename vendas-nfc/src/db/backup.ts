/**
 * BACKUP (JSON) — única forma de levar os dados para outro aparelho, já que não há nuvem.
 * Restaurar substitui todos os dados locais pelo conteúdo do arquivo (após validação).
 */
import { db } from "./db";

export const BACKUP_TABLES = [
  "establishments", "routes", "stops", "visits", "sales", "payments", "expenses", "products",
  "costProfiles", "stockLots", "stockMoves", "goals", "settings", "audit", "importBatches",
] as const;
export const BACKUP_FORMAT = "vendas-nfc-backup";
export const BACKUP_VERSION = 1;

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  version: number;
  exportedAt: string;
  counts: Record<string, number>;
  tables: Record<string, unknown[]>;
}

export async function exportBackup(): Promise<BackupFile> {
  const tables: Record<string, unknown[]> = {};
  const counts: Record<string, number> = {};
  for (const t of BACKUP_TABLES) {
    tables[t] = await db.table(t).toArray();
    counts[t] = tables[t].length;
  }
  return { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: new Date().toISOString(), counts, tables };
}

export function validateBackup(data: unknown): string | null {
  if (!data || typeof data !== "object") return "Arquivo inválido.";
  const b = data as Partial<BackupFile>;
  if (b.format !== BACKUP_FORMAT) return "Este arquivo não é um backup do Vendas NFC.";
  if (typeof b.version !== "number" || b.version > BACKUP_VERSION) return "Versão de backup não suportada.";
  if (!b.tables || typeof b.tables !== "object") return "Backup sem tabelas.";
  for (const [k, v] of Object.entries(b.tables)) {
    if (!(BACKUP_TABLES as readonly string[]).includes(k)) return `Tabela desconhecida no backup: ${k}`;
    if (!Array.isArray(v)) return `Tabela ${k} corrompida.`;
    if (v.some((row) => !row || typeof row !== "object" || typeof (row as { id?: unknown }).id !== "string")) return `Registros sem identificador na tabela ${k}.`;
  }
  return null;
}

export async function restoreBackup(data: BackupFile) {
  const err = validateBackup(data);
  if (err) throw new Error(err);
  await db.transaction("rw", BACKUP_TABLES.map((t) => db.table(t)), async () => {
    for (const t of BACKUP_TABLES) {
      await db.table(t).clear();
      const rows = data.tables[t];
      if (rows?.length) await db.table(t).bulkPut(rows);
    }
  });
}

/** CSV simples (separador ";" e BOM) para abrir no Excel/Planilhas. */
export function toCsv(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const esc = (v: string | number | null | undefined) => {
    const s = v == null ? "" : String(v);
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + [headers, ...rows].map((r) => r.map(esc).join(";")).join("\r\n");
}

export function downloadText(filename: string, text: string, type = "text/plain") {
  const blob = new Blob([text], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
