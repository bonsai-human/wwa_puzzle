/**
 * マップデータの検証。設計 §4「バリデーション」。
 *
 * 問題は最初の1件で打ち切らず全件集める。エディタ（Phase 4）が
 * 一覧で提示できるようにするため。
 */

import { MAX_STAT, DEFAULT_SCREEN } from './types.ts';
import type { Effect, MapDef, ObjectDef, PlacedObject } from './types.ts';

export type ValidationResult =
  | { readonly ok: true; readonly map: MapDef }
  | { readonly ok: false; readonly issues: readonly string[] };

export class MapValidationError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`マップデータが不正です:\n- ${issues.join('\n- ')}`);
    this.name = 'MapValidationError';
    this.issues = issues;
  }
}

/** マップ1辺の上限。これを超えると探索も描画も現実的でない。 */
const MAX_DIMENSION = 512;

const EFFECT_KINDS = ['hp', 'atk', 'def', 'orb', 'key', 'masterKey'] as const;
const OBJECT_TYPES = ['enemy', 'item', 'door', 'altar'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isBoundedInt(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

class Issues {
  private readonly list: string[] = [];

  add(message: string): void {
    this.list.push(message);
  }

  /** 条件を満たさなければ記録して false を返す。 */
  require(condition: boolean, message: string): boolean {
    if (!condition) this.list.push(message);
    return condition;
  }

  get all(): readonly string[] {
    return this.list;
  }

  get empty(): boolean {
    return this.list.length === 0;
  }
}

/**
 * 効果を検証する。
 *
 * **加算量は必ず 1 以上でなければならない。** 負や 0 の効果を許すと、
 * 「アイテムは常に取って得」という前提（設計 §7.3 の強制手の即時適用）と、
 * 「消費済み集合が大きい状態はステータスも大きい」という前提（§7.4 の支配関係）が
 * 同時に崩れ、ソルバーが誤った枝刈りをする。ルールではなくデータ側で塞ぐ。
 */
function checkEffect(effect: unknown, where: string, issues: Issues): void {
  if (!isRecord(effect)) {
    issues.add(`${where}: effect がオブジェクトではありません`);
    return;
  }

  const kind = effect['kind'];
  if (typeof kind !== 'string' || !(EFFECT_KINDS as readonly string[]).includes(kind)) {
    issues.add(`${where}: effect.kind が不正です (${String(kind)})`);
    return;
  }

  if (kind === 'masterKey') {
    if (effect['amount'] !== undefined) {
      issues.require(
        isBoundedInt(effect['amount'], 1, MAX_STAT),
        `${where}: masterKey の amount は 1 以上の整数である必要があります`,
      );
    }
    return;
  }

  issues.require(
    isBoundedInt(effect['amount'], 1, MAX_STAT),
    `${where}: effect.amount は 1 以上 ${MAX_STAT} 以下の整数である必要があります`,
  );

  if (kind === 'key') {
    issues.require(isNonEmptyString(effect['key']), `${where}: effect.key が空です`);
  }
}

function checkObject(raw: unknown, where: string, issues: Issues, altarIds: Set<string>): void {
  if (!isRecord(raw)) {
    issues.add(`${where}: オブジェクトではありません`);
    return;
  }

  const type = raw['type'];
  if (typeof type !== 'string' || !(OBJECT_TYPES as readonly string[]).includes(type)) {
    issues.add(`${where}: type が不正です (${String(type)})`);
    return;
  }

  switch (type as ObjectDef['type']) {
    case 'enemy': {
      issues.require(
        isBoundedInt(raw['hp'], 1, MAX_STAT),
        `${where}: enemy.hp は 1 以上 ${MAX_STAT} 以下の整数である必要があります`,
      );
      for (const field of ['atk', 'def'] as const) {
        issues.require(
          isBoundedInt(raw[field], 0, MAX_STAT),
          `${where}: enemy.${field} は 0 以上 ${MAX_STAT} 以下の整数である必要があります`,
        );
      }
      if (raw['orb'] !== undefined) {
        issues.require(
          isBoundedInt(raw['orb'], 0, MAX_STAT),
          `${where}: enemy.orb は 0 以上の整数である必要があります`,
        );
      }
      break;
    }

    case 'item':
      checkEffect(raw['effect'], where, issues);
      break;

    case 'door':
      issues.require(isNonEmptyString(raw['key']), `${where}: door.key が空です`);
      break;

    case 'altar': {
      const id = raw['id'];
      if (!isNonEmptyString(id)) {
        issues.add(`${where}: altar.id が空です`);
      } else if (altarIds.has(id)) {
        issues.add(`${where}: altar.id "${id}" が重複しています`);
      } else {
        altarIds.add(id);
      }

      const options = raw['options'];
      if (!Array.isArray(options) || options.length === 0) {
        issues.add(`${where}: altar.options が空です`);
        break;
      }

      const optionIds = new Set<string>();
      options.forEach((option: unknown, index: number) => {
        const optionWhere = `${where} option[${index}]`;
        if (!isRecord(option)) {
          issues.add(`${optionWhere}: オブジェクトではありません`);
          return;
        }

        const optionId = option['id'];
        if (!isNonEmptyString(optionId)) {
          issues.add(`${optionWhere}: id が空です`);
        } else if (optionIds.has(optionId)) {
          issues.add(`${optionWhere}: id "${optionId}" が同じ祭壇内で重複しています`);
        } else {
          optionIds.add(optionId);
        }

        issues.require(
          isBoundedInt(option['cost'], 0, MAX_STAT),
          `${optionWhere}: cost は 0 以上の整数である必要があります`,
        );

        if (option['stock'] !== undefined) {
          issues.require(
            isBoundedInt(option['stock'], 1, MAX_STAT),
            `${optionWhere}: stock は 1 以上の整数である必要があります`,
          );
        }

        checkEffect(option['effect'], optionWhere, issues);
      });
      break;
    }
  }
}

/** マップデータを検証する。問題があれば全件返す。 */
export function validateMapDef(raw: unknown): ValidationResult {
  const issues = new Issues();

  if (!isRecord(raw)) {
    return { ok: false, issues: ['マップデータがオブジェクトではありません'] };
  }

  issues.require(raw['formatVersion'] === 1, 'formatVersion は 1 である必要があります');
  issues.require(isNonEmptyString(raw['id']), 'id が空です');
  issues.require(isNonEmptyString(raw['name']), 'name が空です');

  const widthOk = issues.require(
    isBoundedInt(raw['width'], 1, MAX_DIMENSION),
    `width は 1 以上 ${MAX_DIMENSION} 以下の整数である必要があります`,
  );
  const heightOk = issues.require(
    isBoundedInt(raw['height'], 1, MAX_DIMENSION),
    `height は 1 以上 ${MAX_DIMENSION} 以下の整数である必要があります`,
  );

  // 寸法が読めない時点でこれ以降の位置検査は意味を成さない。
  if (!widthOk || !heightOk) return { ok: false, issues: issues.all };

  const width = raw['width'] as number;
  const height = raw['height'] as number;

  // 画面分割。表示専用だが、割り切れないと表示が破綻するのでここで弾く（設計 §3.7）。
  let screen = DEFAULT_SCREEN as { width: number; height: number };
  if (raw['screen'] !== undefined) {
    const rawScreen = raw['screen'];
    if (
      isRecord(rawScreen) &&
      isBoundedInt(rawScreen['width'], 1, MAX_DIMENSION) &&
      isBoundedInt(rawScreen['height'], 1, MAX_DIMENSION)
    ) {
      screen = { width: rawScreen['width'], height: rawScreen['height'] };
    } else {
      issues.add('screen.width / screen.height は 1 以上の整数である必要があります');
      screen = { width, height };
    }
  }
  issues.require(
    width % screen.width === 0,
    `width (${width}) が screen.width (${screen.width}) の整数倍ではありません`,
  );
  issues.require(
    height % screen.height === 0,
    `height (${height}) が screen.height (${screen.height}) の整数倍ではありません`,
  );

  // 地形。
  const terrain = raw['terrain'];
  let rows: string[] | null = null;
  if (!Array.isArray(terrain) || terrain.length !== height) {
    issues.add(`terrain の行数が height (${height}) と一致しません`);
  } else {
    rows = [];
    for (let y = 0; y < height; y++) {
      const row: unknown = terrain[y];
      if (typeof row !== 'string' || row.length !== width) {
        issues.add(`terrain[${y}] の長さが width (${width}) と一致しません`);
        rows = null;
        break;
      }
      if (!/^[.#]+$/.test(row)) {
        issues.add(`terrain[${y}] に '.' と '#' 以外の文字が含まれています`);
        rows = null;
        break;
      }
      rows.push(row);
    }
  }

  const isWall = (x: number, y: number): boolean => rows?.[y]?.[x] === '#';

  // オブジェクト。座標の重複はセル集合の単調性を壊すので必ず弾く。
  const occupied = new Map<number, string>();
  const objects = raw['objects'];
  if (!Array.isArray(objects)) {
    issues.add('objects が配列ではありません');
  } else {
    const altarIds = new Set<string>();
    objects.forEach((object: unknown, index: number) => {
      const where = `objects[${index}]`;
      if (!isRecord(object)) {
        issues.add(`${where}: オブジェクトではありません`);
        return;
      }

      const x = object['x'];
      const y = object['y'];
      if (!isBoundedInt(x, 0, width - 1) || !isBoundedInt(y, 0, height - 1)) {
        issues.add(`${where}: 座標がマップ範囲外です`);
        return;
      }

      if (isWall(x, y)) issues.add(`${where}: 壁の上に配置されています (${x}, ${y})`);

      const cell = y * width + x;
      const previous = occupied.get(cell);
      if (previous !== undefined) {
        issues.add(`${where}: ${previous} と同じセル (${x}, ${y}) に重複配置されています`);
      } else {
        occupied.set(cell, where);
      }

      checkObject(object, where, issues, altarIds);
    });
  }

  // 開始位置とゴール。
  for (const field of ['start', 'goal'] as const) {
    const point = raw[field];
    if (
      !isRecord(point) ||
      !isBoundedInt(point['x'], 0, width - 1) ||
      !isBoundedInt(point['y'], 0, height - 1)
    ) {
      issues.add(`${field} の座標がマップ範囲外です`);
      continue;
    }
    const x = point['x'];
    const y = point['y'];
    if (isWall(x, y)) issues.add(`${field} が壁の上にあります (${x}, ${y})`);
    if (occupied.has(y * width + x)) {
      issues.add(`${field} にオブジェクトが配置されています (${x}, ${y})`);
    }
  }

  // 初期ステータス。
  const player = raw['player'];
  if (!isRecord(player)) {
    issues.add('player がオブジェクトではありません');
  } else {
    issues.require(
      isBoundedInt(player['hp'], 1, MAX_STAT),
      `player.hp は 1 以上 ${MAX_STAT} 以下の整数である必要があります`,
    );
    for (const field of ['atk', 'def'] as const) {
      issues.require(
        isBoundedInt(player[field], 0, MAX_STAT),
        `player.${field} は 0 以上 ${MAX_STAT} 以下の整数である必要があります`,
      );
    }
    for (const field of ['orbs', 'masterKey'] as const) {
      if (player[field] !== undefined) {
        issues.require(
          isBoundedInt(player[field], 0, MAX_STAT),
          `player.${field} は 0 以上の整数である必要があります`,
        );
      }
    }
    if (player['keys'] !== undefined) {
      const keys = player['keys'];
      if (!isRecord(keys)) {
        issues.add('player.keys がオブジェクトではありません');
      } else {
        for (const [color, count] of Object.entries(keys)) {
          issues.require(
            isBoundedInt(count, 0, MAX_STAT),
            `player.keys["${color}"] は 0 以上の整数である必要があります`,
          );
        }
      }
    }
  }

  if (raw['masterKeyMode'] !== undefined) {
    issues.require(
      raw['masterKeyMode'] === 'permanent' || raw['masterKeyMode'] === 'wildcard',
      "masterKeyMode は 'permanent' か 'wildcard' である必要があります",
    );
  }

  if (!issues.empty) return { ok: false, issues: issues.all };
  return { ok: true, map: raw as unknown as MapDef };
}

/** 検証して MapDef を返す。不正なら {@link MapValidationError} を投げる。 */
export function parseMapDef(raw: unknown): MapDef {
  const result = validateMapDef(raw);
  if (!result.ok) throw new MapValidationError(result.issues);
  return result.map;
}

/** マップの `screen` を既定値込みで解決する。 */
export function screenSize(map: MapDef): { readonly width: number; readonly height: number } {
  return map.screen ?? DEFAULT_SCREEN;
}

/** セルの属する画面。表示専用（設計 §3.7）。 */
export function screenOf(map: MapDef, x: number, y: number): Point2 {
  const screen = screenSize(map);
  return { x: Math.floor(x / screen.width), y: Math.floor(y / screen.height) };
}

interface Point2 {
  readonly x: number;
  readonly y: number;
}

export type { PlacedObject, Effect };
