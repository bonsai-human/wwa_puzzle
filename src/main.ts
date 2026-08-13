import './style.css';
import './game/game.css';
import './editor/editor.css';
import { compileMap, parseMapDef } from './core/index.ts';
import { SolverClient } from './solver/client.ts';
import { mountGame } from './game/app.ts';
import { mountEditor } from './editor/app.ts';
import { loadBuiltinMaps } from './maps/index.ts';

/**
 * 画面の振り分け。
 *
 * ハッシュルーティングを使う。GitHub Pages はパスのフォールバックを設定できないので、
 * `/edit` のようなパスで直接開かれると 404 になる（設計 §10）。
 */

const root = document.querySelector<HTMLElement>('#app');

if (root !== null) {
  const maps = loadBuiltinMaps();

  const header = document.createElement('header');
  header.className = 'app-header';

  const title = document.createElement('h1');
  title.textContent = 'wwa_puzzle';

  const nav = document.createElement('div');
  nav.className = 'app-nav';

  const picker = document.createElement('select');
  picker.className = 'map-picker';
  picker.setAttribute('aria-label', 'マップを選ぶ');
  for (const entry of maps) {
    const option = document.createElement('option');
    option.value = entry.id;
    option.textContent = entry.name;
    picker.append(option);
  }

  const modeButton = document.createElement('button');
  modeButton.type = 'button';
  modeButton.className = 'control';

  const generateButton = document.createElement('button');
  generateButton.type = 'button';
  generateButton.className = 'control';
  generateButton.textContent = '生成';

  nav.append(picker, generateButton, modeButton);
  header.append(title, nav);

  const stage = document.createElement('main');
  stage.className = 'stage';

  root.replaceChildren(header, stage);

  const currentMap = (): (typeof maps)[number] | undefined =>
    maps.find((entry) => entry.id === picker.value) ?? maps[0];

  function render(): void {
    const editing = window.location.hash.startsWith('#/edit');
    const entry = currentMap();
    if (entry === undefined) return;

    modeButton.textContent = editing ? '遊ぶ' : 'エディタ';
    picker.hidden = editing;

    if (editing) mountEditor(stage, entry.map.def);
    else mountGame(stage, entry.map);
  }

  modeButton.addEventListener('click', () => {
    window.location.hash = window.location.hash.startsWith('#/edit') ? '#/play' : '#/edit';
  });

  /**
   * 自動生成。解き直しを何十回も含むので Worker に投げる。
   * メインスレッドで回すと1秒近く固まり、モバイルではさらに伸びる（設計 §7.8）。
   */
  const generator = new SolverClient();

  generateButton.addEventListener('click', () => {
    generateButton.disabled = true;
    generateButton.textContent = '生成中…';

    const seed = Math.floor(Math.random() * 1_000_000) + 1;

    void generator.generate({ seed }).then((outcome) => {
      generateButton.disabled = false;
      generateButton.textContent = '生成';

      if (outcome.kind !== 'generated') {
        generateButton.textContent = '生成に失敗';
        window.setTimeout(() => (generateButton.textContent = '生成'), 2000);
        return;
      }

      const map = compileMap(parseMapDef(outcome.map));
      const entry = { id: map.def.id, name: `${map.def.name}${outcome.meetsCriteria ? '' : '（基準未達）'}`, map };
      maps.push(entry);

      const option = document.createElement('option');
      option.value = entry.id;
      option.textContent = entry.name;
      picker.append(option);
      picker.value = entry.id;

      window.location.hash = '#/play';
      render();
    });
  });

  picker.addEventListener('change', render);
  window.addEventListener('hashchange', render);

  render();
}
