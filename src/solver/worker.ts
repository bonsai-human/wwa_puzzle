/**
 * 探索と生成を走らせる Web Worker。設計 §7.8。
 *
 * エディタは編集のたびに評価を呼ぶ。生成は解き直しを何十回も含むので
 * さらに重い。どちらもメインスレッドで回すと操作が固まる。
 */

import { compileMap, validateMapDef } from '../core/index.ts';
import { generate } from '../gen/index.ts';
import { evaluate } from './difficulty.ts';
import { hint } from './search.ts';
import type { WorkerRequest, WorkerResponse } from './protocol.ts';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

function reply(message: WorkerResponse): void {
  ctx.postMessage(message);
}

ctx.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;

  try {
    if (request.kind === 'generate') {
      const result = generate({
        seed: request.seed,
        ...(request.screensX === undefined ? {} : { screensX: request.screensX }),
        ...(request.screensY === undefined ? {} : { screensY: request.screensY }),
        ...(request.attempts === undefined ? {} : { attempts: request.attempts }),
        ...(request.maxStates === undefined ? {} : { maxStates: request.maxStates }),
      });

      // 基準に届かなくても、解けることは検証済みなので候補は返す。
      const candidate = result.ok ? result.candidate : result.best;
      if (candidate === null) {
        reply({ id: request.id, kind: 'error', message: '生成できませんでした' });
        return;
      }

      reply({
        id: request.id,
        kind: 'generated',
        map: candidate.def,
        report: candidate.report,
        meetsCriteria: result.ok,
        failures: candidate.failures,
      });
      return;
    }

    const validation = validateMapDef(request.map);
    if (!validation.ok) {
      reply({ id: request.id, kind: 'invalid', issues: validation.issues });
      return;
    }

    const map = compileMap(validation.map);

    if (request.kind === 'hint') {
      reply({
        id: request.id,
        kind: 'hint',
        result: hint(map, request.state, {
          ...(request.maxStates === undefined ? {} : { maxStates: request.maxStates }),
        }),
      });
      return;
    }

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
