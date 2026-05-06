# Meowser 使用文档

> macOS 摸鱼浏览器 · 多工作区独立 Cookie/缓存/代理 · 支持 Chrome 扩展 · 浮窗常驻

适用版本：v0.2+

---

## 目录

1. [安装](#一安装)
2. [第一次启动](#二第一次启动)
3. [启动器（管理工作区）](#三启动器)
4. [浏览器窗（日常浏览）](#四浏览器窗)
5. [书签管理](#五书签管理)
6. [扩展（含 1Password）](#六扩展安装)
7. [无痕模式](#七无痕模式)
8. [配置导出 / 一键迁移](#八配置导出导入)
9. [菜单栏 🐱 快捷入口](#九菜单栏快捷入口)
10. [快捷键速查](#十快捷键速查)
11. [常见问题 FAQ](#十一常见问题-faq)
12. [故障排查](#十二故障排查)

---

## 一. 安装

```bash
# 1. 装 dmg
open ~/Desktop/work/Code/Tool/meowser-electron/dist/Meowser-0.2.X-arm64.dmg
# 拖 Meowser.app 到 Applications

# 2. 解隔离（首次必须，否则会被 Gatekeeper 拦）
xattr -cr /Applications/Meowser.app

# 3. 启动
open /Applications/Meowser.app
```

> 没签名警告？右键 Meowser.app → 打开 → 「打开」 也行。一次后系统记住。

**升级**：装新版本前先 `pkill -f Meowser`，再覆盖 `/Applications/Meowser.app`，扩展和书签都保留（在 `~/.meowser/`）。

---

## 二. 第一次启动

启动后做两件事：

1. **菜单栏**右上角出现 🐱 图标
2. **启动器窗口**居中弹出（720×580 暗色风）

启动器列表里默认有 3 个工作区：

| Profile | 用途 | 代理默认 |
|---|---|---|
| 🐱 默认 | 本地直连 | direct |
| 💻 工作 | 公司内网 | http://127.0.0.1:1087 |
| 🎮 娱乐 | 摸鱼 | direct |

每行最右边有 ▶ RUN 按钮，点了就开浏览器窗。

---

## 三. 启动器

**启动方式**：菜单栏 🐱 → 「启动器…」 ／ 全局快捷键 `⌘⌥L`

### 顶部按钮组

| 按钮 | 作用 |
|---|---|
| ▦ 摆放 | 把所有已开浏览器窗自动排列：左/右/上/下 × 平铺/叠放 |
| 📦 本地装 | 选 unpacked extension 目录装到指定工作区（适合自己开发的扩展） |
| 🛒 在线装 | 粘 Chrome Web Store URL 自动下载 .crx 解压（最常用） |
| 📤 导出 | 把 `~/.meowser/` 整体打 zip 包（备份/迁移） |
| 📥 导入 | 从 zip 还原配置（覆盖 / 保留两种策略） |
| 🕶 无痕 | 起一个临时无痕窗（不留痕迹） |
| 📚 书签 | 打开书签管理窗 |
| ＋ 新建 | 弹编辑窗新建工作区 |

### 工作区行（每行）

```
[彩色条] [emoji] [名称]              [mode] [proxy]   [⚙]  [🕶]  [▶ RUN]
                 [备注]
```

- **▶ RUN** ：正常打开（大窗 1200×800）；按住 `Shift` 点 = 小窗（320×240）
- **🕶**：用该 profile 起无痕窗（不读 cookie/缓存，不加载扩展）
- **⚙**：弹编辑窗改这个 profile（emoji / 主题色 / 模式 / 代理）

### 编辑工作区

点 ⚙ 或 ＋ 新建会弹出 480×580 的编辑窗：

| 字段 | 说明 |
|---|---|
| NAME | 工作区显示名 |
| NOTE | 一句话备注，会显示在浏览器窗顶部 |
| EMOJI | 16 个图标可选（🐱 💻 🎮 📚 🎵 🍿 💬 🛠 🌐 ✈️ 📝 🔬 🎨 💼 🚀 ☕） |
| THEME | 黄/绿/红 — 顶部 strip 颜色 + 边框颜色 |
| MODE | `work`（工作首页 = 个人书签） / `slack`（推荐首页 = 视频音乐新闻炒币论坛） |
| 显示书签首页 | 工作模式时强制走自定义首页（旧字段，保留兼容） |
| PROXY | direct / system / **http(s)** / socks5；选 http(s) 时同端口同时代理 HTTP 和 HTTPS |

> 数据落盘 `~/.meowser/profiles.json`，可手改也能 GUI 编辑。

---

## 四. 浏览器窗

```
┌────────────────────────────────────────────────────────────┐
│ 💻 工作 · 公司 V2Ray                       v0.2.3   156 MB │  ← 主题色 strip（双击切大小窗）
├────────────────────────────────────────────────────────────┤
│ ← → ↻ 🏠 [输入网址或关键词]  查询 ⭐ 📚 [HTTP(S):1087] [滑块] 📌 🪶 🕶 ⤢ 🌐 │
├────────────────────────────────────────────────────────────┤
│ 🐙 GitHub | 📓 Notion | 📐 Linear | 🔍 Stack Overflow      │  ← 书签栏（小窗模式自动隐藏）
├────────────────────────────────────────────────────────────┤
│                                                            │
│                  [webview - 当前网页]                       │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

### 顶部 strip

- 主题色背景，可拖动整个窗口
- 显示：`emoji 名称 · 备注    版本号    内存`
- 内存：每 5 秒刷新（主进程 + 所有 webview 子进程总占用），≥500MB 橙色，≥1GB 红色
- **双击 strip = 切大小窗**

### 工具栏（13 个按钮 + 1 个滑块）

| 按钮 | 作用 |
|---|---|
| ← → | 历史前后 |
| ↻ | 刷新 |
| 🏠 | 回工作区首页（work=书签卡片，slack=推荐站点） |
| URL 框 | 输入回车跳转：`xxx.com` 自动加 https，纯关键词走 Google 搜索 |
| 查询 | 同上（点击代替回车） |
| ⭐ | 当前页加书签到本工作区 |
| 📚 | 打开书签管理窗（默认聚焦当前 profile） |
| 代理 pill | 显示当前代理：DIRECT / SYSTEM / HTTP(S):1087 / SOCKS5:1086 |
| 透明度滑块 | 30% – 100% 整窗透明度（30% 几乎透明摸鱼用） |
| 📌 | 置顶切换（默认开） |
| 🪶 | **失焦自动缩回小窗**（点开后大写小窗失焦自动缩） |
| 🕶 | 切换为无痕窗口（关掉当前重开） |
| ⤢ | 大窗 ↔ 小窗（同 strip 双击效果） |
| 🌐 | 用系统 Safari 打开当前页（按 Shift 点 = 用 Chrome 打开） |

### 书签栏

工具栏下方的横排 favicon 列表，点了就跳。**右键单条书签**有菜单：
- 在浏览器打开
- 系统 Safari 打开
- 系统 Chrome 打开
- 复制链接
- 删除书签

无书签时显示提示：「点工具栏 ⭐ 添加，或点 📚 → 从 Chrome 导入」。

### 大小窗

- **大窗**：1200×800，工具栏全 13 按钮 + 透明度滑块 + 书签栏
- **小窗**：320×240，只剩 ← ↻ [URL] 📌（其余隐藏，省地方）

---

## 五. 书签管理

打开方式：
- 浏览器工具栏 **📚** （自动聚焦当前 profile）
- 启动器顶部 **📚 书签** （默认聚焦第一个 profile）
- 菜单栏 🐱 → 浏览器子菜单（手动切 profile）

```
┌─────────── 书签管理 · v0.2.3 ───────────┐
│ [💻 工作]  🔍 搜索···  [Chrome 导入][HTML 导入][导出][＋添加]│
├──────────┬────────────────────────────────────────────┤
│ 工作区     │ ☐ NAME / URL                  添加于    操作  │
│ 🐱 默认 1  │ ☐ 🐙 GitHub                 3 天前    手动 / 导入 │
│ 💻 工作 8  │ ☐ 📓 Notion                 5 天前    手动 / 导入 │
│ 🎮 娱乐 1  │ ☐ 📐 Linear                 1 周前    手动 / 导入 │
│ 💰 炒币 1  │ ☐ 📊 Google Docs · 工作文档  2 周前    手动 / 导入 │
│           │ ☐ ❓ Stack Overflow          3 周前    手动 / 导入 │
│ 视图       │ ☐ 🐙 GitHub · foo/bar        1 月前    手动 / 导入 │
│ 📋 全部 8  │ ☐ 🐙 GitHub · baz/qux        2 月前    手动 / 导入 │
│ ⏱ 最近 7天 2│ ☐ 🎨 Figma                  3 月前    手动 / 导入 │
│ 🔁 重复 URL 3│                                                  │
├──────────┴────────────────────────────────────────────┤
│ 📂 ~/.meowser/bookmarks/p_work.json        8 / 8 条    │
└─────────────────────────────────────────────────────────┘
```

### 三种导入

| 来源 | 怎么用 | 适合 |
|---|---|---|
| **Chrome 导入** | 点按钮 → 自动读 `~/Library/Application Support/Google/Chrome/Default/Bookmarks` | 已是 Chrome 用户，一键平移 |
| **HTML 导入** | 点按钮 → 选 .html 文件 → 解析 `<A HREF=...>` 入库 | 从 Firefox / Safari / 任意浏览器导出后导入 |
| **手动 ＋添加** | NAME + URL | 单条添加 |

> 都自动按 URL 去重；同一条多次导入只存一份。

### 导出

点 **导出** → 选保存路径 → 生成 Netscape 格式 `.html`。这个文件能被 Chrome / Edge / Firefox / Safari 直接导入。

### 视图

- **全部**：显示该 profile 的所有书签
- **最近 7 天**：按 `ts` 字段过滤
- **重复 URL**：按 hostname 分组，>1 的列出（找到同一站点的多条记录）

### 批量操作

勾任意一行 → 顶部弹**蓝色 bulk-bar**：

```
[ 已选 3 项 | 批量删除 | 导出选中 |              取消 ✕ ]
```

- **批量删除**：确认后一次删完
- **取消** 或点表头复选框：清空选择

### 单条操作

- **点书签名**：用系统 Safari 打开（不在 Meowser 里）
- **悬停**：右侧出现 🗑 删除按钮
- **检查添加时间**：悬停「N 天前」会出现 tooltip 显示精确时间戳

---

## 六. 扩展安装

Meowser 是 Chromium 内核，**完整支持 Chrome 扩展**（包括 1Password、uBlock Origin、Vimium、Tampermonkey 等）。

### 方式 A：从 Chrome Web Store 在线装（推荐）

1. 启动器 → **🛒 在线装**
2. 弹输入框，粘扩展页面 URL（或 32 字符 ID）
   ```
   https://chromewebstore.google.com/detail/ublock-origin/cjpalhdlnbpafiamejdnhcphjbkeiagm
   ```
3. 选目标工作区（哪个 profile 用这个扩展）
4. 等几秒，自动下载 .crx + 剥 CRX header + 解压到 `~/.meowser/extensions/<profile_id>/<extension_name>/`
5. **重启该工作区窗口**生效（关掉再重新点 ▶ RUN）

> ⚠️ CRX 下载走 Node 直连，不走 Meowser 设的代理。如果你出网必须经代理（公司限制）→ 用方式 B。

### 方式 B：本地装（unpacked extension 目录）

1. 自己有 unpacked extension 目录（例如 `dist/` 或开发中的扩展）
2. 启动器 → **📦 本地装** → 选目录 → 选目标工作区
3. 自动拷贝到 `~/.meowser/extensions/<profile_id>/<extension_name>/`
4. 重启该工作区窗口

### 1Password 实战

```bash
# 1. 在另一台浏览器装 chrome-extension-downloader 或类似插件
#    把 1Password 扩展 ID = aeblfdkhhhdcdjpifhhbdiojplfjncoa 下载成 .crx
# 2. 解压
mkdir -p ~/.meowser/extensions/p_work/1password
brew install 7zip  # 如未装
7z x onepassword.crx -o ~/.meowser/extensions/p_work/1password
# 3. 启动 Meowser → 选「工作」profile → 1Password 自动加载
```

> 注意：1Password 有 **Safari 版** 和 **Chrome 版** 两个产物。**Chromium 内核要 Chrome 版**。

### 删扩展

```bash
# 删除特定扩展
rm -rf ~/.meowser/extensions/p_work/1password
# 或一次清空某 profile
rm -rf ~/.meowser/extensions/p_work
```

下次启动该 profile 不再加载这些扩展。

---

## 七. 无痕模式

三个入口：

1. **启动器顶部「🕶 无痕」**：用第一个 profile 临时起一个
2. **行内 🕶 按钮**：用该 profile 起无痕窗
3. **浏览器工具栏 🕶**：把当前窗切成无痕（关闭重开）

### 无痕特征

- ✅ 标题栏多个「🕶 无痕」徽标 + 黑色边框（区别正常窗的彩色）
- ✅ partition 不带 `persist:` 前缀 → cookie / 缓存 / localStorage 全在内存，关窗即销毁
- ✅ **不加载扩展**（不安全，特意禁用）
- ✅ **不显示书签栏**（书签栏显示「🕶 无痕模式 — 不显示书签」）
- ✅ ⭐ 加书签按钮也禁用
- ✅ 同一 profile 起多个无痕窗 → 各自独立 session（不共享 cookie）

### 用途场景

- 用别人账号登录看东西
- 测试网站登录前/登录后差异
- 调试代理 / 排查 cookie 问题
- 一次性临时浏览

---

## 八. 配置导出 / 导入

### 导出（备份 / 换电脑）

启动器 → **📤 导出** → 选保存路径（默认 `~/Meowser_backup_<时间戳>.zip`）

zip 含：
- `profiles.json` — 工作区配置
- `bookmarks/` — 每个 profile 的书签 JSON
- `extensions/` — 已装扩展目录
- `config.json` — 其他配置

**不含** `cache/`（首页缓存，启动后自动重建）。

实测大小：3 个 profile + 1 个扩展 ≈ 80KB；含 1Password 扩展约 ~10MB。

### 导入（还原 / 换电脑）

启动器 → **📥 导入** → 选 zip 文件 → 选冲突策略：
- **覆盖**：同名文件用 zip 里的版本替换
- **保留现有**：同名跳过

> 不会自动重启窗口。导入后建议关掉所有 Meowser 窗，重新从启动器打开 profile。

---

## 九. 菜单栏快捷入口

菜单栏右上角的 🐱 图标点开有：

```
Meowser  v0.2.3              ← 当前版本
─────────────────────
🐱 默认  ▶
   正常打开
   🕶 无痕打开
   小窗打开
💻 工作  ▶
🎮 娱乐  ▶
─────────────────────
🕶 临时无痕窗口             ← 用第一个 profile
─────────────────────
启动器…              ⌘⌥L
显示/隐藏所有窗口     ⌥`
─────────────────────
退出 Meowser         ⌘Q
```

每个 profile 有 3 种打开方式（正常 / 无痕 / 小窗）。

---

## 十. 快捷键速查

| 快捷键 | 作用 |
|---|---|
| `⌥`` (Option + 反引号) | 显示 / 隐藏所有浏览器窗（不影响启动器） |
| `⌘⌥L` | 打开 / 唤醒启动器 |
| `⌘Q` | 完全退出 Meowser |
| URL 框内 `Enter` | 跳转 |
| `Shift` + 点 ▶ RUN | 小窗打开 profile |
| `Shift` + 点 🌐 | 用系统 Chrome 打开（不按 Shift = Safari） |
| 双击顶部 strip | 切换大小窗 |

---

## 十一. 常见问题 FAQ

### Q: 怎么辨认我跑的是新版还是老版？

三个地方都印着版本号，任选其一确认：

1. **菜单栏 🐱** 第一行：`Meowser  v0.2.3`
2. **启动器底部 footer**：`v0.2.3 · Electron 41.5.0`
3. **浏览器窗顶部 strip**：彩色条最右边灰底 `v0.2.3` 徽标

如果还是 `v0.1.0` 或没版本号，说明你装的是更老的版本，需要重装最新 dmg。

### Q: 代理没生效怎么办？

打开浏览器窗看 URL 框右边的 pill：
- `DIRECT` = 直连，没走代理
- `HTTP(S):1087` = 走 HTTP 代理（**正确**）
- `SOCKS5:1086` = 走 SOCKS5
- `SYSTEM` = 跟随系统代理

如果 profile 配置的是 http 代理但 pill 还是 DIRECT：
1. 关掉浏览器窗 → 启动器 ⚙ 编辑该 profile → 重存一次
2. 或检查 `~/.meowser/profiles.json` 里 proxy 字段
3. v0.2.0+ 已修复 webview 不走代理的 bug，**老版本需要升级**

### Q: 装了扩展但浏览器里看不到 / 不生效？

- 重启该 profile 的浏览器窗（关掉再点 RUN）
- 确认目录结构：`~/.meowser/extensions/<profile_id>/<extension_name>/manifest.json` 存在
- 看启动 console（开发模式跑 npm start）有没有 `✓ 扩展加载` 或 `✗ 扩展加载失败`

### Q: 多个工作区会不会串台？

不会。每个 profile 是独立的 Chromium session（不同 partition），cookie / 缓存 / localStorage / IndexedDB / 扩展 全部隔离。哪怕同时登录同一站点不同账号也互不影响。

### Q: 数据存在哪？

```
~/.meowser/                                  ← 用户数据
├── profiles.json                            工作区配置
├── bookmarks/<profile_id>.json              书签
├── extensions/<profile_id>/<ext>/           扩展
└── cache/home_*.html                        首页缓存（可删）

~/Library/Application Support/meowser/Partitions/   ← Chromium session
└── meowser-<profile_id>/
    ├── Cookies
    ├── IndexedDB/
    ├── Local Storage/
    └── Service Worker/
```

迁移到新电脑：导出 zip 只含前者；后者由 Electron 自动维护。如果你需要保留 cookie，得自己拷 Application Support 那边。

### Q: 失焦自动缩回（🪶）什么用？

工作时挂个浏览器在右下角小窗看实时数据，但偶尔需要看全屏 → 切大窗。
点 🪶 开启后：你点别处（窗口失焦），它自己缩回小窗 → 不挡视线又随时能看一眼。

### Q: 透明度滑块拖到 30% 看不清字了怎么办？

- 拖回来：滑块向右
- 或快捷键关键词：透明度只影响 Meowser 自己，不影响系统其他窗口

### Q: 怎么改全局快捷键？

目前没 GUI。改 `~/Desktop/work/Code/Tool/meowser-electron/src/main.js` 里这两行：

```js
globalShortcut.register('Alt+`', toggleAllWindows);
globalShortcut.register('CommandOrControl+Alt+L', () => createLauncher());
```

改完重新 `npm run build:mac` 重打 dmg。

---

## 十二. 故障排查

### 浏览器窗白屏

1. 看版本：v0.1.x 已知有 webview 加载 bug，必须升级到 v0.2.0+
2. 看 console（npm start 跑日志，或 dmg 装的 .app 用 `Console.app` 看 Meowser 进程）
3. 网络问题？换 profile 配 direct 看是不是代理失败

### 启动器空白 / 没响应

```bash
# 完全重启
pkill -9 -f Meowser
pkill -9 -f Electron
rm -rf ~/.meowser/cache
open /Applications/Meowser.app
```

如果还是不行，把 `~/.meowser/profiles.json` 备份后删除，让它生成新的默认 3 个 profile。

### 「无法验证开发者」打不开

```bash
xattr -cr /Applications/Meowser.app
```

或右键 Meowser.app → 「打开」 → 弹框点「打开」（首次绕过 Gatekeeper）。

### 扩展加载失败

`npm start` 看 console，找 `✗ 扩展加载失败:` 这行，后面会有具体错误（manifest.json 缺、版本不兼容等）。

最常见：`manifest_version: 2` 的扩展现在有些 API 没了，要找作者的 v3 版本。

### 内存徽标飙红（>1GB）

正常浏览器都这样 — Chromium 一个网页占 200-500MB 不奇怪。开多个 webview 累加更高。
- 关掉不用的 profile 窗口
- 或者：右键菜单栏 🐱 → 退出 Meowser，重启释放

### dmg 装好但找不到 Meowser

```bash
# 看是不是没拖
ls /Applications | grep Meowser
# 或在 dmg 里
open ~/Desktop/work/Code/Tool/meowser-electron/dist/Meowser-*.dmg
# 拖左边 Meowser.app → 右边 Applications 文件夹
```

### 报告 bug

附上：
1. 版本号（菜单栏 🐱 第一行）
2. 操作步骤
3. console 输出（如能复现）

---

**祝你摸鱼愉快 🐱**
