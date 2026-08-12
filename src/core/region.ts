/**
 * 自由領域（追加の解決なしに到達できる範囲）と、その境界の列挙。設計 §7.2。
 *
 * ここが「1マス移動を探索とUIの単位にしない」という設計の土台になる。
 * 領域内の移動は状態を変えないので、ソルバーもUIも
 * 「次にどのオブジェクトを解決するか」だけを扱えばよい。
 */

import { isPassable, xOf, yOf } from './engine.ts';
import type { CompiledMap } from './compile.ts';
import type { GameState } from './types.ts';

/** 近傍の走査順。決定性のため固定する。 */
const NEIGHBOR_DELTA: readonly (readonly [number, number])[] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

/** 直交する4近傍のセルを順に渡す。マップ外は渡さない。 */
export function forEachNeighbor(
  map: CompiledMap,
  cell: number,
  visit: (neighbor: number) => void,
): void {
  const x = xOf(map, cell);
  const y = yOf(map, cell);

  for (const [dx, dy] of NEIGHBOR_DELTA) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || nx >= map.width || ny < 0 || ny >= map.height) continue;
    visit(ny * map.width + nx);
  }
}

export interface Region {
  /** 1 = 到達可能。 */
  readonly flags: Uint8Array;
  /** 到達可能なセルの数。 */
  readonly size: number;
}

/**
 * 現在位置から、何も解決せずに到達できるセルの連結成分。
 *
 * 起点は通行可能でなくても含める。オブジェクトを解決した直後は
 * そのセルに立っているが、消費済みなので通行可能でもある。
 *
 * 探索の最内側で呼ばれるため、必要最小限しか作らない。
 * セルの一覧が要る場合は {@link regionCells} を使う。
 */
export function reachable(map: CompiledMap, state: GameState): Region {
  const flags = new Uint8Array(map.cellCount);
  const queue = new Int32Array(map.cellCount);
  let head = 0;
  let tail = 0;

  // 最内側のループなので、近傍表と障害テーブルを直接引く。
  const neighbors = map.neighbors;
  const blockKind = map.blockKind;
  const consumed = state.consumed;

  flags[state.pos] = 1;
  queue[tail++] = state.pos;

  while (head < tail) {
    const base = queue[head++]! * 4;
    for (let k = 0; k < 4; k++) {
      const neighbor = neighbors[base + k]!;
      if (neighbor < 0 || flags[neighbor] === 1) continue;

      const block = blockKind[neighbor]!;
      if (block === 2) continue;
      if (block === 1 && (consumed[neighbor >>> 5]! & (1 << (neighbor & 31))) === 0) continue;

      flags[neighbor] = 1;
      queue[tail++] = neighbor;
    }
  }

  return { flags, size: tail };
}

/**
 * 1マスを解決した直後の自由領域を、直前の領域から差分で求める。
 *
 * オブジェクトの解決は通行可能性を増やすだけで、決して減らさない。
 * よって直前に到達できたセルは今も到達できる。新しく調べる必要があるのは、
 * 解決したセルから先に広がった範囲だけである。
 *
 * 探索は生成した状態ごとにこれを呼ぶ。全面の再探索と比べて、
 * 実マップでは一桁以上安い。
 *
 * `base` は `openedCell` に隣接していた領域でなければならない。
 * 離れたセルを渡すと領域が繋がっていないまま返る。
 */
export function growRegion(
  map: CompiledMap,
  state: GameState,
  base: Region,
  openedCell: number,
): Region {
  const flags = Uint8Array.from(base.flags);
  if (flags[openedCell] === 1) return { flags, size: base.size };

  const neighbors = map.neighbors;
  const blockKind = map.blockKind;
  const consumed = state.consumed;

  const queue = new Int32Array(map.cellCount);
  let head = 0;
  let tail = 0;
  let size = base.size;

  flags[openedCell] = 1;
  size += 1;
  queue[tail++] = openedCell;

  while (head < tail) {
    const cellBase = queue[head++]! * 4;
    for (let k = 0; k < 4; k++) {
      const neighbor = neighbors[cellBase + k]!;
      if (neighbor < 0 || flags[neighbor] === 1) continue;

      const block = blockKind[neighbor]!;
      if (block === 2) continue;
      if (block === 1 && (consumed[neighbor >>> 5]! & (1 << (neighbor & 31))) === 0) continue;

      flags[neighbor] = 1;
      size += 1;
      queue[tail++] = neighbor;
    }
  }

  return { flags, size };
}

/** 到達可能なセルの一覧。昇順。 */
export function regionCells(map: CompiledMap, region: Region): Int32Array {
  const cells = new Int32Array(region.size);
  let index = 0;
  for (let cell = 0; cell < map.cellCount; cell++) {
    if (region.flags[cell] === 1) cells[index++] = cell;
  }
  return cells;
}

/**
 * 自由領域に接している未解決オブジェクトのセル一覧。探索の分岐候補になる。
 *
 * 祭壇は通行可能で領域の内側に入るため、ここには現れない。
 * 祭壇での交換は別のマクロ行動として扱う（{@link reachableAltars}）。
 */
export function frontierObjects(map: CompiledMap, state: GameState, region?: Region): Int32Array {
  const flags = (region ?? reachable(map, state)).flags;
  const found: number[] = [];

  for (let i = 0; i < map.objectCells.length; i++) {
    const cell = map.objectCells[i]!;
    const object = map.objectAt[cell] ?? null;
    if (object === null || object.type === 'altar') continue;
    if (flags[cell] === 1) continue; // 消費済みで領域に入っている

    const base = cell * 4;
    for (let k = 0; k < 4; k++) {
      const neighbor = map.neighbors[base + k]!;
      if (neighbor >= 0 && flags[neighbor] === 1) {
        found.push(cell);
        break;
      }
    }
  }

  return Int32Array.from(found);
}

/** 自由領域に含まれる祭壇のセル一覧。 */
export function reachableAltars(map: CompiledMap, state: GameState, region?: Region): Int32Array {
  const flags = (region ?? reachable(map, state)).flags;
  const found: number[] = [];

  for (const altar of map.altars) {
    if (flags[altar.cell] === 1) found.push(altar.cell);
  }

  found.sort((a, b) => a - b);
  return Int32Array.from(found);
}

/** 直交する4近傍のセル。マップ外は含まない。 */
export function neighborsOf(map: CompiledMap, cell: number): number[] {
  const found: number[] = [];
  forEachNeighbor(map, cell, (neighbor) => found.push(neighbor));
  return found;
}

interface SearchTree {
  /** 前駆セル。到達できないセルは -1。 */
  readonly prev: Int32Array;
  /** 起点からの歩数。到達できないセルは -1。 */
  readonly dist: Int32Array;
}

/** 通行可能なセルだけを辿る BFS。 */
function search(map: CompiledMap, state: GameState): SearchTree {
  const prev = new Int32Array(map.cellCount).fill(-1);
  const dist = new Int32Array(map.cellCount).fill(-1);
  const queue = new Int32Array(map.cellCount);
  let head = 0;
  let tail = 0;

  dist[state.pos] = 0;
  queue[tail++] = state.pos;

  while (head < tail) {
    const cell = queue[head++]!;
    const nextDist = dist[cell]! + 1;
    forEachNeighbor(map, cell, (neighbor) => {
      if (dist[neighbor] !== -1) return;
      if (!isPassable(map, state, neighbor)) return;
      dist[neighbor] = nextDist;
      prev[neighbor] = cell;
      queue[tail++] = neighbor;
    });
  }

  return { prev, dist };
}

function reconstruct(prev: Int32Array, from: number, to: number): number[] {
  const path: number[] = [];
  let cell = to;
  while (cell !== from) {
    path.push(cell);
    const parent = prev[cell]!;
    if (parent < 0) return [];
    cell = parent;
  }
  path.reverse();
  return path;
}

/**
 * 現在位置から目的セルまでの最短経路。通行可能なセルだけを通り、
 * 道中で何も解決しない（設計 §11.1 のタップ移動の定義）。
 *
 * 返すのは通過するセルの列で、現在位置は含まない。
 * 到達できない場合、および目的セルが現在位置と同じ場合は `null` を返す。
 */
export function findPath(map: CompiledMap, state: GameState, target: number): number[] | null {
  if (target === state.pos) return null;
  if (target < 0 || target >= map.cellCount) return null;
  if (!isPassable(map, state, target)) return null;

  const { prev, dist } = search(map, state);
  if (dist[target] === -1) return null;

  const path = reconstruct(prev, state.pos, target);
  return path.length > 0 ? path : null;
}

export interface Approach {
  /** 解決対象の隣まで歩く経路。すでに隣にいる場合は空。 */
  readonly path: readonly number[];
  /** 解決の直前に立つセル。 */
  readonly from: number;
}

/**
 * 未解決オブジェクトを解決するために、その隣まで歩く経路を求める。
 *
 * UIの「オブジェクトをタップしたら隣まで自動移動して解決する」（設計 §11.1）と、
 * ソルバーのマクロ行動の実体化に使う。到達できない場合は `null`。
 */
export function findApproach(
  map: CompiledMap,
  state: GameState,
  target: number,
): Approach | null {
  if (target < 0 || target >= map.cellCount) return null;

  const { prev, dist } = search(map, state);

  // 最も近い足場を選ぶ。同距離ならセル番号の昇順で決める（決定性のため）。
  let from = -1;
  let bestDist = -1;
  for (const neighbor of neighborsOf(map, target)) {
    const d = dist[neighbor]!;
    if (d === -1) continue;
    if (from === -1 || d < bestDist) {
      from = neighbor;
      bestDist = d;
    }
  }

  if (from === -1) return null;
  return { path: from === state.pos ? [] : reconstruct(prev, state.pos, from), from };
}
