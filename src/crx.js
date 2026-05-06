// 从 Chrome Web Store URL/ID 下载 .crx → 剥离 CRX header → 解压
const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const { execFile } = require('child_process');

function extractIdFromUrl(s) {
  // 接受：完整 URL / detail URL / 32 字符 ID
  const m = String(s || '').match(/[a-p]{32}/);
  return m ? m[0] : null;
}

function buildCrxUrl(id) {
  const params = new URLSearchParams({
    response: 'redirect',
    os: 'mac', arch: 'x86-64', os_arch: 'x86-64', nacl_arch: 'x86-64',
    prod: 'chromiumcrx', prodchannel: 'unknown', prodversion: '130.0.0.0',
    acceptformat: 'crx2,crx3',
    x: `id=${id}&uc`,
  });
  return `https://clients2.google.com/service/update2/crx?${params.toString()}`;
}

function fetchFollowingRedirects(url, hops = 5) {
  return new Promise((resolve, reject) => {
    if (hops < 0) return reject(new Error('redirect loop'));
    https.get(url, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
        const next = res.headers.location;
        res.resume();
        if (!next) return reject(new Error('redirect without location'));
        return fetchFollowingRedirects(new URL(next, url).toString(), hops - 1).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

// CRX3 格式: "Cr24" + version(u32 LE) + header_size(u32 LE) + header + zip
// CRX2 格式: "Cr24" + version(u32 LE=2) + pubkey_len + sig_len + pubkey + sig + zip
function stripCrx(buf) {
  if (buf.slice(0, 4).toString() !== 'Cr24') {
    // 已经是 zip？
    if (buf.slice(0, 2).toString() === 'PK') return buf;
    throw new Error('不是合法 .crx');
  }
  const ver = buf.readUInt32LE(4);
  if (ver === 3) {
    const headerLen = buf.readUInt32LE(8);
    return buf.slice(12 + headerLen);
  }
  if (ver === 2) {
    const pubLen = buf.readUInt32LE(8);
    const sigLen = buf.readUInt32LE(12);
    return buf.slice(16 + pubLen + sigLen);
  }
  throw new Error(`不支持的 CRX 版本: ${ver}`);
}

function unzipTo(zipBuf, dst) {
  return new Promise((resolve, reject) => {
    const tmp = path.join(os.tmpdir(), `meowser_crx_${Date.now()}.zip`);
    fs.writeFileSync(tmp, zipBuf);
    fs.mkdirSync(dst, { recursive: true });
    execFile('unzip', ['-o', tmp, '-d', dst], (err, stdout, stderr) => {
      try { fs.unlinkSync(tmp); } catch {}
      if (err) return reject(new Error(stderr || err.message));
      resolve(dst);
    });
  });
}

async function installFromStore(urlOrId, targetDir) {
  const id = extractIdFromUrl(urlOrId);
  if (!id) throw new Error('提取不到扩展 ID（应是 32 字符的 a-p）');
  const crxUrl = buildCrxUrl(id);
  const buf = await fetchFollowingRedirects(crxUrl);
  const zipBuf = stripCrx(buf);
  // 名称用 manifest.json 里的 short_name；解压后再读一次重命名
  const tmpDst = path.join(targetDir, `_${id}`);
  await unzipTo(zipBuf, tmpDst);
  let finalName = id;
  try {
    const m = JSON.parse(fs.readFileSync(path.join(tmpDst, 'manifest.json'), 'utf8'));
    finalName = (m.short_name || m.name || id).replace(/[\/\\:*?"<>|]/g, '_').slice(0, 60);
  } catch {}
  const finalDst = path.join(targetDir, finalName);
  if (fs.existsSync(finalDst)) {
    fs.rmSync(finalDst, { recursive: true, force: true });
  }
  fs.renameSync(tmpDst, finalDst);
  return { id, dst: finalDst, name: finalName };
}

module.exports = { installFromStore, extractIdFromUrl };
