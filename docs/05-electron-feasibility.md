# Electron機能検証

## 目的

Playwright、外部ブラウザ、localhostのHTTP APIを使わず、Electron内蔵ChromiumだけでWeb Revision Deskのページ取得機能を実現できるか確認する。

この検証版は正式アプリへの移行版ではない。会社名や特定組織の設定を含まず、任意のWindows環境で次の技術要件を確認するためのものである。

- Electronアプリの起動
- HTTPSページの表示
- Cookieを含むログイン状態の保持
- 現在ページのリンクと関連ファイルの列挙
- 指定URL配下の再帰的なページ確認
- CSS・画像等を埋め込んだHTMLの生成
- スクリーンショット取得
- ローカルフォルダへの直接保存
- プロキシ、証明書、通信失敗の診断記録

## セキュリティ構成

- アプリ画面と外部ページを別のRendererに分離する
- 外部ページでは`nodeIntegration: false`、`contextIsolation: true`、sandbox有効とする
- 外部ページへElectron APIやファイルAPIを公開しない
- アプリ画面からMain Processへ公開するIPCを用途別の関数に限定する
- localhostサーバーを起動しない
- 証明書エラーを無視しない
- カメラ、位置情報等の権限要求を既定で拒否する
- ログにはURLのクエリ、フラグメント、ユーザー情報を残さない

## Macでの起動

```bash
npm ci
npm run electron:dev
```

検証画面でURLを入力し「Electronで開く」を押す。別のElectron画面で必要なログインや表示操作を行った後、検証画面へ戻って解析、配下確認、保存を実行する。

## Windows検証ZIP

`codex/electron-feasibility`へのpushでGitHub Actionsの`Electron Feasibility Windows`が実行される。完了後、Actions実行画面のArtifactsからWindows ZIPを取得する。

ZIPを展開し、`Start-Electron-Feasibility.cmd`を実行する。正式版と設定領域を分離しているため、現行アプリと併用できる。

## 保存される検証結果

- `captured.html`：CSS・画像等を可能な範囲で埋め込んだHTML
- `screenshot.png`：表示領域のスクリーンショット
- `links.json`：表示ページで検出したリンク
- `capture.json`：取得件数と対象ページ情報
- `crawl.json`：配下ページ確認結果
- `diagnostics.json`：Electron、Chromium、プロキシ、通信エラー等

Electronのユーザーデータ領域には`logs/electron-feasibility.log`も保存する。Cookie自体、認証ヘッダー、ページ本文は診断ログへ記録しない。

## 合格条件

1. 配布ZIPを管理者権限なしで展開・起動できる
2. 対象ページがElectron内に表示される
3. 必要な場合にログインでき、同じセッションでページ解析できる
4. 配下ページ一覧を取得できる
5. 保存した`captured.html`と`screenshot.png`でページ内容を確認できる
6. 失敗した場合に`diagnostics.json`からプロキシ、証明書、通信エラーを判別できる

検証合格後、編集・案件管理・差分出力を`codex/electron-migration`で正式移行する。
