<div align="center">

# ⚡ SparkNav (极客智汇导航)

**现代化赛博朋克 / OLED 暗黑极客导航系统 · 开源矩阵与自动化收录生态**

[![Astro](https://img.shields.io/badge/Astro-5.x-BC52EE.svg?style=flat-square&logo=astro)](https://astro.build/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6.svg?style=flat-square&logo=typescript)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](LICENSE)
[![Cloudflare Pages](https://img.shields.io/badge/Deploy-Cloudflare%20Pages-F38020.svg?style=flat-square&logo=cloudflare)](https://pages.cloudflare.com/)

[在线演示](https://xiu-theme.pages.dev/nav) · [功能特性](#-核心特性) · [快速开始](#-快速开始) · [自动化收录机器人](#-telegram-自动化收录机器人) · [部署指引](#-部署指引)

</div>

---

## ✨ 核心特性

- 🌌 **极致视觉美学**：
  - 基于 OLED 纯黑与赛博霓虹风格设计，支持 Light / OLED 双主题即时切换（零闪烁、支持系统偏好响应）。
  - Canvas 交互式星空微粒背景引擎（Starfield Particles Engine）。
  - 3D 拟态卡片视差跟随引擎（TiltEngine），带来细腻微交互质感。
- ⚡ **极客级瞬时操控**：
  - **命令面板 (`CommandPalette`)**：全局快捷键 <kbd>Cmd</kbd> + <kbd>K</kbd> / <kbd>Ctrl</kbd> + <kbd>K</kbd> 唤出，支持全站多源模糊拼音匹配、秒级直达与分类过滤。
  - **全键盘漫游导航 (`KeyboardNavigation`)**：支持 <kbd>J</kbd> / <kbd>K</kbd> / <kbd>↑</kbd> / <kbd>↓</kbd> 键盘流盲操与 <kbd>Enter</kbd> 瞬间打开。
  - **随机探索 (<kbd>R</kbd>)**：掷骰子瞬间漫游收录池中的任意高分神站。
- 📦 **本地私有化核心数据存储 (`NavCoreStore`)**：
  - **卡片置顶与收藏**：无需注册登录，数据完全本地持久化。
  - **高频访问权重**：自适应统计个人点击频次，自动为高频站点高亮。
  - **智能镜像路由切换 (`MirrorSwitcherModal`)**：多节点与官方镜像自主选用并记忆。
  - **即时 RSS 动态抽屉 (`FeedPreviewPopover`)**：直接在卡片弹出预览最新订阅源动态，支持一键复制 Markdown 摘要。
- 🤖 **全自动化收录与探活流水线**：
  - **Telegram 审核机器人守护进程 (`telegram-bot-daemon.mjs`)**：社群用户发送链接，Bot 自动调用 LLM 进行网页爬取、中文摘要概括与智能标签推断，管理员在群组内一键 Approve 自动落盘。
  - **死链与活跃度健康检测 (`audit-nav-health.mjs`)**：定时探测链接连通性，自动同步 GitHub 项目最新 Stars、Forks 与提交记录。
- 🚀 **100% 零外部依赖开箱即用**：
  - 纯静态编译输出，天然支持部署于 Cloudflare Pages、GitHub Pages、Vercel、Netlify 或任意 Nginx/Caddy 服务器。
  - 内置纯本地 SVG 动态渐变头像与占位图生成算法，零配置亦绝无图片破损。

---

## 📁 目录结构

```text
spark-nav/
├── functions/              # Cloudflare Pages 边缘服务 (可选头像代理与点击计数)
│   └── api/
│       ├── creators.ts     # 创作者热度计数器 (KV / 内存无缝切换)
│       └── media.ts        # 媒体与头像反代 (内置动态 SVG 兜底)
├── public/                 # 静态资源与客户端搜索预构建索引
│   ├── nav-search-index.json
│   └── favicon.ico
├── src/
│   ├── components/nav/     # 导航核心交互组件库 (CommandPalette, TiltEngine 等)
│   ├── config/site.ts      # 站点全局配置文件 (名称、标语、GitHub 仓库等)
│   ├── data/nav/           # 结构化核心数据集
│   │   ├── categories.json # 导航分类树
│   │   ├── websites.json   # 精选网站数据池
│   │   ├── github.json     # GitHub 开源项目矩阵
│   │   ├── telegram.json   # Telegram 精选生态频道与机器人
│   │   └── creators.json   # 优质技术博主矩阵
│   ├── layouts/            # 页面布局 (NavLayout.astro)
│   ├── pages/              # Astro 路由大厅
│   │   ├── index.astro     # 导航站顶级首页
│   │   ├── github.astro    # GitHub 开源矩阵专区
│   │   ├── telegram.astro  # Telegram 生态专区
│   │   ├── 404.astro       # 404 错误缺省页
│   │   └── category/       # 动态垂直专区分区
│   ├── scripts/            # 自动化脚本与 Bot 守护进程
│   │   ├── telegram-bot-daemon.mjs # Telegram 收录审批机器人
│   │   ├── llm-summarizer.mjs      # LLM 智能分类与摘要提炼
│   │   ├── audit-nav-health.mjs    # 生态死链探活与 GitHub 指标同步
│   │   └── build-nav-search-index.mjs # 客户端离线搜索索引生成器
│   ├── styles/nav.css      # OLED / Cyberpunk 纯 CSS 视觉系统
│   ├── types/nav.ts        # TypeScript 强类型接口定义
│   └── utils/nav.ts        # 数据装载与权重排序工具
├── .env.example            # 环境变量配置文件模版
├── astro.config.mjs        # Astro 核心工程配置
└── package.json            # 项目依赖与运行脚本
```

---

## 🚀 快速开始

### 环境要求
- **Node.js**: 20.0 或更高版本 (推荐 Node.js 22 LTS)
- **npm** / **pnpm** / **yarn**

### 1. 克隆与安装依赖
```bash
git clone https://github.com/kaiden694/spark-nav.git
cd spark-nav
npm install
```

### 2. 启动本地开发服务
```bash
npm run dev
```
打开浏览器访问 `http://localhost:4321` 即可体验。

### 3. 构建生产静态包
```bash
npm run build
```
构建产物将输出至 `dist/` 目录。

---

## ⚙️ 站点自定义配置

编辑 `src/config/site.ts` 即可全局定制站点品牌与元数据：

```typescript
export const siteConfig = {
  name: 'SparkNav',
  title: '极客智汇导航 · 全网优质资源与开源矩阵',
  subTitle: 'Modern Cyberpunk Geek Navigation Hub',
  description: '全网优质资源精选导航...',
  githubUrl: 'https://github.com/kaiden694/spark-nav',
  telegramUrl: 'https://t.me/your_channel',
  enableCreators: true,
  enableGithubMatrix: true,
  enableTelegramHub: true,
};
```

---

## 🤖 Telegram 自动化收录机器人

项目内置工业级自托管 Telegram 机器人收录审核管线：

1. 复制环境模版：
   ```bash
   cp .env.example .env
   ```
2. 填写 Telegram 与 LLM 密钥（支持 Google Gemini、DeepSeek、OpenAI 或本地 Ollama）：
   ```env
   TELEGRAM_BOT_TOKEN=123456789:ABCdefGHI...
   TELEGRAM_ADMIN_CHAT_ID=100000000
   GEMINI_API_KEY=AIzaSy...
   ```
3. 启动守护进程：
   ```bash
   # 直接运行
   npm run bot:start

   # 或使用 PM2 常驻后台
   pm2 start ecosystem.config.cjs
   ```

---

## 🚢 部署指引

### 方式 1：Cloudflare Pages (推荐，零成本全球 CDN)
1. 将代码推送到你的 GitHub 仓库。
2. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/) -> **Workers & Pages** -> **Create application** -> **Pages** -> **Connect to Git**。
3. 选择你的仓库，构建设置配置如下：
   - **Framework preset**: `None` / `Astro`
   - **Build command**: `npm run build`
   - **Build output directory**: `dist`
4. 点击 **Save and Deploy** 即可完成全球发布。

### 方式 2：GitHub Pages
项目已内置 `.github/workflows/ci.yml`，可配合 GitHub Actions Pages 进行一键自动化部署。

---

## 🛠️ 常用维护命令

| 命令 | 描述 |
| :--- | :--- |
| `npm run dev` | 启动本地 Astro 实时热重载开发服务器 |
| `npm run build` | 编译静态页面并自动重构客户端离线搜索索引 |
| `npm run check` | 执行全站 TypeScript 与 Astro 模版强类型检查 |
| `npm run test:unit` | 运行内置自动化单元测试套件 |
| `npm run nav:health` | 探测全站外链可用性并实时刷新 GitHub Stars/Forks |
| `npm run bot:start` | 启动 Telegram 自动收录审核机器人守护进程 |

---

## 📄 开源许可证

本项目采用 [MIT License](LICENSE) 开源协议。欢迎 Star、Fork 并提交 Pull Request！
