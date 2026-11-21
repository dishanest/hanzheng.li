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
// the letters show the photo as a colour negative: inverted, then saturated so the colours read
// (a plain difference blend left them near white over dark photos)
const SATURATE = 3;
const mask = 'data:image/svg+xml;base64,' + Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 3248.4 710" preserveAspectRatio="none"><path d="${path}"/></svg>`).toString('base64');
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new' });
const p = await b.newPage(); await p.setViewport({ width: 1200, height: 630, deviceScaleFactor: 1 });
for (const [name, n] of Object.entries(cards)) {
  const photo = readFileSync(`${repo}/public/photos/${n}.jpg`).toString('base64');
  const m = `url(${mask}) no-repeat 24px 354px / 1152px 252px`; // the name: 24 px in, 252 px tall, flush with a 24 px margin
  await p.setContent(`<style>html,body{margin:0;width:1200px;height:630px;overflow:hidden;background:#fff}
img{position:absolute;inset:0;width:1200px;height:630px;object-fit:cover}
.neg{filter:invert(1) saturate(${SATURATE});-webkit-mask:${m};mask:${m}}</style>
<img src="data:image/jpeg;base64,${photo}"><img class="neg" src="data:image/jpeg;base64,${photo}">`);
  await p.evaluate(() => Promise.all([...document.images].map((i) => i.decode())));
  await p.screenshot({ path: `${out}/${name}.jpg`, type: 'jpeg', quality: 86 });
}
await b.close();
