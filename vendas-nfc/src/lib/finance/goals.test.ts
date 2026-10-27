import { describe, it, expect } from "vitest";
import { evaluate, indicatorByKey, defaultGoalRules, validateRule, ruleText } from "./goals";
import type { GoalRule } from "@/db/types";

const rule = (p: Partial<GoalRule>): GoalRule => ({ id: "x", indicator: "conversao", period: "dia", target: 10, green: 10, critical: 5, enabled: true, isDefault: false, updatedAt: "", ...p });
const conv = indicatorByKey("conversao")!;
const transp = indicatorByKey("transporte_por_venda")!;

describe("semáforo", () => {
  it("maior é melhor: verde/amarelo/vermelho pelas regras numéricas", () => {
    expect(evaluate(conv, rule({}), { value: 12, state: "ok" }).light).toBe("verde");
    expect(evaluate(conv, rule({}), { value: 10, state: "ok" }).light).toBe("verde");
    expect(evaluate(conv, rule({}), { value: 7, state: "ok" }).light).toBe("amarelo");
    expect(evaluate(conv, rule({}), { value: 4.9, state: "ok" }).light).toBe("vermelho");
  });
  it("menor é melhor: regras invertidas", () => {
    const r = rule({ indicator: "transporte_por_venda", target: 7, green: 7, critical: 14 });
    expect(evaluate(transp, r, { value: 5, state: "ok" }).light).toBe("verde");
    expect(evaluate(transp, r, { value: 10, state: "ok" }).light).toBe("amarelo");
    expect(evaluate(transp, r, { value: 15, state: "ok" }).light).toBe("vermelho");
  });
  it("sem dados → neutro (nunca vermelho); sem regra → sem meta; custo pendente → pendente", () => {
    expect(evaluate(conv, rule({}), { value: null, state: "sem_dados" }).light).toBe("sem_dados");
    expect(evaluate(conv, undefined, { value: 3, state: "ok" }).light).toBe("sem_meta");
    expect(evaluate(conv, rule({ enabled: false }), { value: 3, state: "ok" }).light).toBe("sem_meta");
    expect(evaluate(indicatorByKey("margem_contribuicao_pct")!, rule({}), { value: 90, state: "pendente" }).light).toBe("pendente");
  });
  it("regras editáveis mudam a cor (não há julgamento fixo na interface)", () => {
    const m = { value: 25, state: "ok" as const };
    const mc = indicatorByKey("margem_contribuicao_pct")!;
    expect(evaluate(mc, rule({ target: 30, green: 30, critical: 0 }), m).light).toBe("amarelo");
    expect(evaluate(mc, rule({ target: 20, green: 20, critical: 0 }), m).light).toBe("verde");
  });
  it("progresso e quanto falta", () => {
    const e = evaluate(indicatorByKey("visitas")!, rule({ indicator: "visitas", target: 30, green: 30, critical: 20 }), { value: 12, state: "ok" });
    expect(e.progress).toBeCloseTo(0.4);
    expect(e.remaining).toBe(18);
  });
  it("validação e texto da regra", () => {
    expect(validateRule(conv, { target: 10, green: 10, critical: 20 })).toMatch(/crítico/);
    expect(validateRule(transp, { target: 7, green: 7, critical: 3 })).toMatch(/crítico/);
    expect(ruleText(conv, rule({}))).toContain("Verde: ≥ 10%");
  });
  it("regras padrão: faturamento e contribuição/hora começam sem meta", () => {
    const d = defaultGoalRules("");
    expect(d.find((r) => r.indicator === "faturamento")).toBeUndefined();
    expect(d.find((r) => r.indicator === "visitas" && r.period === "dia")?.target).toBe(30);
    expect(d.find((r) => r.indicator === "orcamento_transporte")?.critical).toBe(100);
  });
});
