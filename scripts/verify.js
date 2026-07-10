// 驗證：從產出的 index.html 取出 window.ENC，用密碼解密，檢查資料結構完整
// 用法: node scripts/verify.js [password]
const fs = require('fs'), path = require('path'), crypto = require('crypto');

const pw = process.argv[2] || '1019';
const htmlPath = path.join(__dirname, '..', 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');

const m = html.match(/window\.ENC=(\{.*?\});/s);
if (!m) { console.error('✗ 找不到 window.ENC'); process.exit(1); }
const E = JSON.parse(m[1]);

// 明文不得外洩：加密後的 HTML 不應出現任何教材內容片段。
// 探針取自實際題庫（單字中文、英文例句），而非 App 介面文字。
const leakProbe = [];

const key = crypto.pbkdf2Sync(pw, Buffer.from(E.salt, 'base64'), E.iter, 32, 'sha256');
const ctTag = Buffer.from(E.ct, 'base64');
const ct = ctTag.subarray(0, ctTag.length - 16), tag = ctTag.subarray(ctTag.length - 16);
const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(E.iv, 'base64'));
d.setAuthTag(tag);

let DATA;
try {
  DATA = JSON.parse(Buffer.concat([d.update(ct), d.final()]).toString('utf8'));
} catch (e) {
  console.error('✗ 解密失敗（密碼錯誤或資料損毀）:', e.message);
  process.exit(1);
}

const nv = Object.values(DATA.vocab || {}).reduce((a, b) => a + b.length, 0);
const np = Object.values(DATA.phrases || {}).reduce((a, b) => a + b.length, 0);
const ng = Object.values(DATA.grammar || {}).reduce((a, b) => a + b.length, 0);
const nt = Object.values(DATA.patterns || {}).reduce((a, b) => a + b.length, 0);
const T = DATA.translate || [];

console.log('✓ 解密成功，密碼:', pw);
console.log('  單字', nv, '片語', np, '文法點', ng, '句型', nt, '中翻英', T.length);

// 逐課檢查
for (let n = 1; n <= 6; n++) {
  const c = T.filter(t => t.lesson === n).length;
  const g = (DATA.grammar['L' + n] || []).length;
  console.log(`  Lesson ${n}: 文法 ${g} / 中翻英 ${c}` + (c === 0 ? '   ⚠ 無句子' : ''));
}

// 小單元切分
const UPL = DATA.unitsPerLesson;
console.log('  每課小單元數:', UPL);
for (let n = 1; n <= 6; n++) {
  const ls = T.filter(t => t.lesson === n);
  if (!ls.length) continue;
  const sizes = [...Array(UPL)].map((_, i) => ls.filter(t => t.u === i + 1).length);
  const balanced = Math.max(...sizes) - Math.min(...sizes) <= 1;
  const covered = sizes.reduce((a, b) => a + b) === ls.length;
  console.log(`  Lesson ${n}: ${ls.length} 句 → [${sizes}]` +
    (balanced && covered ? '' : '  ⚠ 切分不均或有漏'));
}

// 中翻英題目健全性
const bad = [];
T.forEach(t => {
  if (!t.en || !t.zh) bad.push([t.id, '缺 en/zh']);
  else if (t.tok.join(' ') !== t.en) bad.push([t.id, 'tokens 無法還原原句']);
  else if (/^[AB]\s*:/.test(t.en)) bad.push([t.id, '對話句未濾除']);
  else if (t.en.includes('___')) bad.push([t.id, '仍有填空']);
  else if (!(t.u >= 1 && t.u <= UPL)) bad.push([t.id, '沒有分配到小單元']);
});
if (bad.length) {
  console.log('✗ 題目問題', bad.length, '筆，前 5 筆:');
  bad.slice(0, 5).forEach(b => console.log('   ', b[0], b[1]));
} else {
  console.log('✓ 全部', T.length, '句中翻英：en/zh 齊全、tokens 可還原原句、無對話句與填空');
}

// 錯密碼必須失敗
try {
  const k2 = crypto.pbkdf2Sync('9999', Buffer.from(E.salt, 'base64'), E.iter, 32, 'sha256');
  const d2 = crypto.createDecipheriv('aes-256-gcm', k2, Buffer.from(E.iv, 'base64'));
  d2.setAuthTag(tag);
  Buffer.concat([d2.update(ct), d2.final()]);
  console.log('✗ 嚴重：錯誤密碼竟然解得開！');
  process.exit(1);
} catch (e) {
  console.log('✓ 錯誤密碼無法解密（AES-GCM 驗證標籤生效）');
}

// 用「解密後真實存在的內容」當探針，回頭到 HTML 裡找，確保一個字都沒漏在外面
const probes = [];
Object.values(DATA.vocab).forEach(a => a.slice(0, 4).forEach(v => probes.push(v.zh)));
T.slice(0, 40).forEach(t => { probes.push(t.en); probes.push(t.zh); });
Object.values(DATA.grammar).forEach(a => a.forEach(g => probes.push(g.title)));

const leaked = probes.filter(p => p && p.length >= 3 && html.includes(p));
if (leaked.length) {
  console.log('✗ 嚴重：加密後 HTML 仍含教材明文', leaked.length, '筆，例如:', leaked.slice(0, 3));
  process.exit(1);
}
console.log('✓ 以', probes.length, '筆真實題庫內容回查，加密後 HTML 無任何教材明文');
