/**
 * 探索本体。設計 §7.6。
 *
 * 4段の縮約を積む：
 *   1. 位置を状態から消し、分岐単位をマクロ行動にする（macro.ts）
 *   2. コスト0で有益な解決は分岐せず即適用する（macro.ts）
 *   3. 支配関係で重複状態を潰す（dominance.ts）
 *   4. 緩和で詰みを早期に検出し、上界で見込みのない枝を捨てる（relax.ts）
 *
 * 打ち切りが起きた場合、解が見つからなくても `dead` と結論しない。
 * この区別に自動生成器（Phase 5）とヒント表示（Phase 6）が依存している。
 */

import { initialState, reachable } from '../core/index.ts';
import type { CompiledMap, GameState } from '../core/index.ts';
import { DominanceTable } from './dominance.ts';
import { closeForcedMoves, expand, reachedGoal } from './macro.ts';
import { Relaxer } from './relax.ts';
import type { HintResult, MacroAction, SolveOptions, SolveResult, SolveStats } from './types.ts';

const DEFAULT_MAX_STATES = 200_000;
const DEFAULT_PROGRESS_INTERVAL = 2_000;

interface Node {
  readonly state: GameState;
  readonly parent: Node | null;
  /** 親からこの状態に至るまでに適用した行動。強制手も含む。 */
  readonly actions: readonly MacroAction[];
  /** この状態から到達しうる終了時HPの上界（設計 §7.5）。 */
  readonly bound: number;
}

/**
 * 上界の高い順に取り出す二分ヒープ。
 *
 * 優先度に現在のHPではなく上界を使う。現在HP順に見ると、
 * 「今はHPが高いが、この先の回復をすでに使い切っている」状態を延々と展開してしまい、
 * 良い解に当たるのが遅れる。その結果、後から上界で捨てるだけの枝に
 * 展開コストを払うことになる。上界順なら見込みのある側から掘るので、
 * 早く良い解に当たり、残りをまとめて捨てられる。
 *
 * 上界は緩和から得た許容的な値なので、この順序を使っても最適性は失われない。
 */
class MaxHeap {
  private items: Node[] = [];

  get size(): number {
    return this.items.length;
  }

  push(node: Node): void {
    this.items.push(node);
    let index = this.items.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (this.items[parent]!.bound >= this.items[index]!.bound) break;
      this.swap(parent, index);
      index = parent;
    }
  }

  pop(): Node | undefined {
    const top = this.items[0];
    if (top === undefined) return undefined;

    const last = this.items.pop()!;
    if (this.items.length > 0) {
      this.items[0] = last;
      this.siftDown(0);
    }
    return top;
  }

  /** ビーム探索用。見込みの高い順に `limit` 件だけ残す。 */
  trimTo(limit: number): void {
    if (this.items.length <= limit) return;
    // 降順に並んだ配列はそのまま max-heap の条件を満たす。
    this.items.sort((a, b) => b.bound - a.bound);
    this.items.length = limit;
  }

  private siftDown(start: number): void {
    let index = start;
    for (;;) {
      const left = index * 2 + 1;
      const right = left + 1;
      let largest = index;

      if (left < this.items.length && this.items[left]!.bound > this.items[largest]!.bound) {
        largest = left;
      }
      if (right < this.items.length && this.items[right]!.bound > this.items[largest]!.bound) {
        largest = right;
      }
      if (largest === index) return;

      this.swap(index, largest);
      index = largest;
    }
  }

  private swap(a: number, b: number): void {
    const temp = this.items[a]!;
    this.items[a] = this.items[b]!;
    this.items[b] = temp;
  }
}

function planOf(node: Node, goalCell: number): MacroAction[] {
  const chunks: (readonly MacroAction[])[] = [];
  for (let current: Node | null = node; current !== null; current = current.parent) {
    chunks.push(current.actions);
  }
  chunks.reverse();

  const plan = chunks.flat();
  plan.push({ kind: 'goal', cell: goalCell });
  return plan;
}

/** 指定した状態から探索する。 */
export function solveFrom(
  map: CompiledMap,
  start: GameState,
  options: SolveOptions = {},
): SolveResult {
  const objective = options.objective ?? 'maxHp';
  const maxStates = options.maxStates ?? DEFAULT_MAX_STATES;
  const progressInterval = options.progressInterval ?? DEFAULT_PROGRESS_INTERVAL;
  const beamWidth = options.beamWidth;

  let expanded = 0;
  let generated = 0;
  let dominated = 0;
  let hopeless = 0;
  let bounded = 0;
  let forced = 0;
  let branching = 0;
  let truncated = false;

  const stats = (): SolveStats => ({
    expanded,
    generated,
    dominated,
    hopeless,
    bounded,
    forced,
    branching,
    truncated,
  });

  const table = new DominanceTable(map);
  const relaxer = new Relaxer(map);
  const open = new MaxHeap();

  const rootClosure = closeForcedMoves(map, start);
  forced += rootClosure.actions.length;

  const root: Node = {
    state: rootClosure.state,
    parent: null,
    actions: rootClosure.actions,
    bound: relaxer.hpUpperBound(rootClosure.state),
  };
  table.tryInsert(root.state);
  open.push(root);

  let bestPlan: MacroAction[] | null = null;
  let bestHp = Number.NEGATIVE_INFINITY;

  while (open.size > 0) {
    if (options.shouldStop?.() === true) {
      truncated = true;
      break;
    }
    if (expanded >= maxStates) {
      truncated = true;
      break;
    }

    const node = open.pop()!;
    expanded += 1;

    if (options.onProgress !== undefined && expanded % progressInterval === 0) {
      options.onProgress(stats());
    }

    // 押し込んだ後に解が改善していれば、ここで初めて見込みが消えることがある。
    // 自由領域を求める前に判定する。見込みの無い枝がゴールに立てるかどうかは
    // どのみち結論を変えないので、フラッドフィルを走らせるだけ無駄になる。
    if (bestPlan !== null && node.bound <= bestHp) {
      bounded += 1;
      continue;
    }

    const region = reachable(map, node.state);
    const atGoal = reachedGoal(map, node.state, region);

    if (atGoal) {
      // ゴールまで歩くだけならHPは減らない。
      if (node.state.hp > bestHp) {
        bestHp = node.state.hp;
        bestPlan = planOf(node, map.goalCell);
      }
      if (objective === 'firstSolution') break;
      // 最大HPを狙う場合は、ここから回復を拾ってさらに良くなる可能性が残る。
    }

    // ゴールに立てるなら詰みではありえない。緩和の判定は省ける。
    if (!atGoal && relaxer.isHopeless(node.state)) {
      hopeless += 1;
      continue;
    }

    let accepted = 0;
    for (const branch of expand(map, node.state, region)) {
      const closure = closeForcedMoves(map, branch.state, branch.region);
      forced += closure.actions.length;
      generated += 1;

      // すでに見つけた解を超えられない枝は、そもそも積まない。
      const bound = relaxer.hpUpperBound(closure.state);
      if (bestPlan !== null && bound <= bestHp) {
        bounded += 1;
        continue;
      }

      if (!table.tryInsert(closure.state)) {
        dominated += 1;
        continue;
      }

      accepted += 1;
      open.push({
        state: closure.state,
        parent: node,
        actions: [branch.action, ...closure.actions],
        bound,
      });
    }
    if (accepted >= 2) branching += 1;

    if (beamWidth !== undefined && open.size > beamWidth) {
      open.trimTo(beamWidth);
      // 捨てた枝に解があったかもしれない。以後 dead とは言えない。
      truncated = true;
    }
  }

  if (bestPlan !== null) {
    return { status: 'solved', plan: bestPlan, finalHp: bestHp, stats: stats() };
  }
  // 探索を尽くしていなければ「解なし」ではなく「判定できず」。
  return { status: truncated ? 'unknown' : 'dead', plan: null, finalHp: null, stats: stats() };
}

/** 初期状態から探索する。 */
export function solve(map: CompiledMap, options: SolveOptions = {}): SolveResult {
  return solveFrom(map, initialState(map), options);
}

/**
 * 現在の状態から、まだ解けるか・次に何をすべきかを返す。設計 §7.7。
 *
 * プレイヤーは自力で詰みに気づけないため、`dead` の通知はゲーム体験の一部になる。
 */
export function hint(
  map: CompiledMap,
  state: GameState,
  options: SolveOptions = {},
): HintResult {
  const result = solveFrom(map, state, { objective: 'firstSolution', ...options });

  if (result.status !== 'solved' || result.plan === null) {
    return {
      status: result.status === 'dead' ? 'dead' : 'unknown',
      nextAction: null,
      actionsRemaining: null,
      finalHp: null,
      stats: result.stats,
    };
  }

  return {
    status: 'solvable',
    nextAction: result.plan[0] ?? null,
    actionsRemaining: result.plan.length,
    finalHp: result.finalHp,
    stats: result.stats,
  };
}
