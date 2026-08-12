/** メインスレッドと探索 Worker のやり取り。 */

import type { DifficultyReport } from './difficulty.ts';

export interface SolveRequest {
  readonly id: number;
  /** 検証前の `MapDef`。Worker 側で検証と変換を行う。 */
  readonly map: unknown;
  readonly maxStates?: number;
}

export type WorkerResponse =
  | { readonly id: number; readonly kind: 'progress'; readonly expanded: number }
  | { readonly id: number; readonly kind: 'done'; readonly report: DifficultyReport }
  | { readonly id: number; readonly kind: 'invalid'; readonly issues: readonly string[] }
  | { readonly id: number; readonly kind: 'error'; readonly message: string };
