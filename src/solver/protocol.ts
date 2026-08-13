/** メインスレッドと Worker のやり取り。 */

import type { MapDef } from '../core/index.ts';
import type { DifficultyReport } from './difficulty.ts';

export interface EvaluateRequest {
  readonly id: number;
  readonly kind: 'evaluate';
  /** 検証前の `MapDef`。Worker 側で検証と変換を行う。 */
  readonly map: unknown;
  readonly maxStates?: number;
}

export interface GenerateRequest {
  readonly id: number;
  readonly kind: 'generate';
  readonly seed: number;
  readonly screensX?: number;
  readonly screensY?: number;
  readonly attempts?: number;
  readonly maxStates?: number;
}

export type WorkerRequest = EvaluateRequest | GenerateRequest;

export type WorkerResponse =
  | { readonly id: number; readonly kind: 'progress'; readonly expanded: number }
  | { readonly id: number; readonly kind: 'done'; readonly report: DifficultyReport }
  | {
      readonly id: number;
      readonly kind: 'generated';
      readonly map: MapDef;
      readonly report: DifficultyReport;
      /** 基準を満たしたか。false でも遊べるマップではある。 */
      readonly meetsCriteria: boolean;
      readonly failures: readonly string[];
    }
  | { readonly id: number; readonly kind: 'invalid'; readonly issues: readonly string[] }
  | { readonly id: number; readonly kind: 'error'; readonly message: string };
