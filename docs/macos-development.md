# macOSでの開発ビルドと起動

このプロジェクトをmacOSで開発するときのビルド・起動手順です。

## 開発モードで起動

リポジトリのルートで依存パッケージを入れ、Electronアプリを起動します。

```bash
npm ci
npm run electron:dev
```

`electron:dev` は先にViteで画面をビルドし、その後 `electron electron/main.mjs` を実行します。通常はこちらを使います。

## パッケージ版アプリをローカルで確認

パッケージ版の動作確認が必要な場合は、DMGを作らず `.app` だけを作成します。

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

## このMacでの起動上の注意

2026-09-25に、既存の `/Applications/WebRevisionDesk.app`（v0.7.19）と修正版を同時に扱う際、名前だけでアプリを選ぶと旧版を再選択することを確認しました。ビルド成功だけで修正版の起動確認とせず、次の手順で画面のビルド表示まで確認します。

1. `npm run build:electron:mac:app` でステージ用 `.app` を作る。
2. 必要に応じて `Contents/Info.plist` の `CFBundleShortVersionString` と、アプリ内のビルド表示を確認する。
3. Codexからアプリを選ぶ場合、表示名 `WebRevisionDesk` だけでなく、ビルド時に設定した一意なBundle IDで選択する。
4. 起動後、画面上部のバージョン・ビルド表示と修正されたUIを目視する。古いアプリも起動中なら、ウインドウタイトルだけで判断しない。

修正内容を識別できる一時ビルドは、正式リリースの識別子を変更せず、次のように別のBundle ID・表示名・ビルドラベルを指定して作成します。

```bash
WEB_REVISION_BUILD_LABEL='Issue #NN 修正版' \
WEB_REVISION_BUNDLE_ID='jp.co.webrevisiondesk.app.preview.issuenumber' \
WEB_REVISION_DISPLAY_NAME='WebRevisionDesk Issue NN Preview' \
npm run build:electron:mac:app
```

Codexでは `jp.co.webrevisiondesk.app.preview.issuenumber` のように**一意なBundle IDを指定して**起動します。名前が同じ既存アプリを選ばないようにします。起動後、画面に `vX.Y.Z · Issue #NN 修正版` が表示されていることを確認します。正式リリースでは一時ビルド用環境変数を設定せず、通常のアプリ名・Bundle IDを使用します。

このMacでは、過去に `npm run electron:dev` 後のElectronが `SIGABRT` で終了したこと、`open <staged .app>` が `kLSNoExecutableErr` で失敗したことがあります。これらはその時点の環境での観測で、すべての環境に当てはまる仕様とは限りません。CodexからBundle IDで選択した識別済みステージ版は起動し、画面表示を確認できました。

ローカル開発ではDMGを作成しません。DMGの作成・検証はリリース用GitHub Actionsで行います。

起動経路やOS環境を変えた場合は、開発モードとステージ済み `.app` をそれぞれ再確認してください。

## DMGの作成と検証

DMGはローカル開発では作成しません。リリース用GitHub Actionsが `npm run build:electron:mac` でDMGを作成し、イメージの検証、読み取り専用でのマウント、`.app` と `/Applications` リンクの確認をしてから配布します。
