/**
 * 表示用の文言。
 *
 * 進入できなかった理由は必ず言葉にして出す。黙って移動が失敗するのが
 * 最悪の体験である（設計 §11.8）。
 */

import { battleCost } from '../core/index.ts';
import type {
  BlockReason,
  CompiledEffect,
  CompiledMap,
  CompiledObject,
  GameState,
} from '../core/index.ts';

export function keyName(map: CompiledMap, keyId: number): string {
  return map.keyColors[keyId] ?? `鍵${keyId}`;
}

export function describeEffect(map: CompiledMap, effect: CompiledEffect): string {
  switch (effect.kind) {
    case 'hp':
      return `HP +${effect.amount}`;
    case 'atk':
      return `攻撃力 +${effect.amount}`;
    case 'def':
      return `防御力 +${effect.amount}`;
    case 'orb':
      return `オーブ +${effect.amount}`;
    case 'key':
      return `${keyName(map, effect.keyId)}の鍵 +${effect.amount}`;
    case 'masterKey':
      return map.masterKeyMode === 'permanent' ? 'マスターキー' : `マスターキー +${effect.amount}`;
  }
}

/** 効果を適用した後の値。祭壇の交換プレビュー（設計 §11.7）に使う。 */
export function previewEffect(
  map: CompiledMap,
  state: GameState,
  effect: CompiledEffect,
): string | null {
  switch (effect.kind) {
    case 'hp':
      return `${state.hp} → ${state.hp + effect.amount}`;
    case 'atk':
      return `${state.atk} → ${state.atk + effect.amount}`;
    case 'def':
      return `${state.def} → ${state.def + effect.amount}`;
    case 'orb':
      return `${state.orbs[0] ?? 0} → ${(state.orbs[0] ?? 0) + effect.amount}`;
    case 'key': {
      const held = state.keys[effect.keyId] ?? 0;
      return `${held} → ${held + effect.amount}`;
    }
    case 'masterKey':
      return map.masterKeyMode === 'permanent' ? '入手' : `${state.masterKey} → ${state.masterKey + 1}`;
  }
}

export function describeBlockReason(map: CompiledMap, reason: BlockReason): string {
  switch (reason.kind) {
    case 'outOfBounds':
      return 'マップの外には出られません。';
    case 'wall':
      return '壁は通れません。';
    case 'unbeatable': {
      const enemy = reason.enemy;
      return `攻撃不能。${enemyName(enemy)}の防御力 ${enemy.def} に対して攻撃力が足りません。`;
    }
    case 'insufficientHp':
      return `HPが足りません。${enemyName(reason.enemy)}の撃破には ${reason.cost} 必要です。`;
    case 'noKey':
      return `${keyName(map, reason.door.keyId)}の鍵がありません。`;
  }
}

export function enemyName(enemy: { readonly source: { readonly name?: string } }): string {
  return enemy.source.name ?? '敵';
}

/** 選択したオブジェクトの完全な情報。開示は全部する（設計 §11.7）。 */
export interface ObjectDetail {
  readonly title: string;
  readonly rows: readonly (readonly [string, string])[];
  readonly warning: string | null;
}

export function describeObject(
  map: CompiledMap,
  state: GameState,
  object: CompiledObject,
): ObjectDetail {
  switch (object.type) {
    case 'enemy': {
      const cost = battleCost(state, object);
      const rows: (readonly [string, string])[] = [
        ['HP', String(object.hp)],
        ['攻撃力', String(object.atk)],
        ['防御力', String(object.def)],
        ['オーブ', String(object.orb)],
      ];

      if (cost === null) {
        return { title: enemyName(object), rows, warning: '攻撃不能。永久に通過できません。' };
      }

      rows.push(['撃破コスト', String(cost)]);
      rows.push(['撃破後のHP', `${state.hp} → ${state.hp - cost}`]);

      return {
        title: enemyName(object),
        rows,
        warning: state.hp <= cost ? `HPが ${cost - state.hp + 1} 足りません。` : null,
      };
    }

    case 'item':
      return {
        title: 'アイテム',
        rows: [['効果', describeEffect(map, object.effect)]],
        warning: null,
      };

    case 'door': {
      const held = state.keys[object.keyId] ?? 0;
      const hasMaster = state.masterKey > 0;
      return {
        title: `${keyName(map, object.keyId)}の扉`,
        rows: [
          ['必要な鍵', `${keyName(map, object.keyId)} ×1`],
          ['所持', String(held)],
        ],
        warning: held > 0 || hasMaster ? null : '対応する鍵がありません。',
      };
    }

    case 'altar':
      return {
        title: '祭壇',
        rows: [['交換肢', `${object.slots.length} 種`]],
        warning: null,
      };
  }
}
