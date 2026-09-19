# Electron正式移行

## 目的

会社管理下のWindows 11端末で、外部ブラウザのポリシーやlocalhost通信制限に依存せず、既存の案件・編集ワークフローを利用できるようにする。

`codex/electron-feasibility`で確認したElectron内蔵Chromiumのページ表示、認証状態保持、リンク抽出、自己完結HTML生成を、既存のWeb Revision Desk編集画面へ段階的に接続する。安定版`main`は移行確認が完了するまで変更しない。

## 第1段階で接続した機能

- 既存の案件一覧・ページ編集画面をElectron内で表示
- OS標準ダイアログによる案件フォルダ選択
- 案件フォルダ内の`project.json`とページ成果物の読み書き
- Electron内蔵Chromiumによる関連ページ検索
- 未取得ページの画像プレビュー
- 表示中ページの手動取り込み
- 選択ページの直接取得・一括取得
- 同一Electronセッションを使うログイン待機
- CSS・画像を埋め込んだ自己完結HTMLの生成

編集、Undo/Redo、変更箇所表示、差分生成、案件保存は既存画面の実装をそのまま使用する。

## 実行方法

```bash
npm ci
npm run electron:dev
```

`electron:dev`は先に画面をビルドしてからElectron版を開く。従来の機能検証画面は次で開ける。

```bash
npm run electron:feasibility
```

## Windows検証ZIP

`codex/electron-migration`へのpushでGitHub Actionsの`Electron Migration Windows`を実行する。処理完了後、Artifactsの`WebRevisionDesk-electron-migration-windows-*`をダウンロードして展開し、`Start-WebRevisionDesk-Electron.cmd`を実行する。

このZIPは移行確認用であり、現時点では安定版の自動更新対象ではない。

## セキュリティ境界

- 編集画面と外部Webページを別のレンダラー・別の権限で実行する
- 外部ページではNode.js連携を無効化し、Electron APIを公開しない
- 編集画面に公開する操作はページ取得と案件フォルダ操作に限定する
- 案件フォルダ操作は利用者が選んだフォルダ配下だけを許可する
- カメラ、位置情報等の権限要求と外部ページからのダウンロードを拒否する
- TLS証明書エラーを迂回しない

## 続く確認項目

1. Windows会社端末で案件フォルダを新規作成・再度開けること
2. 関連ページ検索、画像プレビュー、単独・一括取り込みが動くこと
3. ログインが必要なページで認証状態が維持されること
4. テキスト、リンク、画像、class、要素順序を編集して保存できること
5. 再起動後も保存済み案件を開いて編集を継続できること
6. 共有用ZIPおよび各HTMLの保存方法をElectronネイティブ保存へ移行すること
7. Electron版に適した署名・配布・更新方式を決定すること

