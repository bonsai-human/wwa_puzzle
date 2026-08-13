/**
 * 情報パネル。設計 §11.7 / §11.8。
 *
 * 判断に必要な情報はすべてここに常設で出す。ツールチップやホバーは使わない。
 * タッチデバイスにホバーは存在しないので、それに頼ると片方のデバイスで
 * 情報が消える（設計 §11.2）。
 */

import { battleCost, checkExchange, isConsumed, xOf, yOf } from '../core/index.ts';
import type { CompiledMap, CompiledOption, GameState } from '../core/index.ts';
import { keyStyle } from './theme.ts';
import { enemyKey, computeThreatTiers } from './sprites.ts';
import {
  describeBlockReason,
  describeEffect,
  describeObject,
  enemyName,
  keyName,
  previewEffect,
} from './format.ts';
import type { Session } from './session.ts';
import type { BlockReason } from '../core/index.ts';

type EnemyView = 'cost' | 'stats';

/** ヒントの段階。設計 §7.7：いきなり答えを出さず、段階的に開く。 */
export type HintStage = 0 | 1 | 2;

export interface HintView {
  readonly status: 'solvable' | 'dead' | 'unknown' | 'pending' | 'cleared';
  readonly stage: HintStage;
  /** 次に解決すべきマス。段階2で盤面にも印がつく。 */
  readonly cell: number | null;
  /** 次の対象がある画面。段階1ではここまでしか言わない。 */
  readonly direction: string | null;
  readonly actionsRemaining: number | null;
  /** 直前の一手で詰んだか。 */
  readonly justDied: boolean;
}

export interface PanelCallbacks {
  readonly onUndo: () => void;
  readonly onRedo: () => void;
  readonly onReset: () => void;
  readonly onExchange: (slot: number) => void;
  readonly onResolveSelected: () => void;
  readonly onToggleOverview: () => void;
  readonly onHint: () => void;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== undefined) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(label: string, className: string, onClick: () => void): HTMLButtonElement {
  const node = el('button', className, label);
  node.type = 'button';
  node.addEventListener('click', onClick);
  return node;
}

export class InfoPanel {
  readonly root = el('div', 'panel');

  private readonly statsBox = el('div', 'stats');
  private readonly messageBox = el('p', 'message');
  private readonly detailBox = el('div', 'detail');
  private readonly enemyBox = el('div', 'enemies');
  private readonly enemyToggle = el('div', 'segmented');
  private readonly undoButton: HTMLButtonElement;
  private readonly redoButton: HTMLButtonElement;
  private readonly altarButton: HTMLButtonElement;
  private readonly altarDialog = el('dialog', 'sheet');
  private readonly altarBody = el('div', 'sheet-body');
  private readonly hintBox = el('div', 'hint');
  private readonly hintButton: HTMLButtonElement;
  private readonly tabBar = el('div', 'panel-tabs');
  private sections: HTMLElement[] = [];
  private activeTab = 'status';
  private hintView: HintView = {
    status: 'pending',
    stage: 0,
    cell: null,
    direction: null,
    actionsRemaining: null,
    justDied: false,
  };

  private enemyView: EnemyView = 'cost';
  private message: string | null = null;
  private readonly tiers: ReadonlyMap<string, number>;

  constructor(
    private readonly session: Session,
    private readonly callbacks: PanelCallbacks,
  ) {
    this.tiers = computeThreatTiers(session.map);

    this.hintButton = button('ヒント', 'control', () => {
      this.showTab('status');
      callbacks.onHint();
    });
    this.undoButton = button('戻す', 'control primary', callbacks.onUndo);
    this.redoButton = button('進める', 'control', callbacks.onRedo);
    this.altarButton = button('祭壇を開く', 'control', () => this.openAltar());

    // 常時見せる操作は4つまで。狭い画面では1行に収まらないと、
    // そのぶん盤面の高さが削られる。
    const controls = el('div', 'controls');
    controls.append(
      this.undoButton,
      this.redoButton,
      button('地図', 'control', callbacks.onToggleOverview),
      this.hintButton,
    );

    this.buildEnemyToggle();

    const enemySection = el('section', 'section panel-section');
    enemySection.dataset['tab'] = 'enemies';
    const enemyHead = el('div', 'section-head');
    enemyHead.append(el('h2', undefined, 'この画面の敵'), this.enemyToggle);
    enemySection.append(enemyHead, this.enemyBox);

    const detailSection = el('section', 'section panel-section');
    detailSection.dataset['tab'] = 'detail';
    detailSection.append(el('h2', undefined, '選択中'), this.detailBox);

    this.altarDialog.append(this.altarBody);
    const closeRow = el('div', 'sheet-actions');
    closeRow.append(button('閉じる', 'control', () => this.altarDialog.close()));
    this.altarDialog.append(closeRow);

    const hintSection = el('section', 'section panel-section');
    hintSection.dataset['tab'] = 'status';
    hintSection.append(el('h2', undefined, '状況'), this.hintBox);

    // 狭い画面では3つの節を切り替えて出す。全部同時に出すと、
    // その高さぶんだけ盤面が縮む。横長では CSS 側でタブを畳んで全部見せる。
    for (const [tab, label] of [
      ['status', '状況'],
      ['enemies', '敵'],
      ['detail', '選択'],
    ] as const) {
      const node = button(label, 'tab', () => this.showTab(tab));
      node.dataset['tab'] = tab;
      this.tabBar.append(node);
    }

    this.sections = [hintSection, enemySection, detailSection];

    this.root.append(
      this.statsBox,
      controls,
      this.altarButton,
      this.messageBox,
      this.tabBar,
      hintSection,
      enemySection,
      detailSection,
      this.altarDialog,
    );

    this.showTab('status');
  }

  /** 節の切り替え。横長では CSS がタブを畳むので、この状態は無視される。 */
  showTab(tab: string): void {
    this.activeTab = tab;

    for (const section of this.sections) {
      section.classList.toggle('is-active', section.dataset['tab'] === tab);
    }
    for (const node of this.tabBar.children) {
      node.classList.toggle('is-active', (node as HTMLElement).dataset['tab'] === tab);
    }
  }

  setHint(view: HintView): void {
    this.hintView = view;
  }

  /** 進入に失敗した理由などの短い通知。 */
  notify(text: string | null): void {
    this.message = text;
  }

  notifyBlocked(reason: BlockReason): void {
    this.notify(describeBlockReason(this.session.map, reason));
  }

  update(): void {
    const { map } = this.session;
    const state = this.session.state;

    this.renderStats(map, state);
    this.renderHint();
    this.renderEnemies(map, state);
    this.renderDetail(map, state);

    this.messageBox.textContent = this.message ?? '';
    this.messageBox.hidden = this.message === null;

    this.undoButton.disabled = !this.session.canUndo;
    this.redoButton.disabled = !this.session.canRedo;

    const altar = this.altarUnderPlayer();
    this.altarButton.hidden = altar === null;

    if (this.altarDialog.open) {
      if (altar === null) this.altarDialog.close();
      else this.renderAltar();
    }
  }

  /** 祭壇に乗ったときに開く。交換は選択→確定の2段操作にする（設計 §11.7）。 */
  openAltar(): void {
    if (this.altarUnderPlayer() === null) return;
    this.renderAltar();
    if (!this.altarDialog.open) this.altarDialog.showModal();
  }

  private altarUnderPlayer(): readonly number[] | null {
    const object = this.session.map.objectAt[this.session.state.pos] ?? null;
    return object !== null && object.type === 'altar' ? object.slots : null;
  }

  private buildEnemyToggle(): void {
    // 修飾キー専用のトグルにはしない。すべての操作にタップ可能なUIを用意する（設計 §11.2）。
    const views: readonly [EnemyView, string][] = [
      ['cost', '撃破コスト'],
      ['stats', 'パラメータ'],
    ];

    for (const [view, label] of views) {
      const node = button(label, 'segment', () => {
        this.enemyView = view;
        this.update();
      });
      node.dataset['view'] = view;
      this.enemyToggle.append(node);
    }
  }

  /**
   * 詰み・ヒントの表示。
   *
   * プレイヤーは詰みを難しさと区別できないので、解けなくなったことは
   * 黙っていてはいけない。一方で最初から答えを出すとパズルが消えるため、
   * 押すたびに一段ずつ開く（設計 §7.7）。
   */
  private renderHint(): void {
    const view = this.hintView;
    this.hintBox.dataset['status'] = view.status;
    this.hintButton.disabled = view.status !== 'solvable';

    const nodes: HTMLElement[] = [];

    switch (view.status) {
      case 'pending':
        nodes.push(el('p', 'hint-line', '確認中…'));
        break;

      case 'cleared':
        nodes.push(el('p', 'hint-line', 'クリア済み。'));
        break;

      case 'dead':
        nodes.push(
          el(
            'p',
            'hint-line',
            view.justDied
              ? 'この一手で詰みました。「戻す」でやり直せます。'
              : 'この盤面はもう解けません。「戻す」でやり直せます。',
          ),
        );
        break;

      case 'unknown':
        // 予算切れを「解なし」と言ってはいけない（設計 §7.6）。
        nodes.push(el('p', 'hint-line', '判定できませんでした。盤面が大きすぎます。'));
        break;

      case 'solvable':
        nodes.push(el('p', 'hint-line', 'まだ解けます。'));
        if (view.stage >= 1 && view.direction !== null) {
          nodes.push(el('p', 'hint-line', `次は${view.direction}。`));
        }
        if (view.stage >= 2 && view.cell !== null) {
          nodes.push(el('p', 'hint-line', `次に触るのは印のマスです（残り ${view.actionsRemaining ?? '?'} 手）。`));
        }
        if (view.stage < 2) {
          nodes.push(el('p', 'hint-note', 'ヒントを押すともう一段開きます。'));
        }
        break;
    }

    this.hintBox.replaceChildren(...nodes);
  }

  /**
   * 自分の数値。
   *
   * 狭い画面では長短2つのラベルを持たせ、CSS で切り替える。
   * 1行に収まらないと右端で数字が切れるが、**数字はこのゲームの判断材料そのもの**で、
   * 切れて読めないのは折り返して盤面が縮むのと同じくらい悪い。
   */
  private renderStats(map: CompiledMap, state: GameState): void {
    const entries: [string, string, string, string | null][] = [
      ['HP', 'HP', String(state.hp), null],
      ['攻撃力', '攻', String(state.atk), null],
      ['防御力', '防', String(state.def), null],
      ['オーブ', '珠', String(state.orbs[0] ?? 0), null],
    ];

    map.keyColors.forEach((color, id) => {
      entries.push([`${color}の鍵`, color, String(state.keys[id] ?? 0), keyStyle(id).color]);
    });

    if (state.masterKey > 0) {
      entries.push([
        'マスターキー',
        'master',
        map.masterKeyMode === 'permanent' ? '所持' : String(state.masterKey),
        null,
      ]);
    }

    this.statsBox.replaceChildren(
      ...entries.map(([long, short, value, accent]) => {
        const box = el('div', 'stat');
        const name = el('span', 'stat-label');
        name.append(el('span', 'label-long', long), el('span', 'label-short', short));
        if (accent !== null) name.style.color = accent;
        box.append(name, el('span', 'stat-value', value));
        return box;
      }),
    );
  }

  /**
   * 現在の画面に出ている敵の一覧。
   *
   * 撃破コストを常時再計算して見せるのは親切心ではなく、
   * これが無いとプレイヤーが暗算を強いられ、パズルではなく計算問題になるからである。
   */
  private renderEnemies(map: CompiledMap, state: GameState): void {
    const screen = this.session.screen;
    const grouped = new Map<
      string,
      { count: number; enemy: { hp: number; atk: number; def: number; orb: number; source: { name?: string } } }
    >();

    for (const cell of map.objectCells) {
      const object = map.objectAt[cell] ?? null;
      if (object === null || object.type !== 'enemy' || isConsumed(state, cell)) continue;
      if (Math.floor(xOf(map, cell) / map.screen.width) !== screen.x) continue;
      if (Math.floor(yOf(map, cell) / map.screen.height) !== screen.y) continue;

      const key = enemyKey(object);
      const existing = grouped.get(key);
      if (existing === undefined) grouped.set(key, { count: 1, enemy: object });
      else existing.count += 1;
    }

    for (const node of this.enemyToggle.children) {
      node.classList.toggle('is-active', (node as HTMLElement).dataset['view'] === this.enemyView);
    }

    if (grouped.size === 0) {
      this.enemyBox.replaceChildren(el('p', 'empty', 'この画面に敵はいません。'));
      return;
    }

    const rows = [...grouped.entries()]
      .sort((a, b) => (this.tiers.get(a[0]) ?? 0) - (this.tiers.get(b[0]) ?? 0))
      .map(([key, { count, enemy }]) => {
        const row = el('div', 'enemy');
        const tier = this.tiers.get(key) ?? 0;

        const mark = el('span', 'enemy-mark');
        mark.dataset['tier'] = String(tier);
        row.append(mark);

        row.append(el('span', 'enemy-name', `${enemyName(enemy as never)} ×${count}`));

        if (this.enemyView === 'stats') {
          row.append(
            el('span', 'enemy-value', `HP ${enemy.hp} / 攻 ${enemy.atk} / 防 ${enemy.def}`),
          );
        } else {
          const cost = battleCost(state, enemy);
          const value = el('span', 'enemy-value', cost === null ? '攻撃不能' : String(cost));
          if (cost === null) value.classList.add('is-impossible');
          else if (state.hp <= cost) value.classList.add('is-unaffordable');
          row.append(value);
        }

        return row;
      });

    this.enemyBox.replaceChildren(...rows);
  }

  private renderDetail(map: CompiledMap, state: GameState): void {
    const cell = this.session.selected;
    // 選んだのに別のタブが出ていると、何も起きていないように見える。
    if (cell !== null && this.activeTab !== 'detail') this.showTab('detail');
    if (cell === null) {
      this.detailBox.replaceChildren(
        el('p', 'empty', 'マスを選ぶと、そのマスの情報がすべてここに出ます。'),
      );
      return;
    }

    const object = map.objectAt[cell] ?? null;
    if (object === null || (object.type !== 'altar' && isConsumed(state, cell))) {
      this.detailBox.replaceChildren(el('p', 'empty', '何もありません。'));
      return;
    }

    const detail = describeObject(map, state, object);
    const nodes: HTMLElement[] = [el('h3', 'detail-title', detail.title)];

    const list = el('dl', 'detail-rows');
    for (const [label, value] of detail.rows) {
      list.append(el('dt', undefined, label), el('dd', undefined, value));
    }
    nodes.push(list);

    if (detail.warning !== null) nodes.push(el('p', 'warning', detail.warning));

    // 2回目のタップで実行、という関係をボタンでも示す。
    if (detail.warning === null && object.type !== 'altar') {
      nodes.push(button('ここへ進む', 'control primary', this.callbacks.onResolveSelected));
    }

    this.detailBox.replaceChildren(...nodes);
  }

  private renderAltar(): void {
    const { map } = this.session;
    const state = this.session.state;
    const slots = this.altarUnderPlayer();
    if (slots === null) return;

    const nodes: HTMLElement[] = [
      el('h2', undefined, '祭壇'),
      el('p', 'sheet-lead', `所持オーブ ${state.orbs[0] ?? 0}`),
    ];

    for (const slot of slots) {
      const option = map.options[slot];
      if (option === undefined) continue;

      nodes.push(this.altarOption(option, slot));
    }

    this.altarBody.replaceChildren(...nodes);
  }

  private altarOption(option: CompiledOption, slot: number): HTMLElement {
    const { map } = this.session;
    const state = this.session.state;
    const check = checkExchange(map, state, slot);

    const box = el('div', 'option');
    box.append(el('span', 'option-label', option.source.label ?? describeEffect(map, option.effect)));
    box.append(el('span', 'option-cost', `オーブ ${option.cost}`));

    // 「どちらを選ぶと何が変わるか」を並べないと排他選択の判断ができない。
    const preview = previewEffect(map, state, option.effect);
    if (preview !== null) box.append(el('span', 'option-preview', preview));

    if (Number.isFinite(option.stock)) {
      const left = option.stock - (state.altarUsed[slot] ?? 0);
      box.append(el('span', 'option-stock', `残り ${Math.max(0, left)}`));
    }

    const confirm = button('交換する', 'control primary', () => this.callbacks.onExchange(slot));
    confirm.disabled = !check.ok;
    box.append(confirm);

    if (!check.ok) {
      const reason =
        check.reason.kind === 'outOfStock'
          ? '在庫がありません。'
          : check.reason.kind === 'insufficientOrbs'
            ? `オーブが ${check.reason.cost - check.reason.have} 足りません。`
            : '祭壇に立っていません。';
      box.append(el('span', 'option-reason', reason));
    }

    return box;
  }

  /** 鍵の色名を外から引けるようにしておく（メッセージ生成用）。 */
  keyLabel(keyId: number): string {
    return keyName(this.session.map, keyId);
  }
}
