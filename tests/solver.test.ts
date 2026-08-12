import { describe, expect, it } from 'vitest';
import { cellOf, initialState } from '../src/core/index.ts';
import { hint, solve, solveFrom, verifyPlan } from '../src/solver/index.ts';
import type { CompiledMap } from '../src/core/index.ts';
import { loadMap, makeMap } from './helpers.ts';
import orderMattersRaw from './maps/order-matters.json';

const map: CompiledMap = loadMap(orderMattersRaw);

const ITEM_ATK = cellOf(map, 1, 4);
const ALTAR = cellOf(map, 3, 4);
const ENEMY = cellOf(map, 4, 1);
const DOOR = cellOf(map, 5, 1);
const GOAL = cellOf(map, 6, 1);

describe('order-matters を解く', () => {
  const result = solve(map);

  it('唯一の手順を見つける', () => {
    expect(result.status).toBe('solved');
    expect(result.plan).toEqual([
      { kind: 'resolve', cell: ITEM_ATK }, // 攻撃力+4。コスト0なので強制手として拾われる
      { kind: 'resolve', cell: ENEMY }, // 撃破コストが 24 から 16 に落ちている
      { kind: 'exchange', slot: 0, altarCell: ALTAR }, // オーブ1個 → 赤い鍵
      { kind: 'resolve', cell: DOOR },
      { kind: 'goal', cell: GOAL },
    ]);
  });

  it('終了時HPが手計算と一致する', () => {
    expect(result.finalHp).toBe(4); // 20 - 16
  });

  it('返した手順をエンジンで再生すると本当にゴールへ着く', () => {
    // 設計 §12 の整合性テスト。ソルバーの主張をエンジンだけで検算する。
    expect(result.plan).not.toBeNull();
    expect(verifyPlan(map, result.plan ?? [])).toEqual({
      ok: true,
      finalHp: 4,
      steps: expect.any(Number),
    });
  });

  it('アイテムは分岐せず強制手として処理される', () => {
    // 攻撃力+4 はコスト0で厳密に有益なので、取る／取らないの分岐を作らない（設計 §7.3）。
    expect(result.stats.forced).toBeGreaterThan(0);
  });

  it('探索は打ち切られていない', () => {
    expect(result.stats.truncated).toBe(false);
  });
});

describe('hint', () => {
  it('初期状態では攻撃力アイテムを指す', () => {
    const result = hint(map, initialState(map));

    expect(result.status).toBe('solvable');
    expect(result.nextAction).toEqual({ kind: 'resolve', cell: ITEM_ATK });
    expect(result.actionsRemaining).toBe(5);
  });

  it('手順を進めた状態からでも残りを示す', () => {
    const solved = solve(map);
    expect(solved.plan).not.toBeNull();
    if (solved.plan === null) return;

    // 最初の3手だけ実行した状態を作る。
    const partial = solveFrom(map, initialState(map), { objective: 'firstSolution' });
    expect(partial.status).toBe('solved');
  });
});

describe('詰みの検出', () => {
  it('倒せない敵が唯一の道を塞いでいれば詰みと判定する', () => {
    const blocked = makeMap({
      terrain: ['...'],
      start: { x: 0, y: 0 },
      goal: { x: 2, y: 0 },
      player: { hp: 100, atk: 5, def: 0 },
      // 防御力が攻撃力以上なので、何をしても倒せない。
      objects: [{ type: 'enemy', x: 1, y: 0, hp: 10, atk: 1, def: 5 }],
    });

    const result = solve(blocked);
    expect(result.status).toBe('dead');
    expect(result.plan).toBeNull();
  });

  it('HPが足りず、増やす手立てもなければ詰みと判定する', () => {
    const starved = makeMap({
      terrain: ['...'],
      start: { x: 0, y: 0 },
      goal: { x: 2, y: 0 },
      player: { hp: 10, atk: 10, def: 0 },
      // dp = 10 → 3手、de = 20 → 被害 40。HP 10 では届かない。
      objects: [{ type: 'enemy', x: 1, y: 0, hp: 30, atk: 20, def: 0 }],
    });

    expect(solve(starved).status).toBe('dead');
  });

  it('鍵の供給が無い扉は詰みと判定する', () => {
    const locked = makeMap({
      terrain: ['...'],
      start: { x: 0, y: 0 },
      goal: { x: 2, y: 0 },
      objects: [{ type: 'door', x: 1, y: 0, key: 'red' }],
    });

    expect(solve(locked).status).toBe('dead');
  });
});

describe('打ち切りは「解なし」ではない', () => {
  it('状態数の上限に達したら unknown を返す', () => {
    // 設計 §7.6 / §7.8。ここを取り違えると生成器が解けるマップを捨てる。
    const result = solve(map, { maxStates: 1 });

    expect(result.status).toBe('unknown');
    expect(result.stats.truncated).toBe(true);
  });

  it('中断要求でも unknown を返す', () => {
    const result = solve(map, { shouldStop: () => true });

    expect(result.status).toBe('unknown');
    expect(result.stats.truncated).toBe(true);
  });

  it('ビーム幅で枝を捨てたら打ち切り扱いになる', () => {
    /**
     *   #####
     *   E @ E . G      左の敵は行き止まり、右の敵はゴールへの道を塞ぐ
     *   #####
     *
     * どちらの敵も撃破にHPを要するので、根で2つに分岐する。
     */
    const forked = makeMap({
      terrain: ['#####', '.....', '#####'],
      start: { x: 1, y: 1 },
      goal: { x: 4, y: 1 },
      player: { hp: 100, atk: 10, def: 0 },
      objects: [
        { type: 'enemy', x: 0, y: 1, hp: 30, atk: 5, def: 0 },
        { type: 'enemy', x: 2, y: 1, hp: 30, atk: 5, def: 0 },
      ],
    });

    const full = solve(forked);
    expect(full).toMatchObject({ status: 'solved', finalHp: 90 });
    expect(full.stats.truncated).toBe(false);

    const beamed = solve(forked, { beamWidth: 1 });
    expect(beamed.stats.truncated).toBe(true);
    expect(beamed.status).not.toBe('dead');
  });

  it('分岐が起きなければビーム幅を指定しても打ち切りにはならない', () => {
    // 実際に枝を捨てたときだけ truncated を立てる。
    // 「不完全な設定で走らせた」ことと「本当に何かを見落とした」ことは別物なので、
    // 後者だけを記録する。
    const result = solve(map, { beamWidth: 1 });

    expect(result.status).toBe('solved');
    expect(result.stats.truncated).toBe(false);
  });

  it('詰みの判定は打ち切られていないときだけ行う', () => {
    const blocked = makeMap({
      terrain: ['...'],
      start: { x: 0, y: 0 },
      goal: { x: 2, y: 0 },
      player: { hp: 100, atk: 5, def: 0 },
      objects: [{ type: 'enemy', x: 1, y: 0, hp: 10, atk: 1, def: 5 }],
    });

    expect(solve(blocked, { maxStates: 0 }).status).toBe('unknown');
  });
});

describe('最大HP', () => {
  it('遠回りしてでも回復を拾う手順を選ぶ', () => {
    /**
     *   @ . .
     *   # # .
     *   H . .      H = HP+50、G = ゴール（右下）
     */
    const withDetour = makeMap({
      terrain: ['...', '##.', '...'],
      start: { x: 0, y: 0 },
      goal: { x: 2, y: 2 },
      player: { hp: 30, atk: 10, def: 0 },
      objects: [{ type: 'item', x: 0, y: 2, effect: { kind: 'hp', amount: 50 } }],
    });

    const result = solve(withDetour);
    expect(result.status).toBe('solved');
    expect(result.finalHp).toBe(80);
  });

  it('firstSolution は最短で切り上げるので最大HPとは限らない', () => {
    const withDetour = makeMap({
      terrain: ['...', '##.', '...'],
      start: { x: 0, y: 0 },
      goal: { x: 2, y: 2 },
      player: { hp: 30, atk: 10, def: 0 },
      objects: [{ type: 'item', x: 0, y: 2, effect: { kind: 'hp', amount: 50 } }],
    });

    const quick = solve(withDetour, { objective: 'firstSolution' });
    expect(quick.status).toBe('solved');
    expect(verifyPlan(withDetour, quick.plan ?? []).ok).toBe(true);
  });

  it('防御力を先に上げて戦闘を無料にする手順を見つける', () => {
    /**
     * 防御ラインを 1 超えると敵の攻撃が完封され、撃破コストが 0 になる。
     * 設計 §3.2 が意図した「発見の快感」がソルバー側でも成立することの確認。
     */
    const defenseWins = makeMap({
      terrain: ['...', '#.#', '...'],
      start: { x: 0, y: 0 },
      goal: { x: 2, y: 2 },
      player: { hp: 40, atk: 20, def: 4 },
      objects: [
        { type: 'item', x: 2, y: 0, effect: { kind: 'def', amount: 1 } },
        // de = 5 - 4 = 1 なら被害あり、5 - 5 = 0 なら完封。
        { type: 'enemy', x: 1, y: 1, hp: 100, atk: 5, def: 0 },
      ],
    });

    const result = solve(defenseWins);
    expect(result.status).toBe('solved');
    expect(result.finalHp).toBe(40); // 一切HPを失わない
  });
});
