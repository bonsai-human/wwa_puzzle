/**
 * 手順の再生。
 *
 * ソルバーが返したマクロ行動の列を、実際の1マス移動に展開してエンジンに通す。
 * 「ソルバーは解けると言ったのに実機で解けない」を検出できる唯一の場所であり、
 * 整合性テスト（設計 §12）の中核でもある。ゲーム本体はこれを使って
 * ヒントの手順をそのまま実行できる。
 */

import { enter, exchange, findApproach, findPath, initialState, isGoal } from '../core/index.ts';
import type { CompiledMap, GameState } from '../core/index.ts';
import type { MacroAction } from './types.ts';

export type ReplayResult =
  | {
      readonly ok: true;
      readonly state: GameState;
      /** 通過したセルの列。描画の再生に使える。 */
      readonly steps: readonly number[];
    }
  | {
      readonly ok: false;
      /** 失敗した行動の添字。 */
      readonly at: number;
      readonly action: MacroAction;
      readonly reason: string;
    };

/** 手順を1マス移動に展開して実行する。 */
export function replayPlan(
  map: CompiledMap,
  start: GameState,
  plan: readonly MacroAction[],
): ReplayResult {
  let state = start;
  const steps: number[] = [];

  const walk = (path: readonly number[]): string | null => {
    for (const cell of path) {
      const moved = enter(map, state, cell);
      if (!moved.ok) return `経路の途中で止まった (${moved.reason.kind})`;
      state = moved.state;
      steps.push(cell);
    }
    return null;
  };

  for (let index = 0; index < plan.length; index++) {
    const action = plan[index]!;
    const fail = (reason: string): ReplayResult => ({ ok: false, at: index, action, reason });

    switch (action.kind) {
      case 'resolve': {
        const approach = findApproach(map, state, action.cell);
        if (approach === null) return fail('解決対象に近づけない');

        const blocked = walk(approach.path);
        if (blocked !== null) return fail(blocked);

        const resolved = enter(map, state, action.cell);
        if (!resolved.ok) return fail(`解決できない (${resolved.reason.kind})`);
        state = resolved.state;
        steps.push(action.cell);
        break;
      }

      case 'exchange': {
        if (state.pos !== action.altarCell) {
          const path = findPath(map, state, action.altarCell);
          if (path === null) return fail('祭壇に辿り着けない');

          const blocked = walk(path);
          if (blocked !== null) return fail(blocked);
        }

        const traded = exchange(map, state, action.slot);
        if (!traded.ok) return fail(`交換できない (${traded.reason.kind})`);
        state = traded.state;
        break;
      }

      case 'goal': {
        if (state.pos !== action.cell) {
          const path = findPath(map, state, action.cell);
          if (path === null) return fail('ゴールに辿り着けない');

          const blocked = walk(path);
          if (blocked !== null) return fail(blocked);
        }
        break;
      }
    }
  }

  return { ok: true, state, steps };
}

export type VerifyResult =
  | { readonly ok: true; readonly finalHp: number; readonly steps: number }
  | { readonly ok: false; readonly reason: string };

/**
 * 手順が初期状態から本当にゴールへ到達することを確かめる。
 * ソルバーの主張をエンジンだけで検算する。
 */
export function verifyPlan(map: CompiledMap, plan: readonly MacroAction[]): VerifyResult {
  const replay = replayPlan(map, initialState(map), plan);
  if (!replay.ok) return { ok: false, reason: `${replay.at}番目の行動: ${replay.reason}` };
  if (!isGoal(map, replay.state)) return { ok: false, reason: '手順を終えてもゴールにいない' };

  return { ok: true, finalHp: replay.state.hp, steps: replay.steps.length };
}
