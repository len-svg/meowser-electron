// 工作模式首页 — 渲染 profile 自己的书签
function escapeHtml(s){return String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function safeHost(u){try{return new URL(u).hostname}catch{return''}}

function renderWorkHome(profile, bookmarks = []) {
  const themeColors = { red: '#FF3B30', green: '#34C759', yellow: '#FFCC00' };
  const themeColor = themeColors[profile.theme] || '#FFCC00';

  const items = bookmarks.map(b => `
    <a href="${escapeHtml(b.url)}" title="${escapeHtml(b.url)}">
      <img src="https://www.google.com/s2/favicons?sz=32&domain=${encodeURIComponent(safeHost(b.url))}" onerror="this.style.display='none'">
      <span>${escapeHtml(b.title || b.url)}</span>
    </a>`).join('');

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
</style></head><body>
<header><span class="emoji">${escapeHtml(profile.emoji||'🐱')}</span><h1>${escapeHtml(profile.name)}</h1><span class="note">${escapeHtml(profile.note||'')}</span></header>
<form class="search" onsubmit="location.href='https://www.google.com/search?q='+encodeURIComponent(this.q.value);return false">
  <input name="q" placeholder="Google 搜索..." autofocus>
  <button>搜索</button>
</form>
<section>
  <h2>书签 <span class="cnt">${bookmarks.length}</span></h2>
  ${bookmarks.length === 0
    ? '<div class="empty">还没书签 — 浏览时点工具栏 <kbd>⭐</kbd> 添加，或点工具栏 <kbd>📚</kbd> →「从 Chrome 导入」</div>'
    : `<div class="grid">${items}</div>`}
</section>
</body></html>`;
}

module.exports = { renderWorkHome };
