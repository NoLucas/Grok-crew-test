# Grok Crew

<p align="center"><a href="README.md">English</a> &nbsp;·&nbsp; <a href="README.ko.md">한국어</a> &nbsp;·&nbsp; <a href="README.zh.md">简体中文</a> &nbsp;·&nbsp; <strong>日本語</strong></p>

**Grok Crew は、あなたのパソコンにあるショート動画デスクです。仕様は人が書き、ドアは二つです。Grok 専用と、他エージェント専用。**

このパソコンに原版を置かなくても大丈夫です。長さ、字幕、残すセリフ、どのドアがやるかだけ決めます。**別のパソコン**のボットが映像とカットを作り、そのドアのフォルダにだけ渡します。この PC は受け取ります。Instagram・TikTok・YouTube は、したいときだけ投稿します。

素材を預けるサイトではありません。ボットはこの PC を開かず、パッケージだけ送ります。

```
仕様  →  そのドアの送信箱  →  ボットが spec.json を取る  →  そのドアの受信箱  →  このPCが受け取る  →  自分が言うときだけ投稿
```

## だれ向けか

- リールの仕様だけ決めたい人
- Grok に、または Claude / Codex / ChatGPT に素材と初回カットを任せたいが、ドアは混ぜたくない人
- 完成ファイルはそれでもこの PC に置きたい人

始めるのにアカウントは不要です。

## 画面に出るもの

最初の画面には**ドアが二つ**あります。Grok ドアか他エージェントドアに仕様を保存すると、そのドアの送信箱（`handoff-outbox/grok` または `handoff-outbox/agents`）に入ります。ボットはそこの `spec.json` を読みます。git なら `outbox/grok/` ・ `outbox/agents/` です。この PC は開きません。できた Grok のパッケージは `handoff-inbox/grok`、Claude・Codex・ChatGPT は `handoff-inbox/agents` に置きます。**受け取る** は自分のドアだけ取り込み、その仕様を送信箱から片付けます。文のコピーは予備です。**このドアの届き方を見る** は同梱クリップで同じ到着を見せます。

そのあとは 3 つのタブです。

| タブ | 用途 |
| --- | --- |
| **編集** | プレビューを見ながらタイムラインで切る |
| **設定** | ルック、字幕、速度 |
| **書き出し** | この PC に MP4 を残す。投稿するなら確認のあと |

プレビューは編集中に画面が遅れないための速い下書きです。保存するファイルは原版から作ります。

## 映像はこのパソコンに残ります

原版、編集、完成ファイルはこの PC にあります。Grok Crew のクラウドプロジェクトも、始めるためのログインもありません。

投稿は任意です。初期値は **公開前に確認** です。すでに送った可能性があるときは、二通目の前にもう一度聞きます。Instagram・TikTok・YouTube のアカウントは Grok Crew が作りません。

## 任意: この PC の AI に頼む

AI が**同じパソコン**ですでに動いているなら、普段の言葉で頼めます。強いセリフだけ残して、字幕を入れて、縦に切って、ファイルはここに置いて、アップロードはしないで。

別のパソコンの AI はこの机を開けません。よそにあるボットに「ちょっと見せて」と映像を送りません。

## 開き方

すでに誰かが入れてくれているなら、Grok Crew の窓を開くか、ブラウザで [http://localhost:3000](http://localhost:3000/) です。

自分で入れるなら [Node.js 22+](https://nodejs.org/) と [Python 3.10+](https://www.python.org/downloads/) が必要で、次を実行します。

```sh
git clone https://github.com/NoLucas/Grok-Crew.git grok-crew
cd grok-crew
npm run local
```

ブラウザではなく窓で使うなら、一度 `npm install` してから `npm run desktop` です。初回は数分かかることがあります。止めるときは `Ctrl+C`。

このパソコンで自分の動画を作って公開できます。ソースは [BUSL-1.1](LICENSE) で公開されており、オープンソース製品ではありません。質問: [CONTRIBUTING.md](CONTRIBUTING.md)。
