#!/bin/bash
# 批量推历史 release。两步走：
#   1. gh release create $TAG --notes ... 不带文件（瞬间完成）
#   2. gh release upload $TAG dmg zip （慢上传，失败可重试）
# 这样一步死掉不会卡 draft 状态。
set -euo pipefail

REPO=len-svg/meowser-electron

notes_for() {
  case "$1" in
    0.3.0) echo "Chrome 风工具栏重做 + 链接点击新窗口";;
    0.3.1) echo "日志持久化 + 扩展真实状态显示 + 商店页注入安装按钮";;
    0.4.0) echo "电子扩展运行时（license 缺失，已知 bug：扩展加载会失败）";;
    0.4.1) echo "修 license bug，扩展真能跑（MV2 扩展如 uBlock Origin Lite / Dark Reader）";;
    0.4.2) echo "macOS Edit/View 菜单（⌘C/⌘V/⌘R/zoom 全部工作）+ Playwright 测试基建";;
    0.5.0) echo "批量窗口管理面板（🗂 Cmd+Ctrl+W 唤起）";;
    0.6.0) echo "per-profile prefs/history/session restore + YubiKey + webview ⌘C/⌘V + pin 修复";;
    0.6.1) echo "session_store 拒绝 data:/about:/file:/ 协议 + 测试沙箱化";;
    0.6.2) echo "chrome.html safeGetURL — 修 webview pre-dom-ready 异常";;
    0.7.0) echo "大小窗等比 + webview ⌘+/⌘- 缩放 + Cmd+Alt+方向键切窗 + 书签文件夹 + 首页最近访问";;
    0.7.1) echo "URL bar 模糊匹配 + 历史管理器读 profile 参数 + ⋮ 菜单加历史入口";;
    *) echo "Archive release";;
  esac
}

VERSIONS="0.3.0 0.3.1 0.4.0 0.4.1 0.4.2 0.5.0 0.6.0 0.6.1 0.6.2 0.7.0 0.7.1"

for V in $VERSIONS; do
  TAG="v${V}"
  DMG="dist/Meowser-${V}-arm64.dmg"
  ZIP="dist/Meowser-${V}-arm64.zip"

  if ! [ -f "$DMG" ] || ! [ -f "$ZIP" ]; then
    echo "  skip $TAG: 缺 dmg/zip"
    continue
  fi

  # 1. 确保 tag 存在
  if ! git rev-parse "$TAG" >/dev/null 2>&1; then
    git tag "$TAG"
    git push origin "refs/tags/${TAG}" 2>&1 | tail -1
  fi

  # 2. 确保 release 存在（无文件）
  if ! gh release view "$TAG" -R "$REPO" >/dev/null 2>&1; then
    echo "→ 创建空 release $TAG"
    gh release create "$TAG" \
      --title "Meowser $TAG (archive)" \
      --notes "$(notes_for $V)" \
      -R "$REPO" 2>&1 | tail -1
  fi

  # 3. 检查是否已上传过文件
  HAS_DMG=$(gh release view "$TAG" -R "$REPO" --json assets --jq ".assets[].name" 2>/dev/null | grep -c "^Meowser-${V}-arm64.dmg$" || true)
  if [ "$HAS_DMG" = "1" ]; then
    echo "  $TAG dmg 已上传，跳过"
    continue
  fi

  # 4. 上传
  echo "→ 上传 $TAG 资产..."
  gh release upload "$TAG" "$DMG" "$ZIP" --clobber -R "$REPO" 2>&1 | tail -2
  echo "  ✓ $TAG 完成"
done

echo ""
echo "✓ 历史 release 完成"
gh release list -L 30 -R "$REPO" 2>&1 | head -25
