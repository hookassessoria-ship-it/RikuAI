import { useMemo, useState } from "react";
import { RotateCcw, Pencil } from "lucide-react";
import { toast } from "sonner";
import type { AppData } from "@/hooks/useData";
import type { Dataset } from "@/lib/finance/engine";
import type { GoalPeriod, GoalRule, Settings } from "@/db/types";
import { aggregate } from "@/lib/finance/engine";
import { INDICATORS, evaluate, findRule, formatValue, validateRule, type IndicatorDef } from "@/lib/finance/goals";
import { transportBudget } from "@/lib/finance/transport";
import { periodRange } from "@/lib/dates";
import { saveGoal, resetGoals } from "@/db/actions";
import { Badge, Button, Chips, Confirm, Field, LightBadge, NumberInput, Progress, Sheet, Toggle } from "@/components/ui";
import { LIGHT_STYLE } from "@/components/ui";
import { cn } from "@/lib/utils";

const PERIOD_KEY: Record<GoalPeriod, "hoje" | "semana" | "mes" | "tudo"> = { dia: "hoje", semana: "semana", mes: "mes", total: "tudo" };
const PERIOD_LABEL: Record<GoalPeriod, string> = { dia: "Hoje (meta diária)", semana: "Esta semana", mes: "Este mês", total: "Operação inteira" };

export function GoalsPage({ data, ds, settings }: { data: AppData; ds: Dataset; settings: Settings }) {
  const [period, setPeriod] = useState<GoalPeriod>("dia");
  const [edit, setEdit] = useState<{ def: IndicatorDef; rule: GoalRule } | null>(null);
  const [reset, setReset] = useState(false);
  const s = useMemo(() => aggregate(ds, periodRange(PERIOD_KEY[period])), [ds, period]);
  const budget = transportBudget(settings.uberBudget, data.expenses, data.routes, settings.transportBudgetSince ?? undefined);
  const defs = INDICATORS.filter((d) => d.periods.includes(period) || (period === "total" && d.periods.includes("total")));
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">As cores vêm de regras numéricas que você define. <strong>Verde</strong>: meta atingida · <strong>Amarelo</strong>: entre o limite crítico e a meta · <strong>Vermelho</strong>: abaixo do limite crítico (ou acima, quando menor é melhor). Sem dados = neutro.</p>
      <div className="no-scrollbar -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <Chips className="flex-nowrap" size="sm" options={[{ value: "dia", label: "Dia" }, { value: "semana", label: "Semana" }, { value: "mes", label: "Mês" }, { value: "total", label: "Operação" }]} value={period} onChange={setPeriod} />
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {defs.map((def) => {
          const rule = findRule(data.goals, def.key, period);
          const metric = def.read(s, { transportBudgetUsedPct: budget.usedPct });
          const e = evaluate(def, rule, metric);
          const st = LIGHT_STYLE[e.light];
          return (
            <div key={def.key} className="card relative overflow-hidden p-4">
              <div className={cn("absolute inset-y-0 left-0 w-1", st.bar)} aria-hidden />
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-sm font-bold">{def.label}</div>
                  <div className="text-xs text-subtle">{PERIOD_LABEL[period]} · {def.direction === "maior" ? "maior é melhor" : "menor é melhor"}</div>
                </div>
                <LightBadge light={e.light} label={e.label} />
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-2xl font-extrabold tabular">{metric.state === "pendente" ? "Pendente" : formatValue(metric.value, def.unit)}</span>
                {rule?.target != null && <span className="text-sm text-muted">meta {formatValue(rule.target, def.unit)}</span>}
              </div>
              {e.progress != null && <Progress className="mt-2" value={e.progress} light={e.light} label={def.label} />}
              {e.remaining != null && e.remaining > 0 && <div className="mt-1 text-xs text-muted">Faltam {formatValue(e.remaining, def.unit)}</div>}
              <div className="mt-2 text-xs text-muted"><strong>Regra:</strong> {e.rule}{rule?.isDefault && <Badge tone="neutral" className="ml-1">sugestão inicial</Badge>}</div>
              <div className="mt-1 text-xs text-muted"><strong>Ação sugerida:</strong> {e.action}</div>
              <div className="mt-1 text-[11px] text-subtle">{def.definition}</div>
              <Button size="sm" className="mt-3" onClick={() => setEdit({ def, rule: rule ?? { id: `${def.key}:${period}`, indicator: def.key, period, target: null, green: null, critical: null, enabled: true, isDefault: false, updatedAt: "" } })}>
                <Pencil className="h-3.5 w-3.5" />{rule ? "Editar regra" : "Definir meta"}
              </Button>
            </div>
          );
        })}
      </div>
      <Button variant="ghost" onClick={() => setReset(true)}><RotateCcw className="h-4 w-4" />Restaurar regras iniciais sugeridas</Button>
      {edit && <EditRule def={edit.def} rule={edit.rule} onClose={() => setEdit(null)} />}
      <Confirm open={reset} onClose={() => setReset(false)} title="Restaurar regras sugeridas?" message="Todas as metas e limites voltam ao padrão inicial (faturamento e contribuição por hora ficam sem meta)." onConfirm={async () => { await resetGoals(); setReset(false); toast.success("Regras restauradas"); }} />
    </div>
  );
}

function EditRule({ def, rule, onClose }: { def: IndicatorDef; rule: GoalRule; onClose: () => void }) {
  const [target, setTarget] = useState<number | null>(rule.target);
  const [green, setGreen] = useState<number | null>(rule.green);
  const [critical, setCritical] = useState<number | null>(rule.critical);
  const [enabled, setEnabled] = useState(rule.enabled);
  const err = validateRule(def, { target, green, critical });
  const unit = def.unit === "pct" ? "%" : def.unit === "int" ? "" : "R$";
  const menor = def.direction === "menor";
  return (
    <Sheet open onClose={onClose} title={def.label} subtitle={`Período: ${rule.period}`}
      footer={<Button variant="primary" size="lg" className="w-full" disabled={!!err} onClick={async () => { await saveGoal({ ...rule, target, green, critical, enabled }); toast.success("Regra salva"); onClose(); }}>Salvar regra</Button>}>
      <div className="space-y-4">
        <Toggle checked={enabled} onChange={setEnabled} label="Acompanhar este indicador" />
        <Field label={`Meta ${unit && `(${unit})`}`} hint="Usada na barra de progresso e no “quanto falta”."><NumberInput value={target} onChange={setTarget} allowEmpty suffix={unit === "%" ? "%" : undefined} /></Field>
        <Field label={menor ? "Limite de atenção: verde até" : "Limite de atenção: verde a partir de"} hint="Vazio = usa a meta."><NumberInput value={green} onChange={setGreen} allowEmpty suffix={unit === "%" ? "%" : undefined} /></Field>
        <Field label={menor ? "Limite crítico: vermelho acima de" : "Limite crítico: vermelho abaixo de"} error={err}><NumberInput value={critical} onChange={setCritical} allowEmpty suffix={unit === "%" ? "%" : undefined} /></Field>
        <p className="text-xs text-subtle">{def.definition} Valores monetários em reais (ex.: 69,90).</p>
      </div>
    </Sheet>
  );
}
