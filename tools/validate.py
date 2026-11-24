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

for w in warns: print('⚠️ ', w)
for e in errors: print('❌', e)
print(f'{"통과" if not errors else "실패"}: 오류 {len(errors)}개, 경고 {len(warns)}개 ({PATH})')
sys.exit(1 if errors else 0)
