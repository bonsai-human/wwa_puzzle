/**
 * セル集合を表すビットセット。`Uint32Array` の薄いラッパ。
 *
 * 消費済み集合はソルバーの支配判定（設計 §7.4）で何百万回も比較されるため、
 * 集合演算をここに閉じ込めて最適化できるようにしておく。
 */

export function createBitset(bitCount: number): Uint32Array {
  return new Uint32Array((bitCount + 31) >>> 5);
}

export function hasBit(set: Uint32Array, index: number): boolean {
  // 添字は呼び出し側が範囲内であることを保証する（セル数は固定）。
  return (set[index >>> 5]! & (1 << (index & 31))) !== 0;
}

export function setBit(set: Uint32Array, index: number): void {
  set[index >>> 5]! |= 1 << (index & 31);
}

export function clearBit(set: Uint32Array, index: number): void {
  set[index >>> 5]! &= ~(1 << (index & 31));
}

/** 立っているビットの数。 */
export function popCount(set: Uint32Array): number {
  let total = 0;
  for (let i = 0; i < set.length; i++) {
    let word = set[i]!;
    word = word - ((word >>> 1) & 0x55555555);
    word = (word & 0x33333333) + ((word >>> 2) & 0x33333333);
    total += (((word + (word >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
  }
  return total;
}

/** `subset ⊆ superset` か。支配判定（設計 §7.4）で使う。 */
export function isSubsetOf(subset: Uint32Array, superset: Uint32Array): boolean {
  for (let i = 0; i < subset.length; i++) {
    if ((subset[i]! & ~superset[i]!) !== 0) return false;
  }
  return true;
}

export function equals(a: Uint32Array, b: Uint32Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/** FNV-1a によるハッシュ。状態テーブルのキーに使う。 */
export function hashBitset(set: Uint32Array): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < set.length; i++) {
    const word = set[i]!;
    for (let shift = 0; shift < 32; shift += 8) {
      hash ^= (word >>> shift) & 0xff;
      hash = Math.imul(hash, 0x01000193);
    }
  }
  return hash >>> 0;
}
