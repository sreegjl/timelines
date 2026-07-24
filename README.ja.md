#
[English](README.md) | [简体中文](README.zh-CN.md) | [日本語](README.ja.md)

![仮バナー](docs/temp-banner-light.png)

Timelines Studio は、世界設定の構築や歴史研究向けに、カスタマイズ可能なインタラクティブ・タイムラインを作成できる無料のオープンソースアプリです。イベント、期間、時代をタグやグループで整理し、Markdown のノートや MediaWiki の出典を要素に直接リンクできるほか、マップビューと座標機能を使ってタイムラインを地理的に可視化できます。

**ローカルファースト。** すべてのデータはプレーンな `.timeline`（JSON）ファイルと `.md` ファイルとして端末上に保存されます。アカウントもクラウドも不要で、特定のサービスに縛られることもありません。

Windows および macOS 向けの**[最新リリースをダウンロード](https://github.com/sreegjl/timelines/releases)**してください。

[![React](https://img.shields.io/badge/React-%2320232a.svg?logo=react&logoColor=%2361DAFB)](#)
[![Electron](https://img.shields.io/badge/Electron-2B2E3A?logo=electron&logoColor=fff)](#)
[![ライセンス：GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)

[ウェブサイト](https://www.timelines.studio/) · [ギャラリー](https://www.timelines.studio/gallery) · [Wiki](https://github.com/sreegjl/timelines/wiki) · [機能提案とロードマップ](https://github.com/sreegjl/timelines/issues/8)

![デフォルトビュー](docs/default-view.png)

![マップビュー](docs/map-view.png)

## 機能

- **イベント、期間、時代：** 日付付きの出来事を配置し、サムネイル画像やアイコンでカスタマイズできます。ほかの期間から分岐したり、ほかの期間へ合流したりする期間を描画し、一定の時間範囲をキャンバス全体に広がる名前付きの時代としてまとめられます。
- **タグとグループ：** 要素を整理し、作業中の内容だけをキャンバスに表示するよう絞り込めます。
- **ノートと出典：** Markdown のノート、出典、MediaWiki のコンテンツをタイムライン要素に直接添付できます。ノートフォルダーを既存の保管庫（Obsidian など）に接続し、調査資料をタイムラインと並べて管理することもできます。
- **マップビュー：** イベントや期間に座標を設定し、タイムラインが地理空間上で展開する様子を確認できます。
- **スプレッドシートビュー：** キャンバス全体を並べ替え可能な表に切り替え、日付の編集、項目名の変更、詳細の一括修正ができます。
- **テーマ：** 100 種類以上のコミュニティテーマが揃う[マーケットプレイス](https://github.com/sreegjl/timelines-marketplace)を閲覧し、タイムラインごとに異なるテーマを設定したり、アプリ全体の配色を変更したりできます。
- **ローカルファースト：** すべてのデータはプレーンな `.timeline` ファイルと `.md` ファイルとして端末上に保存されます。GPL-3.0 の下で無料かつオープンソースとして提供されています。
- **ウェブビューアー：** [timelines.studio/viewer](https://www.timelines.studio/viewer) で任意の `.timeline` ファイルをブラウザから開けます。ファイルが GitHub リポジトリにある場合は、そのリンクを貼り付けるだけで、アプリをインストールせずに誰でも閲覧できる共有 URL を取得できます。

## インストール

[Releases ページ](https://github.com/sreegjl/timelines/releases)から、お使いのプラットフォーム向けインストーラーをダウンロードしてください。

## データ

タイムラインは `.timeline` の JSON ファイルとして、ノートは `.md` ファイルとして保存されます。初期設定では、これらはシステムのアプリデータフォルダーに保存されます。アプリの設定から任意のディレクトリを指定できます。

## セットアップ

**前提条件：** [Node.js LTS](https://nodejs.org/)

**1. リポジトリをクローン**
```bash
git clone https://github.com/sreegjl/timelines.git

cd timelines
```

**2. 依存関係をインストール**
```bash
npm install
```

## 開発

**アプリを起動：**
```bash
npm run electron:dev
```

> [!NOTE]
> 開発モードではアプリのパフォーマンスが低下します。変更のテストにはこのモードを使用し、通常の利用にはアプリをビルドしてください。

## ビルド

**Electron アプリのインストーラーをビルド：**
```bash
npm run electron:build
```

出力されたインストーラーは `release/` フォルダーに格納されます。

<!-- ![設計ドキュメント](docs/design-doc.png) -->
