import { useLiveQuery } from "dexie-react-hooks";
import { useMemo } from "react";
import { db } from "@/db/db";
import type { Settings } from "@/db/types";
import { defaultSettings } from "@/db/actions";
import type { Dataset } from "@/lib/finance/engine";

/**
 * Carrega os dados do modo atual (real OU demonstração — nunca os dois).
 * Os volumes são pequenos (centenas/milhares de linhas), então tudo fica em memória e
 * os indicadores são recalculados pelo motor financeiro a cada alteração.
 */
export function useSettings(): Settings | undefined {
  return useLiveQuery(() => db.settings.get("app").then((s) => s ?? defaultSettings()), []);
}

export function useAppData() {
  const settings = useSettings();
  const mode = settings?.viewMode ?? "real";
  const isDemo = mode === "demo";
  const raw = useLiveQuery(async () => {
    const f = <T extends { isDemo: boolean; deletedAt?: string | null }>(xs: T[]) => xs.filter((x) => x.isDemo === isDemo && !x.deletedAt);
    const [establishments, routes, stops, visits, sales, payments, expenses, costProfiles, stockLots, stockMoves, goals, products] = await Promise.all([
      db.establishments.toArray(), db.routes.toArray(), db.stops.toArray(), db.visits.toArray(), db.sales.toArray(),
      db.payments.toArray(), db.expenses.toArray(), db.costProfiles.toArray(), db.stockLots.toArray(), db.stockMoves.toArray(),
      db.goals.toArray(), db.products.toArray(),
    ]);
    return {
      establishments: f(establishments), routes: f(routes), stops: f(stops), visits: f(visits),
      sales: sales.filter((s) => s.isDemo === isDemo && !s.deletedAt), // canceladas ficam (histórico); o motor as ignora
      payments: f(payments), expenses: f(expenses), costProfiles: f(costProfiles), stockLots: f(stockLots), stockMoves: f(stockMoves),
      goals, products,
    };
  }, [isDemo]);
  const ds: Dataset | undefined = useMemo(
    () => raw && { sales: raw.sales, payments: raw.payments, expenses: raw.expenses, visits: raw.visits, routes: raw.routes, stockLots: raw.stockLots },
    [raw],
  );
  return { settings, isDemo, data: raw, ds, loading: !settings || !raw };
}

export type AppData = NonNullable<ReturnType<typeof useAppData>["data"]>;
