// UI 冒煙測試：真的把 App 跑起來、解鎖、作答，驗證引擎行為
// 用法: node scripts/smoke.js   （需 jsdom，取自 ../../_tools/node_modules）
const path = require('path'), fs = require('fs');
module.paths.push(path.join(__dirname, '..', '..', '_tools', 'node_modules'));
const { JSDOM } = require('jsdom');
const { webcrypto } = require('crypto');

const PW = '1019';
const htmlPath = path.join(__dirname, '..', 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');

let fails = 0;
const ok = (c, msg) => { console.log((c ? '✓ ' : '✗ ') + msg); if (!c) fails++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'https://example.com/',
    pretendToBeVisual: true,
    beforeParse(w) {
      // jsdom 的 window.crypto 是唯讀 getter 且無 subtle，必須 defineProperty 覆蓋
      Object.defineProperty(w, 'crypto', { value: webcrypto, configurable: true, writable: true });
      w.TextEncoder = TextEncoder;
      w.TextDecoder = TextDecoder;
      w.SpeechSynthesisUtterance = function () {};
      w.speechSynthesis = { cancel() {}, speak() {} };
      w.scrollTo = () => {};
      Object.defineProperty(w.navigator, 'serviceWorker', {
        value: { register: () => Promise.resolve() }, configurable: true,
      });
    },
  });
  const { window } = dom;
  const doc = window.document;
  const $ = s => doc.querySelector(s);
  const $$ = s => Array.from(doc.querySelectorAll(s));

  await sleep(150);

  // 1. 密碼閘
  ok(!!$('#pw'), '啟動後顯示密碼閘');
  ok($('#tabbar').style.display === 'none', '未解鎖時不顯示分頁列');

  // 2. 錯密碼被擋
  $('#pw').value = '0000';
  $('#go').click();
  await sleep(400);
  ok(!!$('#pw'), '錯誤密碼仍停在密碼閘');

  // 3. 正確密碼解鎖
  $('#pw').value = PW;
  $('#go').click();
  await sleep(600);
  ok(!$('#pw'), '正確密碼解鎖成功');
  ok($('#tabbar').style.display === 'flex', '解鎖後顯示分頁列');
  ok(doc.body.textContent.includes('今日已練'), '首頁顯示儀表板');

  const DB = window.DB;
  ok(DB && DB.translate.length > 500, `中翻英題庫載入 ${DB ? DB.translate.length : 0} 句`);

  // 4. 分頁切換
  const tab = n => $$('#tabbar button').find(b => b.textContent.includes(n));
  tab('單字').click(); await sleep(60);
  ok(doc.body.textContent.includes('Lesson 1'), '單字頁列出課次');
  tab('文法').click(); await sleep(60);
  ok(doc.body.textContent.includes('文法焦點'), '文法頁顯示文法焦點');
  $$('.seg button').find(b => b.textContent.includes('課文句型')).click(); await sleep(60);
  ok(doc.body.textContent.includes('練中翻英'), '句型分頁可切換');

  // 5. 中翻英：拼句模式，正確作答
  window.S.mode = 'build';
  tab('中翻英').click(); await sleep(80);
  ok(doc.body.textContent.includes('選一課開始'), '中翻英首頁');
  $$('[data-n]').find(b => b.dataset.n === '10').click(); await sleep(80);

  const T = window.T;
  ok(T && T.items.length === 10, '隨機 10 題已開始');
  const it = T.items[0];
  ok($$('#bank .tok').length >= it.tok.length, `拼句字庫含 ${$$('#bank .tok').length} 塊（正解 ${it.tok.length} 詞）`);

  // 依正解順序點字塊
  for (const w of it.tok) {
    const btn = $$('#bank .tok').find(b => b.textContent === w && !b.classList.contains('used'));
    if (!btn) { ok(false, `字庫找不到「${w}」`); break; }
    btn.click(); await sleep(5);
  }
  const before = window.S.stat.ans;
  $('#ck').click(); await sleep(40);
  ok($('#slot').classList.contains('ok'), '拼句正確 → 綠框');
  ok(doc.body.textContent.includes('完全正確'), '拼句正確 → 顯示正確回饋');
  ok(window.S.stat.ans === before + 1, '作答計入統計');
  ok(window.T.right === 1, '答對數 +1');
  ok(!window.S.wrong[it.id], '答對不進錯題本');

  $('#nx').click(); await sleep(60);
  ok(window.T.i === 1, '進入下一題');

  // 6. 拼句答錯 → 進錯題本
  const it2 = window.T.items[1];
  const banks = $$('#bank .tok');
  banks[0].click(); await sleep(5);
  if (banks[1]) { banks[1].click(); await sleep(5); }
  $('#ck').click(); await sleep(40);
  const gotWrong = !!window.S.wrong[it2.id];
  // 若隨機點到剛好正確就跳過此檢查
  if ($('#slot').classList.contains('bad')) {
    ok(gotWrong, '拼句答錯 → 進錯題本');
    ok(window.S.wrong[it2.id].cat === 'trans', '錯題分類為 trans');
    ok(doc.body.textContent.includes(it2.en), '答錯顯示正解');
  } else {
    console.log('~ 第 2 題隨機點成正確，略過答錯檢查');
  }
  $('#nx').click(); await sleep(60);

  // 7. 打字模式：正確輸入
  window.S.mode = 'type';
  window.paint(); await sleep(60);
  ok(!!$('#ta'), '打字模式出現輸入框');
  const it3 = window.T.items[window.T.i];
  $('#ta').value = it3.en.toUpperCase();   // 大小寫不同也該算對
  $('#ck').click(); await sleep(40);
  ok(doc.body.textContent.includes('完全正確'), '打字：忽略大小寫仍判正確');
  $('#nx').click(); await sleep(60);

  // 8. 打字模式：不同答案 → 自評選項
  const it4 = window.T.items[window.T.i];
  $('#ta').value = 'this is definitely not the answer';
  $('#ck').click(); await sleep(40);
  ok(doc.body.textContent.includes('參考答案'), '打字比對不過 → 顯示參考答案');
  ok(!!$('#sok') && !!$('#sbad'), '提供自評按鈕（我對了／差一點／我錯了）');
  ok(doc.body.textContent.includes(it4.en), '參考答案就是課本原句');
  $('#sbad').click(); await sleep(60);
  ok(!!window.S.wrong[it4.id], '自評「我錯了」→ 進錯題本');

  // 9. 錯題本：連對 2 次才畢業（同日只算 1 次）
  const wid = Object.keys(window.S.wrong)[0];
  const w0 = window.S.wrong[wid];
  window.markResult('trans', wid, true, { lesson: w0.lesson });
  ok(window.S.wrong[wid] && window.S.wrong[wid].ok === 1, '答對 1 次：仍留在錯題本');
  window.markResult('trans', wid, true, { lesson: w0.lesson });
  ok(window.S.wrong[wid] && window.S.wrong[wid].ok === 1, '同一天再答對：不重複累計（強制跨日）');
  window.S.wrong[wid].day = '2000-01-01';           // 模擬隔天
  window.markResult('trans', wid, true, { lesson: w0.lesson });
  ok(!window.S.wrong[wid], '跨日連對第 2 次 → 畢業，移出錯題本');

  // 10. 複習頁
  tab('複習').click(); await sleep(60);
  const hasWrong = Object.keys(window.S.wrong).length > 0;
  ok(doc.body.textContent.includes(hasWrong ? '待複習' : '沒有待複習'), '複習頁正常呈現');

  // 10b. 忍者 XP：答對灌進跨 App 共用錢包 ninja_xp_v1
  const wallet = JSON.parse(window.localStorage.getItem('ninja_xp_v1') || '{}');
  ok(wallet.xp > 0, `忍者 XP 已累積 ${wallet.xp || 0} 點`);
  ok(wallet.bySrc && wallet.bySrc.junior1b > 0, 'XP 來源標記為 junior1b');
  ok(wallet.correct > 0, `錢包記錄答對 ${wallet.correct || 0} 題`);

  // 11. 正規化比對規則
  ok(window.normEn('I am Happy!') === window.normEn('i am happy'), '比對忽略大小寫與標點');
  ok(window.normEn('I  am   happy') === window.normEn('I am happy'), '比對忽略多餘空白');
  ok(window.normEn("It's fine") === window.normEn('Its fine'), '比對忽略撇號');

  console.log('\n' + (fails ? `✗ ${fails} 項失敗` : '✓ 全部通過'));
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('測試崩潰:', e); process.exit(1); });
