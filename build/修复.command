#!/bin/bash
# 双击运行：解除"已损坏"提示
# 原理：macOS Gatekeeper 给从网下载的未签名 app 加 com.apple.quarantine
# 扩展属性，导致"已损坏，无法打开"。本脚本清掉这个属性。

APP="/Applications/Meowser.app"
if [ ! -d "$APP" ]; then
  echo ""
  echo "  ❌ 没找到 $APP"
  echo "     请先把 Meowser.app 从 dmg 拖到 Applications，再双击这个脚本"
  echo ""
  read -p "  按 Enter 关闭..."
  exit 1
fi

echo ""
echo "  🔧 解锁 Meowser…"
xattr -cr "$APP" 2>&1
RC=$?

if [ $RC -eq 0 ]; then
  echo ""
  echo "  ✅ 已解锁，去 Launchpad / Applications 双击 Meowser 即可"
  echo ""
else
  echo ""
  echo "  ⚠️ xattr 报错（$RC），可能需要 sudo："
  echo "     sudo xattr -cr $APP"
  echo ""
fi
read -p "  按 Enter 关闭..."
