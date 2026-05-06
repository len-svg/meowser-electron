# Meowser

> 一个 macOS 摸鱼浏览器。多工作区独立 Cookie/缓存/代理，支持 Chrome 扩展，浮窗常驻。

基于 **Electron 41 (Chromium 134)** 构建。每个工作区是一个完全独立的 Chromium session，与系统 Chrome 数据零混用。

---

## 跑起来

```bash
cd meowser-electron
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm install
npm start
```

启动后：
- 屏幕中央弹出**启动器**（720×580 暗色窗，列出所有工作区）
- 菜单栏出现 🐱 图标（点开有所有工作区子菜单 + 临时无痕入口）

---

## 核心概念：工作区（Profile）

每个工作区是一份独立环境：

| 属性 | 说明 |
|---|---|
| `name` / `note` | 显示名 + 一句话备注 |
| `emoji` | 16 选 1 |
| `theme` | yellow / green / red — 顶部 strip 颜色 + 边框 |
| `mode` | `work`（工作首页 = 个人书签） / `slack`（推荐首页 = 视频/音乐/新闻/炒币/论坛） |
| `proxy` | `direct` / `system` / `http(s)`（同端口同时走 HTTP+HTTPS）/ `socks5` |

数据落盘在 `~/.meowser/profiles.json`，可手改。

---

## 浏览器窗内能做啥

工具栏从左到右：
```
← →  ↻  🏠   [地址栏]  查询  ⭐  📚  [代理 pill]  [透明度滑块]  📌  🪶  🕶  ⤢  🌐
```

| 按钮 | 作用 |
|---|---|
| ← → ↻ 🏠 | 标准导航 + 回工作区首页 |
| ⭐ | 当前页加书签到本工作区 |
| 📚 | 书签管理菜单：从 Chrome 导入 / HTML 导入 / HTML 导出 |
| 透明度滑块 | 30% – 100% 整窗透明度 |
| 📌 | 置顶切换（默认开） |
| 🪶 | 失焦自动缩回小窗 |
| 🕶 | 切换为无痕窗口（不保存任何数据） |
| ⤢ | 大窗 / 小窗（320×240）切换；strip 双击同效 |
| 🌐 | 用系统 Safari 打开（Shift = Chrome） |

**Chrome 风书签栏**：工具栏下方一排带 favicon 的书签按钮。右键单条书签 → 在浏览器/Safari/Chrome 打开 / 复制链接 / 删除。

---

## 启动器能做啥

| 按钮 | 作用 |
|---|---|
| ▦ 摆放 | 把已开窗口按 上/下/左/右 × 平铺/叠放 自动排列 |
| 📦 本地装 | 选 unpacked extension 目录装到指定工作区 |
| 🛒 在线装 | 粘 Chrome Web Store URL（或 32 字符扩展 ID）→ 自动下载 .crx → 解压装载 |
| 📤 导出 | 把 `~/.meowser/` 打包 zip（排除 cache） |
| 📥 导入 | 从 zip 还原配置（覆盖/保留两种策略） |
| 🕶 无痕 | 用第一个 profile 起一个临时无痕窗 |
| ＋ 新建 | 弹编辑窗新建 profile |

每行 profile 还有 ⚙（编辑） / 🕶（无痕打开）/ ▶ RUN（正常打开，Shift+点 = 小窗）。

---

## 全局快捷键

| 快捷键 | 作用 |
|---|---|
| `⌥` | 显示/隐藏所有浏览器窗 |
| `⌘⌥L` | 打开启动器 |

---

## 装扩展（含 1Password / uBlock / 任何 Chromium 扩展）

**方案 A：在线装（最简单）**

1. 在 Chrome Web Store 找扩展，复制 URL
2. 启动器 → 🛒 在线装 → 粘 URL → 选目标工作区
3. 重启该工作区窗口生效

**方案 B：本地装（适合企业内部 / 私有扩展）**

1. 解压 unpacked extension 到任意目录
2. 启动器 → 📦 本地装 → 选目录 → 选目标工作区

扩展存放在 `~/.meowser/extensions/<profile_id>/<ext_name>/`，可以手动 rm 删除。

---

## 无痕模式（三种入口）

- **启动器顶部「🕶 无痕」**：用第一个 profile 起临时窗
- **每行 profile 旁的 🕶**：用该 profile 起临时窗
- **浏览器窗工具栏 🕶**：把当前窗切成无痕（关掉重开）

无痕窗特征：
- 标题栏「🕶 无痕」badge + 黑色边框
- 不读取/写入持久 cookie / 缓存（partition 不带 `persist:` 前缀）
- 不加载扩展、不显示书签栏、不保存书签
- 关窗即销毁

---

## 一键迁移到新电脑

```
旧机：启动器 → 📤 导出 → 选保存路径 → 得到 Meowser_backup_<ts>.zip
新机：装好 Meowser → 启动器 → 📥 导入 → 选 zip → 选「覆盖」或「保留现有」
```

zip 含 `profiles.json` / `bookmarks/` / `extensions/`，**不含** `cache/`（启动后自动重建）。

---

## 数据目录

```
~/.meowser/
├── profiles.json                 工作区配置
├── bookmarks/<profile_id>.json   每个工作区的书签
├── extensions/<profile_id>/<ext>/  扩展目录
└── cache/home_*.html             首页缓存（可删，重启重建）
```

跨工作区的真正用户数据（cookie / localStorage / IndexedDB / Service Worker）由 Electron 自己存在 `~/Library/Application Support/meowser/Partitions/meowser-<id>/`，与系统 Chrome 完全隔离。

---

## 文件结构

```
meowser-electron/
├── package.json
├── README.md
└── src/
    ├── main.js              主进程：profile / session / 窗口 / IPC / Tray / 全局热键
    ├── preload.js           contextBridge 暴露的 ~30 个 API
    ├── launcher.html        启动器（暗色 L 风）
    ├── edit.html            编辑/新建 profile 弹窗
    ├── chrome.html          浏览器窗壳（strip + toolbar + 书签栏 + webview）
    ├── bookmarks.js         工作模式首页渲染（profile 自带书签）
    ├── slack_home.js        娱乐模式首页渲染（5 类推荐站点）
    ├── bookmarks_store.js   per-profile 书签 CRUD + Chrome/HTML 导入导出
    ├── crx.js               Chrome Web Store .crx 下载 + CRX header 剥离 + 解压
    └── migrate.js           ~/.meowser zip 导出/导入
```

---

## 限制

1. CRX 下载走 Node `https`，**不走** Electron 的代理（如果你只能通过公司代理出网，需手动下载 .crx 后用「📦 本地装」）
2. macOS 标题栏 drag region 双击会触发系统 Zoom，所以提供独立 ⤢ 工具栏按钮（双击仅作辅助）
3. 站点 favicon 走 `google.com/s2/favicons`，无网时显示空白（不影响功能）
4. 无痕窗 partition 用 `Date.now()` 作后缀，每次新建都是独立 session（不与历史无痕窗共享）

---

## 开发

```bash
# 改完直接重启
npm start

# 看 console 日志（含扩展加载提示）
npm start 2>&1 | grep -v IMK
```

主要改动点：
- 加新 IPC：在 `main.js` 用 `ipcMain.handle('xx:yy', ...)`，在 `preload.js` 暴露，HTML 里 `window.api.xx` 调用
- 加新页面：放 `src/`，从 main.js 用 `loadFile` / `loadURL` 起一个 BrowserWindow
- 改 UI：直接改 `launcher.html` / `chrome.html` / `edit.html`，热改完重启即可
