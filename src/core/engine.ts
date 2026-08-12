/**
 * ルールエンジン。設計 §3。
 *
 * すべて純粋関数として書く。状態を書き換えず、新しい状態を返す。
 * 失敗した場合は状態を一切変化させない（設計 §3.1：進入に失敗してもHPは減らない）。
 */

import { battle } from './combat.ts';
import { hasBit, setBit } from './bitset.ts';
import type {
  CompiledAltar,
  CompiledDoor,
  CompiledEffect,
  CompiledEnemy,
  CompiledItem,
  CompiledMap,
  CompiledOption,
} from './compile.ts';
import type { GameState } from './types.ts';

export type Direction = 'up' | 'down' | 'left' | 'right';

const DELTA: Readonly<Record<Direction, readonly [number, number]>> = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
};

/** 進入できない理由。UIはこれを必ず提示する（設計 §11.8）。 */
export type BlockReason =
  | { readonly kind: 'outOfBounds' }
  | { readonly kind: 'wall' }
  /** 攻撃力が敵の防御力以下。永久に通過できない。 */
  | { readonly kind: 'unbeatable'; readonly enemy: CompiledEnemy }
  /** 倒せはするがHPが足りない。戦闘は発生しない。 */
  | { readonly kind: 'insufficientHp'; readonly enemy: CompiledEnemy; readonly cost: number }
  | { readonly kind: 'noKey'; readonly door: CompiledDoor };

/** 進入したときに起きること。 */
export type EnterOutcome =
  | { readonly kind: 'move' }
  | { readonly kind: 'item'; readonly item: CompiledItem }
  | {
      readonly kind: 'battle';
      readonly enemy: CompiledEnemy;
      readonly hits: number;
      readonly cost: number;
    }
  | { readonly kind: 'door'; readonly door: CompiledDoor; readonly usedMasterKey: boolean }
  /** 祭壇に乗った。消費はされず、交換メニューが開く。 */
  | { readonly kind: 'altar'; readonly altar: CompiledAltar };

export type EnterCheck =
  | { readonly ok: true; readonly outcome: EnterOutcome }
  | { readonly ok: false; readonly reason: BlockReason };

export type EnterResult =
  | { readonly ok: true; readonly state: GameState; readonly outcome: EnterOutcome }
  | { readonly ok: false; readonly reason: BlockReason };

export type ExchangeBlock =
  /** 祭壇のマスに立っていない。 */
  | { readonly kind: 'notAtAltar' }
  | { readonly kind: 'outOfStock'; readonly option: CompiledOption }
  | {
      readonly kind: 'insufficientOrbs';
      readonly option: CompiledOption;
      readonly cost: number;
      readonly have: number;
    };

export type ExchangeCheck =
  | { readonly ok: true; readonly option: CompiledOption }
  | { readonly ok: false; readonly reason: ExchangeBlock };

export type ExchangeResult =
  | { readonly ok: true; readonly state: GameState; readonly option: CompiledOption }
  | { readonly ok: false; readonly reason: ExchangeBlock };

export function cellOf(map: CompiledMap, x: number, y: number): number {
  return y * map.width + x;
}

export function xOf(map: CompiledMap, cell: number): number {
  return cell % map.width;
}

export function yOf(map: CompiledMap, cell: number): number {
  return Math.floor(cell / map.width);
}

export function cloneState(state: GameState): GameState {
  return {
    pos: state.pos,
    hp: state.hp,
    atk: state.atk,
    def: state.def,
    keys: Int32Array.from(state.keys),
    orbs: Int32Array.from(state.orbs),
    masterKey: state.masterKey,
    consumed: Uint32Array.from(state.consumed),
    altarUsed: Int32Array.from(state.altarUsed),
  };
}

export function initialState(map: CompiledMap): GameState {
  return cloneState(map.initial);
}

export function isConsumed(state: GameState, cell: number): boolean {
  return hasBit(state.consumed, cell);
}

export function isWall(map: CompiledMap, cell: number): boolean {
  return map.walls[cell] === 1;
}

/**
 * 追加の解決なしに立ち入れるセルか。
 *
 * 祭壇は消費されないが、常に通行可能として扱う（設計 §3.5：到達可能である限り
 * 何度でも利用できる）。これにより祭壇は自由領域の内側に入り、
 * ソルバーは「領域内の祭壇で交換する」をマクロ行動として扱える（§7.2）。
 */
export function isPassable(map: CompiledMap, state: GameState, cell: number): boolean {
  if (isWall(map, cell)) return false;
  const object = map.objectAt[cell] ?? null;
  if (object === null) return true;
  if (object.type === 'altar') return true;
  return isConsumed(state, cell);
}

export function isGoal(map: CompiledMap, state: GameState): boolean {
  return state.pos === map.goalCell;
}

/** 効果を適用する。呼び出し側が所有する下書き状態を直接書き換える。 */
function applyEffect(map: CompiledMap, draft: GameState, effect: CompiledEffect): void {
  switch (effect.kind) {
    case 'hp':
      draft.hp += effect.amount;
      break;
    case 'atk':
      draft.atk += effect.amount;
      break;
    case 'def':
      draft.def += effect.amount;
      break;
    case 'orb':
      draft.orbs[0]! += effect.amount;
      break;
    case 'key':
      draft.keys[effect.keyId]! += effect.amount;
      break;
    case 'masterKey':
      // permanent モードでは枚数ではなく恒久フラグ（設計 §3.4）。
      draft.masterKey =
        map.masterKeyMode === 'permanent' ? 1 : draft.masterKey + effect.amount;
      break;
  }
}

/** 扉を開けるのに何を使うか。使えるものが無ければ `null`。 */
function resolveDoorKey(
  map: CompiledMap,
  state: GameState,
  door: CompiledDoor,
): 'master' | 'color' | null {
  if (map.masterKeyMode === 'permanent') {
    // 恒久マスターキーは無償なので、色鍵を温存できる分だけ常に優れる。
    if (state.masterKey >= 1) return 'master';
    return (state.keys[door.keyId] ?? 0) > 0 ? 'color' : null;
  }

  // wildcard モードでは色鍵を優先する。厳密には分岐だが、探索が膨らむため
  // 簡約している（設計 §3.4）。
  if ((state.keys[door.keyId] ?? 0) > 0) return 'color';
  return state.masterKey > 0 ? 'master' : null;
}

/**
 * セルへ進入できるかを調べる。状態は変化させない。
 * UIの「選択したら何が起きるか」表示（設計 §11.1）はこれを使う。
 */
export function checkEnter(map: CompiledMap, state: GameState, cell: number): EnterCheck {
  if (cell < 0 || cell >= map.cellCount) return { ok: false, reason: { kind: 'outOfBounds' } };
  if (isWall(map, cell)) return { ok: false, reason: { kind: 'wall' } };

  const object = map.objectAt[cell] ?? null;
  if (object === null || isConsumed(state, cell)) {
    return { ok: true, outcome: { kind: 'move' } };
  }

  switch (object.type) {
    case 'altar':
      return { ok: true, outcome: { kind: 'altar', altar: object } };

    case 'item':
      return { ok: true, outcome: { kind: 'item', item: object } };

    case 'enemy': {
      const result = battle(state, object);
      if (result.outcome === 'unbeatable') {
        return { ok: false, reason: { kind: 'unbeatable', enemy: object } };
      }
      if (result.outcome === 'unaffordable') {
        return {
          ok: false,
          reason: { kind: 'insufficientHp', enemy: object, cost: result.cost },
        };
      }
      return {
        ok: true,
        outcome: { kind: 'battle', enemy: object, hits: result.hits, cost: result.cost },
      };
    }

    case 'door': {
      const usable = resolveDoorKey(map, state, object);
      if (usable === null) return { ok: false, reason: { kind: 'noKey', door: object } };
      return { ok: true, outcome: { kind: 'door', door: object, usedMasterKey: usable === 'master' } };
    }
  }
}

/**
 * セルへ進入して解決する。成功すれば新しい状態を返す。
 *
 * 隣接判定はしない。「このセルを解決して、そこに立つ」という低レベル操作である。
 * 到達可能性の保証は呼び出し側の責任で、UIは自動経路探索が、
 * ソルバーは自由領域のフロンティア列挙が、それぞれ担保する。
 * 1マスずつ動かしたい場合は {@link step} を使う。
 */
export function enter(map: CompiledMap, state: GameState, cell: number): EnterResult {
  const check = checkEnter(map, state, cell);
  if (!check.ok) return check;

  const draft = cloneState(state);
  const outcome = check.outcome;

  switch (outcome.kind) {
    case 'move':
    case 'altar':
      break;

    case 'item':
      applyEffect(map, draft, outcome.item.effect);
      setBit(draft.consumed, cell);
      break;

    case 'battle':
      draft.hp -= outcome.cost;
      draft.orbs[0]! += outcome.enemy.orb;
      setBit(draft.consumed, cell);
      break;

    case 'door':
      if (outcome.usedMasterKey) {
        // permanent モードのマスターキーは消費しない。
        if (map.masterKeyMode === 'wildcard') draft.masterKey -= 1;
      } else {
        draft.keys[outcome.door.keyId]! -= 1;
      }
      setBit(draft.consumed, cell);
      break;
  }

  draft.pos = cell;
  return { ok: true, state: draft, outcome };
}

/** 隣接する1マスへ移動する。移動先の解決に失敗した場合は状態を変えない。 */
export function step(map: CompiledMap, state: GameState, direction: Direction): EnterResult {
  const [dx, dy] = DELTA[direction];
  const x = xOf(map, state.pos) + dx;
  const y = yOf(map, state.pos) + dy;

  if (x < 0 || x >= map.width || y < 0 || y >= map.height) {
    return { ok: false, reason: { kind: 'outOfBounds' } };
  }
  return enter(map, state, cellOf(map, x, y));
}

/** 祭壇での交換が可能かを調べる。祭壇のマスに立っていることが条件。 */
export function checkExchange(map: CompiledMap, state: GameState, slot: number): ExchangeCheck {
  const option = map.options[slot];
  if (option === undefined) return { ok: false, reason: { kind: 'notAtAltar' } };

  const altar = map.altars[option.altarIndex];
  if (altar === undefined || state.pos !== altar.cell) {
    return { ok: false, reason: { kind: 'notAtAltar' } };
  }

  if ((state.altarUsed[slot] ?? 0) >= option.stock) {
    return { ok: false, reason: { kind: 'outOfStock', option } };
  }

  const have = state.orbs[0] ?? 0;
  if (have < option.cost) {
    return { ok: false, reason: { kind: 'insufficientOrbs', option, cost: option.cost, have } };
  }

  return { ok: true, option };
}

/** 祭壇でオーブを交換する。 */
export function exchange(map: CompiledMap, state: GameState, slot: number): ExchangeResult {
  const check = checkExchange(map, state, slot);
  if (!check.ok) return check;

  const draft = cloneState(state);
  draft.orbs[0]! -= check.option.cost;
  draft.altarUsed[slot]! += 1;
  applyEffect(map, draft, check.option.effect);

  return { ok: true, state: draft, option: check.option };
}
