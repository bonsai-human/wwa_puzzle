/**
 * 探索 Worker のメインスレッド側の口。
 *
 * **中断は Worker の終了で行う。**
 *
 * 探索は同期ループなので、走っている間 Worker はメッセージを受け取れない。
 * 中断フラグを共有メモリに置く手も使えない。GitHub Pages では COOP/COEP を
 * 設定できず `SharedArrayBuffer` が無効だからである（設計 §10）。
 * 残る手段は Worker を終了して作り直すことで、起動コストは数ミリ秒なので
 * 編集のたびに投げ直す用途には十分足りる。
 */

import type { GameState, MapDef } from '../core/index.ts';
import type { DifficultyReport } from './difficulty.ts';
import type { WorkerRequest, WorkerResponse } from './protocol.ts';
import type { HintResult } from './types.ts';

export type SolveOutcome =
  | { readonly kind: 'done'; readonly report: DifficultyReport }
  | {
      readonly kind: 'generated';
      readonly map: MapDef;
      readonly report: DifficultyReport;
      readonly meetsCriteria: boolean;
      readonly failures: readonly string[];
    }
  | { readonly kind: 'hint'; readonly result: HintResult }
  | { readonly kind: 'invalid'; readonly issues: readonly string[] }
  | { readonly kind: 'error'; readonly message: string }
  /** 新しい要求に追い越された。呼び出し側は表示を変えなくてよい。 */
  | { readonly kind: 'superseded' };

export interface SolveHandlers {
  readonly onProgress?: (expanded: number) => void;
}

export class SolverClient {
  private worker: Worker | null = null;
  private nextId = 1;
  private settle: ((outcome: SolveOutcome) => void) | null = null;

  /**
   * マップを評価する。前の要求が走っていれば打ち切る。
   * 打ち切られた側の Promise は `superseded` で解決する。
   */
  request(map: unknown, options: { maxStates?: number } & SolveHandlers = {}): Promise<SolveOutcome> {
    return this.send((id) => ({
      id,
      kind: 'evaluate',
      map,
      ...(options.maxStates === undefined ? {} : { maxStates: options.maxStates }),
    }), options);
  }

  /**
   * マップを自動生成する。解き直しを何十回も含むので、評価より一桁重い。
   * メインスレッドで回すと1秒近く固まるため、必ずこちら経由で呼ぶ。
   */
  generate(
    request: { seed: number; screensX?: number; screensY?: number; attempts?: number },
    options: SolveHandlers = {},
  ): Promise<SolveOutcome> {
    return this.send((id) => ({
      id,
      kind: 'generate',
      seed: request.seed,
      ...(request.screensX === undefined ? {} : { screensX: request.screensX }),
      ...(request.screensY === undefined ? {} : { screensY: request.screensY }),
      ...(request.attempts === undefined ? {} : { attempts: request.attempts }),
    }), options);
  }

  /**
   * 現在の状態から、まだ解けるか・次に何をすべきかを問う。
   *
   * プレイヤーは詰みを難しさと区別できない。だから詰みの通知は
   * 親切機能ではなく、ゲームが成立するための部品になる（設計 §1 / §7.7）。
   */
  hint(map: unknown, state: GameState, options: { maxStates?: number } = {}): Promise<SolveOutcome> {
    return this.send((id) => ({
      id,
      kind: 'hint',
      map,
      state,
      ...(options.maxStates === undefined ? {} : { maxStates: options.maxStates }),
    }), {});
  }

  private send(
    build: (id: number) => WorkerRequest,
    options: SolveHandlers,
  ): Promise<SolveOutcome> {
    this.abort();

    const id = this.nextId++;
    const worker = this.spawn();

    return new Promise<SolveOutcome>((resolve) => {
      this.settle = resolve;

      worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        const message = event.data;
        if (message.id !== id) return;

        if (message.kind === 'progress') {
          options.onProgress?.(message.expanded);
          return;
        }

        this.settle = null;
        switch (message.kind) {
          case 'done':
            resolve({ kind: 'done', report: message.report });
            return;
          case 'hint':
            resolve({ kind: 'hint', result: message.result });
            return;
          case 'generated':
            resolve({
              kind: 'generated',
              map: message.map,
              report: message.report,
              meetsCriteria: message.meetsCriteria,
              failures: message.failures,
            });
            return;
          case 'invalid':
            resolve({ kind: 'invalid', issues: message.issues });
            return;
          default:
            resolve({ kind: 'error', message: message.message });
        }
      };

      worker.onerror = (event) => {
        this.settle = null;
        resolve({ kind: 'error', message: event.message || 'Worker が異常終了しました' });
      };

      worker.postMessage(build(id));
    });
  }

  /** 走っている探索を捨てる。 */
  abort(): void {
    if (this.worker !== null) {
      this.worker.terminate();
      this.worker = null;
    }
    const pending = this.settle;
    this.settle = null;
    pending?.({ kind: 'superseded' });
  }

  dispose(): void {
    this.abort();
  }

  private spawn(): Worker {
    // `import.meta.url` 経由で作ると、Vite が base を考慮したパスに解決する。
    // 文字列でパスを書くと GitHub Pages のサブパス配信で壊れる（設計 §10）。
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    this.worker = worker;
    return worker;
  }
}
