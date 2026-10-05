import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { preview } from 'vite';

const root = path.resolve(import.meta.dirname, '..');
const chromeCandidates = process.platform === 'win32'
  ? ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe']
  : ['/usr/bin/google-chrome', '/usr/bin/chromium'];
const executablePath = chromeCandidates.find(fs.existsSync);
if (!executablePath) throw new Error('找不到 Chrome/Chromium。');

const output = path.join(root, 'test-results/visual');
fs.mkdirSync(output, { recursive: true });
const server = await preview({ root, logLevel: 'silent', preview: { host: '127.0.0.1', port: 4173, strictPort: false } });
const address = server.httpServer.address();
const baseURL = `http://127.0.0.1:${address.port}/`;
const template = path.join(root, 'public/school-scheduler-template.xlsx');
const browser = await chromium.launch({ executablePath, headless: true, args: ['--disable-gpu', '--no-sandbox'] });

const assert = (condition, message) => { if (!condition) throw new Error(message); };
const luminance = hex => {
  const channels = hex.match(/[0-9a-f]{2}/gi).map(value => parseInt(value, 16) / 255)
    .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
};
const contrast = (foreground, background) => {
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (lighter + .05) / (darker + .05);
};
for (const [foreground, background, label] of [
  ['#17211d', '#fffdf8', '主要文字'], ['#5e6b65', '#fffdf8', '次要文字'],
  ['#ffffff', '#174f3c', '主要按鈕'], ['#244b73', '#dfeaf3', '資訊訊息'],
  ['#874315', '#fff2e5', '警告訊息']
]) assert(contrast(foreground, background) >= 4.5, `${label}對比不足 4.5:1`);
try {
  for (const width of [360, 768, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    await page.goto(baseURL, { waitUntil: 'networkidle' });
    const dialog = page.getByRole('dialog');
    if (await dialog.count()) await dialog.getByRole('button', { name: '開始使用' }).click();
    const homeOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert(homeOverflow <= 1, `${width}px 首頁產生 ${homeOverflow}px 水平溢位`);
    await page.screenshot({ path: path.join(output, `home-${width}.png`), fullPage: true });

    await page.locator('input[type=file]').first().setInputFiles(template);
    await page.getByRole('status').filter({ hasText: '匯入完成' }).waitFor();
    await page.getByRole('button', { name: '執行智慧排課 →' }).click();
    await page.getByRole('status').filter({ hasText: '排課成功' }).waitFor({ timeout: 30000 });
    assert(await page.locator('.timetable-card').count() === 1, `${width}px 不是單一課表檢視`);
    const pageOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert(pageOverflow <= 1, `${width}px 工作區產生 ${pageOverflow}px 水平溢位`);
    await page.locator('.timetable-panel').screenshot({ path: path.join(output, `result-${width}.png`) });

    await page.emulateMedia({ media: 'print' });
    assert(await page.locator('.panel:not(.timetable-panel)').first().evaluate(element => getComputedStyle(element).display === 'none'), `${width}px 列印模式仍顯示非課表面板`);
    await page.locator('.timetable-panel').screenshot({ path: path.join(output, `print-${width}.png`) });
    await page.close();
  }
  console.log(`視覺門禁 PASS：核心文字對比 ≥ 4.5:1；360／768／1440px 首頁、結果、列印模式；截圖位於 ${output}`);
} finally {
  await browser.close();
  await server.close();
}
