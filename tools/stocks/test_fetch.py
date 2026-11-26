#!/usr/bin/env python3
"""fetch.py 검사: 공공데이터포털·DART를 흉내 내는 가짜 응답으로 돌려 봐요(인터넷·진짜 키 필요 없음).
python3 tools/stocks/test_fetch.py
"""
import contextlib
import datetime as dt
import importlib.util
import io
import json
import os
import shutil
import sys
import tempfile
import urllib.parse
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
FAKE_FSC, FAKE_DART = 'fsc-key/abc+def==', 'dart-key-0123456789'
fails = 0


def ok(name, cond, extra=''):
    global fails
    print(('PASS ' if cond else 'FAIL ') + name + (f' · {extra}' if extra else ''))
    fails += 0 if cond else 1


def load(env):
    os.environ.update(env)
    for k in ('DATA_GO_KR_KEY', 'DART_API_KEY', 'BRANDFETCH_CLIENT_ID'):
        if k not in env:
            os.environ.pop(k, None)
    spec = importlib.util.spec_from_file_location('fetch', os.path.join(HERE, 'fetch.py'))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    m.SLEEP = 0
    m.time.sleep = lambda s: None
    return m


class Fake:
    """가짜 거래소: 평일마다 종가가 조금씩 움직이는 종목 220개."""

    def __init__(self, names, last_day):
        self.last = last_day
        self.days = [d for d in (last_day - dt.timedelta(days=i) for i in range(800)) if d.weekday() < 5][::-1]
        base = [('005930', '삼성전자', 'KOSPI', '264', 'www.samsung.com/sec'), ('000660', 'SK하이닉스', 'KOSPI', '261', 'www.skhynix.com'),
                ('005935', '삼성전자우', 'KOSPI', '264', ''), ('086790', '하나금융지주', 'KOSPI', '649', 'www.hanafn.com')]
        self.stocks = {c: {'n': n, 'm': m, 'ind': i, 'url': u} for c, n, m, i, u in base}
        used = {s['n'] for s in self.stocks.values()}
        k = 1000
        for nm in sorted(names - used):
            k += 10
            self.stocks[f'{k:06d}'] = {'n': nm, 'm': 'KOSDAQ' if k % 20 else 'KOSPI', 'ind': '292', 'url': f'http://www.co{k}.co.kr/'}
        for i in range(220):
            c = f'{200000 + i * 10:06d}'
            self.stocks[c] = {'n': f'가짜종목{i}', 'm': 'KOSPI' if i % 3 else 'KOSDAQ', 'ind': ['261', '264', '301', '212', '649'][i % 5], 'url': f'https://fake{i}.com/ko'}
        self.fail_dart = False
        self.calls = []

    def px(self, c, d):
        seed = sum(map(ord, c))
        i = self.days.index(d)
        base = 1000 + seed * 37 % 90000
        return round(base * (1 + 0.3 * ((i * (seed % 7 + 1)) % 50) / 50))

    def item(self, c, d):
        s, p = self.stocks[c], self.px(c, d)
        return {'basDt': d.strftime('%Y%m%d'), 'srtnCd': c, 'isinCd': f'KR7{c}00{c[-1]}', 'itmsNm': s['n'], 'mrktCtg': s['m'],
                'clpr': str(p), 'vs': '0', 'fltRt': '0', 'mkp': str(p - 5), 'hipr': str(p + 20), 'lopr': str(p - 30),
                'trqu': '12345', 'trPrc': '999', 'lstgStCnt': '1000000', 'mrktTotAmt': str(p * (1000000 + sum(map(ord, c)) * 999))}

    def __call__(self, url, params):
        self.calls.append((url, dict(params)))
        if 'apis.data.go.kr' in url:
            if params.get('serviceKey') != urllib.parse.unquote(FAKE_FSC) and params.get('serviceKey') != FAKE_FSC:
                return b'<OpenAPI_ServiceResponse><cmmMsgHeader><errMsg>SERVICE ERROR</errMsg><returnAuthMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</returnAuthMsg></cmmMsgHeader></OpenAPI_ServiceResponse>'
            rows = []
            if 'basDt' in params:
                d = dt.datetime.strptime(params['basDt'], '%Y%m%d').date()
                if d in self.days:
                    rows = [self.item(c, d) for c in sorted(self.stocks)]
            elif 'likeSrtnCd' in params:
                c = params['likeSrtnCd']
                b = dt.datetime.strptime(params['beginBasDt'], '%Y%m%d').date()
                if c in self.stocks:
                    rows = [self.item(c, d) for d in reversed(self.days) if d >= b]
            n, p = int(params['numOfRows']), int(params['pageNo'])
            page = rows[(p - 1) * n:p * n]
            return json.dumps({'response': {'header': {'resultCode': '00', 'resultMsg': 'NORMAL SERVICE.'},
                                            'body': {'numOfRows': n, 'pageNo': p, 'totalCount': len(rows), 'items': {'item': page} if page else ''}}}).encode()
        if 'opendart' in url:
            if self.fail_dart or params.get('crtfc_key') != FAKE_DART:
                return json.dumps({'status': '010', 'message': '등록되지 않은 키입니다.'}).encode()
            ep = url.rsplit('/', 1)[1]
            cmap = {c: f'00{c}' for c in self.stocks if c.endswith('0')}
            if ep == 'corpCode.xml':
                xml = '<result>' + ''.join(f'<list><corp_code>{v}</corp_code><corp_name>{self.stocks[c]["n"]}</corp_name><stock_code>{c}</stock_code></list>' for c, v in cmap.items()) + \
                      '<list><corp_code>99999999</corp_code><corp_name>비상장</corp_name><stock_code> </stock_code></list></result>'
                bio = io.BytesIO()
                with zipfile.ZipFile(bio, 'w') as z:
                    z.writestr('CORPCODE.xml', xml)
                return bio.getvalue()
            rev = {v: c for c, v in cmap.items()}
            if ep == 'company.json':
                c = rev[params['corp_code']]
                s = self.stocks[c]
                return json.dumps({'status': '000', 'message': '정상', 'corp_code': params['corp_code'], 'corp_name': s['n'], 'ceo_nm': '대표 ' + c,
                                   'adres': '서울 어딘가', 'hm_url': s['url'], 'induty_code': s['ind'], 'est_dt': '19690113', 'acc_mt': '12'}).encode()
            if ep == 'fnlttMultiAcnt.json':
                year = int(params['bsns_year'])
                lst = []
                for cc in params['corp_code'].split(','):
                    c = rev[cc]
                    if c == '005930' and year == 2025:
                        continue  # 사업보고서가 아직 없다고 치고 전년도로 넘어가는지 봐요
                    for fs in ('CFS', 'OFS'):
                        for nm, v in (('매출액', 3000), ('영업이익', 300), ('당기순이익', 200), ('자산총계', 9000), ('부채총계', 4000), ('자본총계', 5000)):
                            mult = 1 if fs == 'CFS' else 0.5
                            lst.append({'stock_code': c, 'account_nm': nm, 'fs_div': fs, 'bsns_year': str(year),
                                        'thstrm_amount': f'{int(v * mult * 1e9):,}', 'frmtrm_amount': f'{int(v * mult * 0.9e9):,}', 'bfefrmtrm_amount': '-'})
                return json.dumps({'status': '000', 'message': '정상', 'list': lst}).encode()
            if ep == 'alotMatter.json':
                return json.dumps({'status': '000', 'message': '정상', 'list': [{'se': '주당액면가액(원)', 'thstrm': '100'},
                                   {'se': '주당 현금배당금(원)', 'stock_knd': '우선주', 'thstrm': '1,500'}, {'se': '주당 현금배당금(원)', 'stock_knd': '보통주', 'thstrm': '1,444'}]}).encode()
            if ep == 'hyslrSttus.json':
                return json.dumps({'status': '000', 'message': '정상', 'list': [{'nm': '큰회사', 'stock_knd': '보통주', 'trmend_posesn_stock_qota_rt': '8.51'},
                                   {'nm': '대표님', 'stock_knd': '보통주', 'trmend_posesn_stock_qota_rt': '1.63'}, {'nm': '큰회사', 'stock_knd': '우선주', 'trmend_posesn_stock_qota_rt': '0.1'},
                                   {'nm': '계', 'stock_knd': '보통주', 'trmend_posesn_stock_qota_rt': '20.1'}]}).encode()
            return json.dumps({'status': '013', 'message': '조회된 데이타가 없습니다.'}).encode()
        raise AssertionError('모르는 주소')


def run(m, root):
    out = io.StringIO()
    m.ROOT, m.OUT = root, os.path.join(root, 'stocks')
    with contextlib.redirect_stdout(out):
        try:
            rc = m.main()
        except m.ApiError as e:
            print('실패:', e)
            rc = 1
    return rc, out.getvalue()


def files(root):
    p = os.path.join(root, 'stocks')
    return {f: open(os.path.join(p, f), encoding='utf-8').read() for f in sorted(os.listdir(p))} if os.path.isdir(p) else {}


def main():
    tmp = tempfile.mkdtemp()
    # 진짜 market.json은 매일 바뀌니까(급등락 종목 등) 검사는 고정된 예시 파일로 해요
    with open(os.path.join(tmp, 'market.json'), 'w', encoding='utf-8') as f:
        json.dump({'markets': {'kospi': {'up': [{'name': '깨끗한나라우'}, {'name': '대성하이텍'}], 'down': [], 'big': [{'name': '삼성전자'}, {'name': 'SK하이닉스'}, {'name': '삼성전자우'}]},
                               'kosdaq': {'up': [{'name': '하이브'}], 'big': []}},
                   'flows': {'week': {'groups': [{'items': [['삼성전자', 1]]}]}},
                   'league': {'assets': [{'id': 'samsung', 'ref': 'kospi:삼성전자'}, {'id': 'hynix', 'ref': 'kospi:SK하이닉스'}]}}, f, ensure_ascii=False)
    os.makedirs(os.path.join(tmp, 'tools', 'stocks'), exist_ok=True)
    with open(os.path.join(tmp, 'tools', 'stocks', 'league_list.json'), 'w', encoding='utf-8') as f:
        json.dump({'secs': [['semi', '반도체·전자', '💾'], ['fin', '금융', '🏦']],
                   'items': [{'id': 'samsung', 'code': '005930', 'name': '삼성전자', 'sec': 'semi', 'icon': '📱'},
                             {'id': 'k086790', 'code': '086790', 'name': '하나금융지주', 'sec': 'fin', 'icon': '🏦'},
                             {'id': 'k999990', 'code': '999990', 'name': '없는종목', 'sec': 'fin', 'icon': '❓'},
                             {'id': 'bad id', 'code': '005380', 'name': '이름틀림', 'sec': 'fin'}]}, f, ensure_ascii=False)
    try:
        # 0) 키 없음
        m = load({})
        rc, log = run(m, tmp)
        ok('키 없으면 건너뛰고 정상 종료', rc == 0 and not files(tmp) and '건너뛰어요' in log, log.strip()[:60])

        m = load({'DATA_GO_KR_KEY': FAKE_FSC, 'DART_API_KEY': FAKE_DART, 'BRANDFETCH_CLIENT_ID': 'idPublic123'})
        m.ROOT, m.OUT = tmp, os.path.join(tmp, 'stocks')
        names = m.wanted_names()
        last = dt.date(2026, 11, 25)
        m.NOW = dt.datetime(2026, 11, 26, 14, 10, tzinfo=m.KST)
        fake = Fake(names, last)
        m.HTTP = fake
        ok('market.json에서 종목 이름 읽기', {'삼성전자', 'SK하이닉스', '깨끗한나라우', '대성하이텍', '삼성전자우', '하이브'} <= names, f'{len(names)}개')

        # 1) 첫 실행
        rc, log = run(m, tmp)
        F = files(tmp)
        ok('첫 실행 성공', rc == 0, log.strip().splitlines()[-1] if log.strip() else '')
        ok('로그에 키가 안 찍힘', FAKE_FSC not in log and FAKE_DART not in log and 'abc+def' not in log)
        fsc_urls = {c[0] for c in fake.calls if 'apis.data.go.kr' in c[0]}
        ok('시세는 새 주소(V2)로 받음', fsc_urls == {m.FSC_URLS[0]} and '_V2/getStockPriceInfo_V2' in m.FSC_URLS[0] and '새 주소(V2)' in log, str(fsc_urls))
        idx = json.loads(F['index.json'])
        ok('index: 기준일·Client ID·출처', idx['asof'] == '2026-11-25' and idx['cid'] == 'idPublic123' and len(idx['src']) == 2)
        sam = json.loads(F['005930.json'])
        ok('일봉 약 1년 반·오름차순·마지막 날', 360 <= len(sam['d']) <= 400 and sam['d'] == sorted(sam['d']) and sam['d'][-1][0] == '2026-11-25', f"{len(sam['d'])}개")
        ok('일봉 형식 [날짜,시,고,저,종,거래량]', all(len(r) == 6 and r[2] >= r[3] for r in sam['d']))
        ok('회사 개요', sam['co'] and sam['co']['ceo'] == '대표 005930' and sam['co']['ind'] == '통신·방송 장비' and sam['co']['est'] == '1969-01-13')
        ok('사업보고서 없으면 전년도로', sam['fin'] and sam['fin']['fy'] == 2024 and sam['fin']['fs'] == 'CFS' and sam['fin']['rev'][-1] == 3e12, json.dumps(sam['fin'])[:120])
        ok('배당(보통주)·주주(합계·우선주 빼고)', sam['x']['dps'] == 1444 and sam['x']['hold'] == [['큰회사', 8.51], ['대표님', 1.63]], json.dumps(sam['x'], ensure_ascii=False))
        ok('같은 업종 비교: 자기 자신 + 보통주만', sam['peers'][0][0] == '005930' and len(sam['peers']) >= 3 and all(p[0].endswith('0') for p in sam['peers'][1:]) and '005935' not in [p[0] for p in sam['peers']])
        ok('비교 줄: 1개월·1년 수익률 있음', all(len(p) == 13 for p in sam['peers']) and sam['peers'][0][7] is not None and sam['peers'][0][8] is not None)
        ok('비교 줄: 종가·전년 실적', sam['peers'][0][9] == sam['d'][-1][4] and sam['peers'][0][10] == 2.7e12 and sam['peers'][1][11] == 2.7e11, json.dumps(sam['peers'][0]))
        ok('거래대금', sam['amt'] == 999)
        pref = [c for c, v in idx['items'].items() if v[0] == '깨끗한나라우']
        ok('우선주도 이름으로 찾고 파일 생성', pref and (pref[0] + '.json') in F)
        ok('하나금융 도메인은 적어만 둠(앱이 색 배지로)', idx['items']['086790'][2] == 'hanafn.com')
        ok('도메인 정리 (www·경로 빼기)', idx['items']['005930'][2] == 'samsung.com' and idx['items']['000660'][2] == 'skhynix.com')
        ok('index 항목 [이름,시장,도메인,ISIN,파일]', all(len(v) == 5 for v in idx['items'].values()) and idx['items']['005930'][4] == 1)
        n_files = len([f for f in F if f[0].isdigit()])
        ok('받을 종목 파일 수 (상위 40 + 시장 정보 종목)', 40 <= n_files <= 40 + len(names), f'{n_files}개')
        ok('companies.json 저장', len(json.loads(F['companies.json'])) >= n_files)
        lgj = json.loads(F['league.json'])
        ok('리그 종목: 목록대로·없는 코드와 틀린 id는 빼요', [x['id'] for x in lgj['items']] == ['samsung', 'k086790'] and lgj['asof'] == '2026-11-25' and lgj['secs'][0] == ['semi', '반도체·전자', '💾'], json.dumps([x['id'] for x in lgj['items']]))
        x0 = lgj['items'][0]
        ok('리그 종목: 종가 40개·마지막 날·오름차순', len(x0['c']) == 40 and x0['c'][-1] == ['2026-11-25', sam['d'][-1][4]] and x0['c'] == sorted(x0['c']), f"{len(x0['c'])}개")
        yr = [r for r in sam['d'] if r[0] > '2025-11-25']
        ok('리그 종목: 1년 최저·최고는 1년 장중 값', x0['y1'] == {'lo': min(r[3] for r in yr), 'hi': max(r[2] for r in yr), 'd': '2026-11-25'}, json.dumps(x0['y1']))
        ok('리그 종목: 이름·업종·아이콘', x0['n'] == '삼성전자' and x0['sec'] == 'semi' and x0['icon'] == '📱' and lgj['items'][1]['n'] == '하나금융지주')
        ok('리그 종목은 받을 종목 파일도 만들어요', '086790.json' in F)
        caps = json.loads(F['caps.json'])['items']
        ok('시가총액 상위 목록: 큰 순서·250개까지', 0 < len(caps) <= 250 and all(caps[i][3] >= caps[i + 1][3] for i in range(len(caps) - 1)) and len(caps[0]) == 5, f'{len(caps)}개')

        # 2) 같은 날 다시 실행 → 바뀐 것 없음, 시세 재요청 최소
        fake.calls.clear()
        rc, log = run(m, tmp)
        ok('같은 날 다시: 파일 그대로', rc == 0 and files(tmp) == F, log.strip().splitlines()[-1])
        hist_calls = [c for c in fake.calls if 'likeSrtnCd' in c[1] and c[1]['likeSrtnCd'] != '005930']
        ok('같은 날 다시: 종목 일봉은 안 받음', not hist_calls, f'{len(hist_calls)}번')

        # 3) 다음 거래일
        fake2 = Fake(names, dt.date(2026, 11, 26))
        m.HTTP = fake2
        m.NOW = dt.datetime(2026, 11, 27, 14, 10, tzinfo=m.KST)
        rc, log = run(m, tmp)
        F2 = files(tmp)
        sam2 = json.loads(F2['005930.json'])
        new_calls = [c[1]['beginBasDt'] for c in fake2.calls if c[1].get('likeSrtnCd') == '000660']
        ok('다음 날: 하루치만 붙임', sam2['d'][-1][0] == '2026-11-26' and len(sam2['d']) in (len(sam['d']), len(sam['d']) + 1) and new_calls == ['20261126'], f'{new_calls}')
        ok('다음 날: 회사 정보는 다시 안 받음', not [c for c in fake2.calls if c[0].endswith('company.json')])

        # 4) DART 오류 → 시세만
        tmp2 = tempfile.mkdtemp()
        shutil.copy(os.path.join(REPO, 'market.json'), tmp2)
        fake3 = Fake(names, last)
        fake3.fail_dart = True
        m.HTTP, m.NOW = fake3, dt.datetime(2026, 11, 26, 14, 10, tzinfo=m.KST)
        rc, log = run(m, tmp2)
        s3 = json.loads(files(tmp2)['005930.json'])
        ok('DART 오류여도 차트는 만듦', rc == 0 and s3['d'] and s3['co'] is None and s3['fin'] is None and 'DART는 이번에 건너뛰어요' in log)
        shutil.rmtree(tmp2)

        # 5) 공공데이터 키 오류 → 실패(키는 안 찍힘)
        tmp3 = tempfile.mkdtemp()
        shutil.copy(os.path.join(REPO, 'market.json'), tmp3)
        m2 = load({'DATA_GO_KR_KEY': 'wrong-key', 'DART_API_KEY': FAKE_DART})
        m2.HTTP = Fake(names, last)
        rc, log = run(m2, tmp3)
        ok('키 오류: 실패로 끝나고 이유가 보임', rc == 1 and 'SERVICE_KEY_IS_NOT_REGISTERED_ERROR' in log and 'wrong-key' not in log, log.strip()[-80:])
        ok('키 오류: 파일 안 만듦', not [f for f in files(tmp3) if f[0].isdigit()])
        shutil.rmtree(tmp3)

        # 6) 인코딩된 키(%2B)도 받아 줌
        m3 = load({'DATA_GO_KR_KEY': urllib.parse.quote(FAKE_FSC, safe='')})
        ok('인코딩 키 정리', m3.KEY_FSC == FAKE_FSC)

        # 6-2) DART 키: 표 한 줄처럼 다른 글자와 같이 넣어도 그 안의 40자만 골라 씀(키 글자는 안 찍음)
        k40 = '0123456789abcdef0123456789abcdef01234567'
        m5 = load({'DART_API_KEY': f'1\t{k40}\t개인\t2026.11.25 정상'})
        ok('DART 키: 섞인 글자 속 40자만 골라 씀', m5.KEY_DART == k40 and bool(m5.DART_NOTE))
        m6 = load({'DART_API_KEY': k40})
        ok('DART 키: 40자는 그대로', m6.KEY_DART == k40 and not m6.DART_NOTE)
        m7 = load({'DART_API_KEY': FAKE_DART})
        ok('DART 키: 40자 모양이 없으면 그대로', m7.KEY_DART == FAKE_DART and not m7.DART_NOTE)

        class K40Fake(Fake):
            def __call__(self, url, params):
                if params.get('crtfc_key') == k40:
                    params = {**params, 'crtfc_key': FAKE_DART}
                return super().__call__(url, params)
        tmp5 = tempfile.mkdtemp()
        shutil.copy(os.path.join(REPO, 'market.json'), tmp5)
        m5.NOW = dt.datetime(2026, 11, 26, 14, 10, tzinfo=m5.KST)
        m5.KEY_FSC = FAKE_FSC
        m5.HTTP = K40Fake(names, last)
        rc, log = run(m5, tmp5)
        s5 = json.loads(files(tmp5)['005930.json'])
        ok('DART 키: 골라 쓴 키로 회사 정보까지 받음', rc == 0 and s5['co'] and '40자 키만 골라 썼어요' in log and k40 not in log, log.strip()[-80:])
        shutil.rmtree(tmp5)

        # 6-3) 다트 칸에 공공데이터포털 키를 넣으면 그렇다고 알려 줌(키 글자는 안 찍음)
        tmp6 = tempfile.mkdtemp()
        shutil.copy(os.path.join(REPO, 'market.json'), tmp6)
        m8 = load({'DATA_GO_KR_KEY': FAKE_FSC, 'DART_API_KEY': FAKE_FSC})
        m8.NOW = dt.datetime(2026, 11, 26, 14, 10, tzinfo=m8.KST)
        m8.HTTP = Fake(names, last)
        rc, log = run(m8, tmp6)
        ok('다트 칸에 공공데이터 키: 그렇다고 알려 줌', rc == 0 and '공공데이터포털 키(DATA_GO_KR_KEY)와 똑같아요' in log and FAKE_FSC not in log and 'abc+def' not in log, log.strip()[-120:])
        shutil.rmtree(tmp6)

        # 6-1) 예전에 받은 키(옛 주소에만 등록) → 옛 주소로 넘어가서 받음
        class OldKeyFake(Fake):
            def __call__(self, url, params):
                if '_V2' in url:
                    self.calls.append((url, dict(params)))
                    return b'<OpenAPI_ServiceResponse><cmmMsgHeader><errMsg>SERVICE ERROR</errMsg><returnAuthMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</returnAuthMsg><returnReasonCode>30</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>'
                return super().__call__(url, params)
        tmp4 = tempfile.mkdtemp()
        shutil.copy(os.path.join(REPO, 'market.json'), tmp4)
        m4 = load({'DATA_GO_KR_KEY': FAKE_FSC, 'DART_API_KEY': FAKE_DART})
        m4.NOW = dt.datetime(2026, 11, 26, 14, 10, tzinfo=m4.KST)
        f4 = OldKeyFake(names, last)
        m4.HTTP = f4
        rc, log = run(m4, tmp4)
        v2n = len([c for c in f4.calls if '_V2' in c[0]])
        ok('옛 키: 옛 주소로 넘어가서 성공', rc == 0 and '005930.json' in files(tmp4) and '옛 주소' in log, log.strip().splitlines()[-1] if log.strip() else '')
        ok('옛 키: 새 주소는 처음 한 번만 시도', v2n == 1, f'{v2n}번')
        shutil.rmtree(tmp4)

        # 7) 도메인 거르기·달력 개월 계산
        ok('블로그·홈페이지 빌더 주소는 도메인 비움',
           [m3.domain_of(u) for u in ('https://blog.naver.com/abc', 'abc.modoo.at', 'http://x.tistory.com/1', 'www.navercorp.com', 'http://www.samsung.com/sec')]
           == ['', '', '', 'navercorp.com', 'samsung.com'])
        D = dt.date
        ok('달력 개월 계산(말일 맞춤)', [m3.add_months(D(2026, 3, 31), -1), m3.add_months(D(2026, 11, 25), -12), m3.add_months(D(2028, 2, 29), -12), m3.add_months(D(2026, 1, 15), -1)]
           == [D(2026, 2, 28), D(2025, 11, 25), D(2027, 2, 28), D(2025, 12, 15)])
    finally:
        shutil.rmtree(tmp)
    print(f'\n{"❌ " + str(fails) + "개 실패" if fails else "✅ 모두 통과"}')
    return 1 if fails else 0


if __name__ == '__main__':
    sys.exit(main())
