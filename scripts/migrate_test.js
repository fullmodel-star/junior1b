// 驗證 kh1b_v1 → kh1b_v2 舊進度遷移（錯題本與統計不能掉）
// 用法: node scripts/migrate_test.js
const path = require('path'), fs = require('fs');
module.paths.push(path.join(__dirname, '..', '..', '_tools', 'node_modules'));
const { JSDOM } = require('jsdom');
const { webcrypto } = require('crypto');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
let fails = 0;
const ok = (c, m) => { console.log((c ? '✓ ' : '✗ ') + m); if (!c) fails++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// 模擬舊版（v1）留下的存檔
const V1 = {
  wrong: {
    'T1-001': { cat: 'trans', lesson: 1, en: 'I get up at six.', zh: '我六點起床。', ok: 1, day: '2026-07-09' },
    'W:exercise': { cat: 'vocab', lesson: 1, en: 'exercise', zh: '運動', ok: 0, day: '' },
  },
  seen: { 'T1-001': 1, 'T1-002': 1 },
  stat: { ans: 42, ok: 30 },
  days: { '2026-07-09': 12 },
  streak: 3,
  lastDay: '2026-07-09',
};

(async () => {
  // 在 beforeParse 塞入 v1 存檔，再讓頁面腳本跑，模擬舊使用者第一次開新版
  const dom2 = new JSDOM(html, {
    runScripts: 'dangerously', url: 'https://example.com/', pretendToBeVisual: true,
    beforeParse(w) {
      Object.defineProperty(w, 'crypto', { value: webcrypto, configurable: true, writable: true });
      w.TextEncoder = TextEncoder; w.TextDecoder = TextDecoder;
      w.SpeechSynthesisUtterance = function () {};
      w.speechSynthesis = { cancel() {}, speak() {} };
      w.scrollTo = () => {};
      Object.defineProperty(w.navigator, 'serviceWorker', { value: { register: () => Promise.resolve() }, configurable: true });
      w.localStorage.setItem('kh1b_v1', JSON.stringify(V1));
    },
  });
  const w = dom2.window;
  await sleep(200);

  const S = w.S;
  ok(S._v === 2, '標記為 v2，不會重複遷移');
  ok(S.stat.ans === 42 && S.stat.ok === 30, '統計沿用（答題 42、答對 30）');
  ok(S.streak === 3 && S.lastDay === '2026-07-09', '連續天數與最後練習日沿用');
  ok(S.days['2026-07-09'] === 12, '每日紀錄沿用');
  ok(S.seen['T1-001'] && S.seen['T1-002'], '做過的句子沿用');

  ok(!!S.wrong['T1-001'], '舊錯題（中翻英）保留');
  ok(S.wrong['T1-001'].cat === 'trans', '中翻英錯題分類正確');
  ok(S.wrong['T1-001'].dirs.trans && S.wrong['T1-001'].dirs.trans.w, '中翻英錯題轉成方向 trans');
  ok(S.wrong['T1-001'].dirs.trans.streak === 1, '舊的「已連對 1 次」進度沒有歸零');

  ok(!!S.wrong['W:exercise'], '舊錯題（單字）保留');
  ok(S.wrong['W:exercise'].dirs.en2zh.w, '單字錯題轉成方向 en2zh');
  ok(S.wrong['W:exercise'].en === 'exercise' && S.wrong['W:exercise'].zh === '運動', '單字錯題內容完整');

  ok(!S.wrong['T1-001'].graduated, '遷移後不會誤判為已畢業');
  ok(typeof S.srs === 'object' && Object.keys(S.srs).length === 0, 'v1 沒有 SRS，v2 從空的開始');

  // 再開一次：不應重複遷移或覆蓋新進度
  const dom3 = new JSDOM(html, {
    runScripts: 'dangerously', url: 'https://example.com/', pretendToBeVisual: true,
    beforeParse(ww) {
      Object.defineProperty(ww, 'crypto', { value: webcrypto, configurable: true, writable: true });
      ww.TextEncoder = TextEncoder; ww.TextDecoder = TextDecoder;
      ww.SpeechSynthesisUtterance = function () {};
      ww.speechSynthesis = { cancel() {}, speak() {} };
      ww.scrollTo = () => {};
      Object.defineProperty(ww.navigator, 'serviceWorker', { value: { register: () => Promise.resolve() }, configurable: true });
      ww.localStorage.setItem('kh1b_v1', JSON.stringify(V1));
      // 模擬 v2 已存在、且使用者已把該題練畢業
      const v2 = { _v: 2, wrong: {}, srs: { 'W:exercise': { box: 5, due: 0, seen: 3, correct: 3, wrong: 0 } },
                   units: {}, read: {}, seen: {}, stat: { ans: 99, ok: 90 }, days: {}, streak: 7, lastDay: '2026-07-10' };
      ww.localStorage.setItem('kh1b_v2', JSON.stringify(v2));
    },
  });
  await sleep(200);
  const S3 = dom3.window.S;
  ok(Object.keys(S3.wrong).length === 0, '已是 v2 → 不再把舊錯題灌回來');
  ok(S3.stat.ans === 99, '已是 v2 → 不覆蓋現有統計');
  ok(S3.srs['W:exercise'].box === 5, '已是 v2 → 保留 SRS 精熟進度');

  console.log('\n' + (fails ? `✗ ${fails} 項失敗` : '✓ 遷移全部通過'));
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('測試崩潰:', e); process.exit(1); });
