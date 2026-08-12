import { describe, expect, it } from 'vitest';
import { battle, battleCost } from '../src/core/index.ts';

/**
 * 戦闘式の境界値。設計 §3.2 / §12。
 *
 * ここが1でもずれると、ソルバーの解と実機の挙動が食い違う。
 * 反撃回数が `n` ではなく `n - 1` であること、生存条件が `>=` ではなく `>` であることを
 * 特に厚く固定する。
 */

const enemy = { hp: 30, atk: 10, def: 4 } as const;

describe('battle', () => {
  it('設計 §3.2 の例：攻撃力12なら4手・被害24', () => {
    // dp = 12 - 4 = 8 → hits = ceil(30/8) = 4、de = 10 - 2 = 8 → cost = 3 * 8 = 24
    expect(battle({ hp: 100, atk: 12, def: 2 }, enemy)).toEqual({
      outcome: 'win',
      hits: 4,
      cost: 24,
      hpAfter: 76,
    });
  });

  it('設計 §3.2 の例：攻撃力を4上げると3手・被害16に落ちる', () => {
    // dp = 16 - 4 = 12 → hits = ceil(30/12) = 3 → cost = 2 * 8 = 16
    expect(battle({ hp: 100, atk: 16, def: 2 }, enemy)).toEqual({
      outcome: 'win',
      hits: 3,
      cost: 16,
      hpAfter: 84,
    });
  });

  it('攻撃力が敵の防御力と同じなら攻撃不能', () => {
    expect(battle({ hp: 100, atk: 4, def: 0 }, enemy)).toEqual({ outcome: 'unbeatable' });
  });

  it('攻撃力が敵の防御力を下回っても攻撃不能', () => {
    expect(battle({ hp: 100, atk: 3, def: 0 }, enemy)).toEqual({ outcome: 'unbeatable' });
  });

  it('攻撃力が敵の防御力を1上回れば倒せる', () => {
    // dp = 1 → hits = 30、cost = 29 * de
    const result = battle({ hp: 1000, atk: 5, def: 0 }, enemy);
    expect(result).toEqual({ outcome: 'win', hits: 30, cost: 29 * 10, hpAfter: 1000 - 290 });
  });

  it('防御力が敵の攻撃力以上なら被害ゼロ', () => {
    expect(battle({ hp: 5, atk: 12, def: 10 }, enemy)).toEqual({
      outcome: 'win',
      hits: 4,
      cost: 0,
      hpAfter: 5,
    });
  });

  it('防御力が敵の攻撃力を上回っても被害は負にならない', () => {
    expect(battle({ hp: 5, atk: 12, def: 99 }, enemy)).toMatchObject({ cost: 0, hpAfter: 5 });
  });

  it('一撃で倒せる相手は反撃を受けない', () => {
    // hits = 1 なので反撃回数は 0。敵の攻撃力がいくら高くても被害ゼロ。
    expect(battle({ hp: 1, atk: 34, def: 0 }, enemy)).toEqual({
      outcome: 'win',
      hits: 1,
      cost: 0,
      hpAfter: 1,
    });
  });

  it('割り切れる場合の手数を1多く数えない', () => {
    // dp = 10、敵HP 30 → ちょうど3手。4手にしてはいけない。
    expect(battle({ hp: 100, atk: 14, def: 10 }, enemy)).toMatchObject({ hits: 3, cost: 0 });
  });

  it('割り切れない場合は切り上げる', () => {
    // dp = 7、敵HP 30 → ceil(30/7) = 5
    expect(battle({ hp: 100, atk: 11, def: 10 }, enemy)).toMatchObject({ hits: 5 });
  });

  it('HPが被害と同じなら通過できない', () => {
    // 生存条件は hp > cost。等しい場合は死ぬので不可（設計 §3.2）。
    expect(battle({ hp: 24, atk: 12, def: 2 }, enemy)).toEqual({
      outcome: 'unaffordable',
      hits: 4,
      cost: 24,
    });
  });

  it('HPが被害より1多ければ通過でき、残りHPは1になる', () => {
    expect(battle({ hp: 25, atk: 12, def: 2 }, enemy)).toEqual({
      outcome: 'win',
      hits: 4,
      cost: 24,
      hpAfter: 1,
    });
  });

  it('HPが足りなくても撃破コストは報告する', () => {
    // 情報パネルは「いくら足りないか」を出す必要がある（設計 §11.7）。
    const result = battle({ hp: 1, atk: 12, def: 2 }, enemy);
    expect(result).toMatchObject({ outcome: 'unaffordable', cost: 24 });
  });
});

describe('battleCost', () => {
  it('倒せない相手には null を返す', () => {
    expect(battleCost({ atk: 4, def: 0 }, enemy)).toBeNull();
  });

  it('HPに関わらず battle と同じコストを返す', () => {
    for (const atk of [5, 7, 11, 12, 16, 34, 100]) {
      for (const def of [0, 2, 9, 10, 50]) {
        const full = battle({ hp: Number.MAX_SAFE_INTEGER, atk, def }, enemy);
        const cost = battleCost({ atk, def }, enemy);
        if (full.outcome === 'unbeatable') {
          expect(cost).toBeNull();
        } else {
          expect(cost).toBe(full.cost);
        }
      }
    }
  });
});
