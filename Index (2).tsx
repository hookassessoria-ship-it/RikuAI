import { useState, useEffect } from "react";
import { LayoutDashboard, Plus, Receipt, Sparkles, BookOpen, Settings as SettingsIcon, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useFinance } from "@/hooks/useFinance";
import { hasLegacyLocalData } from "@/hooks/useFinance";
import { Dashboard, formatBRL } from "@/components/finance/Dashboard";
import { AddTransaction } from "@/components/finance/AddTransaction";
import { BillsList } from "@/components/finance/BillsList";
import { TransactionList } from "@/components/finance/TransactionList";
import { CategoryChart, DonutChart } from "@/components/finance/CategoryChart";
import { SpendingLineChart } from "@/components/finance/SpendingLineChart";
import { InsightCard } from "@/components/finance/InsightCard";
import { FinancialPlan } from "@/components/finance/FinancialPlan";
import { Advisor } from "@/components/finance/Advisor";
import { SettingsPanel } from "@/components/finance/SettingsPanel";
import { NotificationBell, useAlerts } from "@/components/finance/NotificationCenter";
import { WelcomeModal } from "@/components/finance/WelcomeModal";
import { MonthlyHistory } from "@/components/finance/MonthlyHistory";
import { WorkspaceSwitcher } from "@/components/finance/WorkspaceSwitcher";
import { ImportLegacyModal } from "@/components/finance/ImportLegacyModal";
import { DreamsTab } from "@/components/finance/DreamsTab";

import { useT, setLanguage, getLanguage } from "@/lib/i18n";
import { Sparkle } from "lucide-react";

type Tab = "dashboard" | "add" | "bills" | "plan" | "advisor" | "dreams";

import { useIsPremium } from "@/hooks/useIsPremium";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

export default function Index() {
  const [activeTab, setActiveTab]   = useState<Tab>("dashboard");
  const [showSettings, setShowSettings] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const navigate = useNavigate();
  const f = useFinance();
  const t = useT();
  const { subscriptionActive } = useIsPremium(f.settings.isPremium);

  const tabs = [
    { id: "dashboard" as Tab, label: t("nav_home"),    icon: LayoutDashboard },
    { id: "bills"     as Tab, label: t("nav_bills"),   icon: Receipt },
    { id: "add"       as Tab, label: t("nav_add"),     icon: Plus },
    { id: "plan"      as Tab, label: t("nav_plan"),    icon: BookOpen },
    { id: "dreams"    as Tab, label: t("nav_dreams"),  icon: Sparkle },
    { id: "advisor"   as Tab, label: t("nav_advisor"), icon: Sparkles },
  ];

  // Sincroniza a assinatura real com o flag local imediatamente (sem reload).
  useEffect(() => {
    if (subscriptionActive && !f.settings.isPremium) {
      f.updateSettings({ isPremium: true });
    }
  }, [subscriptionActive, f.settings.isPremium]);

  // Verifica onboarding + carrega preferências de formatação.
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) return;
      supabase.from("profiles").select("onboarded, language, currency").eq("id", data.user.id).maybeSingle()
        .then(async ({ data: p }) => {
          if (!p) return;
          if (p.onboarded === false) { navigate("/onboarding", { replace: true }); return; }
          setLanguage((p.language as any) || "pt-BR", (p.currency as any) || "BRL");
        });
    });
  }, [navigate]);

  // Show import modal once when workspace is ready and legacy data exists
  useEffect(() => {
    if (!f.loading && hasLegacyLocalData()) setShowImport(true);
  }, [f.loading]);

  const alerts = useAlerts({
    bills: f.bills, balance: f.balance, dailyGoal: f.dailyGoal,
    totalIncome: f.totalIncome, remainingDays: f.remainingDays, today: f.today,
    settings: f.settings,
  });

  const now       = new Date();
  const locale    = getLanguage();
  const dayName   = new Intl.DateTimeFormat(locale, { weekday: "long" }).format(now);
  const monthName = new Intl.DateTimeFormat(locale, { month: "long" }).format(now);
  const dayNum    = now.getDate();
  const year      = now.getFullYear();

  if (f.loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col max-w-md mx-auto relative">

      {showImport && (
        <ImportLegacyModal
          onImport={() => { f.importFromLocalStorage(); setShowImport(false); toast.success("Dados importados"); }}
          onDismiss={() => { f.dismissLegacy(); setShowImport(false); }}
        />
      )}
      {!f.welcomeShown && !showImport && <WelcomeModal onClose={f.markWelcomeShown} />}
      {showSettings && (
        <SettingsPanel settings={f.settings} onUpdate={f.updateSettings} onClose={() => setShowSettings(false)} />
      )}

      {/* Header */}
      <header className="px-5 pt-10 pb-4 flex-shrink-0">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-[11px] font-bold text-muted-custom uppercase tracking-widest">
              {dayName}
            </p>
            <h1 className="text-2xl font-black text-foreground mt-0.5 tracking-tight">
              {f.settings.userName === "Você" || !f.settings.userName
                ? t("greeting_default")
                : t("greeting_hello", { name: f.settings.userName })}
            </h1>
            <p className="text-xs text-muted-custom mt-0.5">{new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", year: "numeric" }).format(now)}</p>
          </div>
          <div className="flex items-center gap-1">
            <WorkspaceSwitcher />
            <NotificationBell alerts={alerts} />
            <button onClick={() => setShowSettings(true)} className="p-2 rounded-xl hover:bg-surface">
              <SettingsIcon className="w-5 h-5 text-foreground" />
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto px-5 pb-36">

        {activeTab === "dashboard" && (
          <>
            <Dashboard
              balance={f.balance}
              realAvailable={f.realAvailable}
              projectedBalance7d={f.projectedBalance7d}
              initialBalance={f.initialBalance}
              totalIncome={f.totalIncome}
              totalExpenses={f.totalExpenses}
              netResult={f.netResult}
              totalDebtsMonth={f.totalDebtsMonth}
              amountRemainingToPay={f.amountRemainingToPay}
              dailyGoal={f.dailyGoal}
              debtCoveragePercent={f.debtCoveragePercent}
              isOK={f.isOK}
              remainingDays={f.remainingDays}
              today={f.today}
              lastDayOfMonth={f.lastDayOfMonth}
              overdueAmount={f.overdueAmount}
              overdueCount={f.overdueBills.length}
              dueTodayAmount={f.dueTodayAmount}
              dueTodayCount={f.dueTodayBills.length}
              dueIn7DaysAmount={f.dueIn7DaysAmount}
              dueThisWeek={f.dueThisWeek}
              totalCardInvoices={f.totalCardInvoices}
              totalCardLimit={f.totalCardLimit}
              creditCards={f.creditCards}
              healthScore={f.healthScore}
              onUpdateInitialBalance={f.updateInitialBalance}
            />

            <div className="mt-4">
              <InsightCard
                topCategory={f.topCategory}
                isBesteirasHigh={f.isBesteirasHigh}
                besteirasAmount={f.besteirasAmount}
                netResult={f.netResult}
                totalExpenses={f.totalExpenses}
              />
            </div>

            <div className="mt-4 rounded-2xl p-4 shadow-card border border-border/60 gradient-card">
              <p className="text-xs font-bold text-muted-custom uppercase tracking-widest mb-3">📈 Gastos e Receitas por Dia</p>
              <SpendingLineChart data={f.spendingByDay} />
            </div>

            <div className="mt-4 rounded-2xl p-4 shadow-card border border-border/60 gradient-card">
              <p className="text-xs font-bold text-muted-custom uppercase tracking-widest mb-3">💸 Onde o Dinheiro Vai</p>
              <CategoryChart data={f.expenseChartData} />
            </div>

            <div className="mt-4 rounded-2xl p-4 shadow-card border border-border/60 gradient-card">
              <p className="text-xs font-bold text-muted-custom uppercase tracking-widest mb-3">💰 De Onde Vem o Dinheiro</p>
              <DonutChart data={f.incomeChartData} type="income" title="Total Receitas" emptyText="Nenhuma receita registrada" />
            </div>

            <div className="mt-4">
              <MonthlyHistory data={f.monthlyHistory} />
            </div>

            <TransactionList transactions={f.transactions} onDelete={f.deleteTransaction} />
          </>
        )}


        {activeTab === "add" && (
          <AddTransaction
            creditCards={f.creditCards}
            customIncomeCategories={f.settings.customIncomeCategories}
            customExpenseCategories={f.settings.customExpenseCategories}
            onAdd={(t) => {
              f.addTransaction(t);
              const newBal = f.balance + (t.type === "receita" ? t.amount : -t.amount);
              toast.success(`${t.type === "receita" ? "Receita" : "Despesa"} lançada`, {
                description: `Novo saldo estimado: ${formatBRL(newBal)}`,
              });
              setActiveTab("dashboard");
            }}
          />
        )}

        {activeTab === "bills" && (
          <BillsList
            bills={f.bills}
            onAdd={f.addBill}
            onTogglePaid={(id) => {
              const b = f.bills.find((x) => x.id === id);
              f.toggleBillPaid(id);
              if (b && !b.paid) {
                toast.success(`${b.name} marcada como paga`, { description: `${formatBRL(b.amount)} debitado do saldo` });
              }
            }}
            onDelete={f.deleteBill}
            onUpdate={f.updateBill}
          />
        )}

        {activeTab === "plan" && (
          <FinancialPlan
            planRule={f.planRule}
            totalIncome={f.totalIncome}
            expectedIncome={f.settings.expectedIncome}
            emergencyGoal={f.emergencyGoal}
            emergencyProgress={f.emergencyProgress}
            emergencyReserveSaved={f.settings.emergencyReserveSaved}
            fixedCostsMonth={f.fixedCostsMonth}
            recurringFixedBase={f.recurringFixedBase}
            emergencyAutoGoal={f.emergencyAutoGoal}
            emergencyMonthsGoal={f.settings.emergencyMonthsGoal ?? 6}
            emergencyCustomGoal={f.settings.emergencyCustomGoal ?? null}
            investedThisMonth={f.investedThisMonth}
            dividasAtrasadas={f.dividasAtrasadas}
            onUpdateSettings={f.updateSettings}
            onUpdateBill={f.updateBill}
          />
        )}

        {activeTab === "advisor" && (
          <Advisor
            messages={f.advisorMessages}
            setMessages={f.setAdvisorMessages}
            onClear={f.clearAdvisor}
            buildContext={f.buildAdvisorContext}
            personality={f.settings.aiPersonality}
          />
        )}

        {activeTab === "dreams" && <DreamsTab />}
      </main>

      {/* Bottom Nav */}
      <nav className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-md px-4 pb-6 pt-2">
        <div className="rounded-2xl border border-border/60 flex items-center p-1.5 backdrop-blur-xl shadow-card"
          style={{ background: "hsl(var(--surface) / 0.96)" }}>
          {tabs.map((tab) => {
            const Icon     = tab.icon;
            const isActive = activeTab === tab.id;
            const isAdd    = tab.id === "add";
            return (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "flex-1 flex flex-col items-center justify-center gap-1 py-2.5 rounded-xl transition-all",
                  isAdd ? "bg-primary" : isActive ? "bg-surface-overlay" : "hover:bg-surface-raised",
                )}
                style={isAdd && isActive ? { boxShadow: "0 0 16px hsl(var(--primary) / 0.5)" } : {}}>
                <Icon className={cn(
                  "w-5 h-5",
                  isAdd ? "text-background" : isActive ? "text-primary" : "text-muted-custom",
                )} />
                <span className={cn(
                  "text-[10px] font-bold tracking-wide",
                  isAdd ? "text-background" : isActive ? "text-primary" : "text-muted-custom",
                )}>
                  {tab.label}
                </span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
