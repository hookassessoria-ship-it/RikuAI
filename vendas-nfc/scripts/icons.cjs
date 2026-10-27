// Gera os PNGs do ícone a partir de public/icon.svg usando o Chromium do Playwright.
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
(async () => {
  const svg = fs.readFileSync(path.join(__dirname, "../public/icon.svg"), "utf8");
  const browser = await chromium.launch();
  const page = await browser.newPage();
  for (const [name, size] of [["icon-192.png", 192], ["icon-512.png", 512], ["apple-touch-icon.png", 180]]) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<html><body style="margin:0;background:#16141c">${svg.replace("<svg ", `<svg width="${size}" height="${size}" `)}</body></html>`);
    await page.screenshot({ path: path.join(__dirname, "../public", name), clip: { x: 0, y: 0, width: size, height: size } });
  }
  await browser.close();
})();
