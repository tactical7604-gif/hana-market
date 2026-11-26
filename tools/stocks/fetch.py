#!/usr/bin/env python3
"""종목 상세 화면(차트·회사 정보·경쟁사 비교·로고)용 공식 데이터를 받아 stocks/ 폴더에 써요.

GitHub 자동 작업(.github/workflows/stocks.yml)이 평일 하루 두 번 실행해요.
- 시세: 금융위원회 주식시세정보 (공공데이터포털)            → 비밀값 DATA_GO_KR_KEY
- 회사 정보·재무·주주·배당: 금융감독원 OpenDART             → 비밀값 DART_API_KEY
- 로고: Brandfetch 공개 Client ID (앱이 바로 불러 써요)      → 변수 BRANDFETCH_CLIENT_ID
  로고 그림은 받거나 저장하지 않고, 회사 홈페이지 주소(도메인)만 적어 둬요.

키가 없으면 아무것도 바꾸지 않고 정상 종료해요. 키 값은 절대 출력하지 않아요.
만드는 파일
- stocks/index.json      : 종목 목록(이름·시장·도메인·ISIN), 기준일, 출처, 로고 Client ID
- stocks/<코드>.json     : 일봉(약 1년 반), 회사 개요, 재무 3년, 배당, 주요 주주, 같은 업종 비교
- stocks/companies.json  : DART 회사 정보 저장(자주 안 바뀌어서 60일마다 새로 받아요)
"""
import calendar
import datetime as dt
import io
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, 'stocks')
KST = dt.timezone(dt.timedelta(hours=9))
# 새로 신청한 키는 V2 주소에만 등록돼요(옛 주소로 부르면 '30 등록되지 않은 서비스키'). 예전에 받은 키를 위해 옛 주소도 차례로 시도해요.
FSC_URLS = [
    'https://apis.data.go.kr/1160100/GetStockSecuritiesInfoService_V2/getStockPriceInfo_V2',
    'https://apis.data.go.kr/1160100/service/GetStockSecuritiesInfoService/getStockPriceInfo',
]
DART = 'https://opendart.fss.or.kr/api/'
HIST_DAYS = 550          # 약 1년 반 (1년 차트에 120일선까지 그리려고)
TOP_KOSPI, TOP_KOSDAQ = 30, 10
UNIVERSE = 150           # 같은 업종 비교에 쓰는 시가총액 상위 종목 수
KEEP_DAYS = 30           # 목록에서 빠진 종목 파일을 지우기까지 기다리는 날
CO_REFRESH_DAYS, CO_MAX_PER_RUN = 60, 200
LG_DAYS = 40             # league.json에 넣는 최근 종가 개수 (최근 4주 순위 + 여유)
CAPS_TOP = 250           # caps.json에 넣는 시가총액 상위 종목 수
SLEEP = 0.12
SOURCES = [
    ['금융위원회_주식시세정보 (공공데이터포털)', 'https://www.data.go.kr/data/15094808/openapi.do'],
    ['금융감독원 전자공시 OpenDART', 'https://opendart.fss.or.kr/'],
]
# 한국표준산업분류(10차) 업종 이름: 3자리가 있으면 3자리, 없으면 2자리
KSIC3 = {
    '101': '도축·육류가공', '102': '수산물 가공', '103': '과실·채소 가공', '104': '식용 유지', '105': '낙농·아이스크림',
    '106': '곡물 가공·전분', '107': '기타 식품', '108': '사료', '111': '술 제조', '112': '음료 제조', '120': '담배',
    '192': '석유 정제', '201': '기초 화학물질', '202': '합성고무·플라스틱 원료', '203': '비료·농약', '204': '기타 화학제품(화장품 등)',
    '205': '화학섬유', '211': '기초 의약물질', '212': '의약품', '213': '의료용품', '221': '고무제품', '222': '플라스틱제품',
    '231': '유리', '232': '도자기', '233': '시멘트·석회', '239': '기타 비금속 광물제품', '241': '1차 철강', '242': '1차 비철금속', '243': '금속 주조',
    '251': '구조용 금속·탱크·증기발생기', '252': '무기·총포탄', '259': '기타 금속가공제품',
    '261': '반도체', '262': '전자부품', '263': '컴퓨터·주변장치', '264': '통신·방송 장비', '265': '영상·음향기기', '266': '광학 매체',
    '271': '의료기기', '272': '측정·정밀기기', '273': '광학기기', '274': '시계',
    '281': '전동기·발전기·전기 제어장치', '282': '배터리(전지)', '283': '전선·케이블', '284': '조명장치', '285': '가정용 기기', '289': '기타 전기장비',
    '291': '일반 기계', '292': '특수 목적 기계(반도체 장비 등)',
    '301': '자동차', '302': '자동차 차체·트레일러', '303': '자동차 부품', '311': '조선', '312': '철도 장비', '313': '항공기·우주', '319': '기타 운송장비',
    '351': '전기', '352': '가스', '411': '건물 건설', '412': '토목 건설', '421': '기반조성·시설물 공사', '423': '전기·통신 공사',
    '461': '상품 중개', '462': '농축산물 도매', '463': '음식료품 도매', '464': '생활용품 도매', '465': '기계장비 도매', '467': '기타 전문 도매',
    '471': '종합 소매(백화점·마트)', '472': '음식료품 소매', '478': '기타 상품 소매', '479': '무점포 소매(온라인)',
    '491': '철도 운송', '492': '육상 여객 운송', '493': '도로 화물 운송', '501': '해상 운송', '511': '항공 여객 운송', '512': '항공 화물 운송',
    '521': '보관·창고', '529': '기타 운송 서비스(물류)', '551': '호텔·숙박', '561': '음식점',
    '581': '서적·잡지 출판', '582': '소프트웨어(게임 등)', '591': '영화·방송 프로그램 제작', '592': '음반 제작', '601': '라디오 방송', '602': '텔레비전 방송',
    '612': '통신', '620': '시스템 통합·관리(IT 서비스)', '631': '포털·인터넷 정보 서비스', '639': '기타 정보 서비스',
    '641': '은행', '642': '신탁·집합투자', '649': '기타 금융(금융지주 등)', '651': '보험', '652': '재보험', '653': '연금', '661': '증권 등 금융 지원 서비스', '662': '보험 지원 서비스',
    '681': '부동산 임대·공급', '682': '부동산 관련 서비스', '701': '연구개발', '712': '회계·세무', '713': '광고', '714': '시장조사', '715': '지주회사·경영 컨설팅',
    '721': '건축기술·엔지니어링', '729': '기타 과학기술 서비스', '741': '사업시설 유지관리', '751': '고용 알선·인력 공급', '752': '여행사', '753': '경비·경호',
    '761': '운송장비 임대', '762': '개인·가정용품 임대', '851': '초·중·고 교육', '855': '일반 교습학원', '856': '기타 교육', '861': '병원',
    '901': '창작·예술', '911': '스포츠 서비스', '912': '유원지·오락(게임장·카지노 등)',
}
KSIC2 = {
    '01': '농업', '02': '임업', '03': '어업', '05': '석탄·원유 광업', '06': '금속 광업', '07': '비금속광물 광업', '08': '광업 지원',
    '10': '식료품', '11': '음료', '12': '담배', '13': '섬유', '14': '의복', '15': '가죽·신발', '16': '목재', '17': '펄프·종이', '18': '인쇄',
    '19': '석유 정제', '20': '화학', '21': '의약품', '22': '고무·플라스틱', '23': '비금속 광물제품', '24': '1차 금속', '25': '금속가공',
    '26': '전자부품·컴퓨터·통신장비', '27': '의료·정밀기기', '28': '전기장비', '29': '기계', '30': '자동차', '31': '기타 운송장비',
    '32': '가구', '33': '기타 제품', '34': '기계 수리', '35': '전기·가스', '36': '수도', '37': '하수 처리', '38': '폐기물·재생', '39': '환경 정화',
    '41': '종합 건설', '42': '전문 공사', '45': '자동차 판매', '46': '도매', '47': '소매', '49': '육상 운송', '50': '해상 운송', '51': '항공 운송',
    '52': '창고·물류', '55': '숙박', '56': '음식점', '58': '출판(소프트웨어 포함)', '59': '영상·오디오 제작', '60': '방송', '61': '통신',
    '62': 'IT 서비스', '63': '정보 서비스', '64': '금융', '65': '보험', '66': '금융·보험 서비스', '68': '부동산', '70': '연구개발',
    '71': '전문 서비스', '72': '엔지니어링·과학기술', '73': '기타 전문 서비스', '74': '시설 관리', '75': '사업 지원 서비스', '76': '임대',
    '85': '교육', '86': '보건', '87': '사회복지', '90': '예술·여가', '91': '스포츠·오락', '94': '협회·단체', '95': '수리', '96': '기타 개인 서비스',
}
ACC = {
    'rev': ('매출액', '수익(매출액)', '영업수익', '매출'),
    'op': ('영업이익', '영업이익(손실)'),
    'ni': ('당기순이익', '당기순이익(손실)'),
    'assets': ('자산총계',), 'liab': ('부채총계',), 'eq': ('자본총계',),
}


class ApiError(Exception):
    pass


def log(*a):
    print(*a, flush=True)


def clean_key(k):
    """비밀값에 공백이나 이미 인코딩된 키(%2B 등)를 넣어도 한 번만 인코딩되게 정리해요."""
    k = (k or '').strip()
    return urllib.parse.unquote(k) if '%' in k else k


KEY_FSC = clean_key(os.environ.get('DATA_GO_KR_KEY'))


def dart_key(k):
    """OpenDART 키는 숫자·영어 40자예요. 표 한 줄이나 안내 글이 같이 복사돼도 그 안의 40자 키만 골라 써요.
    돌려주는 건 (키, 로그에 남길 설명). 키 글자는 어디에도 찍지 않아요."""
    k = clean_key(k)
    if not k or re.fullmatch(r'[0-9a-fA-F]{40}', k):
        return k, ''
    hits = set(re.findall(r'(?<![0-9A-Za-z])[0-9a-fA-F]{40}(?![0-9A-Za-z])', k))
    if len(hits) == 1:
        return hits.pop(), '넣은 값에 다른 글자가 섞여 있어서 그 안의 40자 키만 골라 썼어요'
    return k, ''


KEY_DART, DART_NOTE = dart_key(os.environ.get('DART_API_KEY'))
CID = (os.environ.get('BRANDFETCH_CLIENT_ID') or '').strip()
NOW = dt.datetime.now(KST)


def http_get(url, params, timeout=40):
    req = urllib.request.Request(url + '?' + urllib.parse.urlencode(params), headers={'User-Agent': 'hana-market-bot/1.0'})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


HTTP = http_get  # 검사할 때 가짜로 바꿔 끼워요
CALLS = {'fsc': 0, 'dart': 0}


def fetch(url, params, tries=3):
    last = None
    for i in range(tries):
        try:
            return HTTP(url, params)
        except Exception as e:  # 주소(키 포함)가 찍히지 않게 종류만 남겨요
            last = e
            time.sleep(2 * (i + 1))
    code = getattr(last, 'code', '')
    raise ApiError(f'{urllib.parse.urlsplit(url).netloc} 연결 실패 ({type(last).__name__} {code})'.strip())


# ---------- 작은 도우미 ----------
def num(s):
    if s is None:
        return None
    t = str(s).replace(',', '').strip()
    if t in ('', '-'):
        return None
    try:
        v = float(t)
    except ValueError:
        return None
    return int(v) if v.is_integer() else round(v, 4)


def ymd(s):
    s = str(s or '').strip()
    return f'{s[:4]}-{s[4:6]}-{s[6:8]}' if re.fullmatch(r'\d{8}', s) else None


def norm_code(s):
    s = str(s or '').strip().upper()
    if s.startswith('A') and len(s) == 7:
        s = s[1:]
    return s if re.fullmatch(r'[0-9A-Z]{6}', s) else None


# 회사 자기 도메인이 아닌 곳(블로그·SNS·홈페이지 빌더)은 로고를 찾을 수 없어서 비워 둬요. 앱(market.js)의 BAD_HOST와 같은 목록이에요.
BAD_HOST = re.compile(r'(^|\.)(blog\.naver\.com|cafe\.naver\.com|naver\.me|modoo\.at|tistory\.com|blogspot\.com|wordpress\.com|wixsite\.com'
                      r'|weebly\.com|facebook\.com|instagram\.com|youtube\.com|pf\.kakao\.com|sites\.google\.com|github\.io|notion\.site'
                      r'|linkedin\.com|cafe\.daum\.net|blog\.daum\.net|imweb\.me|creatorlink\.net)$')


def domain_of(url):
    u = (url or '').strip().lower()
    if not u:
        return ''
    if '://' not in u:
        u = 'http://' + u
    host = urllib.parse.urlsplit(u).hostname or ''
    host = re.sub(r'^www\d?\.', '', host)
    if BAD_HOST.search(host):
        return ''
    return host if re.fullmatch(r'[a-z0-9.-]+\.[a-z]{2,}', host) else ''


def add_months(d, n):
    """달력 기준 n개월 앞뒤 날짜. 그 달에 같은 날이 없으면 말일(앱 market.js의 addM과 같은 계산)."""
    m = d.month - 1 + n
    y, m = d.year + m // 12, m % 12 + 1
    return d.replace(year=y, month=m, day=min(d.day, calendar.monthrange(y, m)[1]))


def ind_name(c):
    c = str(c or '').strip()
    return KSIC3.get(c[:3]) or KSIC2.get(c[:2]) or ''


def jload(path, fb):
    try:
        with open(path, encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return fb


def jsave(path, obj):
    """내용이 같으면 파일을 안 건드려요(쓸데없는 커밋 방지)."""
    s = json.dumps(obj, ensure_ascii=False, separators=(',', ':'))
    try:
        with open(path, encoding='utf-8') as f:
            if f.read() == s:
                return False
    except FileNotFoundError:
        pass
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(s)
    return True


# ---------- 금융위원회 주식시세정보 ----------
FSC_OK = {'url': None}  # 한 번 통한 주소는 이번 실행 내내 써요


def fsc_once(url, params):
    raw = fetch(url, {'serviceKey': KEY_FSC, 'resultType': 'json', **params})
    time.sleep(SLEEP)
    try:
        j = json.loads(raw.decode('utf-8'))
    except Exception:
        m = re.search(rb'<returnAuthMsg>([^<]+)</returnAuthMsg>', raw) or re.search(rb'<errMsg>([^<]+)</errMsg>', raw)
        raise ApiError('공공데이터포털 오류: ' + (m.group(1).decode('utf-8', 'replace') if m else '응답을 읽지 못했어요'))
    r = j.get('response') or {}
    hd = r.get('header') or {}
    if hd.get('resultCode') not in (None, '00'):
        raise ApiError(f"공공데이터포털 오류: {hd.get('resultCode')} {hd.get('resultMsg')}")
    body = r.get('body') or {}
    items = body.get('items')
    items = items.get('item', []) if isinstance(items, dict) else []
    if isinstance(items, dict):
        items = [items]
    return items, int(num(body.get('totalCount')) or 0)


def fsc(params):
    CALLS['fsc'] += 1
    if FSC_OK['url']:
        return fsc_once(FSC_OK['url'], params)
    errs = []
    for url in FSC_URLS:
        try:
            out = fsc_once(url, params)
        except ApiError as e:
            errs.append(str(e))
            continue
        FSC_OK['url'] = url
        log('시세 주소: ' + ('새 주소(V2)' if '_V2' in url else '옛 주소'))
        return out
    raise ApiError(' / '.join(dict.fromkeys(errs)))


def fsc_all(params, per=1000, cap=40):
    out, page = [], 1
    while page <= cap:
        items, total = fsc({**params, 'numOfRows': per, 'pageNo': page})
        out += items
        if not items or len(out) >= total:
            break
        page += 1
    return out


def latest_day():
    since = (NOW.date() - dt.timedelta(days=14)).strftime('%Y%m%d')
    items, _ = fsc({'likeSrtnCd': '005930', 'beginBasDt': since, 'numOfRows': 30, 'pageNo': 1})
    days = sorted({it.get('basDt') for it in items if norm_code(it.get('srtnCd')) == '005930' and ymd(it.get('basDt'))})
    if not days:
        raise ApiError('최근 거래일을 찾지 못했어요')
    return days[-1]


def snapshot(day):
    """그날 코스피·코스닥 전 종목 종가·시가총액 (저장하지 않고 계산에만 써요)."""
    out = {}
    for it in fsc_all({'basDt': day}):
        code, mk = norm_code(it.get('srtnCd')), it.get('mrktCtg')
        if not code or mk not in ('KOSPI', 'KOSDAQ'):
            continue
        out[code] = {'n': (it.get('itmsNm') or '').strip(), 'm': mk, 'c': num(it.get('clpr')), 'cap': num(it.get('mrktTotAmt')),
                     'sh': num(it.get('lstgStCnt')), 'amt': num(it.get('trPrc')), 'isin': (it.get('isinCd') or '').strip()}
    return out


def snapshot_near(day_iso, back=10):
    d = dt.date.fromisoformat(day_iso)
    for i in range(back):
        s = snapshot((d - dt.timedelta(days=i)).strftime('%Y%m%d'))
        if s:
            return s
    return {}


def history(code, since_iso):
    items = fsc_all({'likeSrtnCd': code, 'beginBasDt': since_iso.replace('-', '')}, cap=3)
    rows, last = {}, None
    for it in items:
        if norm_code(it.get('srtnCd')) != code:
            continue
        d, c = ymd(it.get('basDt')), num(it.get('clpr'))
        if not d or not c:
            continue
        o, h, l, v = (num(it.get(k)) for k in ('mkp', 'hipr', 'lopr', 'trqu'))
        rows[d] = [d, o or c, h or c, l or c, c, v or 0]
        if not last or d >= ymd(last.get('basDt')):
            last = it
    meta = {'cap': num(last.get('mrktTotAmt')), 'sh': num(last.get('lstgStCnt')), 'mkt': last.get('mrktCtg'), 'n': (last.get('itmsNm') or '').strip()} if last else {}
    return [rows[k] for k in sorted(rows)], meta


# ---------- OpenDART ----------
def dart(path, params):
    CALLS['dart'] += 1
    raw = fetch(DART + path, {'crtfc_key': KEY_DART, **params})
    time.sleep(SLEEP)
    try:
        j = json.loads(raw.decode('utf-8'))
    except Exception:
        raise ApiError('DART 응답을 읽지 못했어요')
    st = j.get('status')
    if st == '013':
        return None
    if st != '000':
        raise ApiError(f"DART 오류: {st} {j.get('message')}")
    return j


def corp_codes():
    CALLS['dart'] += 1
    raw = fetch(DART + 'corpCode.xml', {'crtfc_key': KEY_DART})
    if not raw.startswith(b'PK'):
        m = re.search(rb'<message>([^<]+)</message>', raw) or re.search(rb'"message"\s*:\s*"([^"]+)"', raw)
        raise ApiError('DART 회사 목록 오류: ' + (m.group(1).decode('utf-8', 'replace') if m else '알 수 없음'))
    z = zipfile.ZipFile(io.BytesIO(raw))
    out = {}
    for el in ET.fromstring(z.read(z.namelist()[0])).iter('list'):
        sc = (el.findtext('stock_code') or '').strip()
        if re.fullmatch(r'\d{6}', sc):
            out[sc] = (el.findtext('corp_code') or '').strip()
    return out


def corp_of(code, cmap):
    # 우선주(005935 등)는 보통주(005930)와 같은 회사로 봐요
    return cmap.get(code) or cmap.get(code[:5] + '0')


def company(cc):
    j = dart('company.json', {'corp_code': cc})
    if not j:
        return None
    g = lambda k: (j.get(k) or '').strip()
    return {'cc': cc, 'ceo': g('ceo_nm'), 'est': ymd(g('est_dt')), 'addr': g('adres'), 'url': g('hm_url'), 'indc': g('induty_code'),
            'acc': g('acc_mt'), 't': NOW.date().isoformat()}


def fin_multi(ccs, year, by_stock=None):
    """여러 회사 주요 재무(사업보고서) → {corp_code: {'fy','fs','rev':[전전기,전기,당기],...}}"""
    got = {}
    for i in range(0, len(ccs), 100):
        j = dart('fnlttMultiAcnt.json', {'corp_code': ','.join(ccs[i:i + 100]), 'bsns_year': str(year), 'reprt_code': '11011'})
        for r in (j or {}).get('list', []):
            cc = (r.get('corp_code') or '').strip() or (by_stock or {}).get((r.get('stock_code') or '').strip(), '')
            if cc not in ccs:
                continue
            fs = r.get('fs_div') or 'OFS'
            nm = re.sub(r'\s', '', r.get('account_nm') or '')
            for k, names in ACC.items():
                if nm in names:
                    vals = [num(r.get('bfefrmtrm_amount')), num(r.get('frmtrm_amount')), num(r.get('thstrm_amount'))]
                    got.setdefault(cc, {}).setdefault(fs, {}).setdefault(k, vals)
    out = {}
    for cc, by in got.items():
        fs = 'CFS' if 'CFS' in by else 'OFS'
        out[cc] = {'fy': year, 'fs': fs, **by[fs]}
    return out


def dividend(cc, year):
    j = dart('alotMatter.json', {'corp_code': cc, 'bsns_year': str(year), 'reprt_code': '11011'})
    for r in (j or {}).get('list', []):
        if '주당' in (r.get('se') or '') and '현금배당금' in (r.get('se') or '') and (r.get('stock_knd') or '보통주') == '보통주':
            return num(r.get('thstrm'))
    return None


def holders(cc, year):
    j = dart('hyslrSttus.json', {'corp_code': cc, 'bsns_year': str(year), 'reprt_code': '11011'})
    rows = {}
    for r in (j or {}).get('list', []):
        nm, q, kind = (r.get('nm') or '').strip(), num(r.get('trmend_posesn_stock_qota_rt')), r.get('stock_knd') or '보통주'
        if not nm or nm in ('계', '합계', '소계') or q is None or '우선' in kind or not ('보통' in kind or '의결권' in kind):
            continue
        rows[nm] = max(q, rows.get(nm, 0))
    return sorted(([k, v] for k, v in rows.items()), key=lambda x: -x[1])[:6]


# ---------- 어떤 종목을 받을지 ----------
def wanted_names():
    """market.json에 나온 한국 종목 이름 (급등락·대형주·수급 상위·리그)."""
    d = jload(os.path.join(ROOT, 'market.json'), {})
    names = set()
    for k in ('kospi', 'kosdaq'):
        m = (d.get('markets') or {}).get(k) or {}
        for sec in ('up', 'down', 'big'):
            for x in m.get(sec) or []:
                if isinstance(x, dict) and x.get('name'):
                    names.add(str(x['name']).strip())
    for g in ((d.get('flows') or {}).get('week') or {}).get('groups') or []:
        for x in (g or {}).get('items') or []:
            n = x[0] if isinstance(x, list) and x else (x.get('name') if isinstance(x, dict) else None)
            if n:
                names.add(str(n).strip())
    for a in (d.get('league') or {}).get('assets') or []:
        ref = str((a or {}).get('ref') or '')
        if ref.startswith(('kospi:', 'kosdaq:')):
            names.add(ref.split(':', 1)[1])
    return names


def league_list():
    """동료 리그 업종별 종목 목록 (tools/stocks/league_list.json). 이 종목들은 매일 종가·1년 최저최고를 stocks/league.json에 모아요."""
    j = jload(os.path.join(ROOT, 'tools', 'stocks', 'league_list.json'), {})
    secs = [s for s in (j.get('secs') or []) if isinstance(s, list) and len(s) >= 2 and isinstance(s[0], str)]
    keys = {s[0] for s in secs}
    out, seen_ids = [], set()
    for e in j.get('items') or []:
        if not isinstance(e, dict):
            continue
        c, i = str(e.get('code') or ''), str(e.get('id') or '')
        if re.fullmatch(r'[0-9A-Z]{6}', c) and re.fullmatch(r'[a-z0-9]{1,16}', i) and e.get('sec') in keys and i not in seen_ids:
            seen_ids.add(i)
            out.append({'id': i, 'code': c, 'name': str(e.get('name') or ''), 'sec': e['sec'], 'icon': str(e.get('icon') or '')})
    return secs, out


def y1_of(rows):
    """일봉 [날짜,시,고,저,종,거래량]에서 최근 1년(365일) 장중 최저·최고."""
    if not rows:
        return None
    last = rows[-1][0]
    cut = (dt.date.fromisoformat(last) - dt.timedelta(days=365)).isoformat()
    yr = [r for r in rows if r[0] > cut]
    lo = min((r[3] for r in yr if r[3] and r[3] > 0), default=None)
    hi = max((r[2] for r in yr if r[2] and r[2] > 0), default=None)
    return {'lo': lo, 'hi': hi, 'd': last} if lo and hi and hi > lo else None


def peers_of(code, uni, cos, n=5):
    me = cos.get(code) or {}
    ic = me.get('indc') or ''
    if not ic:
        return []
    for k in (3, 2):
        pool = [c for c in uni if c != code and c.endswith('0') and (cos.get(c) or {}).get('indc', '')[:k] == ic[:k]]
        if len(pool) >= 2 or k == 2:
            return sorted(pool, key=lambda c: -(uni[c].get('cap') or 0))[:n]
    return []


def main():
    CALLS.update(fsc=0, dart=0)
    if not KEY_FSC:
        log('DATA_GO_KR_KEY가 아직 없어요. 저장소 Settings → Secrets에 넣으면 다음 실행부터 받아요. 이번엔 건너뛰어요.')
        return 0
    os.makedirs(OUT, exist_ok=True)
    idx_path, co_path = os.path.join(OUT, 'index.json'), os.path.join(OUT, 'companies.json')
    old_idx = jload(idx_path, {})
    seen = dict(old_idx.get('seen') or {})
    cos = jload(co_path, {})
    day = latest_day()
    day_iso = ymd(day)
    log(f'최근 거래일 {day_iso}')
    snap = snapshot(day)
    if not snap:
        raise ApiError('전 종목 시세를 받지 못했어요')
    log(f'전 종목 {len(snap)}개')
    by_name = {}
    for c, s in snap.items():
        by_name.setdefault(s['n'], c)
    kospi = sorted((c for c in snap if snap[c]['m'] == 'KOSPI'), key=lambda c: -(snap[c]['cap'] or 0))
    kosdaq = sorted((c for c in snap if snap[c]['m'] == 'KOSDAQ'), key=lambda c: -(snap[c]['cap'] or 0))
    want = set(kospi[:TOP_KOSPI] + kosdaq[:TOP_KOSDAQ])
    missing = []
    for nm in sorted(wanted_names()):
        c = by_name.get(nm)
        if c:
            want.add(c)
        else:
            missing.append(nm)
    if missing:
        log('이름으로 못 찾은 종목:', ', '.join(missing[:20]))
    lg_secs, lg_items = league_list()
    lg_missing = [e['code'] for e in lg_items if e['code'] not in snap]
    want |= {e['code'] for e in lg_items if e['code'] in snap}
    if lg_missing:
        log('리그 종목 중 시세에 없는 코드:', ', '.join(lg_missing))
    for c in want:
        seen[c] = day_iso
    keep = {c for c, d in seen.items() if c in snap and (dt.date.fromisoformat(day_iso) - dt.date.fromisoformat(d)).days <= KEEP_DAYS}
    seen = {c: seen[c] for c in sorted(keep)}
    uni = {c: snap[c] for c in (set(sorted(snap, key=lambda c: -(snap[c]['cap'] or 0))[:UNIVERSE]) | keep)}
    log(f'받을 종목 {len(keep)}개 · 비교용 {len(uni)}개')

    # 1) 일봉: 파일에 있는 다음 날부터만 새로 받아요
    hists = {}
    start = (dt.date.fromisoformat(day_iso) - dt.timedelta(days=HIST_DAYS)).isoformat()
    for c in sorted(keep):
        old = jload(os.path.join(OUT, c + '.json'), {})
        rows = [r for r in (old.get('d') or []) if isinstance(r, list) and len(r) == 6 and r[0] >= start]
        since = (dt.date.fromisoformat(rows[-1][0]) + dt.timedelta(days=1)).isoformat() if rows else start
        meta = {}
        if since <= day_iso:
            new, meta = history(c, since)
            merged = {r[0]: r for r in rows}
            merged.update({r[0]: r for r in new})
            rows = [merged[k] for k in sorted(merged) if k >= start]
        hists[c] = (rows, meta, old)

    # 2) 1개월·1년 전 종가 (수익률 비교용). 앱 차트의 기간 수익률과 같은 기준: 달력으로 1·12개월 전 날이나 그 앞 마지막 거래일
    d0 = dt.date.fromisoformat(day_iso)
    s1m = snapshot_near(add_months(d0, -1).isoformat())
    s1y = snapshot_near(add_months(d0, -12).isoformat())

    # 3) DART: 회사 정보(60일마다), 재무(매번), 배당·주주(받을 종목만)
    fins, extra = {}, {}
    if KEY_DART:
        if DART_NOTE:
            log('DART_API_KEY:', DART_NOTE)
        try:
            cmap = corp_codes()
            todo = [c for c in sorted(uni, key=lambda c: (c not in keep, -(uni[c]['cap'] or 0)))
                    if corp_of(c, cmap) and (c not in cos or (d0 - dt.date.fromisoformat(cos[c].get('t') or '2000-01-01')).days > CO_REFRESH_DAYS)]
            for c in todo[:CO_MAX_PER_RUN]:
                info = company(corp_of(c, cmap))
                if info:
                    cos[c] = info
            cos = {c: cos[c] for c in sorted(cos) if c in uni or c in keep}
            ccs = sorted({corp_of(c, cmap) for c in uni if corp_of(c, cmap)})
            fy = NOW.year - 1
            fins = fin_multi(ccs, fy, cmap)
            lack = [cc for cc in ccs if cc not in fins]
            if lack:
                fins.update(fin_multi(lack, fy - 1, cmap))
            for c in sorted(keep):
                cc = corp_of(c, cmap)
                if not cc:
                    continue
                f = fins.get(cc)
                y = f['fy'] if f else fy
                old_x = (hists[c][2] or {}).get('x') or {}
                if old_x.get('fy') == y and old_x.get('cc') == cc:
                    extra[c] = old_x
                else:
                    extra[c] = {'fy': y, 'cc': cc, 'dps': dividend(cc, y), 'hold': holders(cc, y)}
            fins = {c: fins[corp_of(c, cmap)] for c in uni if corp_of(c, cmap) in fins}
        except ApiError as e:
            log('DART는 이번에 건너뛰어요:', e)
            # 키 글자는 절대 찍지 않고 모양(길이)만 알려줘요. 다시 넣을 때 맞는 키인지 바로 알 수 있게.
            # 다른 키를 잘못 넣었는지도 같다/다르다만 비교해서 알려줘요.
            if re.fullmatch(r'[0-9a-fA-F]{40}', KEY_DART):
                shape = '모양은 맞아요(숫자·영어 40자). OpenDART에서 그 키가 정상(사용 중)인지 봐 주세요'
            elif KEY_FSC and KEY_DART == KEY_FSC:
                shape = '공공데이터포털 키(DATA_GO_KR_KEY)와 똑같아요. 다트 키는 OpenDART 사이트에서 따로 받는 숫자·영어 40자예요'
            elif CID and KEY_DART == CID:
                shape = '브랜드페치 Client ID와 똑같아요. 다트 키는 OpenDART 사이트에서 따로 받는 숫자·영어 40자예요'
            else:
                shape = f'{len(KEY_DART)}자이고 안에 40자 키 모양이 없어서 OpenDART 키가 아닌 것 같아요(다트 키는 숫자·영어 40자)'
            log(f'  도움말: 넣은 DART_API_KEY는 {shape}. OpenDART → 인증키 신청/관리 → 오픈API 이용현황의 키를 넣어 주세요.')
    else:
        log('DART_API_KEY가 아직 없어요. 시세와 차트만 만들어요.')

    # 4) 파일 쓰기
    def peer_row(c):
        s, f = uni.get(c) or snap.get(c) or {}, fins.get(c) or {}
        last = lambda k: (f.get(k) or [None])[-1]
        prev = lambda k: (f.get(k) or [None, None])[-2] if len(f.get(k) or []) >= 2 else None
        r1m = s.get('c') / s1m[c]['c'] - 1 if c in s1m and s1m[c].get('c') and s.get('c') else None
        r1y = s.get('c') / s1y[c]['c'] - 1 if c in s1y and s1y[c].get('c') and s.get('c') else None
        # [코드, 이름, 시가총액, 매출, 영업이익, 순이익, 자본, 1개월, 1년, 종가, 전년 매출, 전년 영업이익, 전년 순이익]
        return [c, s.get('n'), s.get('cap'), last('rev'), last('op'), last('ni'), last('eq'),
                round(r1m, 4) if r1m is not None else None, round(r1y, 4) if r1y is not None else None,
                s.get('c'), prev('rev'), prev('op'), prev('ni')]

    changed = 0
    for c in sorted(keep):
        rows, meta, old = hists[c]
        if not rows:
            continue
        s, co, f = snap[c], cos.get(c) or {}, fins.get(c)
        obj = {
            'v': 1, 'code': c, 'name': s['n'], 'mkt': s['m'], 'asof': rows[-1][0],
            'cap': s.get('cap') or meta.get('cap'), 'shares': s.get('sh') or meta.get('sh'), 'amt': s.get('amt'),
            'd': rows,
            'co': {k: co.get(k) for k in ('ceo', 'est', 'addr', 'url', 'acc')} | {'ind': ind_name(co.get('indc')), 'indc': co.get('indc')} if co else None,
            'fin': {'fy': f['fy'], 'fs': f['fs'], 'years': [f['fy'] - 2, f['fy'] - 1, f['fy']], **{k: f.get(k) for k in ACC}} if f else None,
            'x': extra.get(c) or old.get('x'),
            'peers': [peer_row(p) for p in [c] + peers_of(c, uni, cos)],
            'src': SOURCES if co else SOURCES[:1],
        }
        changed += jsave(os.path.join(OUT, c + '.json'), obj)
    for fn in os.listdir(OUT):
        m = re.fullmatch(r'([0-9A-Z]{6})\.json', fn)
        if m and m.group(1) not in keep:
            os.remove(os.path.join(OUT, fn))
            changed += 1
    items = {}
    for c in sorted(set(uni) | keep):
        s, co = snap[c], cos.get(c) or {}
        items[c] = [s['n'], s['m'], domain_of(co.get('url')), s.get('isin') or '', 1 if c in keep and hists.get(c, ([],))[0] else 0]
    body = {'asof': day_iso, 'cid': CID, 'src': SOURCES, 'items': items, 'seen': seen}
    if body != {k: old_idx.get(k) for k in body}:
        changed += jsave(idx_path, {'v': 1, 'updated': NOW.strftime('%Y-%m-%dT%H:%M:00+09:00'), **body})
    changed += jsave(co_path, cos)

    # 동료 리그 업종별 종목: 최근 종가 40개 + 1년 최저·최고 (앱이 이 파일 하나만 받아요)
    if lg_items:
        lg_out = []
        for e in lg_items:
            rows = (hists.get(e['code']) or ([],))[0]
            if not rows:
                continue
            lg_out.append({'id': e['id'], 'code': e['code'], 'n': snap[e['code']]['n'] if e['code'] in snap else e['name'], 'sec': e['sec'],
                           'icon': e['icon'], 'c': [[r[0], r[4]] for r in rows[-LG_DAYS:] if r[4]], 'y1': y1_of(rows)})
        changed += jsave(os.path.join(OUT, 'league.json'), {'v': 1, 'asof': day_iso, 'secs': lg_secs, 'items': lg_out, 'src': SOURCES[:1]})

    # 시가총액 상위 목록 (업종별 탑 5를 다시 고를 때 써요)
    top = sorted(snap, key=lambda c: -(snap[c]['cap'] or 0))[:CAPS_TOP]
    changed += jsave(os.path.join(OUT, 'caps.json'), {'v': 1, 'asof': day_iso, 'items': [[c, snap[c]['n'], snap[c]['m'], snap[c]['cap'], (cos.get(c) or {}).get('indc') or ''] for c in top]})
    log(f"끝: 바뀐 파일 {changed}개 · API 호출 금융위 {CALLS['fsc']}번 · DART {CALLS['dart']}번")
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except ApiError as e:
        log('실패:', e)
        sys.exit(1)
