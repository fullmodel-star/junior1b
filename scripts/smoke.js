// UI 冒煙測試：真的把 App 跑起來、解鎖、作答，驗證引擎行為
// 用法: node scripts/smoke.js   （需 jsdom，取自 ../../_tools/node_modules）
const path = require('path'), fs = require('fs');
module.paths.push(path.join(__dirname, '..', '..', '_tools', 'node_modules'));
const { JSDOM } = require('jsdom');
const { webcrypto } = require('crypto');

const PW = '1019';
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

let fails = 0;
const ok = (c, msg) => { console.log((c ? '✓ ' : '✗ ') + msg); if (!c) fails++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'https://example.com/',
    pretendToBeVisual: true,
    beforeParse(w) {
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
  const tab = n => $$('#tabbar button').find(b => b.textContent.includes(n));

  await sleep(150);

  /* ---------- 密碼閘 ---------- */
  ok(!!$('#pw'), '啟動後顯示密碼閘');
  $('#pw').value = '0000'; $('#go').click(); await sleep(400);
  ok(!!$('#pw'), '錯誤密碼被擋下');
  $('#pw').value = PW; $('#go').click(); await sleep(600);
  ok(!$('#pw'), '正確密碼解鎖');
  const DB = window.DB, S = window.S;
  ok(DB && DB.translate.length > 500, `題庫載入：中翻英 ${DB ? DB.translate.length : 0} 句`);

  /* ---------- 需求 3：中翻英每課拆 4 個小單元 ---------- */
  ok(DB.unitsPerLesson === 4, '每課切成 4 個小單元');
  const l1 = DB.translate.filter(t => t.lesson === 1);
  const units = [1, 2, 3, 4].map(u => l1.filter(t => t.u === u).length);
  ok(units.every(n => n > 0) && units.reduce((a, b) => a + b) === l1.length,
    `Lesson 1 的 ${l1.length} 句分成 ${units.join('/')}`);
  ok(Math.max(...units) - Math.min(...units) <= 1, '各單元句數平均（相差不超過 1 句）');
  ok(DB.translate.every(t => t.u >= 1 && t.u <= 4), '每一句都有分配到小單元');

  tab('中翻英').click(); await sleep(80);
  $$('.lessoncard').find(b => b.dataset.l === '1').click(); await sleep(80);
  ok(doc.body.textContent.includes('個小單元'), '選課後看到小單元列表');
  ok($$('.lessoncard[data-u]').length === 4, '畫面上有 4 張小單元卡');
  $$('.lessoncard[data-u]').find(b => b.dataset.u === '1').click(); await sleep(80);
  ok(window.T && window.T.items.length === units[0], `進入單元 1，共 ${window.T.items.length} 題（非整課 ${l1.length} 題）`);
  ok(window.T.unit === 1 && window.T.lesson === 1, 'session 記住課次與單元');

  /* ---------- 需求 2：中翻英答錯 → 錯題本 ---------- */
  window.S.mode = 'build'; window.paint(); await sleep(60);
  const it = window.T.items[0];
  for (const w of it.tok) {
    const btn = $$('#bank .tok').find(b => b.textContent === w && !b.classList.contains('used'));
    if (btn) { btn.click(); await sleep(3); }
  }
  $('#ck').click(); await sleep(40);
  ok($('#slot').classList.contains('ok'), '拼句正確 → 綠框');
  ok(!S.wrong[it.id], '答對不進錯題本');
  $('#nx').click(); await sleep(60);

  const it2 = window.T.items[1];
  window.S.mode = 'type'; window.paint(); await sleep(60);
  $('#ta').value = 'totally wrong answer here'; $('#ck').click(); await sleep(40);
  $('#sbad').click(); await sleep(60);
  ok(!!S.wrong[it2.id], '中翻英答錯 → 進錯題本');
  ok(S.wrong[it2.id].cat === 'trans', '錯題分類 trans');
  ok(S.wrong[it2.id].dirs.trans && S.wrong[it2.id].dirs.trans.w, '記錄錯的方向為 trans');

  /* 單元完成後記錄成績 */
  while (window.T && window.T.i < window.T.items.length) {
    const cur = window.T.items[window.T.i];
    if ($('#ta')) { $('#ta').value = cur.en; $('#ck').click(); await sleep(20); }
    if ($('#nx')) $('#nx').click(); else if ($('#sok')) $('#sok').click();
    await sleep(20);
  }
  await sleep(60);
  ok(!!S.units['L1U1'], '單元做完後記錄成績');
  ok(S.units['L1U1'].total === units[0], `單元成績 total=${S.units['L1U1'].total}`);

  /* ---------- 需求 1：單字／片語 比照 2000 的字卡 + 測驗 ---------- */
  tab('單字').click(); await sleep(80);
  ok(doc.body.textContent.includes('精熟'), '單字頁顯示精熟進度');
  ok($$('[data-card]').length > 0 && $$('[data-quiz]').length > 0, '每課都有「字卡」與「測驗」入口');

  // 字卡：SRS 三段自評
  $$('[data-card]')[0].click(); await sleep(80);
  ok(!!$('#flip'), '進入字卡');
  ok(!$('.rate'), '未翻面時不出現自評鈕');
  $('#flip').click(); await sleep(60);
  ok(!!$('.rate'), '翻面後出現三段自評（不會／會了／很簡單）');
  const w1 = window.CARD.deck[0];
  $$('[data-k]').find(b => b.dataset.k === 'ok').click(); await sleep(60);
  let e = window.S.srs['W:' + w1.en];
  ok(e && e.box === 2, `自評「會了」→ SRS 進到盒 ${e ? e.box : '?'}`);
  ok(e.due > Date.now(), '設定了下次複習時間');

  const w2 = window.CARD.deck[window.CARD.i];
  $('#flip').click(); await sleep(60);
  $$('[data-k]').find(b => b.dataset.k === 'easy').click(); await sleep(60);
  ok(window.S.srs['W:' + w2.en].box === 3, '自評「很簡單」→ 一次跳兩盒');

  const w3 = window.CARD.deck[window.CARD.i];
  $('#flip').click(); await sleep(60);
  $$('[data-k]').find(b => b.dataset.k === 'no').click(); await sleep(60);
  ok(window.S.srs['W:' + w3.en].box === 1, '自評「不會」→ 打回盒 1');
  ok(!!S.wrong['W:' + w3.en], '字卡自評「不會」→ 收進錯題本');

  // 測驗：三種方向
  tab('單字').click(); await sleep(80);
  $$('[data-quiz]')[0].click(); await sleep(60);
  ok($$('[data-d]').length === 3, '單字測驗提供 英→中／中→英／拼字 三種');
  $$('[data-d]').find(b => b.dataset.d === 'en2zh').click(); await sleep(60);
  ok(window.Q && window.Q.dir === 'en2zh', '開始英→中測驗');
  ok($$('.opt').length === 4, '四選一');
  const qit = window.Q.items[0];
  $$('.opt').find(b => b.dataset.o !== qit.zh).click(); await sleep(40);
  ok(!!S.wrong[qit.id], '單字測驗答錯 → 進錯題本');
  ok(S.wrong[qit.id].dirs.en2zh.w, '錯題記錄方向 en2zh');
  $('#nx').click(); await sleep(60);

  // 拼字
  tab('單字').click(); await sleep(60);
  $$('[data-quiz]')[0].click(); await sleep(60);
  $$('[data-d]').find(b => b.dataset.d === 'spell').click(); await sleep(60);
  ok(!!$('#sp'), '拼字測驗出現輸入框');
  const sit = window.Q.items[0];
  $('#sp').value = sit.en.toUpperCase(); $('#ck').click(); await sleep(40);
  ok(doc.body.textContent.includes('拼對了'), '拼字忽略大小寫仍判正確');

  /* ---------- 片語沒有拼字 ---------- */
  tab('單字').click(); await sleep(60);
  $$('.seg button').find(b => b.textContent.includes('片語')).click(); await sleep(60);
  $$('[data-quiz]')[0].click(); await sleep(60);
  ok($$('[data-d]').length === 2, '片語只提供 英→中／中→英（不做拼字）');

  /* ---------- 錯題畢業：每個錯過的方向都要連對 2 次 ---------- */
  const wid = 'W:' + w3.en;
  const meta = { cat: 'vocab', lesson: S.wrong[wid].lesson, en: w3.en, zh: w3.zh };
  window.addWrong(wid, meta, 'zh2en');           // 再錯一個方向
  ok(S.wrong[wid].dirs.en2zh.w && S.wrong[wid].dirs.zh2en.w, '同一字錯了兩個方向');
  window.markCorrect(wid, 'en2zh'); window.markCorrect(wid, 'en2zh');
  ok(!S.wrong[wid].graduated, '只有一個方向連對 2 次 → 還不能畢業');
  window.markCorrect(wid, 'zh2en');
  ok(!S.wrong[wid].graduated, '另一方向才對 1 次 → 仍不畢業');
  window.markCorrect(wid, 'zh2en');
  ok(S.wrong[wid].graduated, '兩個錯過的方向都連對 2 次 → 畢業');
  ok(!window.wrongActive().includes(wid), '畢業後移出待複習清單');

  /* ---------- 需求 2：複習頁三類都能練 ---------- */
  window.addWrong('P:get up', { cat: 'phrase', lesson: 1, en: 'get up', zh: '起床' }, 'en2zh');
  tab('複習').click(); await sleep(80);
  const cats = $$('[data-go]').map(b => b.dataset.go);
  ok(cats.includes('vocab'), '複習頁有「單字」可練');
  ok(cats.includes('phrase'), '複習頁有「片語」可練');
  ok(cats.includes('trans'), '複習頁有「中翻英」可練');

  $$('[data-go]').find(b => b.dataset.go === 'trans').click(); await sleep(80);
  ok(window.T && window.T.review, '中翻英複習：只出錯題本裡的句子');
  ok(window.T.items.every(x => !!S.wrong[x.id]), '複習題目全部來自錯題本');

  tab('複習').click(); await sleep(80);
  $$('[data-go]').find(b => b.dataset.go === 'phrase').click(); await sleep(80);
  ok(window.Q && window.Q.review && window.Q.cat === 'phrase', '片語複習：以測驗形式出錯題');

  /* ---------- 需求 4：文法收放 + 讀過打勾 ---------- */
  tab('文法').click(); await sleep(80);
  ok($$('details.acc').length > 0, '文法每課用收放（accordion）呈現');
  ok($$('details.item').length > 0, '每個文法重點各自可收放');
  ok(doc.body.textContent.includes('讀過'), '顯示讀過進度');

  const total1 = DB.grammar.L1.length;
  const btns = $$('[data-read]').filter(b => b.dataset.read.startsWith('g:L1:'));
  ok(btns.length === total1, `Lesson 1 有 ${total1} 個文法重點，各有一個「我讀懂了」`);
  ok(!window.S.read['g:L1:0'], '初始未讀');
  btns[0].click(); await sleep(40);
  ok(!!window.S.read['g:L1:0'], '點「我讀懂了」→ 記錄已讀');
  ok(btns[0].classList.contains('on'), '按鈕變成已讀狀態');
  ok(doc.querySelector('[data-cnt="1"]').textContent === '1/' + total1, '該課計數即時更新為 1/' + total1);
  btns[0].click(); await sleep(40);
  ok(!window.S.read['g:L1:0'], '再點一次 → 取消已讀（可反悔）');

  for (const b of btns) { b.click(); await sleep(10); }
  ok(doc.querySelector('[data-cnt="1"]').textContent === total1 + '/' + total1, '全部讀完 → 計數 ' + total1 + '/' + total1);
  ok(doc.querySelector('[data-cnt="1"]').classList.contains('g'), '全讀完該課標記為完成');

  // 進度會存檔
  ok(JSON.parse(window.localStorage.getItem('kh1b_v2')).read['g:L1:1'], '已讀進度寫入 localStorage');

  /* ---------- 忍者 XP ---------- */
  const wallet = JSON.parse(window.localStorage.getItem('ninja_xp_v1') || '{}');
  ok(wallet.xp > 0 && wallet.bySrc.junior1b > 0, `忍者 XP 累積 ${wallet.xp} 點，來源 junior1b`);

  /* ---------- 比對規則 ---------- */
  ok(window.normEn('I am Happy!') === window.normEn('i am happy'), '比對忽略大小寫與標點');
  ok(window.normEn("It's fine") === window.normEn('Its fine'), '比對忽略撇號');

  console.log('\n' + (fails ? `✗ ${fails} 項失敗` : '✓ 全部通過'));
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('測試崩潰:', e); process.exit(1); });
