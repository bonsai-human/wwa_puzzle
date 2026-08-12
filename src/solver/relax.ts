/**
 * 緩和による打ち切りと上界。設計 §7.5。
 *
 * 設計では「すべての敵をコスト0、すべての扉を開放とみなす」と書いたが、
 * それは実際には何も刈らない。壁は不変なので、そこまで緩めた到達可能性は
 * プレイヤーの位置に関わらず一定になり、ゴールが壁で囲まれている場合
 * ——つまりマップの静的な欠陥——しか検出できない。
 *
 * そこで緩和を一段締める。「今後どれだけ強くなれるか」「今後その色の鍵を
 * 何本まで持ちうるか」の上界を取り、それでも突破できない敵と扉だけを壁として扱う。
 *
 * どちらの上界も未消費のオブジェクトを到達可能性を無視して数え上げるので、
 * 実際に達成できる値以上になる。過大評価は「刈りすぎない」側に効くため、
 * 解ける状態を誤って詰みと判定することはない。
 *
 * 探索の最内側で状態ごとに呼ばれる。作業用の配列は使い回して確保を避ける。
 */

import { forEachNeighbor, hasBit } from '../core/index.ts';
import type { CompiledEffect, CompiledMap, GameState } from '../core/index.ts';

/**
 * 緩和判定器。1回の探索につき1つ作り、作業領域を共有する。
 */
export class Relaxer {
  private readonly keyPotential: Float64Array;
  private readonly seen: Uint8Array;
  private readonly queue: Int32Array;

  /** 最後に集計した上界。`collect` の呼び出しごとに更新される。 */
  private maxAtk = 0;
  private masterKeyPossible = false;
  private hpGain = 0;

  constructor(private readonly map: CompiledMap) {
    this.keyPotential = new Float64Array(map.keyColors.length);
    this.seen = new Uint8Array(map.cellCount);
    this.queue = new Int32Array(map.cellCount);
  }

  private applyEffect(effect: CompiledEffect, times: number): void {
    if (times <= 0) return;

    switch (effect.kind) {
      case 'atk':
        this.maxAtk += effect.amount * times;
        break;
      case 'hp':
        this.hpGain += effect.amount * times;
        break;
      case 'key':
        this.keyPotential[effect.keyId]! += effect.amount * times;
        break;
      case 'masterKey':
        this.masterKeyPossible = true;
        break;
      default:
        break;
    }
  }

  /** 未消費のオブジェクトから、今後得られるものの上界を集める。 */
  private collect(state: GameState): void {
    const map = this.map;

    this.maxAtk = state.atk;
    this.masterKeyPossible = state.masterKey > 0;
    this.hpGain = 0;
    for (let i = 0; i < this.keyPotential.length; i++) {
      this.keyPotential[i] = state.keys[i] ?? 0;
    }

    for (let i = 0; i < map.objectCells.length; i++) {
      const cell = map.objectCells[i]!;
      const object = map.objectAt[cell] ?? null;
      if (object === null) continue;

      if (object.type === 'item') {
        if (hasBit(state.consumed, cell)) continue;
        this.applyEffect(object.effect, 1);
        continue;
      }

      if (object.type === 'altar') {
        for (const slot of object.slots) {
          const option = map.options[slot];
          if (option === undefined) continue;
          this.applyEffect(option.effect, option.stock - (state.altarUsed[slot] ?? 0));
        }
      }
    }
  }

  /**
   * この状態からゴールへ到達する手順が存在しないことが確実か。
   *
   * `true` を返すのは詰みが証明できた場合だけで、`false` は「まだ分からない」を意味する。
   */
  isHopeless(state: GameState): boolean {
    this.collect(state);

    const map = this.map;
    const seen = this.seen;
    const queue = this.queue;
    seen.fill(0);

    let head = 0;
    let tail = 0;
    seen[state.pos] = 1;
    queue[tail++] = state.pos;

    while (head < tail) {
      const cell = queue[head++]!;
      if (cell === map.goalCell) return false;

      forEachNeighbor(map, cell, (neighbor) => {
        if (seen[neighbor] === 1) return;
        if (!this.relaxedPassable(state, neighbor)) return;
        seen[neighbor] = 1;
        queue[tail++] = neighbor;
      });
    }

    return true;
  }

  private relaxedPassable(state: GameState, cell: number): boolean {
    const map = this.map;
    if (map.walls[cell] === 1) return false;

    const object = map.objectAt[cell] ?? null;
    if (object === null || object.type === 'altar') return true;
    if (hasBit(state.consumed, cell)) return true;

    switch (object.type) {
      case 'item':
        return true;
      case 'enemy':
        // どれだけ強くなっても防御力を上回れないなら、この敵は壁と同じ。
        return object.def < this.maxAtk;
      case 'door':
        // 鍵の取り合いは無視する。1本でも持ちうるなら通れるものとして扱う。
        return this.masterKeyPossible || (this.keyPotential[object.keyId] ?? 0) > 0;
    }
  }

  /**
   * この状態から到達しうる終了時HPの上界。
   *
   * 戦闘の被害を無視し、残っている回復をすべて取れるものとして数える。
   * すでに見つけた解を超えられない枝を捨てるために使う。
   */
  hpUpperBound(state: GameState): number {
    this.collect(state);
    return state.hp + this.hpGain;
  }
}

/** 単発で判定する。繰り返し呼ぶ場合は {@link Relaxer} を使い回すこと。 */
export function isHopeless(map: CompiledMap, state: GameState): boolean {
  return new Relaxer(map).isHopeless(state);
}

/** 単発で上界を求める。 */
export function hpUpperBound(map: CompiledMap, state: GameState): number {
  return new Relaxer(map).hpUpperBound(state);
}
