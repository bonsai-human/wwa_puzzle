/**
 * 支配関係による枝刈り。設計 §7.4。
 *
 *   状態 A が状態 B を支配する ⇔
 *     consumed(A) ⊇ consumed(B) かつ、比較可能な量のすべてで A ≥ B
 *
 * 正当性：B の後続手順を A が模倣できる。B が解決するオブジェクトのうち
 * A が消費済みのものは飛ばせる（その効果は A のステータスに既に入っている）。
 * 未消費のものは、消費済みセルが床になる以上 A の通行可能集合は B 以上なので到達できる。
 * 戦闘は A のほうが攻撃力・防御力で劣らないぶん安く、扉は鍵の本数で劣らないぶん開けられる。
 * よって A は B と同じ地点へ、B 以上のHPで到達できる。
 *
 * 比較する量には祭壇の使用回数も入れる。使用回数が少ないほど在庫が残っていて有利なので、
 * 符号を反転してベクトルに載せる。ここを落とすと、在庫を使い切った状態が
 * 使い残した状態を誤って支配してしまう。
 */

import { equals, hashBitset } from '../core/index.ts';
import type { CompiledMap, GameState } from '../core/index.ts';

/** 状態から比較用のベクトルを作る。すべて「大きいほど有利」に揃える。 */
export function statVector(map: CompiledMap, state: GameState): Float64Array {
  const vector = new Float64Array(4 + map.keyColors.length + map.orbKinds + map.options.length);

  let at = 0;
  vector[at++] = state.hp;
  vector[at++] = state.atk;
  vector[at++] = state.def;
  vector[at++] = state.masterKey;

  for (let i = 0; i < map.keyColors.length; i++) vector[at++] = state.keys[i] ?? 0;
  for (let i = 0; i < map.orbKinds; i++) vector[at++] = state.orbs[i] ?? 0;
  // 使った回数は少ないほうが有利なので反転する。
  for (let i = 0; i < map.options.length; i++) vector[at++] = -(state.altarUsed[i] ?? 0);

  return vector;
}

/** `a` が `b` を全成分で下回らないか。 */
export function dominatesVector(a: Float64Array, b: Float64Array): boolean {
  for (let i = 0; i < a.length; i++) {
    if (a[i]! < b[i]!) return false;
  }
  return true;
}

interface Entry {
  readonly consumed: Uint32Array;
  readonly vector: Float64Array;
}

/**
 * 訪問済み状態の表。
 *
 * 消費済み集合のハッシュでバケットに分け、集合が一致するもの同士で
 * ステータスベクトルの Pareto フロントだけを保持する。
 *
 * 設計 §7.4 の第2段（集合の包含まで見る支配判定）は入れていない。
 * 全バケットの走査が必要で挿入が O(n) になり、実マップでの効果が
 * 測れていないため。第1段だけでも、同じ集合に別経路で到達した状態は
 * すべてここで潰れる。
 */
export class DominanceTable {
  private readonly buckets = new Map<number, Entry[]>();
  private count = 0;

  constructor(private readonly map: CompiledMap) {}

  get size(): number {
    return this.count;
  }

  /**
   * 支配されていなければ登録して `true` を返す。
   * 登録時、この状態に支配される既存の項目は取り除く。
   */
  tryInsert(state: GameState): boolean {
    const key = hashBitset(state.consumed);
    const vector = statVector(this.map, state);
    const bucket = this.buckets.get(key);

    if (bucket === undefined) {
      this.buckets.set(key, [{ consumed: state.consumed, vector }]);
      this.count += 1;
      return true;
    }

    for (const entry of bucket) {
      if (!equals(entry.consumed, state.consumed)) continue;
      if (dominatesVector(entry.vector, vector)) return false;
    }

    let removed = 0;
    const kept = bucket.filter((entry) => {
      if (!equals(entry.consumed, state.consumed)) return true;
      if (dominatesVector(vector, entry.vector)) {
        removed += 1;
        return false;
      }
      return true;
    });

    kept.push({ consumed: state.consumed, vector });
    this.buckets.set(key, kept);
    this.count += 1 - removed;
    return true;
  }
}
