import { Component, useEffect, type ReactNode } from "react";
import { Toaster } from "sonner";
import { AlertTriangle } from "lucide-react";
import { useAppData } from "@/hooks/useData";
import { useHashRoute } from "@/hooks/useHashRoute";
import { ensureSetup, updateSettings } from "@/db/actions";
import { AppShell, MAIN_NAV, MORE_NAV } from "@/components/layout/AppShell";
import { UIProvider } from "@/components/UIProvider";
import { Button, Spinner } from "@/components/ui";
import { Overview } from "@/pages/Overview";
import { RoutesList, RouteDetail } from "@/pages/Routes";
import { SalesPage } from "@/pages/Sales";
import { FinancePage, Simulator } from "@/pages/Finance";
import { IntelPage } from "@/pages/Intel";
import { GoalsPage } from "@/pages/Goals";
import { ImportPage } from "@/pages/Import";
import { EstablishmentsPage, SettingsPage, HistoryPage, DefinitionsPage } from "@/pages/More";
import { fmtLong } from "@/lib/dates";

const setupPromise = ensureSetup();

export default function App() {
  return (
    <ErrorBoundary>
      <Root />
      <Toaster position="top-center" richColors closeButton toastOptions={{ style: { borderRadius: 16 } }} />
    </ErrorBoundary>
  );
}

function Root() {
  const { settings, data, ds, loading, isDemo } = useAppData();
  const parts = useHashRoute();
  useEffect(() => {
    setupPromise.then(async () => {
      if (navigator.storage?.persisted && !(await navigator.storage.persisted()) && navigator.storage.persist) {
        const ok = await navigator.storage.persist().catch(() => false);
        await updateSettings({ storagePersisted: ok });
      } else if (navigator.storage?.persisted) {
        await updateSettings({ storagePersisted: await navigator.storage.persisted() });
      }
    });
  }, []);
  useEffect(() => {
    if (settings) document.documentElement.dataset.appearance = settings.appearance;
  }, [settings?.appearance]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading || !settings || !data || !ds) return <Spinner />;
  const [section = "inicio", p1, p2] = parts;
  const main = MAIN_NAV.find((n) => n.key === section);
  const more = MORE_NAV.find((n) => n.key === section);
  let title = main?.label ?? more?.label ?? "Vendas NFC";
  let subtitle: ReactNode = undefined;
  let page: ReactNode;
  switch (section) {
    case "inicio":
      title = "Visão geral";
      subtitle = `${data.establishments.length} estabelecimentos · ${data.routes.length} rotas · ${fmtLong(new Date())}`;
      page = <Overview data={data} ds={ds} settings={settings} />;
      break;
    case "rotas":
      if (p1) {
        const r = data.routes.find((x) => x.id === p1);
        title = r?.name ?? "Rota";
        subtitle = <button className="text-primary" onClick={() => (window.location.hash = "#/rotas")}>← Todas as rotas</button>;
        page = <RouteDetail id={p1} focusStop={p2} data={data} settings={settings} isDemo={isDemo} />;
      } else {
        subtitle = "Roteiros por dia, paradas e retornos";
        page = <RoutesList data={data} isDemo={isDemo} />;
      }
      break;
    case "vendas":
      subtitle = "Registre em poucos toques; contratado, reconhecido e recebido separados";
      page = <SalesPage data={data} settings={settings} />;
      break;
    case "financas":
      subtitle = "Resultado, despesas, custos, estoque, transporte e simulador";
      page = <FinancePage tab={p1} data={data} ds={ds} settings={settings} isDemo={isDemo} />;
      break;
    case "inteligencia":
      subtitle = "Onde e como você vende melhor (com tamanho de amostra)";
      page = <IntelPage data={data} ds={ds} settings={settings} />;
      break;
    case "metas":
      subtitle = "Regras numéricas editáveis por dia, semana e mês";
      page = <GoalsPage data={data} ds={ds} settings={settings} />;
      break;
    case "simulador":
      subtitle = "Preço, custo, descontos e metas";
      page = <Simulator data={data} settings={settings} />;
      break;
    case "importar":
      subtitle = "CSV/XLSX com prévia, mapeamento e sem duplicar";
      page = <ImportPage data={data} isDemo={isDemo} />;
      break;
    case "estabelecimentos":
      subtitle = "Base de prospecção";
      page = <EstablishmentsPage data={data} isDemo={isDemo} openId={p1} />;
      break;
    case "configuracoes":
      subtitle = "Preço, análises, aparência, demonstração e backup";
      page = <SettingsPage settings={settings} />;
      break;
    case "historico":
      page = <HistoryPage isDemo={isDemo} />;
      break;
    case "definicoes":
      subtitle = "Fórmulas e premissas usadas em todo o app";
      page = <DefinitionsPage />;
      break;
    default:
      title = "Página não encontrada";
      page = <Button onClick={() => (window.location.hash = "#/inicio")}>Ir para o início</Button>;
  }
  return (
    <UIProvider data={data} settings={settings} isDemo={isDemo}>
      <AppShell section={section} title={title} subtitle={subtitle} data={data} settings={settings} isDemo={isDemo}>
        <div key={`${section}/${p1 ?? ""}`} className="animate-fade-in">{page}</div>
      </AppShell>
    </UIProvider>
  );
}

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="grid min-h-dvh place-items-center p-6 text-center">
        <div className="max-w-sm">
          <AlertTriangle className="mx-auto h-10 w-10 text-warn" />
          <h1 className="mt-3 text-lg font-bold">Algo deu errado nesta tela</h1>
          <p className="mt-1 text-sm text-muted">Seus dados continuam salvos neste aparelho. Detalhe: {this.state.error.message}</p>
          <Button className="mt-4" variant="primary" onClick={() => { window.location.hash = "#/inicio"; window.location.reload(); }}>Recarregar</Button>
        </div>
      </div>
    );
  }
}
