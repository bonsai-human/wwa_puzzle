/**
 * `MapDef`（人間が書く形式）を、エンジンとソルバーが使う密な形式へ変換する。
 *
 * 文字列の鍵色は整数IDに、疎なオブジェクト配列はセル索引に、
 * 祭壇の交換肢は通し番号のスロットに畳む。
 * 探索の内側で文字列比較や連想配列引きが起きないようにするのが目的。
 */

import { createBitset } from './bitset.ts';
import { screenSize } from './mapdef.ts';
import type {
  AltarDef,
  AltarOption,
  DoorDef,
  EnemyDef,
  Effect,
  GameState,
  ItemDef,
  KeyColor,
  MapDef,
} from './types.ts';

export type CompiledEffect =
  | { readonly kind: 'hp' | 'atk' | 'def' | 'orb'; readonly amount: number }
  | { readonly kind: 'key'; readonly keyId: number; readonly amount: number }
  | { readonly kind: 'masterKey'; readonly amount: number };

export interface CompiledEnemy {
  readonly type: 'enemy';
  readonly cell: number;
  readonly source: EnemyDef;
  readonly hp: number;
  readonly atk: number;
  readonly def: number;
  readonly orb: number;
}

export interface CompiledItem {
  readonly type: 'item';
  readonly cell: number;
  readonly source: ItemDef;
  readonly effect: CompiledEffect;
}

export interface CompiledDoor {
  readonly type: 'door';
  readonly cell: number;
  readonly source: DoorDef;
  readonly keyId: number;
}

export interface CompiledAltar {
  readonly type: 'altar';
  readonly cell: number;
  readonly source: AltarDef;
  readonly altarIndex: number;
  /** この祭壇が持つ交換肢の、通し番号スロット。`GameState.altarUsed` の添字。 */
  readonly slots: readonly number[];
}

export type CompiledObject = CompiledEnemy | CompiledItem | CompiledDoor | CompiledAltar;

export interface CompiledOption {
  readonly slot: number;
  readonly altarIndex: number;
  readonly source: AltarOption;
  readonly cost: number;
  readonly effect: CompiledEffect;
  /** 交換回数の上限。無制限は `Infinity`。 */
  readonly stock: number;
}

export interface CompiledMap {
  readonly def: MapDef;

  readonly width: number;
  readonly height: number;
  readonly cellCount: number;
  /** 表示専用。ルールにも探索にも影響しない（設計 §3.7）。 */
  readonly screen: { readonly width: number; readonly height: number };

  readonly startCell: number;
  readonly goalCell: number;

  /** 1 = 壁。永久に不変。 */
  readonly walls: Uint8Array;
  /** セル → オブジェクト。無ければ `null`。 */
  readonly objectAt: readonly (CompiledObject | null)[];
  /** オブジェクトが存在するセルの一覧。 */
  readonly objectCells: Int32Array;

  /** 色ID → 色名。決定性のため名前順に固定する。 */
  readonly keyColors: readonly KeyColor[];
  readonly altars: readonly CompiledAltar[];
  readonly options: readonly CompiledOption[];

  readonly masterKeyMode: 'permanent' | 'wildcard';
  /** オーブの種別数。初版は 1（設計 §4 の注記）。 */
  readonly orbKinds: number;

  readonly initial: GameState;
}

/**
 * マップに登場する鍵色を集めて整数IDを割り当てる。
 * 出現順ではなく名前順にするのは、同じマップから必ず同じIDが得られるようにするため。
 * IDがぶれるとセーブデータと共有URLの互換が壊れる。
 */
function collectKeyColors(def: MapDef): KeyColor[] {
  const colors = new Set<KeyColor>();

  for (const color of Object.keys(def.player.keys ?? {})) colors.add(color);

  const addFromEffect = (effect: Effect): void => {
    if (effect.kind === 'key') colors.add(effect.key);
  };

  for (const object of def.objects) {
    switch (object.type) {
      case 'door':
        colors.add(object.key);
        break;
      case 'item':
        addFromEffect(object.effect);
        break;
      case 'altar':
        for (const option of object.options) addFromEffect(option.effect);
        break;
      case 'enemy':
        break;
    }
  }

  return [...colors].sort();
}

function compileEffect(effect: Effect, keyId: (color: KeyColor) => number): CompiledEffect {
  switch (effect.kind) {
    case 'key':
      return { kind: 'key', keyId: keyId(effect.key), amount: effect.amount };
    case 'masterKey':
      return { kind: 'masterKey', amount: effect.amount ?? 1 };
    default:
      return { kind: effect.kind, amount: effect.amount };
  }
}

/** 検証済みの `MapDef` を密な形式へ変換する。検証は {@link parseMapDef} が済ませている前提。 */
export function compileMap(def: MapDef): CompiledMap {
  const { width, height } = def;
  const cellCount = width * height;

  const keyColors = collectKeyColors(def);
  const keyIdByColor = new Map(keyColors.map((color, index) => [color, index]));
  const keyId = (color: KeyColor): number => keyIdByColor.get(color) ?? 0;

  const walls = new Uint8Array(cellCount);
  for (let y = 0; y < height; y++) {
    const row = def.terrain[y]!;
    for (let x = 0; x < width; x++) {
      if (row[x] === '#') walls[y * width + x] = 1;
    }
  }

  const objectAt: (CompiledObject | null)[] = new Array<CompiledObject | null>(cellCount).fill(
    null,
  );
  const objectCells: number[] = [];
  const altars: CompiledAltar[] = [];
  const options: CompiledOption[] = [];

  for (const placed of def.objects) {
    const cell = placed.y * width + placed.x;
    let compiled: CompiledObject;

    switch (placed.type) {
      case 'enemy':
        compiled = {
          type: 'enemy',
          cell,
          source: placed,
          hp: placed.hp,
          atk: placed.atk,
          def: placed.def,
          orb: placed.orb ?? 1,
        };
        break;

      case 'item':
        compiled = {
          type: 'item',
          cell,
          source: placed,
          effect: compileEffect(placed.effect, keyId),
        };
        break;

      case 'door':
        compiled = { type: 'door', cell, source: placed, keyId: keyId(placed.key) };
        break;

      case 'altar': {
        const altarIndex = altars.length;
        const slots: number[] = [];
        for (const option of placed.options) {
          const slot = options.length;
          slots.push(slot);
          options.push({
            slot,
            altarIndex,
            source: option,
            cost: option.cost,
            effect: compileEffect(option.effect, keyId),
            stock: option.stock ?? Number.POSITIVE_INFINITY,
          });
        }
        const altar: CompiledAltar = { type: 'altar', cell, source: placed, altarIndex, slots };
        altars.push(altar);
        compiled = altar;
        break;
      }
    }

    objectAt[cell] = compiled;
    objectCells.push(cell);
  }

  objectCells.sort((a, b) => a - b);

  const keys = new Int32Array(keyColors.length);
  for (const [color, count] of Object.entries(def.player.keys ?? {})) {
    const id = keyIdByColor.get(color);
    if (id !== undefined) keys[id] = count;
  }

  const orbKinds = 1;
  const orbs = new Int32Array(orbKinds);
  orbs[0] = def.player.orbs ?? 0;

  const masterKeyMode = def.masterKeyMode ?? 'permanent';
  const initialMasterKey = def.player.masterKey ?? 0;

  const initial: GameState = {
    pos: def.start.y * width + def.start.x,
    hp: def.player.hp,
    atk: def.player.atk,
    def: def.player.def,
    keys,
    orbs,
    // permanent モードではフラグなので 0/1 に潰す。
    masterKey: masterKeyMode === 'permanent' ? Math.min(initialMasterKey, 1) : initialMasterKey,
    consumed: createBitset(cellCount),
    altarUsed: new Int32Array(options.length),
  };

  return {
    def,
    width,
    height,
    cellCount,
    screen: screenSize(def),
    startCell: initial.pos,
    goalCell: def.goal.y * width + def.goal.x,
    walls,
    objectAt,
    objectCells: Int32Array.from(objectCells),
    keyColors,
    altars,
    options,
    masterKeyMode,
    orbKinds,
    initial,
  };
}
