import { describe, expect, it } from 'vitest';
import { MapValidationError, parseMapDef, validateMapDef } from '../src/core/index.ts';

/** 検証の基準になる、問題のないマップ。各テストはここから1点だけ壊す。 */
function validRaw(): Record<string, unknown> {
  return {
    formatVersion: 1,
    id: 'sample',
    name: 'サンプル',
    width: 4,
    height: 2,
    screen: { width: 2, height: 2 },
    start: { x: 0, y: 0 },
    goal: { x: 3, y: 1 },
    player: { hp: 20, atk: 12, def: 2, keys: { red: 1 }, orbs: 0 },
    terrain: ['....', '..#.'],
    objects: [
      { type: 'enemy', x: 1, y: 0, hp: 30, atk: 10, def: 4 },
      { type: 'door', x: 2, y: 0, key: 'red' },
      { type: 'item', x: 3, y: 0, effect: { kind: 'atk', amount: 4 } },
      {
        type: 'altar',
        x: 0,
        y: 1,
        id: 'shrine',
        options: [{ id: 'atk', cost: 2, effect: { kind: 'atk', amount: 5 }, stock: 1 }],
      },
    ],
  };
}

/** 生データを1点だけ壊して、検出された問題を返す。 */
function issuesFor(mutate: (raw: Record<string, unknown>) => void): readonly string[] {
  const raw = validRaw();
  mutate(raw);
  const result = validateMapDef(raw);
  return result.ok ? [] : result.issues;
}

describe('validateMapDef', () => {
  it('正しいマップを受け入れる', () => {
    expect(validateMapDef(validRaw()).ok).toBe(true);
  });

  it('問題を最初の1件で打ち切らず全件集める', () => {
    // エディタが一覧で出せるようにするため（設計 §4）。
    const issues = issuesFor((raw) => {
      raw['id'] = '';
      raw['name'] = '';
      raw['formatVersion'] = 2;
    });

    expect(issues.length).toBeGreaterThanOrEqual(3);
  });

  it('地形の行数と行長を検証する', () => {
    expect(issuesFor((raw) => (raw['terrain'] = ['....']))).toContainEqual(
      expect.stringContaining('terrain の行数'),
    );
    expect(issuesFor((raw) => (raw['terrain'] = ['...', '..#.']))).toContainEqual(
      expect.stringContaining('terrain[0] の長さ'),
    );
  });

  it("地形は '.' と '#' 以外を許さない", () => {
    expect(issuesFor((raw) => (raw['terrain'] = ['..E.', '..#.']))).toContainEqual(
      expect.stringContaining("'.' と '#' 以外"),
    );
  });

  it('画面サイズで割り切れないマップを弾く', () => {
    // 表示専用の概念だが、割り切れないと画面分割が破綻する（設計 §3.7）。
    expect(issuesFor((raw) => (raw['screen'] = { width: 3, height: 2 }))).toContainEqual(
      expect.stringContaining('screen.width'),
    );
  });

  it('同じセルに2つのオブジェクトを置けない', () => {
    // セル集合の単調性が壊れるため、必ず弾く。
    const issues = issuesFor((raw) => {
      (raw['objects'] as unknown[]).push({
        type: 'item',
        x: 1,
        y: 0,
        effect: { kind: 'hp', amount: 1 },
      });
    });

    expect(issues).toContainEqual(expect.stringContaining('重複配置'));
  });

  it('壁の上のオブジェクトを弾く', () => {
    const issues = issuesFor((raw) => {
      (raw['objects'] as unknown[]).push({
        type: 'item',
        x: 2,
        y: 1,
        effect: { kind: 'hp', amount: 1 },
      });
    });

    expect(issues).toContainEqual(expect.stringContaining('壁の上'));
  });

  it('範囲外のオブジェクトを弾く', () => {
    const issues = issuesFor((raw) => {
      (raw['objects'] as unknown[]).push({
        type: 'item',
        x: 9,
        y: 0,
        effect: { kind: 'hp', amount: 1 },
      });
    });

    expect(issues).toContainEqual(expect.stringContaining('マップ範囲外'));
  });

  it('開始位置とゴールが壁やオブジェクトの上にあるのを弾く', () => {
    expect(issuesFor((raw) => (raw['goal'] = { x: 2, y: 1 }))).toContainEqual(
      expect.stringContaining('goal が壁の上'),
    );
    expect(issuesFor((raw) => (raw['start'] = { x: 1, y: 0 }))).toContainEqual(
      expect.stringContaining('start にオブジェクト'),
    );
  });

  it('敵のHPは1以上でなければならない', () => {
    const issues = issuesFor((raw) => {
      (raw['objects'] as Record<string, unknown>[])[0]!['hp'] = 0;
    });

    expect(issues).toContainEqual(expect.stringContaining('enemy.hp'));
  });

  it('負や0の効果を弾く', () => {
    // これを許すと「アイテムは常に取って得」という前提が崩れ、
    // ソルバーの強制手の即時適用と支配関係が同時に壊れる（設計 §7.3 / §7.4）。
    for (const amount of [0, -1, -5]) {
      const issues = issuesFor((raw) => {
        (raw['objects'] as Record<string, unknown>[])[2]!['effect'] = { kind: 'atk', amount };
      });
      expect(issues).toContainEqual(expect.stringContaining('effect.amount'));
    }
  });

  it('整数でない値を弾く', () => {
    const issues = issuesFor((raw) => {
      (raw['objects'] as Record<string, unknown>[])[0]!['atk'] = 10.5;
    });

    expect(issues).toContainEqual(expect.stringContaining('enemy.atk'));
  });

  it('祭壇のIDの重複を弾く', () => {
    const issues = issuesFor((raw) => {
      (raw['objects'] as unknown[]).push({
        type: 'altar',
        x: 1,
        y: 1,
        id: 'shrine',
        options: [{ id: 'a', cost: 1, effect: { kind: 'atk', amount: 1 } }],
      });
    });

    expect(issues).toContainEqual(expect.stringContaining('altar.id "shrine" が重複'));
  });

  it('交換肢が空の祭壇を弾く', () => {
    const issues = issuesFor((raw) => {
      (raw['objects'] as Record<string, unknown>[])[3]!['options'] = [];
    });

    expect(issues).toContainEqual(expect.stringContaining('altar.options が空'));
  });

  it('同じ祭壇内での交換肢IDの重複を弾く', () => {
    const issues = issuesFor((raw) => {
      (raw['objects'] as Record<string, unknown>[])[3]!['options'] = [
        { id: 'a', cost: 1, effect: { kind: 'atk', amount: 1 } },
        { id: 'a', cost: 2, effect: { kind: 'def', amount: 1 } },
      ];
    });

    expect(issues).toContainEqual(expect.stringContaining('同じ祭壇内で重複'));
  });

  it('未知の masterKeyMode を弾く', () => {
    expect(issuesFor((raw) => (raw['masterKeyMode'] = 'skeleton'))).toContainEqual(
      expect.stringContaining('masterKeyMode'),
    );
  });

  it('オブジェクトでない入力を弾く', () => {
    for (const value of [null, undefined, 42, 'map', []]) {
      expect(validateMapDef(value).ok).toBe(false);
    }
  });
});

describe('parseMapDef', () => {
  it('不正なマップでは問題の一覧を持つ例外を投げる', () => {
    try {
      parseMapDef({ formatVersion: 1 });
      expect.unreachable('例外が投げられるべき');
    } catch (error) {
      expect(error).toBeInstanceOf(MapValidationError);
      expect((error as MapValidationError).issues.length).toBeGreaterThan(0);
    }
  });
});
