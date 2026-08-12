/**
 * 盤面の描画。設計 §11.3 / §11.6。
 *
 * カメラはスクロールせず画面単位でスナップする。マップは単一の座標空間で、
 * 量子化されるのは表示だけである（設計 §3.7）。
 */

import { checkEnter, isConsumed, xOf, yOf } from '../core/index.ts';
import type { CompiledMap, GameState } from '../core/index.ts';
import { PALETTE } from './theme.ts';
import {
  computeThreatTiers,
  drawFloor,
  drawGoal,
  drawObject,
  drawOverlay,
  drawPlayer,
  drawWall,
} from './sprites.ts';
import type { Overlay, SpriteContext } from './sprites.ts';

export interface ScreenPos {
  readonly x: number;
  readonly y: number;
}

export interface ViewState {
  /** 表示中の画面。 */
  readonly screen: ScreenPos;
  /** 画面遷移中の遷移元。演出しない場合は null。 */
  readonly from: ScreenPos | null;
  /** 遷移の進み具合 0〜1。 */
  readonly progress: number;
}

/** 最小のタイル寸法。これを下回るなら盤面が読めないので、はみ出しても縮めない。 */
const MIN_TILE = 14;

export class BoardView {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly tiers: ReadonlyMap<string, number>;

  private tile = 24;
  private boardWidth = 0;
  private boardHeight = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly map: CompiledMap,
  ) {
    const ctx = canvas.getContext('2d');
    if (ctx === null) throw new Error('2D コンテキストを取得できません');
    this.ctx = ctx;
    this.tiers = computeThreatTiers(map);
  }

  get tileSize(): number {
    return this.tile;
  }

  /**
   * 使える領域に合わせてタイル寸法を決める。
   * 整数にスナップして、半端な倍率でのにじみを避ける（設計 §11.3）。
   */
  fit(availableWidth: number, availableHeight: number): void {
    const { width: cols, height: rows } = this.map.screen;
    const tile = Math.max(
      MIN_TILE,
      Math.floor(Math.min(availableWidth / cols, availableHeight / rows)),
    );

    this.tile = tile;
    this.boardWidth = tile * cols;
    this.boardHeight = tile * rows;

    // CSS 上の大きさと、実際に描く解像度を分ける。高DPI端末でぼやけないように。
    const ratio = window.devicePixelRatio || 1;
    this.canvas.style.width = `${this.boardWidth}px`;
    this.canvas.style.height = `${this.boardHeight}px`;
    this.canvas.width = Math.round(this.boardWidth * ratio);
    this.canvas.height = Math.round(this.boardHeight * ratio);
    this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  /** キャンバス上の座標からセル番号を求める。範囲外なら null。 */
  cellAt(clientX: number, clientY: number, view: ViewState): number | null {
    const rect = this.canvas.getBoundingClientRect();
    const localX = clientX - rect.left;
    const localY = clientY - rect.top;
    if (localX < 0 || localY < 0 || localX >= this.boardWidth || localY >= this.boardHeight) {
      return null;
    }

    const column = Math.floor(localX / this.tile);
    const row = Math.floor(localY / this.tile);
    const x = view.screen.x * this.map.screen.width + column;
    const y = view.screen.y * this.map.screen.height + row;
    if (x < 0 || x >= this.map.width || y < 0 || y >= this.map.height) return null;

    return y * this.map.width + x;
  }

  /**
   * @param playerAt プレイヤーを描く位置（マップ座標、小数可）。歩行演出用。
   *   省略時は状態の位置に描く。
   */
  render(
    state: GameState,
    view: ViewState,
    selected: number | null,
    playerAt?: { readonly x: number; readonly y: number },
  ): void {
    const { ctx } = this;
    ctx.fillStyle = PALETTE.bg;
    ctx.fillRect(0, 0, this.boardWidth, this.boardHeight);

    const at = playerAt ?? { x: xOf(this.map, state.pos), y: yOf(this.map, state.pos) };

    if (view.from === null || view.progress >= 1) {
      this.drawScreen(state, view.screen, 0, 0, selected, at);
    } else {
      // 遷移中は2画面を並べて滑らせる。
      const dx = (view.screen.x - view.from.x) * this.boardWidth;
      const dy = (view.screen.y - view.from.y) * this.boardHeight;
      const shiftX = -dx * view.progress;
      const shiftY = -dy * view.progress;

      this.drawScreen(state, view.from, shiftX, shiftY, selected, at);
      this.drawScreen(state, view.screen, shiftX + dx, shiftY + dy, selected, at);
    }

    this.drawEdgeArrows(view);
  }

  private drawScreen(
    state: GameState,
    screen: ScreenPos,
    offsetX: number,
    offsetY: number,
    selected: number | null,
    playerAt: { readonly x: number; readonly y: number },
  ): void {
    const { ctx, map, tile } = this;
    const cols = map.screen.width;
    const rows = map.screen.height;
    const baseX = screen.x * cols;
    const baseY = screen.y * rows;

    for (let row = 0; row < rows; row++) {
      const y = baseY + row;
      if (y < 0 || y >= map.height) continue;

      for (let column = 0; column < cols; column++) {
        const x = baseX + column;
        if (x < 0 || x >= map.width) continue;

        const cell = y * map.width + x;
        const target: SpriteContext = {
          ctx,
          x: offsetX + column * tile,
          y: offsetY + row * tile,
          size: tile,
        };

        if (map.walls[cell] === 1) {
          drawWall(target);
          continue;
        }

        drawFloor(target, (x + y) % 2 === 0);
        if (cell === map.goalCell) drawGoal(target);

        const object = map.objectAt[cell] ?? null;
        if (object !== null && (object.type === 'altar' || !isConsumed(state, cell))) {
          drawObject(target, object, this.tiers);
          drawOverlay(target, this.overlayFor(state, cell));
        }

        if (cell === selected) this.drawSelection(target);
      }
    }

    // プレイヤーは自分がいる画面にだけ描く。
    if (
      Math.floor(playerAt.x / cols) === screen.x &&
      Math.floor(playerAt.y / rows) === screen.y
    ) {
      drawPlayer({
        ctx,
        x: offsetX + (playerAt.x - baseX) * tile,
        y: offsetY + (playerAt.y - baseY) * tile,
        size: tile,
      });
    }
  }

  /** そのセルが今のプレイヤーにとって通れないかどうか。 */
  private overlayFor(state: GameState, cell: number): Overlay {
    const check = checkEnter(this.map, state, cell);
    if (check.ok) return 'none';
    if (check.reason.kind === 'unbeatable') return 'unbeatable';
    if (check.reason.kind === 'insufficientHp') return 'unaffordable';
    return 'none';
  }

  private drawSelection(target: SpriteContext): void {
    const { ctx, x, y, size } = target;
    ctx.strokeStyle = PALETTE.accent;
    ctx.lineWidth = Math.max(2, size * 0.09);
    ctx.strokeRect(
      x + ctx.lineWidth / 2,
      y + ctx.lineWidth / 2,
      size - ctx.lineWidth,
      size - ctx.lineWidth,
    );
  }

  /** 隣接画面があることを示す矢印（参考画像の ▲▼◀▶ に相当）。 */
  private drawEdgeArrows(view: ViewState): void {
    const { ctx, map } = this;
    const screensX = Math.ceil(map.width / map.screen.width);
    const screensY = Math.ceil(map.height / map.screen.height);
    const size = Math.max(8, this.tile * 0.45);

    const arrows: [boolean, number, number, number][] = [
      [view.screen.y > 0, this.boardWidth / 2, size * 0.7, -Math.PI / 2],
      [view.screen.x < screensX - 1, this.boardWidth - size * 0.7, this.boardHeight / 2, 0],
      [view.screen.y < screensY - 1, this.boardWidth / 2, this.boardHeight - size * 0.7, Math.PI / 2],
      [view.screen.x > 0, size * 0.7, this.boardHeight / 2, Math.PI],
    ];

    ctx.fillStyle = 'rgba(236, 231, 242, 0.5)';
    for (const [visible, cx, cy, rotation] of arrows) {
      if (!visible) continue;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(rotation);
      ctx.beginPath();
      ctx.moveTo(size * 0.42, 0);
      ctx.lineTo(-size * 0.3, -size * 0.36);
      ctx.lineTo(-size * 0.3, size * 0.36);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }
}

/**
 * 全体マップ。訪問済みの画面だけを縮小表示する（設計 §11.6）。
 *
 * 全画面を最初から見せると探索の楽しみが消え、逆に何も見せないと
 * 「3画面前にあった青い鍵」を暗記させることになる。訪問済みだけが折衷点。
 */
export function renderOverview(
  canvas: HTMLCanvasElement,
  map: CompiledMap,
  state: GameState,
  visited: ReadonlySet<number>,
  maxWidth: number,
): void {
  const ctx = canvas.getContext('2d');
  if (ctx === null) return;

  const scale = Math.max(2, Math.floor(maxWidth / map.width));
  const ratio = window.devicePixelRatio || 1;
  const width = map.width * scale;
  const height = map.height * scale;

  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

  ctx.fillStyle = PALETTE.bg;
  ctx.fillRect(0, 0, width, height);

  const screensX = Math.ceil(map.width / map.screen.width);
  const screensY = Math.ceil(map.height / map.screen.height);

  for (let sy = 0; sy < screensY; sy++) {
    for (let sx = 0; sx < screensX; sx++) {
      const originX = sx * map.screen.width * scale;
      const originY = sy * map.screen.height * scale;
      const boxWidth = map.screen.width * scale;
      const boxHeight = map.screen.height * scale;

      if (!visited.has(sy * screensX + sx)) {
        ctx.fillStyle = PALETTE.panelSoft;
        ctx.fillRect(originX, originY, boxWidth, boxHeight);
        continue;
      }

      for (let row = 0; row < map.screen.height; row++) {
        const y = sy * map.screen.height + row;
        if (y >= map.height) break;

        for (let column = 0; column < map.screen.width; column++) {
          const x = sx * map.screen.width + column;
          if (x >= map.width) break;

          const cell = y * map.width + x;
          const object = map.objectAt[cell] ?? null;
          const alive = object !== null && (object.type === 'altar' || !isConsumed(state, cell));

          let color: string = map.walls[cell] === 1 ? PALETTE.wall : PALETTE.floor;
          if (cell === map.goalCell) color = PALETTE.goal;
          else if (alive && object !== null) {
            color =
              object.type === 'enemy'
                ? PALETTE.danger
                : object.type === 'door'
                  ? PALETTE.accent
                  : object.type === 'altar'
                    ? PALETTE.altar
                    : PALETTE.ok;
          }

          ctx.fillStyle = color;
          ctx.fillRect(x * scale, y * scale, scale, scale);
        }
      }

      ctx.strokeStyle = PALETTE.line;
      ctx.lineWidth = 1;
      ctx.strokeRect(originX + 0.5, originY + 0.5, boxWidth - 1, boxHeight - 1);
    }
  }

  // 現在位置。
  ctx.fillStyle = PALETTE.player;
  ctx.fillRect(xOf(map, state.pos) * scale, yOf(map, state.pos) * scale, scale, scale);
}
