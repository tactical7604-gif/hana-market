// 마켓 브리핑 v0.4.4 화면 검사 (jsdom). 서버는 hana-league 워커 코드를 가짜 KV로 그대로 돌려요.
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';
import worker from '../hana-league/worker.js';

const APP = process.argv[2] || '/home/claude/work/v044';
const REPO = '/home/claude/hana-market';
const SRV = 'https://hana-league.tactical7604.workers.dev';
let pass = 0, fail = 0;
const ok = (name, c, extra = '') => { if (c) pass++; else { fail++; console.log('FAIL', name, extra); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const realNow = Date.now.bind(Date);
let clock = null;
Date.now = () => (clock == null ? realNow() : clock);

// ---------- 가짜 서버 (워커 코드 그대로 + 메모리 KV) ----------
const store = new Map();
const env = { LG: {
  async get(k, t) { const v = store.get(k); return v == null ? null : (t === 'json' ? JSON.parse(v) : v); },
  async put(k, v) { store.set(k, v); },
  async list({ prefix }) { return { keys: [...store.keys()].filter(k => k.startsWith(prefix)).sort().map(name => ({ name })) }; },
} };
const net = { down: false, calls: [] };
async function fakeFetch(url, opt = {}) {
  url = String(url instanceof URL ? url.href : url);
  net.calls.push([(opt.method || 'GET'), url]);
  if (url.startsWith(SRV)) {
    if (net.down) throw new TypeError('Failed to fetch');
    return worker.fetch(new Request(url, { method: opt.method || 'GET', body: opt.body, headers: opt.headers }), env);
  }
  if (url.startsWith('file:')) {
    let p = decodeURIComponent(new URL(url).pathname);
    if (p.endsWith('/assets/market/market.json')) p = path.join(REPO, 'market.json');
    return fs.existsSync(p) ? new Response(fs.readFileSync(p)) : new Response('nf', { status: 404 });
  }
  const m = url.match(/raw\.githubusercontent\.com\/tactical7604-gif\/hana-market\/main\/([^?#]*)/);
  if (m) { const p = path.join(REPO, m[1]); return fs.existsSync(p) ? new Response(fs.readFileSync(p), { headers: { 'content-type': 'application/json' } }) : new Response('nf', { status: 404 }); }
  return new Response('nf', { status: 404 });
}

// ---------- 화면 준비 ----------
function makeDom(ls = {}) {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'https://falling-rice-82e7.tactical7604.workers.dev/', pretendToBeVisual: true });
  const w = dom.window;
  for (const [k, v] of Object.entries(ls)) w.localStorage.setItem(k, JSON.stringify(v));
  w.HTMLCanvasElement.prototype.getContext = () => null;
  const g = globalThis;
  const set = (k, v) => Object.defineProperty(g, k, { value: v, configurable: true, writable: true });
  for (const k of ['window', 'document', 'localStorage', 'history', 'HTMLElement', 'Node', 'Event', 'CustomEvent', 'KeyboardEvent', 'MouseEvent', 'SVGElement', 'Image', 'HTMLCanvasElement', 'location', 'DOMParser'])
    set(k, k === 'window' ? w : w[k]);
  set('navigator', w.navigator);
  set('getComputedStyle', w.getComputedStyle.bind(w));
  set('requestAnimationFrame', cb => setTimeout(() => cb(realNow()), 16));
  set('cancelAnimationFrame', id => clearTimeout(id));
  set('addEventListener', w.addEventListener.bind(w));
  set('removeEventListener', w.removeEventListener.bind(w));
  set('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  set('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} });
  w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  set('matchMedia', w.matchMedia);
  w.HTMLElement.prototype.scrollTo = function () {};
  w.HTMLElement.prototype.scrollIntoView = function () {};
  w.fetch = fakeFetch; set('fetch', fakeFetch);
  return dom;
}
const origWarn = console.warn;
console.warn = (...a) => { if (String(a[0]).includes('[market] peek')) return; origWarn(...a); };

let modSeq = 0;
async function loadApp() {
  // 매번 새 모듈로 (모듈 안 상태 초기화)
  return import(`${APP}/js/market.js?v=${++modSeq}`);
}
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const txt = el => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
const btn = (label, root = document) => $$('button', root).find(b => txt(b).includes(label));
const play = () => JSON.parse(localStorage.getItem('hanafam.market.play') || 'null');
async function settle(ms = 120) { for (let i = 0; i < 6; i++) await sleep(ms / 6); }

// ======================= 1) 새 폰: 이 폰 주인 고르기 → 담기 → 서버 저장 =======================
{
  makeDom({ 'hanafam.me': 'sanggyeong' });
  const M = await loadApp();
  M.openMarket('league');
  await settle(300);
  const pane = $('.mk-pane');
  ok('패널이 열리고 동료 리그 탭', !!pane && txt($('.mk-tab.on')) === '동료 리그', txt($('.mk-tab.on')));
  ok('처음엔 이 폰 주인 고르기가 보여요', txt(pane).includes('이 폰은 누구 거예요?'));
  ok('게임에서 고른 내 캐릭터(상경)를 추천 표시', !!$('.mk-mepick .wb.sug'));
  ok('주인 고르기 전엔 담기 버튼이 없어요', !btn('이대로 담기') && txt(pane).includes('아직 담은 게 없어요'));
  ok('서버에서 모두의 기록을 받았어요(빈 서버)', net.calls.some(c => c[1] === SRV + '/v1/all'));
  ok('업종 종목 파일을 받았어요', net.calls.some(c => c[1].endsWith('/stocks/league.json')));
  // 고르기
  const face = $$('.mk-mepick .wb').find(b => txt(b).includes('상경'));
  face.click(); await settle();
  ok('맞아요? 확인이 떠요', txt($('.mk-pane')).includes('상경님 맞아요?'));
  btn('네, 저예요').click(); await settle(200);
  ok('이 폰 주인이 저장돼요', JSON.parse(localStorage.getItem('hanafam.market.me')) === 'sanggyeong');
  ok('주인 표시가 보여요', txt($('.mk-whoft')).includes('상경님 폰이에요'));
  const secs = $$('.lg-sec');
  ok('바구니가 업종 6개로 접혀요', secs.length === 6, String(secs.length));
  ok('업종 이름들', ['반도체·전자', '자동차', '금융', '바이오', '2차전지', '인터넷·게임'].every(n => secs.some(s => txt(s.querySelector('summary')).includes(n))), secs.map(s => txt(s.querySelector('summary'))).join('|'));
  ok('기본 묶음(지수·미국·금·달러)이 맨 앞', txt($('.lg-sech')).includes('지수·미국·금·달러'));
  const rows = $$('.lg-ed .lg-a');
  ok('종목은 36개(기본 6 + 업종 30)', rows.length === 36, String(rows.length));
  ok('삼성전자는 한 번만(반도체 안에)', rows.filter(r => txt(r.querySelector('.nm b')) === '삼성전자').length === 1);
  ok('업종 종목에 로고가 붙어요', $$('.lg-sec .lg-a .sk-logo').length === 30, String($$('.lg-sec .lg-a .sk-logo').length));
  // 담기: 자동차 열기 → 현대차 +3, 반도체 → 삼성전자 +2
  const auto = secs.find(s => txt(s.querySelector('summary')).includes('자동차'));
  auto.open = true;
  const rowOf = name => $$('.lg-ed .lg-a').find(r => txt(r.querySelector('.nm b')) === name);
  for (let i = 0; i < 3; i++) btn('+', rowOf('현대차')).click();
  for (let i = 0; i < 2; i++) btn('+', rowOf('삼성전자')).click();
  ok('담은 비율이 보여요', txt(rowOf('현대차').querySelector('.lg-stp')).includes('30%') && txt(rowOf('삼성전자').querySelector('.lg-stp')).includes('20%'));
  ok('업종 머리에 담은 비율', txt($$('.lg-sec').find(s => txt(s.querySelector('summary')).includes('자동차')).querySelector('.sc')).includes('30% 담음'));
  btn('이대로 담기').click(); await settle(250);
  const p1 = play();
  const mine = p1.pl.sanggyeong;
  ok('이 폰에 저장(내 것)', mine && mine.src === 'mine' && mine.lg.length === 1 && mine.lg[0][1].k005380 === 3 && mine.lg[0][1].samsung === 2, JSON.stringify(mine));
  const s1 = JSON.parse(store.get('p:sanggyeong') || 'null');
  ok('서버에도 저장', s1 && s1.lg.length === 1 && s1.lg[0][1].k005380 === 3 && s1.at === mine.at, JSON.stringify(s1));
  ok('순위에 상경이 체결 기다리는 중', txt($('.lg-rk')).includes('상경') && txt($('.lg-rk')).includes('첫 체결 기다리는 중'));
  ok('체결 기다리는 안내에 업종 종목 오후 2시 설명', txt($('.lg-pend')).includes('오후 2시'));
  ok('순위 머리에 업종 종목 기준일', txt($('.lg-rk')).includes('업종별 종목은 11/25 종가까지'));
  ok('동기화 카드', txt($('.mk-share')).includes('기록은 자동으로 모여요') && !txt($('.mk-share')).includes('HANA1'));
  ok('코드 주고받기 상자는 없어요', !$('.sh-txt'));

  // 다른 폰(경민)이 담은 기록이 서버에 생김 → 다시 받기
  await worker.fetch(new Request(SRV + '/v1/p/gyeongmin', { method: 'PUT', body: JSON.stringify({ at: Math.floor(Date.now() / 1000), pr: {}, lg: [[Math.floor(Date.now() / 1000) - 5, { k035420: 5, k086790: 5 }]] }) }), env);
  btn('지금 다시 받기').click(); await settle(300);
  ok('경민 기록이 순위에 떠요', txt($('.lg-rk')).includes('경민'));
  // 경민 얼굴 누르기 → 보기만
  $$('.mk-who .wb').find(b => txt(b).includes('경민')).click(); await settle();
  ok('남의 기록은 보기만 안내', txt($('.mk-got')).includes('경민님 기록이에요') && txt($('.mk-got')).includes('보기만'));
  const roRows = $$('.lg-ed .lg-a');
  ok('남의 바구니는 담은 것만(NAVER·하나금융) 버튼 없이', roRows.length === 2 && !$('.lg-ed .lg-stp button') && roRows.some(r => txt(r).includes('NAVER')), String(roRows.length));
  ok('남의 바구니엔 담기 버튼 없음', !btn('이대로 담기') && !btn('바꾸기'));
  btn('내(상경) 기록 보기').click(); await settle();
  ok('내 기록으로 돌아와요', txt($('.lg-me')).includes('상경의 바구니'));
  // 사람 모형: 담은 종목 칩 + 다른 종목 고르기
  const body = $('.lg-body');
  ok('사람 모형 카드', !!body);
  const chips = $$('.lg-bchips .mk-chip', body).map(txt);
  ok('사람 모형 칩: 아직 체결 전이라 고른 종목 하나만', chips.length === 1, chips.join('|'));
  const sel = $('.lg-bsel', body);
  ok('다른 종목 고르기 상자(업종별)', !!sel && $$('optgroup', sel).length === 7, sel ? String($$('optgroup', sel).length) : 'none');
  sel.value = 'k373220'; sel.dispatchEvent(new window.Event('change')); await settle();
  ok('고른 종목(LG에너지솔루션) 모형으로 바뀜', txt($('.lg-body .lg-bsum')).includes('지금은') && $$('.lg-bchips .mk-chip.on').some(c => txt(c).includes('LG에너지솔루션')));

  // 맞혀봐: 고르면 서버로
  $$('.mk-tab').find(b => txt(b).includes('이번 주 맞혀봐')).click(); await settle(200);
  const q = $$('.pd-q').find(x => txt(x).includes('나스닥'));
  const opt = q && $$('.pd-opt', q).find(b => !b.disabled);
  ok('맞혀봐 열린 문제 고르기 가능', !!opt);
  opt.click(); await settle(250);
  const s2 = JSON.parse(store.get('p:sanggyeong'));
  ok('맞혀봐 고른 답이 서버에', s2.pr['2026-11-23'] && s2.pr['2026-11-23']['ndq-24000'], JSON.stringify(s2.pr));
  ok('바구니 기록은 그대로', s2.lg.length === 1 && s2.rev === 2, JSON.stringify({rev: s2.rev, lg: s2.lg.length, hist: [...store.keys()].filter(k => k.startsWith('h:sanggyeong')), calls: net.calls.filter(c => c[0] === 'PUT').map(c => c[1].slice(-20))}));
  // 닫기
  btn('‹') && btn('‹').click();
  await settle();
}

// ======================= 2) 예전 폰: 아름 칸에 잘못 담은 기록 정리 =======================
{
  const t0 = Math.floor(realNow() / 1000) - 86400;
  makeDom({ 'hanafam.me': 'areum', 'hanafam.market.play': { pl: { areum: { src: 'local', pr: {}, lg: [[t0, { samsung: 5 }]] } }, res: {}, act: 'areum' } });
  const M = await loadApp();
  M.openMarket('league');
  await settle(300);
  ok('[예전 폰] 주인 고르기 전엔 이 폰에 있던 아름 기록이 보여요', txt($('.lg-rk')).includes('아름'));
  ok('[예전 폰] 서버의 상경·경민 기록도 보여요', txt($('.lg-rk')).includes('상경') && txt($('.lg-rk')).includes('경민'));
  $$('.mk-mepick .wb').find(b => txt(b).includes('상경')).click(); await settle();
  btn('네, 저예요').click(); await settle(300);
  const p = play();
  ok('[예전 폰] 서버에 없는 아름 기록은 화면에서 빠지고 보관만', !p.pl.areum && p.old && p.old.areum && p.old.areum.lg[0][1].samsung === 5, JSON.stringify(p));
  ok('[예전 폰] 아름 기록은 서버로 안 보내요', !store.get('p:areum'));
  ok('[예전 폰] 상경 기록은 서버 것으로', p.pl.sanggyeong && p.pl.sanggyeong.lg[0][1].k005380 === 3);
  ok('[예전 폰] 순위에서 아름 사라짐', !txt($('.lg-rk')).includes('아름'));
}

// ======================= 3) 인터넷 끊김 → 저장은 폰에, 연결되면 다시 보내기 =======================
{
  makeDom({ 'hanafam.market.me': 'dahye' });
  net.down = true;
  const M = await loadApp();
  M.openMarket('league');
  await settle(300);
  ok('[끊김] 서버 연결 실패 안내', txt($('.mk-share')).includes('서버에 연결하지 못했어요'));
  const rowOf = name => $$('.lg-ed .lg-a').find(r => txt(r.querySelector('.nm b')) === name);
  for (let i = 0; i < 4; i++) btn('+', rowOf('금')).click();
  btn('이대로 담기').click(); await settle(300);
  ok('[끊김] 폰에는 저장', play().pl.dahye && play().pl.dahye.lg.length === 1);
  ok('[끊김] 못 보냈다는 안내', txt($('.mk-share')).includes('아직 못 보냈어요'));
  net.down = false;
  btn('지금 다시 받기').click(); await settle(400);
  const sv = JSON.parse(store.get('p:dahye') || 'null');
  ok('[다시 연결] 서버로 보내짐', sv && sv.lg[0][1].gold === 4, JSON.stringify(sv));
  ok('[다시 연결] 안내가 정상으로', txt($('.mk-share')).includes('모두의 기록을 받았어요'));
}

// ======================= 4) 같은 사람 두 폰: 더 나중에 바꾼 쪽이 이겨요 =======================
{
  const old = Math.floor(realNow() / 1000) - 3600;
  makeDom({ 'hanafam.market.me': 'sanggyeong', 'hanafam.market.play': { pl: { sanggyeong: { src: 'mine', at: old, pr: {}, lg: [[old, { usd: 10 }]] } }, res: {} } });
  const M = await loadApp();
  M.openMarket('league');
  await settle(300);
  const p = play();
  ok('[두 폰] 서버의 더 새 기록으로 맞춰요', p.pl.sanggyeong.lg[0][1].k005380 === 3 && !p.pl.sanggyeong.lg[0][1].usd, JSON.stringify(p.pl.sanggyeong));
  ok('[두 폰] 옛 기록이 서버를 덮어쓰지 않아요', JSON.parse(store.get('p:sanggyeong')).lg[0][1].k005380 === 3);
}

// ======================= 5) 업종 종목도 수익률 계산에 들어가요 =======================
{
  // 11/20(목) 10시에 담았다고 치면 11/20 종가에 체결 → 이번 주(11/23~) 수익률이 생겨요
  store.delete('p:gyeongho');
  const M = await loadApp();
  makeDom({ 'hanafam.market.me': 'gyeongho' });
  clock = Date.parse('2026-11-20T10:00:00+09:00');
  M.openMarket('league');
  await settle(300);
  const rowOf = name => $$('.lg-ed .lg-a').find(r => txt(r.querySelector('.nm b')) === name);
  for (let i = 0; i < 10; i++) btn('+', rowOf('하나금융지주')).click();
  btn('이대로 담기').click(); await settle(300);
  btn('‹').click(); await settle(300);
  clock = null;
  const M2 = await loadApp();
  makeDom({ 'hanafam.market.me': 'gyeongho', 'hanafam.market.play': play() });
  M2.openMarket('league');
  await settle(300);
  const L = JSON.parse(fs.readFileSync(path.join(REPO, 'stocks/league.json'), 'utf8')).items.find(x => x.id === 'k086790').c;
  const v = d => (L.find(x => x[0] === d) || [])[1];
  // 이번 주 시작 = 11/20 종가(금 11/21? → 주 시작 전 마지막 종가), 끝 = 11/25 종가
  const prevClose = L.filter(x => x[0] < '2026-11-23').slice(-1)[0][1];
  const expect = v('2026-11-25') / prevClose - 1;
  const row = $$('.lg-rk li').find(li => txt(li).includes('경호'));
  const shown = row ? txt(row.querySelector('.sc')) : '';
  const num = parseFloat(shown.replace('−', '-').replace('+', '').replace('%', ''));
  ok('업종 종목(하나금융지주) 이번 주 수익률 계산', row && Math.abs(num - expect * 100) < 0.02, `${shown} vs ${(expect * 100).toFixed(2)}%`);
}


// ======================= 6) 다른 탭들도 그대로 그려져요 =======================
{
  makeDom({ 'hanafam.market.me': 'sanggyeong' });
  const M = await loadApp();
  M.openMarket('movers');
  await settle(300);
  const names = $$('.mk-tab').map(b => txt(b).replace(/N$/, ''));
  const bad = [];
  for (const b of $$('.mk-tab')) { b.click(); await settle(60); if (txt($('.mk-pane')).includes('문제가 생겼어요') || !txt($('.mk-pane'))) bad.push(txt(b)); }
  ok('14개 탭이 모두 오류 없이 그려져요', names.length === 14 && !bad.length, `${names.length} ${bad.join(',')}`);
}

console.log(`\n통과 ${pass} · 실패 ${fail}`);
process.exit(fail ? 1 : 0);
