#!/usr/bin/env python3
"""market.json 검사기. 게임이 깨지지 않도록 올리기 전에 꼭 돌려요.
사용법: python3 tools/validate.py [market.json 경로]
오류가 있으면 종료 코드 1, 경고만 있으면 0."""
import json, re, sys, datetime, os

PATH = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'market.json')
errors, warns = [], []
def err(p, m): errors.append(f'{p}: {m}')
def warn(p, m): warns.append(f'{p}: {m}')
DATE = re.compile(r'^\d{4}-\d{2}-\d{2}$')
URL = re.compile(r'^https?://[^\s<>"]+$')
TAG = re.compile(r'<\s*[a-zA-Z/!]')

def is_num(x): return isinstance(x, (int, float)) and not isinstance(x, bool)
def s(o, k, p, req=True, maxlen=None):
    v = o.get(k) if isinstance(o, dict) else None
    if v is None:
        if req: err(f'{p}.{k}', '없어요')
        return None
    if not isinstance(v, str): err(f'{p}.{k}', '문자열이어야 해요'); return None
    if req and not v.strip(): err(f'{p}.{k}', '비어 있어요')
    if TAG.search(v): err(f'{p}.{k}', 'HTML 태그는 쓰지 않아요')
    if maxlen and len(v) > maxlen: warn(f'{p}.{k}', f'{len(v)}자, {maxlen}자 이하 권장')
    return v
def n(o, k, p, req=True):
    v = o.get(k) if isinstance(o, dict) else None
    if v is None:
        if req: err(f'{p}.{k}', '없어요')
        return None
    if not is_num(v): err(f'{p}.{k}', '숫자여야 해요'); return None
    return v
def lst(o, k, p, req=True, mn=0):
    v = o.get(k) if isinstance(o, dict) else None
    if v is None:
        if req: err(f'{p}.{k}', '없어요')
        return []
    if not isinstance(v, list): err(f'{p}.{k}', '목록이어야 해요'); return []
    if len(v) < mn: err(f'{p}.{k}', f'{mn}개 이상 필요해요 (지금 {len(v)}개)')
    return v
def sources(o, k, p, req=True):
    for i, x in enumerate(lst(o, k, p, req)):
        q = f'{p}.{k}[{i}]'
        if not (isinstance(x, list) and len(x) == 2 and all(isinstance(y, str) for y in x)): err(q, '[제목, 주소] 형식이어야 해요'); continue
        if not URL.match(x[1]): err(q, f'주소가 이상해요: {x[1]}')
def strlist(o, k, p, req=True, mn=0, maxlen=None):
    for i, x in enumerate(lst(o, k, p, req, mn)):
        if not isinstance(x, str) or not x.strip(): err(f'{p}.{k}[{i}]', '비어 있지 않은 문자열이어야 해요')
        elif TAG.search(x): err(f'{p}.{k}[{i}]', 'HTML 태그는 쓰지 않아요')
        elif maxlen and len(x) > maxlen: warn(f'{p}.{k}[{i}]', f'{len(x)}자, {maxlen}자 이하 권장')

try:
    raw = open(PATH, encoding='utf-8').read()
    d = json.loads(raw)
except Exception as e:
    print('❌ JSON을 읽을 수 없어요:', e); sys.exit(1)
if len(raw.encode('utf-8')) > 150_000: err('파일', f'{len(raw.encode())} bytes, 150KB 이하로 줄여 주세요')

if d.get('v') != 1: err('v', '1이어야 해요')
up = s(d, 'updated', 'top')
if up:
    try:
        t = datetime.datetime.fromisoformat(up)
        if t.tzinfo is None: err('top.updated', '시간대(+09:00)가 있어야 해요')
    except ValueError: err('top.updated', 'ISO 8601 형식이 아니에요 (예: 2026-11-25T08:05:00+09:00)')
r = d.get('remote', '')
if not isinstance(r, str) or (r and not r.startswith('https://')): err('top.remote', 'https 주소이거나 빈 문자열이어야 해요')
a = d.get('asof') or {}
for k in ('kr', 'us'):
    if not DATE.match(str(a.get(k, ''))): err(f'asof.{k}', 'YYYY-MM-DD 형식이어야 해요')
s(d, 'asofLabel', 'top'); s(d, 'headline', 'top', maxlen=70); s(d, 'disclaimer', 'top')

for i, t in enumerate(lst(d, 'ticker', 'top', mn=3)):
    p = f'ticker[{i}]'
    s(t, 'id', p); s(t, 'name', p); n(t, 'value', p); n(t, 'chg', p)
    if not t.get('bp'): n(t, 'pct', p)
    if 'series' in t:
        for j, x in enumerate(t['series']):
            if not (isinstance(x, list) and len(x) == 2 and DATE.match(str(x[0])) and is_num(x[1])): err(f'{p}.series[{j}]', '["YYYY-MM-DD", 숫자] 형식이어야 해요')

ms = d.get('markets') or {}
for mk in ('kospi', 'kosdaq', 'nasdaq'):
    m = ms.get(mk)
    p = f'markets.{mk}'
    if not isinstance(m, dict): err(p, '없어요'); continue
    s(m, 'name', p); s(m, 'session', p)
    if m.get('cur') not in ('원', '$'): err(f'{p}.cur', "'원' 또는 '$'")
    val = n(m, 'value', p); n(m, 'chg', p); pc = n(m, 'pct', p)
    ser = lst(m, 'series', p, mn=5); dates = []
    for j, x in enumerate(ser):
        if not (isinstance(x, list) and len(x) == 2 and DATE.match(str(x[0])) and is_num(x[1])): err(f'{p}.series[{j}]', '["YYYY-MM-DD", 숫자] 형식이어야 해요'); continue
        dates.append(x[0])
    if dates != sorted(dates) or len(set(dates)) != len(dates): err(f'{p}.series', '날짜가 오름차순이고 겹치지 않아야 해요')
    if ser and val and is_num(ser[-1][1]) and abs(ser[-1][1] - val) / val > 0.005: warn(f'{p}.series', f'마지막 값 {ser[-1][1]} ≠ value {val}')
    for j, x in enumerate(lst(m, 'notes', p, req=False)):
        if not isinstance(x, dict) or x.get('d') not in dates: err(f'{p}.notes[{j}]', 'd는 series에 있는 날짜여야 해요')
        else: s(x, 't', f'{p}.notes[{j}]', maxlen=14)
    s(m, 'summary', p, maxlen=200); strlist(m, 'chips', p, req=False, maxlen=16); s(m, 'listNote', p, req=False)
    for side in ('up', 'down'):
        items = lst(m, side, p)
        for j, it in enumerate(items):
            q = f'{p}.{side}[{j}]'
            s(it, 'name', q); v = n(it, 'pct', q)
            if v is not None and ((side == 'up' and v <= 0) or (side == 'down' and v >= 0)): err(f'{q}.pct', f'{side} 목록인데 부호가 반대예요 ({v})')
            w = lst(it, 'why', q)
            if len(w) != 3: err(f'{q}.why', f'정확히 3줄이어야 해요 (지금 {len(w)}줄)')
            strlist(it, 'why', q, maxlen=80)
            if 'price' in it: n(it, 'price', q)
            for k in ('code', 'tag'):
                if k in it: s(it, k, q)
        if side == 'up':
            pcts = [it.get('pct') for it in items if is_num(it.get('pct'))]
            if pcts != sorted(pcts, reverse=True): warn(f'{p}.up', '등락률 큰 순서로 정렬하면 좋아요')
        else:
            pcts = [it.get('pct') for it in items if is_num(it.get('pct'))]
            if pcts != sorted(pcts): warn(f'{p}.down', '많이 내린 순서로 정렬하면 좋아요')
    if not m.get('down') and not (m.get('downNote') or '').strip(): err(f'{p}.downNote', 'down 목록이 비면 이유를 적어야 해요')
    for j, it in enumerate(lst(m, 'big', p, req=False)):
        s(it, 'name', f'{p}.big[{j}]'); n(it, 'pct', f'{p}.big[{j}]')
    sources(m, 'sources', p)

mk = d.get('mustKnow') or {}
s(mk, 'oneLine', 'mustKnow', maxlen=80)
for i, c in enumerate(lst(mk, 'cards', 'mustKnow', mn=3)):
    q = f'mustKnow.cards[{i}]'
    s(c, 'icon', q); s(c, 'tag', q, maxlen=8); s(c, 'title', q, maxlen=30); strlist(c, 'facts', q, mn=1, maxlen=120); s(c, 'mine', q, maxlen=120)
for i, c in enumerate(lst(mk, 'calendar', 'mustKnow')):
    q = f'mustKnow.calendar[{i}]'
    s(c, 'd', q); s(c, 't', q); s(c, 'note', q, req=False)
    if c.get('imp') not in (1, 2, 3): err(f'{q}.imp', '1, 2, 3 중 하나')
sources(mk, 'sources', 'mustKnow')

br = d.get('brokers') or {}
for side in ('kr', 'us'):
    b = br.get(side); p = f'brokers.{side}'
    if not isinstance(b, dict): err(p, '없어요'); continue
    s(b, 'title', p); n(b, 'now', p); s(b, 'nowLabel', p)
    ax = b.get('axis')
    if not (isinstance(ax, list) and len(ax) == 2 and all(is_num(x) for x in ax) and ax[0] < ax[1]): err(f'{p}.axis', '[최소, 최대] 숫자'); ax = None
    for j, it in enumerate(lst(b, 'items', p, mn=1)):
        q = f'{p}.items[{j}]'
        s(it, 'firm', q); s(it, 'point', q, req=False, maxlen=110)
        nums = [it.get(k) for k in ('lo', 'hi', 'target') if it.get(k) is not None]
        if not nums: err(q, 'lo/hi 또는 target 중 하나는 있어야 해요')
        for k in ('lo', 'hi', 'target'):
            if it.get(k) is not None:
                if not is_num(it[k]): err(f'{q}.{k}', '숫자')
                elif ax and not (ax[0] <= it[k] <= ax[1]): err(f'{q}.{k}', f'axis {ax} 밖이에요')
        if side == 'kr' and it.get('stance') not in ('강세', '중립', '신중'): err(f'{q}.stance', "'강세'/'중립'/'신중'")
    strlist(b, 'notes', p, req=False)
sources(br, 'sources', 'brokers')

nk = d.get('newsKR') or {}
t = n(nk, 'tone', 'newsKR')
if t is not None and not -2 <= t <= 2: err('newsKR.tone', '-2 ~ 2')
s(nk, 'toneLabel', 'newsKR', maxlen=24); s(nk, 'summary', 'newsKR', maxlen=160)
for i, x in enumerate(lst(nk, 'points', 'newsKR', mn=3)):
    s(x, 'h', f'newsKR.points[{i}]', maxlen=18); s(x, 's', f'newsKR.points[{i}]', maxlen=160)
sources(nk, 'sources', 'newsKR')

for i, c in enumerate(lst(d, 'newsGlobal', 'top', mn=3)):
    q = f'newsGlobal[{i}]'
    s(c, 'flag', q); s(c, 'name', q); s(c, 'toneLabel', q, maxlen=24); s(c, 'idx', q)
    t = n(c, 'tone', q)
    if t is not None and not -2 <= t <= 2: err(f'{q}.tone', '-2 ~ 2')
    strlist(c, 'points', q, mn=2, maxlen=160)
sources(d, 'globalSources', 'top')

fl = d.get('flows') or {}
for k in ('today', 'todayKQ', 'month'):
    f = fl.get(k); p = f'flows.{k}'
    if f is None:
        if k != 'todayKQ': err(p, '없어요')
        continue
    s(f, 'label', p); s(f, 'unit', p)
    for j, row in enumerate(lst(f, 'rows', p, mn=2)):
        if not (isinstance(row, list) and len(row) == 2 and isinstance(row[0], str) and is_num(row[1])): err(f'{p}.rows[{j}]', '["누가", 숫자] 형식')
wk = fl.get('week')
if wk:
    s(wk, 'label', 'flows.week')
    for i, g in enumerate(lst(wk, 'groups', 'flows.week')):
        s(g, 'who', f'flows.week.groups[{i}]')
        for j, row in enumerate(lst(g, 'items', f'flows.week.groups[{i}]', mn=1)):
            if not (isinstance(row, list) and len(row) == 2 and isinstance(row[0], str) and is_num(row[1])): err(f'flows.week.groups[{i}].items[{j}]', '["종목", 숫자] 형식')
for i, x in enumerate(lst(fl, 'stats', 'flows', req=False)):
    s(x, 'label', f'flows.stats[{i}]'); s(x, 'value', f'flows.stats[{i}]', maxlen=10); s(x, 'sub', f'flows.stats[{i}]', req=False)
strlist(fl, 'us', 'flows', req=False); s(fl, 'take', 'flows', maxlen=240)
sources(fl, 'sources', 'flows')

# ---------- 놓치면 안 될 정보 보강 (11/25 추가) ----------
for i, c in enumerate(mk.get('cards') or []):
    if isinstance(c, dict):
        if c.get('easy') is None: warn(f'mustKnow.cards[{i}].easy', '"쉽게 말하면" 한 줄이 있으면 좋아요')
        else: s(c, 'easy', f'mustKnow.cards[{i}]', maxlen=90)
for i, c in enumerate(mk.get('calendar') or []):
    if isinstance(c, dict):
        q = f'mustKnow.calendar[{i}]'
        s(c, 'exp', q, req=False, maxlen=30); s(c, 'prev', q, req=False, maxlen=30); s(c, 'why', q, req=False, maxlen=110)
        if 'sc' in c and not isinstance(c['sc'], bool): err(f'{q}.sc', 'true/false')
rd = mk.get('radar')
if not isinstance(rd, dict): err('mustKnow.radar', '없어요 (위험 레이더)')
else:
    s(rd, 'label', 'mustKnow.radar', maxlen=40); s(rd, 'take', 'mustKnow.radar', req=False, maxlen=120)
    for i, x in enumerate(lst(rd, 'items', 'mustKnow.radar', mn=4)):
        q = f'mustKnow.radar.items[{i}]'
        s(x, 'name', q, maxlen=16); s(x, 'value', q, maxlen=14); s(x, 'note', q, maxlen=90)
        if x.get('lv') not in (0, 1, 2): err(f'{q}.lv', '0(안정)·1(조금 불안)·2(불안) 중 하나')
sc = mk.get('sectors')
if sc is not None:
    if not isinstance(sc, dict): err('mustKnow.sectors', '객체여야 해요')
    else:
        s(sc, 'label', 'mustKnow.sectors', maxlen=50); s(sc, 'sky', 'mustKnow.sectors', req=False); s(sc, 'skyWord', 'mustKnow.sectors', req=False, maxlen=12)
        if 'skyPct' in sc: n(sc, 'skyPct', 'mustKnow.sectors')
        b = sc.get('breadth')
        if b is not None:
            n(b, 'up', 'mustKnow.sectors.breadth'); n(b, 'down', 'mustKnow.sectors.breadth'); n(b, 'flat', 'mustKnow.sectors.breadth', req=False)
        for i, x in enumerate(lst(sc, 'items', 'mustKnow.sectors', req=b is None, mn=0 if b is not None else 2)):
            q = f'mustKnow.sectors.items[{i}]'
            s(x, 'name', q, maxlen=10); n(x, 'pct', q); s(x, 'note', q, req=False, maxlen=24)
        s(sc, 'note', 'mustKnow.sectors', req=False, maxlen=120)
wl = lst(mk, 'watch', 'mustKnow', mn=2)
if len(wl) > 5: warn('mustKnow.watch', '5개 이하 권장')
for i, x in enumerate(wl):
    q = f'mustKnow.watch[{i}]'
    s(x, 't', q, maxlen=24); s(x, 'now', q, maxlen=40); s(x, 'why', q, maxlen=60)

# ---------- 새 탭 (11/25 추가) ----------
DIRS = (-1, 0, 1)
ch = d.get('chain')
if not isinstance(ch, dict): err('chain', '없어요 (연결고리 탭)')
else:
    s(ch, 'intro', 'chain', req=False, maxlen=90)
    its = lst(ch, 'items', 'chain', mn=1)
    if len(its) > 4: warn('chain.items', '4개 이하 권장')
    for i, x in enumerate(its):
        q = f'chain.items[{i}]'
        s(x, 'icon', q); s(x, 'title', q, maxlen=24); s(x, 'when', q, req=False, maxlen=30); s(x, 'take', q, maxlen=120)
        st = lst(x, 'steps', q, mn=3)
        if len(st) > 7: warn(f'{q}.steps', '7단계 이하 권장')
        for j, y in enumerate(st):
            r = f'{q}.steps[{j}]'
            s(y, 't', r, maxlen=24); s(y, 's', r, req=False, maxlen=40); s(y, 'v', r, req=False, maxlen=16)
            if 'dir' in y and y['dir'] not in DIRS: err(f'{r}.dir', '-1, 0, 1 중 하나')
    sources(ch, 'sources', 'chain')

wa = d.get('wallet')
if not isinstance(wa, dict): err('wallet', '없어요 (내 지갑 탭)')
else:
    s(wa, 'intro', 'wallet', req=False, maxlen=90); s(wa, 'fxLabel', 'wallet', maxlen=24); s(wa, 'prevLabel', 'wallet', req=False, maxlen=16)
    ids = []
    for i, x in enumerate(lst(wa, 'fx', 'wallet', mn=1)):
        q = f'wallet.fx[{i}]'
        if x.get('id') not in ('USD', 'JPY', 'EUR', 'CNY'): err(f'{q}.id', "'USD'/'JPY'/'EUR'/'CNY' 중 하나")
        ids.append(x.get('id'))
        s(x, 'name', q); s(x, 'flag', q, req=False)
        for k in ('per', 'rate'):
            v = n(x, k, q)
            if v is not None and v <= 0: err(f'{q}.{k}', '0보다 커야 해요')
        if 'prev' in x: n(x, 'prev', q)
    if len(set(ids)) != len(ids): err('wallet.fx', '같은 통화가 두 번 있어요')
    for i, x in enumerate(lst(wa, 'items', 'wallet', mn=3)):
        q = f'wallet.items[{i}]'
        s(x, 'icon', q); s(x, 'name', q, maxlen=16); s(x, 'd', q, maxlen=40); s(x, 'note', q, req=False, maxlen=80); s(x, 'sub', q, req=False, maxlen=40)
        if x.get('value') is None and not (isinstance(x.get('text'), str) and x['text'].strip()): err(q, 'value(숫자) 또는 text(문자) 중 하나는 있어야 해요')
        for k in ('value', 'prev', 'chg', 'pct', 'dp'):
            if k in x: n(x, k, q)
        s(x, 'text', q, req=False, maxlen=14); s(x, 'unit', q, req=False); s(x, 'prevLabel', q, req=False)
    strlist(wa, 'tips', 'wallet', req=False, maxlen=90)
    sources(wa, 'sources', 'wallet')

wf = d.get('whatif')
if not isinstance(wf, dict): err('whatif', '없어요 (만약에 탭)')
else:
    s(wf, 'intro', 'whatif', req=False, maxlen=90); s(wf, 'calcNote', 'whatif', maxlen=120); s(wf, 'fxNote', 'whatif', req=False, maxlen=160)
    for i, x in enumerate(lst(wf, 'scenarios', 'whatif')):
        q = f'whatif.scenarios[{i}]'
        s(x, 'icon', q); s(x, 'title', q, maxlen=24); s(x, 'd', q, maxlen=40); s(x, 'base', q, maxlen=80); s(x, 'mine', q, req=False, maxlen=120)
        for j, c in enumerate(lst(x, 'cases', q, mn=2)):
            s(c, 'k', f'{q}.cases[{j}]', maxlen=14); strlist(c, 'p', f'{q}.cases[{j}]', mn=1, maxlen=60)
    for i, x in enumerate(lst(wf, 'rules', 'whatif', mn=3)):
        s(x, 'a', f'whatif.rules[{i}]', maxlen=16); s(x, 'b', f'whatif.rules[{i}]', maxlen=80)
    sources(wf, 'sources', 'whatif')

wd = d.get('words')
if not isinstance(wd, dict): err('words', '없어요 (용어 풀이 탭)')
else:
    s(wd, 'intro', 'words', req=False, maxlen=90)
    for i, x in enumerate(lst(wd, 'items', 'words', mn=6)):
        q = f'words.items[{i}]'
        s(x, 'w', q, maxlen=20); s(x, 'cat', q, maxlen=8); s(x, 'easy', q, maxlen=140); s(x, 'ex', q, req=False, maxlen=100)
    if wd.get('sources') is not None: sources(wd, 'sources', 'words')

qz = d.get('quiz')
if not isinstance(qz, dict): err('quiz', '없어요 (퀴즈 탭)')
else:
    s(qz, 'title', 'quiz', maxlen=24)
    if 'id' in qz: s(qz, 'id', 'quiz')
    its = lst(qz, 'items', 'quiz', mn=3)
    if len(its) > 6: warn('quiz.items', '6문제 이하 권장')
    for i, x in enumerate(its):
        q = f'quiz.items[{i}]'
        s(x, 'q', q, maxlen=60); s(x, 'why', q, maxlen=120)
        o = lst(x, 'opts', q, mn=2)
        if len(o) > 4: err(f'{q}.opts', '보기는 4개까지예요')
        strlist(x, 'opts', q, mn=2, maxlen=24)
        a_ = x.get('a')
        if not (isinstance(a_, int) and not isinstance(a_, bool) and 0 <= a_ < len(o)): err(f'{q}.a', f'정답 번호는 0~{len(o) - 1} 사이 정수예요')
    if its:
        pos = [x.get('a') for x in its if isinstance(x, dict)]
        if len(set(pos)) == 1 and len(pos) >= 3: warn('quiz.items', '정답 위치가 모두 같아요. 섞어 주세요')

TABIDS = ('movers', 'must', 'brokers', 'kr', 'global', 'flows', 'chain', 'wallet', 'whatif', 'words', 'quiz', 'predict', 'league', 'ask')
ak = d.get('ask')
if not isinstance(ak, dict): err('ask', '없어요 (물어보면 탭)')
else:
    s(ak, 'intro', 'ask', req=False, maxlen=90); s(ak, 'note', 'ask', req=False, maxlen=90)
    its = lst(ak, 'items', 'ask', mn=3)
    if len(its) > 7: warn('ask.items', '7개 이하 권장')
    for i, x in enumerate(its):
        q = f'ask.items[{i}]'
        s(x, 'q', q, maxlen=40); s(x, 'short', q, maxlen=50); strlist(x, 'a', q, mn=1, maxlen=90)
        if len(x.get('a') or []) > 4: warn(f'{q}.a', '4줄 이하 권장')
        if 'tab' in x and x['tab'] not in TABIDS: err(f'{q}.tab', f'탭 id가 아니에요: {x["tab"]}')
        s(x, 'tabLabel', q, req=False, maxlen=20)
    sources(ak, 'sources', 'ask')

# ---------- 이번 주 맞혀봐 · 동료 리그 (11/25 추가) ----------
PID = re.compile(r'^[a-z0-9-]{1,24}$')
def iso_t(v):
    try:
        t = datetime.datetime.fromisoformat(v)
        return t if t.tzinfo else None
    except (TypeError, ValueError): return None
def monday(v, p):
    if not (isinstance(v, str) and DATE.match(v)): err(p, 'YYYY-MM-DD 형식이어야 해요'); return None
    day = datetime.date.fromisoformat(v)
    if day.weekday() != 0: err(p, f'월요일 날짜여야 해요 ({v})'); return None
    return day
up_t = iso_t(up) if up else None
def predict_items(items, p, wk_day, done_all=False):
    ids = []
    for i, x in enumerate(items):
        q = f'{p}[{i}]'
        if not isinstance(x, dict): err(q, '객체여야 해요'); continue
        iid = s(x, 'id', q)
        if iid is not None:
            if not PID.match(iid): err(f'{q}.id', '영문 소문자·숫자·- 로 24자 이하')
            ids.append(iid)
        s(x, 'icon', q); s(x, 'q', q, maxlen=40); s(x, 'd', q, maxlen=30); s(x, 'why', q, maxlen=90); s(x, 'rule', q, maxlen=40)
        lk = s(x, 'lock', q); lk_t = iso_t(lk) if lk else None
        if lk is not None and lk_t is None: err(f'{q}.lock', 'ISO 8601 + 시간대 (예: 2026-11-25T22:30:00+09:00)')
        if lk_t and wk_day:
            kd = (lk_t.astimezone(datetime.timezone(datetime.timedelta(hours=9)))).date()
            if not (wk_day - datetime.timedelta(days=2) <= kd <= wk_day + datetime.timedelta(days=6)): warn(f'{q}.lock', f'{wk_day} 주의 마감 시각이 아닌 것 같아요 ({lk})')
        o = lst(x, 'opts', q, mn=2)
        if len(o) > 4: err(f'{q}.opts', '보기는 4개까지예요')
        strlist(x, 'opts', q, mn=2, maxlen=24)
        a_, void = x.get('a'), x.get('void', False)
        if not isinstance(void, bool): err(f'{q}.void', 'true/false'); void = False
        if a_ is not None:
            if not (isinstance(a_, int) and not isinstance(a_, bool) and 0 <= a_ < len(o)): err(f'{q}.a', f'정답 번호는 0~{len(o) - 1} 사이 정수이거나 null이에요')
            if void: err(q, 'a와 void: true를 같이 쓰지 않아요')
        if a_ is not None or void:
            s(x, 'res', q, maxlen=140)
            if lk_t and up_t and up_t < lk_t: err(f'{q}.a', '마감 시각 전인데 결과가 들어 있어요')
        elif done_all: err(f'{q}.a', 'last로 옮긴 문제는 모두 채점돼 있어야 해요 (a 또는 void: true)')
        if 'tab' in x and x['tab'] not in TABIDS: err(f'{q}.tab', f'탭 id가 아니에요: {x["tab"]}')
    if len(set(ids)) != len(ids): err(p, 'id가 겹쳐요')
    return ids
pd = d.get('predict')
if not isinstance(pd, dict): err('predict', '없어요 (이번 주 맞혀봐 탭)')
else:
    wk_day = monday(pd.get('wk'), 'predict.wk')
    s(pd, 'title', 'predict', maxlen=24); s(pd, 'intro', 'predict', req=False, maxlen=90); s(pd, 'note', 'predict', req=False, maxlen=120)
    its = lst(pd, 'items', 'predict', mn=3)
    if len(its) > 6: warn('predict.items', '6문제 이하 권장')
    cur_ids = predict_items(its, 'predict.items', wk_day)
    if wk_day and up_t:
        this_mon = up_t.astimezone(datetime.timezone(datetime.timedelta(hours=9))).date()
        this_mon -= datetime.timedelta(days=this_mon.weekday())
        if wk_day not in (this_mon, this_mon + datetime.timedelta(days=7)): warn('predict.wk', f'이번 주({this_mon})나 다음 주 문제가 아니에요')
    pos = [x.get('a') for x in its if isinstance(x, dict) and isinstance(x.get('a'), int)]
    if len(pos) >= 3 and len(set(pos)) == 1: warn('predict.items', '정답 위치가 모두 같아요. 보기 순서를 섞어 주세요 (이미 낸 문제는 바꾸지 말고 새 문제부터)')
    la = pd.get('last')
    if la is not None:
        if not isinstance(la, dict): err('predict.last', '객체여야 해요')
        else:
            last_day = monday(la.get('wk'), 'predict.last.wk')
            if last_day and wk_day and last_day >= wk_day: err('predict.last.wk', 'predict.wk보다 앞선 주여야 해요')
            s(la, 'title', 'predict.last', maxlen=24)
            predict_items(lst(la, 'items', 'predict.last', mn=1), 'predict.last.items', last_day, done_all=True)
    sources(pd, 'sources', 'predict', req=False)

lg = d.get('league')
MK_IDS = ('kospi', 'kosdaq', 'nasdaq')
if not isinstance(lg, dict): err('league', '없어요 (동료 리그 탭)')
else:
    s(lg, 'intro', 'league', req=False, maxlen=90); s(lg, 'note', 'league', req=False, maxlen=120)
    assets = lst(lg, 'assets', 'league', mn=4)
    if len(assets) > 10: warn('league.assets', '10개 이하 권장')
    aids = []
    for i, x in enumerate(assets):
        q = f'league.assets[{i}]'
        if not isinstance(x, dict): err(q, '객체여야 해요'); continue
        aid = s(x, 'id', q)
        if aid is not None:
            if not re.match(r'^[a-z0-9]{1,16}$', aid): err(f'{q}.id', '영문 소문자·숫자 16자 이하')
            aids.append(aid)
        s(x, 'name', q, maxlen=12); s(x, 'icon', q); s(x, 'kind', q, maxlen=10)
        mkt = x.get('mkt')
        if mkt not in ('kr', 'us'): err(f'{q}.mkt', "'kr' 또는 'us'")
        if x.get('grp') not in ('kr', 'us', 'cmd', 'fx'): err(f'{q}.grp', "'kr'·'us'·'cmd'·'fx' 중 하나")
        if 'cur' in x and x['cur'] not in ('원', '$'): err(f'{q}.cur', "'원' 또는 '$'")
        if 'close' in x and not re.match(r'^\d{2}:\d{2}$', str(x['close'])): err(f'{q}.close', '"HH:MM" (한국시간)')
        src = x.get('src')
        if src is not None:
            if src not in MK_IDS: err(f'{q}.src', f'{MK_IDS} 중 하나')
            if 'hist' in x: err(q, 'src와 hist 중 하나만 써요')
            elif src in MK_IDS and isinstance(ms.get(src), dict) and len(ms[src].get('series') or []) < 20: warn(f'{q}.src', f'markets.{src}.series가 20개보다 적으면 리그 최근 4주 계산이 짧아져요')
            continue
        hist = lst(x, 'hist', q, mn=2); dates = []; prev_v = None
        for j, row in enumerate(hist):
            if not (isinstance(row, list) and len(row) == 2 and DATE.match(str(row[0])) and is_num(row[1]) and row[1] > 0): err(f'{q}.hist[{j}]', '["YYYY-MM-DD", 0보다 큰 숫자] 형식이어야 해요'); continue
            dates.append(row[0])
            if prev_v and abs(row[1] / prev_v - 1) > 0.3: warn(f'{q}.hist[{j}]', '하루에 30% 넘게 움직였어요. 숫자를 다시 확인해 주세요')
            prev_v = row[1]
        if dates != sorted(dates) or len(set(dates)) != len(dates): err(f'{q}.hist', '날짜가 오름차순이고 겹치지 않아야 해요')
        if len(hist) > 30: warn(f'{q}.hist', f'{len(hist)}개예요. 25개 정도로 줄여 주세요 (오래된 것부터)')
        am = a.get(mkt) if mkt in ('kr', 'us') else None
        if dates and isinstance(am, str) and DATE.match(am):
            if dates[-1] > am: err(f'{q}.hist', f'마지막 날짜 {dates[-1]}가 asof.{mkt}({am})보다 뒤예요')
            elif dates[-1] < am: warn(f'{q}.hist', f'asof.{mkt}({am}) 종가가 아직 없어요. 그날 종가를 붙여 주세요')
        ref = x.get('ref')
        if ref is not None:
            rk, _, rn = str(ref).partition(':'); rv = None
            if rk == 'ticker': rv = next((t.get('value') for t in d.get('ticker') or [] if isinstance(t, dict) and t.get('id') == rn), None)
            elif rk in MK_IDS: rv = next((b.get('price') for b in (ms.get(rk) or {}).get('big') or [] if isinstance(b, dict) and b.get('name') == rn), None)
            else: err(f'{q}.ref', '"ticker:아이디" 또는 "kospi:종목명"/"nasdaq:종목명" 형식')
            if rk in MK_IDS + ('ticker',) and not is_num(rv): warn(f'{q}.ref', f'{ref} 가격을 찾지 못했어요 (big에 price를 넣어 주세요)')
            elif is_num(rv) and dates and dates[-1] == am and hist and is_num(hist[-1][1]) and abs(hist[-1][1] - rv) / rv > 0.0005:
                err(f'{q}.hist', f'{am} 값 {hist[-1][1]}이 {ref} 가격 {rv}와 달라요')
    if len(set(aids)) != len(aids): err('league.assets', 'id가 겹쳐요')
    sources(lg, 'sources', 'league', req=False)

# ---------- 투자 권유처럼 읽히는 말 막기 ----------
BAN = re.compile(r'(사세요|파세요|매수하세요|매도하세요|추천합니다|추천 종목|꼭 사|지금 사야|담으세요)')
def walk(x, p):
    if isinstance(x, str):
        m = BAN.search(x)
        if m and not URL.match(x): err(p, f'투자 권유처럼 읽혀요: "{m.group(0)}"')
    elif isinstance(x, dict):
        for k, v in x.items(): walk(v, f'{p}.{k}')
    elif isinstance(x, list):
        for i, v in enumerate(x): walk(v, f'{p}[{i}]')
walk(d, 'top')

for w in warns: print('⚠️ ', w)
for e in errors: print('❌', e)
print(f'{"통과" if not errors else "실패"}: 오류 {len(errors)}개, 경고 {len(warns)}개 ({PATH})')
sys.exit(1 if errors else 0)
