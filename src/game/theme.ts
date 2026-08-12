/**
 * 配色。Canvas と CSS の両方から同じ値を使う。
 *
 * 盤面は Canvas、情報パネルは DOM で描くので、色を二重に定義すると必ずずれる。
 * ここを唯一の出典にして、CSS 変数は起動時に流し込む（{@link applyTheme}）。
 */

export const PALETTE = {
  bg: '#17141c',
  panel: '#221d2b',
  panelSoft: '#2b2436',
  line: '#3a3243',
  fg: '#ece7f2',
  fgDim: '#9c93a8',
  accent: '#d9a441',
  danger: '#e0685a',
  ok: '#7ee0a8',

  floor: '#241f2e',
  floorAlt: '#2a2436',
  wall: '#57496e',
  wallEdge: '#6d5d87',

  player: '#8fd3e8',
  goal: '#7ee0a8',
  altar: '#c58ce0',
  orb: '#e07ec9',
} as const;

/**
 * 敵の脅威段階の色ランプ。弱い順。
 *
 * 段階は敵自身のパラメータだけで決まる。プレイヤーの状態では変わらない。
 * 同じ性能の敵が違って見えたり、違う性能の敵が同じに見えたりすると、
 * 盤面を読むという行為が成立しなくなる（設計 §11.4）。
 */
export const THREAT_RAMP = ['#79c47f', '#c9c46a', '#dda05c', '#dd6f5c', '#c163c9'] as const;

/**
 * 鍵と扉の色。色覚多様性に配慮して、色だけでなく形でも区別する（設計 §11.4）。
 * 添字は `CompiledMap.keyColors` の色ID。
 */
export const KEY_STYLES = [
  { color: '#e05a6a', shape: 'circle' },
  { color: '#5a9ae0', shape: 'triangle' },
  { color: '#e0c05a', shape: 'square' },
  { color: '#7ee0a8', shape: 'diamond' },
  { color: '#c58ce0', shape: 'hexagon' },
] as const;

export type KeyShape = (typeof KEY_STYLES)[number]['shape'];

export function keyStyle(keyId: number): (typeof KEY_STYLES)[number] {
  return KEY_STYLES[keyId % KEY_STYLES.length]!;
}

/** パレットを CSS 変数として流し込む。 */
export function applyTheme(root: HTMLElement = document.documentElement): void {
  for (const [name, value] of Object.entries(PALETTE)) {
    root.style.setProperty(`--${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`, value);
  }
}
