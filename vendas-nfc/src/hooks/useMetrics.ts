import { useMemo } from "react";
import type { Dataset } from "@/lib/finance/engine";
import { aggregate, dailySeries } from "@/lib/finance/engine";
import { periodRange, previousRange, PERIOD_LABELS, type PeriodKey, type Granularity, type Range } from "@/lib/dates";
import type { GoalPeriod, GoalRule } from "@/db/types";
import { evaluate, findRule, indicatorByKey } from "@/lib/finance/goals";
import type { Summary } from "@/lib/finance/engine";

export function useMetrics(ds: Dataset | undefined, period: PeriodKey) {
  return useMemo(() => {
    if (!ds) return null;
    const now = new Date();
    const range = periodRange(period, now);
    const prevRange = previousRange(period, now);
    const summary = aggregate(ds, range);
    const prev = prevRange ? aggregate(ds, prevRange) : null;
    // Para "todo o histórico", a série começa no primeiro registro (evita milhares de dias vazios).
    let seriesRange: Range = range;
    if (period === "tudo") {
      const dates = [...ds.sales.map((s) => s.at), ...ds.visits.map((v) => v.at), ...ds.expenses.map((e) => e.at)].filter(Boolean).sort();
      if (dates.length) seriesRange = { start: new Date(new Date(dates[0]).setHours(0, 0, 0, 0)), end: range.end };
    }
    const series = dailySeries(ds, seriesRange);
    return { range, prevRange, summary, prev, series, label: PERIOD_LABELS[period], granularity: range.granularity };
  }, [ds, period]);
}

export const goalPeriodOf = (g: Granularity, period: PeriodKey): GoalPeriod | null => (period === "tudo" ? null : g);

export function evalFor(key: string, rules: GoalRule[], gp: GoalPeriod | null, s: Summary, budgetPct: number | null = null) {
  const def = indicatorByKey(key);
  if (!def) return null;
  const rule = gp ? findRule(rules, key, gp) : undefined;
  return evaluate(def, rule, def.read(s, { transportBudgetUsedPct: budgetPct }));
}
