import './style.css';
import './game/game.css';
import { mountGame } from './game/app.ts';
import { loadBuiltinMaps } from './maps/index.ts';

const root = document.querySelector<HTMLElement>('#app');
if (root !== null) {
  const maps = loadBuiltinMaps();

  const header = document.createElement('header');
  header.className = 'app-header';

  const title = document.createElement('h1');
  title.textContent = 'wwa_puzzle';

  const picker = document.createElement('select');
  picker.className = 'map-picker';
  picker.setAttribute('aria-label', 'マップを選ぶ');
  for (const entry of maps) {
    const option = document.createElement('option');
    option.value = entry.id;
    option.textContent = entry.name;
    picker.append(option);
  }

  header.append(title, picker);

  const stage = document.createElement('main');
  stage.className = 'stage';

  root.replaceChildren(header, stage);

  const start = (id: string): void => {
    const entry = maps.find((candidate) => candidate.id === id) ?? maps[0];
    if (entry !== undefined) mountGame(stage, entry.map);
  };

  picker.addEventListener('change', () => start(picker.value));
  start(picker.value);
}
