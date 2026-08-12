import './style.css';

/**
 * Phase 0 の暫定エントリポイント。
 * ビルドと GitHub Pages への配信が通っていることを確認するためだけのもので、
 * Phase 3 で盤面の描画と情報パネルに置き換える。
 */

interface Phase {
  readonly no: number;
  readonly name: string;
  readonly done: boolean;
}

const PHASES: readonly Phase[] = [
  { no: 0, name: '土台（Vite + TS + Vitest + CI + Pages）', done: true },
  { no: 1, name: 'core ルールエンジン', done: false },
  { no: 2, name: 'solver 探索器', done: false },
  { no: 3, name: 'game 描画・入力・情報パネル', done: false },
  { no: 4, name: 'editor マップエディタ', done: false },
  { no: 5, name: 'gen 自動生成と難易度評価', done: false },
  { no: 6, name: 'ヒント・詰み検出・共有URL・保存', done: false },
];

function render(root: HTMLElement): void {
  const section = document.createElement('section');
  section.className = 'placeholder';

  const title = document.createElement('h1');
  title.textContent = 'wwa_puzzle';

  const lead = document.createElement('p');
  lead.textContent = 'WWA 系の見下ろし2Dパズル。実装中。';

  const list = document.createElement('ol');
  for (const phase of PHASES) {
    const item = document.createElement('li');
    item.dataset['done'] = String(phase.done);

    const mark = document.createElement('span');
    mark.className = 'mark';
    mark.textContent = phase.done ? '✓' : '·';
    mark.setAttribute('aria-hidden', 'true');

    const label = document.createElement('span');
    label.textContent = `Phase ${phase.no} — ${phase.name}`;

    item.append(mark, label);
    list.append(item);
  }

  section.append(title, lead, list);
  root.replaceChildren(section);
}

const root = document.querySelector<HTMLElement>('#app');
if (root) {
  render(root);
}
