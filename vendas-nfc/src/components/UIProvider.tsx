import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { AppData } from "@/hooks/useData";
import type { Settings, Stop, StopStatus, ExpenseCategory } from "@/db/types";
import { SaleSheet, type SaleContext } from "./sheets/SaleSheet";
import { ExpenseSheet, StatusSheet, VisitSheet, FollowUpSheet, applyStopStatus } from "./sheets/OtherSheets";
import { dayKey } from "@/lib/dates";

interface UIApi {
  openSale: (ctx?: SaleContext) => void;
  openExpense: (defaults?: { category?: ExpenseCategory; routeId?: string | null; status?: "pago" | "previsto" }) => void;
  openVisit: () => void;
  openFollowUp: (establishmentId?: string | null) => void;
  openStopStatus: (stop: Stop, focus?: StopStatus | null) => void;
  nextStop: { stop: Stop; routeId: string } | null;
}
const Ctx = createContext<UIApi | null>(null);
export const useUI = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error("UIProvider ausente");
  return c;
};

/** Rota ativa: a de hoje; senão a próxima com paradas pendentes; senão a mais recente com pendências. */
export function activeRoute(data: AppData) {
  const today = dayKey(new Date());
  const pendingOf = (rid: string) => data.stops.filter((s) => s.routeId === rid && (s.status === "pendente" || s.status === "a_caminho"));
  const sorted = [...data.routes].sort((a, b) => a.date.localeCompare(b.date));
  return (
    sorted.find((r) => r.date === today) ??
    sorted.find((r) => r.date > today && pendingOf(r.id).length) ??
    [...sorted].reverse().find((r) => pendingOf(r.id).length) ??
    null
  );
}

export function UIProvider({ data, settings, isDemo, children }: { data: AppData; settings: Settings; isDemo: boolean; children: ReactNode }) {
  const [sale, setSale] = useState<SaleContext | null>(null);
  const [expense, setExpense] = useState<null | { category?: ExpenseCategory; routeId?: string | null; status?: "pago" | "previsto" }>(null);
  const [visit, setVisit] = useState(false);
  const [follow, setFollow] = useState<{ id: string | null } | null>(null);
  const [statusFor, setStatusFor] = useState<{ stop: Stop; focus: StopStatus | null } | null>(null);

  const nextStop = useMemo(() => {
    const r = activeRoute(data);
    if (!r) return null;
    const s = data.stops.filter((x) => x.routeId === r.id).sort((a, b) => a.order - b.order).find((x) => x.status === "pendente" || x.status === "a_caminho");
    return s ? { stop: s, routeId: r.id } : null;
  }, [data]);

  const api: UIApi = {
    openSale: (ctx = {}) => setSale(ctx),
    openExpense: (d = {}) => setExpense(d),
    openVisit: () => setVisit(true),
    openFollowUp: (id = null) => setFollow({ id }),
    openStopStatus: (stop, focus = null) => setStatusFor({ stop, focus }),
    nextStop,
  };
  const est = statusFor ? data.establishments.find((e) => e.id === statusFor.stop.establishmentId) : undefined;

  return (
    <Ctx.Provider value={api}>
      {children}
      <SaleSheet open={!!sale} onClose={() => setSale(null)} ctx={sale ?? {}} data={data} settings={settings} isDemo={isDemo} />
      <ExpenseSheet open={!!expense} onClose={() => setExpense(null)} data={data} isDemo={isDemo} defaults={expense ?? undefined} />
      <VisitSheet open={visit} onClose={() => setVisit(false)} data={data} isDemo={isDemo} onSale={(id) => { setVisit(false); setSale({ establishmentId: id, recordVisit: true }); }} />
      <FollowUpSheet open={!!follow} onClose={() => setFollow(null)} data={data} isDemo={isDemo} establishmentId={follow?.id} />
      <StatusSheet
        open={!!statusFor}
        onClose={() => setStatusFor(null)}
        title={est?.name ?? "Parada"}
        current={statusFor?.stop.status}
        initialFocus={statusFor?.focus}
        onPick={async (s, extra) => {
          if (!statusFor) return;
          const stop = statusFor.stop;
          if (s === "venda") {
            setSale({ establishmentId: stop.establishmentId, stopId: stop.id, routeId: stop.routeId });
            return;
          }
          await applyStopStatus(stop.id, s, extra);
        }}
      />
    </Ctx.Provider>
  );
}
