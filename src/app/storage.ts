/**
 * 進行状況の保存。設計 §10。
 *
 * サーバーが無いのでブラウザのローカル保存を使う。ただしモバイルの
 * ブラウザはこれを予告なく破棄することがあるので、**書き出しと読み込みを
 * 必ず用意する**。localStorage だけに頼ると、消えたときに手立てが無い。
 */

import type { GameState } from '../core/index.ts';

const PREFIX = 'wwa_puzzle';
/** 配信パスごとに分ける。同じドメインに別の版が載っても混ざらないように。 */
const SCOPE = typeof window === 'undefined' ? '/' : window.location.pathname;

export interface SavedState {
  readonly pos: number;
  readonly hp: number;
  readonly atk: number;
  readonly def: number;
  readonly keys: readonly number[];
  readonly orbs: readonly number[];
  readonly masterKey: number;
  readonly consumed: readonly number[];
  readonly altarUsed: readonly number[];
}

export interface SavedProgress {
  readonly version: 1;
  readonly mapId: string;
  /** 履歴。末尾が現在。undo をまたいで復元できるよう全部持つ。 */
  readonly history: readonly SavedState[];
  readonly visitedScreens: readonly number[];
  readonly savedAt: number;
}

export function serializeState(state: GameState): SavedState {
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

export function deserializeState(saved: SavedState): GameState {
  return {
    pos: saved.pos,
    hp: saved.hp,
    atk: saved.atk,
    def: saved.def,
    keys: Int32Array.from(saved.keys),
    orbs: Int32Array.from(saved.orbs),
    masterKey: saved.masterKey,
    consumed: Uint32Array.from(saved.consumed),
    altarUsed: Int32Array.from(saved.altarUsed),
  };
}

function keyFor(mapId: string): string {
  return `${PREFIX}:${SCOPE}:progress:${mapId}`;
}

export function saveProgress(progress: SavedProgress): boolean {
  try {
    window.localStorage.setItem(keyFor(progress.mapId), JSON.stringify(progress));
    return true;
  } catch {
    // 容量超過やプライベートモードでは書けない。遊べなくなるわけではないので黙って諦める。
    return false;
  }
}

export function loadProgress(mapId: string): SavedProgress | null {
  try {
    const raw = window.localStorage.getItem(keyFor(mapId));
    if (raw === null) return null;

    const parsed: unknown = JSON.parse(raw);
    return isProgress(parsed) && parsed.mapId === mapId ? parsed : null;
  } catch {
    return null;
  }
}

export function clearProgress(mapId: string): void {
  try {
    window.localStorage.removeItem(keyFor(mapId));
  } catch {
    // 消せなくても実害はない。
  }
}

/**
 * 保存データの形を確かめる。
 *
 * 自分が書いたものでも、版が違えば形が違う。壊れたデータで
 * 復元しようとすると盤面が破綻するので、疑わしいものは捨てる。
 */
export function isProgress(value: unknown): value is SavedProgress {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;

  return (
    candidate['version'] === 1 &&
    typeof candidate['mapId'] === 'string' &&
    Array.isArray(candidate['history']) &&
    candidate['history'].length > 0 &&
    candidate['history'].every(isSavedState) &&
    Array.isArray(candidate['visitedScreens'])
  );
}

function isSavedState(value: unknown): value is SavedState {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;

  const numbers = ['pos', 'hp', 'atk', 'def', 'masterKey'];
  const arrays = ['keys', 'orbs', 'consumed', 'altarUsed'];

  return (
    numbers.every((field) => typeof candidate[field] === 'number') &&
    arrays.every(
      (field) =>
        Array.isArray(candidate[field]) &&
        (candidate[field] as unknown[]).every((entry) => typeof entry === 'number'),
    )
  );
}
