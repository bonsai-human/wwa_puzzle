/**
 * 画面の組み立てと入力の受け付け。設計 §11.1 / §11.2 / §11.3。
 *
 * すべての操作にタップ可能なUIを用意し、キーボードは加速手段として重ねる。
 * ホバーに依存する情報は作らない。どちらか一方でしか到達できない機能を作らない。
 */

import { xOf, yOf } from '../core/index.ts';
import type { CompiledMap, Direction } from '../core/index.ts';
import { BoardView, renderOverview } from './render.ts';
import type { ScreenPos, ViewState } from './render.ts';
import { InfoPanel } from './panel.ts';
import { Session } from './session.ts';
import type { TapResult } from './session.ts';
import { applyTheme } from './theme.ts';
import { describeEffect } from './format.ts';

/** 画面遷移の演出時間。長いと操作が待たされ、短いと位置関係が分からない。 */
const TRANSITION_MS = 130;
/** 1マス歩くのにかける時間。 */
const STEP_MS = 45;
/** これ以上動いたらタップではなくスワイプとみなす。 */
const SWIPE_THRESHOLD = 24;
/** これ以下ならタップとみなす。 */
const TAP_SLOP = 12;

interface Animation {
  /** 通過するセル。先頭は出発点。 */
  readonly cells: readonly number[];
  readonly from: ScreenPos | null;
  readonly to: ScreenPos;
  readonly startedAt: number;
  readonly walkMs: number;
}

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function mountGame(root: HTMLElement, map: CompiledMap): void {
  applyTheme();

  const session = new Session(map);

  const layout = document.createElement('div');
  layout.className = 'game';

  const boardArea = document.createElement('div');
  boardArea.className = 'board-area';

  const canvas = document.createElement('canvas');
  canvas.className = 'board';
  canvas.tabIndex = 0;
  canvas.setAttribute('role', 'application');
  canvas.setAttribute('aria-label', '盤面');
  boardArea.append(canvas);

  const panelArea = document.createElement('div');
  panelArea.className = 'panel-area';

  const overviewDialog = document.createElement('dialog');
  overviewDialog.className = 'sheet overview';
  const overviewCanvas = document.createElement('canvas');
  const overviewClose = document.createElement('button');
  overviewClose.type = 'button';
  overviewClose.className = 'control';
  overviewClose.textContent = '閉じる';
  overviewClose.addEventListener('click', () => overviewDialog.close());
  const overviewBody = document.createElement('div');
  overviewBody.className = 'sheet-body';
  const overviewTitle = document.createElement('h2');
  overviewTitle.textContent = '全体マップ';
  const overviewNote = document.createElement('p');
  overviewNote.className = 'sheet-lead';
  overviewNote.textContent = '一度訪れた画面だけが見えます。';
  overviewBody.append(overviewTitle, overviewNote, overviewCanvas);
  overviewDialog.append(overviewBody, overviewClose);

  const banner = document.createElement('div');
  banner.className = 'banner';
  banner.hidden = true;

  const view = new BoardView(canvas, map);

  const panel = new InfoPanel(session, {
    onUndo: () => {
      session.undo();
      panel.notify(null);
      refresh();
    },
    onRedo: () => {
      session.redo();
      panel.notify(null);
      refresh();
    },
    onReset: () => {
      session.reset();
      panel.notify(null);
      refresh();
    },
    onExchange: (slot) => {
      const option = map.options[slot];
      const result = session.exchange(slot);
      panel.notify(
        result.kind === 'exchanged' && option !== undefined
          ? `${describeEffect(map, option.effect)} を手に入れた。`
          : '交換できませんでした。',
      );
      refresh();
    },
    onResolveSelected: () => {
      const cell = session.selected;
      if (cell !== null) handle(session.resolve(cell));
    },
    onToggleOverview: () => {
      renderOverviewNow();
      if (!overviewDialog.open) overviewDialog.showModal();
    },
  });

  panelArea.append(panel.root);
  layout.append(boardArea, panelArea);
  root.replaceChildren(banner, layout, overviewDialog);

  // --- 表示状態 ---------------------------------------------------------

  let camera: ScreenPos = session.screen;
  let animation: Animation | null = null;

  function currentView(now: number): { view: ViewState; playerAt: { x: number; y: number } } {
    if (animation === null) {
      return {
        view: { screen: camera, from: null, progress: 1 },
        playerAt: { x: xOf(map, session.state.pos), y: yOf(map, session.state.pos) },
      };
    }

    const elapsed = now - animation.startedAt;
    const walk = animation.walkMs === 0 ? 1 : Math.min(1, elapsed / animation.walkMs);
    const slide = Math.min(1, elapsed / TRANSITION_MS);

    // 経路上の位置を補間する。歩いた道筋が見えないと、
    // 何が起きて自分がどこへ動いたのかが読み取れない。
    const steps = animation.cells.length - 1;
    const t = walk * steps;
    const index = Math.min(steps, Math.floor(t));
    const frac = Math.min(1, t - index);
    const a = animation.cells[index]!;
    const b = animation.cells[Math.min(steps, index + 1)]!;

    const playerAt = {
      x: xOf(map, a) + (xOf(map, b) - xOf(map, a)) * frac,
      y: yOf(map, a) + (yOf(map, b) - yOf(map, a)) * frac,
    };

    if (walk >= 1 && slide >= 1) {
      animation = null;
      return {
        view: { screen: camera, from: null, progress: 1 },
        playerAt: { x: xOf(map, session.state.pos), y: yOf(map, session.state.pos) },
      };
    }

    return { view: { screen: animation.to, from: animation.from, progress: slide }, playerAt };
  }

  let frameRequested = false;
  function draw(): void {
    frameRequested = false;
    const { view: state, playerAt } = currentView(performance.now());
    view.render(session.state, state, session.selected, playerAt);
    if (animation !== null) requestFrame();
  }

  function requestFrame(): void {
    if (frameRequested) return;
    frameRequested = true;
    requestAnimationFrame(draw);
  }

  function refresh(): void {
    const target = session.screen;
    if (target.x !== camera.x || target.y !== camera.y) camera = target;

    panel.update();
    banner.hidden = !session.cleared;
    if (session.cleared) {
      banner.textContent = `クリア。残りHP ${session.state.hp} ／ ${session.moveCount} 手`;
    }

    if (overviewDialog.open) renderOverviewNow();
    requestFrame();
  }

  function startAnimation(path: readonly number[], previous: number): void {
    if (path.length === 0) {
      refresh();
      return;
    }

    const from = session.screenOf(previous);
    const to = session.screen;
    const changed = from.x !== to.x || from.y !== to.y;

    camera = to;
    animation = prefersReducedMotion()
      ? null
      : {
          cells: [previous, ...path],
          from: changed ? from : null,
          to,
          startedAt: performance.now(),
          walkMs: Math.min(400, path.length * STEP_MS),
        };

    refresh();
  }

  function handle(result: TapResult): void {
    switch (result.kind) {
      case 'ignored':
        return;

      case 'selected':
      case 'deselected':
        panel.notify(null);
        refresh();
        return;

      case 'blocked':
        panel.notifyBlocked(result.reason);
        refresh();
        return;

      case 'moved':
      case 'resolved': {
        panel.notify(result.kind === 'resolved' ? describeOutcome(result) : null);
        startAnimation(result.path, session.previousPosition);

        // 祭壇に乗ったら交換シートを開く。
        const object = map.objectAt[session.state.pos] ?? null;
        if (object !== null && object.type === 'altar') panel.openAltar();
        return;
      }
    }
  }

  function describeOutcome(result: Extract<TapResult, { kind: 'resolved' }>): string | null {
    switch (result.outcome.kind) {
      case 'battle':
        return `${result.outcome.enemy.source.name ?? '敵'}を倒した。HP -${result.outcome.cost}、オーブ +${result.outcome.enemy.orb}`;
      case 'item':
        return `${describeEffect(map, result.outcome.item.effect)} を手に入れた。`;
      case 'door':
        return result.outcome.usedMasterKey ? 'マスターキーで開けた。' : '扉を開けた。';
      default:
        return null;
    }
  }

  function renderOverviewNow(): void {
    const maxWidth = Math.min(window.innerWidth - 64, 420);
    renderOverview(overviewCanvas, map, session.state, session.visitedScreens, maxWidth);
  }

  // --- 入力 -------------------------------------------------------------

  let pointerStart: { x: number; y: number; id: number } | null = null;

  canvas.addEventListener('pointerdown', (event) => {
    pointerStart = { x: event.clientX, y: event.clientY, id: event.pointerId };
    canvas.focus();
  });

  canvas.addEventListener('pointerup', (event) => {
    const start = pointerStart;
    pointerStart = null;
    if (start === null || start.id !== event.pointerId) return;

    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    const distance = Math.hypot(dx, dy);

    if (distance >= SWIPE_THRESHOLD) {
      const direction: Direction =
        Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
      handle(session.stepToward(direction));
      return;
    }

    if (distance > TAP_SLOP) return;

    const { view: state } = currentView(performance.now());
    const cell = view.cellAt(event.clientX, event.clientY, state);
    if (cell !== null) handle(session.tap(cell));
  });

  canvas.addEventListener('pointercancel', () => {
    pointerStart = null;
  });

  const KEY_DIRECTIONS: Readonly<Record<string, Direction>> = {
    ArrowUp: 'up',
    ArrowDown: 'down',
    ArrowLeft: 'left',
    ArrowRight: 'right',
    w: 'up',
    s: 'down',
    a: 'left',
    d: 'right',
  };

  window.addEventListener('keydown', (event) => {
    if (event.target instanceof HTMLButtonElement && event.key === 'Enter') return;

    const direction = KEY_DIRECTIONS[event.key];
    if (direction !== undefined) {
      event.preventDefault();
      handle(session.stepToward(direction));
      return;
    }

    // ショートカットは加速手段でしかない。同じ操作は必ずボタンからも行える。
    const key = event.key.toLowerCase();
    if ((event.ctrlKey || event.metaKey) && key === 'z') {
      event.preventDefault();
      if (event.shiftKey) session.redo();
      else session.undo();
      panel.notify(null);
      refresh();
      return;
    }

    if (key === 'enter' && session.selected !== null) {
      event.preventDefault();
      handle(session.resolve(session.selected));
      return;
    }

    if (key === 'm') {
      event.preventDefault();
      renderOverviewNow();
      if (!overviewDialog.open) overviewDialog.showModal();
    }
  });

  // --- 大きさの追従 -----------------------------------------------------

  const observer = new ResizeObserver((entries) => {
    const box = entries[0]?.contentRect;
    if (box === undefined || box.width === 0 || box.height === 0) return;
    view.fit(box.width, box.height);
    requestFrame();
  });
  observer.observe(boardArea);

  view.fit(boardArea.clientWidth || 320, boardArea.clientHeight || 320);
  refresh();
}
