/**
 * 難易度の評価。設計 §8.3。
 *
 * エディタの常駐表示（Phase 4）と自動生成の合否判定（Phase 5）が同じ指標を使う。
 * 「作り手が見ている数字」と「生成器が合否を決める数字」がずれていると、
 * 手直ししたマップが生成器の基準を満たさない、という噛み合わなさが起きる。
 */

import { initialState } from '../core/index.ts';
import type { CompiledMap } from '../core/index.ts';
import { expand, reachedGoal } from './macro.ts';
import { solve } from './search.ts';
import type { SolveOptions, SolveStatus } from './types.ts';

/**
 * 「解決できるものを片端から解決する」だけでクリアできるか。
 *
 * これで解けてしまうマップは、どれだけ大きくても**考える必要がない**。
 * 自動生成では不合格条件にする。
 */
export function greedyClears(map: CompiledMap): boolean {
  let state = initialState(map);

  // 解決のたびに消費済みが増えるので、オブジェクト数を超えて回ることはない。
  const limit = map.objectCells.length + map.options.length + 8;
  for (let guard = 0; guard <= limit; guard++) {
    if (reachedGoal(map, state)) return true;

    const branches = expand(map, state);
    const next = branches[0];
    if (next === undefined) return false;
    state = next.state;
  }

  return false;
}

export interface DifficultyReport {
  readonly status: SolveStatus;
  /** 最適解の終了時HP。小さいほど余裕が無い。 */
  readonly hpMargin: number | null;
  /** 解に必要なマクロ行動の数。 */
  readonly criticalPath: number | null;
  /** 貪欲法で解けなかったか。解けてしまうなら考えどころが無い。 */
  readonly greedyFails: boolean;
  /** 2つ以上の選択肢が残った局面の数。 */
  readonly decisionPoints: number;
  /** 探索を打ち切ったか。true のとき数値は当てにならない。 */
  readonly truncated: boolean;
}

export function evaluate(map: CompiledMap, options: SolveOptions = {}): DifficultyReport {
  const result = solve(map, options);

  return {
    status: result.status,
    hpMargin: result.finalHp,
    criticalPath: result.plan?.length ?? null,
    // 解けないマップに貪欲法の合否を問うても意味がない。
    greedyFails: result.status === 'solved' ? !greedyClears(map) : false,
    decisionPoints: result.stats.branching,
    truncated: result.stats.truncated,
  };
}
