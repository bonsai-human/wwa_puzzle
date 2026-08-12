import { describe, expect, it } from 'vitest';
import { initialState, reachable } from '../src/core/index.ts';
import { expand, reachedGoal, solve, verifyPlan } from '../src/solver/index.ts';
import type { CompiledMap, GameState, PlacedObject } from '../src/core/index.ts';
import { makeMap } from './helpers.ts';

/**
 * ソルバーの枝刈りが正しいことを、総当たりとの一致で確かめる。設計 §12。
 *
 * 支配関係（§7.4）・強制手の即時適用（§7.3）・緩和による打ち切り（§7.5）は
 * どれも「探索しなくてよい」という主張であり、間違っていても普通のテストでは
 * 気づけない。解けるマップを詰みと言い切ったり、最適でない解を最適と称したりする。
 *
 * ここでは同じマップを、枝刈りを一切しない総当たりでも解いて突き合わせる。
 */

/** 決定的な擬似乱数。失敗を再現できるようにシードを固定する。 */
function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomMap(seed: number): CompiledMap {
  const random = rng(seed);
  const pick = <T>(values: readonly T[]): T => values[Math.floor(random() * values.length)]!;
  const between = (min: number, max: number): number =>
    min + Math.floor(random() * (max - min + 1));

  const width = 5;
  const height = 4;
  const start = { x: 0, y: 0 };
  const goal = { x: width - 1, y: height - 1 };

  const rows: string[] = [];
  for (let y = 0; y < height; y++) {
    let row = '';
    for (let x = 0; x < width; x++) {
      const reserved = (x === start.x && y === start.y) || (x === goal.x && y === goal.y);
      row += !reserved && random() < 0.18 ? '#' : '.';
    }
    rows.push(row);
  }

  const free: { x: number; y: number }[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (rows[y]![x] === '#') continue;
      if (x === start.x && y === start.y) continue;
      if (x === goal.x && y === goal.y) continue;
      free.push({ x, y });
    }
  }

  // 配置先を重複させないようシャッフルしてから先頭から使う。
  for (let i = free.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [free[i], free[j]] = [free[j]!, free[i]!];
  }

  const objects: PlacedObject[] = [];
  const count = Math.min(free.length, between(2, 6));
  let altarPlaced = false;

  for (let i = 0; i < count; i++) {
    const at = free[i]!;
    const kind = pick(['enemy', 'enemy', 'item', 'item', 'door', 'altar'] as const);

    switch (kind) {
      case 'enemy':
        objects.push({
          type: 'enemy',
          ...at,
          hp: between(5, 40),
          atk: between(2, 14),
          def: between(0, 12),
          orb: between(0, 2),
        });
        break;

      case 'item':
        objects.push({
          type: 'item',
          ...at,
          effect: pick([
            { kind: 'atk', amount: between(1, 5) },
            { kind: 'def', amount: between(1, 4) },
            { kind: 'hp', amount: between(5, 25) },
            { kind: 'key', key: 'red', amount: 1 },
          ] as const),
        });
        break;

      case 'door':
        objects.push({ type: 'door', ...at, key: 'red' });
        break;

      case 'altar':
        if (altarPlaced) {
          objects.push({ type: 'item', ...at, effect: { kind: 'orb', amount: between(1, 3) } });
          break;
        }
        altarPlaced = true;
        objects.push({
          type: 'altar',
          ...at,
          id: 'shrine',
          options: [
            { id: 'atk', cost: between(1, 3), effect: { kind: 'atk', amount: between(1, 4) } },
            {
              id: 'key',
              cost: between(1, 3),
              effect: { kind: 'key', key: 'red', amount: 1 },
              stock: 1,
            },
          ],
        });
        break;
    }
  }

  return makeMap({
    terrain: rows,
    start,
    goal,
    objects,
    player: { hp: between(20, 60), atk: between(5, 16), def: between(0, 5) },
  });
}

function serialize(state: GameState): string {
  return [
    state.pos,
    state.hp,
    state.atk,
    state.def,
    state.masterKey,
    state.keys.join(','),
    state.orbs.join(','),
    state.consumed.join(','),
    state.altarUsed.join(','),
  ].join('|');
}

/**
 * 枝刈りを一切しない総当たり。到達できるすべての状態を訪ね、
 * ゴールに立てる状態のうち最大のHPを返す。解が無ければ `null`。
 *
 * 強制手の即時適用もしない。それ自体が検証対象だから。
 */
function bruteForceBestHp(map: CompiledMap): number | null {
  const seen = new Set<string>();
  let best: number | null = null;

  const visit = (state: GameState): void => {
    const key = serialize(state);
    if (seen.has(key)) return;
    seen.add(key);

    if (reachedGoal(map, state) && (best === null || state.hp > best)) best = state.hp;

    for (const branch of expand(map, state)) visit(branch.state);
  };

  visit(initialState(map));
  return best;
}

describe('自由領域の差分更新', () => {
  it('全面の再探索と必ず一致する（200マップ）', () => {
    /**
     * 探索は解決のたびに領域を差分で広げる（`growRegion`）。
     * 「解決は通行可能性を増やすだけで減らさない」という前提に立っているので、
     * 前提が崩れると領域が過小になり、行けるはずの場所を見落とす。
     * 見落としは詰みの誤判定として現れ、普通のテストでは気づきにくい。
     */
    const mismatches: string[] = [];

    for (let seed = 1; seed <= 200; seed++) {
      const map = randomMap(seed);
      const state = initialState(map);
      const region = reachable(map, state);

      for (const branch of expand(map, state, region)) {
        const fresh = reachable(map, branch.state);
        if (branch.region.size !== fresh.size) {
          mismatches.push(`seed ${seed}: 大きさが ${branch.region.size} と ${fresh.size} で違う`);
          continue;
        }
        for (let cell = 0; cell < map.cellCount; cell++) {
          if (branch.region.flags[cell] !== fresh.flags[cell]) {
            mismatches.push(`seed ${seed}: セル ${cell} の判定が食い違う`);
            break;
          }
        }
      }
    }

    expect(mismatches).toEqual([]);
  });
});

describe('枝刈りの正当性', () => {
  it('総当たりと同じ結論に達する（200マップ）', () => {
    const mismatches: string[] = [];
    let solvedCount = 0;
    let deadCount = 0;

    for (let seed = 1; seed <= 200; seed++) {
      const map = randomMap(seed);
      const expected = bruteForceBestHp(map);
      const actual = solve(map);

      if (expected === null) {
        deadCount += 1;
        if (actual.status !== 'dead') {
          mismatches.push(`seed ${seed}: 総当たりは詰みだが ${actual.status} と判定した`);
        }
        continue;
      }

      solvedCount += 1;
      if (actual.status !== 'solved') {
        mismatches.push(`seed ${seed}: 解があるのに ${actual.status} と判定した`);
        continue;
      }
      if (actual.finalHp !== expected) {
        mismatches.push(`seed ${seed}: 最大HP ${expected} のはずが ${actual.finalHp}`);
      }
    }

    expect(mismatches).toEqual([]);
    // 両方の結論が実際に現れていなければ、そもそも検証になっていない。
    expect(solvedCount).toBeGreaterThan(20);
    expect(deadCount).toBeGreaterThan(20);
  });

  it('返した手順は必ずエンジンで再生できる（200マップ）', () => {
    // ソルバーとエンジンの乖離を検出する。設計 §12 で最重要とした項目。
    const failures: string[] = [];

    for (let seed = 1; seed <= 200; seed++) {
      const map = randomMap(seed);
      const result = solve(map);
      if (result.status !== 'solved' || result.plan === null) continue;

      const verified = verifyPlan(map, result.plan);
      if (!verified.ok) {
        failures.push(`seed ${seed}: ${verified.reason}`);
        continue;
      }
      if (verified.finalHp !== result.finalHp) {
        failures.push(
          `seed ${seed}: ソルバーは終了時HP ${result.finalHp} と言ったが再生結果は ${verified.finalHp}`,
        );
      }
    }

    expect(failures).toEqual([]);
  });

  it('firstSolution も必ず再生できる手順を返す（200マップ）', () => {
    const failures: string[] = [];

    for (let seed = 1; seed <= 200; seed++) {
      const map = randomMap(seed);
      const result = solve(map, { objective: 'firstSolution' });
      if (result.status !== 'solved' || result.plan === null) continue;

      const verified = verifyPlan(map, result.plan);
      if (!verified.ok) failures.push(`seed ${seed}: ${verified.reason}`);
    }

    expect(failures).toEqual([]);
  });

  it('緩和による打ち切りが解を取りこぼさない（200マップ）', () => {
    // isHopeless が true を返してよいのは詰みが確実なときだけ。
    // 総当たりで解があると分かったマップを dead と判定していないことを確かめる。
    const wrong: number[] = [];

    for (let seed = 1; seed <= 200; seed++) {
      const map = randomMap(seed);
      if (bruteForceBestHp(map) === null) continue;
      if (solve(map).status === 'dead') wrong.push(seed);
    }

    expect(wrong).toEqual([]);
  });
});
