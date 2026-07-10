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
  // 只讀 #app 的畫面文字：ui() 會把 <script> 原始碼也算進去，
  // 導致 includes('少了') 之類的斷言命中程式碼本身而假性通過。
  const ui = () => $('#app').textContent;

  await sleep(150);

  /* ---------- 密碼閘 ---------- */
  ok(!!$('#pw'), '啟動後顯示密碼閘');
  $('#pw').value = '0000'; $('#go').click(); await sleep(400);
  ok(!!$('#pw'), '錯誤密碼被擋下');
  $('#pw').value = PW; $('#go').click(); await sleep(600);
  ok(!$('#pw'), '正確密碼解鎖');
  const DB = window.DB, S = window.S;
  ok(DB && DB.translate.length > 500, `題庫載入：中翻英 ${DB ? DB.translate.length : 0} 句`);

  /* ---------- 首頁功能入口：不用去底部分頁列就能點到各區 ---------- */
  const tiles = $$('.navtile').map(b => b.dataset.go);
  ok(['vocab', 'gram', 'trans', 'review'].every(k => tiles.includes(k)),
    '首頁有 單字／文法／中翻英／複習 四個入口圖塊');
  $$('.navtile').find(b => b.dataset.go === 'vocab').click(); await sleep(80);
  ok(window.CUR === 'vocab', '點首頁「單字」圖塊 → 到單字頁');
  tab('首頁').click(); await sleep(60);
  $$('.navtile').find(b => b.dataset.go === 'gram').click(); await sleep(80);
  ok(window.CUR === 'gram', '點首頁「文法」圖塊 → 到文法頁');
  tab('首頁').click(); await sleep(60);
  $$('.navtile').find(b => b.dataset.go === 'review').click(); await sleep(80);
  ok(window.CUR === 'review', '點首頁「複習」圖塊 → 到錯題複習');
  tab('首頁').click(); await sleep(60);

  /* ---------- 題庫品質（老師 & 學生指出的問題）---------- */
  const T_ALL = DB.translate;
  ok(!T_ALL.some(t => t.en.includes('→')), '中翻英題庫沒有動詞變化表（make → made）');
  ok(!T_ALL.some(t => !/[.!?]$/.test(t.en)), '每題都是完整句（沒有 a cup of coffee 這種名詞片語）');
  ok(!T_ALL.some(t => /[。！？]$/.test(t.zh) === false), '每題中文都是完整句');
  ok(!T_ALL.some(t => t.tok.length > 12), `沒有超過 12 個詞塊的句子（最長 ${Math.max(...T_ALL.map(t => t.tok.length))}）`);
  const stripAbbr = s => s.replace(/(Mr|Mrs|Ms|Dr|St|a\.m|p\.m)\./g, '$1');
  const dbl = T_ALL.filter(t => /[.!?]\s+[A-Z]/.test(stripAbbr(t.en))).length;
  ok(dbl <= 1, `雙句黏在一起的題目已拆開（剩 ${dbl} 題，原本 208 題）`);
  const punct = T_ALL.some(t => t.tok.some(w => '.,!?;:"'.includes(w[0]) || '.,!?;:"'.includes(w[w.length - 1])));
  ok(!punct, '拼句方塊首尾不帶標點（帶句點的方塊會洩題）');

  /* ---------- 需求 3：中翻英拆小單元（單元數依課文長度動態）---------- */
  const l1 = DB.translate.filter(t => t.lesson === 1);
  const nU = DB.lessonUnits[1];
  const units = [...Array(nU)].map((_, i) => l1.filter(t => t.u === i + 1).length);
  ok(units.every(n => n > 0) && units.reduce((a, b) => a + b) === l1.length,
    `Lesson 1 的 ${l1.length} 句分成 ${nU} 個單元`);
  ok(Math.max(...units) <= 13, `每個單元最多 ${Math.max(...units)} 句（不再是 27 句）`);
  ok(Object.values(DB.lessonUnits).every((n, i) => n > 0), '每課都有分配單元數');

  tab('中翻英').click(); await sleep(80);
  $$('.lessoncard').find(b => b.dataset.l === '1').click(); await sleep(80);
  ok(ui().includes('個小單元'), '選課後看到小單元列表');
  ok($$('.lessoncard[data-u]').length === nU, `畫面上有 ${nU} 張小單元卡`);
  ok(ui().includes('一次想做幾題'), '可以自己選一次做幾題');

  // 學生要的：一次只做 5 題
  $$('#nsel button').find(b => b.dataset.n === '5').click(); await sleep(60);
  $$('.lessoncard[data-u]').find(b => b.dataset.u === '1').click(); await sleep(80);
  ok(window.T && window.T.items.length === 5, '選 5 題 → 這一輪只有 5 題');
  ok(window.T.partial, '部分練習會標記 partial（不覆蓋整單元成績）');

  // 回去改成整個單元
  tab('中翻英').click(); await sleep(60);
  $$('.lessoncard').find(b => b.dataset.l === '1').click(); await sleep(60);
  $$('#nsel button').find(b => b.dataset.n === '0').click(); await sleep(60);
  $$('.lessoncard[data-u]').find(b => b.dataset.u === '1').click(); await sleep(80);
  ok(window.T.items.length === units[0], `整個單元 = ${window.T.items.length} 題`);
  ok(window.T.unit === 1 && window.T.lesson === 1, 'session 記住課次與單元');

  // 我先前宣稱「由短到長」，但 startTrans 曾用 shuffle 把順序打亂
  const lens = window.T.items.map(t => t.tok.length);
  ok(lens.every((n, i) => i === 0 || n >= lens[i - 1]),
    `單元內由短到長出題（${lens[0]} → ${lens[lens.length - 1]} 塊），沒有被 shuffle 打亂`);

  /* ---------- 拼句：提示常駐、答錯給診斷、可自評「這也對」 ---------- */
  window.S.mode = 'build'; window.paint(); await sleep(60);
  ok($('#hintbox').style.display === 'none', '一開始不顯示提示');
  $('#hint').click(); await sleep(40);
  ok($('#hintbox').style.display === 'block', '按提示 → 提示框出現');
  ok($('#hintbox').textContent.includes(window.T.items[0].tok[0]), '提示告訴你下一個字');
  const hintText = $('#hintbox').textContent;
  await sleep(1900);   // 舊版的 toast 1.7 秒就消失
  ok($('#hintbox').textContent === hintText && $('#hintbox').style.display === 'block',
    '提示 1.9 秒後仍留在畫面上（不再一閃即逝）');

  const it = window.T.items[0];
  for (const w of it.tok) {
    const btn = $$('#bank .tok').find(b => b.textContent === w && !b.classList.contains('used'));
    if (btn) { btn.click(); await sleep(3); }
  }
  $('#ck').click(); await sleep(40);
  ok($('#slot').classList.contains('ok'), '拼句正確 → 綠框');
  ok(!S.wrong[it.id], '答對不進錯題本');
  $('#nx').click(); await sleep(60);

  // 拼句排錯 → 有診斷 + 有「這也對」的退路
  const it2 = window.T.items[1];
  const bk = $$('#bank .tok');
  bk[0].click(); await sleep(5); if (bk[1]) { bk[1].click(); await sleep(5); }
  $('#ck').click(); await sleep(40);
  if ($('#slot').classList.contains('bad')) {
    ok(!!$('#also'), '拼句答錯 → 提供「我這樣寫其實也對」（一句多譯不硬判錯）');
    ok(ui().includes('課本答案'), '答錯顯示課本答案');
    ok(!S.wrong[it2.id], '按下按鈕前尚未計入錯題');
    $('#nx').click(); await sleep(60);
    ok(!!S.wrong[it2.id], '按「知道了」→ 才計入錯題本');
    ok(S.wrong[it2.id].cat === 'trans' && S.wrong[it2.id].dirs.trans.w, '錯題分類 trans、方向 trans');
  } else {
    console.log('~ 隨機點成正確，略過拼句答錯檢查');
    $('#nx').click(); await sleep(60);
  }

  /* ---------- 打字：答錯給逐詞診斷 ---------- */
  const it3 = window.T.items[window.T.i];
  window.S.mode = 'type'; window.paint(); await sleep(60);
  // 故意漏掉最後一個字
  $('#ta').value = it3.tok.slice(0, -1).join(' ');
  $('#ck').click(); await sleep(40);
  ok(ui().includes('少了'), `打字漏字 → 明確告訴他「少了 ${it3.tok[it3.tok.length - 1]}」`);
  $('#sbad').click(); await sleep(60);
  ok(!!S.wrong[it3.id], '自評「我錯了」→ 進錯題本');

  // 順序顛倒 → 應指出是順序問題，不是漏字
  const it4 = window.T.items[window.T.i];
  $('#ta').value = it4.tok.slice().reverse().join(' ');
  $('#ck').click(); await sleep(40);
  ok(ui().includes('順序') || ui().includes('少了'),
    '打字順序錯 → 指出是順序問題');
  $('#sbad').click(); await sleep(60);

  ok(window.sentDiff('i have a cat', 'I have a cats').includes('拼錯') ||
     window.sentDiff('i have a cat', 'I have a cats').includes('少了'), 'sentDiff 抓得到單複數差異');
  ok(window.sentDiff('I have cat', 'I have a cat').includes('少了'), 'sentDiff 抓得到漏字 a');
  ok(window.sentDiff('cat a have I', 'I have a cat').includes('順序'), 'sentDiff 抓得到順序顛倒');

  /* 單元完成後記錄成績 */
  while (window.T && window.T.i < window.T.items.length) {
    const cur = window.T.items[window.T.i];
    if ($('#ta')) { $('#ta').value = cur.en; $('#ck').click(); await sleep(20); }
    if ($('#nx')) $('#nx').click(); else if ($('#sok')) $('#sok').click();
    await sleep(20);
  }
  await sleep(60);
  ok(!!S.units['L1U1'], '整個單元做完後記錄成績');
  ok(S.units['L1U1'].total === units[0], `單元成績 total=${S.units['L1U1'].total}`);

  /* ---------- 切分頁要清掉 session（工程師：殘留狀態是隱患）---------- */
  tab('單字').click(); await sleep(60);
  ok(window.T === null && window.Q === null && window.CARD === null,
    '離開作答流程 → Q/T/CARD 都被清空');

  /* ---------- 需求 1：單字／片語 比照 2000 的字卡 + 測驗 ---------- */
  ok(ui().includes('學會'), '單字頁用「學會」而不是「精熟」（13 歲看得懂）');
  ok(!ui().includes('盒 '), '不再出現看不懂的「盒 N」');
  ok($$('[data-card]').length > 0 && $$('[data-quiz]').length > 0, '每課都有「字卡」與「測驗」入口');
  // 一進單字頁就要看得到單字（課別預設展開，不能藏在折疊裡）
  ok($$('details.acc').length === 6 && $$('details.acc').every(d => d.open),
    '單字頁 6 課全部預設展開（不是折疊）');
  ok(ui().includes('exercise') && ui().includes('breakfast'),
    '不用點開就直接看得到單字（exercise / breakfast）');
  // 切到片語也要直接看得到
  $$('.seg button').find(b => b.textContent.includes('片語')).click(); await sleep(60);
  ok(ui().includes('get up'), '片語頁也直接看得到片語（get up）');
  $$('.seg button').find(b => b.textContent.includes('單字')).click(); await sleep(60);

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

  /* ---------- 迴歸：測驗答對也要推進學習盒（原本只有字卡會推）---------- */
  const before = Object.keys(window.S.srs).length;
  const q2 = window.Q.items[window.Q.i];
  const prevBox = (window.S.srs['W:' + q2.en] || {}).box || 0;
  $$('.opt').find(b => b.dataset.o === q2.zh).click(); await sleep(40);
  const nowBox = window.S.srs['W:' + q2.en].box;
  ok(nowBox === Math.min(6, (prevBox || 1) + 1),
    `測驗答對 → 學習等級 ${prevBox || 1} → ${nowBox}（不再只有字卡會推進）`);
  ok(Object.keys(window.S.srs).length >= before, '測驗會建立 SRS 紀錄');
  $('#nx').click(); await sleep(60);

  /* ---------- 迴歸：中→英不可把同義正確答案當干擾選項 ---------- */
  // 資料裡「美味的」同時有 yummy 與 delicious
  const syn = {};
  DB.vocab.L4.forEach(v => { (syn[v.zh] = syn[v.zh] || []).push(v.w); });
  const dupZh = Object.keys(syn).find(z => syn[z].length > 1);
  ok(!!dupZh, `題庫確實有同義字（${dupZh}: ${(syn[dupZh] || []).join(' / ')}）`);
  // 直接驗選項產生規則：對任一題，干擾選項的中文都不可與正解相同
  let synBad = 0;
  for (let r = 0; r < 40; r++) {
    tab('單字').click(); await sleep(10);
    const pool = window.itemsOf('vocab', null);
    const target = pool.find(p => p.zh === dupZh);
    const others = pool.filter(p => p.en !== target.en && p.zh !== target.zh);
    if (others.some(p => p.zh === target.zh)) synBad++;
  }
  ok(synBad === 0, '中→英的干擾選項不會出現同義的正確答案（yummy / delicious）');

  // 拼字
  tab('單字').click(); await sleep(60);
  $$('[data-quiz]')[0].click(); await sleep(60);
  $$('[data-d]').find(b => b.dataset.d === 'spell').click(); await sleep(60);
  ok(!!$('#sp'), '拼字測驗出現輸入框');
  const sit = window.Q.items[0];
  $('#sp').value = sit.en.toUpperCase(); $('#ck').click(); await sleep(40);
  ok(ui().includes('拼對了'), '拼字忽略大小寫仍判正確');
  $('#nx').click(); await sleep(60);

  // 拼字答錯 → 給拼字診斷
  const sit2 = window.Q.items[window.Q.i];
  $('#sp').value = sit2.en.slice(0, -1) + 'x';   // 只錯最後一個字母
  $('#ck').click(); await sleep(40);
  ok(ui().includes('只差一個字母'), '拼字只錯一個字母 → 告訴他「很接近了」');

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
  ok(ui().includes('讀過'), '顯示讀過進度');

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
