/**
 * 遊んでいる最中の状態。設計 §11.1 / §11.8。
 *
 * DOM も Canvas も触らない。入力の意味づけと履歴だけを持つ。
 */

import {
  checkEnter,
  cloneState,
  enter,
  exchange,
  findApproach,
  findPath,
  initialState,
  isGoal,
  isPassable,
  xOf,
  yOf,
} from '../core/index.ts';
import type {
  BlockReason,
  CompiledMap,
  Direction,
  EnterOutcome,
  GameState,
} from '../core/index.ts';

const STEP_DELTA: Readonly<Record<Direction, readonly [number, number]>> = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
};

export type TapResult =
  /** 何も起きなかった（範囲外など）。 */
  | { readonly kind: 'ignored' }
  /** 選択しただけ。情報パネルに詳細が出る。もう一度触ると実行する。 */
  | { readonly kind: 'selected'; readonly cell: number }
  | { readonly kind: 'deselected' }
  /** 歩いた。 */
  | { readonly kind: 'moved'; readonly path: readonly number[] }
  /** 解決した。 */
  | {
      readonly kind: 'resolved';
      readonly path: readonly number[];
      readonly outcome: EnterOutcome;
    }
  /** 解決できなかった。理由は必ず提示する（設計 §11.8）。 */
  | { readonly kind: 'blocked'; readonly reason: BlockReason };

export type ExchangeOutcome =
  | { readonly kind: 'exchanged'; readonly slot: number }
  | { readonly kind: 'refused'; readonly reason: string };

export class Session {
  /** 現在までの状態。末尾が現在。 */
  private readonly past: GameState[];
  /** undo で巻き戻した先の状態。 */
  private readonly future: GameState[] = [];

  /** 選択中のセル。1回目のタップで選び、2回目で実行する。 */
  private selectedCell: number | null = null;

  /** 訪問済みの画面。全体マップの表示範囲になる（設計 §11.6）。 */
  private readonly visited = new Set<number>();

  constructor(readonly map: CompiledMap) {
    this.past = [initialState(map)];
    this.markVisited();
  }

  get state(): GameState {
    return this.past[this.past.length - 1]!;
  }

  get selected(): number | null {
    return this.selectedCell;
  }

  get canUndo(): boolean {
    return this.past.length > 1;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  get cleared(): boolean {
    return isGoal(this.map, this.state);
  }

  get moveCount(): number {
    return this.past.length - 1;
  }

  /** 直前の状態での位置。歩行演出の出発点になる。 */
  get previousPosition(): number {
    return this.past[this.past.length - 2]?.pos ?? this.state.pos;
  }

  get visitedScreens(): ReadonlySet<number> {
    return this.visited;
  }

  /** 履歴全体。保存に使う。末尾が現在。 */
  get history(): readonly GameState[] {
    return this.past;
  }

  /**
   * 保存から復元する。undo をまたげるよう履歴ごと入れ替える。
   * 壊れたデータを渡されても盤面が破綻しないよう、空なら何もしない。
   */
  restore(states: readonly GameState[], visited: readonly number[]): boolean {
    if (states.length === 0) return false;

    this.past.length = 0;
    this.past.push(...states);
    this.future.length = 0;
    this.selectedCell = null;

    this.visited.clear();
    for (const screen of visited) this.visited.add(screen);
    this.markVisited();
    return true;
  }

  /** 現在の画面。 */
  get screen(): { readonly x: number; readonly y: number } {
    return this.screenOf(this.state.pos);
  }

  screenOf(cell: number): { readonly x: number; readonly y: number } {
    return {
      x: Math.floor(xOf(this.map, cell) / this.map.screen.width),
      y: Math.floor(yOf(this.map, cell) / this.map.screen.height),
    };
  }

  select(cell: number | null): void {
    this.selectedCell = cell;
  }

  /**
   * 盤面をタップ／クリックしたときの意味づけ。設計 §11.1。
   *
   * 通行可能なセルなら、そこまで自動で歩く（道中で何も解決しない）。
   * オブジェクトなら、1回目は選択して情報を出すだけ、2回目で解決する。
   * この2段構えが、誤タップで大きなHPを失うことへの防御になっている。
   */
  tap(cell: number): TapResult {
    if (cell < 0 || cell >= this.map.cellCount) return { kind: 'ignored' };

    if (cell === this.state.pos) {
      if (this.selectedCell === null) return { kind: 'ignored' };
      this.selectedCell = null;
      return { kind: 'deselected' };
    }

    if (isPassable(this.map, this.state, cell)) {
      const path = findPath(this.map, this.state, cell);
      if (path === null) {
        // 歩いて行けない床。選択だけして、何があるかは見せる。
        this.selectedCell = cell;
        return { kind: 'selected', cell };
      }
      this.selectedCell = null;
      return { kind: 'moved', path: this.walk(path) };
    }

    if (this.selectedCell !== cell) {
      this.selectedCell = cell;
      return { kind: 'selected', cell };
    }

    return this.resolve(cell);
  }

  /** 選択中の対象を解決する。キーボードの決定キーもここに来る。 */
  resolve(cell: number): TapResult {
    const check = checkEnter(this.map, this.state, cell);
    if (!check.ok) return { kind: 'blocked', reason: check.reason };

    const approach = findApproach(this.map, this.state, cell);
    if (approach === null) return { kind: 'blocked', reason: { kind: 'wall' } };

    const walked = this.walk([...approach.path, cell]);
    this.selectedCell = null;
    return { kind: 'resolved', path: walked, outcome: check.outcome };
  }

  /**
   * 方向キーとスワイプ。隣のマスを叩いたものとして扱う。
   *
   * タップと同じ経路を通すので、オブジェクトに対しては同じく
   * 「1回目は選択、2回目で実行」になる。入力手段によって挙動が変わると、
   * 誤操作でHPを失う条件がデバイスごとに変わってしまう。
   */
  stepToward(direction: Direction): TapResult {
    const delta = STEP_DELTA[direction];
    const x = xOf(this.map, this.state.pos) + delta[0];
    const y = yOf(this.map, this.state.pos) + delta[1];

    if (x < 0 || x >= this.map.width || y < 0 || y >= this.map.height) {
      return { kind: 'blocked', reason: { kind: 'outOfBounds' } };
    }
    return this.tap(y * this.map.width + x);
  }

  exchange(slot: number): ExchangeOutcome {
    const result = exchange(this.map, this.state, slot);
    if (!result.ok) return { kind: 'refused', reason: result.reason.kind };

    this.commit(result.state);
    return { kind: 'exchanged', slot };
  }

  /**
   * 一手戻す。
   *
   * 詰みが目に見えないゲームなので、undo は快適さのためではなく必須機能である。
   * 状態は小さいので履歴は全部持っておく。
   */
  undo(): boolean {
    if (!this.canUndo) return false;
    this.future.push(this.past.pop()!);
    this.selectedCell = null;
    this.markVisited();
    return true;
  }

  redo(): boolean {
    if (!this.canRedo) return false;
    this.past.push(this.future.pop()!);
    this.selectedCell = null;
    this.markVisited();
    return true;
  }

  reset(): void {
    this.past.length = 1;
    this.future.length = 0;
    this.selectedCell = null;
    this.visited.clear();
    this.markVisited();
  }

  /** 経路を1マスずつ辿る。1回の操作は1回の undo で戻せるよう、状態は最後にまとめて積む。 */
  private walk(path: readonly number[]): number[] {
    let current = cloneState(this.state);
    const walked: number[] = [];

    for (const cell of path) {
      const moved = enter(this.map, current, cell);
      if (!moved.ok) break;
      current = moved.state;
      walked.push(cell);
    }

    if (walked.length > 0) this.commit(current);
    return walked;
  }

  private commit(next: GameState): void {
    this.past.push(next);
    this.future.length = 0;
    this.markVisited();
  }

  private markVisited(): void {
    const screensX = Math.ceil(this.map.width / this.map.screen.width);
    const screen = this.screen;
    this.visited.add(screen.y * screensX + screen.x);
  }
}
