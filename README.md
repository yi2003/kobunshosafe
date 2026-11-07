# 公文書セーフ KobunshoSafe

e-Gov電子申請・日本年金機構などから届く **XML＋XSL 形式の公文書（ZIP）** を、ブラウザだけで表示・印刷（PDF保存）する無料ツールです。登録不要、アップロードなし。

## なぜ必要か
Chrome 158（Stable 2026-11-17 予定）でブラウザ内蔵の XSLT（`XSLTProcessor` と `<?xml-stylesheet?>`）が削除されます（企業ポリシー `XSLTEnabled` で Chrome 176 / 2027-08-17 まで延長可）。内蔵 XSLT に頼るビューアや「XMLをダブルクリック」は動かなくなります。KobunshoSafe は XSLT 1.0 エンジン（[xslt-polyfill](https://github.com/mfreed7/xslt_polyfill)、libxslt の WebAssembly 版）を同梱しているので、Chrome 158 以降・Edge・Safari・Firefox で同じように動きます。

## 使い方
1. `index.html` を開く（静的ホスティングに置くか、ローカルで `python3 -m http.server` → http://localhost:8000/ 。ファイルを直接ダブルクリックして `file://` で開いても動きます）。
2. 公文書の ZIP を画面にドロップ、または「ファイルを選ぶ」。複数 ZIP、展開済みの XML＋XSL（＋画像・CSS）、フォルダ選択にも対応。
3. 左の一覧から文書を選ぶ。鑑（表紙）が先頭、続いて本文・明細CSV。
4. 「印刷・PDF保存」で表示中の文書、「すべて印刷」で全文書を1ページずつ印刷。印刷ダイアログで「PDFに保存」を選べばPDFになります。
5. 「クリア」で読み込んだデータと一時URLをすべて破棄します。

## プライバシー
- ZIP の展開（JSZip）と XSLT 変換はすべてブラウザのメモリ内で行います。ファイルをどこにも送信しません。アカウント、アクセス解析、Cookie、外部CDNはありません。
- ページ自体の CSP で外部への通信を禁止し、表示する文書も `sandbox`（スクリプト実行なし）の iframe ＋ `default-src 'none'` の CSP で描画します。文書中の `<script>`・イベント属性・`javascript:` リンクは除去します。

## 仕組み
- **ペアリング**: XML ごとに ① `<?xml-stylesheet href?>` が指すXSL → ② 同じフォルダの同名 `.xsl` → ③ そのフォルダ唯一の `.xsl`。ネストしたフォルダ・ZIP内ZIP（2階層まで）・複数ZIP対応。ファイル名の大文字小文字は区別しません。
- **文字コード**: BOM → XML宣言の `encoding` → UTF-8（厳密）→ Shift_JIS の順で判定。ZIP内のファイル名も UTF-8 / Shift_JIS を自動判定。
- **xsl:include / xsl:import**: ZIP内から読み込んでインライン展開してから変換します。
- **画像・CSS・外字**: 変換結果の `img src`・`background`・`<link rel=stylesheet>`・CSS の `url()`/`@import` を ZIP 内のファイルへの `blob:` URL に置き換えます。見つからない参照は画面上部に一覧表示。
- **鑑→本文リンク**: ZIP内の文書を指すリンクはビューア内で開きます。外部リンクは確認後に新しいタブで開きます。
- **表示できない XML**（署名情報など XSL がないもの）は、理由を表示したうえで元の XML をそのまま表示します。

## 既知の制限
- XSLT 1.0 のみ（ブラウザ内蔵と同じ）。XSLT 2.0/3.0、`document()` による外部ファイル参照、EXSLT の一部は動きません。
- `xsl:import` はインライン展開で近似しています（優先順位の衝突が多い複雑なXSLでは差が出る可能性）。
- 外字: 画像やフォントファイルが ZIP に入っていれば表示します。私用領域の文字を端末の外字フォント（EUDC）で表示する方式の場合、その端末にフォントがないと表示できません。
- 「すべて印刷」は各文書のスタイルを1つのページにまとめるため、文書間で CSS が衝突するとレイアウトがずれることがあります。その場合は1件ずつ印刷してください。
- 電子署名の検証は行いません（e-Gov の公文書署名検証を使ってください）。
- 実際の公文書（個人情報を含む）では未検証です。テストは架空のサンプルで行っています。

## テスト
`fixtures/` に**架空データのみ**のサンプル ZIP があります（`python3 fixtures/make_fixtures.py` で再生成）。

| ファイル | 内容 |
| --- | --- |
| `sample-egov-koubunsho.zip` | e-Gov 風構成: `[到達番号].xml`（鑑, `kagami.xsl`）、`資格取得確認通知書([到達番号]).xml`（Shift_JIS, `xsl:include`, CSS, 公印・外字画像）、明細CSV（Shift_JIS）、XSLのない署名情報XML |
| `sample-pairing.zip` | PI なし: 同名ペア、フォルダ内唯一のXSL |
| `sample-empty.zip` | XML なし（エラー表示の確認） |

ヘッドレス Chrome（内蔵 XSLT を `--disable-features=XSLT` で無効化＝Chrome 158 相当）でのスモークテスト:

```sh
cd test && npm i && node smoke.mjs && node file-url-check.mjs
```

## 同梱ライブラリ
- `vendor/xslt-polyfill.min.js` — xslt-polyfill 1.0.34（BSD-3-Clause, © Mason Freed）。libxslt/libxml2 の WebAssembly 版を内包。
- `vendor/jszip.min.js` — JSZip 3.10.2（MIT / GPLv3 デュアル）。
