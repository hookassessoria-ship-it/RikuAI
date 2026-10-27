/**
 * SEMÁFORO DE DESEMPENHO
 * Cada indicador tem uma regra numérica editável (meta, limite de atenção, limite crítico).
 * As cores NUNCA são decididas pela interface: saem de `evaluate()`.
 *
 * Maior é melhor:  verde se valor ≥ limite de atenção (padrão = meta);
 *                  vermelho se valor < limite crítico; amarelo entre os dois.
 * Menor é melhor:  verde se valor ≤ limite de atenção; vermelho se valor > limite crítico; amarelo entre.
 * Sem valor ou dado incompleto → estado neutro ("Sem dados" / "Custo pendente"), nunca vermelho.
 */
import type { GoalPeriod, GoalRule } from "@/db/types";
import type { Metric, Summary } from "./engine";
import { formatBRL, formatPct, formatNumber } from "@/lib/money";

export type Light = "verde" | "amarelo" | "vermelho" | "sem_dados" | "sem_meta" | "pendente";
export type Unit = "brl" | "pct" | "int" | "brl_h";

export interface IndicatorDef {
  key: string;
  label: string;
  unit: Unit;
  direction: "maior" | "menor";
  periods: GoalPeriod[];
  definition: string;
  actions: { verde: string; amarelo: string; vermelho: string };
  /** Valor na unidade de exibição (reais, %, contagem). */
  read: (s: Summary, extra: { transportBudgetUsedPct: number | null }) => Metric;
}

const m = (v: number | null): Metric => (v == null ? { value: null, state: "sem_dados" } : { value: v, state: "ok" });
const reais = (x: Metric): Metric => ({ ...x, value: x.value == null ? null : x.value / 100 });

export const INDICATORS: IndicatorDef[] = [
  {
    key: "visitas", label: "Visitas realizadas", unit: "int", direction: "maior", periods: ["dia", "semana", "mes"],
    definition: "Visitas com desfecho registrado (exceto pendente, a caminho e estabelecimento fechado).",
    actions: { verde: "Ritmo de visitas dentro da meta.", amarelo: "Aumente o ritmo: priorize paradas próximas e reduza conversas longas sem decisor.", vermelho: "Ritmo crítico: revise o roteiro ou o horário de início." },
    read: (s) => (s.visitsRealized === 0 ? { value: null, state: "sem_dados", reason: "Nenhuma visita registrada no período" } : m(s.visitsRealized)),
  },
  {
    key: "faturamento", label: "Faturamento (receita líquida)", unit: "brl", direction: "maior", periods: ["dia", "semana", "mes"],
    definition: "Receita líquida reconhecida: vendas entregues − descontos − estornos.",
    actions: { verde: "Meta de faturamento atingida.", amarelo: "Abaixo da meta: foque em segmentos com melhor conversão.", vermelho: "Muito abaixo da meta: revise abordagem, preço e região." },
    read: (s) =>
      s.ordersRecognized === 0 && s.refunds === 0 && s.visitsRealized === 0
        ? { value: null, state: "sem_dados", reason: "Sem visitas nem vendas no período" }
        : reais({ value: s.net, state: "ok" }),
  },
  {
    key: "placas", label: "Placas vendidas", unit: "int", direction: "maior", periods: ["dia", "semana", "mes"],
    definition: "Unidades vendidas e entregues, descontadas as devoluções.",
    actions: { verde: "Volume dentro da meta.", amarelo: "Ofereça mais de uma placa (balcão + mesas/caixa).", vermelho: "Volume crítico: revise a oferta." },
    read: (s) =>
      s.ordersRecognized === 0 && s.visitsRealized === 0 ? { value: null, state: "sem_dados", reason: "Sem visitas nem vendas no período" } : m(s.unitsSold),
  },
  {
    key: "conversao", label: "Conversão de visitas", unit: "pct", direction: "maior", periods: ["dia", "semana", "mes"],
    definition: "Pedidos vinculados a visitas ÷ visitas realizadas × 100.",
    actions: { verde: "Conversão saudável.", amarelo: "Treine a demonstração e volte nos interessados.", vermelho: "Conversão crítica: mude região/segmento ou o discurso." },
    read: (s) => s.conversion,
  },
  {
    key: "margem_contribuicao_pct", label: "Margem de contribuição", unit: "pct", direction: "maior", periods: ["dia", "semana", "mes"],
    definition: "(Receita líquida − CPV − custos variáveis) ÷ receita líquida × 100.",
    actions: { verde: "Margem dentro da regra definida.", amarelo: "Margem apertada: evite descontos e taxas altas.", vermelho: "Margem crítica/negativa: revise preço, custo ou descontos já." },
    read: (s) => s.contributionPct,
  },
  {
    key: "resultado_operacional", label: "Resultado operacional estimado", unit: "brl", direction: "maior", periods: ["dia", "semana", "mes"],
    definition: "Margem de contribuição − despesas operacionais pagas do período. Não é lucro líquido contábil.",
    actions: { verde: "Operação cobrindo as despesas.", amarelo: "Perto do zero: controle despesas de campo.", vermelho: "Prejuízo operacional no período." },
    read: (s) => reais(s.opResult),
  },
  {
    key: "ticket_medio", label: "Ticket médio por pedido", unit: "brl", direction: "maior", periods: ["dia", "semana", "mes"],
    definition: "Receita líquida ÷ número de pedidos.",
    actions: { verde: "Ticket dentro da meta.", amarelo: "Descontos estão puxando o ticket para baixo.", vermelho: "Ticket crítico: reduza descontos ou ofereça kits." },
    read: (s) => reais(s.ticket),
  },
  {
    key: "transporte_por_venda", label: "Custo de transporte por venda", unit: "brl", direction: "menor", periods: ["dia", "semana", "mes"],
    definition: "Transporte pago (Uber + transporte público) ÷ pedidos do período.",
    actions: { verde: "Transporte sob controle.", amarelo: "Agrupe mais visitas por deslocamento.", vermelho: "Transporte consumindo a margem: priorize rotas a pé." },
    read: (s) => reais(s.transportPerSale),
  },
  {
    key: "contribuicao_por_hora", label: "Contribuição por hora", unit: "brl_h", direction: "maior", periods: ["dia", "semana", "mes"],
    definition: "Margem de contribuição ÷ horas de jornada registradas nas rotas.",
    actions: { verde: "Hora de trabalho bem remunerada.", amarelo: "Produtividade abaixo do esperado.", vermelho: "Hora de trabalho com retorno crítico." },
    read: (s) => reais(s.contributionPerHour),
  },
  {
    key: "orcamento_transporte", label: "Uso do orçamento de transporte", unit: "pct", direction: "menor", periods: ["total"],
    definition: "Uber pago + previsto ÷ orçamento total de transporte × 100.",
    actions: { verde: "Orçamento sob controle.", amarelo: "Perto do limite: confirme se o próximo deslocamento é necessário.", vermelho: "Orçamento ultrapassado." },
    read: (_s, extra) => m(extra.transportBudgetUsedPct),
  },
];

export const indicatorByKey = (k: string) => INDICATORS.find((i) => i.key === k);

/** Regras iniciais sugeridas (editáveis). Indicadores sem base objetiva começam "Sem meta". */
export function defaultGoalRules(now: string): GoalRule[] {
  const r = (indicator: string, period: GoalPeriod, target: number | null, green: number | null, critical: number | null): GoalRule => ({
    id: `${indicator}:${period}`, indicator, period, target, green, critical, enabled: true, isDefault: true, updatedAt: now,
  });
  return [
    r("visitas", "dia", 30, 30, 20),
    r("visitas", "semana", 90, 90, 60),
    r("conversao", "dia", 10, 10, 5),
    r("conversao", "semana", 10, 10, 5),
    r("conversao", "mes", 10, 10, 5),
    r("margem_contribuicao_pct", "dia", 30, 30, 0),
    r("margem_contribuicao_pct", "semana", 30, 30, 0),
    r("margem_contribuicao_pct", "mes", 30, 30, 0),
    r("resultado_operacional", "dia", 0, 0, 0),
    r("resultado_operacional", "semana", 0, 0, 0),
    r("resultado_operacional", "mes", 0, 0, 0),
    r("ticket_medio", "dia", 69.9, 69.9, 59.9),
    r("ticket_medio", "semana", 69.9, 69.9, 59.9),
    r("ticket_medio", "mes", 69.9, 69.9, 59.9),
    r("transporte_por_venda", "dia", 7, 7, 14),
    r("transporte_por_venda", "semana", 7, 7, 14),
    r("transporte_por_venda", "mes", 7, 7, 14),
    r("orcamento_transporte", "total", 80, 80, 100),
  ];
}

export function formatValue(v: number | null, unit: Unit): string {
  if (v == null) return "—";
  switch (unit) {
    case "brl": return formatBRL(Math.round(v * 100));
    case "brl_h": return `${formatBRL(Math.round(v * 100))}/h`;
    case "pct": return formatPct(v);
    case "int": return formatNumber(v, 0);
  }
}

export interface Evaluation {
  light: Light;
  label: string;
  rule: string;
  action: string;
  progress: number | null; // 0..1+ em relação à meta (maior melhor)
  remaining: number | null; // quanto falta para a meta (unidade de exibição)
}

export const LIGHT_LABEL: Record<Light, string> = {
  verde: "Bom",
  amarelo: "Atenção",
  vermelho: "Crítico",
  sem_dados: "Sem dados",
  sem_meta: "Sem meta",
  pendente: "Dado pendente",
};

export function ruleText(def: IndicatorDef, rule: GoalRule | undefined): string {
  if (!rule || !rule.enabled || (rule.green == null && rule.critical == null && rule.target == null)) return "Nenhuma regra definida para este período.";
  const g = rule.green ?? rule.target;
  const c = rule.critical;
  const f = (x: number | null) => formatValue(x, def.unit);
  if (def.direction === "maior") {
    const parts = [];
    if (g != null) parts.push(`Verde: ≥ ${f(g)}`);
    if (g != null && c != null) parts.push(`Amarelo: de ${f(c)} até < ${f(g)}`);
    if (c != null) parts.push(`Vermelho: < ${f(c)}`);
    return parts.join(" · ");
  }
  const parts = [];
  if (g != null) parts.push(`Verde: ≤ ${f(g)}`);
  if (g != null && c != null) parts.push(`Amarelo: > ${f(g)} até ${f(c)}`);
  if (c != null) parts.push(`Vermelho: > ${f(c)}`);
  return parts.join(" · ");
}

export function evaluate(def: IndicatorDef, rule: GoalRule | undefined, metric: Metric): Evaluation {
  const rt = ruleText(def, rule);
  const target = rule?.enabled ? rule.target : null;
  const v = metric.value;
  const progress = target && v != null && def.direction === "maior" && target > 0 ? v / target : null;
  const remaining = target != null && v != null && def.direction === "maior" ? Math.max(target - v, 0) : null;
  const base = { rule: rt, progress, remaining };
  if (metric.state === "pendente") return { ...base, light: "pendente", label: LIGHT_LABEL.pendente, action: metric.reason ?? "Informe o custo unitário para avaliar." };
  if (v == null || metric.state === "sem_dados") return { ...base, light: "sem_dados", label: LIGHT_LABEL.sem_dados, action: metric.reason ?? "Ainda não há registros suficientes." };
  if (!rule || !rule.enabled) return { ...base, light: "sem_meta", label: LIGHT_LABEL.sem_meta, action: "Defina uma meta para acompanhar este indicador." };
  const g = rule.green ?? rule.target;
  const c = rule.critical;
  if (g == null && c == null) return { ...base, light: "sem_meta", label: LIGHT_LABEL.sem_meta, action: "Defina uma meta para acompanhar este indicador." };
  let light: Light;
  if (def.direction === "maior") {
    if (g != null && v >= g) light = "verde";
    else if (c != null && v < c) light = "vermelho";
    else light = "amarelo";
  } else {
    if (g != null && v <= g) light = "verde";
    else if (c != null && v > c) light = "vermelho";
    else light = "amarelo";
  }
  const action = def.actions[light as "verde" | "amarelo" | "vermelho"];
  return { ...base, light, label: LIGHT_LABEL[light], action: metric.state === "parcial" ? `${action} (estimativa incompleta: ${metric.reason})` : action };
}

/** Valida a coerência da regra. Retorna mensagem de erro ou null. */
export function validateRule(def: IndicatorDef, r: Pick<GoalRule, "green" | "critical" | "target">): string | null {
  const g = r.green ?? r.target;
  if (g != null && r.critical != null) {
    if (def.direction === "maior" && r.critical > g) return "O limite crítico deve ser menor ou igual ao limite de atenção.";
    if (def.direction === "menor" && r.critical < g) return "O limite crítico deve ser maior ou igual ao limite de atenção.";
  }
  return null;
}

export function findRule(rules: GoalRule[], indicator: string, period: GoalPeriod): GoalRule | undefined {
  return rules.find((r) => r.indicator === indicator && r.period === period);
}
