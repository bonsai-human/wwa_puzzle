/**
 * 生成の全体。設計 §8.2(6)(7)。
 *
 * 組み立て → ソルバーで検証 → 難易度を測る → 基準を満たすまで作り直す。
 *
 * 生成そのものは安く、検証が高い。だから合否は最後にまとめて判定し、
 * 落ちた原因に応じて次の試行のつまみを動かす。
 */

import { validateMapDef } from '../core/index.ts';
import type { CompiledMap, MapDef } from '../core/index.ts';
import type { DifficultyReport } from '../solver/difficulty.ts';
import { generateLayout } from './layout.ts';
import { DEFAULT_POPULATE, populate } from './populate.ts';
import type { PopulateOptions } from './populate.ts';
import { createRng } from './rng.ts';
import { tighten } from './repair.ts';

export interface GenerateOptions {
  readonly seed: number;
  readonly screensX?: number;
  readonly screensY?: number;
  readonly screenWidth?: number;
  readonly screenHeight?: number;
  /** 1つの種から何回まで組み直すか。 */
  readonly attempts?: number;
  /** 探索の予算。生成ループでは短く切る。 */
  readonly maxStates?: number;
  readonly criteria?: Partial<Criteria>;
}

export interface Criteria {
  /**
   * 使えるHP予算のうち、最適解が使い切っていなければならない割合。
   * 終了時HPの絶対値で測らないのは、初期HPも回復量もマップごとに違うため。
   */
  readonly minHpTightness: number;
  /** 貪欲法で解けてはいけない。 */
  readonly requireGreedyFails: boolean;
  /** 考えどころの下限。 */
  readonly minDecisionPoints: number;
  /** 解の手数の下限。 */
  readonly minCriticalPath: number;
}

export const DEFAULT_CRITERIA: Criteria = {
  minHpTightness: 0.7,
  requireGreedyFails: true,
  minDecisionPoints: 3,
  minCriticalPath: 8,
};

export interface Candidate {
  readonly def: MapDef;
  readonly map: CompiledMap;
  readonly report: DifficultyReport;
  /** 満たせなかった条件。空なら合格。 */
  readonly failures: readonly string[];
  readonly attempt: number;
}

export type GenerateResult =
  | { readonly ok: true; readonly candidate: Candidate; readonly attempts: number }
  /** 基準を満たすものが作れなかった。最も惜しかったものを返す。 */
  | { readonly ok: false; readonly best: Candidate | null; readonly attempts: number };

function checkCriteria(report: DifficultyReport, criteria: Criteria): string[] {
  const failures: string[] = [];

  if (report.status === 'dead') failures.push('解けない');
  if (report.status === 'unknown') failures.push('判定できず（予算切れ）');
  if (report.status !== 'solved') return failures;

  if (criteria.requireGreedyFails && !report.greedyFails) {
    failures.push('貪欲法で解けてしまう');
  }
  if (report.hpTightness !== null && report.hpTightness < criteria.minHpTightness) {
    failures.push(`余裕が大きすぎる（予算の ${Math.round(report.hpTightness * 100)}% しか使わない）`);
  }
  if (report.decisionPoints < criteria.minDecisionPoints) {
    failures.push(`考えどころが少ない（${report.decisionPoints}）`);
  }
  if (report.criticalPath !== null && report.criticalPath < criteria.minCriticalPath) {
    failures.push(`短すぎる（${report.criticalPath} 手）`);
  }

  return failures;
}

/** 落ちた原因に応じて、次の試行のつまみを動かす。 */
function adjust(options: PopulateOptions, failures: readonly string[]): PopulateOptions {
  let next = options;

  if (failures.some((failure) => failure.includes('余裕が大きすぎる'))) {
    // 関門を重くして、取り逃しが効くようにする。
    next = {
      ...next,
      gateCostRatio: [
        Math.min(0.75, next.gateCostRatio[0] + 0.05),
        Math.min(0.85, next.gateCostRatio[1] + 0.05),
      ],
    };
  }

  if (failures.some((failure) => failure.includes('貪欲法'))) {
    // 取ると損をする選択肢を増やす。
    next = { ...next, decoyChance: Math.min(1, next.decoyChance + 0.15) };
  }

  if (failures.some((failure) => failure.includes('解けない'))) {
    // 作りすぎた。関門を緩める。
    next = {
      ...next,
      gateCostRatio: [
        Math.max(0.15, next.gateCostRatio[0] - 0.08),
        Math.max(0.3, next.gateCostRatio[1] - 0.08),
      ],
    };
  }

  return next;
}

function score(report: DifficultyReport): number {
  if (report.status !== 'solved') return -1000;
  return (
    (report.greedyFails ? 100 : 0) +
    report.decisionPoints * 5 +
    (report.criticalPath ?? 0) +
    (report.hpTightness ?? 0) * 60
  );
}

export function generate(options: GenerateOptions): GenerateResult {
  const attempts = options.attempts ?? 24;
  const criteria = { ...DEFAULT_CRITERIA, ...options.criteria };
  const maxStates = options.maxStates ?? 60_000;

  let populateOptions = DEFAULT_POPULATE;
  let best: Candidate | null = null;

  for (let attempt = 0; attempt < attempts; attempt++) {
    // 試行ごとに種をずらす。同じ種からは必ず同じ結果が出る。
    const rng = createRng(options.seed * 1_000_003 + attempt);

    const layout = generateLayout(rng, {
      screensX: options.screensX ?? 2,
      screensY: options.screensY ?? 2,
      screenWidth: options.screenWidth ?? 16,
      screenHeight: options.screenHeight ?? 16,
    });

    let population;
    try {
      population = populate(rng, layout, populateOptions);
    } catch {
      continue;
    }

    const def: MapDef = {
      formatVersion: 1,
      id: `gen-${options.seed}-${attempt}`,
      name: `自動生成 ${options.seed}`,
      width: layout.width,
      height: layout.height,
      screen: layout.screen,
      start: population.start,
      goal: population.goal,
      player: population.player,
      terrain: layout.rows,
      objects: population.objects,
      meta: { seed: options.seed },
    };

    const validation = validateMapDef(def);
    if (!validation.ok) continue;

    // 組み立てただけでは余裕が読めないので、測ってから締める（§8.2(7)）。
    const repaired = tighten(validation.map, criteria.minHpTightness, {
      solve: { maxStates },
    });

    const map = repaired.map;
    const report = repaired.report;
    const failures = checkCriteria(report, criteria);
    const candidate: Candidate = { def: repaired.def, map, report, failures, attempt };

    if (failures.length === 0) return { ok: true, candidate, attempts: attempt + 1 };

    if (best === null || score(report) > score(best.report)) best = candidate;
    populateOptions = adjust(populateOptions, failures);
  }

  return { ok: false, best, attempts };
}
