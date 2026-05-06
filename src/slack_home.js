// 摸鱼模式首页：分类推荐
function escapeHtml(s){return String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function safeHost(u){try{return new URL(u).hostname}catch{return''}}

const SECTIONS = [
  { title: '🎬 视频', items: [
    ['YouTube', 'https://www.youtube.com'],
    ['Bilibili', 'https://www.bilibili.com'],
    ['Netflix', 'https://www.netflix.com'],
    ['爱奇艺', 'https://www.iqiyi.com'],
    ['优酷', 'https://www.youku.com'],
    ['芒果TV', 'https://www.mgtv.com'],
  ]},
  { title: '🎵 音乐', items: [
    ['网易云音乐', 'https://music.163.com'],
    ['QQ 音乐', 'https://y.qq.com'],
    ['Spotify', 'https://open.spotify.com'],
    ['SoundCloud', 'https://soundcloud.com'],
    ['Apple Music', 'https://music.apple.com'],
  ]},
  { title: '📰 新闻 / 资讯', items: [
    ['36 氪', 'https://36kr.com'],
    ['少数派', 'https://sspai.com'],
    ['知乎热榜', 'https://www.zhihu.com/billboard'],
    ['Hacker News', 'https://news.ycombinator.com'],
    ['The Verge', 'https://www.theverge.com'],
    ['虎扑', 'https://www.hupu.com'],
  ]},
  { title: '💰 炒币 / 行情', items: [
    ['Binance', 'https://www.binance.com'],
    ['OKX', 'https://www.okx.com'],
    ['CoinMarketCap', 'https://coinmarketcap.com'],
    ['CoinGecko', 'https://www.coingecko.com'],
    ['TradingView', 'https://www.tradingview.com'],
  ]},
  { title: '🎮 娱乐 / 论坛', items: [
    ['Reddit', 'https://www.reddit.com'],
    ['微博', 'https://weibo.com'],
    ['豆瓣', 'https://www.douban.com'],
    ['抖音', 'https://www.douyin.com'],
    ['小红书', 'https://www.xiaohongshu.com'],
    ['V2EX', 'https://www.v2ex.com'],
  ]},
];

function render(profile) {
  const themeColors = { red: '#FF3B30', green: '#34C759', yellow: '#FFCC00' };
  const c = themeColors[profile.theme] || '#FF3B30';
  const sections = SECTIONS.map(s => `
    <section>
      <h2>${escapeHtml(s.title)} <span class="cnt">${s.items.length}</span></h2>
      <div class="grid">
        ${s.items.map(([n, u]) => `
          <a href="${escapeHtml(u)}" title="${escapeHtml(u)}">
            <img src="https://www.google.com/s2/favicons?sz=32&domain=${encodeURIComponent(safeHost(u))}" onerror="this.style.display='none'">
            <span>${escapeHtml(n)}</span>
          </a>`).join('')}
      </div>
    </section>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(profile.name)}</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;background:#fafafa;color:#1d1d1f;padding:32px 40px;min-height:100vh}
header{display:flex;align-items:center;gap:12px;padding-bottom:20px;border-bottom:2px solid ${c};margin-bottom:24px}
header .emoji{font-size:32px}header h1{font-size:22px;font-weight:700}
header .note{font-size:12px;color:#86868b;margin-left:auto}
.search{margin:0 0 28px;display:flex;gap:8px}
.search input{flex:1;height:40px;padding:0 16px;font-size:14px;border:1px solid #d2d2d7;border-radius:8px;background:#fff;outline:none}
.search input:focus{border-color:${c};box-shadow:0 0 0 3px ${c}33}
.search button{height:40px;padding:0 18px;background:${c};color:#fff;border:none;border-radius:8px;font-weight:600;cursor:pointer}
section{margin-bottom:28px}
section h2{font-size:13px;text-transform:uppercase;color:#86868b;letter-spacing:0.5px;margin-bottom:12px;display:flex;align-items:center;gap:8px}
.cnt{font-size:10px;background:rgba(0,0,0,0.06);padding:2px 7px;border-radius:9px;color:#86868b}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:8px}
.grid a{display:flex;align-items:center;gap:10px;padding:10px 12px;background:#fff;border:1px solid #e5e5ea;border-radius:8px;text-decoration:none;color:#1d1d1f;font-size:13px;overflow:hidden}
.grid a:hover{border-color:${c};transform:translateY(-1px);transition:all 0.15s}
.grid a img{width:18px;height:18px;flex-shrink:0}
.grid a span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
</style></head><body>
<header><span class="emoji">${escapeHtml(profile.emoji||'🎮')}</span><h1>${escapeHtml(profile.name)}</h1><span class="note">${escapeHtml(profile.note||'')}</span></header>
<form class="search" onsubmit="location.href='https://www.google.com/search?q='+encodeURIComponent(this.q.value);return false">
  <input name="q" placeholder="Google 搜索..." autofocus>
  <button>搜索</button>
</form>
${sections}
</body></html>`;
}

module.exports = { render };
