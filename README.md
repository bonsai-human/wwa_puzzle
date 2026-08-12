# wwa_puzzle

WWA（World Wide Adventure）系の見下ろし2Dパズルゲーム。
GitHub Pages 上で動作する静的Webアプリ。

マップ上のリソース（HP・攻撃力・防御力・鍵・オーブ）をどの順序で回収し、
どの敵を倒し、どの扉を開けるかを決める、完全情報のリソース配分パズル。
乱数はなく、実質的には詰将棋にあたる。

## 進捗

| Phase | 内容 | 状態 |
|---|---|---|
| 0 | 土台（Vite + TS + Vitest + CI + Pages） | 完了 |
| 1 | `core/` ルールエンジン | 完了 |
| 2 | `solver/` 探索器 | — |
| 3 | `game/` 描画・入力・情報パネル | — |
| 4 | `editor/` マップエディタ | — |
| 5 | `gen/` 自動生成と難易度評価 | — |
| 6 | ヒント・詰み検出・共有URL・保存 | — |

設計の全体像は [docs/design.md](docs/design.md) を参照。
ルール仕様・データ形式・ソルバー・自動生成・デバイス対応・デプロイ方針を記載している。

## 開発

```sh
npm install
npm run dev         # 開発サーバー
npm run typecheck   # 型チェック
npm test            # テスト
npm run build       # 本番ビルド（型チェック込み）
npm run preview     # ビルド結果を配信して確認
```

### レスポンシブ確認

デスクトップからスマートフォンまでを対象にしているため、
複数のビューポートで描画を確認する（設計 §11）。

```sh
npm run build
npm run preview &
npm run shot        # screenshots/ にビューポート別のスクリーンショットを出力
```

コンソールエラーと横スクロールの発生は自動で検出する。
盤面と数値が読める大きさに収まっているかは目視で確認する。

## 構成

| ディレクトリ | 役割 |
|---|---|
| `src/core/` | 純粋なルールエンジン。DOM・I/O・乱数に依存しない |
| `src/solver/` | 解の探索、詰み検出、ヒント。Web Worker 上で動作 |
| `src/gen/` | マップの自動生成と難易度評価 |
| `src/editor/` | マップエディタ |
| `src/game/` | Canvas 描画・入力・UI |

`src/core/` が他モジュール・実行環境・乱数に依存しないことは
`tests/boundaries.test.ts` が機械的に検査する。
ゲーム本体・ソルバー・自動生成が同じルール実装を共有することが、
このプロジェクトの正しさの前提になっている。

## デプロイ

`main` への push で CI（型チェック・テスト・ビルド）が走り、
成功した場合のみ GitHub Pages へ配信される。

リポジトリ設定の Pages ソースを「GitHub Actions」にしておくこと。
プロジェクトページはサブパス配信になるため、`vite.config.ts` の `base` は
リポジトリ名と一致させる必要がある。
