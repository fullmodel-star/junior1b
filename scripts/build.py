# -*- coding: utf-8 -*-
"""
國一下英語複習（康軒）內部版 建置腳本
來源：康軒《英語2 國中1下》學習自修（掃描教材，版權，僅內部自用）
輸出：本資料夾 index.html（自包含、密碼鎖 PBKDF2+AES-256-GCM、單字/片語/文法/句型/中翻英）
※ 本檔含版權教材，_source/ 內容不得進任何公開 repo。
"""
import json, os, re, subprocess, tempfile, random, hashlib

HERE = os.path.dirname(os.path.abspath(__file__))
PROJ = os.path.dirname(HERE)
SRC  = os.path.join(PROJ, '_source')

DEFAULT_PW = '1019'   # 使用者可自訂；沿用短 PIN 軟鎖（自用非販售）
random.seed(1019)     # 固定亂數，重建結果穩定

def L(fn):
    p = os.path.join(SRC, fn)
    return json.load(open(p, encoding='utf-8')) if os.path.exists(p) else None

# ---- 單字 / 片語（快充卡，已人工轉錄）----
vp = L('vocab_phrases.json') or {'vocab': {}, 'phrases': {}}
VOCAB   = vp.get('vocab', {})
PHRASES = vp.get('phrases', {})

# ---- 文法 / 句型 / 中翻英句子池（子代理抽取，每課一檔 lesson_N.json）----
GRAMMAR  = {}   # L1..L6 -> [{title,explain,examples}]
PATTERNS = {}   # L1..L6 -> [{pattern,zh,examples}]
SENT     = {}   # L1..L6 -> [{en,zh}]
for n in range(1, 7):
    d = L('lesson_%d.json' % n)
    key = 'L%d' % n
    if not d:
        GRAMMAR[key] = []; PATTERNS[key] = []; SENT[key] = []
        continue
    GRAMMAR[key]  = d.get('grammar', [])
    PATTERNS[key] = d.get('patterns', [])
    SENT[key]     = d.get('sentences', [])

# ---- 中翻英題庫 ----
MAX_TOK = 12          # 超過 12 個詞塊，國一拼句/打字都太吃力
TARGET_UNIT = 12      # 每個小單元目標句數（單元數依課文長度動態決定）

def norm_en(s):
    return re.sub(r'\s+', ' ', (s or '').strip())

def tokenize(en):
    """斷詞後去掉黏在詞尾/詞首的標點。
    否則拼句方塊會出現 `grass.`、`either.`、`me,` —— 帶句點的方塊等於直接告訴孩子
    那是句尾、帶逗號的告訴他那是子句邊界，形同洩題。
    （比對用 normEn() 本來就忽略標點，所以去掉不影響判分。）"""
    out = []
    for w in norm_en(en).split(' '):
        w = w.strip('.,!?;:"“”()')
        if w:
            out.append(w)
    return out

# 縮寫裡的句點不是句尾（Mr. / p.m. …），先保護起來再斷句
_ABBR = ['Mr.', 'Mrs.', 'Ms.', 'Dr.', 'St.', 'a.m.', 'p.m.', 'etc.', 'vs.']
_SENT = '\x00'

def split_en(s):
    t = s
    for a in _ABBR:
        t = t.replace(a, a.replace('.', _SENT))
    parts = re.findall(r'[^.!?]+[.!?]+', t.strip()) or [t.strip()]
    return [p.replace(_SENT, '.').strip() for p in parts]

def split_zh(s):
    return [x.strip() for x in re.findall(r'[^。！？]+[。！？]+', s.strip())] or [s.strip()]

def is_full_sentence(en, zh):
    """完整句才適合當中翻英題。
    擋掉兩類混進來的東西：
      1. 名詞片語（a cup of coffee／三匙糖）—— 那是量詞表，不是句子
      2. 動詞變化表（make → made, write → wrote）—— 中文還是「須逐字熟記。」這種說明句
    """
    if '→' in en or '→' in zh or '=' in en:
        return False
    return bool(re.search(r'[。！？]$', zh.strip())) and bool(re.search(r'[.!?]$', en.strip()))

def collect_sentences():
    items = []
    seen = set()
    stats = {'split': 0, 'dropped_frag': 0, 'dropped_long': 0, 'dropped_dup': 0}
    for n in range(1, 7):
        key = 'L%d' % n
        pool = list(SENT.get(key, []))
        for g in GRAMMAR.get(key, []):
            pool += g.get('examples', [])
        for p in PATTERNS.get(key, []):
            pool += p.get('examples', [])

        for s in pool:
            en = norm_en(s.get('en'))
            zh = (s.get('zh') or '').strip()
            if not en or not zh:
                continue
            # 對話式（A: … B: …）不適合當中翻英單題
            if re.match(r'^[AB]\s*:', en) or re.search(r'\s[AB]\s*:', en):
                continue
            if '___' in en or '＿' in en:
                continue
            if not is_full_sentence(en, zh):
                stats['dropped_frag'] += 1
                continue

            # 兩句黏在一起的（占原題庫近四成）拆成獨立單句；只有英中句數對得上才拆
            es, zs = split_en(en), split_zh(zh)
            pairs = list(zip(es, zs)) if len(es) == len(zs) and len(es) > 1 else [(en, zh)]
            if len(pairs) > 1:
                stats['split'] += 1

            for e, z in pairs:
                k = e.lower()
                if k in seen:
                    stats['dropped_dup'] += 1
                    continue
                toks = tokenize(e)
                if len(toks) < 2:
                    continue
                if len(toks) > MAX_TOK:
                    stats['dropped_long'] += 1
                    continue
                seen.add(k)
                items.append({'lesson': n, 'en': e, 'zh': z, 'tok': toks})
    return items, stats

TRANSLATE, CSTATS = collect_sentences()

# ---- 由短到長排序，讓孩子從短句熱身（App 端練單元時會照這個順序出題，不再打亂）----
TRANSLATE.sort(key=lambda t: (t['lesson'], len(t['tok']), t['en']))

# ---- 依課文長度動態切小單元（每單元約 TARGET_UNIT 句，不再固定 4 個而讓長課爆到 27 句）----
for n in range(1, 7):
    ls = [t for t in TRANSLATE if t['lesson'] == n]
    total = len(ls)
    if not total:
        continue
    nunits = max(1, round(total / TARGET_UNIT))
    base, rem = divmod(total, nunits)
    idx = 0
    for u in range(1, nunits + 1):
        size = base + (1 if u <= rem else 0)
        for t in ls[idx:idx + size]:
            t['u'] = u
        idx += size

# 排序完才編 id，讓 id 穩定對應題目
for i, t in enumerate(TRANSLATE):
    t['id'] = 'T%d-%03d' % (t['lesson'], i)

# 每課實際的單元數（長課多切幾個，不再固定 4 個）
LESSON_UNITS = {n: max([t['u'] for t in TRANSLATE if t['lesson'] == n] or [0])
                for n in range(1, 7)}

LESSON_TITLES = {
    1: 'Sports', 2: 'Habits', 3: 'Special Days',
    4: 'Food', 5: 'A Trip', 6: 'Nature',
}
LESSON_ZH = {
    1: '運動', 2: '生活習慣', 3: '特別的日子',
    4: '食物', 5: '一趟旅行', 6: '大自然',
}
lessons = [{'id': n, 'name': 'Lesson %d' % n, 'topic': LESSON_TITLES.get(n, ''),
            'zh': LESSON_ZH.get(n, ''), 'units': LESSON_UNITS[n]}
           for n in range(1, 7)]

DATA = {
    'ver': '3.0-internal',
    'lessonUnits': LESSON_UNITS,
    'book': '康軒 英語2 國中1下',
    'lessons': lessons,
    'vocab': VOCAB,
    'phrases': PHRASES,
    'grammar': GRAMMAR,
    'patterns': PATTERNS,
    'translate': TRANSLATE,
}

# ---- 統計 ----
nv = sum(len(v) for v in VOCAB.values())
npz = sum(len(v) for v in PHRASES.values())
ng = sum(len(v) for v in GRAMMAR.values())
npt = sum(len(v) for v in PATTERNS.values())
print('單字:', nv, ' 片語:', npz, ' 文法點:', ng, ' 句型:', npt, ' 中翻英:', len(TRANSLATE))
print('  收句：拆開雙句 %d 筆、剔除非完整句/動詞表 %d、剔除過長(>%d塊) %d、去重 %d'
      % (CSTATS['split'], CSTATS['dropped_frag'], MAX_TOK, CSTATS['dropped_long'], CSTATS['dropped_dup']))
for n in range(1, 7):
    sizes = [len([t for t in TRANSLATE if t['lesson'] == n and t['u'] == u])
             for u in range(1, LESSON_UNITS[n] + 1)]
    print('  Lesson %d 中翻英 %d 句 → %d 個小單元 %s' % (n, sum(sizes), LESSON_UNITS[n], sizes))

# 建置期健全性檢查：壞題目不准出貨
assert all(t.get('u') for t in TRANSLATE), '有中翻英句子沒分配到小單元'
assert all(len(t['tok']) <= MAX_TOK for t in TRANSLATE), '有句子超過 %d 個詞塊' % MAX_TOK
assert not [t for t in TRANSLATE if '→' in t['en']], '動詞變化表混進中翻英題庫'
# 只擋詞首/詞尾的標點（那才會洩題）；p.m 這種縮寫內部的句點要留著
_PUNCT = '.,!?;:"“”()'
assert not [t for t in TRANSLATE
            if any(w[0] in _PUNCT or w[-1] in _PUNCT for w in t['tok'])], \
    '拼句 token 首尾仍帶標點（會洩題：帶句點的方塊等於告訴孩子那是句尾）'
assert len(set(t['id'] for t in TRANSLATE)) == len(TRANSLATE), 'id 有重複'

# ---- 產 index.html（PBKDF2 -> AES-256-GCM，透過 node encrypt.js）----
tmp = os.path.join(tempfile.gettempdir(), '_kh1b_data_plain.json')
open(tmp, 'w', encoding='utf-8').write(json.dumps(DATA, ensure_ascii=False))
tpl_path = os.path.join(HERE, 'template.html')
out_path = os.path.join(PROJ, 'index.html')
try:
    r = subprocess.run(['node', os.path.join(HERE, 'encrypt.js'),
                        tmp, tpl_path, out_path, DEFAULT_PW],
                       capture_output=True, text=True, encoding='utf-8')
    print(r.stdout.strip() or r.stderr.strip())
finally:
    if os.path.exists(tmp):
        os.remove(tmp)

# ---- 戳 sw.js 版本 ----
# 這一步不能省：sw.js 是 cache-first，若位元組沒變，瀏覽器不會安裝新的 SW，
# 已把 App 加到桌面的孩子就永遠停在第一次快取的舊 index.html，任何內容修正都送不到。
# 版本取自「加密後 index.html 的雜湊」，只要產出物有變，快取名必然改變。
sw_path = os.path.join(PROJ, 'sw.js')
digest = hashlib.sha256(open(out_path, 'rb').read()).hexdigest()[:10]
sw = open(sw_path, encoding='utf-8').read()
new_sw, n_sub = re.subn(r"const CACHE = '[^']*'", "const CACHE = 'kh1b-%s'" % digest, sw, count=1)
if n_sub != 1:
    raise SystemExit('✗ 找不到 sw.js 的 CACHE 常數，更新機制會失效，請檢查 sw.js')
if new_sw != sw:
    open(sw_path, 'w', encoding='utf-8', newline='\n').write(new_sw)
    print('sw.js 快取版本 → kh1b-%s（有變更，已安裝的裝置會跳更新橫幅）' % digest)
else:
    print('sw.js 快取版本 → kh1b-%s（內容未變）' % digest)

print('已產出 index.html（密碼 %s，資料已加密）(%d KB)' % (
    DEFAULT_PW, os.path.getsize(out_path) // 1024))
