/**
 * マクロ行動の生成と適用。設計 §7.2 / §7.3。
 *
 * ルールには一切触らない。すべて core の関数を呼ぶ。
 * 「ソルバーだけが知っている挙動」を作らないことが、実機との一致を保つ唯一の方法である。
 */

import {
  battle,
  enter,
  exchange,
  frontierObjects,
  growRegion,
  reachable,
  reachableAltars,
} from '../core/index.ts';
import type { CompiledMap, GameState, Region } from '../core/index.ts';
import type { MacroAction } from './types.ts';

/** マクロ行動を適用する。成立しなければ `null`。 */
export function applyAction(
  map: CompiledMap,
  state: GameState,
  action: MacroAction,
): GameState | null {
  if (action.kind === 'resolve' || action.kind === 'goal') {
    const result = enter(map, state, action.cell);
    return result.ok ? result.state : null;
  }

  // 祭壇は通行可能なので、乗る動作もそのまま enter で表せる。消費はされない。
  const moved = enter(map, state, action.altarCell);
  if (!moved.ok) return null;

  const traded = exchange(map, moved.state, action.slot);
  return traded.ok ? traded.state : null;
}

/**
 * 分岐せずに適用してよい解決か。設計 §7.3。
 *
 * HPコストが 0 で、かつ厳密に有益なもの。具体的には
 * すべてのアイテム（効果は正の加算のみと検証で保証されている）と、
 * 反撃を受けずに倒せる敵。
 *
 * 解決後の状態は、解決前の状態を支配する（消費済み集合が真に大きく、
 * ステータスはどれも下回らない）。よって解決しない選択肢は探索する必要がない。
 *
 * 扉は鍵を、祭壇は オーブを消費するので対象外。
 */
function isForcedResolve(map: CompiledMap, state: GameState, cell: number): boolean {
  const object = map.objectAt[cell] ?? null;
  if (object === null) return false;

  if (object.type === 'item') return true;

  if (object.type === 'enemy') {
    const result = battle(state, object);
    return result.outcome === 'win' && result.cost === 0;
  }

  return false;
}

export interface Closure {
  readonly state: GameState;
  /** 適用した解決の一覧。手順を再生できるよう順序どおりに並ぶ。 */
  readonly actions: readonly MacroAction[];
  /** 適用後の自由領域。呼び出し側が再計算しなくて済むように返す。 */
  readonly region: Region;
}

/**
 * コスト0で有益な解決を、これ以上見つからなくなるまで適用する。
 *
 * 1つ解決すると領域が広がって新しい対象が現れるので、不動点まで回す。
 * 実マップではこれで大半の局面から分岐が消え、
 * 本当に選択が発生している場所だけが探索木に残る。
 */
export function closeForcedMoves(map: CompiledMap, state: GameState, region?: Region): Closure {
  let current = state;
  // 領域は解決のたびに差分で広げる。ここで全面探索をすると、
  // 生成した状態の数だけフラッドフィルが走って探索全体の律速になる。
  let view = region ?? reachable(map, state);
  const actions: MacroAction[] = [];

  for (;;) {
    const frontier = frontierObjects(map, current, view);
    let progressed = false;

    for (let i = 0; i < frontier.length; i++) {
      const cell = frontier[i]!;
      if (!isForcedResolve(map, current, cell)) continue;

      const next = applyAction(map, current, { kind: 'resolve', cell });
      if (next === null) continue;

      current = next;
      view = growRegion(map, current, view, cell);
      actions.push({ kind: 'resolve', cell });
      progressed = true;
    }

    if (!progressed) break;
  }

  return { state: current, actions, region: view };
}

export interface Branch {
  readonly action: MacroAction;
  readonly state: GameState;
  /** 適用後の自由領域。親の領域からの差分で求めてある。 */
  readonly region: Region;
}

/**
 * この状態から取りうる分岐。強制手は {@link closeForcedMoves} が処理済みである前提。
 *
 * 成立するかどうかは実際に適用して確かめ、結果の状態も一緒に返す。
 * 判定条件を書き写すと実機とずれるうえ、二度手間になる。
 *
 * 祭壇は通行可能なので自由領域の内側にあり、フロンティアには現れない。
 * 交換は独立したマクロ行動として列挙する。
 */
export function expand(map: CompiledMap, state: GameState, region?: Region): Branch[] {
  const view = region ?? reachable(map, state);
  const branches: Branch[] = [];

  const frontier = frontierObjects(map, state, view);
  for (let i = 0; i < frontier.length; i++) {
    const cell = frontier[i]!;
    const action: MacroAction = { kind: 'resolve', cell };
    const next = applyAction(map, state, action);
    if (next !== null) branches.push({ action, state: next, region: growRegion(map, next, view, cell) });
  }

  const altarCells = reachableAltars(map, state, view);
  for (let i = 0; i < altarCells.length; i++) {
    const altarCell = altarCells[i]!;
    const altar = map.objectAt[altarCell] ?? null;
    if (altar === null || altar.type !== 'altar') continue;

    for (const slot of altar.slots) {
      const action: MacroAction = { kind: 'exchange', slot, altarCell };
      const next = applyAction(map, state, action);
      // 交換は何も消費しないので領域は変わらない。
      if (next !== null) branches.push({ action, state: next, region: view });
    }
  }

  return branches;
}

/** 分岐として取りうる行動の一覧。UIの「今できること」表示に使う。 */
export function availableActions(
  map: CompiledMap,
  state: GameState,
  region?: Region,
): MacroAction[] {
  return expand(map, state, region).map((branch) => branch.action);
}

/** ゴールへ歩いて到達できるか。 */
export function reachedGoal(map: CompiledMap, state: GameState, region?: Region): boolean {
  if (state.pos === map.goalCell) return true;
  const view = region ?? reachable(map, state);
  return view.flags[map.goalCell] === 1;
}
