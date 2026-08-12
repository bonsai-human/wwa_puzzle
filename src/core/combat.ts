/**
 * 戦闘。設計 §3.2。
 *
 * **このゲームで唯一の戦闘実装。** ゲーム本体・ソルバー・自動生成は必ずここを呼ぶ。
 * 実装が分岐すると「ソルバーは解けると言ったのに実機で解けない」が確実に起きる。
 *
 * プレイヤー先手の交互ターン制。乱数なし、整数のみ。ループは回さず閉じた式で解く。
 */

export interface Attacker {
  readonly atk: number;
  readonly def: number;
}

export interface EnemyStats {
  readonly hp: number;
  readonly atk: number;
  readonly def: number;
}

export type BattleResult =
  /** 自分の攻撃力が敵の防御力以下。何度殴っても倒せないため永久に通過できない。 */
  | { readonly outcome: 'unbeatable' }
  /** 勝てる。`cost` だけHPを失う。 */
  | {
      readonly outcome: 'win';
      readonly hits: number;
      readonly cost: number;
      readonly hpAfter: number;
    }
  /** 倒せはするがHPが足りない。戦闘は発生せず、そのマスを通過できないだけ（設計 §1）。 */
  | { readonly outcome: 'unaffordable'; readonly hits: number; readonly cost: number };

/**
 * 撃破に必要な手数と、その間に受ける被害を求める。
 *
 * 最後の一撃で敵は倒れるので反撃しない。よって反撃回数は手数 `n` ではなく `n - 1`。
 * `de <= 0` なら被害は0になり、防御力を先に上げることで敵が無料になる。これは意図した設計。
 */
export function battle(player: Attacker & { readonly hp: number }, enemy: EnemyStats): BattleResult {
  const dp = player.atk - enemy.def;
  if (dp <= 0) return { outcome: 'unbeatable' };

  const de = enemy.atk - player.def;

  // ceil(enemy.hp / dp) を整数演算で。浮動小数の除算を避ける。
  const hits = Math.floor((enemy.hp - 1) / dp) + 1;
  const cost = de > 0 ? (hits - 1) * de : 0;

  // 生存条件は hp > cost。戦闘後のHPは最低1（設計 §3.2）。
  if (player.hp <= cost) return { outcome: 'unaffordable', hits, cost };

  return { outcome: 'win', hits, cost, hpAfter: player.hp - cost };
}

/**
 * 撃破コストだけを求める。倒せない場合は `null`。
 * 情報パネルの敵一覧（設計 §11.7）のように、HPと無関係にコストだけ知りたい場面で使う。
 */
export function battleCost(player: Attacker, enemy: EnemyStats): number | null {
  const dp = player.atk - enemy.def;
  if (dp <= 0) return null;

  const de = enemy.atk - player.def;
  if (de <= 0) return 0;

  return (Math.floor((enemy.hp - 1) / dp) + 1 - 1) * de;
}
