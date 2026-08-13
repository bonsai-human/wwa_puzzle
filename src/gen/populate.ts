/**
 * 関門とリソースの配置。設計 §8.2(2)〜(5)。
 *
 * **仮想プレイヤーを主経路に沿って歩かせながら組み立てる。**
 * 先にその区間で手に入るものを置き、そのうえで「そこまでで手に入る力」を基準に
 * 関門の強さを決める。順序がこの向きだからこそ、出来上がったマップは
 * 構成上かならず解ける。ランダムに置いて後から検証する方式は、
 * 成功率が低すぎて実用にならない。
 *
 * 余裕率を絞るほど難しくなる。ぴったりに近づけると、
 * 一つでも取り逃すと詰む盤面になる。
 */

import type { ObjectDef, PlacedObject, Point } from '../core/index.ts';
import type { Layout, Passage, ScreenIndex } from './layout.ts';
import { screenKey } from './layout.ts';
import type { Rng } from './rng.ts';

export interface PopulateOptions {
  /** 関門の撃破コストが、その時点のHPに占める割合の範囲。小さいほど易しい。 */
  readonly gateCostRatio: readonly [number, number];
  /** 1画面あたりに置く強化アイテムの数。 */
  readonly itemsPerScreen: readonly [number, number];
  /** 1画面あたりに置くオーブ源の敵の数。 */
  readonly orbEnemiesPerScreen: readonly [number, number];
  /** 支道に囮を置く確率。 */
  readonly decoyChance: number;
}

export const DEFAULT_POPULATE: PopulateOptions = {
  gateCostRatio: [0.45, 0.7],
  itemsPerScreen: [2, 3],
  orbEnemiesPerScreen: [1, 3],
  decoyChance: 0.6,
};

export interface Population {
  readonly objects: PlacedObject[];
  readonly start: Point;
  readonly goal: Point;
  readonly player: { readonly hp: number; readonly atk: number; readonly def: number };
  /**
   * 組み立て時の見込み。実際の最適解とここが大きく食い違うなら、
   * 設計した難しさが盤面に乗っていないということになる。
   */
  readonly intended: { readonly finalHp: number; readonly atk: number; readonly def: number };
}

/** 組み立て中に持ち回る仮想プレイヤー。 */
interface Virtual {
  hp: number;
  atk: number;
  def: number;
  orbs: number;
  keys: Map<string, number>;
}

const KEY_COLORS = ['赤', '青', '緑'] as const;

export function populate(rng: Rng, layout: Layout, options: PopulateOptions): Population {
  const width = layout.width;
  const objects: PlacedObject[] = [];

  const pointOf = (cell: number): Point => ({ x: cell % width, y: Math.floor(cell / width) });

  /** 画面の空きセルを1つ取り出す。使い切ったら null。 */
  const takeCell = (screen: ScreenIndex): number | null => {
    const cells = layout.freeCells.get(screenKey(screen));
    return cells === undefined || cells.length === 0 ? null : cells.pop()!;
  };

  const place = (screen: ScreenIndex, object: ObjectDef | null): boolean => {
    if (object === null) return false;
    const cell = takeCell(screen);
    if (cell === null) return false;
    objects.push({ ...object, ...pointOf(cell) });
    return true;
  };

  const startCell = takeCell(layout.path[0]!);
  const goalCell = takeCell(layout.path[layout.path.length - 1]!);
  if (startCell === null || goalCell === null) {
    throw new Error('開始位置とゴールを置く場所がありません');
  }

  const player = { hp: rng.int(30, 50), atk: rng.int(8, 12), def: rng.int(1, 3) };
  const virtual: Virtual = { ...player, orbs: 0, keys: new Map() };

  /** その画面にぶら下がっている支道。 */
  const branchesOf = (screen: ScreenIndex): ScreenIndex[] =>
    layout.branches
      .filter((branch) => screenKey(branch.passage.from) === screenKey(screen))
      .map((branch) => branch.screen);

  // --- 強化とオーブ源 ---------------------------------------------------

  const placeItems = (screen: ScreenIndex): void => {
    const count = rng.int(options.itemsPerScreen[0], options.itemsPerScreen[1]);

    for (let i = 0; i < count; i++) {
      const roll = rng.next();
      if (roll < 0.4) {
        const amount = rng.int(2, 4);
        if (place(screen, { type: 'item', effect: { kind: 'atk', amount } })) virtual.atk += amount;
      } else if (roll < 0.7) {
        const amount = rng.int(1, 3);
        if (place(screen, { type: 'item', effect: { kind: 'def', amount } })) virtual.def += amount;
      } else {
        const amount = rng.int(15, 40);
        if (place(screen, { type: 'item', effect: { kind: 'hp', amount } })) virtual.hp += amount;
      }
    }
  };

  /**
   * オーブ源の敵。**反撃を受けない強さにする**（敵の攻撃力 ≤ 自分の防御力）。
   *
   * 少しでもHPを取る設計にすると、仮想プレイヤーは「全部倒す」前提で計算するのに、
   * 実際の最適解は必要のない雑魚を素通りする。その差がそのままHPの余りになり、
   * 設計した難しさが盤面に乗らない。実測では見込み7に対して実際68まで開いた。
   *
   * コスト0にすれば必ず倒されるので、見込みと実際が一致する。
   * オーブ集めは経済の配管であって、考えどころはここではなく関門と祭壇にある。
   */
  const placeOrbEnemies = (screen: ScreenIndex): void => {
    const count = rng.int(options.orbEnemiesPerScreen[0], options.orbEnemiesPerScreen[1]);

    for (let i = 0; i < count; i++) {
      const dp = rng.int(2, Math.max(2, Math.min(6, virtual.atk - 1)));
      const def = virtual.atk - dp;
      if (def < 0) continue;

      const enemy = {
        type: 'enemy' as const,
        hp: (rng.int(1, 3) - 1) * dp + rng.int(1, dp),
        atk: virtual.def, // de = 0 なので被害ゼロ
        def,
      };
      if (place(screen, { ...enemy, name: '野犬', orb: 1 })) virtual.orbs += 1;
    }
  };

  // --- 関門 -------------------------------------------------------------

  const placeEnemyGate = (passage: Passage, index: number): void => {
    const ratio = options.gateCostRatio[0] + rng.next() * (options.gateCostRatio[1] - options.gateCostRatio[0]);
    const enemy = designEnemy(rng, virtual, ratio);
    if (enemy === null) return;

    objects.push({
      ...enemy,
      ...pointOf(passage.gate),
      name: index === 0 ? '門番' : rng.pick(['衛兵', '重装兵', '守護者']),
      orb: rng.int(1, 3),
    });

    virtual.hp -= costAgainst(virtual, enemy);
    virtual.orbs += 1;
  };

  const placeDoorGate = (passage: Passage, color: string, source: ScreenIndex): boolean => {
    // 鍵の出どころを先に確保する。手に入らない鍵の扉はただの壁になる。
    const viaAltar = virtual.orbs >= 2 && rng.chance(0.5);

    if (viaAltar) {
      const cost = Math.min(virtual.orbs, rng.int(2, 3));
      const placed = place(source, {
        type: 'altar',
        id: `altar-${passage.gate}`,
        options: [
          {
            id: 'key',
            label: `${color}い鍵`,
            cost,
            effect: { kind: 'key', key: color, amount: 1 },
            stock: 1,
          },
          // 排他の相方。こちらを選ぶと鍵が買えなくなる罠でもある。
          {
            id: 'power',
            label: '力の証',
            cost,
            effect: { kind: 'atk', amount: rng.int(2, 4) },
            stock: 1,
          },
        ],
      });
      if (!placed) return false;
      virtual.orbs -= cost;
    } else {
      // 支道に置いて、寄り道を強いる。
      const branches = branchesOf(source);
      const target = branches.length > 0 && rng.chance(0.7) ? rng.pick(branches) : source;
      if (!place(target, { type: 'item', effect: { kind: 'key', key: color, amount: 1 } })) {
        return false;
      }
    }

    objects.push({ type: 'door', key: color, ...pointOf(passage.gate) });
    virtual.keys.set(color, (virtual.keys.get(color) ?? 0) + 1 - 1);
    return true;
  };

  // --- 囮 ---------------------------------------------------------------

  /**
   * 割に合わない選択肢。小さな見返りを、それを上回るコストの敵で守る。
   * これがないと「取れるものは全部取る」で最適戦略が尽きてしまう。
   */
  const placeDecoy = (screen: ScreenIndex): void => {
    if (!rng.chance(options.decoyChance)) return;

    const enemy = designEnemy(rng, virtual, rng.next() * 0.4 + 0.35);
    if (enemy === null) return;
    if (!place(screen, { ...enemy, name: '亡霊', orb: 1 })) return;

    place(screen, { type: 'item', effect: { kind: 'hp', amount: rng.int(5, 12) } });
  };

  // --- 主経路を歩きながら組み立てる -------------------------------------

  let colorIndex = 0;

  for (let i = 0; i < layout.path.length; i++) {
    const screen = layout.path[i]!;

    // オーブ源を先に置く。アイテムを配ってから設計すると、
    // 強化後の攻撃力を基準に防御力が決まってしまい、
    // その画面に着いた時点では全部「攻撃不能」に見える。
    // 最初の画面でそれが起きると、盤面が壊れているようにしか見えない。
    placeOrbEnemies(screen);
    placeItems(screen);

    for (const branch of branchesOf(screen)) {
      placeOrbEnemies(branch);
      placeItems(branch);
      placeDecoy(branch);
    }

    const passage = layout.gates[i];
    if (passage === undefined) continue;

    // 扉は鍵の供給が要るぶん重いので、序盤は敵、途中から混ぜる。
    const useDoor = i > 0 && colorIndex < KEY_COLORS.length && rng.chance(0.45);
    if (useDoor) {
      const color = KEY_COLORS[colorIndex]!;
      if (placeDoorGate(passage, color, screen)) {
        colorIndex += 1;
        continue;
      }
    }
    placeEnemyGate(passage, i);
  }

  return {
    objects,
    start: pointOf(startCell),
    goal: pointOf(goalCell),
    player,
    intended: { finalHp: virtual.hp, atk: virtual.atk, def: virtual.def },
  };
}

/** 与えられたステータスに対して、狙った割合のHPを削る敵を設計する。 */
function designEnemy(
  rng: Rng,
  virtual: Virtual,
  costRatio: number,
): { type: 'enemy'; hp: number; atk: number; def: number } | null {
  // 攻撃が通らなければ永久に通れない。必ず dp >= 1 を確保する。
  const dp = rng.int(2, Math.max(2, Math.min(8, virtual.atk - 1)));
  const def = virtual.atk - dp;
  if (def < 0) return null;

  const target = Math.max(1, Math.round(virtual.hp * costRatio));
  const hits = rng.int(2, 6);
  const de = Math.max(1, Math.round(target / (hits - 1)));

  // cost = (hits - 1) * de になるよう、ちょうど `hits` 手で沈む体力を選ぶ。
  const hp = (hits - 1) * dp + rng.int(1, dp);
  const atk = virtual.def + de;

  return { type: 'enemy', hp, atk, def };
}

function costAgainst(virtual: Virtual, enemy: { hp: number; atk: number; def: number }): number {
  const dp = virtual.atk - enemy.def;
  if (dp <= 0) return Number.POSITIVE_INFINITY;

  const de = enemy.atk - virtual.def;
  if (de <= 0) return 0;

  return (Math.floor((enemy.hp - 1) / dp) + 1 - 1) * de;
}
