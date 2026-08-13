/**
 * 同梱マップ。
 *
 * すべて `tests/maps.test.ts` が「解けること」を検証している。
 * 解けないマップを配ってしまうのは、このゲームでは最悪の不具合になる。
 * プレイヤーは詰みを自力で判別できないので、いつまでも解こうとしてしまう。
 */

import { compileMap, parseMapDef } from '../core/index.ts';
import type { CompiledMap } from '../core/index.ts';
import tutorial from './tutorial.json';
import descent from './descent.json';
import ruins from './ruins.json';

export const BUILTIN_MAP_DATA: readonly unknown[] = [tutorial, descent, ruins];

export interface MapEntry {
  readonly id: string;
  readonly name: string;
  readonly map: CompiledMap;
}

export function loadBuiltinMaps(): MapEntry[] {
  return BUILTIN_MAP_DATA.map((raw) => {
    const map = compileMap(parseMapDef(raw));
    return { id: map.def.id, name: map.def.name, map };
  });
}
