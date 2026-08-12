/**
 * スプライト。設計 §11.4 / §11.5。
 *
 * ドット絵素材が無いので、すべて Canvas の描画命令で組み立てる。
 * 参考画像のような描き込みは再現できないが、このゲームで視覚に求められるのは
 * 絵の魅力ではなく一目での読み取りなので、次の順で優先する。
 *
 *   1. 種別はシルエットで区別する（色に頼らない）
 *   2. 敵の脅威段階は色ランプで表す
 *   3. 同じ性能のものは必ず同じ見た目にする
 *   4. 「今は通れない」を記号オーバーレイで重ねる
 *
 * 描画は `SpriteId → 描画関数` のレジストリ越しに行う。
 * 後からタイルセットを入手したら、同じインタフェースで実装を差し替えるだけでよい。
 * ゲームロジックからスプライトへの依存は作らない。
 */

import { KEY_STYLES, PALETTE, THREAT_RAMP, keyStyle } from './theme.ts';
import type { CompiledMap, CompiledObject } from '../core/index.ts';

/** 「今は通れない」の表示。プレイヤーの状態で変わる部分（設計 §11.4）。 */
export type Overlay = 'none' | 'unbeatable' | 'unaffordable';

export interface SpriteContext {
  readonly ctx: CanvasRenderingContext2D;
  /** タイル左上の座標。 */
  readonly x: number;
  readonly y: number;
  readonly size: number;
}

export type SpriteId = string;
export type SpriteRenderer = (target: SpriteContext) => void;

const registry = new Map<SpriteId, SpriteRenderer>();

export function registerSprite(id: SpriteId, renderer: SpriteRenderer): void {
  registry.set(id, renderer);
}

export function drawSprite(id: SpriteId, target: SpriteContext): boolean {
  const renderer = registry.get(id);
  if (renderer === undefined) return false;
  renderer(target);
  return true;
}

// --- 図形の下請け -------------------------------------------------------

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function polygon(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  sides: number,
  rotation: number,
): void {
  ctx.beginPath();
  for (let i = 0; i < sides; i++) {
    const angle = rotation + (i * Math.PI * 2) / sides;
    const px = cx + Math.cos(angle) * radius;
    const py = cy + Math.sin(angle) * radius;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

/** 鍵色の識別形。色が見分けられなくても形で区別できるようにする。 */
function keyMark(
  ctx: CanvasRenderingContext2D,
  shape: (typeof KEY_STYLES)[number]['shape'],
  cx: number,
  cy: number,
  radius: number,
): void {
  switch (shape) {
    case 'circle':
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.closePath();
      break;
    case 'triangle':
      polygon(ctx, cx, cy, radius, 3, -Math.PI / 2);
      break;
    case 'square':
      polygon(ctx, cx, cy, radius, 4, Math.PI / 4);
      break;
    case 'diamond':
      polygon(ctx, cx, cy, radius, 4, -Math.PI / 2);
      break;
    case 'hexagon':
      polygon(ctx, cx, cy, radius, 6, -Math.PI / 2);
      break;
  }
}

// --- 地形 ---------------------------------------------------------------

export function drawFloor(target: SpriteContext, checker: boolean): void {
  const { ctx, x, y, size } = target;
  ctx.fillStyle = checker ? PALETTE.floorAlt : PALETTE.floor;
  ctx.fillRect(x, y, size, size);
}

export function drawWall(target: SpriteContext): void {
  const { ctx, x, y, size } = target;

  ctx.fillStyle = PALETTE.wall;
  ctx.fillRect(x, y, size, size);

  // 明部は上端の細い帯だけにする。タイルの内側を大きく塗り分けると、
  // 隣り合う壁の間に隙間があるように見えて、面ではなく縞として読めてしまう。
  ctx.fillStyle = PALETTE.wallEdge;
  ctx.fillRect(x, y, size, Math.max(1, size * 0.12));
}

// --- オブジェクト -------------------------------------------------------

/**
 * 敵。脅威段階で色が変わり、段階が上がるほど棘が増える。
 * 色を見分けられなくても段階が伝わるようにするため。
 */
export function drawEnemy(target: SpriteContext, tier: number): void {
  const { ctx, x, y, size } = target;
  const cx = x + size / 2;
  const cy = y + size / 2;
  const body = size * 0.3;
  const color = THREAT_RAMP[Math.min(tier, THREAT_RAMP.length - 1)]!;

  // 棘。段階の数だけ生やす。
  const spikes = Math.min(tier, THREAT_RAMP.length - 1) + 3;
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < spikes * 2; i++) {
    const angle = -Math.PI / 2 + (i * Math.PI) / spikes;
    const radius = i % 2 === 0 ? body * 1.45 : body;
    const px = cx + Math.cos(angle) * radius;
    const py = cy + Math.sin(angle) * radius;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();

  // 目。向きを与えて「生き物」だと分かるようにする。
  const eye = Math.max(1, size * 0.055);
  ctx.fillStyle = PALETTE.bg;
  ctx.beginPath();
  ctx.arc(cx - body * 0.4, cy - body * 0.1, eye, 0, Math.PI * 2);
  ctx.arc(cx + body * 0.4, cy - body * 0.1, eye, 0, Math.PI * 2);
  ctx.fill();
}

export function drawItemHp(target: SpriteContext): void {
  const { ctx, x, y, size } = target;
  const cx = x + size / 2;
  const cy = y + size / 2;
  const arm = size * 0.13;
  const reach = size * 0.3;

  ctx.fillStyle = PALETTE.ok;
  ctx.fillRect(cx - arm, cy - reach, arm * 2, reach * 2);
  ctx.fillRect(cx - reach, cy - arm, reach * 2, arm * 2);
}

export function drawItemAtk(target: SpriteContext): void {
  const { ctx, x, y, size } = target;
  const cx = x + size / 2;
  const cy = y + size / 2;

  // 剣。細い刃と鍔で、盾（横長）と輪郭で区別する。
  ctx.fillStyle = PALETTE.accent;
  ctx.beginPath();
  ctx.moveTo(cx, cy - size * 0.34);
  ctx.lineTo(cx + size * 0.1, cy - size * 0.14);
  ctx.lineTo(cx + size * 0.06, cy + size * 0.2);
  ctx.lineTo(cx - size * 0.06, cy + size * 0.2);
  ctx.lineTo(cx - size * 0.1, cy - size * 0.14);
  ctx.closePath();
  ctx.fill();
  ctx.fillRect(cx - size * 0.2, cy + size * 0.2, size * 0.4, Math.max(1, size * 0.08));
}

export function drawItemDef(target: SpriteContext): void {
  const { ctx, x, y, size } = target;
  const cx = x + size / 2;
  const cy = y + size / 2;

  // 盾。上辺が広く下が尖る、剣とは逆の輪郭。
  ctx.fillStyle = '#7fb2e0';
  ctx.beginPath();
  ctx.moveTo(cx - size * 0.26, cy - size * 0.28);
  ctx.lineTo(cx + size * 0.26, cy - size * 0.28);
  ctx.lineTo(cx + size * 0.2, cy + size * 0.16);
  ctx.lineTo(cx, cy + size * 0.32);
  ctx.lineTo(cx - size * 0.2, cy + size * 0.16);
  ctx.closePath();
  ctx.fill();
}

export function drawItemKey(target: SpriteContext, keyId: number): void {
  const { ctx, x, y, size } = target;
  const cx = x + size / 2;
  const cy = y + size / 2;
  const style = keyStyle(keyId);

  ctx.fillStyle = style.color;
  keyMark(ctx, style.shape, cx, cy - size * 0.12, size * 0.16);
  ctx.fill();
  // 鍵の軸。扉と対にして見えるようにする。
  ctx.fillRect(cx - Math.max(1, size * 0.04), cy, Math.max(2, size * 0.08), size * 0.28);
  ctx.fillRect(cx, cy + size * 0.18, size * 0.14, Math.max(1, size * 0.07));
}

export function drawItemOrb(target: SpriteContext): void {
  const { ctx, x, y, size } = target;
  ctx.fillStyle = PALETTE.orb;
  ctx.beginPath();
  ctx.arc(x + size / 2, y + size / 2, size * 0.24, 0, Math.PI * 2);
  ctx.fill();
}

export function drawItemMasterKey(target: SpriteContext): void {
  const { ctx, x, y, size } = target;
  const cx = x + size / 2;
  const cy = y + size / 2;

  ctx.fillStyle = PALETTE.accent;
  polygon(ctx, cx, cy - size * 0.1, size * 0.18, 6, -Math.PI / 2);
  ctx.fill();
  ctx.fillRect(cx - Math.max(1, size * 0.045), cy, Math.max(2, size * 0.09), size * 0.3);
  ctx.fillRect(cx, cy + size * 0.14, size * 0.16, Math.max(1, size * 0.07));
  ctx.fillRect(cx, cy + size * 0.24, size * 0.16, Math.max(1, size * 0.07));
}

export function drawDoor(target: SpriteContext, keyId: number): void {
  const { ctx, x, y, size } = target;
  const style = keyStyle(keyId);
  const inset = size * 0.12;

  ctx.fillStyle = '#6b5a45';
  roundedRect(ctx, x + inset, y + inset * 0.6, size - inset * 2, size - inset * 1.4, size * 0.1);
  ctx.fill();

  ctx.fillStyle = '#4a3d2f';
  ctx.fillRect(x + inset, y + size * 0.48, size - inset * 2, Math.max(1, size * 0.05));

  // 鍵穴は対応する鍵と同じ形。色が分からなくても対応が読める。
  ctx.fillStyle = style.color;
  keyMark(ctx, style.shape, x + size / 2, y + size * 0.33, size * 0.11);
  ctx.fill();
}

export function drawAltar(target: SpriteContext): void {
  const { ctx, x, y, size } = target;
  const cx = x + size / 2;

  ctx.fillStyle = '#4a4058';
  ctx.fillRect(x + size * 0.2, y + size * 0.6, size * 0.6, size * 0.24);
  ctx.fillRect(x + size * 0.3, y + size * 0.44, size * 0.4, size * 0.18);

  ctx.fillStyle = PALETTE.altar;
  polygon(ctx, cx, y + size * 0.3, size * 0.18, 4, -Math.PI / 2);
  ctx.fill();
}

export function drawGoal(target: SpriteContext): void {
  const { ctx, x, y, size } = target;

  ctx.fillStyle = PALETTE.goal;
  ctx.globalAlpha = 0.22;
  ctx.fillRect(x, y, size, size);
  ctx.globalAlpha = 1;

  // 階段。「ここが出口」であることを輪郭で示す。
  const step = size * 0.18;
  for (let i = 0; i < 3; i++) {
    ctx.fillRect(x + size * 0.2, y + size * 0.66 - i * step, size * 0.6 - i * size * 0.12, step * 0.8);
  }
}

export function drawPlayer(target: SpriteContext): void {
  const { ctx, x, y, size } = target;
  const cx = x + size / 2;
  const cy = y + size / 2;

  ctx.fillStyle = PALETTE.player;
  ctx.beginPath();
  ctx.arc(cx, cy - size * 0.14, size * 0.15, 0, Math.PI * 2);
  ctx.fill();
  roundedRect(ctx, cx - size * 0.17, cy - size * 0.02, size * 0.34, size * 0.34, size * 0.1);
  ctx.fill();
}

// --- オーバーレイ -------------------------------------------------------

/**
 * 「今は通れない」を重ねる。
 *
 * 攻撃不能は太い×印、HP不足は斜線。どちらも色ではなく形で区別できる。
 * マップを見た瞬間に通れない場所が分かることを狙う。
 */
export function drawOverlay(target: SpriteContext, overlay: Overlay): void {
  if (overlay === 'none') return;
  const { ctx, x, y, size } = target;

  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, size, size);
  ctx.clip();

  if (overlay === 'unbeatable') {
    ctx.fillStyle = 'rgba(23, 20, 28, 0.55)';
    ctx.fillRect(x, y, size, size);

    ctx.strokeStyle = PALETTE.danger;
    ctx.lineWidth = Math.max(2, size * 0.1);
    ctx.lineCap = 'round';
    const pad = size * 0.24;
    ctx.beginPath();
    ctx.moveTo(x + pad, y + pad);
    ctx.lineTo(x + size - pad, y + size - pad);
    ctx.moveTo(x + size - pad, y + pad);
    ctx.lineTo(x + pad, y + size - pad);
    ctx.stroke();
  } else {
    ctx.fillStyle = 'rgba(23, 20, 28, 0.45)';
    ctx.fillRect(x, y, size, size);

    ctx.strokeStyle = 'rgba(224, 104, 90, 0.85)';
    ctx.lineWidth = Math.max(1, size * 0.055);
    const gap = size * 0.22;
    ctx.beginPath();
    for (let offset = -size; offset < size * 2; offset += gap) {
      ctx.moveTo(x + offset, y);
      ctx.lineTo(x + offset + size, y + size);
    }
    ctx.stroke();
  }

  ctx.restore();
}

// --- 種別の振り分け -----------------------------------------------------

/**
 * 敵の脅威段階。マップ内に登場する敵を強さ順に並べ、5段階に割り振る。
 *
 * 絶対値ではなく同一マップ内の相対順位にするのは、
 * どのマップでも「濃い色ほど手強い」が成立するようにするため。
 * 同じパラメータの敵は必ず同じ段階になる。
 */
export function computeThreatTiers(map: CompiledMap): ReadonlyMap<string, number> {
  const power = (hp: number, atk: number, def: number): number => hp * Math.max(atk, 1) + def * 50;

  const distinct = new Map<string, number>();
  for (const cell of map.objectCells) {
    const object = map.objectAt[cell] ?? null;
    if (object === null || object.type !== 'enemy') continue;
    distinct.set(`${object.hp}/${object.atk}/${object.def}`, power(object.hp, object.atk, object.def));
  }

  const ordered = [...distinct.entries()].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]));
  const tiers = new Map<string, number>();
  const span = Math.max(1, ordered.length);

  ordered.forEach(([key], index) => {
    tiers.set(key, Math.min(THREAT_RAMP.length - 1, Math.floor((index * THREAT_RAMP.length) / span)));
  });

  return tiers;
}

export function enemyKey(enemy: { hp: number; atk: number; def: number }): string {
  return `${enemy.hp}/${enemy.atk}/${enemy.def}`;
}

/** オブジェクトを描く。種別ごとの振り分けはここに閉じ込める。 */
export function drawObject(
  target: SpriteContext,
  object: CompiledObject,
  tiers: ReadonlyMap<string, number>,
): void {
  // マップ側でスプライトが指定されていればそちらを優先する。
  const declared = object.type === 'altar' ? undefined : object.source.sprite;
  if (declared !== undefined && drawSprite(declared, target)) return;

  switch (object.type) {
    case 'enemy':
      drawEnemy(target, tiers.get(enemyKey(object)) ?? 0);
      return;

    case 'door':
      drawDoor(target, object.keyId);
      return;

    case 'altar':
      drawAltar(target);
      return;

    case 'item':
      switch (object.effect.kind) {
        case 'hp':
          drawItemHp(target);
          return;
        case 'atk':
          drawItemAtk(target);
          return;
        case 'def':
          drawItemDef(target);
          return;
        case 'orb':
          drawItemOrb(target);
          return;
        case 'key':
          drawItemKey(target, object.effect.keyId);
          return;
        case 'masterKey':
          drawItemMasterKey(target);
          return;
      }
  }
}
