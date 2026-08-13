/**
 * 骨格の生成。設計 §8.2(1)。
 *
 * 画面をそのまま部屋グラフのノードとして使う。3×3画面なら9ノードのグリッドで、
 * 開始画面からゴール画面への主経路を引き、残りを支道としてぶら下げる。
 *
 * 画面の縁には壁を敷き、隣接画面へ通じる開口部を1箇所に絞る。
 * こうすると画面が閉じた部屋になり、**開口部がそのまま関門の設置位置になる**。
 * 画面境界はルール上は何の意味も持たないが、生成の構造としては非常に扱いやすい。
 */

import type { Rng } from './rng.ts';

export interface ScreenIndex {
  readonly x: number;
  readonly y: number;
}

export interface Passage {
  /** 手前の画面側の通路セル。関門はここに置く。 */
  readonly gate: number;
  /** 奥の画面側の通路セル。 */
  readonly far: number;
  readonly from: ScreenIndex;
  readonly to: ScreenIndex;
}

export interface Layout {
  readonly width: number;
  readonly height: number;
  readonly screen: { readonly width: number; readonly height: number };
  /** '.' = 床、'#' = 壁。 */
  readonly rows: string[];
  /** 主経路上の画面。先頭が開始、末尾がゴール。 */
  readonly path: readonly ScreenIndex[];
  /** 主経路の各区間をつなぐ通路。`path[i]` と `path[i+1]` の間。 */
  readonly gates: readonly Passage[];
  /** 支道の画面と、そこへ通じる通路。 */
  readonly branches: readonly { readonly screen: ScreenIndex; readonly passage: Passage }[];
  /** 画面ごとの、置ける床セル（通路と部屋の中心を除く）。 */
  readonly freeCells: ReadonlyMap<string, number[]>;
}

export interface LayoutOptions {
  readonly screensX: number;
  readonly screensY: number;
  readonly screenWidth: number;
  readonly screenHeight: number;
}

const key = (screen: ScreenIndex): string => `${screen.x},${screen.y}`;

/** 画面グリッド上を、まだ通っていない隣へ進み続けて主経路を作る。 */
function carvePath(rng: Rng, options: LayoutOptions): ScreenIndex[] {
  const { screensX, screensY } = options;
  const visited = new Set<string>();
  const path: ScreenIndex[] = [];

  let current: ScreenIndex = { x: 0, y: 0 };
  visited.add(key(current));
  path.push(current);

  for (;;) {
    const candidates: ScreenIndex[] = [];
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const next = { x: current.x + dx, y: current.y + dy };
      if (next.x < 0 || next.x >= screensX || next.y < 0 || next.y >= screensY) continue;
      if (visited.has(key(next))) continue;
      candidates.push(next);
    }

    if (candidates.length === 0) break;

    // ゴールから遠ざかりすぎないよう、右下寄りを少しだけ優先する。
    candidates.sort((a, b) => b.x + b.y - (a.x + a.y));
    const next = rng.chance(0.7) ? candidates[0]! : rng.pick(candidates);

    visited.add(key(next));
    path.push(next);
    current = next;
  }

  return path;
}

export function generateLayout(rng: Rng, options: LayoutOptions): Layout {
  const { screensX, screensY, screenWidth, screenHeight } = options;
  const width = screensX * screenWidth;
  const height = screensY * screenHeight;

  // 全面を壁にしてから彫る。
  const grid: string[][] = [];
  for (let y = 0; y < height; y++) grid.push(new Array<string>(width).fill('#'));

  const carve = (x: number, y: number): void => {
    if (x < 0 || x >= width || y < 0 || y >= height) return;
    grid[y]![x] = '.';
  };

  const carveLine = (ax: number, ay: number, bx: number, by: number): void => {
    // L字。横に寄せてから縦に寄せる。
    const stepX = ax < bx ? 1 : -1;
    for (let x = ax; x !== bx; x += stepX) carve(x, ay);
    const stepY = ay < by ? 1 : -1;
    for (let y = ay; y !== by; y += stepY) carve(bx, y);
    carve(bx, by);
  };

  const path = carvePath(rng, options);
  const onPath = new Set(path.map(key));

  // 支道：主経路に含まれない画面を、隣接する既知の画面にぶら下げる。
  const branches: { screen: ScreenIndex; passage: Passage }[] = [];
  const attached = new Set(onPath);

  const screenCenters = new Map<string, { x: number; y: number }>();
  const roomCenters = new Map<string, { x: number; y: number }[]>();
  const freeCells = new Map<string, number[]>();

  // --- 各画面の内部を彫る ---------------------------------------------

  const allScreens: ScreenIndex[] = [];
  for (let sy = 0; sy < screensY; sy++) {
    for (let sx = 0; sx < screensX; sx++) allScreens.push({ x: sx, y: sy });
  }

  for (const screen of allScreens) {
    const left = screen.x * screenWidth + 1;
    const top = screen.y * screenHeight + 1;
    const right = screen.x * screenWidth + screenWidth - 2;
    const bottom = screen.y * screenHeight + screenHeight - 2;

    const centers: { x: number; y: number }[] = [];
    const roomCount = rng.int(3, 5);

    for (let i = 0; i < roomCount; i++) {
      // 画面の半分近くまで大きく取る。小さい部屋を細い通路でつなぐと、
      // 洞窟のようになって盤面が読みにくい。
      const roomWidth = rng.int(5, Math.max(5, Math.round((right - left) * 0.8)));
      const roomHeight = rng.int(5, Math.max(5, Math.round((bottom - top) * 0.8)));
      const x0 = rng.int(left, Math.max(left, right - roomWidth + 1));
      const y0 = rng.int(top, Math.max(top, bottom - roomHeight + 1));

      for (let y = y0; y < Math.min(y0 + roomHeight, bottom + 1); y++) {
        for (let x = x0; x < Math.min(x0 + roomWidth, right + 1); x++) carve(x, y);
      }
      centers.push({
        x: Math.min(x0 + (roomWidth >> 1), right),
        y: Math.min(y0 + (roomHeight >> 1), bottom),
      });
    }

    // 部屋どうしをつないで、画面の中で孤立した領域を作らない。
    for (let i = 1; i < centers.length; i++) {
      carveLine(centers[i - 1]!.x, centers[i - 1]!.y, centers[i]!.x, centers[i]!.y);
    }

    screenCenters.set(key(screen), centers[0]!);
    roomCenters.set(key(screen), centers);
  }

  // --- 画面どうしをつなぐ ---------------------------------------------

  const connect = (from: ScreenIndex, to: ScreenIndex): Passage => {
    const dx = to.x - from.x;
    const dy = to.y - from.y;

    let gate: { x: number; y: number };
    let far: { x: number; y: number };

    if (dx !== 0) {
      const boundary = dx > 0 ? from.x * screenWidth + screenWidth - 1 : from.x * screenWidth;
      const row = rng.int(from.y * screenHeight + 2, from.y * screenHeight + screenHeight - 3);
      gate = { x: boundary, y: row };
      far = { x: boundary + (dx > 0 ? 1 : -1), y: row };
    } else {
      const boundary = dy > 0 ? from.y * screenHeight + screenHeight - 1 : from.y * screenHeight;
      const column = rng.int(from.x * screenWidth + 2, from.x * screenWidth + screenWidth - 3);
      gate = { x: column, y: boundary };
      far = { x: column, y: boundary + (dy > 0 ? 1 : -1) };
    }

    carve(gate.x, gate.y);
    carve(far.x, far.y);

    // 通路を両側の部屋につなぐ。
    const fromCenter = screenCenters.get(key(from))!;
    const toCenter = screenCenters.get(key(to))!;
    carveLine(fromCenter.x, fromCenter.y, gate.x, gate.y);
    carveLine(toCenter.x, toCenter.y, far.x, far.y);

    return { gate: gate.y * width + gate.x, far: far.y * width + far.x, from, to };
  };

  const gates: Passage[] = [];
  for (let i = 0; i + 1 < path.length; i++) {
    gates.push(connect(path[i]!, path[i + 1]!));
  }

  for (const screen of allScreens) {
    if (attached.has(key(screen))) continue;

    const neighbours = allScreens.filter(
      (candidate) =>
        attached.has(key(candidate)) &&
        Math.abs(candidate.x - screen.x) + Math.abs(candidate.y - screen.y) === 1,
    );
    if (neighbours.length === 0) continue;

    const anchor = rng.pick(neighbours);
    branches.push({ screen, passage: connect(anchor, screen) });
    attached.add(key(screen));
  }

  // --- 到達できない床を落とす -----------------------------------------

  const rows = grid.map((row) => row.join(''));
  const startCenter = screenCenters.get(key(path[0]!))!;
  const reachable = floodFill(rows, width, height, startCenter.y * width + startCenter.x);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (grid[y]![x] === '.' && !reachable.has(y * width + x)) grid[y]![x] = '#';
    }
  }

  const finalRows = grid.map((row) => row.join(''));

  // --- 画面ごとの置ける場所 -------------------------------------------

  const occupied = new Set<number>();
  for (const passage of gates) {
    occupied.add(passage.gate);
    occupied.add(passage.far);
  }
  for (const branch of branches) {
    occupied.add(branch.passage.gate);
    occupied.add(branch.passage.far);
  }

  for (const screen of allScreens) {
    const cells: number[] = [];
    for (let y = screen.y * screenHeight; y < (screen.y + 1) * screenHeight; y++) {
      for (let x = screen.x * screenWidth; x < (screen.x + 1) * screenWidth; x++) {
        const cell = y * width + x;
        if (finalRows[y]![x] !== '.') continue;
        if (occupied.has(cell) || !reachable.has(cell)) continue;
        cells.push(cell);
      }
    }
    rng.shuffle(cells);
    freeCells.set(key(screen), cells);
  }

  return {
    width,
    height,
    screen: { width: screenWidth, height: screenHeight },
    rows: finalRows,
    path,
    gates,
    branches,
    freeCells,
  };
}

function floodFill(rows: readonly string[], width: number, height: number, from: number): Set<number> {
  const seen = new Set<number>();
  if (rows[Math.floor(from / width)]?.[from % width] !== '.') return seen;

  const queue = [from];
  seen.add(from);

  while (queue.length > 0) {
    const cell = queue.pop()!;
    const x = cell % width;
    const y = Math.floor(cell / width);

    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      if (rows[ny]![nx] !== '.') continue;

      const next = ny * width + nx;
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }

  return seen;
}

export { key as screenKey };
