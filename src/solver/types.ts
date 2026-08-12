/**
 * 探索器の公開型。設計 §7。
 */

/**
 * マクロ行動。探索の分岐単位。
 *
 * 1マス移動は分岐にしない。自由領域内の移動は状態を変えないので、
 * 実際の意思決定は「次にどのオブジェクトを解決するか」だけである（設計 §7.2）。
 * UIの入力単位（§11.1）もこれと一致させてある。
 */
export type MacroAction =
  /** 対象セルまで歩いて解決する（戦闘・取得・開錠）。 */
  | { readonly kind: 'resolve'; readonly cell: number }
  /** 祭壇まで歩いて交換する。 */
  | { readonly kind: 'exchange'; readonly slot: number; readonly altarCell: number }
  /** ゴールへ歩く。手順の最後にだけ現れる。 */
  | { readonly kind: 'goal'; readonly cell: number };

export type SolveStatus =
  /** 解が見つかった。 */
  | 'solved'
  /** 探索を完全に尽くしたが解が存在しない。詰み。 */
  | 'dead'
  /**
   * 予算切れ、または探索を打ち切ったため判定できなかった。
   * **これを「解なし」として扱ってはならない**（設計 §7.6 / §7.8）。
   */
  | 'unknown';

export interface SolveStats {
  /** 展開した状態数。 */
  readonly expanded: number;
  /** 生成した後続状態数。 */
  readonly generated: number;
  /** 支配関係で捨てた状態数。 */
  readonly dominated: number;
  /** 緩和判定で詰みと分かって捨てた状態数。 */
  readonly hopeless: number;
  /** 上界がすでに見つけた解に届かず捨てた状態数。 */
  readonly bounded: number;
  /** 強制手として分岐せずに適用した解決の数（設計 §7.3）。 */
  readonly forced: number;
  /**
   * 支配関係で潰れずに2つ以上の選択肢が残った局面の数。
   * 設計 §8.3 の `decisionPoints`。プレイヤーが実際に考える必要のある回数にあたる。
   */
  readonly branching: number;
  /**
   * 予算・ビーム幅・中断のいずれかで探索木を削ったか。
   * これが true のとき、解が見つからなくても `dead` と結論してはならない。
   */
  readonly truncated: boolean;
}

export interface SolveOptions {
  /**
   * `maxHp`（既定）は終了時HPが最大の解を探す。探索を尽くす必要がある。
   * `firstSolution` は最初に見つけた解で打ち切る。到達可能性の判定に使う。
   */
  readonly objective?: 'maxHp' | 'firstSolution';
  /** 展開する状態数の上限。超えたら `unknown` を返す。 */
  readonly maxStates?: number;
  /**
   * 保持する未展開状態の上限。超えたらHPの低いものから捨てる（ビーム探索）。
   * 設定すると探索は不完全になり、解が無くても `dead` ではなく `unknown` になる。
   */
  readonly beamWidth?: number;
  /** 中断の問い合わせ。Worker はここで受信済みの中断要求を見る（設計 §7.8）。 */
  readonly shouldStop?: () => boolean;
  /** 進捗の通知。数秒かかりうるので無反応時間を作らない（設計 §7.8）。 */
  readonly onProgress?: (stats: SolveStats) => void;
  /** 進捗を通知する間隔（展開数）。 */
  readonly progressInterval?: number;
}

export interface SolveResult {
  readonly status: SolveStatus;
  /** 解の手順。`status` が `solved` のときのみ非 null。 */
  readonly plan: readonly MacroAction[] | null;
  /** 解の終了時HP。 */
  readonly finalHp: number | null;
  readonly stats: SolveStats;
}

export interface HintResult {
  readonly status: 'solvable' | 'dead' | 'unknown';
  /** 次に解決すべき対象。UIはこれをそのまま「このマスを選べ」として提示できる。 */
  readonly nextAction: MacroAction | null;
  /** 残りのマクロ行動数。 */
  readonly actionsRemaining: number | null;
  readonly finalHp: number | null;
  readonly stats: SolveStats;
}
