// 工作模式首页 — 渲染 profile 自己的书签
function escapeHtml(s){return String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function safeHost(u){try{return new URL(u).hostname}catch{return''}}

function bmCard(b) {
  return `
    <a href="${escapeHtml(b.url)}" title="${escapeHtml(b.url)}">
      <img src="https://www.google.com/s2/favicons?sz=64&domain=${encodeURIComponent(safeHost(b.url))}" onerror="this.style.display='none'">
      <span>${escapeHtml(b.title || b.url)}</span>
    </a>`;
}
function recentCard(h) {
  const host = safeHost(h.url);
  const ago = h.last_visit_at ? fmtAgo(h.last_visit_at) : '';
  return `
    <a class="recent-card" href="${escapeHtml(h.url)}" title="${escapeHtml(h.url)}">
      <img src="https://www.google.com/s2/favicons?sz=64&domain=${encodeURIComponent(host)}" onerror="this.style.display='none'">
      <div class="rc-meta">
        <div class="rc-title">${escapeHtml(h.title || h.url)}</div>
        <div class="rc-host">${escapeHtml(host)}${ago ? ' · ' + ago : ''}</div>
      </div>
    </a>`;
}
function fmtAgo(iso) {
  try {
    const sec = (Date.now() - new Date(iso).getTime()) / 1000;
    if (sec < 60)    return Math.floor(sec) + 's前';
    if (sec < 3600)  return Math.floor(sec/60) + 'm前';
    if (sec < 86400) return Math.floor(sec/3600) + 'h前';
    return Math.floor(sec/86400) + 'd前';
  } catch { return ''; }
}

function renderWorkHome(profile, bookmarks = [], recent = []) {
  const themeColors = { red: '#FF3B30', green: '#34C759', yellow: '#FFCC00' };
  const themeColor = themeColors[profile.theme] || '#FFCC00';

  // 按 folder 分组：未分类在前，文件夹按名排序
  const groups = new Map();
  bookmarks.forEach(b => {
    const k = b.folder || '';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(b);
  });
  const folderNames = [...groups.keys()].filter(k => k).sort();
  const ordered = ['', ...folderNames];  // 未分类('')在最前

  const bookmarkSections = ordered.filter(k => groups.has(k)).map(folder => {
    const list = groups.get(folder);
    const title = folder ? `📁 ${escapeHtml(folder)}` : '未分类';
    return `<section>
      <h2>${title} <span class="cnt">${list.length}</span></h2>
      <div class="grid">${list.map(bmCard).join('')}</div>
    </section>`;
  }).join('');

  // 最近访问（双列大卡片 + 主机名 + 访问时间）
  const recentSection = recent.length === 0 ? '' : `<section>
    <h2>🕘 最近访问 <span class="cnt">${recent.length}</span></h2>
    <div class="recent-grid">${recent.map(recentCard).join('')}</div>
  </section>`;

  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(profile.name)}</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;background:#fafafa;color:#1d1d1f;padding:32px 40px;min-height:100vh}
header{display:flex;align-items:center;gap:12px;padding-bottom:20px;border-bottom:2px solid ${themeColor};margin-bottom:24px}
header .emoji{font-size:32px}header h1{font-size:22px;font-weight:700}
header .note{font-size:12px;color:#86868b;margin-left:auto}
.search{margin:0 0 28px;display:flex;gap:8px}
.search input{flex:1;height:40px;padding:0 16px;font-size:14px;border:1px solid #d2d2d7;border-radius:8px;background:#fff;outline:none}
.search input:focus{border-color:${themeColor};box-shadow:0 0 0 3px ${themeColor}33}
.search button{height:40px;padding:0 18px;background:${themeColor};color:#fff;border:none;border-radius:8px;font-weight:600;cursor:pointer}
section h2{font-size:13px;text-transform:uppercase;color:#86868b;letter-spacing:0.5px;margin-bottom:12px;display:flex;align-items:center;gap:8px}
.cnt{font-size:10px;background:rgba(0,0,0,0.06);padding:2px 7px;border-radius:9px;color:#86868b}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:8px}
.grid a{display:flex;align-items:center;gap:10px;padding:10px 12px;background:#fff;border:1px solid #e5e5ea;border-radius:8px;text-decoration:none;color:#1d1d1f;font-size:13px;overflow:hidden}
.grid a:hover{border-color:${themeColor};transform:translateY(-1px);transition:all 0.15s}
.grid a img{width:18px;height:18px;flex-shrink:0}
.grid a span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.empty{color:#86868b;text-align:center;padding:60px 0;font-size:13px;background:#fff;border:1px dashed #d2d2d7;border-radius:10px}
.empty kbd{padding:2px 8px;background:#f0f0f3;border-radius:4px;font-family:ui-monospace,monospace;font-size:11px}
/* 最近访问大卡片 */
.recent-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px;margin-bottom:20px}
.recent-card{display:flex;align-items:center;gap:12px;padding:14px 16px;background:#fff;border:1px solid #e5e5ea;border-radius:10px;text-decoration:none;color:#1d1d1f;transition:all 0.15s;overflow:hidden}
.recent-card:hover{border-color:${themeColor};transform:translateY(-1px);box-shadow:0 4px 12px rgba(0,0,0,0.06)}
.recent-card img{width:28px;height:28px;flex-shrink:0;border-radius:6px}
.recent-card .rc-meta{flex:1;min-width:0}
.recent-card .rc-title{font-size:13px;font-weight:500;color:#1d1d1f;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-bottom:2px}
.recent-card .rc-host{font-size:11px;color:#86868b;font-family:ui-monospace,monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
</style></head><body>
<header><span class="emoji">${escapeHtml(profile.emoji||'🐱')}</span><h1>${escapeHtml(profile.name)}</h1><span class="note">${escapeHtml(profile.note||'')}</span></header>
<form class="search" onsubmit="location.href='https://www.google.com/search?q='+encodeURIComponent(this.q.value);return false">
  <input name="q" placeholder="Google 搜索..." autofocus>
  <button>搜索</button>
</form>
${recentSection}
${bookmarks.length === 0
  ? '<section><h2>书签 <span class="cnt">0</span></h2><div class="empty">还没书签 — 浏览时点工具栏 <kbd>⭐</kbd> 添加，或点工具栏 <kbd>📚</kbd> →「从 Chrome 导入」</div></section>'
  : bookmarkSections}
</body></html>`;
}

module.exports = { renderWorkHome };
