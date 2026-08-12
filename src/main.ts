import './style.css';
import './game/game.css';
import './editor/editor.css';
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

  nav.append(picker, modeButton);
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

  picker.addEventListener('change', render);
  window.addEventListener('hashchange', render);

  render();
}
