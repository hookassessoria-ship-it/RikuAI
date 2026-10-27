/** Datas: armazenadas em ISO (UTC); exibidas e agrupadas no fuso local do aparelho. */
export type DayKey = string; // YYYY-MM-DD local

const pad = (n: number) => String(n).padStart(2, "0");

export function dayKey(d: Date | string): DayKey {
  const x = typeof d === "string" ? (d.length === 10 ? parseDayKey(d) : new Date(d)) : d;
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
}
export function parseDayKey(k: DayKey): Date {
  const [y, m, d] = k.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}
export const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds());
export const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
export const startOfNextMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, 1);
export function startOfWeek(d: Date): Date {
  const s = startOfDay(d);
  const dow = (s.getDay() + 6) % 7; // segunda = 0
  return addDays(s, -dow);
}
export const daysInMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();

export interface Range {
  start: Date; // inclusivo
  end: Date; // exclusivo
}
export type PeriodKey = "hoje" | "ontem" | "7d" | "semana" | "mes" | "mes_passado" | "30d" | "tudo";
export type Granularity = "dia" | "semana" | "mes";

export const PERIOD_LABELS: Record<PeriodKey, string> = {
  hoje: "Hoje",
  ontem: "Ontem",
  "7d": "Últimos 7 dias",
  semana: "Esta semana",
  mes: "Este mês",
  mes_passado: "Mês passado",
  "30d": "Últimos 30 dias",
  tudo: "Todo o histórico",
};

export function periodRange(key: PeriodKey, now = new Date()): Range & { granularity: Granularity } {
  const today = startOfDay(now);
  switch (key) {
    case "hoje": return { start: today, end: addDays(today, 1), granularity: "dia" };
    case "ontem": return { start: addDays(today, -1), end: today, granularity: "dia" };
    case "7d": return { start: addDays(today, -6), end: addDays(today, 1), granularity: "semana" };
    case "semana": return { start: startOfWeek(now), end: addDays(today, 1), granularity: "semana" };
    case "mes": return { start: startOfMonth(now), end: addDays(today, 1), granularity: "mes" };
    case "mes_passado": {
      const s = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      return { start: s, end: startOfMonth(now), granularity: "mes" };
    }
    case "30d": return { start: addDays(today, -29), end: addDays(today, 1), granularity: "mes" };
    case "tudo": return { start: new Date(2000, 0, 1), end: addDays(today, 1), granularity: "mes" };
  }
}

/** Período anterior equivalente (mesmo número de dias decorridos). Retorna null para "tudo". */
export function previousRange(key: PeriodKey, now = new Date()): Range | null {
  const r = periodRange(key, now);
  const days = Math.round((r.end.getTime() - r.start.getTime()) / 86400000);
  switch (key) {
    case "tudo": return null;
    case "semana": {
      const s = addDays(r.start, -7);
      return { start: s, end: addDays(s, days) };
    }
    case "mes": {
      const s = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const maxEnd = startOfMonth(now);
      const e = addDays(s, days);
      return { start: s, end: e > maxEnd ? maxEnd : e };
    }
    case "mes_passado": {
      const s = new Date(now.getFullYear(), now.getMonth() - 2, 1);
      return { start: s, end: new Date(now.getFullYear(), now.getMonth() - 1, 1) };
    }
    default:
      return { start: addDays(r.start, -days), end: r.start };
  }
}

export const inRange = (iso: string | null | undefined, r: Range): boolean => {
  if (!iso) return false;
  const t = iso.length === 10 ? parseDayKey(iso).getTime() : new Date(iso).getTime();
  return t >= r.start.getTime() && t < r.end.getTime();
};

export function daysOf(r: Range): DayKey[] {
  const out: DayKey[] = [];
  for (let d = startOfDay(r.start); d < r.end; d = addDays(d, 1)) out.push(dayKey(d));
  return out;
}

const fDate = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
const fShort = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" });
const fTime = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" });
const fWeek = new Intl.DateTimeFormat("pt-BR", { weekday: "long" });
const fWeekShort = new Intl.DateTimeFormat("pt-BR", { weekday: "short" });
const fLong = new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "numeric", month: "long" });

const toDate = (v: Date | string) => (typeof v === "string" ? (v.length === 10 ? parseDayKey(v) : new Date(v)) : v);
export const fmtDate = (v: Date | string) => fDate.format(toDate(v));
export const fmtShort = (v: Date | string) => fShort.format(toDate(v));
export const fmtTime = (v: Date | string) => fTime.format(toDate(v));
export const fmtDateTime = (v: Date | string) => `${fShort.format(toDate(v))} ${fTime.format(toDate(v))}`;
export const fmtWeekday = (v: Date | string) => fWeek.format(toDate(v));
export const fmtWeekdayShort = (v: Date | string) => fWeekShort.format(toDate(v)).replace(".", "");
export const fmtLong = (v: Date | string) => fLong.format(toDate(v));
export const WEEKDAYS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

/** Valor para <input type="datetime-local"> no fuso local. */
export function toLocalInput(d: Date | string): string {
  const x = toDate(d);
  return `${dayKey(x)}T${pad(x.getHours())}:${pad(x.getMinutes())}`;
}
export const fromLocalInput = (v: string): string => new Date(v).toISOString();
export const nowIso = () => new Date().toISOString();
export const diffDays = (a: Date | string, b: Date | string) =>
  Math.round((startOfDay(toDate(b)).getTime() - startOfDay(toDate(a)).getTime()) / 86400000);
