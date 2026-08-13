/**
 * 種を指定できる擬似乱数。
 *
 * 生成は必ず再現できなければならない。「良いマップが出たがもう作れない」も、
 * 「不合格になったマップを調べ直せない」も困る。
 */

export interface Rng {
  /** 0 以上 1 未満。 */
  next(): number;
  /** `min` 以上 `max` 以下の整数。 */
  int(min: number, max: number): number;
  pick<T>(values: readonly T[]): T;
  /** 確率 `p` で true。 */
  chance(p: number): boolean;
  shuffle<T>(values: T[]): void;
}

export function createRng(seed: number): Rng {
  let state = seed >>> 0;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const int = (min: number, max: number): number =>
    max <= min ? min : min + Math.floor(next() * (max - min + 1));

  return {
    next,
    int,
    pick: <T>(values: readonly T[]): T => values[int(0, values.length - 1)]!,
    chance: (p: number): boolean => next() < p,
    shuffle: <T>(values: T[]): void => {
      for (let i = values.length - 1; i > 0; i--) {
        const j = int(0, i);
        [values[i], values[j]] = [values[j]!, values[i]!];
      }
    },
  };
}
