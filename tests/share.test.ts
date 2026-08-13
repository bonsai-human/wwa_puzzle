import { describe, expect, it } from 'vitest';
import { compileMap, initialState, parseMapDef } from '../src/core/index.ts';
import { MAX_SHARE_LENGTH, decodeMap, encodeMap, parseRoute } from '../src/app/share.ts';
import {
  deserializeState,
  isProgress,
  serializeState,
  type SavedProgress,
} from '../src/app/storage.ts';
import { BUILTIN_MAP_DATA } from '../src/maps/index.ts';
import type { MapDef } from '../src/core/index.ts';

/**
 * 共有と保存。設計 §10。
 *
 * どちらもサーバーが無いことへの対処であり、外から来たデータを読む口になる。
 * 壊れた入力で画面が止まらないこと、そして黙って別物を読まないことを確かめる。
 */

const maps = BUILTIN_MAP_DATA.map((raw) => parseMapDef(raw));

describe('共有URL', () => {
  it('往復して同じマップに戻る', async () => {
    for (const def of maps) {
      const restored = await decodeMap(await encodeMap(def));
      expect(restored).toEqual(def);
    }
  });

  it('同梱マップはURLに収まる', async () => {
    for (const def of maps) {
      const encoded = await encodeMap(def);
      expect(encoded.length, def.name).toBeLessThan(MAX_SHARE_LENGTH);
    }
  });

  it('圧縮で十分に短くなる', async () => {
    const def = maps[1] ?? maps[0]!;
    const encoded = await encodeMap(def);
    expect(encoded.length).toBeLessThan(JSON.stringify(def).length / 2);
  });

  it('URLに安全な文字だけを使う', async () => {
    // '+' や '/' が混ざるとハッシュの解釈で壊れる。
    for (const def of maps) {
      expect(await encodeMap(def)).toMatch(/^[A-Za-z0-9_-]*$/);
    }
  });

  it('壊れた入力は例外にする', async () => {
    await expect(decodeMap('これは圧縮データではない')).rejects.toThrow();
    await expect(decodeMap('')).rejects.toThrow();
  });

  it('検証を通らないマップは受け取らない', async () => {
    // 他人が作った文字列を読むので、必ず検証にかける。
    const broken = { ...(maps[0] as MapDef), terrain: ['##'] };
    await expect(decodeMap(await encodeMap(broken as MapDef))).rejects.toThrow();
  });
});

describe('ハッシュの解釈', () => {
  it('パスと引数を分ける', () => {
    expect(parseRoute('#/play?m=abc').path).toBe('/play');
    expect(parseRoute('#/play?m=abc').params.get('m')).toBe('abc');
    expect(parseRoute('#/edit').path).toBe('/edit');
    expect(parseRoute('').path).toBe('');
  });

  it('base64url の文字をそのまま取り出す', () => {
    const value = 'aB-_09';
    expect(parseRoute(`#/play?m=${value}`).params.get('m')).toBe(value);
  });
});

describe('進行状況の保存', () => {
  const map = compileMap(maps[0]!);

  it('状態を往復して同じものに戻る', () => {
    const state = initialState(map);
    state.hp = 42;
    state.orbs[0] = 3;

    const restored = deserializeState(serializeState(state));

    expect(restored.hp).toBe(42);
    expect([...restored.orbs]).toEqual([3]);
    expect([...restored.consumed]).toEqual([...state.consumed]);
    expect(restored.consumed).toBeInstanceOf(Uint32Array);
  });

  it('正しい保存データを受け入れる', () => {
    const progress: SavedProgress = {
      version: 1,
      mapId: map.def.id,
      history: [serializeState(initialState(map))],
      visitedScreens: [0],
      savedAt: 0,
    };

    expect(isProgress(progress)).toBe(true);
  });

  it('壊れた保存データを弾く', () => {
    // 版が違えば形も違う。疑わしいものは捨てる（復元して盤面が破綻するほうが悪い）。
    const base = {
      version: 1,
      mapId: 'x',
      history: [serializeState(initialState(map))],
      visitedScreens: [0],
      savedAt: 0,
    };

    expect(isProgress({ ...base, version: 2 })).toBe(false);
    expect(isProgress({ ...base, history: [] })).toBe(false);
    expect(isProgress({ ...base, history: [{ hp: 1 }] })).toBe(false);
    expect(isProgress({ ...base, visitedScreens: 'いろいろ' })).toBe(false);
    expect(isProgress(null)).toBe(false);
    expect(isProgress('保存データ')).toBe(false);
  });
});
