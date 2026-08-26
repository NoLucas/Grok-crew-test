# Grok Crew

<p align="center"><a href="README.md">English</a> &nbsp;·&nbsp; <a href="README.ko.md">한국어</a> &nbsp;·&nbsp; <a href="README.zh.md">简体中文</a> &nbsp;·&nbsp; <strong>日本語</strong></p>

**荒削りのショート動画素材を、ボットがそのまま実行できる編集プラン、ローカルMP4、そして任意のInstagram・TikTok・YouTube投稿へと変換します——プロジェクト、素材、ボットの履歴をクラウドバックエンドに送る必要はありません。**

<p>
  <img alt="ローカルファースト" src="https://img.shields.io/badge/local--first-127.0.0.1-1d1d1b?style=flat-square">
  <img alt="Node 22以上" src="https://img.shields.io/badge/Node.js-22%2B-339933?style=flat-square">
  <img alt="Python 3.10以上" src="https://img.shields.io/badge/Python-3.10%2B-3776AB?style=flat-square">
  <img alt="お使いのパソコンで動作" src="https://img.shields.io/badge/runs-on%20your%20computer-f4c400?style=flat-square">
</p>

<h2 align="center">動作デモ</h2>

<p align="center">
<a href="public/demo/quickstart-chat-demo.mp4"><img src="public/demo/quickstart-chat-demo.gif" alt="実際のローカルボットがGrok Crewを使う様子を見る" width="380"></a>
</p>

<p align="center"><em>実際のローカルボットがリポジトリをクローンして起動し、普通の言葉での依頼を字幕入りの縦型動画に編集します。クリックすると完全なMP4が再生されます。</em></p>

## ローカルで実行する

```sh
git clone https://github.com/NoLucas/Grok-Crew.git grok-crew
cd grok-crew
npm run local
```

準備が完了したら [デスクトップ](http://localhost:3000/) を開いてください。初回実行ではローカルのブラウザ・レンダラー依存関係をインストールし、専用のPython環境と同梱サンプル素材を準備します。クラウドアカウントやプロバイダーのAPIキーは不要です。以前の [Production](http://localhost:3000/production) コンソールも残っています。

> **ライセンス：**Grok Crewはオープンソースプロジェクトではなく、[BUSL-1.1](LICENSE)でソース公開されるプロジェクトです。正確な利用権は[ライセンス](LICENSE)を確認してください。

### 実際のサンプルをすぐにレンダリングする

`npm run local` を実行したまま、このリポジトリの2つ目のターミナルで `npm run sample` を実行してください。実際の2クリッププロジェクトが作成され、ローカルのサンプルボットのチェックインが記録され、`local_studio/workspace/outputs/grok-crew-sample-render.mp4` がレンダリングされます。Instagramジョブは**作成されません**。ポータブルなプロジェクト内容は [sample-project](sample-project/README.md) を参照してください。

## Grok bot への頼み方

まず `npm run local` で Grok Crew を起動し、**同じPCで動いている** Grok bot に次のように依頼します。

```text
このPC上の Grok Crew を使い、inputs/source.mp4 を縦型 9:16 のソーシャル動画に編集して。
最も強いセリフを残し、字幕を追加して outputs/final.mp4 にレンダーして。アップロードはしないで。
詳細が必要なら先にローカルの Bot Guide を読み、完了後は変更内容と出力ファイルの場所を報告して。
```

素材、出力形式、編集の目的、受け渡し先、アップロードの有無を具体的に伝えてください。ボットはローカルガイドを読み、チェックインし、作業を記録してからローカルファイルを返します。別のPCやクラウドのサンドボックスにいるボットは、このPCのループバック作業環境を直接開けません。その場合は下記のクラウドボット引き継ぎを使ってください。

## なぜGrok Crewなのか?

クリエイティブブリーフ、ボットへの指示、カット判断、レンダリングジョブ、配信ステータスがそれぞれ別のツールに散らばると、ショート動画編集は破綻します。Grok Crewはその引き継ぎを1台のパソコン上で可視化し、繰り返し実行できるようにします。

```text
荒素材 → 文字起こしカットマップ → ボットの編集方式 → ローカルMP4 → キューまたは自動アップロード
```

これは**人と同じPC上で動くボットのためのローカル制作デスク**であり、クラウド動画エディタでもなければリモートボットサービスでもありません。

## 初回実行の詳細

### 必要なもの

- Node.js 22以上
- Python 3.10以上
- このリポジトリのローカルクローン

`npm run local` は `localhost:3000` のブラウザワークスペースと `127.0.0.1:7214` のLocal Studioを起動します。`Ctrl+C`で停止し、同じコマンドを再実行すれば同じローカルワークスペースを再開できます。

### ローカルボットに最初のタスクを与える

クローンしたフォルダ内で、ボットのターミナルから次のコマンドを実行します。

```sh
python local_studio/grok_crew.py contract
python local_studio/grok_crew.py entry --bot-id editor-01 --display-name "Editor 01" --purpose edit_video --task "Prepare a transcript-first short-form edit plan." --execution-mode auto_local
```

続いて [Bot Check](http://localhost:3000/bots) を開きます。ボットは実際にチェックインした後にのみ画面に表示されます。

## 最初に試す作業の流れ

1. **デスクトップ**(`/`)を開き、`local_studio/workspace/inputs`内の素材でプロジェクトを作成します。
2. ボットに [Bot Guide](http://localhost:3000/bot-guide?lang=en) を読ませ、編集方式を設定させたうえで文字起こしカットマップを保存させます。
3. **Operations Center**で素材を検査し、プロジェクトの記憶を保存し、A/B編集を比較し、品質チェックを実行します。
4. デスクトップでローカルレンダーします。ボットは `auto_local` を使うか、自分のレンダリングにだけ人による承認ゲートを設定できます。
5. デスクトップの書き出しから Instagram・TikTok・YouTube に公開します。中断レシートは再試行前に重複アップロードの可能性を確認します。

## 何が変わるのか

| これまでの問題 | Grok Crewが提供するもの |
| --- | --- |
| 曖昧なプロンプトだけで編集するボット | 構造化されたローカルガイド、編集方式、プロジェクトの記憶、可視化されたタスクボード |
| 無音区間・撮り直し・フィラーの位置を推測に頼る | 文字起こしを起点にしたカットマップと素材のプリフライトレポート |
| 書き出した後で問題に気づく | レンダリング前・後、配信前の品質レポート |
| ボットの実行のたびに編集の文脈が失われる | ローカルSQLiteに残るプロジェクトの記憶、ジョブ履歴、ボットのハートビート記録 |
| 状態が分からない公開アクション | ローカルMP4のレンダリングキューと、Instagram・TikTok・YouTubeの公開レシート |

### 標準搭載の制作ツール

- プロジェクト設定、ローカルの入出力パス、レンダリング設定
- 単語・フレーズ単位で編集できる文字起こしカットマップ
- リフレーミング、字幕、速度、フレームレート、ルック、音声ポリシー、品質の選択
- 向き・フレームレート・長さ・音声・黒画面・無音を確認する素材検査
- レンダリング前・後、配信前の品質チェック
- プロジェクトの記憶、ボットのタスクボード、音声プラン、A/Bバリアント、ブランドキット、オーバーレイスロット
- 次の編集に活かす失敗メモとパフォーマンスメモ
- 実際の入場・ハートビート・編集・レンダリング・アップロードの進捗を示すBot Check
- 韓国語・英語・中国語・日本語のインターフェースと、機械可読なボットガイド

## 現在動作するものと計画・プレビューの区別

| このPCで実際に実行される処理 | 計画、プレビュー、または非破壊の処理 |
| --- | --- |
| **デスクトップ(`/`)** が基本の作業空間です。タイムライン編集、ローカルレンダー、Instagram / TikTok / YouTube 公開（ローカルトークン）。以前の **Production** コンソールでもプロジェクト作成とレンダーはできます。 | **Edit Lab、Cut Log、Agent Desk、Connect、Packet、Gates、Export、Library** は計画の作成、プレビュー、整理、移動のためのものです。ソースメディアを切断したり、レンダリングやアップロードを開始したりしません。 |
| **Bot Check** は実際のボット入場、ハートビート、ポリシー、ジョブ活動をローカルSQLiteに記録します。同じPCのターミナルCLIも、同じローカルサービスを通じてプロジェクトの作成とジョブ実行を行います。 | **Operations Center** はカットマップ、プロジェクトの記憶、タスク割り当て、A/Bバリアント、音声/オーバーレイプラン、ブランドキット、品質レポートを保存できます。すべてローカルに保存され、Productionでレンダリングするまでメディアを破壊的に変更しません。 |
| **Operations Center** はローカルの素材検査と、レンダリング前/後の品質チェックも実際に実行します。 | **Bot Guide、Terminal、Privacy** はローカルの説明・状態画面であり、それ自体はメディアを変更しません。 |

## ページ早見表

`localhost:3000` のブラウザワークスペースは下記のローカルページに分かれています。上記の実行境界は意図的です。計画ページがソースファイルを勝手に変更したり投稿を公開したりすることはありません。

- **`/` デスクトップ —— 基本の作業空間。タイムライン、ローカルレンダー、公開レシート、Instagram / TikTok / YouTube 書き出し。**
- `/edit` Edit Lab —— フレーム・モーション・タイポグラフィ・タイミング・字幕のプレビュー(企画専用で、実際のレンダリングには反映されません)
- `/cut` Cut Log —— 文字起こしを基準に残す/落とす区間を表示(実際のファイルは切断されません)
- `/production` Production —— 以前の作成/レンダー/Instagramコンソール。日常作業はデスクトップを使ってください。
- `/operations` Operations Center —— 素材の検査、品質レポート、プロジェクトの記憶、タスクボード、A/Bバリアント、音声・オーバーレイのプラン、ブランドキット
- **`/bots` Bot Check —— ボットの入場、ハートビート、実行ポリシー(`auto_local`または承認必須)。実際のボット活動が記録される唯一のページです。**
- `/terminal` Terminal —— 同一PC上のボット向けCLI/API案内
- `/bot-guide` Bot Guide —— 機械可読な編集ルール、ワークフロー、境界線
- `/library` Library —— ローカルの参考素材
- `/agent` Agent Desk —— ブリーフ、ルール、タスク一覧、引き継ぎメモ
- `/connect` Connect —— オフラインスナップショットのエクスポート/インポート(手動での引き継ぎ、サーバー通信なし)
- `/packet` Packet —— 1本分のブリーフとキャプションパッケージ
- `/gates` Gates —— 公開前の準備状況チェックポイント
- `/export` Export —— 解像度、字幕パッケージ、最終納品情報
- `/privacy` Privacy —— 「このPC内でのみ作業する」という境界線とローカルデータのリセット

### 実際の例

あるボットは、ブラウザを一切クリックせずCLIだけでこの一連の流れを最初から最後まで実行しました。Productionでプロジェクトを作成し(`inputs/source.mp4` → `outputs/final-video.mp4`)、Finish Rackを9:16、30fps、compact品質、中央リフレーム、字幕オン、音声ミュートに設定したうえで、Bot Checkから`auto_local`の実行ポリシーで入場し、0〜4秒("ONE ASK")と5〜9秒("SIX LINES")の2つのクリップをつなげて8秒のローカルMP4にレンダリングしました。Cut Log、編集方式、Operations、そして実際のInstagram投稿は、依然として人がブラウザで直接クリックする必要がある部分です。

## ボット向け:ブラウザまたはターミナル

すべてのクローンには、依存関係を持たないローカルCLIが同梱されています。ループバックアドレスにしか接続できません。

```sh
# 機械可読な完全マニュアルを読む
python local_studio/grok_crew.py guide

# 任意のワークスペースツールのブラウザページを出力
python local_studio/grok_crew.py site --page operations
python local_studio/grok_crew.py site --page export

# 実際のボットの在席状況と作業履歴を確認
python local_studio/grok_crew.py bots list
python local_studio/grok_crew.py bots activity
```

利用できるページは `desktop`、`studio`、`edit`、`cut`、`production`、`operations`、`bots`、`guide`、`terminal`、`library`、`agent`、`connect`、`packet`、`gates`、`export`、`privacy` です。

コマンドの全体は[ローカルボットマニュアル](local_studio/README.md)を、ワークスペース起動後は [Bot Guide](http://localhost:3000/bot-guide?lang=en) を開いて確認してください。

## プライバシーと任意のソーシャル配信

ブラウザワークスペースは `localhost:3000` で、Local Studioは `127.0.0.1:7214` で動作します。ソース素材、レンダリング結果、SQLiteの記録、ボットの履歴は、すべて現在のコンピューターの `local_studio/` 配下に残ります。

Instagram・TikTok・YouTubeへの配信は任意機能です。各プラットフォームには所有者がローカルに設定したアクセストークンと、対応するローカルMP4が必要です。公式OAuthアプリはこのリポジトリの外にあります。認証情報がSQLiteに保存されたり、本プロジェクトを通じてボットに露出したりすることはありません。

## クラウドボットの引き継ぎ(このPC上にいないボット向け)

Local Studioは、クラウドサンドボックスや別のコンピューターで動くボットであっても、他のマシンからの接続を一切受け付けません——この点は変わりません。その代わり、そうしたボットは完成した編集を専用のgitリポジトリ経由で引き継ぎ、所有者自身のPC上で動く `local_studio/handoff_watcher.py` がそのリポジトリをポーリングして、同一PC上のボットがすでに使っているのと同じローカルAPIで反映します。セットアップ方法は[ローカルボットマニュアル](local_studio/README.md)を、そのボットに渡す正確なパッケージ形式は `local_studio/handoff-guide.json`(または `handoff-guide.ko.json`、`handoff-guide.zh.json`、`handoff-guide.ja.json`)を参照してください。

## ユースケース

- クリエイターが、トーキングヘッド録画を編集の意図を失わずにタイトな縦型Reelへと仕上げる。
- 小規模なコンテンツチームが、複数のローカルボットにリサーチ・カット計画・QA・パッケージングを分担させつつ、担当と状況を可視化する。
- 開発者が、あるワークフローを端末の外に出すかどうかを決める前に、動画編集エージェントをローカルで検証する。
- 所有者のPCへループバックアクセスできないクラウドホストのボットが、素材と編集プランを作成したうえで、直接接続の代わりに専用gitリポジトリ経由で引き継ぐ。

## ロードマップ

- [x] Instagram・TikTok・YouTube Shorts 公開（ローカル env トークン。OAuthアプリは外部）
- [ ] コミュニティ管理のサンプル編集パック

## フィードバックと貢献

改善点や残しておきたい編集ワークフローがあれば、まず [CONTRIBUTING.md](CONTRIBUTING.md) をご覧ください。バグ報告、機能提案、的を絞った小さなPull Request、再現可能なローカルジョブ失敗の報告は特に助かります。

このリポジトリは寛容なオープンソースライセンスではなく、[Business Source License 1.1](LICENSE)(`BUSL-1.1`)のもとでソースが公開されています。個人利用・教育目的・社内業務目的(ローカルで実行して自分のコンテンツを制作・公開することを含む)であれば、自由に使用・複製・改変できます——正確な条件はライセンス内のAdditional Use Grantを参照してください。これ(またはその派生物)をホスティングサービスや競合する商用製品として第三者に提供するには、著作権者からの別途ライセンスが必要です。2030-08-23にMITライセンスへ移行します。
