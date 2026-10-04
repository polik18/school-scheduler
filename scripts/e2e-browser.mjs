import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { preview } from 'vite';

const root = path.resolve(import.meta.dirname, '..');
const chromeCandidates = process.platform === 'win32'
  ? [
      process.env.PLAYWRIGHT_CHROME_PATH,
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
    ]
  : [process.env.PLAYWRIGHT_CHROME_PATH, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
const executablePath = chromeCandidates.find(candidate => candidate && fs.existsSync(candidate));
if (!executablePath) throw new Error('找不到 Chrome/Chromium；可設定 PLAYWRIGHT_CHROME_PATH。');

const server = await preview({ root, logLevel: 'silent', preview: { host: '127.0.0.1', port: 4173, strictPort: false } });
const address = server.httpServer.address();
const baseURL = `http://127.0.0.1:${address.port}/`;
const browser = await chromium.launch({ executablePath, headless: true, args: ['--disable-gpu', '--no-sandbox'] });
const context = await browser.newContext({ acceptDownloads: true });
const errors = [];

function observe(page) {
  page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
  page.on('console', message => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });
}
function assert(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  const scheduleFile = path.join(root, 'public/examples/large-school-schedule-demo.xlsx');
  const staffingFile = path.join(root, 'public/examples/staffing-result-demo.xlsx');

  // 主流程：大型範例匯入 → 驗證 → Web Worker 排課 → 匯出。
  const page = await context.newPage();
  observe(page);
  await page.goto(baseURL, { waitUntil: 'networkidle' });
  assert(await page.getByRole('heading', { name: /\u628a\u8907\u96dc\u7684\u6392\u8ab2\u9650\u5236/ }).isVisible(), '首頁標題未顯示');
  const demoHref = await page.getByRole('link', { name: '下載大型學校排課範例' }).getAttribute('href');
  assert(demoHref?.includes('large-school-schedule-demo.xlsx'), '大型範例下載連結錯誤');
  await page.locator('input[type=file]').first().setInputFiles(scheduleFile);
  await page.getByRole('status').filter({ hasText: '匯入完成：124 師 / 54 班 / 630 課' }).waitFor({ timeout: 15000 });
  assert(await page.getByText('資料格式與必要欄位均已通過驗證。').isVisible(), '大型範例未通過驗證');
  await page.getByRole('button', { name: '執行智慧排課 →' }).click();
  await page.getByRole('button', { name: '取消排課' }).waitFor({ timeout: 5000 });
  await page.getByRole('status').filter({ hasText: '排課成功' }).waitFor({ timeout: 45000 });
  const stats = await page.locator('.result-stats > div').allTextContents();
  assert(stats.some(x => x.includes('846') && x.includes('已排入')), `已排節數不是 846：${stats.join(' | ')}`);
  assert(stats.some(x => x.includes('0') && x.includes('待處理')), `待處理不是 0：${stats.join(' | ')}`);
  const [staffingDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: '匯出教職員配置' }).click()
  ]);
  assert((await staffingDownload.suggestedFilename()) === 'school-staffing-result.xlsx', '教職員配置匯出檔名錯誤');

  // 取消：證明長時間排課不會鎖死介面。
  const cancelPage = await context.newPage();
  observe(cancelPage);
  await cancelPage.goto(baseURL);
  await cancelPage.locator('input[type=file]').first().setInputFiles(scheduleFile);
  await cancelPage.getByRole('status').filter({ hasText: '匯入完成' }).waitFor();
  await cancelPage.getByRole('button', { name: '執行智慧排課 →' }).click();
  await cancelPage.getByRole('button', { name: '取消排課' }).click();
  await cancelPage.getByRole('status').filter({ hasText: '已取消排課' }).waitFor();

  // 配置簿流程：實際匿名檔匯入 → 三類筆數 → 再匯出。
  const staffingPage = await context.newPage();
  observe(staffingPage);
  await staffingPage.goto(baseURL);
  await staffingPage.locator('input[type=file]').first().setInputFiles(staffingFile);
  await staffingPage.getByRole('heading', { name: '教職員配置結果' }).waitFor({ timeout: 15000 });
  const staffingStats = await staffingPage.locator('.data-summary > div').allTextContents();
  assert(staffingStats.some(x => x.includes('66') && x.includes('級任配置')), '級任筆數不是 66');
  assert(staffingStats.some(x => x.includes('70') && x.includes('科任教師')), '科任筆數不是 70');
  assert(staffingStats.some(x => x.includes('40') && x.includes('行政支援')), '行政支援筆數不是 40');
  const [roundTripDownload] = await Promise.all([
    staffingPage.waitForEvent('download'),
    staffingPage.getByRole('button', { name: '匯出教職員配置' }).click()
  ]);
  assert((await roundTripDownload.suggestedFilename()) === 'school-staffing-result.xlsx', '配置簿再匯出失敗');

  assert(errors.length === 0, `瀏覽器錯誤：\n${errors.join('\n')}`);
  console.log(`Browser E2E PASS：大型範例 846 節、0 pending；取消可用；配置簿 66/70/40；兩種匯出可用。`);
} finally {
  await context.close();
  await browser.close();
  await server.close();
}
