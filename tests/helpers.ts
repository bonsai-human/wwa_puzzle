import { compileMap, parseMapDef } from '../src/core/index.ts';
import type { CompiledMap, GameState, MapDef, MasterKeyMode, PlacedObject } from '../src/core/index.ts';

export interface MapOptions {
  /** 地形。'.' = 床、'#' = 壁。行の長さは揃えること。 */
  readonly terrain: readonly string[];
  readonly objects?: readonly PlacedObject[];
  readonly start?: { readonly x: number; readonly y: number };
  readonly goal?: { readonly x: number; readonly y: number };
  readonly player?: {
    readonly hp?: number;
    readonly atk?: number;
    readonly def?: number;
    readonly keys?: Readonly<Record<string, number>>;
    readonly orbs?: number;
    readonly masterKey?: number;
  };
  readonly masterKeyMode?: MasterKeyMode;
}

/**
 * テスト用のマップを組み立てる。
 * `screen` はマップ全体と同じにして、画面分割の割り切れ条件を気にせず書けるようにする。
 */
export function makeMap(options: MapOptions): CompiledMap {
  const height = options.terrain.length;
  const width = options.terrain[0]?.length ?? 0;
  const player = options.player ?? {};

  const raw: MapDef = {
    formatVersion: 1,
    id: 'test',
    name: 'test',
    width,
    height,
    screen: { width, height },
    start: options.start ?? { x: 0, y: 0 },
    goal: options.goal ?? { x: width - 1, y: height - 1 },
    player: {
      hp: player.hp ?? 100,
      atk: player.atk ?? 10,
      def: player.def ?? 0,
      ...(player.keys === undefined ? {} : { keys: player.keys }),
      ...(player.orbs === undefined ? {} : { orbs: player.orbs }),
      ...(player.masterKey === undefined ? {} : { masterKey: player.masterKey }),
    },
    ...(options.masterKeyMode === undefined ? {} : { masterKeyMode: options.masterKeyMode }),
    terrain: [...options.terrain],
    objects: [...(options.objects ?? [])],
  };

  return compileMap(parseMapDef(raw));
}

/** 検証済みの生データからマップを読み込む。 */
export function loadMap(raw: unknown): CompiledMap {
  return compileMap(parseMapDef(raw));
}

/** 状態を比較可能なプレーンオブジェクトに落とす。 */
export function snapshot(state: GameState): Record<string, unknown> {
  return {
    pos: state.pos,
    hp: state.hp,
    atk: state.atk,
    def: state.def,
    keys: [...state.keys],
    orbs: [...state.orbs],
    masterKey: state.masterKey,
    consumed: [...state.consumed],
    altarUsed: [...state.altarUsed],
  };
}
