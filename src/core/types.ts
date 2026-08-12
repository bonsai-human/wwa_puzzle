/**
 * マップデータとゲーム状態の型定義。設計 §4 / §5。
 *
 * このファイルを含む `core/` 配下は、実行環境にも乱数にも依存しない。
 * ゲーム本体・ソルバー・自動生成の三者が同じ定義を共有することが、
 * このプロジェクトの正しさの前提になっている（tests/boundaries.test.ts が検査）。
 */

/** 鍵と扉の色。マップ側で自由に定義する。 */
export type KeyColor = string;

/** 描画に使うスプライトの識別子。core はこの値を解釈しない。 */
export type SpriteId = string;

export interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * マップに書ける数値の上限。
 *
 * 戦闘コストは `(手数 - 1) * 1発の被害` で、手数も被害も最大でこの値になりうる。
 * 積が 2^53 を超えると整数演算が壊れるため、積が安全域に収まる値を選んでいる
 * （1e7 * 1e7 = 1e14 < 9.0e15）。
 */
export const MAX_STAT = 10_000_000;

/** 1画面のマス数の既定値。設計 §3.7。 */
export const DEFAULT_SCREEN = { width: 16, height: 16 } as const;

export type MasterKeyMode = 'permanent' | 'wildcard';

export type Effect =
  | { readonly kind: 'hp'; readonly amount: number }
  | { readonly kind: 'atk'; readonly amount: number }
  | { readonly kind: 'def'; readonly amount: number }
  | { readonly kind: 'orb'; readonly amount: number }
  | { readonly kind: 'key'; readonly key: KeyColor; readonly amount: number }
  /** wildcard モードでの枚数。permanent モードでは枚数は無視され、恒久フラグが立つ。 */
  | { readonly kind: 'masterKey'; readonly amount?: number };

export interface EnemyDef {
  readonly type: 'enemy';
  readonly name?: string;
  readonly sprite?: SpriteId;
  readonly hp: number;
  readonly atk: number;
  readonly def: number;
  /** 撃破時に得られるオーブ数。既定 1。 */
  readonly orb?: number;
}

export interface ItemDef {
  readonly type: 'item';
  readonly sprite?: SpriteId;
  readonly effect: Effect;
}

export interface DoorDef {
  readonly type: 'door';
  readonly sprite?: SpriteId;
  readonly key: KeyColor;
}

export interface AltarOption {
  readonly id: string;
  readonly label?: string;
  /** 消費オーブ数。 */
  readonly cost: number;
  readonly effect: Effect;
  /** 交換回数の上限。省略で無制限。 */
  readonly stock?: number;
}

export interface AltarDef {
  readonly type: 'altar';
  readonly id: string;
  readonly sprite?: SpriteId;
  readonly options: readonly AltarOption[];
}

export type ObjectDef = EnemyDef | ItemDef | DoorDef | AltarDef;

export type PlacedObject = ObjectDef & Point;

/** 自動生成が測る難易度指標。設計 §8.3。Phase 5 で埋める。 */
export interface DifficultyReport {
  readonly hpMargin?: number;
  readonly greedyFails?: boolean;
  readonly decisionPoints?: number;
  readonly trapCount?: number;
  readonly solutionCount?: number;
  readonly criticalPath?: number;
}

export interface MapDef {
  readonly formatVersion: 1;
  readonly id: string;
  readonly name: string;
  /** マップ全体の幅。`screen.width` の整数倍。 */
  readonly width: number;
  /** マップ全体の高さ。`screen.height` の整数倍。 */
  readonly height: number;
  /** 1画面のマス数。表示専用でルールには影響しない（設計 §3.7）。 */
  readonly screen?: { readonly width: number; readonly height: number };

  readonly start: Point;
  readonly goal: Point;

  readonly player: {
    readonly hp: number;
    readonly atk: number;
    readonly def: number;
    readonly keys?: Readonly<Record<KeyColor, number>>;
    readonly orbs?: number;
    readonly masterKey?: number;
  };

  /** 既定 'permanent'。設計 §3.4。 */
  readonly masterKeyMode?: MasterKeyMode;

  /** 地形。`height` 行 × `width` 文字。'.' = 床、'#' = 壁。 */
  readonly terrain: readonly string[];

  readonly objects: readonly PlacedObject[];

  readonly meta?: {
    readonly seed?: number;
    readonly difficulty?: DifficultyReport;
    readonly author?: string;
  };
}

/**
 * ゲーム状態。設計 §5。
 *
 * 不変条件：`atk` / `def` / `keys` / `orbs` / `masterKey` は
 * 「消費済み集合」と「祭壇での交換選択」だけで決まり、訪問順序に依存しない。
 * 順序に依存する量は `hp` だけである。ソルバーの支配関係（§7.4）はこれに依拠する。
 *
 * 配列は状態ごとに独立して所有する。共有すると `cloneState` の意味が壊れる。
 */
export interface GameState {
  /** セルインデックス `y * width + x`。 */
  pos: number;
  hp: number;
  atk: number;
  def: number;
  /** 色ID → 所持本数。色IDは `CompiledMap.keyColors` の添字。 */
  readonly keys: Int32Array;
  /** オーブ種別 → 個数。初版は長さ1（設計 §4 の注記）。 */
  readonly orbs: Int32Array;
  /** permanent モードでは 0/1、wildcard モードでは枚数。 */
  masterKey: number;
  /** 解決済みオブジェクトのセル集合。単調増加する。 */
  readonly consumed: Uint32Array;
  /** 祭壇の交換肢スロット → 使用回数。 */
  readonly altarUsed: Int32Array;
}
