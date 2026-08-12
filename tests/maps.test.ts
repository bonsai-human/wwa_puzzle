import { describe, expect, it } from 'vitest';
import { compileMap, parseMapDef } from '../src/core/index.ts';
import { expand, reachedGoal, solve, verifyPlan } from '../src/solver/index.ts';
import { initialState } from '../src/core/index.ts';
import { BUILTIN_MAP_DATA } from '../src/maps/index.ts';
import type { CompiledMap } from '../src/core/index.ts';

/**
 * 同梱マップの検品。
 *
 * 解けないマップを配るのは、このゲームでは最悪の不具合になる。
 * プレイヤーは詰みを自力で判別できないので、解けない盤面をいつまでも考え続ける。
 * ソルバーがあるのだから、出荷前に必ず通す。
 */

const maps: CompiledMap[] = BUILTIN_MAP_DATA.map((raw) => compileMap(parseMapDef(raw)));

/** 解決できるものを片端から解決していく素朴な戦略。 */
function greedyClears(map: CompiledMap): boolean {
  let state = initialState(map);

  for (let guard = 0; guard < 1000; guard++) {
    if (reachedGoal(map, state)) return true;
    const branches = expand(map, state);
    if (branches.length === 0) return false;
    state = branches[0]!.state;
  }
  return false;
}

describe.each(maps.map((map) => [map.def.name, map] as const))('%s', (_name, map) => {
  it('データとして妥当である', () => {
    expect(map.width % map.screen.width).toBe(0);
    expect(map.height % map.screen.height).toBe(0);
    expect(map.objectCells.length).toBeGreaterThan(0);
  });

  it('解ける', () => {
    const result = solve(map);
    expect(result.status).toBe('solved');
  });

  it('解いた手順をエンジンで再生するとゴールに着く', () => {
    const result = solve(map);
    expect(result.plan).not.toBeNull();

    const verified = verifyPlan(map, result.plan ?? []);
    expect(verified).toMatchObject({ ok: true, finalHp: result.finalHp });
  });

  it('壁で封じられたオブジェクトが無い', () => {
    // 触れようのないオブジェクトは、盤面を読む手間を増やすだけで何の判断も生まない。
    // 敵や扉を無視して壁だけで到達可能性を見れば、置き忘れの検出になる。
    const open = new Uint8Array(map.cellCount);
    const queue: number[] = [map.startCell];
    open[map.startCell] = 1;

    for (let head = 0; head < queue.length; head++) {
      const base = queue[head]! * 4;
      for (let k = 0; k < 4; k++) {
        const neighbor = map.neighbors[base + k]!;
        if (neighbor < 0 || open[neighbor] === 1 || map.walls[neighbor] === 1) continue;
        open[neighbor] = 1;
        queue.push(neighbor);
      }
    }

    const sealed = [...map.objectCells].filter((cell) => open[cell] !== 1);
    expect(sealed.map((cell) => `(${cell % map.width}, ${Math.floor(cell / map.width)})`)).toEqual(
      [],
    );
    expect(open[map.goalCell]).toBe(1);
  });
});

describe('難易度', () => {
  it('二層の砦は貪欲法では解けない', () => {
    // 「解決できるものを片端から解決する」で解けてしまうマップは、
    // どれだけ大きくても考える必要がない（設計 §8.3）。
    const descent = maps.find((map) => map.def.id === 'descent');
    expect(descent).toBeDefined();
    if (descent === undefined) return;

    expect(greedyClears(descent)).toBe(false);
  });

  it('三つの間は入門用なので素直に解ける', () => {
    // チュートリアルにまで考える必要を課すと、規則そのものが伝わらない。
    const tutorial = maps.find((map) => map.def.id === 'tutorial');
    expect(tutorial).toBeDefined();
    if (tutorial === undefined) return;

    expect(solve(tutorial).finalHp).toBeGreaterThan(0);
  });
});
