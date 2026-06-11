import puppeteer from 'puppeteer';
import { mkdir, readdir } from 'fs/promises';

const url = process.argv[2];
const label = process.argv[3];

if (!url) {
  console.error('Usage: node screenshot.mjs <url> [label]');
  process.exit(1);
}

const outDir = './temporary screenshots';
await mkdir(outDir, { recursive: true });

const existing = await readdir(outDir).catch(() => []);
const nums = existing
  .map((f) => f.match(/^screenshot-(\d+)/))
  .filter(Boolean)
  .map((m) => parseInt(m[1], 10));
const next = nums.length ? Math.max(...nums) + 1 : 1;

const fileName = label ? `screenshot-${next}-${label}.png` : `screenshot-${next}.png`;
const outPath = `${outDir}/${fileName}`;

const browser = await puppeteer.launch();
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
await page.goto(url, { waitUntil: 'networkidle0' });

// Scroll through the page so any scroll-triggered reveal animations fire
const height = await page.evaluate(() => document.body.scrollHeight);
for (let y = 0; y < height; y += 800) {
  await page.evaluate((scrollY) => window.scrollTo(0, scrollY), y);
  await new Promise((r) => setTimeout(r, 350));
}
await page.evaluate(() => window.scrollTo(0, 0));
await new Promise((r) => setTimeout(r, 600));

await page.screenshot({ path: outPath, fullPage: true });
await browser.close();

console.log(`Saved ${outPath}`);
