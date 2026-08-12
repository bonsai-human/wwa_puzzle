import { describe, expect, it } from 'vitest';
import {
  cellOf,
  enter,
  findApproach,
  findPath,
  frontierObjects,
  initialState,
  reachable,
  reachableAltars,
} from '../src/core/index.ts';
import { makeMap } from './helpers.ts';

/**
 * 自由領域とフロンティア。設計 §7.2。
 *
 * 「領域内の移動は状態を変えない」という前提が成り立っていることを確認する。
 * ここが崩れると、ソルバーがマクロ行動で探索する根拠が失われる。
 */

/**
 * 上の通路は敵で塞がれ、下を回れば反対側に出られるマップ。
 *
 *   . . E . .
 *   . # # # .
 *   . . . . .
 */
function detourMap() {
  return makeMap({
    terrain: ['.....', '.###.', '.....'],
    start: { x: 0, y: 0 },
    goal: { x: 4, y: 0 },
    player: { hp: 100, atk: 3, def: 0 },
    objects: [{ type: 'enemy', x: 2, y: 0, hp: 10, atk: 1, def: 99 }],
  });
}

describe('reachable', () => {
  it('未解決のオブジェクトは領域に含まれない', () => {
    const map = detourMap();
    const region = reachable(map, initialState(map));

    expect(region.flags[cellOf(map, 2, 0)]).toBe(0);
    // 壁3枚と敵1体を除いた11マス。
    expect(region.size).toBe(11);
  });

  it('壁の向こうへは回り込める', () => {
    const map = detourMap();
    const region = reachable(map, initialState(map));

    expect(region.flags[cellOf(map, 4, 0)]).toBe(1);
    expect(region.flags[cellOf(map, 2, 1)]).toBe(0); // 壁
  });

  it('解決済みのセルは領域に入る', () => {
    const map = makeMap({
      terrain: ['...'],
      start: { x: 0, y: 0 },
      goal: { x: 2, y: 0 },
      objects: [{ type: 'item', x: 1, y: 0, effect: { kind: 'hp', amount: 1 } }],
    });

    const start = initialState(map);
    expect(reachable(map, start).flags[cellOf(map, 1, 0)]).toBe(0);

    const result = enter(map, start, cellOf(map, 1, 0));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(reachable(map, result.state).flags[cellOf(map, 1, 0)]).toBe(1);
  });

  it('祭壇は消費されないが領域に含まれる', () => {
    const map = makeMap({
      terrain: ['...'],
      start: { x: 0, y: 0 },
      goal: { x: 2, y: 0 },
      objects: [
        {
          type: 'altar',
          x: 1,
          y: 0,
          id: 'shrine',
          options: [{ id: 'atk', cost: 1, effect: { kind: 'atk', amount: 1 } }],
        },
      ],
    });

    const region = reachable(map, initialState(map));

    expect(region.flags[cellOf(map, 1, 0)]).toBe(1);
    expect([...reachableAltars(map, initialState(map), region)]).toEqual([cellOf(map, 1, 0)]);
    // 祭壇の向こう側にも歩いて行ける。
    expect(region.flags[cellOf(map, 2, 0)]).toBe(1);
  });
});

describe('frontierObjects', () => {
  it('領域に接している未解決オブジェクトを返す', () => {
    const map = detourMap();
    const state = initialState(map);

    expect([...frontierObjects(map, state)]).toEqual([cellOf(map, 2, 0)]);
  });

  it('解決済みのオブジェクトは含まない', () => {
    const map = makeMap({
      terrain: ['....'],
      start: { x: 0, y: 0 },
      goal: { x: 3, y: 0 },
      objects: [
        { type: 'item', x: 1, y: 0, effect: { kind: 'hp', amount: 1 } },
        { type: 'item', x: 2, y: 0, effect: { kind: 'hp', amount: 1 } },
      ],
    });

    const start = initialState(map);
    // 奥のアイテムは手前のアイテムに隠れて、まだ領域に接していない。
    expect([...frontierObjects(map, start)]).toEqual([cellOf(map, 1, 0)]);

    const result = enter(map, start, cellOf(map, 1, 0));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect([...frontierObjects(map, result.state)]).toEqual([cellOf(map, 2, 0)]);
  });

  it('祭壇はフロンティアではなく領域の内側として扱う', () => {
    const map = makeMap({
      terrain: ['...'],
      start: { x: 0, y: 0 },
      goal: { x: 2, y: 0 },
      objects: [
        {
          type: 'altar',
          x: 1,
          y: 0,
          id: 'shrine',
          options: [{ id: 'atk', cost: 1, effect: { kind: 'atk', amount: 1 } }],
        },
      ],
    });

    expect([...frontierObjects(map, initialState(map))]).toEqual([]);
  });
});

describe('findPath', () => {
  it('通行可能なセルだけを通る最短経路を返す', () => {
    const map = detourMap();
    const path = findPath(map, initialState(map), cellOf(map, 4, 0));

    expect(path).toEqual([
      cellOf(map, 0, 1),
      cellOf(map, 0, 2),
      cellOf(map, 1, 2),
      cellOf(map, 2, 2),
      cellOf(map, 3, 2),
      cellOf(map, 4, 2),
      cellOf(map, 4, 1),
      cellOf(map, 4, 0),
    ]);
  });

  it('未解決のオブジェクトを経路にしない', () => {
    const map = detourMap();
    // 敵のマスそのものは目的地にできない（解決が必要なので歩いて行けない）。
    expect(findPath(map, initialState(map), cellOf(map, 2, 0))).toBeNull();
  });

  it('現在位置を指定した場合は null', () => {
    const map = detourMap();
    expect(findPath(map, initialState(map), cellOf(map, 0, 0))).toBeNull();
  });

  it('到達できないセルには null', () => {
    const map = makeMap({
      terrain: ['.#.'],
      start: { x: 0, y: 0 },
      goal: { x: 2, y: 0 },
    });

    expect(findPath(map, initialState(map), cellOf(map, 2, 0))).toBeNull();
  });
});

describe('findApproach', () => {
  it('解決対象に最も近い足場までの経路を返す', () => {
    const map = detourMap();
    const approach = findApproach(map, initialState(map), cellOf(map, 2, 0));

    // 迂回して右隣 (3,0) から触るより、左隣 (1,0) のほうが近い。
    expect(approach).toEqual({ path: [cellOf(map, 1, 0)], from: cellOf(map, 1, 0) });
  });

  it('すでに隣にいる場合の経路は空', () => {
    const map = makeMap({
      terrain: ['...'],
      start: { x: 0, y: 0 },
      goal: { x: 2, y: 0 },
      objects: [{ type: 'item', x: 1, y: 0, effect: { kind: 'hp', amount: 1 } }],
    });

    expect(findApproach(map, initialState(map), cellOf(map, 1, 0))).toEqual({
      path: [],
      from: cellOf(map, 0, 0),
    });
  });

  it('どの隣にも到達できなければ null', () => {
    const map = makeMap({
      terrain: ['.#..'],
      start: { x: 0, y: 0 },
      goal: { x: 3, y: 0 },
      // 壁の向こうにあり、隣接する足場のどちらにも辿り着けないアイテム。
      objects: [{ type: 'item', x: 2, y: 0, effect: { kind: 'hp', amount: 1 } }],
    });

    expect(findApproach(map, initialState(map), cellOf(map, 2, 0))).toBeNull();
  });
});
