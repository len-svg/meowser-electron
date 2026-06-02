# Meowser 安装指南

## 下载

去 [Releases](https://github.com/len-svg/meowser-electron/releases/latest) 下 dmg：

* `Meowser-X.Y.Z-arm64.dmg` — Apple Silicon (M1 / M2 / M3 / **M4** / M4 Pro / M4 Max)
* `Meowser-X.Y.Z-x64.dmg`   — Intel Mac

## 首次安装（macOS Sequoia / Sonoma）

Meowser 没买 Apple Developer 签名（$99/年），macOS 会拦"无法验证开发者"或"已损坏，无法打开"。**这不是 app 坏了**，是 Gatekeeper 默认行为。

按下面**任一**方法绕过：

### 方法 A：终端一行（推荐）

把 dmg 拖到 Applications 后，**打开终端**执行：

```bash
xattr -dr com.apple.quarantine /Applications/Meowser.app
```

之后双击就能开。

### 方法 B：系统设置点"仍要打开"

1. 双击 Meowser.app → 弹"无法打开"对话框 → **关掉**它
2. 打开 **系统设置 → 隐私与安全性**
3. 滚到底部，看到 `"Meowser" 已被阻止使用...` → 点 **"仍要打开"**
4. 输入登录密码确认

## 自动更新

打开 Meowser → 顶部菜单 **Meowser → 检查更新…** (⌘,)

发现新版会弹下载提示。**因为未签名，自动替换 .app 仍可能被 Gatekeeper 拦**，每次升级后可能需要重跑一次方法 A 的命令：

```bash
xattr -dr com.apple.quarantine /Applications/Meowser.app
```

> v0.7.7+ 已在 build 时尝试自动深度 ad-hoc 签名，部分情况下不再需要手动 xattr。

## 如果还是不行

把 `~/.meowser/logs/meowser-YYYY-MM-DD.log` 贴 issue 给我。
