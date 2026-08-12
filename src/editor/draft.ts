/**
 * 編集中のマップ。設計 §9。
 *
 * `MapDef` をそのまま持たず、書き換えやすい形で保持して、
 * 出力するときに `MapDef` を組み立てる。
 * 履歴は丸ごとの複製で持つ。マップは小さいので、差分を管理する必要がない。
 */

import type { MapDef, PlacedObject, Point } from '../core/index.ts';

export interface DraftState {
  readonly id: string;
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly screen: { readonly width: number; readonly height: number };
  readonly start: Point;
  readonly goal: Point;
  readonly player: { readonly hp: number; readonly atk: number; readonly def: number };
  /** 地形。'.' = 床、'#' = 壁。 */
  readonly rows: readonly string[];
  readonly objects: readonly PlacedObject[];
}

export function emptyDraft(width = 16, height = 16): DraftState {
  const rows: string[] = [];
  for (let y = 0; y < height; y++) {
    let row = '';
    for (let x = 0; x < width; x++) {
      const border = x === 0 || y === 0 || x === width - 1 || y === height - 1;
      row += border ? '#' : '.';
    }
    rows.push(row);
  }

  return {
    id: 'untitled',
    name: '新しいマップ',
    width,
    height,
    screen: { width, height },
    start: { x: 1, y: 1 },
    goal: { x: width - 2, y: height - 2 },
    player: { hp: 40, atk: 10, def: 2 },
    rows,
    objects: [],
  };
}

/** `MapDef` から編集用の形に取り込む。 */
export function draftFromMapDef(def: MapDef): DraftState {
  return {
    id: def.id,
    name: def.name,
    width: def.width,
    height: def.height,
    screen: def.screen ?? { width: def.width, height: def.height },
    start: def.start,
    goal: def.goal,
    player: { hp: def.player.hp, atk: def.player.atk, def: def.player.def },
    rows: [...def.terrain],
    objects: def.objects.map((object) => ({ ...object })),
  };
}

/** 出力用の `MapDef` を組み立てる。 */
export function draftToMapDef(draft: DraftState): MapDef {
  return {
    formatVersion: 1,
    id: draft.id,
    name: draft.name,
    width: draft.width,
    height: draft.height,
    screen: { width: draft.screen.width, height: draft.screen.height },
    start: draft.start,
    goal: draft.goal,
    player: draft.player,
    terrain: [...draft.rows],
    objects: draft.objects.map((object) => ({ ...object })),
  };
}

function withTerrain(draft: DraftState, x: number, y: number, tile: '.' | '#'): DraftState {
  const row = draft.rows[y];
  if (row === undefined || row[x] === tile) return draft;

  const rows = [...draft.rows];
  rows[y] = row.slice(0, x) + tile + row.slice(x + 1);
  return { ...draft, rows };
}

export function objectAt(draft: DraftState, x: number, y: number): PlacedObject | null {
  return draft.objects.find((object) => object.x === x && object.y === y) ?? null;
}

export function withoutObjectAt(draft: DraftState, x: number, y: number): DraftState {
  const objects = draft.objects.filter((object) => !(object.x === x && object.y === y));
  return objects.length === draft.objects.length ? draft : { ...draft, objects };
}

/**
 * オブジェクトを置く。壁の上・開始位置・ゴールには置けないので、
 * 先に地形と特殊マスの側を譲る。検証に落とされる前に整合させる。
 */
export function withObject(draft: DraftState, object: PlacedObject): DraftState {
  if (isReserved(draft, object.x, object.y)) return draft;

  const cleared = withoutObjectAt(withTerrain(draft, object.x, object.y, '.'), object.x, object.y);
  return { ...cleared, objects: [...cleared.objects, object] };
}

export function withTile(draft: DraftState, x: number, y: number, tile: '.' | '#'): DraftState {
  if (tile === '#') {
    if (isReserved(draft, x, y)) return draft;
    return withTerrain(withoutObjectAt(draft, x, y), x, y, '#');
  }
  return withTerrain(draft, x, y, '.');
}

/** 開始位置とゴールは、床であってオブジェクトが無いことを保つ。 */
export function withStart(draft: DraftState, x: number, y: number): DraftState {
  if (x === draft.goal.x && y === draft.goal.y) return draft;
  const cleared = withoutObjectAt(withTerrain(draft, x, y, '.'), x, y);
  return { ...cleared, start: { x, y } };
}

export function withGoal(draft: DraftState, x: number, y: number): DraftState {
  if (x === draft.start.x && y === draft.start.y) return draft;
  const cleared = withoutObjectAt(withTerrain(draft, x, y, '.'), x, y);
  return { ...cleared, goal: { x, y } };
}

export function isReserved(draft: DraftState, x: number, y: number): boolean {
  return (
    (x === draft.start.x && y === draft.start.y) || (x === draft.goal.x && y === draft.goal.y)
  );
}

/** サイズ変更。はみ出した内容は落とす。 */
export function withSize(draft: DraftState, width: number, height: number): DraftState {
  const rows: string[] = [];
  for (let y = 0; y < height; y++) {
    const existing = draft.rows[y] ?? '';
    let row = '';
    for (let x = 0; x < width; x++) {
      const border = x === 0 || y === 0 || x === width - 1 || y === height - 1;
      row += border ? '#' : (existing[x] ?? '.');
    }
    rows.push(row);
  }

  const clamp = (point: Point): Point => ({
    x: Math.min(Math.max(point.x, 1), width - 2),
    y: Math.min(Math.max(point.y, 1), height - 2),
  });

  return {
    ...draft,
    width,
    height,
    screen: {
      width: Math.min(draft.screen.width, width),
      height: Math.min(draft.screen.height, height),
    },
    rows,
    objects: draft.objects.filter((object) => object.x < width && object.y < height),
    start: clamp(draft.start),
    goal: clamp(draft.goal),
  };
}

/** 編集履歴。undo / redo は丸ごとの差し替えで済ませる。 */
export class DraftHistory {
  private readonly past: DraftState[];
  private readonly future: DraftState[] = [];

  constructor(initial: DraftState) {
    this.past = [initial];
  }

  get current(): DraftState {
    return this.past[this.past.length - 1]!;
  }

  get canUndo(): boolean {
    return this.past.length > 1;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  /** 変化が無ければ履歴を汚さない。ペイント中に同じマスを撫でても1手にならない。 */
  apply(next: DraftState): boolean {
    if (next === this.current) return false;
    this.past.push(next);
    this.future.length = 0;
    return true;
  }

  replace(next: DraftState): void {
    this.past.length = 0;
    this.past.push(next);
    this.future.length = 0;
  }

  undo(): boolean {
    if (!this.canUndo) return false;
    this.future.push(this.past.pop()!);
    return true;
  }

  redo(): boolean {
    if (!this.canRedo) return false;
    this.past.push(this.future.pop()!);
    return true;
  }
}
