import { describe, expect, it } from 'vitest';
import { battleCost, compileMap, initialState, parseMapDef, xOf, yOf } from '../src/core/index.ts';
import { greedyClears, solve, verifyPlan } from '../src/solver/index.ts';
import { createRng, generate, generateLayout, populate, DEFAULT_POPULATE } from '../src/gen/index.ts';

/**
 * 自動生成。設計 §8。
 *
 * 生成器に求める性質は2つある。
 *   1. 出したマップが**必ず解ける**こと。組み立ての順序がこれを保証している
 *      （先に解を作り、それが成立するように盤面を組む）ので、破れていたら
 *      構築のどこかが壊れている。
 *   2. 同じ種から同じマップが出ること。良いマップを再現できないと調整ができない。
 */

const SEEDS = [1, 2, 3, 5, 8, 13, 21, 34];

describe('骨格', () => {
  it('主経路の画面がすべて異なり、隣接している', () => {
    for (const seed of SEEDS) {
      const layout = generateLayout(createRng(seed), {
        screensX: 2,
        screensY: 2,
        screenWidth: 16,
        screenHeight: 16,
      });

      const seen = new Set<string>();
      for (const screen of layout.path) {
        const key = `${screen.x},${screen.y}`;
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }

      for (let i = 0; i + 1 < layout.path.length; i++) {
        const a = layout.path[i]!;
        const b = layout.path[i + 1]!;
        expect(Math.abs(a.x - b.x) + Math.abs(a.y - b.y)).toBe(1);
      }
    }
  });

  it('関門は画面の境界に置かれる', () => {
    // 開口部をそのまま関門にするのが骨格生成の狙い（設計 §8.2）。
    const layout = generateLayout(createRng(7), {
      screensX: 2,
      screensY: 2,
      screenWidth: 16,
      screenHeight: 16,
    });

    for (const passage of layout.gates) {
      const x = passage.gate % layout.width;
      const y = Math.floor(passage.gate / layout.width);
      const onVerticalEdge = x % layout.screen.width === 0 || x % layout.screen.width === layout.screen.width - 1;
      const onHorizontalEdge =
        y % layout.screen.height === 0 || y % layout.screen.height === layout.screen.height - 1;

      expect(onVerticalEdge || onHorizontalEdge).toBe(true);
    }
  });
});

describe('配置', () => {
  it('組み立てただけのマップも検証を通る', () => {
    for (const seed of SEEDS) {
      const rng = createRng(seed);
      const layout = generateLayout(rng, {
        screensX: 2,
        screensY: 2,
        screenWidth: 16,
        screenHeight: 16,
      });
      const population = populate(rng, layout, DEFAULT_POPULATE);

      expect(() =>
        parseMapDef({
          formatVersion: 1,
          id: `t-${seed}`,
          name: 't',
          width: layout.width,
          height: layout.height,
          screen: layout.screen,
          start: population.start,
          goal: population.goal,
          player: population.player,
          terrain: layout.rows,
          objects: population.objects,
        }),
      ).not.toThrow();
    }
  });
});

describe('生成', () => {
  const results = SEEDS.map((seed) => ({ seed, result: generate({ seed, attempts: 24 }) }));

  it('出したマップは必ず解ける', () => {
    // 基準に届かなかった場合も、返す候補は解けるものでなければならない。
    for (const { seed, result } of results) {
      const candidate = result.ok ? result.candidate : result.best;
      expect(candidate, `seed ${seed}`).not.toBeNull();
      if (candidate === null) continue;

      expect(candidate.report.status, `seed ${seed}`).toBe('solved');
    }
  });

  it('出した手順をエンジンで再生するとゴールに着く', () => {
    for (const { seed, result } of results) {
      const candidate = result.ok ? result.candidate : result.best;
      if (candidate === null) continue;

      const solved = solve(candidate.map);
      expect(solved.plan, `seed ${seed}`).not.toBeNull();
      expect(verifyPlan(candidate.map, solved.plan ?? []), `seed ${seed}`).toMatchObject({
        ok: true,
      });
    }
  });

  it('合格したマップは貪欲法では解けない', () => {
    // 「解決できるものを片端から解決する」で解けるマップは、
    // どれだけ大きくても考える必要がない（設計 §8.3）。
    for (const { seed, result } of results) {
      if (!result.ok) continue;
      expect(greedyClears(result.candidate.map), `seed ${seed}`).toBe(false);
    }
  });

  it('大半の種で基準を満たす', () => {
    const passed = results.filter(({ result }) => result.ok).length;
    expect(passed).toBeGreaterThanOrEqual(Math.ceil(SEEDS.length * 0.6));
  });

  it('開始画面の敵が最初から全部「攻撃不能」にはならない', () => {
    /**
     * オーブ源の敵をアイテム配布より後に設計すると、強化後の攻撃力を基準に
     * 防御力が決まり、その画面に着いた時点では手も足も出ない見た目になる。
     * 解けはするが、最初の画面でこれが起きると盤面が壊れているようにしか見えない。
     */
    for (const { seed, result } of results) {
      const candidate = result.ok ? result.candidate : result.best;
      if (candidate === null) continue;

      const map = candidate.map;
      const state = initialState(map);
      const screenX = Math.floor(xOf(map, state.pos) / map.screen.width);
      const screenY = Math.floor(yOf(map, state.pos) / map.screen.height);

      const onStartScreen = [...map.objectCells]
        .map((cell) => map.objectAt[cell] ?? null)
        .filter((object) => object !== null && object.type === 'enemy')
        .filter(
          (enemy) =>
            Math.floor(xOf(map, enemy!.cell) / map.screen.width) === screenX &&
            Math.floor(yOf(map, enemy!.cell) / map.screen.height) === screenY,
        );

      if (onStartScreen.length === 0) continue;
      const beatable = onStartScreen.some((enemy) =>
        enemy !== null && enemy.type === 'enemy' ? battleCost(state, enemy) !== null : false,
      );
      expect(beatable, `seed ${seed}`).toBe(true);
    }
  });

  // 生成を2回まわす。既定は 3×3 画面・約200物体なので、既定の5秒には収まらない。
  it('同じ種からは同じマップが出る', { timeout: 30_000 }, () => {
    const first = generate({ seed: 99, attempts: 8 });
    const second = generate({ seed: 99, attempts: 8 });

    const left = first.ok ? first.candidate.def : first.best?.def;
    const right = second.ok ? second.candidate.def : second.best?.def;

    expect(left).toEqual(right);
  });

  it('生成した盤面が薄くない', () => {
    // 歩ける床のうち何割が埋まっているかで見る。同梱マップ側でも同じ規則。
    for (const { seed, result } of results) {
      const candidate = result.ok ? result.candidate : result.best;
      if (candidate === null) continue;

      const def = candidate.def;
      let floor = 0;
      for (const row of def.terrain) for (const cell of row) if (cell === '.') floor += 1;

      expect(def.objects.length / floor, `seed ${seed}`).toBeGreaterThanOrEqual(0.15);
    }
  });

  it('物体が画面のあちこちに散らばっている', () => {
    /**
     * 一様乱数で置き場所を選ぶと、床の2割を埋める程度の物量では必ずどこかに固まり、
     * 部屋の一角がまるごと空く。「物を増やしたのに薄い部屋がある」という見え方になる。
     *
     * 物体を含む画面について、画面を4分割したどの区画にも何かがあることを見る。
     */
    for (const { seed, result } of results) {
      const candidate = result.ok ? result.candidate : result.best;
      if (candidate === null) continue;

      const def = candidate.def;
      const quadrants = new Map<string, Set<number>>();
      const counts = new Map<string, number>();

      for (const object of def.objects) {
        const screen = `${Math.floor(object.x / def.screen!.width)},${Math.floor(object.y / def.screen!.height)}`;
        const half = (value: number, size: number): number => (value % size < size / 2 ? 0 : 1);
        const quadrant =
          half(object.x, def.screen!.width) + 2 * half(object.y, def.screen!.height);

        if (!quadrants.has(screen)) quadrants.set(screen, new Set());
        quadrants.get(screen)!.add(quadrant);
        counts.set(screen, (counts.get(screen) ?? 0) + 1);
      }

      for (const [screen, seen] of quadrants) {
        // 物体が少ない画面まで問うても意味がない。
        if ((counts.get(screen) ?? 0) < 12) continue;
        expect(seen.size, `seed ${seed} 画面 ${screen}`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('同じものがかたまりで置かれている', () => {
    /**
     * 1個ずつ散らすと、物量を増やしても「散らかっている」だけになる。
     * 横に2つ以上並んだ同種の組がいくつあるかで、かたまりになっているかを見る。
     */
    for (const { seed, result } of results) {
      const candidate = result.ok ? result.candidate : result.best;
      if (candidate === null) continue;

      const at = new Map<string, string>();
      for (const object of candidate.def.objects) {
        // 効果や強さまで含めて「同じもの」とみなす。位置だけ除く。
        const { x, y, ...rest } = object;
        at.set(`${x},${y}`, JSON.stringify(rest));
      }

      let runs = 0;
      for (const [key, signature] of at) {
        const [x, y] = key.split(',').map(Number) as [number, number];
        // 並びの先頭だけ数える。
        if (at.get(`${x - 1},${y}`) === signature) continue;
        if (at.get(`${x + 1},${y}`) === signature) runs += 1;
      }

      expect(runs, `seed ${seed}`).toBeGreaterThanOrEqual(10);
    }
  });

  it('防御アイテムは並べて置かない', () => {
    /**
     * 防御は敵1体ぶんではなく、盤面の敵すべての攻撃から引かれる。
     * 並べて置くと敵がまとめて無害になり、締める対象そのものが消える。
     * 実測では防御が24まで育ち、解の全行程でHPを取る敵が1体しか残らなかった。
     */
    for (const { seed, result } of results) {
      const candidate = result.ok ? result.candidate : result.best;
      if (candidate === null) continue;

      const shields = new Set(
        candidate.def.objects
          .filter((object) => object.type === 'item' && object.effect.kind === 'def')
          .map((object) => `${object.x},${object.y}`),
      );

      for (const key of shields) {
        const [x, y] = key.split(',').map(Number) as [number, number];
        expect(shields.has(`${x + 1},${y}`), `seed ${seed} (${x}, ${y})`).toBe(false);
      }
    }
  });

  it('生成物のオブジェクトが壁や開始位置に重ならない', () => {
    for (const { seed, result } of results) {
      const candidate = result.ok ? result.candidate : result.best;
      if (candidate === null) continue;

      // 検証を通っている＝重複も壁上配置も無い。読み直して二重に確かめる。
      expect(() => compileMap(parseMapDef(candidate.def)), `seed ${seed}`).not.toThrow();
    }
  });
});
