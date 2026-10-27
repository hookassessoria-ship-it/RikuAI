// Verificação da URL publicada (ou do build local): arquivos estáticos, todas as telas,
// navegação pela barra inferior, atualização direta de cada tela e abertura sem internet.
// Não grava nada além do perfil temporário do navegador de teste.
// Uso: BASE_URL=https://seu-app.vercel.app/ node scripts/smoke.mjs
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const BASE = (process.env.BASE_URL ?? "http://localhost:4173/").replace(/\/?$/, "/");
const errors = [];
const ok = (cond, msg) => { if (!cond) throw new Error("FALHOU: " + msg); console.log("✓", msg); };

// 1. Arquivos estáticos
for (const [path, type] of [["", "text/html"], ["manifest.webmanifest", "manifest"], ["sw.js", "javascript"], ["icon-192.png", "image/png"], ["apple-touch-icon.png", "image/png"], ["dados/planilha_prospeccao.csv", "csv"]]) {
  const r = await fetch(BASE + path);
  ok(r.status === 200 && (r.headers.get("content-type") ?? "").includes(type), `GET /${path} → ${r.status} ${r.headers.get("content-type")}`);
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "pt-BR", timezoneId: "America/Sao_Paulo" });
const page = await ctx.newPage();
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => m.type() === "error" && errors.push("console: " + m.text()));
const h1 = (text) => page.locator("h1", { hasText: text }).waitFor({ timeout: 15000 });

// 2. Cada tela abre direto pela URL e continua igual após atualizar a página
const SCREENS = [
  ["inicio", "Visão geral"], ["rotas", "Rota e prospecção"], ["vendas", "Vendas"], ["financas", "Financeiro"],
  ["inteligencia", "Inteligência comercial"], ["metas", "Metas e semáforo"], ["simulador", "Simulador de preço"],
  ["importar", "Importar roteiros"], ["estabelecimentos", "Estabelecimentos"], ["configuracoes", "Configurações e backup"],
  ["historico", "Histórico de alterações"], ["definicoes", "Definições dos indicadores"],
];
for (const [hash, title] of SCREENS) {
  await page.goto(BASE + "#/" + hash);
  await h1(title);
  await page.reload();
  await h1(title);
  ok(true, `#/${hash} abre direto e após atualizar mostra “${title}”`);
}

// 3. Navegação pela barra inferior (iPhone)
await page.goto(BASE);
await h1("Visão geral");
const nav = page.getByRole("navigation", { name: "Navegação principal" });
for (const [label, title] of [["Rota", "Rota e prospecção"], ["Vendas", "Vendas"], ["Finanças", "Financeiro"], ["Análises", "Inteligência comercial"], ["Início", "Visão geral"]]) {
  await nav.getByRole("button", { name: label }).click();
  await h1(title);
  ok(true, `barra inferior: ${label} → ${title}`);
}

// 4. Service worker e abertura sem internet
const sw = await page.evaluate(async () => {
  if (!("serviceWorker" in navigator)) return "sem suporte";
  const reg = await Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(() => r(null), 15000))]);
  return reg?.active ? "ativo" : "inativo";
});
ok(sw === "ativo", `service worker ${sw}`);
await page.reload();
await h1("Visão geral");
await ctx.setOffline(true);
await page.goto(BASE + "#/rotas");
await page.reload();
await h1("Rota e prospecção");
await ctx.setOffline(false);
ok(true, "abre e atualiza sem internet depois do primeiro acesso");

ok(errors.length === 0, "sem erros no console" + (errors.length ? ":\n" + errors.join("\n") : ""));
await browser.close();
