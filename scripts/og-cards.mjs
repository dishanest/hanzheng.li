// Render the share cards into public/og/: a landscape, cover-cropped to 1200x630, with HAN LI
// inverted on top. og-worker/ serves one at random as the site's share image; keep its CARDS
// list the same as `cards` here. Needs Google Chrome. Run: npm run og-cards
import puppeteer from 'puppeteer-core';
import { readFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
const repo = fileURLToPath(new URL('..', import.meta.url));
const out = `${repo}/public/og`;
mkdirSync(out, { recursive: true });
const cards = { tamalpais: 41, iceland: 40, 'iceland-fjord': 45, kawaguchiko: 50, kyoto: 24, taiwan: 32, atchafalaya: 25, louisiana: 17, aruba: 34 };
const path = readFileSync(`${repo}/index.html`, 'utf8').match(/<path d="([^"]*)"/)[1];
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new' });
const p = await b.newPage(); await p.setViewport({ width: 1200, height: 630, deviceScaleFactor: 1 });
for (const [name, n] of Object.entries(cards)) {
  const photo = readFileSync(`${repo}/public/photos/${n}.jpg`).toString('base64');
  await p.setContent(`<style>html,body{margin:0;width:1200px;height:630px;overflow:hidden;background:#fff}
div{position:relative;width:1200px;height:630px;isolation:isolate}
img{position:absolute;inset:0;width:1200px;height:630px;object-fit:cover}
svg{position:absolute;left:24px;bottom:24px;width:1152px;height:252px;fill:#fff;mix-blend-mode:difference}</style>
<div><img src="data:image/jpeg;base64,${photo}"><svg viewBox="0 0 3248.4 710" preserveAspectRatio="none"><path d="${path}"/></svg></div>`);
  await p.evaluate(() => document.querySelector('img').decode());
  await p.screenshot({ path: `${out}/${name}.jpg`, type: 'jpeg', quality: 86 });
}
await b.close();
