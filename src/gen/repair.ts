/**
 * 局所修正。設計 §8.2(7)。
 *
 * 組み立て時の仮想プレイヤーは、実際の最適解とどうしてもずれる。
 * ずれの向きは一定ではなく、つまみ（関門の重さ）を動かしても
 * 締まりは 0.21 から 0.27 までしか動かなかった。**見込みを精密にするより、
 * 出来上がったものを測ってから直すほうが確実**である。
 *
 * ここでは「解が実際に通った関門」だけを重くする。
 * 通らない敵をいくら強くしても、余ったHPは減らない。
 */

import { battle, compileMap, initialState } from '../core/index.ts';
import type { CompiledMap, MapDef, PlacedObject } from '../core/index.ts';
import { evaluate } from '../solver/difficulty.ts';
import type { DifficultyReport } from '../solver/difficulty.ts';
import { applyAction } from '../solver/macro.ts';
import { solve } from '../solver/search.ts';
import type { SolveOptions } from '../solver/types.ts';

export interface Repaired {
  readonly def: MapDef;
  readonly map: CompiledMap;
  readonly report: DifficultyReport;
  /** 実際に手を入れた回数。 */
  readonly steps: number;
}

/**
 * 解が通る敵のうち、**すでにHPを取っているもの**だけを選ぶ。
 *
 * 無害な敵（反撃を受けない敵）に手を出してはいけない。攻撃力を1上げた瞬間に
 * それは「倒すかどうか」の選択肢に変わる。ソルバーは無害な敵を強制手として
 * 分岐なしで処理しているので、盤面に何十体も置いてあっても探索は増えないが、
 * 有害にした途端そのすべてが分岐になり、探索木が組み合わせ的に膨らむ。
 * 実測では1マップの生成に187秒かかり、分岐点は1000を超えた。
 *
 * 締めたいのは関門であって、道端の雑魚ではない。
 */
function gatesOnSolution(map: CompiledMap, options: SolveOptions): number[] {
  const result = solve(map, options);
  if (result.status !== 'solved' || result.plan === null) return [];

  // 手順を再生しながら、その時点のステータスで戦闘コストを測る。
  let state = initialState(map);
  const cells: number[] = [];

  for (const action of result.plan) {
    if (action.kind === 'resolve') {
      const object = map.objectAt[action.cell] ?? null;
      if (object?.type === 'enemy') {
        const outcome = battle(state, object);
        if (outcome.outcome === 'win' && outcome.cost > 0) cells.push(action.cell);
      }
    }

    const next = applyAction(map, state, action);
    if (next === null) break;
    state = next;
  }

  return cells;
}

function withEnemyAtk(def: MapDef, x: number, y: number, delta: number): MapDef {
  const objects: PlacedObject[] = def.objects.map((object) =>
    object.x === x && object.y === y && object.type === 'enemy'
      ? { ...object, atk: object.atk + delta }
      : object,
  );
  return { ...def, objects };
}

/**
 * 余っているHPを削り取る。
 *
 * 解が通る敵の攻撃力を少しずつ上げ、そのたびに解き直す。
 * 解けなくなったら一段戻す。**上げすぎて詰ませないことが最優先**で、
 * 締まりは届く範囲で詰められればよい。
 */
export function tighten(
  def: MapDef,
  targetTightness: number,
  options: { readonly maxSteps?: number; readonly solve?: SolveOptions } = {},
): Repaired {
  const maxSteps = options.maxSteps ?? 48;
  const solveOptions = options.solve ?? {};

  let currentDef = def;
  let currentMap = compileMap(currentDef);
  let currentReport = evaluate(currentMap, solveOptions);
  let steps = 0;

  if (currentReport.status !== 'solved') {
    return { def: currentDef, map: currentMap, report: currentReport, steps };
  }

  const width = def.width;
  const cells = gatesOnSolution(currentMap, solveOptions);
  if (cells.length === 0) {
    return { def: currentDef, map: currentMap, report: currentReport, steps };
  }

  // 手数の多い敵から順に触る。攻撃力を1上げたときの効き方が大きい。
  const ordered = [...new Set(cells)].sort((a, b) => {
    const left = currentMap.objectAt[a];
    const right = currentMap.objectAt[b];
    const hitsOf = (enemy: typeof left): number =>
      enemy !== null && enemy !== undefined && enemy.type === 'enemy' ? enemy.hp : 0;
    return hitsOf(right) - hitsOf(left);
  });

  // 粗い刻みで削れるだけ削ってから細かくする。
  // 余っているHPは100を超えることもあり、1ずつでは届かない。
  let stride = 4;
  const maxed = new Set<number>();
  let index = 0;

  while (steps < maxSteps) {
    if ((currentReport.hpTightness ?? 1) >= targetTightness) break;

    if (maxed.size >= ordered.length) {
      // どの敵もこれ以上上げられない。刻みを細かくしてもう一巡する。
      if (stride === 1) break;
      stride = Math.max(1, stride >> 1);
      maxed.clear();
      continue;
    }

    const cell = ordered[index % ordered.length]!;
    index += 1;
    if (maxed.has(cell)) continue;

    const candidateDef = withEnemyAtk(currentDef, cell % width, Math.floor(cell / width), stride);
    const candidateMap = compileMap(candidateDef);
    const candidateReport = evaluate(candidateMap, solveOptions);
    steps += 1;

    if (candidateReport.status !== 'solved') {
      // この敵はこの刻みでは上げられない。他を試す。
      // ここで全体を打ち切ると、まだ余裕のある他の関門に手が回らない。
      maxed.add(cell);
      continue;
    }

    currentDef = candidateDef;
    currentMap = candidateMap;
    currentReport = candidateReport;
  }

  return { def: currentDef, map: currentMap, report: currentReport, steps };
}
