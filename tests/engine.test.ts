import { describe, expect, it } from 'vitest';
import {
  cellOf,
  checkEnter,
  checkExchange,
  enter,
  exchange,
  initialState,
  isConsumed,
  isGoal,
  isPassable,
  step,
} from '../src/core/index.ts';
import type { CompiledMap, EnterResult, GameState, PlacedObject } from '../src/core/index.ts';
import { makeMap, snapshot } from './helpers.ts';

/** 成功を前提に新しい状態を取り出す。失敗したらテストを落とす。 */
function expectOk(result: EnterResult): GameState {
  if (!result.ok) throw new Error(`進入に失敗しました: ${result.reason.kind}`);
  return result.state;
}

/** 一本道のマップ。オブジェクトは x 座標で置く。 */
function corridor(
  width: number,
  objects: readonly PlacedObject[],
  player?: Parameters<typeof makeMap>[0]['player'],
  masterKeyMode?: 'permanent' | 'wildcard',
): CompiledMap {
  return makeMap({
    terrain: ['.'.repeat(width)],
    start: { x: 0, y: 0 },
    goal: { x: width - 1, y: 0 },
    objects,
    ...(player === undefined ? {} : { player }),
    ...(masterKeyMode === undefined ? {} : { masterKeyMode }),
  });
}

describe('アイテム', () => {
  it('効果を適用してセルから消える', () => {
    const map = corridor(3, [{ type: 'item', x: 1, y: 0, effect: { kind: 'atk', amount: 3 } }], {
      hp: 10,
      atk: 5,
      def: 1,
    });

    const state = expectOk(step(map, initialState(map), 'right'));

    expect(state.atk).toBe(8);
    expect(state.pos).toBe(1);
    expect(isConsumed(state, 1)).toBe(true);
  });

  it('消えたセルは以後ただの床として通れる', () => {
    const map = corridor(3, [{ type: 'item', x: 1, y: 0, effect: { kind: 'hp', amount: 5 } }]);

    const afterPickup = expectOk(step(map, initialState(map), 'right'));
    const back = expectOk(step(map, afterPickup, 'left'));
    const again = expectOk(step(map, back, 'right'));

    // 2回目の進入では効果は発生しない。
    expect(again.hp).toBe(afterPickup.hp);
    expect(checkEnter(map, back, 1)).toEqual({ ok: true, outcome: { kind: 'move' } });
  });

  it('鍵とオーブも加算される', () => {
    const map = corridor(4, [
      { type: 'item', x: 1, y: 0, effect: { kind: 'key', key: 'red', amount: 2 } },
      { type: 'item', x: 2, y: 0, effect: { kind: 'orb', amount: 3 } },
    ]);

    let state = expectOk(step(map, initialState(map), 'right'));
    state = expectOk(step(map, state, 'right'));

    expect([...state.keys]).toEqual([2]);
    expect([...state.orbs]).toEqual([3]);
  });
});

describe('敵', () => {
  const enemy: PlacedObject = { type: 'enemy', x: 1, y: 0, hp: 30, atk: 10, def: 4 };

  it('倒すとHPを失い、オーブを得て、セルから消える', () => {
    const map = corridor(3, [enemy], { hp: 100, atk: 12, def: 2 });

    const state = expectOk(step(map, initialState(map), 'right'));

    expect(state.hp).toBe(76); // 100 - 24
    expect([...state.orbs]).toEqual([1]);
    expect(isConsumed(state, 1)).toBe(true);
  });

  it('オーブ数は敵ごとに指定できる', () => {
    const map = corridor(3, [{ ...enemy, orb: 5 }], { hp: 100, atk: 12, def: 2 });
    expect([...expectOk(step(map, initialState(map), 'right')).orbs]).toEqual([5]);
  });

  it('攻撃不能な敵には進入できず、状態は変化しない', () => {
    const map = corridor(3, [enemy], { hp: 100, atk: 4, def: 2 });
    const before = initialState(map);
    const result = step(map, before, 'right');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason.kind).toBe('unbeatable');
    expect(snapshot(before)).toEqual(snapshot(initialState(map)));
  });

  it('HPが足りない敵には進入できず、HPも減らない', () => {
    // 撃破コスト 24 に対して HP 24。等しいので通過不能（設計 §3.2）。
    const map = corridor(3, [enemy], { hp: 24, atk: 12, def: 2 });
    const before = initialState(map);
    const result = step(map, before, 'right');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason.kind).toBe('insufficientHp');
      if (result.reason.kind === 'insufficientHp') expect(result.reason.cost).toBe(24);
    }
    expect(snapshot(before)).toEqual(snapshot(initialState(map)));
  });
});

describe('扉と鍵', () => {
  const redDoor: PlacedObject = { type: 'door', x: 1, y: 0, key: 'red' };

  it('対応する鍵を1本消費して開く', () => {
    const map = corridor(3, [redDoor], { keys: { red: 1 } });
    const state = expectOk(step(map, initialState(map), 'right'));

    expect([...state.keys]).toEqual([0]);
    expect(isConsumed(state, 1)).toBe(true);
  });

  it('鍵が無ければ開かず、状態は変化しない', () => {
    const map = corridor(3, [redDoor], { keys: { red: 0 } });
    const before = initialState(map);
    const result = step(map, before, 'right');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason.kind).toBe('noKey');
    expect(snapshot(before)).toEqual(snapshot(initialState(map)));
  });

  it('別の色の鍵では開かない', () => {
    const map = corridor(3, [redDoor], { keys: { red: 0, blue: 3 } });
    const result = step(map, initialState(map), 'right');
    expect(result.ok).toBe(false);
  });

  it('permanent のマスターキーは消費されず、色鍵も温存する', () => {
    const map = corridor(4, [redDoor, { type: 'door', x: 2, y: 0, key: 'red' }], {
      keys: { red: 1 },
      masterKey: 1,
    });

    let state = expectOk(step(map, initialState(map), 'right'));
    state = expectOk(step(map, state, 'right'));

    expect(state.masterKey).toBe(1);
    expect([...state.keys]).toEqual([1]); // 色鍵は使われない
  });

  it('wildcard では色鍵を優先し、尽きてからマスターキーを使う', () => {
    const map = corridor(
      4,
      [redDoor, { type: 'door', x: 2, y: 0, key: 'red' }],
      { keys: { red: 1 }, masterKey: 1 },
      'wildcard',
    );

    const first = expectOk(step(map, initialState(map), 'right'));
    expect([...first.keys]).toEqual([0]);
    expect(first.masterKey).toBe(1);

    const second = expectOk(step(map, first, 'right'));
    expect([...second.keys]).toEqual([0]);
    expect(second.masterKey).toBe(0);
  });
});

describe('祭壇', () => {
  const altar: PlacedObject = {
    type: 'altar',
    x: 1,
    y: 0,
    id: 'shrine',
    options: [
      { id: 'atk', cost: 2, effect: { kind: 'atk', amount: 5 } },
      { id: 'master', cost: 3, effect: { kind: 'masterKey' }, stock: 1 },
    ],
  };

  it('通行可能で、乗っても消費されない', () => {
    const map = corridor(3, [altar]);
    const start = initialState(map);

    expect(isPassable(map, start, 1)).toBe(true);

    const state = expectOk(step(map, start, 'right'));
    expect(state.pos).toBe(1);
    expect(isConsumed(state, 1)).toBe(false);
    expect(checkEnter(map, state, 1)).toMatchObject({ ok: true, outcome: { kind: 'altar' } });
  });

  it('オーブを消費して効果を得る', () => {
    const map = corridor(3, [altar], { orbs: 5, atk: 10 });
    const onAltar = expectOk(step(map, initialState(map), 'right'));

    const result = exchange(map, onAltar, 0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.state.atk).toBe(15);
    expect([...result.state.orbs]).toEqual([3]);
    expect([...result.state.altarUsed]).toEqual([1, 0]);
  });

  it('同じ交換肢を在庫の範囲で繰り返せる', () => {
    const map = corridor(3, [altar], { orbs: 6, atk: 10 });
    let state = expectOk(step(map, initialState(map), 'right'));

    for (let i = 0; i < 3; i++) {
      const result = exchange(map, state, 0);
      expect(result.ok).toBe(true);
      if (result.ok) state = result.state;
    }

    expect(state.atk).toBe(25);
    expect([...state.orbs]).toEqual([0]);
  });

  it('在庫を使い切ると交換できない', () => {
    const map = corridor(3, [altar], { orbs: 10 });
    const onAltar = expectOk(step(map, initialState(map), 'right'));

    const first = exchange(map, onAltar, 1);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = exchange(map, first.state, 1);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason.kind).toBe('outOfStock');
  });

  it('オーブが足りなければ交換できない', () => {
    const map = corridor(3, [altar], { orbs: 1 });
    const onAltar = expectOk(step(map, initialState(map), 'right'));

    const result = checkExchange(map, onAltar, 0);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatchObject({ kind: 'insufficientOrbs', have: 1 });
  });

  it('祭壇のマスに立っていなければ交換できない', () => {
    const map = corridor(3, [altar], { orbs: 10 });
    const result = exchange(map, initialState(map), 0);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason.kind).toBe('notAtAltar');
  });

  it('permanent モードではマスターキーが枚数ではなくフラグになる', () => {
    const map = corridor(3, [altar], { orbs: 10 });
    const onAltar = expectOk(step(map, initialState(map), 'right'));

    const result = exchange(map, onAltar, 1);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.state.masterKey).toBe(1);
  });
});

describe('移動', () => {
  it('壁には進入できない', () => {
    const map = makeMap({
      terrain: ['.#.'],
      start: { x: 0, y: 0 },
      goal: { x: 2, y: 0 },
    });

    const result = step(map, initialState(map), 'right');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason.kind).toBe('wall');
  });

  it('マップ外には進入できない', () => {
    const map = corridor(3, []);
    const result = step(map, initialState(map), 'left');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason.kind).toBe('outOfBounds');
  });

  it('ゴールセルに立つと勝利になる', () => {
    const map = corridor(2, []);
    const start = initialState(map);

    expect(isGoal(map, start)).toBe(false);
    expect(isGoal(map, expectOk(step(map, start, 'right')))).toBe(true);
  });

  it('enter は元の状態を書き換えない', () => {
    const map = corridor(3, [{ type: 'item', x: 1, y: 0, effect: { kind: 'atk', amount: 3 } }]);
    const before = initialState(map);
    const untouched = snapshot(before);

    enter(map, before, cellOf(map, 1, 0));

    expect(snapshot(before)).toEqual(untouched);
  });
});
