#
[English](README.md) | [简体中文](README.zh-CN.md) | [日本語](README.ja.md)

![临时横幅](docs/temp-banner-light.png)

Timelines Studio 是一款免费、开源的应用程序，可用于为世界观构建和历史研究创建可自定义的交互式时间线。你可以使用标签和分组整理事件、时间段与时代，将 Markdown 笔记或 MediaWiki 来源直接关联到时间线元素，并借助地图视图与坐标支持从地理角度呈现时间线。

**本地优先。** 所有内容都以纯 `.timeline`（JSON）和 `.md` 文件的形式保存在你的设备上：无需账户、无需云服务，也不会被平台锁定。

**下载适用于 Windows 和 macOS 的[最新版本](https://github.com/sreegjl/timelines/releases)**。

[![React](https://img.shields.io/badge/React-%2320232a.svg?logo=react&logoColor=%2361DAFB)](#)
[![Electron](https://img.shields.io/badge/Electron-2B2E3A?logo=electron&logoColor=fff)](#)
[![许可证：GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)

[网站](https://www.timelines.studio/) · [图库](https://www.timelines.studio/gallery) · [Wiki](https://github.com/sreegjl/timelines/wiki) · [功能建议与路线图](https://github.com/sreegjl/timelines/issues/8)

![默认视图](docs/default-view.png)

![地图视图](docs/map-view.png)

## 功能

- **事件、时间段与时代：** 标记带日期的时刻，并使用缩略图和图标进行自定义；绘制可以从其他时间段分支或合并到其他时间段的时期；还可以将一段时间归入带有名称、横跨整个画布的时代。
- **标签与分组：** 整理各个元素，并通过筛选让画布只显示你当前处理的内容。
- **笔记与来源：** 将 Markdown 笔记、来源和 MediaWiki 内容直接附加到时间线元素上，还可以把笔记文件夹连接到现有的资料库（例如 Obsidian），让研究资料与时间线并存。
- **地图视图：** 为任意事件或时间段添加坐标，观察时间线如何在地理空间中展开。
- **电子表格视图：** 将整个画布切换为可排序的表格，以便编辑日期、重命名条目和批量修正细节。
- **主题：** 浏览包含 100 多个社区主题的[主题市场](https://github.com/sreegjl/timelines-marketplace)，为每条时间线设置不同主题，或重新配色整个应用。
- **本地优先：** 所有内容都以纯 `.timeline` 和 `.md` 文件的形式保存在你的设备上。本项目免费开源，并采用 GPL-3.0 许可证。
- **网页查看器：** 可在浏览器中通过 [timelines.studio/viewer](https://www.timelines.studio/viewer) 打开任意 `.timeline` 文件；如果文件位于 GitHub 仓库中，粘贴其链接即可获得一个无需安装应用、任何人都能访问的分享网址。

## 安装

请从 [Releases 页面](https://github.com/sreegjl/timelines/releases)下载适用于你所用平台的安装程序。

## 数据

时间线以 `.timeline` JSON 文件存储，笔记则以 `.md` 文件存储。默认情况下，这些文件位于系统的应用数据文件夹中。你可以在应用设置里指定自定义目录。

## 设置

**前置要求：** [Node.js LTS](https://nodejs.org/)

**1. 克隆仓库**
```bash
git clone https://github.com/sreegjl/timelines.git

cd timelines
```

**2. 安装依赖**
```bash
npm install
```

## 开发

**启动应用：**
```bash
npm run electron:dev
```

> [!NOTE]
> 开发模式下的应用性能较差。请使用该模式测试更改，日常使用时请构建应用。

## 构建

**构建 Electron 应用安装程序：**
```bash
npm run electron:build
```

生成的安装程序将位于 `release/` 文件夹中。

<!-- ![设计文档](docs/design-doc.png) -->
