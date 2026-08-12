/**
 * 複数のビューポートでページを開き、スクリーンショットを撮って
 * コンソールエラーを報告する（設計 §12「レスポンシブ確認」）。
 *
 *   npm run build && npm run preview &
 *   npm run shot
 *
 * 盤面と数値が読める大きさで収まっているかは目視で確認する。
 * 自動化できるのは「エラーなく描画されたか」と「横スクロールが出ていないか」まで。
 */

import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const URL_ = process.env['SHOT_URL'] ?? 'http://localhost:4173/wwa_puzzle/';
const OUT = process.env['SHOT_OUT'] ?? 'screenshots';

/** 最小想定端末から順に。設計 §14 の「最小サポート画面幅」の判断材料にする。 */
const VIEWPORTS = [
  { name: 'phone-portrait', width: 390, height: 844 },
  { name: 'phone-landscape', width: 844, height: 390 },
  { name: 'tablet-portrait', width: 820, height: 1180 },
  { name: 'desktop', width: 1280, height: 800 },
];

await mkdir(OUT, { recursive: true });

const browser = await chromium.launch(
  // この環境ではブラウザが別の場所に用意されているため明示できるようにする。
  process.env['CHROMIUM_PATH'] ? { executablePath: process.env['CHROMIUM_PATH'] } : {},
);

const problems = [];

for (const { name, width, height } of VIEWPORTS) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2 });

  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`${name}: console error: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`${name}: page error: ${err.message}`));

  await page.goto(URL_, { waitUntil: 'networkidle' });
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });

  // 盤面が横にはみ出していないこと。設計 §11.3 のレイアウト要件。
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  if (overflow > 0) problems.push(`${name}: 横スクロールが発生している (+${overflow}px)`);

  console.log(`${name.padEnd(17)} ${width}x${height}  → ${OUT}/${name}.png`);
  await page.close();
}

await browser.close();

if (problems.length > 0) {
  console.error('\n' + problems.join('\n'));
  process.exit(1);
}
console.log('\n問題なし');
