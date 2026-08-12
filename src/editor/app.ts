/**
 * マップエディタ。設計 §9。
 *
 * このエディタの主な価値は配置操作ではなく、**編集のたびにソルバーを走らせて
 * 「解けるか」「終了時HP」「難易度指標」を出し続けること**にある。
 * 手作業のマップ設計はこの即時フィードバックなしでは現実的に成立しない。
 * 実際、同梱マップを手で書いたときも、扉が迂回できて機能していないことに
 * ソルバーを通すまで気づけなかった。
 */

import { compileMap, initialState, parseMapDef, validateMapDef } from '../core/index.ts';
import type { CompiledMap, MapDef, PlacedObject } from '../core/index.ts';
import { SolverClient } from '../solver/client.ts';
import type { SolveOutcome } from '../solver/client.ts';
import { BoardView } from '../game/render.ts';
import { applyTheme } from '../game/theme.ts';
import { button, el, numberField, textField } from '../ui/dom.ts';
import {
  DraftHistory,
  draftFromMapDef,
  draftToMapDef,
  emptyDraft,
  isReserved,
  objectAt,
  withGoal,
  withObject,
  withSize,
  withStart,
  withTile,
  withoutObjectAt,
} from './draft.ts';
import type { DraftState } from './draft.ts';
import { TOOLS, findTool, instantiate } from './palette.ts';
import type { Tool } from './palette.ts';

/** 編集の手が止まってから走らせるまでの待ち。連打のたびに投げ直さないため。 */
const SOLVE_DEBOUNCE_MS = 250;
/** エディタでの探索予算。作業を待たせないよう、遊ぶときより短く切る。 */
const EDITOR_MAX_STATES = 60_000;

export function mountEditor(root: HTMLElement, initial?: MapDef): void {
  applyTheme();

  const history = new DraftHistory(initial === undefined ? emptyDraft() : draftFromMapDef(initial));
  const solver = new SolverClient();

  let tool: Tool = TOOLS[0]!;
  let selected: { x: number; y: number } | null = null;
  let screen = { x: 0, y: 0 };
  let altarSeq = 1;
  let compiled: CompiledMap | null = null;
  let boardView: BoardView | null = null;
  let solveTimer: number | null = null;

  // --- 骨組み -----------------------------------------------------------

  const layout = el('div', 'editor');
  const boardArea = el('div', 'board-area');
  const canvas = el('canvas', 'board');
  canvas.tabIndex = 0;
  const screenNav = el('div', 'screen-nav');
  boardArea.append(canvas, screenNav);

  const panel = el('div', 'editor-panel');
  const toolBox = el('div', 'tools');
  const statusBox = el('div', 'status');
  const propertyBox = el('div', 'properties');
  const settingsBox = el('div', 'settings');
  const issueBox = el('ul', 'issues');
  const jsonArea = el('textarea', 'json');
  jsonArea.spellcheck = false;
  jsonArea.rows = 8;

  const historyRow = el('div', 'controls');
  const undoButton = button('戻す', 'control', () => {
    if (history.undo()) refresh();
  });
  const redoButton = button('進める', 'control', () => {
    if (history.redo()) refresh();
  });
  historyRow.append(undoButton, redoButton);

  const jsonRow = el('div', 'controls');
  jsonRow.append(
    button('JSONを反映', 'control', importJson),
    button('JSONを更新', 'control', () => {
      jsonArea.value = JSON.stringify(draftToMapDef(history.current), null, 2);
    }),
    button('ダウンロード', 'control', download),
  );

  const section = (title: string, ...children: HTMLElement[]): HTMLElement => {
    const node = el('section', 'section');
    node.append(el('h2', undefined, title), ...children);
    return node;
  };

  panel.append(
    section('検定', statusBox, issueBox),
    section('道具', toolBox),
    historyRow,
    section('選択中', propertyBox),
    section('マップ設定', settingsBox),
    section('JSON', jsonArea, jsonRow),
  );

  layout.append(boardArea, panel);
  root.replaceChildren(layout);

  buildTools();
  refresh();

  // --- 道具 -------------------------------------------------------------

  function buildTools(): void {
    toolBox.replaceChildren(
      ...TOOLS.map((candidate) => {
        const node = button(candidate.label, 'tool', () => {
          tool = candidate;
          buildTools();
        });
        node.classList.toggle('is-active', candidate.id === tool.id);
        return node;
      }),
    );
  }

  // --- 編集 -------------------------------------------------------------

  function applyTool(x: number, y: number): void {
    const draft = history.current;

    if (tool.kind === 'select') {
      selected = { x, y };
      renderProperties();
      return;
    }

    let next: DraftState = draft;
    switch (tool.kind) {
      case 'terrain':
        next = withTile(draft, x, y, tool.tile);
        break;
      case 'erase':
        next = withoutObjectAt(draft, x, y);
        break;
      case 'start':
        next = withStart(draft, x, y);
        break;
      case 'goal':
        next = withGoal(draft, x, y);
        break;
      case 'object':
        if (isReserved(draft, x, y)) break;
        next = withObject(draft, instantiate(tool, x, y, altarSeq++));
        break;
    }

    if (history.apply(next)) {
      selected = { x, y };
      refresh();
    }
  }

  function update(mutate: (draft: DraftState) => DraftState): void {
    if (history.apply(mutate(history.current))) refresh();
  }

  // --- 描画 -------------------------------------------------------------

  function refresh(): void {
    const draft = history.current;
    const def = draftToMapDef(draft);
    const validation = validateMapDef(def);

    issueBox.replaceChildren(
      ...(validation.ok ? [] : validation.issues.map((issue) => el('li', undefined, issue))),
    );

    if (validation.ok) {
      compiled = compileMap(validation.map);
      boardView = new BoardView(canvas, compiled);
      fitBoard();
    }

    undoButton.disabled = !history.canUndo;
    redoButton.disabled = !history.canRedo;

    renderScreenNav(draft);
    renderProperties();
    renderSettings(draft);
    jsonArea.value = JSON.stringify(def, null, 2);

    drawBoard();
    scheduleSolve(def, validation.ok);
  }

  function fitBoard(): void {
    const width = boardArea.clientWidth || 480;
    const height = boardArea.clientHeight || 480;
    boardView?.fit(width, Math.max(240, height - 48));
  }

  function drawBoard(): void {
    if (boardView === null || compiled === null) return;
    boardView.render(
      initialState(compiled),
      { screen, from: null, progress: 1 },
      selected === null ? null : selected.y * compiled.width + selected.x,
    );
  }

  function renderScreenNav(draft: DraftState): void {
    const screensX = Math.ceil(draft.width / draft.screen.width);
    const screensY = Math.ceil(draft.height / draft.screen.height);

    if (screensX * screensY <= 1) {
      screen = { x: 0, y: 0 };
      screenNav.replaceChildren();
      return;
    }

    screen = {
      x: Math.min(screen.x, screensX - 1),
      y: Math.min(screen.y, screensY - 1),
    };

    const nodes: HTMLElement[] = [];
    for (let y = 0; y < screensY; y++) {
      for (let x = 0; x < screensX; x++) {
        const node = button(`${x + 1},${y + 1}`, 'control', () => {
          screen = { x, y };
          renderScreenNav(draft);
          drawBoard();
        });
        node.classList.toggle('is-active', x === screen.x && y === screen.y);
        nodes.push(node);
      }
    }
    screenNav.replaceChildren(...nodes);
  }

  // --- 選択中のマス -----------------------------------------------------

  function renderProperties(): void {
    const draft = history.current;
    if (selected === null) {
      propertyBox.replaceChildren(el('p', 'empty', '「選択」でマスを触ると、ここで数値を直せます。'));
      return;
    }

    const { x, y } = selected;
    const object = objectAt(draft, x, y);
    const nodes: HTMLElement[] = [el('p', 'coords', `(${x}, ${y})`)];

    if (object === null) {
      nodes.push(el('p', 'empty', 'オブジェクトはありません。'));
      propertyBox.replaceChildren(...nodes);
      drawBoard();
      return;
    }

    const edit = (mutate: (object: PlacedObject) => PlacedObject): void => {
      update((current) => ({
        ...current,
        objects: current.objects.map((candidate) =>
          candidate.x === x && candidate.y === y ? mutate(candidate) : candidate,
        ),
      }));
    };

    switch (object.type) {
      case 'enemy':
        nodes.push(
          textField('名前', object.name ?? '', (value) =>
            edit((current) => ({ ...current, name: value })),
          ),
          numberField('HP', object.hp, (value) => edit((c) => ({ ...c, hp: value })), { min: 1 }),
          numberField('攻撃力', object.atk, (value) => edit((c) => ({ ...c, atk: value })), {
            min: 0,
          }),
          numberField('防御力', object.def, (value) => edit((c) => ({ ...c, def: value })), {
            min: 0,
          }),
          numberField('オーブ', object.orb ?? 1, (value) => edit((c) => ({ ...c, orb: value })), {
            min: 0,
          }),
        );
        break;

      case 'item': {
        const effect = object.effect;
        if (effect.kind !== 'masterKey') {
          nodes.push(
            numberField('量', effect.amount, (value) =>
              edit((c) => ({ ...c, effect: { ...effect, amount: Math.max(1, value) } })),
            { min: 1 }),
          );
        }
        if (effect.kind === 'key') {
          nodes.push(
            textField('鍵の色', effect.key, (value) =>
              edit((c) => ({ ...c, effect: { ...effect, key: value } })),
            ),
          );
        }
        nodes.push(el('p', 'note', `種別: ${effect.kind}`));
        break;
      }

      case 'door':
        nodes.push(
          textField('鍵の色', object.key, (value) => edit((c) => ({ ...c, key: value }))),
        );
        break;

      case 'altar':
        object.options.forEach((option, index) => {
          const group = el('div', 'option-edit');
          group.append(el('h3', undefined, option.label ?? option.id));
          group.append(
            numberField('必要オーブ', option.cost, (value) =>
              edit((current) =>
                current.type === 'altar'
                  ? {
                      ...current,
                      options: current.options.map((candidate, i) =>
                        i === index ? { ...candidate, cost: Math.max(0, value) } : candidate,
                      ),
                    }
                  : current,
              ),
            { min: 0 }),
          );
          group.append(
            numberField('在庫', option.stock ?? 99, (value) =>
              edit((current) =>
                current.type === 'altar'
                  ? {
                      ...current,
                      options: current.options.map((candidate, i) =>
                        i === index ? { ...candidate, stock: Math.max(1, value) } : candidate,
                      ),
                    }
                  : current,
              ),
            { min: 1 }),
          );
          nodes.push(group);
        });
        break;
    }

    nodes.push(
      button('このマスを消す', 'control', () => {
        update((current) => withoutObjectAt(current, x, y));
      }),
    );

    propertyBox.replaceChildren(...nodes);
    drawBoard();
  }

  function renderSettings(draft: DraftState): void {
    settingsBox.replaceChildren(
      textField('ID', draft.id, (value) => update((c) => ({ ...c, id: value }))),
      textField('名前', draft.name, (value) => update((c) => ({ ...c, name: value }))),
      numberField('幅', draft.width, (value) => update((c) => withSize(c, Math.max(3, value), c.height)), { min: 3 }),
      numberField('高さ', draft.height, (value) => update((c) => withSize(c, c.width, Math.max(3, value))), { min: 3 }),
      numberField('画面の幅', draft.screen.width, (value) =>
        update((c) => ({ ...c, screen: { ...c.screen, width: Math.max(1, value) } })),
      { min: 1 }),
      numberField('画面の高さ', draft.screen.height, (value) =>
        update((c) => ({ ...c, screen: { ...c.screen, height: Math.max(1, value) } })),
      { min: 1 }),
      numberField('初期HP', draft.player.hp, (value) =>
        update((c) => ({ ...c, player: { ...c.player, hp: Math.max(1, value) } })),
      { min: 1 }),
      numberField('初期攻撃力', draft.player.atk, (value) =>
        update((c) => ({ ...c, player: { ...c.player, atk: Math.max(0, value) } })),
      { min: 0 }),
      numberField('初期防御力', draft.player.def, (value) =>
        update((c) => ({ ...c, player: { ...c.player, def: Math.max(0, value) } })),
      { min: 0 }),
    );
  }

  // --- 常駐する検定 -----------------------------------------------------

  function scheduleSolve(def: MapDef, valid: boolean): void {
    if (solveTimer !== null) window.clearTimeout(solveTimer);

    if (!valid) {
      solver.abort();
      renderStatus({ kind: 'invalid', issues: [] });
      return;
    }

    statusBox.dataset['state'] = 'pending';
    statusBox.replaceChildren(el('p', 'status-line', '検定中…'));

    solveTimer = window.setTimeout(() => {
      void solver
        .request(def, {
          maxStates: EDITOR_MAX_STATES,
          onProgress: (expanded) => {
            statusBox.replaceChildren(
              el('p', 'status-line', `検定中… ${expanded.toLocaleString()} 状態`),
            );
          },
        })
        .then((outcome) => {
          if (outcome.kind !== 'superseded') renderStatus(outcome);
        });
    }, SOLVE_DEBOUNCE_MS);
  }

  function renderStatus(outcome: SolveOutcome): void {
    if (outcome.kind === 'invalid') {
      statusBox.dataset['state'] = 'invalid';
      statusBox.replaceChildren(el('p', 'status-line', 'データが不正です。'));
      return;
    }
    if (outcome.kind === 'error') {
      statusBox.dataset['state'] = 'invalid';
      statusBox.replaceChildren(el('p', 'status-line', `検定に失敗: ${outcome.message}`));
      return;
    }
    if (outcome.kind === 'superseded') return;

    const report = outcome.report;
    const rows: [string, string][] = [];

    const verdict =
      report.status === 'solved' ? '解ける' : report.status === 'dead' ? '詰み' : '判定できず';
    statusBox.dataset['state'] = report.status;

    rows.push(['判定', verdict]);
    if (report.status === 'solved') {
      rows.push(['終了時HP', String(report.hpMargin)]);
      rows.push(['手数', String(report.criticalPath)]);
      // 貪欲法で解けてしまうマップは、どれだけ大きくても考える必要がない。
      rows.push(['貪欲法', report.greedyFails ? '通用しない（良い）' : '通用する（易しすぎ）']);
      rows.push(['考えどころ', String(report.decisionPoints)]);
    }
    if (report.truncated) {
      rows.push(['注意', '予算切れ。数値は当てになりません']);
    }

    const list = el('dl', 'status-rows');
    for (const [label, value] of rows) {
      list.append(el('dt', undefined, label), el('dd', undefined, value));
    }
    statusBox.replaceChildren(list);
  }

  // --- 入出力 -----------------------------------------------------------

  function importJson(): void {
    try {
      const parsed = parseMapDef(JSON.parse(jsonArea.value));
      history.replace(draftFromMapDef(parsed));
      selected = null;
      refresh();
    } catch (error) {
      issueBox.replaceChildren(
        el('li', undefined, error instanceof Error ? error.message : String(error)),
      );
    }
  }

  function download(): void {
    const draft = history.current;
    const blob = new Blob([JSON.stringify(draftToMapDef(draft), null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const link = el('a');
    link.href = url;
    link.download = `${draft.id || 'map'}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  // --- 入力 -------------------------------------------------------------

  let painting = false;

  const cellFromEvent = (event: PointerEvent): { x: number; y: number } | null => {
    if (boardView === null || compiled === null) return null;
    const cell = boardView.cellAt(event.clientX, event.clientY, {
      screen,
      from: null,
      progress: 1,
    });
    if (cell === null) return null;
    return { x: cell % compiled.width, y: Math.floor(cell / compiled.width) };
  };

  canvas.addEventListener('pointerdown', (event) => {
    const at = cellFromEvent(event);
    if (at === null) return;
    canvas.setPointerCapture(event.pointerId);
    painting = true;
    applyTool(at.x, at.y);
  });

  canvas.addEventListener('pointermove', (event) => {
    // 地形は撫でて塗れると速い。オブジェクトは1回ごとに置く。
    if (!painting || (tool.kind !== 'terrain' && tool.kind !== 'erase')) return;
    const at = cellFromEvent(event);
    if (at !== null) applyTool(at.x, at.y);
  });

  const stopPainting = (): void => {
    painting = false;
  };
  canvas.addEventListener('pointerup', stopPainting);
  canvas.addEventListener('pointercancel', stopPainting);

  window.addEventListener('keydown', (event) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
      return;
    }
    const key = event.key.toLowerCase();
    if ((event.ctrlKey || event.metaKey) && key === 'z') {
      event.preventDefault();
      if (event.shiftKey ? history.redo() : history.undo()) refresh();
    }
  });

  const observer = new ResizeObserver(() => {
    fitBoard();
    drawBoard();
  });
  observer.observe(boardArea);

  // 別画面へ移るときに Worker を残さない。
  window.addEventListener('hashchange', () => solver.dispose(), { once: true });
}

/** 同梱マップを編集の出発点として読む。 */
export function editorStartingPoint(raw: unknown): MapDef | undefined {
  const validation = validateMapDef(raw);
  return validation.ok ? validation.map : undefined;
}

export { findTool };
