/**
 * 配置に使う道具。設計 §9。
 *
 * 敵やアイテムはここのひな形から置き、置いたあとで数値を直す。
 * ひな形を用意するのは、毎回ゼロから数値を入れるのが現実的でないため。
 */

import type { ObjectDef, PlacedObject } from '../core/index.ts';

export type ToolId = string;

export type Tool =
  | { readonly id: ToolId; readonly label: string; readonly kind: 'terrain'; readonly tile: '.' | '#' }
  | { readonly id: ToolId; readonly label: string; readonly kind: 'start' }
  | { readonly id: ToolId; readonly label: string; readonly kind: 'goal' }
  | { readonly id: ToolId; readonly label: string; readonly kind: 'erase' }
  | { readonly id: ToolId; readonly label: string; readonly kind: 'select' }
  | {
      readonly id: ToolId;
      readonly label: string;
      readonly kind: 'object';
      /** 座標を除いたひな形。 */
      readonly template: ObjectDef;
    };

export const TOOLS: readonly Tool[] = [
  { id: 'select', label: '選択', kind: 'select' },
  { id: 'floor', label: '床', kind: 'terrain', tile: '.' },
  { id: 'wall', label: '壁', kind: 'terrain', tile: '#' },
  { id: 'erase', label: '消す', kind: 'erase' },
  { id: 'start', label: '開始', kind: 'start' },
  { id: 'goal', label: 'ゴール', kind: 'goal' },

  {
    id: 'enemy-weak',
    label: '敵（弱）',
    kind: 'object',
    template: { type: 'enemy', name: '野犬', hp: 12, atk: 6, def: 4, orb: 1 },
  },
  {
    id: 'enemy-mid',
    label: '敵（中）',
    kind: 'object',
    template: { type: 'enemy', name: '衛兵', hp: 30, atk: 10, def: 8, orb: 1 },
  },
  {
    id: 'enemy-strong',
    label: '敵（強）',
    kind: 'object',
    template: { type: 'enemy', name: '重装兵', hp: 60, atk: 16, def: 14, orb: 3 },
  },

  {
    id: 'item-hp',
    label: 'HP+20',
    kind: 'object',
    template: { type: 'item', effect: { kind: 'hp', amount: 20 } },
  },
  {
    id: 'item-atk',
    label: '攻撃力+3',
    kind: 'object',
    template: { type: 'item', effect: { kind: 'atk', amount: 3 } },
  },
  {
    id: 'item-def',
    label: '防御力+2',
    kind: 'object',
    template: { type: 'item', effect: { kind: 'def', amount: 2 } },
  },
  {
    id: 'item-key',
    label: '赤い鍵',
    kind: 'object',
    template: { type: 'item', effect: { kind: 'key', key: '赤', amount: 1 } },
  },
  {
    id: 'item-orb',
    label: 'オーブ+1',
    kind: 'object',
    template: { type: 'item', effect: { kind: 'orb', amount: 1 } },
  },

  { id: 'door-red', label: '赤い扉', kind: 'object', template: { type: 'door', key: '赤' } },
  { id: 'door-blue', label: '青い扉', kind: 'object', template: { type: 'door', key: '青' } },

  {
    id: 'altar',
    label: '祭壇',
    kind: 'object',
    template: {
      type: 'altar',
      id: 'shrine',
      options: [
        { id: 'key', label: '赤い鍵', cost: 2, effect: { kind: 'key', key: '赤', amount: 1 }, stock: 1 },
        { id: 'power', label: '力の証', cost: 2, effect: { kind: 'atk', amount: 3 }, stock: 1 },
      ],
    },
  },
];

export function findTool(id: ToolId): Tool | undefined {
  return TOOLS.find((tool) => tool.id === id);
}

/** 祭壇は `id` が一意でなければならないので、置くたびに振り直す。 */
export function instantiate(
  tool: Extract<Tool, { kind: 'object' }>,
  x: number,
  y: number,
  seq: number,
): PlacedObject {
  const template = tool.template;
  if (template.type === 'altar') {
    return { ...template, id: `${template.id}-${seq}`, x, y };
  }
  return { ...template, x, y };
}
