import { useState, type ReactNode } from "react";
import {
  LayoutDashboard, MapPinned, BadgeDollarSign, Wallet, Lightbulb, Plus, Gauge, Calculator, FileUp, Store, Settings as SettingsIcon,
  History, BookOpen, MoreHorizontal, HardDrive, Navigation, Receipt, CalendarClock, UserX, ThumbsDown, Footprints, FlaskConical, ClipboardCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { go } from "@/hooks/useHashRoute";
import { Badge, Sheet } from "../ui";
import { useUI } from "../UIProvider";
import type { AppData } from "@/hooks/useData";
import { mapsNavUrl, placeQuery } from "@/lib/maps";
import { applyStopStatus } from "../sheets/OtherSheets";
import { diffDays } from "@/lib/dates";
import type { Settings } from "@/db/types";

export const MAIN_NAV = [
  { key: "inicio", label: "Visão geral", short: "Início", Icon: LayoutDashboard },
  { key: "rotas", label: "Rota e prospecção", short: "Rota", Icon: MapPinned },
  { key: "vendas", label: "Vendas", short: "Vendas", Icon: BadgeDollarSign },
  { key: "financas", label: "Financeiro", short: "Finanças", Icon: Wallet },
  { key: "inteligencia", label: "Inteligência comercial", short: "Análises", Icon: Lightbulb },
] as const;

export const MORE_NAV = [
  { key: "metas", label: "Metas e semáforo", Icon: Gauge },
  { key: "simulador", label: "Simulador de preço", Icon: Calculator },
  { key: "importar", label: "Importar roteiros", Icon: FileUp },
  { key: "estabelecimentos", label: "Estabelecimentos", Icon: Store },
  { key: "configuracoes", label: "Configurações e backup", Icon: SettingsIcon },
  { key: "historico", label: "Histórico de alterações", Icon: History },
  { key: "definicoes", label: "Definições dos indicadores", Icon: BookOpen },
] as const;

export function AppShell({ section, title, subtitle, actions, children, data, settings, isDemo }: { section: string; title: string; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; data: AppData; settings: Settings; isDemo: boolean }) {
  const [more, setMore] = useState(false);
  const [quick, setQuick] = useState(false);
  const backupDays = settings.lastBackupAt ? diffDays(settings.lastBackupAt, new Date()) : null;
  const needsBackup = !!settings.lastChangeAt && (!settings.lastBackupAt || settings.lastChangeAt > settings.lastBackupAt) && (backupDays == null || backupDays >= 2);

  return (
    <div className="min-h-dvh lg:pl-64">
      {/* Sidebar (desktop) */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-border bg-surface/60 px-3 py-5 lg:flex">
        <div className="mb-6 flex items-center gap-2.5 px-2">
          <img src="./icon.svg" alt="" className="h-9 w-9 rounded-xl" />
          <div>
            <div className="text-sm font-extrabold tracking-tight">Vendas NFC</div>
            <div className="text-[11px] text-subtle">Prospecção e finanças</div>
          </div>
        </div>
        <nav className="space-y-1">
          {MAIN_NAV.map((n) => (
            <NavItem key={n.key} active={section === n.key} onClick={() => go(n.key)} Icon={n.Icon} label={n.label} />
          ))}
          <div className="px-3 pb-1 pt-4 text-[11px] font-bold uppercase tracking-wider text-subtle">Mais</div>
          {MORE_NAV.map((n) => (
            <NavItem key={n.key} active={section === n.key} onClick={() => go(n.key)} Icon={n.Icon} label={n.label} />
          ))}
        </nav>
        <div className="mt-auto px-2 text-[11px] text-subtle"><StorageNote settings={settings} /></div>
      </aside>

      {/* Header */}
      <header className="glass sticky top-0 z-20 border-b border-border/70 pt-safe">
        {isDemo && (
          <div className="flex items-center justify-center gap-2 bg-demo-soft px-3 py-1 text-xs font-bold text-demo">
            <FlaskConical className="h-3.5 w-3.5" />MODO DEMONSTRAÇÃO: números fictícios, separados dos dados reais
          </div>
        )}
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 sm:px-6">
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-xl font-extrabold tracking-tight sm:text-2xl">{title}</h1>
            {subtitle && <div className="truncate text-xs text-muted sm:text-sm">{subtitle}</div>}
          </div>
          {actions}
          <button type="button" onClick={() => setMore(true)} className="press grid h-10 w-10 place-items-center rounded-xl hover:bg-surface-raised lg:hidden" aria-label="Mais opções">
            <MoreHorizontal className="h-5 w-5" />
          </button>
        </div>
        {needsBackup && (
          <button type="button" onClick={() => go("configuracoes")} className="flex w-full items-center justify-center gap-2 bg-warn-soft px-3 py-1.5 text-xs font-semibold text-warn">
            <HardDrive className="h-3.5 w-3.5" />Dados só neste aparelho. {settings.lastBackupAt ? `Último backup há ${backupDays} dia(s).` : "Nenhum backup feito ainda."} Toque para salvar uma cópia.
          </button>
        )}
      </header>

      <main className="mx-auto max-w-6xl px-4 pb-36 pt-4 sm:px-6 lg:pb-16">{children}</main>

      {/* FAB ações rápidas */}
      <button type="button" onClick={() => setQuick(true)} aria-label="Ações rápidas"
        className="press fixed bottom-[92px] right-4 z-30 grid h-14 w-14 place-items-center rounded-2xl gradient-brand text-white shadow-[0_12px_30px_-8px_hsl(var(--primary)/0.9)] lg:bottom-8 lg:right-8">
        <Plus className="h-7 w-7" />
      </button>

      {/* Bottom nav (celular) */}
      <nav className="glass fixed inset-x-0 bottom-0 z-20 border-t border-border/70 pb-safe lg:hidden" aria-label="Navegação principal">
        <div className="mx-auto grid max-w-lg grid-cols-5 px-1 pt-1.5">
          {MAIN_NAV.map((n) => {
            const active = section === n.key;
            return (
              <button key={n.key} type="button" onClick={() => go(n.key)} aria-current={active ? "page" : undefined}
                className={cn("press flex flex-col items-center gap-0.5 rounded-xl py-1.5 text-[10.5px] font-bold", active ? "text-primary" : "text-subtle")}>
                <span className={cn("grid h-8 w-12 place-items-center rounded-full transition-colors", active && "bg-primary-soft")}><n.Icon className="h-5 w-5" /></span>
                {n.short}
              </button>
            );
          })}
        </div>
      </nav>

      <Sheet open={more} onClose={() => setMore(false)} title="Mais">
        <div className="grid grid-cols-2 gap-2 pb-2">
          {MORE_NAV.map((n) => (
            <button key={n.key} type="button" onClick={() => { setMore(false); go(n.key); }} className="press flex min-h-[64px] items-center gap-3 rounded-2xl border border-border bg-surface-raised px-3 text-left text-sm font-semibold">
              <n.Icon className="h-5 w-5 shrink-0 text-primary" />{n.label}
            </button>
          ))}
        </div>
        <div className="mt-3 text-xs text-subtle"><StorageNote settings={settings} /></div>
      </Sheet>

      <QuickActions open={quick} onClose={() => setQuick(false)} data={data} />
    </div>
  );
}

function NavItem({ active, onClick, Icon, label }: { active: boolean; onClick: () => void; Icon: typeof Plus; label: string }) {
  return (
    <button type="button" onClick={onClick} aria-current={active ? "page" : undefined}
      className={cn("press flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold transition-colors", active ? "bg-primary-soft text-primary" : "text-muted hover:bg-surface-raised hover:text-foreground")}>
      <Icon className="h-[18px] w-[18px]" />{label}
    </button>
  );
}

function StorageNote({ settings }: { settings: Settings }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <HardDrive className="h-3.5 w-3.5" />Salvo neste aparelho · sem sincronização em nuvem{settings.storagePersisted ? " · armazenamento persistente" : ""}
    </span>
  );
}

function QuickActions({ open, onClose, data }: { open: boolean; onClose: () => void; data: AppData }) {
  const ui = useUI();
  const ns = ui.nextStop;
  const est = ns ? data.establishments.find((e) => e.id === ns.stop.establishmentId) : undefined;
  const run = (fn: () => void) => () => { onClose(); fn(); };
  const items: { label: string; sub?: string; Icon: typeof Plus; onClick: () => void; disabled?: boolean; primary?: boolean }[] = [
    {
      label: "Registrar venda", Icon: BadgeDollarSign, primary: true,
      sub: ns?.stop.status === "a_caminho" ? `Em ${est?.name ?? ""}` : "Escolha o cliente",
      onClick: run(() => ui.openSale(ns?.stop.status === "a_caminho" ? { establishmentId: ns.stop.establishmentId, stopId: ns.stop.id, routeId: ns.routeId } : {})),
    },
    { label: "Registrar visita", Icon: ClipboardCheck, onClick: run(() => (ns ? ui.openStopStatus(ns.stop) : ui.openVisit())), sub: ns ? `Próxima: ${est?.name ?? ""}` : "Visita avulsa" },
    { label: "Registrar despesa", Icon: Receipt, onClick: run(() => ui.openExpense()) },
    { label: "Agendar retorno", Icon: CalendarClock, onClick: run(() => ui.openFollowUp(ns?.stop.establishmentId ?? null)) },
    { label: "Próxima parada", Icon: Footprints, onClick: run(() => ns && go(`rotas/${ns.routeId}/${ns.stop.id}`)), disabled: !ns, sub: est?.name },
    { label: "Abrir navegação", Icon: Navigation, onClick: run(() => est && window.open(mapsNavUrl(placeQuery(est)), "_blank", "noopener")), disabled: !est, sub: est ? "Google Maps a pé" : undefined },
    { label: "Responsável ausente", Icon: UserX, onClick: run(() => ns && applyStopStatus(ns.stop.id, "ausente", {})), disabled: !ns, sub: est?.name },
    { label: "Motivo de perda", Icon: ThumbsDown, onClick: run(() => ns && ui.openStopStatus(ns.stop, "sem_interesse")), disabled: !ns, sub: est?.name },
  ];
  return (
    <Sheet open={open} onClose={onClose} title="Ações rápidas" subtitle={ns ? <>Rota ativa · próxima parada: <strong>{est?.name}</strong></> : "Nenhuma rota com paradas pendentes"}>
      <div className="grid grid-cols-2 gap-2 pb-2">
        {items.map((it) => (
          <button key={it.label} type="button" onClick={it.onClick} disabled={it.disabled}
            className={cn("press flex min-h-[76px] flex-col items-start justify-center gap-1 rounded-2xl border px-3 py-2 text-left disabled:opacity-40", it.primary ? "border-primary bg-primary text-primary-foreground" : "border-border bg-surface-raised")}>
            <it.Icon className={cn("h-5 w-5", it.primary ? "text-white" : "text-primary")} />
            <span className="text-sm font-bold leading-tight">{it.label}</span>
            {it.sub && <span className={cn("line-clamp-1 text-[11px]", it.primary ? "text-white/80" : "text-subtle")}>{it.sub}</span>}
          </button>
        ))}
      </div>
      {isDemoHint(data) && <Badge tone="demo">Modo demonstração ativo</Badge>}
    </Sheet>
  );
}

const isDemoHint = (data: AppData) => data.establishments[0]?.isDemo === true;
