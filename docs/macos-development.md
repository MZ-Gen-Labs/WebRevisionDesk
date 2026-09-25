# macOSでの開発ビルドと起動

このプロジェクトをmacOSで開発するときのビルド・起動手順です。

## 重要: アプリケーションの動作形態

**本アプリはElectron専用のデスクトップアプリケーションです。**

- **通常のWebブラウザ（Chrome / Safari等）や `file://` スキームで `index.html` または `dist/index.html` を直接開かないでください。**
- スタイルシートやJavaScriptはルート相対パス（`/assets/...`）で読み込まれるため、ブラウザやローカルファイルとして直接開くと 404 エラーとなり、**CSSが一切適用されず画面レイアウトが完全に崩れます**。
- また、ファイルシステムアクセスやローカルAPIはElectronのpreloadブリッジ（`window.webRevisionDesktop`）に依存しているため、ブラウザ環境では動作しません。必ず下記のElectron起動コマンドを使用してください。

## 開発モードで起動

リポジトリのルートで依存パッケージを入れ、Electronアプリを起動します。

```bash
npm ci
npm run electron:dev
# または npm run dev / npm start
```

- `electron:dev` は先にViteで画面を本番ビルド（`npm run build`）し、その後 `electron electron/main.mjs` を実行します。通常はこちらを使います。
- **画面修正時の注意**: ソースコード（`src/` や `index.html`）を変更した場合は、必ず `npm run build`（または `npm run electron:dev`）を実行して `dist/` ディレクトリを更新してください。Viteビルドを経由せずにElectronプロセスだけを再起動しても変更内容は反映されず、レイアウトの不整合の原因になります。

## パッケージ版アプリをローカルで確認

パッケージ版（`.app`）の動作確認が必要な場合は、DMGを作らず `.app` だけを作成します。

```bash
npm run build:electron:mac:app
```

アプリ本体は次の場所に作成されます。このコマンドはZIP、DMG、チェックサムを作りません。

```text
release-electron-mac/stage/WebRevisionDesk.app
```

アプリのバージョンは、次のコマンドで確認できます。

```bash
/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' \
  release-electron-mac/stage/WebRevisionDesk.app/Contents/Info.plist
```

### パッケージ版の起動方法（CLI）

作成したステージ版アプリは、ターミナルから以下のいずれかのコマンドで起動できます。

```bash
# アプリバンドルを開く（通常）
open release-electron-mac/stage/WebRevisionDesk.app

# または実行バイナリを直接起動
./release-electron-mac/stage/WebRevisionDesk.app/Contents/MacOS/Electron
```

## 既存アプリとの混同防止と一時ビルド

### 既存プロセスの確認と終了

システム上にインストール済みの `/Applications/WebRevisionDesk.app`（旧版など）が既に起動している場合、新規に開発版を起動しても古いウィンドウが前面に残ったり、AIエージェントが既存プロセスを誤認したりすることがあります。
必要に応じて、事前に既存プロセスを確認・終了してください。

```bash
# 実行中のプロセスを確認
pgrep -fl WebRevisionDesk

# 必要に応じて既存アプリを終了
pkill -f "/Applications/WebRevisionDesk.app"
```

### 修正確認用の一時ビルド（一意なBundle IDでの識別）

修正版と既存版を厳密に区別してテストしたい場合は、正式リリースの識別子を変更せず、次のように別の一意なBundle ID・表示名・ビルドラベルを指定して作成します。

```bash
WEB_REVISION_BUILD_LABEL='Issue #NN 修正版' \
WEB_REVISION_BUNDLE_ID='jp.co.webrevisiondesk.app.preview.issuenumber' \
WEB_REVISION_DISPLAY_NAME='WebRevisionDesk Issue NN Preview' \
npm run build:electron:mac:app
```

作成後、ターミナルから設定したBundle IDを指定して起動できます。

```bash
# Bundle IDを指定して起動
open -b jp.co.webrevisiondesk.app.preview.issuenumber
```

AIエージェント（Codex、Cursor、Claude等）からアプリを選択・検証する場合も、表示名 `WebRevisionDesk` だけでなく、上記で設定した一意なBundle IDやステージ版アプリの絶対パス（`/Users/.../release-electron-mac/stage/WebRevisionDesk.app`）を指定することで、名前が同じ既存アプリとの混同を防げます。
起動後、画面上部に `vX.Y.Z · Issue #NN 修正版` と表示されていることを目視確認してください。

## トラブルシューティング

- **画面が真っ白、またはスタイルが崩れて素のHTMLが表示される**:
  - ブラウザで直接HTMLファイルを開いていないか確認してください。必ず `npm run electron:dev` またはパッケージ版 `.app` を起動してください。
  - ソース変更後に `npm run build` を実行したか確認してください（`dist/` 内のCSS/JSとHTMLの同期が必要です）。
- **`SIGABRT` や `kLSNoExecutableErr` が出る場合**:
  - 過去に一部の制限されたサンドボックス環境や権限不足時にこれらのエラーが観測された事例があります。通常のmacOSターミナル環境では `npm run electron:dev` または `open release-electron-mac/stage/WebRevisionDesk.app` で起動可能です。もし `open` コマンドでエラーが出る場合は、バイナリ直接実行（`./release-electron-mac/stage/WebRevisionDesk.app/Contents/MacOS/Electron`）をお試しください。

## DMGの作成と検証

DMGはローカル開発では作成しません。リリース用GitHub Actionsが `npm run build:electron:mac` でDMGを作成し、イメージの検証、読み取り専用でのマウント、`.app` と `/Applications` リンクの確認をしてから配布します。
