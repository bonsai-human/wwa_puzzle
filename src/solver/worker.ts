/**
 * 探索を走らせる Web Worker。設計 §7.8。
 *
 * エディタは編集のたびにこれを呼ぶ。数百ミリ秒かかることがあるので、
 * メインスレッドで回すと入力が固まる。
 */

import { compileMap, validateMapDef } from '../core/index.ts';
import { evaluate } from './difficulty.ts';
import type { SolveRequest, WorkerResponse } from './protocol.ts';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

function reply(message: WorkerResponse): void {
  ctx.postMessage(message);
}

ctx.addEventListener('message', (event: MessageEvent<SolveRequest>) => {
  const request = event.data;

  try {
    const validation = validateMapDef(request.map);
    if (!validation.ok) {
      reply({ id: request.id, kind: 'invalid', issues: validation.issues });
      return;
    }

    const map = compileMap(validation.map);
    const report = evaluate(map, {
      ...(request.maxStates === undefined ? {} : { maxStates: request.maxStates }),
      // 無反応の時間を作らないよう、途中経過を返す。
      onProgress: (stats) => reply({ id: request.id, kind: 'progress', expanded: stats.expanded }),
      progressInterval: 4_000,
    });

    reply({ id: request.id, kind: 'done', report });
  } catch (error) {
    reply({
      id: request.id,
      kind: 'error',
      message: error instanceof Error ? error.message : String(error),
    });
  }
});
