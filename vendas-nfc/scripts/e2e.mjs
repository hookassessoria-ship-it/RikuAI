// Teste ponta a ponta no Chromium (viewport de iPhone): importa os 88, registra visita, venda e despesa,
// recarrega a página e confere a persistência. Gera capturas em e2e-artifacts/.
// Uso: npm run build && npx vite preview --port 4173 & node scripts/e2e.mjs
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const BASE = process.env.BASE_URL ?? "http://localhost:4173/";
const OUT = new URL("../e2e-artifacts/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const errors = [];
const ok = (cond, msg) => { if (!cond) throw new Error("FALHOU: " + msg); console.log("✓", msg); };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "pt-BR", timezoneId: "America/Sao_Paulo" });
const page = await ctx.newPage();
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => m.type() === "error" && errors.push("console: " + m.text()));
const shot = (n) => page.screenshot({ path: `${OUT}${n}.png`, fullPage: false });
const full = (n) => page.screenshot({ path: `${OUT}${n}.png`, fullPage: true });
const goto = async (h) => { await page.goto(BASE + "#/" + h); await page.waitForTimeout(500); };

await goto("inicio");
await page.locator("h1", { hasText: "Visão geral" }).waitFor();
await full("01-inicio-vazio");
ok(await page.getByText("Ainda não há resultados para mostrar").isVisible(), "visão geral vazia mostra estado inicial (sem gráficos falsos)");
ok(await page.getByText("Custo unitário da placa não informado").isVisible(), "pendência de custo unitário sinalizada");

// Importação
await goto("importar");
await page.getByRole("button", { name: /Original \(CSV, 88\)/ }).click();
await page.getByRole("heading", { name: "Prévia" }).waitFor();
await full("02-importar-previa");
ok(await page.getByRole("button", { name: /Importar 88 novo\(s\) e 3 rota\(s\)/ }).isVisible(), "prévia: 88 novos e 3 rotas");
await page.getByRole("button", { name: /Importar 88 novo/ }).click();
await page.getByText("Resultado da importação").waitFor();
ok(await page.getByText(/88\s*estabelecimento\(s\) importado/).isVisible(), "88 estabelecimentos importados");

// Reimportar não duplica
await page.getByRole("button", { name: "Importar outro" }).click();
await page.getByRole("button", { name: /Original \(CSV, 88\)/ }).click();
await page.getByRole("heading", { name: "Prévia" }).waitFor();
ok(await page.getByRole("button", { name: /Importar 0 novo/ }).isVisible(), "reimportar: 0 novos (sem duplicar)");

// Rotas
await goto("rotas");
await full("03-rotas");
const cards = page.locator("button", { hasText: "paradas" });
ok((await cards.count()) === 3, "3 rotas criadas");
await cards.first().click();
await page.getByText("Próxima parada").first().waitFor();
await shot("04-rota-terca");
await full("04b-rota-terca-completa");

// Status com um toque: parada 1 = responsável ausente
const pills = page.locator('button[aria-label^="Status:"]');
await pills.nth(0).click();
await page.getByRole("button", { name: "Responsável ausente" }).click();
await page.waitForTimeout(400);
ok(await page.locator('button[aria-label^="Status: Responsável ausente"]').count() === 1, "parada 1 marcada como ausente");

// Parada 2 = venda fechada → abre formulário de venda
await pills.nth(1).click();
await page.getByRole("button", { name: "Venda fechada" }).click();
await page.getByText("Registrar venda").first().waitFor();
await shot("05-venda-formulario");
await page.getByRole("button", { name: "Aumentar" }).click(); // 2 placas
await page.getByRole("button", { name: /Salvar venda/ }).click();
await page.waitForTimeout(600);
ok(await page.locator('button[aria-label^="Status: Venda fechada"]').count() === 1, "parada 2 com venda fechada");

// Parada 3 = sem interesse com motivo
await pills.nth(2).click();
await page.getByRole("button", { name: "Sem interesse" }).click();
await page.getByRole("button", { name: "Preço" }).click();
await page.waitForTimeout(400);

// Despesa pelas ações rápidas
await page.getByRole("button", { name: "Ações rápidas" }).click();
await shot("06-acoes-rapidas");
await page.getByRole("button", { name: /Registrar despesa/ }).click();
await page.locator('input[inputmode="decimal"]').first().fill("23,50");
await page.getByRole("button", { name: /Salvar despesa/ }).click();
await page.waitForTimeout(500);

// Persistência após recarregar
await page.reload();
await page.waitForTimeout(800);
ok(await page.locator('button[aria-label^="Status: Venda fechada"]').count() === 1, "após recarregar: venda continua na parada");
ok(await page.locator('button[aria-label^="Status: Responsável ausente"]').count() === 1, "após recarregar: ausente continua");

await goto("vendas");
await page.getByRole("radio", { name: "Hoje", exact: true }).click();
await page.waitForTimeout(300);
await full("07-vendas");
ok(await page.getByText("R$ 139,80").first().isVisible(), "venda de 2 placas = R$ 139,80 na lista");

await goto("inicio");
await page.getByRole("radio", { name: "Hoje", exact: true }).click();
await page.waitForTimeout(500);
await full("08-inicio-com-dados");
ok(await page.getByText("R$ 139,80").first().isVisible(), "faturamento de hoje atualizado");
ok((await page.getByText("Pendente").count()) > 0, "margem mostra 'Pendente' sem custo unitário");

await goto("financas/resumo"); await page.getByRole("radio", { name: "Hoje", exact: true }).click(); await page.waitForTimeout(300); await full("09-financas-resumo");
await goto("financas/custos"); await full("10-financas-custos");
await goto("financas/estoque"); await full("11-financas-estoque");
await goto("financas/transporte"); await full("12-financas-transporte");
ok(await page.getByText("R$ 56,50").first().isVisible(), "orçamento de transporte: saldo R$ 56,50 (80 − 23,50)");
await goto("financas/simulador"); await full("13-simulador");
await goto("inteligencia"); await full("14-inteligencia");
await goto("metas"); await full("15-metas");

// Demonstração separada
await goto("configuracoes");
await page.getByRole("radio", { name: "Ver demonstração" }).click();
await page.waitForTimeout(1200);
await goto("inicio");
await page.getByRole("radio", { name: "Últimos 30 dias" }).click();
await page.waitForTimeout(600);
ok(await page.getByText(/MODO DEMONSTRAÇÃO/).isVisible(), "banner de demonstração visível");
await full("16-inicio-demonstracao");
await goto("inteligencia"); await page.getByRole("radio", { name: "Últimos 30 dias" }).click(); await page.waitForTimeout(400); await full("17-inteligencia-demo");
await goto("configuracoes");
await page.getByRole("button", { name: "Remover demonstração" }).click();
await page.getByRole("button", { name: "Remover", exact: true }).click();
await page.waitForTimeout(600);
await goto("inicio");
await page.getByRole("radio", { name: "Hoje", exact: true }).click();
ok(!(await page.getByText(/MODO DEMONSTRAÇÃO/).isVisible()), "voltou aos dados reais");
ok(await page.getByText("R$ 139,80").first().isVisible(), "dados reais intactos após remover demonstração");

// Desktop
await page.setViewportSize({ width: 1366, height: 900 });
await goto("inicio"); await page.waitForTimeout(500); await shot("18-desktop-inicio");
await goto("rotas"); await page.locator("button", { hasText: "paradas" }).first().click(); await page.waitForTimeout(400); await shot("19-desktop-rota");

await browser.close();
if (errors.length) { console.log("\nErros no console:\n" + errors.join("\n")); process.exitCode = 1; }
else console.log("\nSem erros de console. Capturas em e2e-artifacts/");
