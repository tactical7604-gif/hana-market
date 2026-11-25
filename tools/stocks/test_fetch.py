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
    shutil.copy(os.path.join(REPO, 'market.json'), tmp)
    try:
        # 0) 키 없음
        m = load({})
        rc, log = run(m, tmp)
        ok('키 없으면 건너뛰고 정상 종료', rc == 0 and not files(tmp) and '건너뛰어요' in log, log.strip()[:60])

        m = load({'DATA_GO_KR_KEY': FAKE_FSC, 'DART_API_KEY': FAKE_DART, 'BRANDFETCH_CLIENT_ID': 'idPublic123'})
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
        idx = json.loads(F['index.json'])
        ok('index: 기준일·Client ID·출처', idx['asof'] == '2026-11-25' and idx['cid'] == 'idPublic123' and len(idx['src']) == 2)
        sam = json.loads(F['005930.json'])
        ok('일봉 약 1년 반·오름차순·마지막 날', 360 <= len(sam['d']) <= 400 and sam['d'] == sorted(sam['d']) and sam['d'][-1][0] == '2026-11-25', f"{len(sam['d'])}개")
        ok('일봉 형식 [날짜,시,고,저,종,거래량]', all(len(r) == 6 and r[2] >= r[3] for r in sam['d']))
        ok('회사 개요', sam['co'] and sam['co']['ceo'] == '대표 005930' and sam['co']['ind'] == '통신·방송 장비' and sam['co']['est'] == '1969-01-13')
        ok('사업보고서 없으면 전년도로', sam['fin'] and sam['fin']['fy'] == 2024 and sam['fin']['fs'] == 'CFS' and sam['fin']['rev'][-1] == 3e12, json.dumps(sam['fin'])[:120])
        ok('배당(보통주)·주주(합계·우선주 빼고)', sam['x']['dps'] == 1444 and sam['x']['hold'] == [['큰회사', 8.51], ['대표님', 1.63]], json.dumps(sam['x'], ensure_ascii=False))
        ok('같은 업종 비교: 자기 자신 + 보통주만', sam['peers'][0][0] == '005930' and len(sam['peers']) >= 3 and all(p[0].endswith('0') for p in sam['peers'][1:]) and '005935' not in [p[0] for p in sam['peers']])
        ok('비교 줄: 1개월·1년 수익률 있음', all(len(p) == 9 for p in sam['peers']) and sam['peers'][0][7] is not None and sam['peers'][0][8] is not None)
        pref = [c for c, v in idx['items'].items() if v[0] == '깨끗한나라우']
        ok('우선주도 이름으로 찾고 파일 생성', pref and (pref[0] + '.json') in F)
        ok('하나금융 도메인은 적어만 둠(앱이 색 배지로)', idx['items']['086790'][2] == 'hanafn.com')
        ok('도메인 정리 (www·경로 빼기)', idx['items']['005930'][2] == 'samsung.com' and idx['items']['000660'][2] == 'skhynix.com')
        ok('index 항목 [이름,시장,도메인,ISIN,파일]', all(len(v) == 5 for v in idx['items'].values()) and idx['items']['005930'][4] == 1)
        n_files = len([f for f in F if f[0].isdigit()])
        ok('받을 종목 파일 수 (상위 40 + 시장 정보 종목)', 40 <= n_files <= 40 + len(names), f'{n_files}개')
        ok('companies.json 저장', len(json.loads(F['companies.json'])) >= n_files)

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
    finally:
        shutil.rmtree(tmp)
    print(f'\n{"❌ " + str(fails) + "개 실패" if fails else "✅ 모두 통과"}')
    return 1 if fails else 0


if __name__ == '__main__':
    sys.exit(main())
