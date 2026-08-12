import { describe, expect, it } from 'vitest';
import { validateMapDef } from '../src/core/index.ts';
import {
  DraftHistory,
  draftFromMapDef,
  draftToMapDef,
  emptyDraft,
  objectAt,
  withGoal,
  withObject,
  withSize,
  withStart,
  withTile,
  withoutObjectAt,
} from '../src/editor/draft.ts';
import { instantiate, TOOLS } from '../src/editor/palette.ts';
import type { Tool } from '../src/editor/palette.ts';
import type { PlacedObject } from '../src/core/index.ts';

/**
 * 編集操作。設計 §9。
 *
 * エディタの操作は、検証を通らない状態を作らないことが要件になる。
 * 壁の上のオブジェクトや、開始位置に重なったオブジェクトを一時的にでも作ると、
 * その間ソルバーが走らず、作り手へのフィードバックが途切れる。
 */

const enemy: PlacedObject = { type: 'enemy', x: 3, y: 3, hp: 10, atk: 5, def: 1 };

describe('地形の編集', () => {
  it('壁を置くとそのマスのオブジェクトは消える', () => {
    const draft = withObject(emptyDraft(), enemy);
    expect(objectAt(draft, 3, 3)).not.toBeNull();

    const walled = withTile(draft, 3, 3, '#');
    expect(objectAt(walled, 3, 3)).toBeNull();
    expect(walled.rows[3]?.[3]).toBe('#');
  });

  it('開始位置とゴールは壁にできない', () => {
    const draft = emptyDraft();
    expect(withTile(draft, draft.start.x, draft.start.y, '#')).toBe(draft);
    expect(withTile(draft, draft.goal.x, draft.goal.y, '#')).toBe(draft);
  });

  it('同じ内容を書いても新しい状態を作らない', () => {
    // ペイント中に同じマスを撫でても1手にならないようにするため。
    const draft = emptyDraft();
    expect(withTile(draft, 5, 5, '.')).toBe(draft);
  });
});

describe('オブジェクトの配置', () => {
  it('壁の上に置くと床に変える', () => {
    const draft = emptyDraft();
    const placed = withObject(draft, { ...enemy, x: 0, y: 5 }); // 外周は壁

    expect(placed.rows[5]?.[0]).toBe('.');
    expect(objectAt(placed, 0, 5)).not.toBeNull();
  });

  it('開始位置とゴールには置けない', () => {
    const draft = emptyDraft();
    expect(withObject(draft, { ...enemy, x: draft.start.x, y: draft.start.y })).toBe(draft);
    expect(withObject(draft, { ...enemy, x: draft.goal.x, y: draft.goal.y })).toBe(draft);
  });

  it('同じマスに重ならない', () => {
    // 重複配置はセル集合の単調性を壊すので、検証以前に作らせない。
    const draft = withObject(withObject(emptyDraft(), enemy), { ...enemy, hp: 99 });

    expect(draft.objects.filter((o) => o.x === 3 && o.y === 3)).toHaveLength(1);
    expect(objectAt(draft, 3, 3)).toMatchObject({ hp: 99 });
  });

  it('消すと居なくなる', () => {
    const draft = withoutObjectAt(withObject(emptyDraft(), enemy), 3, 3);
    expect(objectAt(draft, 3, 3)).toBeNull();
  });
});

describe('開始位置とゴール', () => {
  it('置いたマスのオブジェクトを退かし、床にする', () => {
    const draft = withObject(emptyDraft(), enemy);
    const moved = withStart(draft, 3, 3);

    expect(moved.start).toEqual({ x: 3, y: 3 });
    expect(objectAt(moved, 3, 3)).toBeNull();
    expect(moved.rows[3]?.[3]).toBe('.');
  });

  it('互いに重ならない', () => {
    const draft = emptyDraft();
    expect(withStart(draft, draft.goal.x, draft.goal.y)).toBe(draft);
    expect(withGoal(draft, draft.start.x, draft.start.y)).toBe(draft);
  });
});

describe('サイズ変更', () => {
  it('はみ出したオブジェクトを落とし、開始位置を収める', () => {
    const draft = withObject(emptyDraft(16, 16), { ...enemy, x: 12, y: 12 });
    const shrunk = withSize(draft, 8, 8);

    expect(shrunk.width).toBe(8);
    expect(shrunk.objects).toHaveLength(0);
    expect(shrunk.goal.x).toBeLessThan(8);
    expect(shrunk.goal.y).toBeLessThan(8);
  });

  it('縮めても検証を通る', () => {
    const shrunk = withSize(emptyDraft(16, 16), 6, 6);
    expect(validateMapDef(draftToMapDef(shrunk)).ok).toBe(true);
  });
});

describe('履歴', () => {
  it('変化が無ければ積まない', () => {
    const history = new DraftHistory(emptyDraft());
    expect(history.apply(history.current)).toBe(false);
    expect(history.canUndo).toBe(false);
  });

  it('戻して進められる', () => {
    const history = new DraftHistory(emptyDraft());
    const before = history.current;

    history.apply(withObject(before, enemy));
    expect(objectAt(history.current, 3, 3)).not.toBeNull();

    expect(history.undo()).toBe(true);
    expect(history.current).toBe(before);

    expect(history.redo()).toBe(true);
    expect(objectAt(history.current, 3, 3)).not.toBeNull();
  });

  it('新しい編集は redo の先を捨てる', () => {
    const history = new DraftHistory(emptyDraft());
    history.apply(withObject(history.current, enemy));
    history.undo();

    history.apply(withTile(history.current, 5, 5, '#'));
    expect(history.canRedo).toBe(false);
  });
});

describe('道具', () => {
  it('ひな形から置いたオブジェクトは検証を通る', () => {
    let draft = emptyDraft();
    let seq = 0;

    for (const tool of TOOLS.filter((t): t is Extract<Tool, { kind: 'object' }> => t.kind === 'object')) {
      const x = 2 + (seq % 10);
      const y = 3 + Math.floor(seq / 10);
      draft = withObject(draft, instantiate(tool, x, y, seq));
      seq += 1;
    }

    const validation = validateMapDef(draftToMapDef(draft));
    expect(validation.ok ? [] : validation.issues).toEqual([]);
  });

  it('祭壇を複数置いてもIDが衝突しない', () => {
    const altar = TOOLS.find((t) => t.id === 'altar');
    expect(altar?.kind).toBe('object');
    if (altar === undefined || altar.kind !== 'object') return;

    let draft = emptyDraft();
    draft = withObject(draft, instantiate(altar, 2, 2, 1));
    draft = withObject(draft, instantiate(altar, 4, 2, 2));

    const validation = validateMapDef(draftToMapDef(draft));
    expect(validation.ok ? [] : validation.issues).toEqual([]);
  });
});

describe('MapDef との往復', () => {
  it('取り込んで書き出すと同じ内容になる', () => {
    const original = draftToMapDef(withObject(emptyDraft(), enemy));
    const roundTripped = draftToMapDef(draftFromMapDef(original));

    expect(roundTripped).toEqual(original);
  });
});
