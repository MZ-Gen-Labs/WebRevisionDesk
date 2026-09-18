# Webサイト修正指示作成ツール PoC実装仕様書

- 対象: MVP-01〜MVP-06
- ステータス: PoC Verified 1.2
- 作成日: 2026-09-17
- 更新日: 2026-09-18
- 想定環境: Windows 11 + Chrome / Edge
- 実装形態: ローカルWebアプリ

## 1. PoCの目的

SingleFileで保存したHTMLについて、次の4点が現実的に成立するかを検証する。

1. 既存Webページを取り込んで表示できる
2. ページ上またはインスペクターから限定編集できる
3. 元ページのCSS classを再利用できる
4. 修正前・修正後を分離して保持し、修正後HTMLを保存できる

当初対象外だった操作履歴、変更指示一覧、差分HTML、赤入れHTMLは、PoC中の追加要望として実装・確認対象へ含めた。PDF生成は対象外とする。

## 2. 成功条件

- 実際の自社ページをSingleFileで保存したHTMLが読み込める
- 元ページと大きく異ならない見た目で表示できる
- テキスト、リンク、画像、alt、classを変更できる
- 要素を削除し、同一親内で前後移動できる
- 修正前表示へ切り替えられる
- 読込時点へリセットできる
- `modified.html` を保存できる
- 保存したHTMLをブラウザで再度開ける
- 編集UI固有のclass、属性、styleが出力HTMLへ混入しない
- 読み込んだページのスクリプトが編集画面で実行されない

## 3. 方式比較と決定

| 評価項目 | VvvebJs | iframe + contenteditable + DOM API |
|---|---|---|
| 初期UI機能 | 多い | 必要分を実装 |
| PoC要件への適合 | 過剰機能が多い | 要件に直接対応 |
| 任意HTML編集 | 可能 | 可能 |
| SingleFile互換性調整 | ビルダー内部との適合確認が必要 | 読み込んだDOMを直接扱える |
| UIの限定 | 既存UIの削減・改修が必要 | 最初から限定できる |
| HTML出力制御 | ビルダー依存の確認が必要 | 直列化処理を管理できる |
| 依存・サイズ | 大きい | ブラウザ標準APIのみ |
| Undo/Redo、D&D | 標準装備 | 別途実装 |
| ライセンス | Apache-2.0 | 独自コードのみ |
| PoC実装速度 | 導入は速いが調整リスクあり | 対象機能が少ないため速い |

### 決定

PoCは **iframe + contenteditable + DOM API** を採用する。

理由は、PoCの検証対象が汎用ページ制作ではなく、SingleFile HTMLの忠実な表示と限定編集だからである。VvvebJsのブロック、Bootstrap部品、自由なドラッグ&ドロップ、コード編集等は不要であり、削減と適合調整が必要になる。標準API方式なら元DOMを直接操作し、出力直前の洗浄処理も管理できる。

VvvebJsは、PoC後に自由度の高い追加・配置、Undo/Redo、階層ナビゲーション等が必須になった場合の再評価候補とする。

## 4. 技術構成

| 項目 | 採用技術 |
|---|---|
| 言語 | TypeScriptを将来候補とし、初期コードは依存のないES Modules JavaScript |
| 開発サーバー | Vite |
| UI | HTML / CSS |
| 読込 | File API `File.text()` |
| HTML解析 | `DOMParser` |
| 表示 | sandbox付き `iframe.srcdoc` |
| 編集 | `contenteditable`, DOM API, `classList` |
| 画像 | File API + data URL |
| 保存 | `Blob`, object URL, `download` 属性 |
| 永続化 | 編集中はメモリ、案件フォルダ選択時はFile System Access APIで保存 |
| URL取得 | Playwright + 独自のHTML/CSS/画像埋め込み処理 |
| 案件フォルダ | File System Access API、URL階層に対応する相対パス |

外部UIフレームワークと編集ライブラリは使用しない。

URL取得にはApache-2.0のPlaywrightを使用する。SingleFileのプログラムコードは組み込まず、SingleFile出力HTMLの読込のみ対応する。

## 5. セキュリティ設計

### 5.1 iframe

`sandbox="allow-same-origin"` とし、`allow-scripts`、`allow-forms`、`allow-popups`、`allow-top-navigation` を付与しない。親画面から編集対象DOMへアクセスするため同一オリジンのみ許可する。

### 5.2 注意事項

- sandboxはスクリプト実行を止めるが、画像やCSS等の外部URLへのリクエストまで完全には止めない
- PoCではSingleFileによる埋め込み済みHTMLを入力条件とする
- 機密ページで外部通信の完全遮断が必要な場合は、Electron/Tauri等のデスクトップ包装またはCSPを含む別方式を検討する
- 読み込んだHTMLをアプリ本体DOMへ直接挿入しない

## 6. 状態モデル

```js
{
  fileName: "page.html",
  originalHtml: "<!doctype html>...",
  modifiedHtml: "<!doctype html>...",
  mode: "modified", // original | modified
  changes: [],
  redoChanges: [],
  sourceUrl: "https://example.com/page",
  activeProjectPageId: "",
  dirty: false,
  selectedElement: null
}
```

- `originalHtml`: 読込直後の文字列。不変
- `modifiedHtml`: 編集iframeから直列化した最新文字列
- 修正前モードは参照専用
- 修正後モードのみ選択・編集可能

## 7. 機能仕様

### POC-01 HTML読込

1. 利用者が `.html` / `.htm` を選択する
2. UTF-8文字列として読み込む
3. `originalHtml` と `modifiedHtml` に同じ値を格納する
4. `iframe.srcdoc` へ設定する
5. load後に編集用イベントを親アプリから登録する
6. 全要素のclassを抽出して候補化する

異常時は画面上部へ理由を表示し、既存状態は破棄しない。

### POC-02 要素選択とテキスト編集

- 修正後モードでクリックした要素を選択する
- 選択要素に一時的なアウトラインを表示する
- ダブルクリックで、テキスト主体の要素へ `contenteditable=true` を付与する
- blur時に `contenteditable` を外し、状態を同期する
- `img`, `script`, `style`, `html`, `head`, `body` 等は直接テキスト編集不可

### POC-03 リンク編集

- 選択要素自身または最も近い祖先の `<a>` を対象とする
- 現在の `href` をインスペクターへ表示する
- 入力確定時に属性を更新する
- プレビュー内のリンク遷移は常に抑止する

### POC-04 画像編集

- `<img>` 選択時に画像ファイルを選べる
- ファイルをdata URL化し `src` を置換する
- `alt` を編集できる
- PoCの推奨上限は1画像10MBとし、超過時は警告する

### POC-05 class編集

- 読込HTML内のclassトークンを重複排除して候補表示する
- 選択要素のclass文字列を編集できる
- 空白区切りで正規化し、重複classを除去する
- アプリが使う一時classは保存対象から除外する

### POC-06 要素操作

- 削除: 選択要素をDOMから除去する
- 前へ: 同一親内の直前の要素兄弟より前へ移動する
- 後へ: 同一親内の直後の要素兄弟より後へ移動する
- `html`, `head`, `body` は削除・移動不可

### POC-07 表示切替

- 修正前: `originalHtml` をiframeへ表示し、編集を無効化する
- 修正後: 最新の `modifiedHtml` を表示し、編集を有効化する
- 切替前に修正後DOMを必ず直列化する

### POC-08 リセット

- 確認ダイアログ後、`modifiedHtml = originalHtml` とする
- 選択状態を解除し、修正後表示へ戻す

### POC-09 保存

1. 編集中要素の編集状態を終了する
2. 一時class、属性、編集用styleを除去する
3. doctypeと `documentElement.outerHTML` を直列化する
4. `text/html;charset=utf-8` のBlobを生成する
5. `<元ファイル名>-modified.html` としてダウンロードする

### POC-10 URL取得

- URLを取得用Chromiumで開き、ログインや画面操作後のDOMを取得できる
- 外部CSSとCSS内の `@import` を再帰的に取得して埋め込む
- CSS内URLと画像を可能な範囲でdata URL化する
- script、インラインイベント、CSP、meta refreshを除去して静的HTML化する

### POC-11 変更履歴・差分

- テキスト、リンク、画像、class、複製、削除、移動を操作履歴へ記録する
- 操作履歴と変更前後を一覧化した差分HTMLを保存できる
- ページ上へ `<del>`、`<ins>`、変更ラベルを重ねた赤入れHTMLを保存できる

### POC-12 操作案内・編集メニュー

- 「ページを取り込む」「修正する」「確認して保存」の現在段階を表示する
- 未選択時は、ページ内の編集したい場所をクリックするよう案内する
- 選択対象に応じて文章、リンク、画像のうち必要な編集欄だけを表示する
- altとCSS classは「詳細設定を表示」を有効にした場合だけ表示する
- 変更状態を「変更なし」「未保存の変更あり」「保存済み」で表示する
- 未保存の変更がある状態で画面を閉じる場合はブラウザ標準の警告を表示する
- 主出力を共有用ZIPとし、個別HTMLは「その他の保存」へまとめる

## 8. ファイル構成

```text
WebRevisionDesk/
├── index.html
├── package.json
├── README.md
├── server.js
├── windows/
├── scripts/
├── src/
│   ├── main.js
│   ├── editor.js
│   ├── html.js
│   ├── capture-page.js
│   ├── diff-report.js
│   ├── project-storage.js
│   ├── project-package.js
│   ├── page-comparison.js
│   ├── update-service.js
│   └── styles.css
└── test-data/
    └── sample.html
```

## 9. 受入テスト

| ID | シナリオ | 期待結果 |
|---|---|---|
| AT-01 | sample.htmlを読む | iframeに同じ見た目で表示される |
| AT-02 | 見出しを編集 | 修正後表示と保存HTMLに反映される |
| AT-03 | リンクURLを変更 | hrefが変更され、クリックでは遷移しない |
| AT-04 | 画像とaltを変更 | data URL画像とaltが保存される |
| AT-05 | classを変更 | 元CSSのスタイルが反映される |
| AT-06 | 要素を前後移動 | 同一親内の順序が変わる |
| AT-07 | 要素を削除 | 修正後から消え、修正前には残る |
| AT-08 | 修正前後を切替 | originalは不変、modifiedは編集状態を維持する |
| AT-09 | リセット | 全変更が読込時点へ戻る |
| AT-10 | modified保存 | 再度ブラウザで開け、編集用マーカーがない |
| AT-11 | scriptを含むHTML | 編集画面でscriptが実行されない |
| AT-12 | URLから実ページを取得 | CSS、画像、主要レイアウトを保って表示される |
| AT-13 | 差分HTMLを保存 | 操作内容と変更前後が一覧表示される |
| AT-14 | 赤入れHTMLを保存 | 削除・追加・変更位置がページ上で視認できる |
| AT-15 | 文章、リンク、画像を順に選択 | 対象に必要な編集項目だけが表示される |
| AT-16 | 詳細設定を切替 | altとCSS classの表示・非表示が切り替わる |
| AT-17 | 編集後に案件保存 | 未保存表示が保存済みへ変わる |

## 10. 互換性検証マトリクス

PoC判断には最低5ページを使う。

- 静的な会社情報ページ
- 画像とdata URLが多いページ
- 複雑な表・リストを含むページ
- Webフォント、疑似要素、レスポンシブCSSを含むページ
- script、iframe、canvas等を含むページ

各ページで読込表示、主要5編集、保存後再表示を記録し、重大な見た目崩れが5件中1件以下であることを暫定合格基準とする。

## 11. 既知の制約

- ブラウザの再解析によりソースの字面は変わり得る
- 疑似要素の文言はDOMテキストとして編集できない
- CSS背景画像は画像差し替えUIの対象外
- iframe内部、Shadow DOM内部、canvas描画内容は対象外
- JavaScriptにより再生成されるUIは静的な保存結果のみ扱う
- 要素移動によりCSSセレクターやレイアウトが破綻する可能性がある
- 巨大なdata URLを含むHTMLではメモリ消費が増える

## 12. 次段階への判断条件

次のいずれかが強く求められた場合、VvvebJsを含む編集基盤を再評価する。

- 自由なドラッグ&ドロップ配置
- 豊富な部品・ブロック追加
- DOM階層ナビゲーション
- テンプレート化された多数の新規ブロック

PoCで操作履歴、差分出力、案件保存、Undo/Redo、複数ページ管理、初心者向け操作案内まで成立した。次段階は複数実ページでの互換性試験、取得失敗リソースの可視化、選択ページの一括出力、配布・更新運用の検証を優先する。
