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

import type { DifficultyReport } from './difficulty.ts';
import type { SolveRequest, WorkerResponse } from './protocol.ts';

export type SolveOutcome =
  | { readonly kind: 'done'; readonly report: DifficultyReport }
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
        resolve(
          message.kind === 'done'
            ? { kind: 'done', report: message.report }
            : message.kind === 'invalid'
              ? { kind: 'invalid', issues: message.issues }
              : { kind: 'error', message: message.message },
        );
      };

      worker.onerror = (event) => {
        this.settle = null;
        resolve({ kind: 'error', message: event.message || 'Worker が異常終了しました' });
      };

      const request: SolveRequest = {
        id,
        map,
        ...(options.maxStates === undefined ? {} : { maxStates: options.maxStates }),
      };
      worker.postMessage(request);
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
