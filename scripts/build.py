# -*- coding: utf-8 -*-
"""
國一下英語複習（康軒）內部版 建置腳本
來源：康軒《英語2 國中1下》學習自修（掃描教材，版權，僅內部自用）
輸出：本資料夾 index.html（自包含、密碼鎖 PBKDF2+AES-256-GCM、單字/片語/文法/句型/中翻英）
※ 本檔含版權教材，_source/ 內容不得進任何公開 repo。
"""
import json, os, re, subprocess, tempfile, random

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

# ---- 中翻英題庫：從句子池 + 文法/句型例句彙整，去重、加拼句 tokens ----
def norm_en(s):
    return re.sub(r'\s+', ' ', (s or '').strip())

def tokenize(en):
    # 以空白斷詞；標點多半黏在詞尾（如 today.），拼句時整塊移動即可
    return [t for t in norm_en(en).split(' ') if t]

def collect_sentences():
    items = []
    seen = set()
    for n in range(1, 7):
        key = 'L%d' % n
        pool = list(SENT.get(key, []))
        # 併入文法/句型例句
        for g in GRAMMAR.get(key, []):
            pool += g.get('examples', [])
        for p in PATTERNS.get(key, []):
            pool += p.get('examples', [])
        for s in pool:
            en = norm_en(s.get('en'))
            zh = (s.get('zh') or '').strip()
            if not en or not zh:
                continue
            # 對話式（A: … B: …）不適合當中翻英單題，略過
            if re.match(r'^[AB]\s*:', en) or re.search(r'\s[AB]\s*:', en):
                continue
            # 仍留有填空底線的句子略過
            if '___' in en or '＿' in en:
                continue
            k = en.lower()
            if k in seen:
                continue
            # 過濾太長/太短：國一適中（2~16 詞）
            toks = tokenize(en)
            if len(toks) < 2 or len(toks) > 16:
                continue
            seen.add(k)
            items.append({
                'id': 'T%d-%03d' % (n, len(items)),
                'lesson': n,
                'en': en,
                'zh': zh,
                'tok': toks,
            })
    return items

TRANSLATE = collect_sentences()

# ---- 每課的中翻英再切成 4 個小單元（一次 87 句太多，拆成約 20~27 句一單元）----
UNITS_PER_LESSON = 4
for n in range(1, 7):
    ls = [t for t in TRANSLATE if t['lesson'] == n]
    total = len(ls)
    if not total:
        continue
    # 近似等分：前面幾個單元各多一句，餘數分光
    base, rem = divmod(total, UNITS_PER_LESSON)
    idx = 0
    for u in range(1, UNITS_PER_LESSON + 1):
        size = base + (1 if u <= rem else 0)
        for t in ls[idx:idx + size]:
            t['u'] = u
        idx += size

# 短句在前、長句在後，讓每個單元由易漸難
TRANSLATE.sort(key=lambda t: (t['lesson'], t['u'], len(t['tok'])))

LESSON_TITLES = {
    1: 'Sports', 2: 'Habits', 3: 'Special Days',
    4: 'Food', 5: 'A Trip', 6: 'Nature',
}
lessons = [{'id': n, 'name': 'Lesson %d' % n, 'topic': LESSON_TITLES.get(n, '')}
           for n in range(1, 7)]

DATA = {
    'ver': '2.0-internal',
    'unitsPerLesson': UNITS_PER_LESSON,
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
for n in range(1, 7):
    sizes = [len([t for t in TRANSLATE if t['lesson'] == n and t['u'] == u])
             for u in range(1, UNITS_PER_LESSON + 1)]
    print('  Lesson %d 中翻英 %d 句 → 小單元 %s' % (n, sum(sizes), sizes))
assert all(t.get('u') for t in TRANSLATE), '有中翻英句子沒分配到小單元'

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
print('已產出 index.html（密碼 %s，資料已加密）(%d KB)' % (
    DEFAULT_PW, os.path.getsize(out_path) // 1024))
