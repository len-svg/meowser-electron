<!-- [skill: go-team-standards · 技术方案] 批量窗口管理面板（含 HTML UI 原型） -->

---
title: "Meowser - 批量窗口管理面板技术方案"
version: "0.1.0"
last_modified: "2026-05-26"
target_release: "v0.5.0"
owner: "len"
---

# Meowser 批量窗口管理面板技术方案

## 目录

1. 背景与概述
2. 目标与原则
3. 现状分析
4. 总体方案
5. 本地状态设计（取代"数据库设计"——纯运行时内存，不持久化）
6. IPC 接口设计（取代"接口设计"——本地进程间通信，无 HTTP）
7. 异常处理 / 兜底策略
8. 上线计划与回滚方案
9. 风险与待定事项
10. UI 原型（HTML，可独立预览）

---

## 1. 背景与概述

### 1.1 项目背景

Meowser 是 Chromium 内核浮动浏览器，支持多工作区（profile），每个工作区可同时开多个窗口（大窗 1200×800 / 小窗 320×240），最高记录用户开过 12 个窗口。当前**没有任何集中管理窗口的入口**：

* 系统层面只能 Mission Control / Dock / ⌘`（同 app 切窗），定位特定窗口靠肉眼
* 关闭只能 ⌘W 一个一个关，关 10 个就要 10 次操作
* 不知道哪个窗口占内存最多、哪个开了多久、各自打开了什么页

### 1.2 范围说明

| 类别 | 在范围内 | 不在范围内 |
| --- | --- | --- |
| 列表展示 | 所有 BrowserWindow（工作区窗 + 无痕窗）；启动器/编辑窗/书签管理器**不入列** | iframe / 子 webview 单独列 |
| 单窗操作 | 聚焦、关闭、切大/小窗、置顶切换 | 直接编辑 URL、拖到其他工作区 |
| 批量操作 | 多选关、按 profile 关、关无痕全部、保留聚焦关其他 | 批量改 URL、批量截图 |
| 排序/筛选 | profile / 打开时间 / 内存占用 / 是否无痕 | 跨设备多窗口同步 |
| 持久化 | **不持久化**（关 app 后状态消失）| 历史窗口快照、恢复上次窗口集 |

---

## 2. 目标与原则

### 2.1 业务目标

* 一处看全所有 Meowser 窗口：emoji、标题、URL、打开时长、内存
* 批量关闭：≥ 3 个窗口时，关全部 / 关一类操作 ≤ 2 次点击
* 快速聚焦：列表点行 → 该窗口前置 + 焦点
* 入口可达：启动器 pill、托盘菜单、全局快捷键 ⌃⌘W 任一可触发

### 2.2 技术目标

| 指标 | 目标值 |
| --- | --- |
| windows:list IPC 往返延迟 | < 30ms（本地 IPC） |
| 列表实时刷新 | 任一窗口 closed/focus/blur → 100ms 内 UI 更新 |
| 内存数据滞后 | ≤ 5s（复用现有 pushMemoryToWindows 节奏） |
| 面板自身内存占用 | < 50MB |

### 2.3 设计原则

1. **零持久化**：窗口列表是瞬时态，不写盘，不引入 schema
2. **复用现有能力**：profile 关联、内存采集、置顶/小窗 IPC 已有，**只新建"列表 + 批量关闭"** 部分
3. **管理面板不计入自己**：自己不出现在列表里，避免误关
4. **批量关闭可撤销不做**：关了就关了（webview 关闭不可逆，无意义），但**关之前确认**
5. **入口冗余**：3 个入口（pill / shortcut / tray）任一可达，防止"功能藏太深"

---

## 3. 现状分析

### 3.1 当前窗口创建/销毁路径

| 窗口类型 | 创建函数 | 持有引用 | 是否有 profile |
| --- | --- | --- | --- |
| 启动器 | createLauncher() | 全局 `launcherWindow` | 否 |
| 编辑工作区 | openEditWindow() | 全局 `editWindow` | 否 |
| 书签管理器 | openBookmarkManager() | 全局 `bmManagerWindow` | 否 |
| 工作区浏览器窗（大/小/无痕） | createBrowserWindow(profile, opts) | **无集中索引**，靠 `BrowserWindow.getAllWindows().filter(w => w.profile)` 临时筛 | 是，挂在 `win.profile` |

**痛点**：判断"是不是工作区浏览器窗"只能靠 `w.profile` 这个非标准属性 + filter。批量操作时反复 filter 性能可以接受（窗口数 ≤ 50），但**没有结构化的窗口元数据**（opened_at、last_focused_at 等都没记）。

### 3.2 当前已有的可复用能力

| 能力 | 位置 | 复用方式 |
| --- | --- | --- |
| 内存监控 | main.js `pushMemoryToWindows()` | 每 5s 已采集，扩展为 emit windows:changed |
| 置顶切换 | `window:toggleAlwaysOnTop` IPC | 直接复用 |
| 大/小窗切换 | `window:toggleSize` IPC | 直接复用 |
| 无痕标记 | `win.__incognito` 属性 | 直接读 |
| profile 数据 | `win.profile` 属性 | 直接读 |

---

## 4. 总体方案

### 4.1 架构图

```
┌────────────────────────────────────────────────────────────────┐
│  主进程 (main.js)                                              │
│                                                                │
│   ┌──────────────────────────────┐    ┌─────────────────────┐  │
│   │ 窗口注册表 windowRegistry    │    │ 窗口元数据补充       │  │
│   │ Map<windowId, WindowMeta>    │◄───┤ opened_at /         │  │
│   │ - 在 createBrowserWindow    │    │ last_focused_at /   │  │
│   │   时插入                     │    │ is_small / pinned   │  │
│   │ - on('closed') 时删除        │    └─────────────────────┘  │
│   │ - on('focus') 时刷 _at       │                            │
│   └──────────────────────────────┘                            │
│              │                                                 │
│              ├── ipcMain.handle('windows:list') ──────────────►│
│              ├── ipcMain.handle('windows:focus') ─────────────►│
│              ├── ipcMain.handle('windows:close') ─────────────►│
│              ├── ipcMain.handle('windows:closeBatch') ────────►│
│              ├── ipcMain.handle('windows:closeByProfile') ────►│
│              └── webContents.send('windows:changed') ◄────────│
│                                          每次 list 变化时广播  │
│                                                                │
└────────────────────────────────────────────────────────────────┘
                              ▲
                              │ IPC
                              ▼
┌────────────────────────────────────────────────────────────────┐
│  渲染进程：window_manager.html (新增)                          │
│                                                                │
│  ┌──────────────┬─────────────────────────────────────────┐    │
│  │ 顶部状态条   │ 共 5 个窗口 · 占用 ~1.2 GB · 刷新 ↻      │    │
│  ├──────────────┼─────────────────────────────────────────┤    │
│  │ Filter chips │ [全部 5] [默认 1] [工作 3] [娱乐 1] [无痕] │    │
│  ├──────────────┼─────────────────────────────────────────┤    │
│  │ Bulk bar     │ 已选 2 · [关闭选中] [清除]               │    │
│  ├──────────────┼─────────────────────────────────────────┤    │
│  │ 窗口列表     │ ☐ 🐱 默认 · "Google"   ··· 312MB  3m    │    │
│  │              │ ☐ 💻 工作 · "GitHub"  ··· 580MB 21m    │    │
│  │              │ ...                                       │    │
│  ├──────────────┼─────────────────────────────────────────┤    │
│  │ 底部批量     │ [关全部][留聚焦关其他][关所有无痕][关此 profile]│
│  └──────────────┴─────────────────────────────────────────┘    │
└────────────────────────────────────────────────────────────────┘
```

### 4.2 关键模块清单

| 模块 | 文件 | 新增 / 改动 | 行数估算 |
| --- | --- | --- | --- |
| 窗口注册表 | src/main.js | 改动：createBrowserWindow 增 register；增 windowRegistry Map | +60 |
| IPC 处理 | src/main.js | 新增 5 个 ipcMain.handle | +80 |
| 生命周期广播 | src/main.js | win.on('closed'/'focus') → broadcastWindowsChanged | +20 |
| 内存联动 | src/main.js | pushMemoryToWindows 末尾顺手 broadcastWindowsChanged | +2 |
| preload 暴露 | src/preload.js | 5 个 api.\* 函数 + 1 个 onWindowsChanged | +12 |
| 管理面板 UI | src/window_manager.html | 新文件 | ~420 |
| 启动器入口 | src/launcher.html | 加一个 🗂 pill | +8 |
| 托盘入口 | src/main.js (buildTrayMenu) | 加 "窗口管理…" 项 | +2 |
| 全局快捷键 | src/main.js | globalShortcut.register('Ctrl+Cmd+W', openWindowManager) | +1 |
| 自动测试 | tests/window_manager_test.js | 新文件，Playwright 覆盖 list/close/focus | ~120 |

### 4.3 触发入口

1. **启动器 pill** "🗂 窗口" —— 与"📚 书签 / 📜 历史"并列，可视性最高
2. **全局快捷键** `Ctrl+Cmd+W` —— 操作中快速调出
3. **托盘菜单**  → "窗口管理…" —— 兜底入口
4. **chrome.html 主菜单** ⋮ → "窗口管理…" —— 浏览过程中调用

---

## 5. 本地状态设计（取代"数据库设计"）

### 5.1 为何不持久化

* 窗口 id 仅进程生命周期内稳定
* 关闭 app 即所有窗口销毁，再开是新窗口
* 无跨设备同步需求
* 持久化反而引入恢复/合并逻辑的复杂度

**结论：纯内存 Map，进程退出即丢。**

### 5.2 WindowMeta 字段

字段命名遵循团队规范：时间一律 `_at` 后缀，无用户主体所以无 `uid`，无金额，无业务版本。窗口关闭即从 Map 直接 delete，不需要 `deleted_at`。

```typescript
interface WindowMeta {
  window_id:        number;   // electron BrowserWindow.id；进程内稳定
  profile_id:       string;   // 例 'p_default' / 'p_work' / 'p_fun'
  profile_emoji:    string;   // '🐱' / '💻' / '🎮'
  profile_name:     string;
  profile_theme:    string;   // 'yellow' / 'green' / 'red'
  is_incognito:     boolean;
  is_small:         boolean;  // 当前是否小窗模式
  always_on_top:    boolean;  // 当前是否置顶

  title:            string;   // webContents.getTitle()
  url:              string;   // webContents.getURL()

  opened_at:        string;   // ISO8601 UTC，窗口创建时刻
  last_focused_at:  string | null;  // ISO8601 UTC，最近一次 focus 事件时间；从未 focus 过为 null

  memory_kb:        number;   // 主进程 + webview 子进程合计；来自 app.getAppMetrics
  webview_count:    number;   // 该窗口下的 webview 子进程数（当前 1）
}
```

### 5.3 注册表生命周期

```
createBrowserWindow(profile, opts)
   ├─► 创建 BrowserWindow 实例
   ├─► windowRegistry.set(win.id, { window_id, profile_*, opened_at: nowUTC(), ... })
   ├─► win.on('focus', () => { meta.last_focused_at = nowUTC(); broadcast(); })
   ├─► win.on('page-title-updated', (_, title) => { meta.title = title; broadcast(); })
   ├─► win.webContents.on('did-navigate', (_, url) => { meta.url = url; broadcast(); })
   └─► win.on('closed', () => { windowRegistry.delete(win.id); broadcast(); })

pushMemoryToWindows()  // 每 5s
   └─► 顺便更新 meta.memory_kb；broadcast 一次
```

---

## 6. IPC 接口设计（取代"接口设计"）

### 6.1 接口清单

| 通道 | 方向 | 入参 | 出参 | 说明 |
| --- | --- | --- | --- | --- |
| `windows:list` | renderer→main | — | `WindowMeta[]` | 全部工作区窗口快照（不含 launcher/editor/bm-mgr 本身/window-mgr 本身） |
| `windows:focus` | renderer→main | `window_id: number` | `{ ok: boolean }` | window.show() + focus()；最小化则 restore() |
| `windows:close` | renderer→main | `window_id: number, force?: boolean` | `{ ok: boolean, cancelled?: boolean }` | force=false 时检测页面有 form input 数据则弹确认；force=true 直接关 |
| `windows:closeBatch` | renderer→main | `{ window_ids: number[], force?: boolean }` | `{ closed: number, cancelled: number }` | 串行关；任一 cancelled 不中断后续 |
| `windows:closeByProfile` | renderer→main | `{ profile_id: string, keep_focused?: boolean }` | `{ closed: number }` | 关该 profile 所有窗口；keep_focused=true 留住当前 focused |
| `windows:changed` | main→all renderers | — | — | 注册表变化时广播；前端收到后重新 invoke `windows:list` |

### 6.2 force 关闭的"确认"逻辑

`windows:close` 默认 force=false 时，会在主进程对目标窗 `webContents.executeJavaScript`：

```js
(() => {
  const inputs = document.querySelectorAll('input, textarea, [contenteditable]');
  for (const el of inputs) {
    const v = (el.value || el.textContent || '').trim();
    if (v.length > 5) return true;  // 有疑似未保存内容
  }
  return false;
})()
```

返回 true 则 main 通过 dialog 弹"该窗口疑似有未保存内容，确认关闭？"，用户确认才真正 close。

**为什么 5 字符阈值**：避免单字符触发；非完美启发式，权衡误报与漏报。

### 6.3 错误码 / 出参约定

* 本地 IPC，错误直接 throw 由 ipcMain 序列化传回 renderer 的 invoke 拒绝路径
* 业务结果用对象 `{ ok: boolean, ... }`，不用裸 boolean 留扩展空间
* 没有 HTTP status / errno —— 团队 errno.md 不适用，这里全是 in-process 调用

---

## 7. 异常处理 / 兜底策略

| 场景 | 处理 |
| --- | --- |
| renderer invoke 后到 main 之间窗口被关 | `windows:focus / close` 检查 `BrowserWindow.fromId(id)` 为空 → 返回 `{ ok: false }`；UI 收到后自动 refresh 列表 |
| 多个 renderer 并发关同一窗 | main 端用 `windowRegistry.has(id)` 短路第二次操作；返回 `{ ok: false, reason: 'already_closed' }` |
| `executeJavaScript` 探测 form 超时 / 报错 | catch 后视为 "无未保存" 直接关；记 console.warn 进日志 |
| 内存数据缺失（getAppMetrics 失败） | meta.memory_kb = 0，UI 显示 "—" |
| 列表广播频率过高（高频聚焦切换） | broadcast 加 50ms debounce，避免 renderer 重渲染抖动 |
| 关闭管理面板自身 | 列表 filter 排除 `window_manager.html`；用户从外部 Cmd+W 关自己时只销毁 manager 窗，不影响注册表 |
| 关闭最后一个工作区窗后 app 退出（mac 习惯保留 dock） | 维持现有 `app.on('window-all-closed')` 行为 |

---

## 8. 上线计划与回滚方案

### 8.1 版本规划

| 版本 | 内容 | 备注 |
| --- | --- | --- |
| v0.4.2 | ⌘C/⌘V 修复 + Playwright 基建（**当前已发**） | dmg + zip 已在 `dist/` |
| v0.5.0-rc.1 | 本方案的窗口管理面板，**功能完整 + Playwright 测试通过** | 走 PR 当前分支 |
| v0.5.0 | rc 用 3 天观察，确认没有窗口"漏关"/"误关" | 合 main，标 tag |

### 8.2 验证 checklist

发版前必须通过：

1. `npm run test:smoke`（菜单 / 剪贴板 / 启动器 / chrome.html 截图全过）
2. **新增** `node tests/window_manager_test.js`：
   * 开 3 个不同 profile 窗口 → list 返回 3 条
   * 关 1 个 → list 返回 2 条 + 收到 windows:changed
   * closeBatch 关另 2 个 → list 返回 0 条
   * closeByProfile keep_focused → 留 1
3. 手测：关 5 个窗口 ≤ 2 次点击；点行能聚焦
4. 内存对比：管理面板自身 < 50MB（活动监视器看）

### 8.3 回滚

* 纯前端 + IPC 新增，**没改任何数据 schema、没改 profile json 格式**
* 回滚到 v0.4.2 dmg 即彻底失效，用户数据不受影响
* `~/.meowser/` 目录无新文件

---

## 9. 风险与待定事项

### 9.1 已识别风险

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| executeJavaScript 探测 form 在跨域 iframe 内不生效 | 子 iframe 里有未保存内容时误关 | 接受；记入 README known-limitation；按需让用户 Cmd+Z 之类操作系统层面找回（实际找不回） |
| 大量窗口（>20）时 windows:changed 高频触发 | UI 抖动、CPU 占用 | 已设 50ms debounce |
| Electron 版本升级导致 `app.getAppMetrics` API 变更 | 内存列消失 | UI 兜底显示 "—"，不报错 |
| 全局快捷键 `Ctrl+Cmd+W` 与某些 app 冲突 | 触发不了 | 启动时 globalShortcut.register 返回 false 则降级，仅保留启动器 pill 入口 |

### 9.2 待定事项

| 编号 | 议题 | 决策 |
| --- | --- | --- |
| TD-1 | 是否给每个窗口加 ⭐ "稍后恢复" 标记，关 app 时记到 ~/.meowser/last_session.json，下次开自动复原？ | **本期不做**；放 v0.6 |
| TD-2 | 是否支持"按 URL 域名分组关闭"？ | **本期不做**；优先级低 |
| TD-3 | 列表是否显示 favicon？需要从 webContents.getFavicons() 拉，可能慢 | **不做**，emoji 已经够区分 |
| TD-4 | 是否加快捷键 ⌃⌘W 全局，但用户系统已绑定怎么办 | 走 9.1 缓解策略 |

---

## 10. UI 原型

完整可独立预览的 HTML 文件位于 **`tests/_mockups/window_manager.html`**，浏览器直接打开即可看到。

预览特性：

* 假数据 5 个窗口（默认 / 工作 ×3 / 娱乐 + 1 个无痕）
* 全部交互逻辑（多选、过滤、批量关闭确认）有响应，但不实际关任何东西
* 配色与 Meowser 现有暗色 UI 风格一致：背景 `#1d1d1f`，主色按 profile theme（黄 / 绿 / 红 / 蓝）
* 响应式：≥ 800px 主列表，< 800px 紧凑模式

预览方法：

```bash
open tests/_mockups/window_manager.html
```

或直接拖到任意浏览器。

---

🌟
