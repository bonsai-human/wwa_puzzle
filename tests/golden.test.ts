import { describe, expect, it } from 'vitest';
import {
  cellOf,
  checkEnter,
  enter,
  exchange,
  findApproach,
  initialState,
  isGoal,
} from '../src/core/index.ts';
import type { CompiledMap, GameState } from '../src/core/index.ts';
import { loadMap } from './helpers.ts';
import orderMattersRaw from './maps/order-matters.json';

/**
 * 手書きマップの通し実行。設計 §12「ゴールデンテスト」。
 *
 * order-matters は、このゲームの主張そのものを最小構成で表したマップ。
 *
 *   ########
 *   #.@.E D.#  →  @ = 開始、E = 敵、D = 赤い扉、G = ゴール
 *   #.######
 *   #.######
 *   #A.S####      A = 攻撃力+4、S = 祭壇（オーブ1個で赤い鍵）
 *
 * 手順が一意に決まっている：
 *   1. そのまま敵に挑むと撃破コスト 24 に対しHP 20 で足りない
 *   2. 攻撃力+4 を取ると撃破コストが 16 に落ちて倒せるようになる
 *   3. 撃破で得たオーブ1個を祭壇で赤い鍵に換える
 *   4. 扉を開けてゴールへ
 *
 * どの要素を抜いてもクリアできない。順序を入れ替えてもクリアできない。
 */

const map: CompiledMap = loadMap(orderMattersRaw);

const ITEM_ATK = cellOf(map, 1, 4);
const ALTAR = cellOf(map, 3, 4);
const ENEMY = cellOf(map, 4, 1);
const DOOR = cellOf(map, 5, 1);
const GOAL = cellOf(map, 6, 1);

/**
 * 対象まで歩いて解決する。
 * 経路を1マスずつ辿るので、到達可能性・移動・解決のすべてを通す。
 */
function resolveAt(state: GameState, target: number): GameState {
  const approach = findApproach(map, state, target);
  if (approach === null) throw new Error(`到達できません: ${target}`);

  let current = state;
  for (const cell of approach.path) {
    const walked = enter(map, current, cell);
    if (!walked.ok) throw new Error(`経路の途中で止まりました: ${walked.reason.kind}`);
    current = walked.state;
  }

  const resolved = enter(map, current, target);
  if (!resolved.ok) throw new Error(`解決できません: ${resolved.reason.kind}`);
  return resolved.state;
}

describe('order-matters', () => {
  it('マップとして妥当である', () => {
    expect(map.width).toBe(8);
    expect(map.height).toBe(5);
    expect(map.keyColors).toEqual(['red']);
    expect(map.options).toHaveLength(1);
  });

  it('最初から敵に挑むとHPが足りない', () => {
    const check = checkEnter(map, initialState(map), ENEMY);

    expect(check.ok).toBe(false);
    if (!check.ok && check.reason.kind === 'insufficientHp') {
      // dp = 12 - 4 = 8 → 4手、de = 10 - 2 = 8 → 被害 24。HP 20 では届かない。
      expect(check.reason.cost).toBe(24);
    } else {
      expect.unreachable('HP不足で弾かれるべき');
    }
  });

  it('攻撃力を先に取ると撃破コストが 24 から 16 に落ちる', () => {
    const armed = resolveAt(initialState(map), ITEM_ATK);
    expect(armed.atk).toBe(16);

    const check = checkEnter(map, armed, ENEMY);
    expect(check.ok).toBe(true);
    if (check.ok && check.outcome.kind === 'battle') {
      expect(check.outcome.hits).toBe(3);
      expect(check.outcome.cost).toBe(16);
    } else {
      expect.unreachable('戦えるべき');
    }
  });

  it('オーブを持たないうちは祭壇で交換できない', () => {
    const atAltar = resolveAt(resolveAt(initialState(map), ITEM_ATK), ALTAR);
    const result = exchange(map, atAltar, 0);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason.kind).toBe('insufficientOrbs');
  });

  it('鍵を持たないうちは扉を開けられない', () => {
    const afterFight = resolveAt(resolveAt(initialState(map), ITEM_ATK), ENEMY);
    const check = checkEnter(map, afterFight, DOOR);

    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.reason.kind).toBe('noKey');
  });

  it('正しい順序でクリアでき、最終状態が一致する', () => {
    let state = initialState(map);

    state = resolveAt(state, ITEM_ATK); // 攻撃力 12 → 16
    state = resolveAt(state, ENEMY); // HP 20 → 4、オーブ 0 → 1
    expect(state.hp).toBe(4);
    expect([...state.orbs]).toEqual([1]);

    state = resolveAt(state, ALTAR); // 祭壇まで戻る
    const traded = exchange(map, state, 0); // オーブ1 → 赤い鍵1
    expect(traded.ok).toBe(true);
    if (!traded.ok) return;
    state = traded.state;

    state = resolveAt(state, DOOR); // 赤い鍵を消費
    state = resolveAt(state, GOAL);

    expect(isGoal(map, state)).toBe(true);
    expect({
      hp: state.hp,
      atk: state.atk,
      def: state.def,
      keys: [...state.keys],
      orbs: [...state.orbs],
    }).toEqual({ hp: 4, atk: 16, def: 2, keys: [0], orbs: [0] });
  });

  it('祭壇の在庫は1回で尽きる', () => {
    let state = resolveAt(resolveAt(initialState(map), ITEM_ATK), ENEMY);
    state = resolveAt(state, ALTAR);

    const first = exchange(map, state, 0);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    // オーブがあっても在庫が無い。
    const stocked: GameState = { ...first.state, orbs: Int32Array.from([9]) };
    const second = exchange(map, stocked, 0);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason.kind).toBe('outOfStock');
  });
});
