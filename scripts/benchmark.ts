/**
 * 探索器の性能を測る。
 *
 *   npx vite-node scripts/benchmark.ts
 *
 * 設計 §7.8 で、探索の打ち切り閾値は端末性能に合わせて決めると書いた。
 * その基準値を得るためのものであり、最適化の効果を確認する場でもある。
 *
 * ここで作るのはランダム配置のマップで、実際に配る手作り・自動生成のマップより
 * ずっと難しい。主経路と関門で構造化されたマップは分岐がはるかに少ないので、
 * この数字は上限の目安として読むこと。
 */

import { compileMap, parseMapDef } from '../src/core/index.ts';
import { solve, verifyPlan } from '../src/solver/index.ts';
import type { CompiledMap, MapDef, PlacedObject } from '../src/core/index.ts';

function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomMap(seed: number, width: number, height: number, objectCount: number): CompiledMap {
  const random = rng(seed);
  const between = (min: number, max: number): number =>
    min + Math.floor(random() * (max - min + 1));

  const start = { x: 0, y: 0 };
  const goal = { x: width - 1, y: height - 1 };

  const terrain: string[] = [];
  for (let y = 0; y < height; y++) {
    let row = '';
    for (let x = 0; x < width; x++) {
      const reserved = (x === start.x && y === start.y) || (x === goal.x && y === goal.y);
      row += !reserved && random() < 0.15 ? '#' : '.';
    }
    terrain.push(row);
  }

  const free: { x: number; y: number }[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (terrain[y]![x] === '#') continue;
      if (x === start.x && y === start.y) continue;
      if (x === goal.x && y === goal.y) continue;
      free.push({ x, y });
    }
  }
  for (let i = free.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [free[i], free[j]] = [free[j]!, free[i]!];
  }

  const objects: PlacedObject[] = [];
  for (let i = 0; i < Math.min(objectCount, free.length); i++) {
    const at = free[i]!;
    const roll = random();

    if (roll < 0.45) {
      objects.push({
        type: 'enemy',
        ...at,
        hp: between(10, 80),
        atk: between(3, 18),
        def: between(0, 14),
        orb: 1,
      });
    } else if (roll < 0.85) {
      objects.push({
        type: 'item',
        ...at,
        effect: [
          { kind: 'atk', amount: between(1, 4) },
          { kind: 'def', amount: between(1, 3) },
          { kind: 'hp', amount: between(10, 40) },
          { kind: 'key', key: 'red', amount: 1 },
        ][between(0, 3)] as PlacedObject extends { effect: infer E } ? E : never,
      });
    } else {
      objects.push({ type: 'door', ...at, key: 'red' });
    }
  }

  const def: MapDef = {
    formatVersion: 1,
    id: `bench-${seed}`,
    name: 'benchmark',
    width,
    height,
    screen: { width, height },
    start,
    goal,
    player: { hp: between(80, 200), atk: between(8, 20), def: between(0, 6) },
    terrain,
    objects,
  };

  return compileMap(parseMapDef(def));
}

const CASES = [
  { width: 16, height: 16, objects: 30 },
  { width: 16, height: 16, objects: 45 },
  { width: 24, height: 24, objects: 60 },
  { width: 24, height: 24, objects: 80 },
];

const RUNS = 25;

console.log(`各条件 ${RUNS} マップ。時間はミリ秒。\n`);
console.log('マップ        物体  解けた  詰み  不明   平均    中央値   最悪   最大展開数');

for (const shape of CASES) {
  const durations: number[] = [];
  let solved = 0;
  let dead = 0;
  let unknown = 0;
  let maxExpanded = 0;

  for (let seed = 1; seed <= RUNS; seed++) {
    const map = randomMap(seed, shape.width, shape.height, shape.objects);

    const started = performance.now();
    const result = solve(map, { maxStates: 200_000 });
    durations.push(performance.now() - started);

    maxExpanded = Math.max(maxExpanded, result.stats.expanded);

    if (result.status === 'solved') {
      solved += 1;
      // 測るついでに検算する。速くなっても間違っていては意味がない。
      const verified = verifyPlan(map, result.plan ?? []);
      if (!verified.ok || verified.finalHp !== result.finalHp) {
        throw new Error(`seed ${seed}: 手順を再生できない (${JSON.stringify(verified)})`);
      }
    } else if (result.status === 'dead') {
      dead += 1;
    } else {
      unknown += 1;
    }
  }

  durations.sort((a, b) => a - b);
  const average = durations.reduce((sum, value) => sum + value, 0) / durations.length;
  const median = durations[Math.floor(durations.length / 2)] ?? 0;
  const worst = durations[durations.length - 1] ?? 0;

  const label = `${shape.width}x${shape.height}`.padEnd(12);
  console.log(
    `${label}  ${String(shape.objects).padStart(4)}  ${String(solved).padStart(6)}  ` +
      `${String(dead).padStart(4)}  ${String(unknown).padStart(4)}  ` +
      `${average.toFixed(1).padStart(7)}  ${median.toFixed(1).padStart(7)}  ` +
      `${worst.toFixed(0).padStart(5)}  ${String(maxExpanded).padStart(10)}`,
  );
}
