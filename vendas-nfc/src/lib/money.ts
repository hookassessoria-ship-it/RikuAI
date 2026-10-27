/** Valores monetários são sempre inteiros em centavos para evitar erro de ponto flutuante. */
export type Cents = number;

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const brlCompact = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

export const toCents = (reais: number): Cents => Math.round(reais * 100);
export const toReais = (c: Cents): number => c / 100;

export function formatBRL(c: Cents | null | undefined, opts: { compact?: boolean; sign?: boolean } = {}): string {
  if (c == null || Number.isNaN(c)) return "—";
  const f = opts.compact && Math.abs(c) >= 100000 ? brlCompact : brl;
  const s = f.format(c / 100);
  return opts.sign && c > 0 ? `+${s}` : s;
}

/** Aceita "69,90", "R$ 1.234,56", "69.90", "1234". Retorna null se inválido. */
export function parseBRL(input: string | number | null | undefined): Cents | null {
  if (input == null) return null;
  if (typeof input === "number") return Number.isFinite(input) ? toCents(input) : null;
  let s = input.replace(/[R$\s]/g, "").trim();
  if (!s) return null;
  const neg = s.startsWith("-");
  s = s.replace(/^-/, "");
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  else if ((s.match(/\./g) || []).length > 1) s = s.replace(/\./g, "");
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const v = toCents(parseFloat(s));
  return neg ? -v : v;
}

export function parseNumber(input: string | number | null | undefined): number | null {
  if (input == null || input === "") return null;
  if (typeof input === "number") return Number.isFinite(input) ? input : null;
  const s = input.replace("%", "").replace(/\s/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function formatPct(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: digits })}%`;
}

export function formatNumber(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toLocaleString("pt-BR", { maximumFractionDigits: digits });
}

/** Valor de entrada (centavos) para string editável "69,90". */
export const centsToInput = (c: Cents | null | undefined): string =>
  c == null ? "" : (c / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/\./g, "");
