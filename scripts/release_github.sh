#!/bin/bash
# 把当前 package.json 版本对应的 dist 产物推到 GitHub Releases
# 用法: scripts/release_github.sh [--draft]
#
# 前置：
#   - 已经跑过 npm run release:mac（dist/Meowser-vX.Y.Z-arm64.{dmg,zip,zip.blockmap} 都在）
#   - dist/latest-mac.yml 是当前版本的（auto-update 读这个文件）
#   - gh CLI 已登录（gh auth status）

set -euo pipefail

VERSION=$(node -p "require('./package.json').version")
TAG="v${VERSION}"
DMG="dist/Meowser-${VERSION}-arm64.dmg"
ZIP="dist/Meowser-${VERSION}-arm64.zip"
BLOCKMAP="dist/Meowser-${VERSION}-arm64.zip.blockmap"
LATEST_YML="dist/latest-mac.yml"

for f in "$DMG" "$ZIP" "$LATEST_YML"; do
  if [ ! -f "$f" ]; then
    echo "✗ 缺文件: $f" >&2
    echo "  先跑: npm run release:mac" >&2
    exit 1
  fi
done

# latest-mac.yml 必须对应当前版本
YML_VER=$(grep -E "^version:" "$LATEST_YML" | awk '{print $2}')
if [ "$YML_VER" != "$VERSION" ]; then
  echo "✗ latest-mac.yml 是 v${YML_VER}，跟 package.json v${VERSION} 不一致" >&2
  echo "  重跑: npm run release:mac" >&2
  exit 1
fi

EXTRA=""
if [ "${1:-}" = "--draft" ]; then EXTRA="--draft"; fi

# 已存在的 release 直接 upload 文件，不再创建
if gh release view "$TAG" -R len-svg/meowser-electron >/dev/null 2>&1; then
  echo "→ release $TAG 已存在，上传/覆盖文件"
  gh release upload "$TAG" "$DMG" "$ZIP" "$BLOCKMAP" "$LATEST_YML" --clobber -R len-svg/meowser-electron
else
  echo "→ 创建 release $TAG"
  NOTES=$(git log -1 --pretty=%B HEAD)
  gh release create "$TAG" \
    --title "Meowser $TAG" \
    --notes "$NOTES" \
    $EXTRA \
    -R len-svg/meowser-electron \
    "$DMG" "$ZIP" "$BLOCKMAP" "$LATEST_YML"
fi

echo ""
echo "✓ Released $TAG"
echo "  https://github.com/len-svg/meowser-electron/releases/tag/${TAG}"
