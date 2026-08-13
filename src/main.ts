import './style.css';
import './game/game.css';
import './editor/editor.css';
import { compileMap, parseMapDef } from './core/index.ts';
import { decodeMap, parseRoute, shareUrl } from './app/share.ts';
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

  const shareButton = document.createElement('button');
  shareButton.type = 'button';
  shareButton.className = 'control';
  shareButton.textContent = '共有';

  nav.append(picker, generateButton, shareButton, modeButton);
  header.append(title, nav);

  const stage = document.createElement('main');
  stage.className = 'stage';

  root.replaceChildren(header, stage);

  const currentMap = (): (typeof maps)[number] | undefined =>
    maps.find((entry) => entry.id === picker.value) ?? maps[0];

  function render(): void {
    const editing = parseRoute(window.location.hash).path.startsWith('/edit');
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

  /**
   * 共有。サーバーが無いので、マップそのものをURLに圧縮して埋める（設計 §10）。
   * 長すぎて載らない場合はファイルとして書き出す。
   */
  shareButton.addEventListener('click', () => {
    const entry = currentMap();
    if (entry === undefined) return;

    void shareUrl(entry.map.def).then(async (url) => {
      if (url === null) {
        const blob = new Blob([JSON.stringify(entry.map.def, null, 2)], {
          type: 'application/json',
        });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `${entry.map.def.id}.json`;
        link.click();
        URL.revokeObjectURL(link.href);

        shareButton.textContent = '長いので保存';
      } else {
        try {
          await navigator.clipboard.writeText(url);
          shareButton.textContent = 'URLをコピー済み';
        } catch {
          // クリップボードは権限で失敗しうる。URLをアドレス欄に載せて手動コピーに回す。
          window.location.hash = new URL(url).hash;
          shareButton.textContent = 'URLを表示';
        }
      }
      window.setTimeout(() => (shareButton.textContent = '共有'), 2500);
    });
  });

  /** 共有URLで開かれた場合、埋め込まれたマップを取り込む。 */
  async function adoptSharedMap(): Promise<boolean> {
    const encoded = parseRoute(window.location.hash).params.get('m');
    if (encoded === null) return false;

    try {
      const def = await decodeMap(encoded);
      if (maps.some((candidate) => candidate.id === def.id)) {
        picker.value = def.id;
        return false;
      }

      const map = compileMap(def);
      maps.push({ id: def.id, name: `${def.name}（共有）`, map });

      const option = document.createElement('option');
      option.value = def.id;
      option.textContent = `${def.name}（共有）`;
      picker.append(option);
      picker.value = def.id;
      return true;
    } catch (error) {
      // 壊れた文字列で画面は止めない。ただし黙って無視すると、
      // 共有された相手には「開いたのに違うマップが出た」としか見えない。
      shareButton.textContent = '共有マップを読めません';
      console.warn('共有マップの読み込みに失敗:', error);
      window.setTimeout(() => (shareButton.textContent = '共有'), 4000);
      return false;
    }
  }

  picker.addEventListener('change', render);
  window.addEventListener('hashchange', render);

  void adoptSharedMap().then(() => render());
}
