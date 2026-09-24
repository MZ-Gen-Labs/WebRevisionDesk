# macOSでの開発ビルドと起動

このプロジェクトをmacOSで開発するときのビルド・起動手順です。

## 開発モードで起動

リポジトリのルートで依存パッケージを入れ、Electronアプリを起動します。

```bash
npm ci
npm run electron:dev
```

`electron:dev` は先にViteで画面をビルドし、その後 `electron electron/main.mjs` を実行します。通常はこちらを使います。

## macOSアプリをパッケージして起動

確認用の `.app` と配布用ファイルを作成するには、次を実行します。

```bash
npm run build:electron:mac
```

アプリ本体は次の場所に作成されます。

```text
release-electron-mac/stage/WebRevisionDesk.app
```

アプリのバージョンは、次のコマンドで確認できます。

```bash
/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' \
  release-electron-mac/stage/WebRevisionDesk.app/Contents/Info.plist
```

## このMacでの起動上の注意

2026-09-25時点で、このMacでは以下を確認しています。

- Codexデスクトップから上記の `.app` を**フルパス指定**して起動すると、アプリが開きます。v0.7.12で画面を確認済みです。
- `npm run electron:dev` はビルド後にElectronが `SIGABRT` で終了しました。
- ターミナルから `open release-electron-mac/stage/WebRevisionDesk.app` を実行すると、Launch Servicesの `kLSNoExecutableErr` で失敗しました。
- `/Applications/WebRevisionDesk.app` は別の旧版（v0.7.10）でした。アプリ名だけで起動すると旧版を開くことがあるため、確認時は上記のステージ先アプリを指定してください。
- `build:electron:mac` は `.app` とZIPを作った後、DMG作成時に `hdiutil: create failed - 装置が構成されていません` で停止しました。この場合もステージ先の `.app` は残ります。DMGやチェックサムの生成は完了していません。

Codexデスクトップからの起動では、アプリ選択時に次の絶対パスを指定します。

```text
/Users/miyazawahayato/dev/HtmlTool/release-electron-mac/stage/WebRevisionDesk.app
```

別のMacや、起動方法・OS環境を変更した後は、開発モード起動とパッケージ版起動を再確認してください。
