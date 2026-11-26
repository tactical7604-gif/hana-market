// 마켓 브리핑: 홈 화면 타일 + 전체 화면 패널. 카드 위엔 캐릭터들이 상체만 걸치고 한마디(매달린 캐릭터). (탭 14개: 시장 정보 + 이번 주 맞혀봐·동료 리그 놀이, 종목 화면: 차트·회사 정보·경쟁사 비교)
// 공용 파일(app.js, app.css, audio.js, util.js)은 건드리지 않아요. app.js는 marketTile()만 불러서 홈 빈칸에 넣어요.
// 데이터: 게임에 들어 있는 market.json → 저장소(remote)에 더 새 파일이 있으면 그걸 받아서 씀(localStorage에 보관).
// 동료 리그 업종별 30종목: 저장소 stocks/league.json. 동료들 기록: 서버(hana-league 워커)에 자동으로 모아요(v0.4.4).

const BUNDLED = new URL('../assets/market/market.json', 'https://falling-rice-82e7.tactical7604.workers.dev/js/market.js').href;
const CSS_HREF = new URL('../css/market.css', 'https://falling-rice-82e7.tactical7604.workers.dev/js/market.js').href;
const DEFAULT_REMOTE = 'https://raw.githubusercontent.com/tactical7604-gif/hana-market/main/market.json';
const LS_KEY = 'hanafam.market';
const NS = 'http://www.w3.org/2000/svg';
const MKTS = [['kospi', '코스피'], ['kosdaq', '코스닥'], ['nasdaq', '나스닥']];
const TABS = [['movers', '급등락'], ['must', '놓치면 안 될 정보'], ['brokers', '증권사 전망'], ['kr', '국내 뉴스'], ['global', '해외 뉴스'], ['flows', '돈의 흐름'],
  ['chain', '연결고리'], ['wallet', '내 지갑'], ['whatif', '만약에'], ['words', '용어 풀이'], ['quiz', '퀴즈'], ['predict', '이번 주 맞혀봐'], ['league', '동료 리그'], ['ask', '물어보면']];
// 데이터에 내용이 있을 때만 보이는 탭 (예전 데이터를 받아도 빈 탭이 생기지 않게)
const NEED = {
  chain: d => !!(d.chain && Array.isArray(d.chain.items) && d.chain.items.length),
  wallet: d => !!(d.wallet && ((d.wallet.items || []).length || (d.wallet.fx || []).length)),
  words: d => !!(d.words && Array.isArray(d.words.items) && d.words.items.length),
  quiz: d => !!(d.quiz && Array.isArray(d.quiz.items) && d.quiz.items.length),
  ask: d => !!(d.ask && Array.isArray(d.ask.items) && d.ask.items.length),
  predict: d => !!(d.predict && pdItems(d.predict.items).length),
  league: d => lgAssets(d).length >= 2,
};
const NEW_TABS = ['chain', 'wallet', 'whatif', 'words', 'quiz', 'predict', 'league', 'ask'];
const SEEN_KEY = 'hanafam.market.seen', QUIZ_KEY = 'hanafam.market.quiz', WATCH_KEY = 'hanafam.market.watch';
const WD = '일월화수목금토';

let data = null;
let loadP = null;
let lastRemote = 0;
let audioP = null;
let panel = null;
let gradSeq = 0;
const tiles = new Set();
const ui = { tab: 'movers', mkt: 'kospi', side: 'up', br: 'kr', flow: 'kospi', fxCur: 'USD', fxAmt: {}, loan: 30000, dr: 0.25, wfMkt: 'kospi', wfStart: null, wfAmt: 1000000, wcat: '전체', lgView: 'cur', lgDraft: null, lgBody: null, lgOpen: {}, mePick: null, meAsk: false };

/* ---------- 작은 도우미 ---------- */
function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'style') e.style.cssText = v;
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c)));
  return e;
}
function sv(tag, attrs, ...kids) {
  const e = document.createElementNS(NS, tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) if (v != null && v !== false) e.setAttribute(k, v);
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c)));
  return e;
}
const fin = Number.isFinite;
const nf = (v, d = 2) => Number(v).toLocaleString('ko-KR', { minimumFractionDigits: d, maximumFractionDigits: d });
const dirOf = x => (x > 0 ? 'up' : x < 0 ? 'dn' : 'eq');
const arrow = x => (x > 0 ? '▲' : x < 0 ? '▼' : '');
const signed = (x, d = 2) => (x > 0 ? '+' : x < 0 ? '−' : '') + nf(Math.abs(x), d);
const pctStr = p => signed(p) + '%';
const priceStr = (v, cur) => (cur === '$' ? '$' + nf(v, 2) : nf(v, 0) + '원');
function eok(v, jo) { const a = Math.abs(v), s = v > 0 ? '+' : v < 0 ? '−' : ''; return (jo ?? a >= 10000) ? s + nf(a / 10000, 1) + '조' : s + nf(a, 0) + '억'; }
const useJo = vals => { const a = vals.filter(fin).map(Math.abs).filter(x => x > 0); return a.length > 0 && Math.min(...a) >= 10000; };
function mdw(iso) { const [y, m, d] = String(iso).split('-').map(Number); if (!d) return String(iso); return `${m}/${d}(${WD[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]})`; }
const md = iso => { const [, m, d] = String(iso).split('-').map(Number); return d ? `${m}/${d}` : String(iso); };
function updStr(iso) {
  const t = Date.parse(iso); if (!fin(t)) return '';
  const k = new Date(t + 9 * 3600e3), p = n => String(n).padStart(2, '0');
  return `${k.getUTCMonth() + 1}/${k.getUTCDate()}(${WD[k.getUTCDay()]}) ${p(k.getUTCHours())}:${p(k.getUTCMinutes())}`;
}
const toneWord = t => (t <= -1.5 ? '매우 비관' : t <= -0.5 ? '신중' : t < 0.5 ? '중립' : t < 1.5 ? '낙관' : '매우 낙관');
const tonePos = t => ((Math.max(-2, Math.min(2, Number(t) || 0)) + 2) / 4) * 100;
const TONE_COLS = ['#4d8dff', '#2c4f86', '#3a4a49', '#8a3a33', '#ff6150'];
const toneColor = t => ((Number(t) || 0) > 0.25 ? 'var(--mk-up)' : (Number(t) || 0) < -0.25 ? 'var(--mk-dn)' : 'var(--mk-mute)');
function niceTicks(lo, hi, n = 4) {
  const span = hi - lo; if (!(span > 0)) return [lo];
  const raw = span / n, mag = 10 ** Math.floor(Math.log10(raw)), f = raw / mag;
  const step = (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * mag;
  const out = []; for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(6));
  return out;
}
function click() {
  try { if (!audioP) audioP = import('https://falling-rice-82e7.tactical7604.workers.dev/js/audio.js'); audioP.then(m => m && m.sfx && m.sfx('click')).catch(() => {}); } catch { /* 소리 없이 진행 */ }
}
function ensureCss() {
  if (document.getElementById('mk-css')) return;
  const l = document.createElement('link'); l.id = 'mk-css'; l.rel = 'stylesheet'; l.href = CSS_HREF; document.head.append(l);
}
if (typeof document !== 'undefined') ensureCss();

/* ---------- 데이터 ---------- */
function valid(d) {
  return !!d && typeof d === 'object' && d.v === 1 && typeof d.updated === 'string' && fin(Date.parse(d.updated)) && !!d.markets &&
    MKTS.every(([k]) => d.markets[k] && Array.isArray(d.markets[k].series) && fin(d.markets[k].value));
}
const ts = d => Date.parse(d.updated) || 0;
function ready() {
  if (!loadP) loadP = (async () => {
    let best = null;
    try { const c = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); if (valid(c)) best = c; } catch { /* 저장소 못 씀 */ }
    try { const r = await fetch(BUNDLED); if (r.ok) { const b = await r.json(); if (valid(b) && (!best || ts(b) >= ts(best))) best = b; } } catch { /* 내장 파일 실패 */ }
    if (best && !data) data = best;
    return data;
  })();
  return loadP;
}
async function fetchRemote(url, base) {
  if (!/^https:\/\//.test(url || '')) return null;
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), 4000) : 0;
  try {
    const r = await fetch(url, { cache: 'no-store', credentials: 'omit', signal: ctl ? ctl.signal : undefined });
    if (!r.ok) return null;
    const d = await r.json();
    if (!valid(d) || (base && ts(d) <= ts(base))) return null;
    try { localStorage.setItem(LS_KEY, JSON.stringify(d)); } catch { /* 보관 실패는 무시 */ }
    return d;
  } catch { return null; } finally { if (timer) clearTimeout(timer); }
}
async function refresh(force) {
  const now = Date.now();
  if (!force && now - lastRemote < 5 * 60e3) return;
  lastRemote = now;
  const base = await ready();
  const url = (base && typeof base.remote === 'string' && base.remote) || DEFAULT_REMOTE;
  const fresh = await fetchRemote(url, base);
  if (!fresh) return;
  if (panel && data && panel.shown) { panel.pending = fresh; panel.fresh.hidden = false; }
  else { data = fresh; if (panel) renderAll(); }
  updateTiles(fresh);
}

/* ---------- 홈 타일 ---------- */
function spark(series, w = 40, ht = 16) {
  const vals = (series || []).map(x => (Array.isArray(x) ? x[1] : NaN)).filter(fin);
  const svg = sv('svg', { viewBox: `0 0 ${w} ${ht}`, preserveAspectRatio: 'none', 'aria-hidden': 'true', focusable: 'false' });
  if (vals.length < 2) return svg;
  const lo = Math.min(...vals), r = Math.max(...vals) - lo || 1;
  const pts = vals.map((v, i) => `${(1 + i / (vals.length - 1) * (w - 2)).toFixed(2)},${(ht - 2 - (v - lo) / r * (ht - 4)).toFixed(2)}`).join(' ');
  svg.append(sv('polyline', { points: pts, fill: 'none', stroke: 'var(--mk-teal)', 'stroke-width': 1.5, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', 'vector-effect': 'non-scaling-stroke' }));
  return svg;
}
function fillTile(tile, d) {
  const rows = tile.querySelector('.mk-tl-rows'), small = tile.querySelector('small');
  if (!rows || !small) return;
  rows.textContent = '';
  if (!d) { rows.append(h('div', { class: 'mk-tl-row' }, h('span', { style: 'grid-column:1/-1' }, '정보를 불러오지 못했어요'))); return; }
  const said = [];
  for (const [id, nm] of MKTS) {
    const m = d.markets[id]; if (!m) continue;
    rows.append(h('div', { class: 'mk-tl-row' }, h('span', {}, nm), spark(m.series, 60, 14), h('em', { class: dirOf(m.pct) }, `${arrow(m.pct)}${nf(Math.abs(m.pct))}%`)));
    said.push(`${nm} ${m.pct > 0 ? '상승' : m.pct < 0 ? '하락' : '보합'} ${nf(Math.abs(m.pct))}%`);
  }
  small.textContent = `${md(d.asof && d.asof.kr || '')} 마감 · 급등락·수급`;
  tile.setAttribute('aria-label', `마켓 브리핑 열기. ${said.join(', ')}`);
  tile.querySelector('.mk-tl-new')?.remove();
  if (Date.now() - ts(d) < 18 * 3600e3) tile.append(h('i', { class: 'mk-tl-new', 'aria-hidden': 'true' }));
}
function updateTiles(d) { for (const t of [...tiles]) { if (!t.isConnected) { tiles.delete(t); continue; } try { fillTile(t, d || data); } catch { /* 타일 오류 무시 */ } } }

export function marketTile() {
  ensureCss();
  const tile = h('button', { class: 'gtile mk-tile', type: 'button', 'aria-label': '마켓 브리핑 열기' },
    h('div', { class: 'mk-tl-rows' }, [0, 1, 2].map(() => h('div', { class: 'mk-tl-skel' }))),
    h('div', {}, h('b', {}, '마켓 브리핑'), h('small', {}, '급등락·뉴스·수급')));
  tile.addEventListener('click', () => { click(); openMarket(); });
  tiles.add(tile);
  ready().then(d => { fillTile(tile, d); refresh(); });
  return tile;
}

/* ---------- 패널 열기/닫기 ---------- */
export function openMarket(tab) {
  if (panel) return;
  ensureCss();
  loadChars();
  if (tab && TABS.some(([id]) => id === tab)) ui.tab = tab;
  const back = h('button', { class: 'mk-back', type: 'button', 'aria-label': '닫기' }, '‹');
  const sub = h('small', {}, '불러오는 중…');
  const fresh = h('button', { class: 'mk-fresh', type: 'button', hidden: true }, '새 정보 보기');
  const body = h('div', { class: 'mk-body' });
  const root = h('div', { class: 'mk', role: 'dialog', 'aria-modal': 'true', 'aria-label': '마켓 브리핑' },
    h('header', { class: 'mk-top' }, back, h('div', { class: 'mk-ttl' }, h('b', {}, '마켓 브리핑'), sub), fresh), body);
  panel = { root, body, sub, fresh, tabs: null, pane: null, off: null, onPop: null, pending: null, shown: false, ros: [], prevFocus: document.activeElement };
  back.addEventListener('click', () => { click(); closeByButton(); });
  fresh.addEventListener('click', () => {
    click();
    if (!panel || !panel.pending) return;
    data = panel.pending; panel.pending = null; fresh.hidden = true; renderAll(); updateTiles(data);
  });
  root.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); closeByButton(); } });
  document.body.append(root);

  const hb = window.hanaBack;
  if (hb && typeof hb.push === 'function') {
    try { const o = hb.push(() => { if (panel) panel.off = null; close(); }); panel.off = typeof o === 'function' ? o : null; } catch { /* 뒤로가기 연결 실패 */ }
  } else {
    try {
      history.pushState({ mkPanel: 1 }, '');
      panel.onPop = () => { if (panel) panel.onPop = null; close(); };
      addEventListener('popstate', panel.onPop);
    } catch { /* 기록 못 씀 */ }
  }
  try { back.focus({ preventScroll: true }); } catch { /* 무시 */ }
  stkPrime();
  if (data) renderAll();
  else {
    body.append(h('div', { class: 'mk-load' }, '불러오는 중…'));
    ready().then(d => { if (!panel) return; if (d) renderAll(); else renderFail(); });
  }
  refresh();
  const had = stk.idx;
  ready().then(() => stkLoad()).then(x => { if (panel && panel.shown && x && x !== had && !skView && (ui.tab === 'movers' || ui.tab === 'flows')) renderPane(false); });
  lgxPrime();
  ready().then(() => lgxLoad()).then(ch => { if (ch) srvRerender(); });
  srvPull(false).then(ch => { if (ch) srvRerender(); });
}
function closeByButton() {
  const p = panel; if (!p) return;
  if (p.off) { const o = p.off; p.off = null; try { o(); } catch { /* 무시 */ } }
  else if (p.onPop) {
    removeEventListener('popstate', p.onPop); p.onPop = null;
    try { if (history.state && history.state.mkPanel) history.back(); } catch { /* 무시 */ }
  }
  close();
}
function close() {
  const p = panel; if (!p) return;
  if (skView) { const v = skView; skView = null; if (v.off) { try { v.off(); } catch { /* 무시 */ } } v.ros.forEach(r => r.disconnect()); }
  panel = null;
  pkStop();
  if (p.onPop) { removeEventListener('popstate', p.onPop); p.onPop = null; }
  if (p.pending) data = p.pending;
  p.ros.forEach(r => r.disconnect());
  p.root.classList.add('mk-out');
  let gone = false; const done = () => { if (!gone) { gone = true; p.root.remove(); } };
  p.root.addEventListener('animationend', done, { once: true });
  setTimeout(done, 260);
  try { if (p.prevFocus && p.prevFocus.isConnected) p.prevFocus.focus({ preventScroll: true }); } catch { /* 무시 */ }
}
function renderFail() {
  const p = panel; if (!p) return;
  p.sub.textContent = '';
  p.body.textContent = '';
  const retry = h('button', { type: 'button' }, '다시 불러오기');
  retry.addEventListener('click', () => { click(); loadP = null; p.body.textContent = ''; p.body.append(h('div', { class: 'mk-load' }, '불러오는 중…')); ready().then(d => { if (panel !== p) return; if (d) renderAll(); else refresh(true).then(() => { if (panel === p && !data) renderFail(); }); }); });
  p.body.append(h('div', { class: 'mk-load' }, '시장 정보를 불러오지 못했어요.', h('br'), '인터넷 연결을 확인해 주세요.', h('br'), retry));
}

/* ---------- 패널 그리기 ---------- */
function renderAll() {
  const p = panel, d = data; if (!p || !d) return;
  p.shown = true;
  p.sub.textContent = d.asofLabel || '';
  p.ros.forEach(r => r.disconnect()); p.ros = [];
  p.body.textContent = '';
  const tabs = TABS.filter(([id]) => !NEED[id] || NEED[id](d));
  if (!tabs.some(([id]) => id === ui.tab)) ui.tab = 'movers';
  const seen = seenSet();
  p.tabs = h('nav', { class: 'mk-tabs', role: 'tablist', 'aria-label': '마켓 브리핑 메뉴' }, tabs.map(([id, label]) =>
    h('button', { class: 'mk-tab', type: 'button', role: 'tab', 'data-id': id, onclick: () => { if (ui.tab === id) return; click(); ui.tab = id; renderPane(true); } },
      label, NEW_TABS.includes(id) && !seen.has(id) ? h('i', { class: 'mk-new', 'aria-label': '새 메뉴' }, 'N') : null)));
  p.pane = h('section', { class: 'mk-pane', role: 'tabpanel' });
  p.body.append(tape(d), headline(d), p.tabs, p.pane, foot(d));
  renderPane(false);
  try { pkAttach(p.body); } catch (e) { console.warn('[market] peek', e); }
}
function renderPane(scrollToTabs) {
  const p = panel, d = data; if (!p || !d || !p.pane) return;
  p.ros.forEach(r => r.disconnect()); p.ros = [];
  const pane = p.pane, body = p.body, nav = p.tabs;
  const tabsH = nav.offsetHeight, paneTop = pane.offsetTop - body.offsetTop;
  const pin = scrollToTabs && body.scrollTop > paneTop - tabsH; // 탭 아래까지 내려가 있었으면 새 탭의 맨 처음을 보여줌
  pane.style.minHeight = pane.offsetHeight + 'px'; // 내용을 바꾸는 동안 높이를 붙잡아서 스크롤이 맨 위로 튀지 않게
  pane.textContent = '';
  const fn = { movers: paneMovers, must: paneMust, brokers: paneBrokers, kr: paneKR, global: paneGlobal, flows: paneFlows,
    chain: paneChain, wallet: paneWallet, whatif: paneWhatif, words: paneWords, quiz: paneQuiz, predict: panePredict, league: paneLeague, ask: paneAsk }[ui.tab] || paneMovers;
  try { pane.append(...[fn(d)].flat(Infinity).filter(x => x != null && x !== false)); }
  catch (e) { pane.textContent = ''; pane.append(h('div', { class: 'mk-list' }, h('div', { class: 'mk-empty' }, '이 탭 정보를 보여주다가 문제가 생겼어요.'))); console.warn('[market]', e); }
  try { pkAttach(pane); } catch (e) { console.warn('[market] peek', e); }
  pane.style.animation = 'none'; void pane.offsetWidth; pane.style.animation = '';
  pane.style.minHeight = '';
  if (pin) body.scrollTop = paneTop - tabsH;
  for (const b of nav.querySelectorAll('.mk-tab')) {
    const on = b.dataset.id === ui.tab; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on));
    const nb = on && b.querySelector('.mk-new'); if (nb) { nb.remove(); markSeen(ui.tab); }
    if (on && scrollToTabs) {
      const left = Math.max(0, b.offsetLeft - (nav.clientWidth - b.offsetWidth) / 2);
      try { nav.scrollTo({ left, behavior: 'smooth' }); } catch { nav.scrollLeft = left; }
    }
  }
}
function fmtTick(t) {
  if (t.unit === '%') return nf(t.value, 2) + '%';
  if (t.unit === '$') return '$' + nf(t.value, 2);
  if (t.unit === '원') return nf(t.value, fin(t.d) ? t.d : 1) + '원';
  return nf(t.value, 2);
}
function tape(d) {
  const wrap = h('div', { class: 'mk-tape', role: 'list', 'aria-label': '주요 지수와 지표' });
  for (const t of d.ticker || []) {
    if (!t || !fin(t.value)) continue;
    const series = t.series || (t.spark && d.markets[t.spark] && d.markets[t.spark].series);
    const isMkt = MKTS.some(([id]) => id === t.id);
    const ch = t.bp ? (t.chg || 0) * 100 : t.pct;
    const chTxt = t.bp ? `${arrow(ch)}${nf(Math.abs(ch), 1)}bp` : fin(ch) ? `${arrow(ch)}${nf(Math.abs(ch))}%` : '';
    const item = h(isMkt ? 'button' : 'div', { class: 'mk-tk', role: 'listitem', type: isMkt ? 'button' : null, 'aria-label': `${t.name} ${fmtTick(t)} ${chTxt}` },
      h('span', { class: 'n' }, t.name), series ? spark(series) : null,
      h('b', { class: 'v num' }, fmtTick(t)), h('span', { class: 'c num ' + dirOf(ch) }, chTxt));
    if (isMkt) item.addEventListener('click', () => { click(); ui.tab = 'movers'; ui.mkt = t.id; ui.side = 'up'; renderPane(true); });
    wrap.append(item);
  }
  return wrap;
}
function headline(d) {
  const old = Date.now() - ts(d) > 4 * 86400e3;
  return h('div', { class: 'mk-hl', 'data-pk': 'hl' },
    h('span', { class: 'lab' }, '오늘의 한 줄'),
    h('p', {}, d.headline || ''),
    h('small', {}, old ? `⚠️ 최신 정보를 아직 못 받았어요 · ${updStr(d.updated)} 기준` : `${updStr(d.updated)} 업데이트`));
}
function foot(d) {
  return h('div', { class: 'mk-foot' }, d.disclaimer || 'Claude가 정리한 참고용 정보예요. 투자 권유가 아니에요.', h('br'),
    h('b', {}, `업데이트 ${updStr(d.updated)}`), ' · 화~토 아침마다 새로 바뀌어요.');
}
function seg(opts, cur, onPick, label) {
  return h('div', { class: 'mk-seg', role: 'tablist', 'aria-label': label || null }, opts.map(([id, text, cnt]) =>
    h('button', { type: 'button', role: 'tab', class: id === cur ? 'on' : '', 'aria-selected': String(id === cur), onclick: () => { if (id === cur) return; click(); onPick(id); } },
      text, cnt != null ? h('span', { class: 'cnt' }, cnt) : null)));
}
function sourcesEl(list) {
  const items = (list || []).filter(x => Array.isArray(x) && typeof x[0] === 'string');
  if (!items.length) return null;
  return h('details', { class: 'mk-src' }, h('summary', {}, `출처 ${items.length}곳`),
    h('ol', {}, items.map(([t, u]) => h('li', {}, /^https?:\/\//.test(u || '') ? h('a', { href: u, target: '_blank', rel: 'noopener noreferrer' }, t) : t))));
}
const h2 = (title, sub) => h('h2', { class: 'mk-h2' }, title, sub ? h('small', {}, sub) : null);

/* ----- 차트 ----- */
function lineChart(m) {
  const ser = (m.series || []).filter(x => Array.isArray(x) && fin(x[1]));
  const wrap = h('div', { class: 'mk-chart' });
  if (ser.length < 2) return wrap;
  wrap.style.minHeight = '172px'; // 그리기 전에도 차트 자리를 잡아둬서 아래 내용이 밀리지 않게
  const vals = ser.map(x => x[1]);
  const hiV = Math.max(...vals), loV = Math.min(...vals);
  wrap.setAttribute('role', 'img');
  wrap.setAttribute('aria-label', `${m.name} 최근 ${ser.length}거래일: ${mdw(ser[0][0])} ${nf(vals[0])}에서 ${mdw(ser[ser.length - 1][0])} ${nf(vals[vals.length - 1])}. 최고 ${nf(hiV)}, 최저 ${nf(loV)}. 아래 '일별 시세 보기'에서 표로 볼 수 있어요.`);
  const gid = 'mk-grad-' + (++gradSeq);
  let lastW = 0;
  const draw = () => {
    const W = Math.round(wrap.clientWidth || 0);
    if (W < 120 || W === lastW) return;
    lastW = W;
    wrap.textContent = '';
    const H = 172, pl = 6, pr = 48, pt = 24, pb = 34;
    const span = hiV - loV || Math.abs(hiV) * 0.02 || 1;
    const lo = loV - span * 0.08, hi = hiV + span * 0.08;
    const X = i => pl + (i / (ser.length - 1)) * (W - pl - pr);
    const Y = v => pt + (1 - (v - lo) / (hi - lo)) * (H - pt - pb);
    const svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, 'aria-hidden': 'true', focusable: 'false' });
    svg.append(sv('defs', {}, sv('linearGradient', { id: gid, x1: 0, y1: 0, x2: 0, y2: 1 },
      sv('stop', { offset: '0%', 'stop-color': '#5cc8c1', 'stop-opacity': 0.22 }), sv('stop', { offset: '100%', 'stop-color': '#5cc8c1', 'stop-opacity': 0 }))));
    const grid = sv('g', { class: 'grid' });
    for (const t of niceTicks(lo, hi, 4)) {
      const y = Math.round(Y(t)) + 0.5;
      grid.append(sv('line', { x1: pl, x2: W - pr + 4, y1: y, y2: y }), sv('text', { class: 'ylab', x: W - 2, y: y + 4, 'text-anchor': 'end' }, nf(t, t % 1 ? 1 : 0)));
    }
    svg.append(grid);
    const xi = [0, Math.round((ser.length - 1) / 2), ser.length - 1];
    xi.forEach((i, k) => svg.append(sv('text', { class: 'xlab', x: X(i), y: H - 8, 'text-anchor': k === 0 ? 'start' : k === 2 ? 'end' : 'middle' }, md(ser[i][0]))));
    const line = ser.map((x, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(x[1]).toFixed(1)}`).join('');
    svg.append(sv('path', { class: 'ar', d: `${line}L${X(ser.length - 1).toFixed(1)},${H - pb}L${X(0).toFixed(1)},${H - pb}Z`, fill: `url(#${gid})` }));
    svg.append(sv('path', { class: 'ln', d: line }));
    const idx = new Map(ser.map((x, i) => [x[0], i]));
    for (const n of (m.notes || []).slice(0, 2)) {
      const i = idx.get(n && n.d); if (i == null) continue;
      const v = ser[i][1], x = X(i), y = Y(v);
      const nb = [ser[i - 1], ser[i + 1]].filter(Boolean).map(s => s[1]);
      const above = !nb.length || v >= nb.reduce((a, b) => a + b, 0) / nb.length;
      const anchor = x < 44 ? 'start' : x > W - pr - 44 ? 'end' : 'middle';
      const tx = anchor === 'start' ? x - 3 : anchor === 'end' ? x + 3 : x;
      svg.append(sv('g', { class: 'nt' }, sv('circle', { cx: x, cy: y, r: 3.5 }), sv('text', { x: tx, y: above ? y - 9 : y + 17, 'text-anchor': anchor }, n.t)));
    }
    const lx = X(ser.length - 1), ly = Y(vals[vals.length - 1]);
    svg.append(sv('circle', { class: 'pulse', cx: lx, cy: ly, r: 4 }), sv('circle', { class: 'last', cx: lx, cy: ly, r: 4 }));
    const xh = sv('g', { class: 'xh', style: 'display:none' }, sv('line', { y1: pt - 6, y2: H - pb }), sv('circle', { r: 5 }));
    svg.append(xh);
    const tip = h('div', { class: 'mk-tip', hidden: true });
    wrap.append(svg, tip);
    let hideT = 0;
    const show = ev => {
      clearTimeout(hideT);
      const r = svg.getBoundingClientRect();
      const px = ((ev.clientX - r.left) / r.width) * W;
      const i = Math.max(0, Math.min(ser.length - 1, Math.round(((px - pl) / (W - pl - pr)) * (ser.length - 1))));
      const x = X(i), y = Y(ser[i][1]), prev = i ? ser[i - 1][1] : null;
      xh.style.display = '';
      xh.firstChild.setAttribute('x1', x); xh.firstChild.setAttribute('x2', x);
      xh.lastChild.setAttribute('cx', x); xh.lastChild.setAttribute('cy', y);
      tip.textContent = '';
      const ch = prev != null ? ser[i][1] - prev : null;
      tip.append(`${mdw(ser[i][0])}`, h('b', { class: 'num' }, nf(ser[i][1])),
        ch != null ? h('span', { class: 'num ' + dirOf(ch) }, `${arrow(ch)}${nf(Math.abs(ch))} (${pctStr((ch / prev) * 100)})`) : '첫날');
      tip.hidden = false;
      const tw = tip.offsetWidth || 120;
      tip.style.left = Math.max(tw / 2 + 2, Math.min(W - tw / 2 - 2, x)) + 'px';
    };
    const hide = delay => { clearTimeout(hideT); hideT = setTimeout(() => { xh.style.display = 'none'; tip.hidden = true; }, delay); };
    svg.addEventListener('pointerdown', show);
    svg.addEventListener('pointermove', show);
    svg.addEventListener('pointerleave', () => hide(0));
    svg.addEventListener('pointercancel', () => hide(0));
    svg.addEventListener('pointerup', e => { if (e.pointerType !== 'mouse') hide(1600); });
  };
  if (typeof ResizeObserver === 'function') { const ro = new ResizeObserver(() => draw()); ro.observe(wrap); if (panel) panel.ros.push(ro); }
  requestAnimationFrame(draw);
  return wrap;
}
function dailyTable(m) {
  const ser = (m.series || []).filter(x => Array.isArray(x) && fin(x[1]));
  const btn = h('button', { class: 'mk-tgl', type: 'button', 'aria-expanded': 'false' }, '일별 시세 보기');
  const rows = ser.map((x, i) => { const prev = i ? ser[i - 1][1] : null; const c = prev ? ((x[1] - prev) / prev) * 100 : null; return h('tr', {}, h('td', {}, mdw(x[0])), h('td', {}, nf(x[1])), h('td', { class: c == null ? '' : dirOf(c) }, c == null ? '–' : pctStr(c))); }).reverse();
  const tbl = h('table', { class: 'mk-table', hidden: true }, h('thead', {}, h('tr', {}, h('th', {}, '날짜'), h('th', {}, '종가'), h('th', {}, '전날 대비'))), h('tbody', {}, rows));
  btn.addEventListener('click', () => { click(); const open = tbl.hidden; tbl.hidden = !open; btn.setAttribute('aria-expanded', String(open)); btn.textContent = open ? '일별 시세 접기' : '일별 시세 보기'; });
  return [btn, tbl];
}

/* ----- 탭 1: 급등락 ----- */
function moverRow(it, i, cur, side) {
  const tagCls = it.tag === '상한가' ? ' lim-up' : it.tag === '하한가' ? ' lim-dn' : '';
  const us = cur === '$', code = us ? null : codeOf(it), tk = us ? tickerOf(it) : '';
  const sub = [us ? it.code : code, fin(it.price) ? priceStr(it.price, cur) : null].filter(Boolean).join(' · ');
  return h('div', { class: 'mk-row', 'data-pk': i === 1 ? 'mover2' : null },
    h('div', { class: 'hd' },
      h('span', { class: 'rk num' }, i + 1),
      logoEl(it.name, { code, tk }),
      h('div', { class: 'nm' }, h('b', {}, h('span', { class: 'nt' }, it.name), it.tag ? h('span', { class: 'tag' + tagCls }, it.tag) : null), sub ? h('small', { class: 'num' }, sub) : null),
      h('span', { class: 'mk-pct ' + dirOf(it.pct) }, fin(it.pct) ? pctStr(it.pct) : '')),
    Array.isArray(it.why) && it.why.length ? h('ul', { class: 'mk-why' }, h('li', { class: 'q' }, side === 'up' ? '왜 올랐을까?' : '왜 내렸을까?'), it.why.map(w => h('li', {}, w))) : null,
    code && skHas(code) ? h('button', { class: 'sk-open', type: 'button', onclick: () => { click(); openStock(code); } }, '📈 차트·회사 정보 보기', h('span', { 'aria-hidden': 'true' }, '›')) : null);
}
function bigTile(b, cur) {
  const us = cur === '$', code = us ? null : codeOf(b), tk = us ? tickerOf(b) : '', can = !!(code && skHas(code));
  const kids = [h('span', { class: 'bn' }, logoEl(b.name, { code, tk, size: 22 }), h('span', {}, b.name)), h('b', { class: dirOf(b.pct) }, fin(b.pct) ? pctStr(b.pct) : ''),
    fin(b.price) ? h('small', {}, priceStr(b.price, cur)) : null, can ? h('i', { class: 'go', 'aria-hidden': 'true' }, '›') : null, can ? h('span', { class: 'sk-sr' }, ' 차트·회사 정보 보기') : null];
  return can ? h('button', { class: 'mk-big sk-tap', type: 'button', onclick: () => { click(); openStock(code); } }, kids) : h('div', { class: 'mk-big' }, kids);
}
function paneMovers(d) {
  const m = d.markets[ui.mkt] || d.markets.kospi;
  const ups = (m.up || []).filter(Boolean), downs = (m.down || []).filter(Boolean);
  const items = ui.side === 'down' ? downs : ups;
  const note = ui.side === 'down' ? m.downNote : m.upNote;
  return [
    seg(MKTS, ui.mkt, id => { ui.mkt = id; ui.side = 'up'; renderPane(false); }, '시장 고르기'),
    h('div', { class: 'mk-card mk-idx', 'data-pk': 'index' },
      h('div', { class: 'top' }, h('span', { class: 'nm' }, `${m.name} 지수`), h('span', { class: 'ses' }, `${m.session || ''} 마감`, m.sessionNote ? h('br') : null, m.sessionNote || null)),
      h('div', { class: 'big num' }, nf(m.value)),
      h('div', { class: 'chg num ' + dirOf(m.chg) }, `${arrow(m.chg)} ${nf(Math.abs(m.chg))} (${pctStr(m.pct)})`),
      lineChart(m),
      dailyTable(m),
      m.summary ? h('p', { class: 'mk-p' }, m.summary) : null,
      Array.isArray(m.chips) && m.chips.length ? h('div', { class: 'mk-chips' }, m.chips.map(c => h('span', { class: 'mk-chip' }, c))) : null),
    h2('전날 많이 움직인 종목', '이유는 3줄로 정리했어요'),
    seg([['up', '많이 오른 종목', ups.length], ['down', '많이 내린 종목', downs.length]], ui.side, s => { ui.side = s; renderPane(false); }, '오른 종목, 내린 종목'),
    m.listNote ? h('p', { class: 'mk-note' }, m.listNote) : null,
    h('div', { class: 'mk-list', 'data-pk': 'movers' }, items.length ? items.map((it, i) => moverRow(it, i, m.cur, ui.side))
      : h('div', { class: 'mk-empty' }, h('b', {}, ui.side === 'down' ? '크게 내린 종목이 거의 없었어요' : '크게 오른 종목이 거의 없었어요'), note || '')),
    ui.side === 'down' && items.length && note ? h('p', { class: 'mk-note' }, note) : null,
    Array.isArray(m.big) && m.big.length ? [h2('대표 종목은 어땠을까', '시가총액 상위'),
      h('div', { class: 'mk-bigs', 'data-pk': 'big' }, m.big.filter(Boolean).map(b => bigTile(b, m.cur)))] : null,
    sourcesEl(m.sources),
  ];
}

/* ----- 탭 2: 놓치면 안 될 정보 ----- */
function impDots(imp) {
  const n = [1, 2, 3].includes(imp) ? imp : 1;
  return h('span', { class: 'mk-imp', role: 'img', 'aria-label': `중요도 ${n}단계 중 3` }, [1, 2, 3].map(i => h('i', { class: i <= n ? 'on' : '' })), h('em', {}, ['', '참고', '보통', '중요'][n]));
}
function paneMust(d) {
  const k = d.mustKnow || {};
  return [
    k.oneLine ? h('div', { class: 'mk-one', 'data-pk': 'oneLine' }, h('div', { class: 'lab' }, '💬 Claude가 보는 이번 주 한 줄'), h('p', {}, k.oneLine)) : null,
    k.radar ? radarEl(k.radar) : null,
    k.sectors ? sectorsEl(k.sectors) : null,
    h2('놓치면 안 될 포인트', '뉴스와 증권사 자료를 읽고 Claude가 정리했어요'),
    (k.cards || []).filter(Boolean).map((c, ci) => h('div', { class: 'mk-card mk-kc', 'data-pk': ci === 0 ? 'card1' : ci === 1 ? 'card2' : null },
      h('span', { class: 'tg' }, h('i', {}, c.icon || '•'), c.tag || ''),
      h('h3', {}, c.title || ''),
      c.easy ? h('div', { class: 'mk-easy' }, h('b', {}, '🔰 쉽게 말하면'), c.easy) : null,
      h('ul', {}, (c.facts || []).map(f => h('li', {}, f))),
      c.mine ? h('div', { class: 'mk-mine' }, h('b', {}, 'Claude 생각'), c.mine) : null)),
    k.watch ? watchEl(k.watch) : null,
    Array.isArray(k.calendar) && k.calendar.length ? [h2('다가오는 일정', '한국시간 기준 · 예상치는 발표 전 시장 전망이에요'),
      h('div', { class: 'mk-card', 'data-pk': 'cal' }, h('ul', { class: 'mk-cal' }, k.calendar.filter(Boolean).map(c =>
        h('li', {}, h('div', { class: 'd' }, c.d || ''), h('div', { class: 't' }, c.t || '', c.note ? h('small', {}, c.note) : null,
          c.exp || c.prev ? h('div', { class: 'ep' }, c.exp ? h('span', { class: 'ex' }, c.exp) : null, c.prev ? h('span', {}, c.prev) : null) : null,
          c.why ? h('small', { class: 'why' }, c.why) : null,
          h('div', { class: 'ft' }, impDots(c.imp), c.sc && (d.whatif && (d.whatif.scenarios || []).length) ? goTab('whatif', '이렇게 되면? 보기') : null)))))),
      pdOpen(d) ? h('div', { class: 'mk-cta' }, goTab('predict', '🎯 이번 주 일정, 결과를 맞혀 볼까요?')) : null] : null,
    sourcesEl(k.sources),
  ];
}
const LV = [['안정', 'ok'], ['조금 불안', 'mid'], ['불안', 'hi']];
const lvOf = x => ([0, 1, 2].includes(x && x.lv) ? x.lv : 1);
function radarEl(r) {
  const items = (r.items || []).filter(x => x && x.name);
  if (!items.length) return null;
  const cnt = [0, 0, 0]; items.forEach(x => { cnt[lvOf(x)]++; });
  return [h2('위험 레이더', r.label || '시장이 얼마나 불안한지 신호등처럼 봐요'),
    h('div', { class: 'mk-card mk-radar', 'data-pk': 'radar' },
      h('div', { class: 'sum', role: 'img', 'aria-label': `신호 ${items.length}개 중 불안 ${cnt[2]}개, 조금 불안 ${cnt[1]}개, 안정 ${cnt[0]}개` },
        [2, 1, 0].map(l => (cnt[l] ? h('span', { class: 'lv-' + LV[l][1], style: `flex:${cnt[l]}` }, `${LV[l][0]} ${cnt[l]}`) : null))),
      items.map(x => {
        const l = lvOf(x);
        return h('div', { class: 'rr' },
          h('div', { class: 'hd' }, h('b', {}, x.name), x.value ? h('span', { class: 'v num' }, x.value) : null,
            h('span', { class: 'lv lv-' + LV[l][1] }, h('i', { 'aria-hidden': 'true' }, [0, 1, 2].map(i => h('em', { class: i <= l ? 'on' : '' }))), LV[l][0])),
          x.note ? h('p', {}, x.note) : null);
      }),
      r.take ? h('div', { class: 'mk-mine' }, h('b', {}, 'Claude 생각'), r.take) : null)];
}
function wx(p) { return p >= 3 ? ['☀️', '맑음'] : p >= 1 ? ['🌤️', '구름 조금'] : p > -1 ? ['☁️', '흐림'] : p > -3 ? ['🌧️', '비'] : ['⛈️', '폭우']; }
function sectorsEl(s) {
  const items = (s.items || []).filter(x => x && x.name && fin(x.pct));
  const br = s.breadth && fin(s.breadth.up) && fin(s.breadth.down) ? s.breadth : null;
  if (!items.length && !br) return null;
  const tot = br ? br.up + br.down + (fin(br.flat) ? br.flat : 0) : 0;
  return [h2('업종 날씨', s.label || '하루 등락률로 정한 날씨예요 · 추천이 아니에요'),
    h('div', { class: 'mk-card mk-wxc' },
      br && tot ? h('div', { class: 'brd' },
        h('div', { class: 'lab' }, h('span', {}, s.sky || '오늘 시장 날씨'), h('b', {}, wx(s.skyPct != null ? s.skyPct : 0)[0], ' ', s.skyWord || '')),
        h('div', { class: 'bar', role: 'img', 'aria-label': `오른 종목 ${br.up}개, 내린 종목 ${br.down}개` },
          h('i', { class: 'u', style: `flex:${br.up}` }), fin(br.flat) && br.flat ? h('i', { class: 'f', style: `flex:${br.flat}` }) : null, h('i', { class: 'd', style: `flex:${br.down}` })),
        h('div', { class: 'ends num' }, h('span', { class: 'up' }, `오른 종목 ${nf(br.up, 0)}`), h('span', { class: 'dn' }, `내린 종목 ${nf(br.down, 0)}`))) : null,
      items.length ? h('div', { class: 'mk-wx' }, items.map(x => {
        const [ic, w] = wx(x.pct);
        return h('div', { class: 'mk-wxi' }, h('span', { class: 'ic', role: 'img', 'aria-label': w }, ic), h('b', {}, x.name), h('span', { class: 'p num ' + dirOf(x.pct) }, pctStr(x.pct)), x.note ? h('small', {}, x.note) : null);
      })) : null,
      s.note ? h('p', { class: 'mk-note' }, s.note) : null)];
}
function watchEl(list) {
  const items = (list || []).filter(x => x && x.t);
  if (!items.length) return null;
  let on = [];
  try { on = JSON.parse(localStorage.getItem(WATCH_KEY) || '[]'); if (!Array.isArray(on)) on = []; } catch { on = []; }
  on = on.filter(t => items.some(x => x.t === t)); // 지금 목록에 없는 건 지워요
  return [h2('이번 주 체크리스트', '확인했으면 눌러서 표시해요 · 이 폰에만 저장돼요'),
    h('div', { class: 'mk-card mk-watch', 'data-pk': 'watch' }, items.map(x => {
      const cb = h('input', { type: 'checkbox' });
      cb.checked = on.includes(x.t);
      cb.addEventListener('change', () => {
        click();
        on = cb.checked ? [...new Set([...on, x.t])] : on.filter(t => t !== x.t);
        try { localStorage.setItem(WATCH_KEY, JSON.stringify(on)); } catch { /* 저장 못 해도 화면은 그대로 */ }
      });
      return h('label', { class: 'wi' }, cb, h('span', { class: 'bx', 'aria-hidden': 'true' }),
        h('div', { class: 'tx' }, h('b', {}, x.t), x.now ? h('span', { class: 'now' }, x.now) : null, x.why ? h('small', {}, x.why) : null));
    }))];
}

/* ----- 탭 3: 증권사 전망 ----- */
function axisLabels(a0, a1) {
  const P = v => ((v - a0) / (a1 - a0)) * 100;
  return h('div', { class: 'mk-axis', 'aria-hidden': 'true' }, niceTicks(a0, a1, 4).map(t => {
    const p = P(t); const tx = p < 6 ? '0' : p > 94 ? '-100%' : '-50%';
    return h('span', { style: `left:${p}%;transform:translateX(${tx})` }, nf(t, 0));
  }));
}
function paneBrokers(d) {
  const b = d.brokers || {};
  const x = ui.br === 'us' ? b.us : b.kr;
  const out = [seg([['kr', '코스피 · 국내 증권사'], ['us', 'S&P 500 · 월가']], ui.br, v => { ui.br = v; renderPane(false); }, '전망 고르기')];
  if (!x || !Array.isArray(x.axis)) return out;
  const [a0, a1] = x.axis;
  const P = v => Math.max(0, Math.min(100, ((v - a0) / (a1 - a0)) * 100));
  const nowP = fin(x.now) ? P(x.now) : null;
  const avgP = fin(x.avg) ? P(x.avg) : null;
  const isUS = ui.br === 'us';
  const rows = (x.items || []).filter(Boolean).map(it => {
    const stanceCls = it.stance === '강세' ? 'bull' : it.stance === '신중' ? 'bear' : 'neu';
    let val = '';
    if (isUS && fin(it.target)) val = `${nf(it.target, 0)}${fin(x.now) ? ` (${signed(((it.target - x.now) / x.now) * 100, 1)}%)` : ''}`;
    else if (fin(it.lo) && fin(it.hi)) val = `${nf(it.lo, 0)}~${nf(it.hi, 0)}${fin(it.target) ? ` · 목표 ${nf(it.target, 0)}` : ''}`;
    else if (fin(it.target)) val = `목표 ${nf(it.target, 0)}`;
    const trk = h('div', { class: 'trk', 'aria-hidden': 'true' });
    if (nowP != null) trk.append(h('i', { class: 'now', style: `left:${nowP}%` }));
    if (avgP != null) trk.append(h('i', { class: 'avg', style: `left:${avgP}%` }));
    if (isUS) {
      if (fin(it.target) && nowP != null) { const tp = P(it.target); trk.append(h('i', { class: 'up-seg', style: `left:${Math.min(nowP, tp)}%;width:${Math.abs(tp - nowP)}%` })); }
      if (fin(it.target)) trk.append(h('i', { class: 'dot', style: `left:${P(it.target)}%` }));
    } else {
      if (fin(it.lo) && fin(it.hi)) trk.append(h('i', { class: 'rng', style: `left:${P(it.lo)}%;width:${P(it.hi) - P(it.lo)}%` }));
      if (fin(it.target)) trk.append(h('i', { class: 'tgt', style: `left:${P(it.target)}%` }));
    }
    return h('div', { class: 'mk-br' },
      h('div', { class: 'hd' }, h('b', {}, it.firm || ''), it.tag ? h('span', { class: 'own' }, it.tag) : null,
        it.stance ? h('span', { class: 'mk-stance ' + stanceCls }, it.stance) : null, h('span', { class: 'val' }, val)),
      trk, it.point ? h('p', {}, it.point) : null);
  });
  const legend = h('div', { class: 'mk-legend' },
    isUS ? h('span', {}, h('i', { class: 'sw-dot' }), '2027년 말 목표') : [h('span', {}, h('i', { class: 'sw-rng' }), '2027년 예상 범위'), h('span', {}, h('i', { class: 'sw-tgt' }), '목표치')],
    nowP != null ? h('span', {}, h('i', { class: 'sw-now' }), x.nowLabel || '현재') : null,
    avgP != null ? h('span', {}, h('i', { class: 'sw-avg' }), x.avgLabel || '평균') : null);
  out.push(h2(x.title || ''), h('div', { class: 'mk-card', 'data-pk': 'brokers' }, legend, rows, axisLabels(a0, a1)),
    (x.notes || []).map(n => h('p', { class: 'mk-note' }, n)), sourcesEl(b.sources));
  return out;
}

/* ----- 탭 4: 국내 뉴스 ----- */
function gauge(t) {
  const v = Number(t) || 0;
  return h('div', { class: 'mk-gauge', role: 'img', 'aria-label': `분위기: ${toneWord(v)} (-2 매우 비관 ~ +2 매우 낙관 중 ${v})` },
    h('div', { class: 'bar' }, TONE_COLS.map(c => h('i', { style: `background:${c}` })), h('span', { class: 'pin', style: `left:${tonePos(v)}%` }, toneWord(v))),
    h('div', { class: 'ends' }, h('span', {}, '비관'), h('span', {}, '중립'), h('span', {}, '낙관')));
}
function paneKR(d) {
  const n = d.newsKR || {};
  return [
    h('div', { class: 'mk-card', style: 'margin-top:12px', 'data-pk': 'krMood' },
      h('div', { class: 'mk-h2', style: 'margin:0 0 4px' }, '국내 언론이 보는 시장 분위기'),
      gauge(n.tone), n.toneLabel ? h('div', { class: 'mk-tone' }, n.toneLabel) : null, n.summary ? h('p', { class: 'mk-p' }, n.summary) : null),
    h2('국내 뉴스 핵심 포인트'),
    h('div', { class: 'mk-card', 'data-pk': 'krPoints' }, h('ol', { class: 'mk-pts' }, (n.points || []).filter(Boolean).map(p => h('li', {}, h('div', {}, h('b', {}, p.h || ''), h('span', {}, p.s || '')))))),
    sourcesEl(n.sources),
  ];
}

/* ----- 탭 5: 해외 뉴스 ----- */
function paneGlobal(d) {
  const list = (d.newsGlobal || []).filter(Boolean);
  return [
    h('div', { class: 'mk-card', style: 'margin-top:12px', 'data-pk': 'globalMood' },
      h('div', { class: 'mk-h2', style: 'margin:0 0 6px' }, '나라별 시장 분위기', h('small', {}, '각 나라 뉴스 기준')),
      h('div', { class: 'mk-tones' }, list.map(c => h('div', { class: 'mk-tn', role: 'img', 'aria-label': `${c.name}: ${toneWord(c.tone)}` },
        h('span', { class: 'c' }, `${c.flag || ''} ${c.name || ''}`),
        h('div', { class: 'tr' }, h('i', { class: 'dot', style: `left:${tonePos(c.tone)}%;background:${toneColor(c.tone)}` })),
        h('span', { class: 'w' }, toneWord(Number(c.tone) || 0))))),
      h('div', { class: 'mk-tn-ax', 'aria-hidden': 'true' }, h('span'), h('div', {}, h('span', {}, '비관'), h('span', {}, '중립'), h('span', {}, '낙관')), h('span'))),
    list.map((c, ci) => h('div', { class: 'mk-card mk-cty', 'data-pk': ci === 0 ? 'cty1' : ci === 2 ? 'cty3' : null },
      h('div', { class: 'hd' }, h('span', { class: 'fl', 'aria-hidden': 'true' }, c.flag || ''),
        h('div', { class: 'nmw' }, h('div', { class: 'nmr' }, h('b', {}, c.name || ''), c.toneLabel ? h('span', { class: 'pill ' + dirOf(Number(c.tone) || 0) }, c.toneLabel) : null), c.idx ? h('small', {}, c.idx) : null)),
      h('ul', {}, (c.points || []).map(p => h('li', {}, p))))),
    sourcesEl(d.globalSources),
  ];
}

/* ----- 탭 6: 돈의 흐름 ----- */
function divBars(rows) {
  const ok = (rows || []).filter(r => Array.isArray(r) && fin(r[1]));
  const max = Math.max(1, ...ok.map(r => Math.abs(r[1])));
  const jo = useJo(ok.map(r => r[1]));
  return h('div', { class: 'mk-flow' }, ok.map(([who, v]) => h('div', { class: 'mk-fr', role: 'img', 'aria-label': `${who} ${v >= 0 ? '순매수' : '순매도'} ${eok(v, jo)}원` },
    h('span', { class: 'who' }, who),
    h('div', { class: 'tr' }, h('i', { class: 'bar ' + (v >= 0 ? 'pos' : 'neg'), style: `width:max(2px, calc(${((Math.abs(v) / max) * 50).toFixed(2)}% - 1px))` })),
    h('span', { class: 'v ' + dirOf(v) }, eok(v, jo)))),
  h('div', { class: 'mk-fl-ax', 'aria-hidden': 'true' }, h('span'), h('div', {}, h('span', {}, '← 판 쪽(순매도)'), h('span', {}, '산 쪽(순매수) →')), h('span')));
}
function paneFlows(d) {
  const f = d.flows || {};
  const today = ui.flow === 'kosdaq' && f.todayKQ ? f.todayKQ : f.today;
  return [
    f.todayKQ ? seg([['kospi', '코스피'], ['kosdaq', '코스닥']], ui.flow, v => { ui.flow = v; renderPane(false); }, '시장 고르기') : null,
    today ? [h2(today.label || '투자자별 순매수', '+ 산 쪽(순매수) · − 판 쪽(순매도)'),
      h('div', { class: 'mk-card', 'data-pk': 'flowToday' }, divBars(today.rows), today.note ? h('p', { class: 'mk-note' }, today.note) : null)] : null,
    f.month ? [h2(f.month.label || '이번 달 누적'), h('div', { class: 'mk-card', 'data-pk': 'flowMonth' }, divBars(f.month.rows), (f.month.notes || []).map(n => h('p', { class: 'mk-note' }, n)))] : null,
    f.week && Array.isArray(f.week.groups) ? [h2(f.week.label || '많이 사고판 종목'),
      h('div', { class: 'mk-groups', 'data-pk': 'flowWeek' }, f.week.groups.filter(Boolean).map(g => {
        const its = (g.items || []).filter(r => Array.isArray(r) && fin(r[1])), jo = useJo(its.map(r => r[1]));
        return h('div', { class: 'mk-grp' }, h('h4', {}, g.who || ''),
          h('ol', {}, its.map(([nm, v]) => {
            const code = krCode(nm), lab = [logoEl(nm, { code, size: 18 }), h('span', {}, nm)];
            return h('li', {}, code && skHas(code) ? h('button', { class: 'fn sk-lnk', type: 'button', 'aria-label': `${nm} 차트·회사 정보 보기`, onclick: () => { click(); openStock(code); } }, lab) : h('span', { class: 'fn' }, lab),
              h('b', { class: dirOf(v) }, eok(v, jo)));
          })),
          fin(g.total) ? h('p', { class: 'mk-note', style: 'margin:6px 0 0' }, `주간 합계 ${eok(g.total, jo)}`) : null);
      }))] : null,
    Array.isArray(f.stats) && f.stats.length ? [h2('시장 체온계'), h('div', { class: 'mk-stats', 'data-pk': 'flowStats' }, f.stats.filter(Boolean).map(s => h('div', { class: 'mk-stat' }, h('span', {}, s.label || ''), h('b', {}, s.value || ''), s.sub ? h('small', {}, s.sub) : null)))] : null,
    Array.isArray(f.us) && f.us.length ? [h2('미국에서는 돈이 어디로 갔을까'), h('div', { class: 'mk-card' }, h('ul', { class: 'mk-bul' }, f.us.map(x => h('li', {}, x))))] : null,
    f.take ? h('div', { class: 'mk-one', style: 'margin-top:14px', 'data-pk': 'flowTake' }, h('div', { class: 'lab' }, '💬 Claude 해석'), h('p', { style: 'font-size:15px;font-weight:600' }, f.take)) : null,
    sourcesEl(f.sources),
  ];
}

/* ---------- 종목 화면: 차트·회사 정보·경쟁사 비교 + 회사 로고 ---------- */
// 데이터: 저장소 stocks/ 폴더. GitHub 자동 작업이 공공데이터포털(금융위원회 주식시세)·금융감독원 OpenDART로 평일 하루 두 번 만들어요.
//   stocks/index.json  {v, updated, asof, cid, items: {코드: [이름, 시장, 도메인, ISIN, 파일있음(0/1)]}}
//   stocks/<코드>.json {v, code, name, mkt, asof, cap, shares, amt, d: [[날짜,시,고,저,종,거래량]...], co, fin, x, peers, src}
// 로고: Brandfetch Logo API 주소를 그대로 걸어요(내려받거나 다시 올리지 않음). 못 찾으면 글자 배지, 하나금융은 색 배지만.
const STK_KEY = 'hanafam.market.stk';
const STK_TTL = 30 * 60e3;
const BF_CDN = 'https://cdn.brandfetch.io/';
const MKT_KO = { KOSPI: '코스피', KOSDAQ: '코스닥' };
const MA_SET = [[5, '#f5b800'], [20, '#ff8fc7'], [60, '#22b8a0'], [120, '#dde6e5']]; // 색약 검사 통과(어두운 배경, 서로 + 빨강·파랑 봉과)
const IV_UNIT = { d: '일', w: '주', m: '개월' };
const IV_BAR = { d: '하루', w: '한 주', m: '한 달' };
const US_TK = { 엔비디아: 'NVDA', 애플: 'AAPL', 마이크로소프트: 'MSFT', 알파벳: 'GOOGL', 구글: 'GOOGL', 아마존: 'AMZN', 메타: 'META', 테슬라: 'TSLA', 브로드컴: 'AVGO',
  넷플릭스: 'NFLX', 팔란티어: 'PLTR', AMD: 'AMD', 인텔: 'INTC', 마이크론: 'MU', 퀄컴: 'QCOM', 코스트코: 'COST', 어도비: 'ADBE', 시스코: 'CSCO', 펩시코: 'PEP',
  ASML: 'ASML', 암젠: 'AMGN', 달러트리: 'DLTR', 코어위브: 'CRWV' };
const LOGO_BG = ['#35588f', '#6d4a92', '#2c7468', '#8a5a2c', '#56682c', '#8c3a4e', '#2c6a8c', '#6a5a3a'];
const BAD_HOST = /(^|\.)(blog\.naver\.com|cafe\.naver\.com|naver\.me|modoo\.at|tistory\.com|blogspot\.com|wordpress\.com|wixsite\.com|weebly\.com|facebook\.com|instagram\.com|youtube\.com|pf\.kakao\.com|sites\.google\.com|github\.io|notion\.site|linkedin\.com|cafe\.daum\.net|blog\.daum\.net|imweb\.me|creatorlink\.net)$/;
const stk = { idx: null, t: 0, p: null, names: null, files: new Map() };
let skView = null;
const skUi = { tab: 'chart', iv: 'd', met: 'cap' };

function stkBase() {
  const r = data && typeof data.remote === 'string' && /^https:\/\/\S+\.json$/.test(data.remote) ? data.remote : DEFAULT_REMOTE;
  return r.replace(/[^/]*$/, '') + 'stocks/';
}
async function getJson(url, ms) {
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), ms) : 0;
  try { const r = await fetch(url, { credentials: 'omit', signal: ctl ? ctl.signal : undefined }); return r.ok ? await r.json() : null; }
  catch { return null; } finally { if (timer) clearTimeout(timer); }
}
const idxOk = x => isObj(x) && x.v === 1 && isObj(x.items);
function stkPrime() {
  if (stk.idx || stk.t) return;
  try { const c = JSON.parse(localStorage.getItem(STK_KEY) || 'null'); if (idxOk(c)) { stk.idx = c; stk.names = null; } } catch { /* 저장소 못 씀 */ }
}
function stkLoad() {
  stkPrime();
  if (stk.p) return stk.p;
  if (stk.t && Date.now() - stk.t < STK_TTL) return Promise.resolve(stk.idx);
  stk.t = Date.now();
  stk.p = getJson(stkBase() + 'index.json', 6000).then(x => {
    stk.p = null;
    if (idxOk(x) && (!stk.idx || x.updated !== stk.idx.updated || x.asof !== stk.idx.asof)) {
      stk.idx = x; stk.names = null;
      try { localStorage.setItem(STK_KEY, JSON.stringify(x)); } catch { /* 보관 실패는 무시 */ }
    }
    return stk.idx;
  });
  return stk.p;
}
/* ----- 동료 리그 업종별 종목 (stocks/league.json: 공식 시세로 평일 오후마다 갱신) ----- */
const LGX_KEY = 'hanafam.market.lgx', LGX_TTL = 20 * 60e3;
const lgx = { d: null, t: 0, p: null };
const lgxOk = x => isObj(x) && x.v === 1 && Array.isArray(x.items) && Array.isArray(x.secs);
function lgxPrime() {
  if (lgx.d || lgx.t) return;
  try { const c = JSON.parse(localStorage.getItem(LGX_KEY) || 'null'); if (lgxOk(c)) lgx.d = c; } catch { /* 저장소 못 씀 */ }
}
// 새로 받은 게 있으면 true
function lgxLoad() {
  lgxPrime();
  if (lgx.p) return lgx.p;
  if (lgx.t && Date.now() - lgx.t < LGX_TTL) return Promise.resolve(false);
  lgx.t = Date.now();
  lgx.p = getJson(stkBase() + 'league.json', 6000).then(x => {
    lgx.p = null;
    if (!lgxOk(x)) return false;
    const js = JSON.stringify(x);
    if (lgx.d && JSON.stringify(lgx.d) === js) return false;
    lgx.d = x;
    try { localStorage.setItem(LGX_KEY, js); } catch { /* 보관 실패는 무시 */ }
    return true;
  });
  return lgx.p;
}
function lgSecs() {
  const X = lgx.d;
  return X ? X.secs.filter(v => Array.isArray(v) && /^[a-z0-9]{1,16}$/.test(v[0] || '') && typeof v[1] === 'string').map(v => ({ id: v[0], name: v[1], icon: typeof v[2] === 'string' ? v[2] : '' })) : [];
}
function stkItem(code) {
  const v = stk.idx && /^[0-9A-Z]{6}$/.test(code || '') ? stk.idx.items[code] : null;
  return Array.isArray(v) && typeof v[0] === 'string' ? v : null;
}
function krCode(name) {
  if (!stk.idx) return null;
  if (!stk.names) {
    stk.names = new Map();
    for (const [c, v] of Object.entries(stk.idx.items)) if (/^[0-9A-Z]{6}$/.test(c) && Array.isArray(v) && typeof v[0] === 'string' && !stk.names.has(v[0])) stk.names.set(v[0], c);
  }
  return stk.names.get(String(name || '').trim()) || null;
}
const skHas = code => { const v = stkItem(code); return !!(v && v[4]); };
const codeOf = it => (/^[0-9A-Z]{6}$/.test((it && it.code) || '') ? it.code : krCode(it && it.name));
const tickerOf = it => (/^[A-Z][A-Z.]{0,5}$/.test((it && it.code) || '') ? it.code : US_TK[String((it && it.name) || '').trim()] || '');

/* ----- 로고 ----- */
function hashStr(s) { let x = 7; for (const ch of String(s)) x = (x * 31 + ch.codePointAt(0)) >>> 0; return x; }
function initials(name) { const s = String(name || '').trim(); const m = s.match(/^[A-Za-z]+/); return m ? m[0].slice(0, 2).toUpperCase() : (s[0] || '?'); }
const isHana = (name, code, dom) => code === '086790' || /^하나금융/.test(String(name || '')) || /(^|\.)hanafn\.com$/.test(dom || '');
function logoEl(name, o = {}) {
  const size = o.size || 28, code = o.code || null, it = code ? stkItem(code) : null;
  const dom = it && /^[a-z0-9.-]+\.[a-z]{2,}$/.test(it[2] || '') && !BAD_HOST.test(it[2]) ? it[2] : '';
  const isin = it && /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(it[3] || '') ? it[3] : '';
  const tk = /^[A-Z][A-Z.]{0,5}$/.test(o.tk || '') ? o.tk : '';
  const hana = isHana(name, code, dom);
  const el = h('span', { class: 'sk-logo' + (hana ? ' hana' : ''), style: `--s:${size}px;--bg:${LOGO_BG[hashStr(name) % LOGO_BG.length]}`, 'aria-hidden': 'true' },
    h('i', {}, hana ? '하' : initials(name)));
  const raw = stk.idx && typeof stk.idx.cid === 'string' ? stk.idx.cid.trim() : '';
  const cid = /^[A-Za-z0-9_-]{6,64}$/.test(raw) ? raw : '';
  const path = dom ? 'domain/' + dom : tk ? 'ticker/' + tk : isin ? 'isin/' + isin : '';
  if (hana || !cid || !path) return el;
  const px = size > 32 ? 96 : 64;
  const img = h('img', { alt: '', width: size, height: size, loading: 'lazy', decoding: 'async', referrerpolicy: 'strict-origin-when-cross-origin', draggable: 'false' });
  img.addEventListener('load', () => { if (img.naturalWidth > 1) el.classList.add('ok'); else img.remove(); }, { once: true });
  img.addEventListener('error', () => img.remove(), { once: true });
  img.src = `${BF_CDN}${path}/w/${px}/h/${px}/fallback/404/icon?c=${encodeURIComponent(cid)}`;
  el.append(img);
  return el;
}

/* ----- 숫자 도우미 ----- */
function wonBig(v, unit = '원') {
  if (!fin(v)) return '–';
  const a = Math.abs(v), s = v < 0 ? '−' : '';
  return a >= 1e12 ? s + nf(a / 1e12, a >= 1e14 ? 0 : 1) + '조' + unit : a >= 1e8 ? s + nf(a / 1e8, 0) + '억' + unit : s + nf(a, 0) + unit;
}
const cntStr = v => (!fin(v) ? '–' : v >= 1e8 ? nf(v / 1e8, 1) + '억' : v >= 1e4 ? nf(v / 1e4, v >= 1e6 ? 0 : 1) + '만' : nf(v, 0));
function addM(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1)), last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(d, last));
  return t.toISOString().slice(0, 10);
}
// 일봉 → 일·주·월봉 [{t: 첫날, t1: 끝날, o, h, l, c, v}]
function skBars(d, iv) {
  if (iv !== 'w' && iv !== 'm') return d.map(r => ({ t: r[0], t1: r[0], o: r[1], h: r[2], l: r[3], c: r[4], v: r[5] }));
  const key = iv === 'w' ? r => monOf(r[0]) : r => r[0].slice(0, 7);
  const out = [];
  let cur = null;
  for (const r of d) {
    const k = key(r);
    if (!cur || cur.k !== k) { cur = { k, t: r[0], t1: r[0], o: r[1], h: r[2], l: r[3], c: r[4], v: r[5] }; out.push(cur); }
    else { cur.t1 = r[0]; cur.h = Math.max(cur.h, r[2]); cur.l = Math.min(cur.l, r[3]); cur.c = r[4]; cur.v += r[5]; }
  }
  return out.map(({ k, ...b }) => b);
}
function skMA(bs, n) {
  const out = new Array(bs.length).fill(null);
  let s = 0;
  for (let i = 0; i < bs.length; i++) { s += bs[i].c; if (i >= n) s -= bs[i - n].c; if (i >= n - 1) out[i] = s / n; }
  return out;
}
// N개월 전 종가와 비교한 수익률(%). 기록이 모자라면 null
function skRet(d, months) {
  const L = d[d.length - 1], tgt = addM(L[0], -months);
  if (!d.length || d[0][0] > tgt) return null;
  let base = null;
  for (const r of d) { if (r[0] <= tgt) base = r; else break; }
  return base && base[4] > 0 ? (L[4] / base[4] - 1) * 100 : null;
}
function skGrow(a, b) {
  if (!fin(a) || !fin(b)) return null;
  if (a > 0 && b > 0) return (b / a - 1) * 100;
  if (a <= 0 && b > 0) return '흑자전환';
  if (a > 0 && b <= 0) return '적자전환';
  return '적자지속';
}
const lastOf = a => (Array.isArray(a) && a.length && fin(a[a.length - 1]) ? a[a.length - 1] : null);
const isPref = code => !String(code || '').endsWith('0');
// 경쟁사 줄 [코드, 이름, 시가총액, 매출, 영업이익, 순이익, 자본, 1개월, 1년, 종가, 전년 매출, 전년 영업이익, 전년 순이익]
function skPeerRows(f) {
  return (Array.isArray(f.peers) ? f.peers : []).filter(p => Array.isArray(p) && /^[0-9A-Z]{6}$/.test(p[0] || '') && typeof p[1] === 'string').map((p, i) => {
    const g = k => (fin(p[k]) ? p[k] : null);
    const r = { code: p[0], name: p[1], cap: g(2), rev: g(3), op: g(4), ni: g(5), eq: g(6), r1m: g(7), r1y: g(8), c: g(9), rev0: g(10), op0: g(11), ni0: g(12), me: i === 0 };
    const pref = isPref(r.code);
    r.per = !pref && r.cap != null && r.ni != null ? (r.ni > 0 ? r.cap / r.ni : -1) : null; // -1 = 적자
    r.pbr = !pref && r.cap != null && r.eq > 0 ? r.cap / r.eq : null;
    r.roe = r.ni != null && r.eq > 0 ? (r.ni / r.eq) * 100 : null;
    r.opm = r.op != null && r.rev > 0 ? (r.op / r.rev) * 100 : null;
    r.rg = skGrow(r.rev0, r.rev); r.og = skGrow(r.op0, r.op); r.ng = skGrow(r.ni0, r.ni);
    if (r.me && Array.isArray(f.d) && f.d.length > 1) { // 같은 화면의 차트 수익률과 똑같이
      const a = skRet(f.d, 1), b = skRet(f.d, 12);
      if (a != null) r.r1m = a / 100;
      if (b != null) r.r1y = b / 100;
    }
    return r;
  });
}
const skOk = (x, code) => isObj(x) && x.v === 1 && x.code === code && Array.isArray(x.d);
function skFile(code) {
  const c = stk.files.get(code);
  if (c && Date.now() - c.t < STK_TTL) return Promise.resolve(c.f);
  return getJson(stkBase() + code + '.json', 8000).then(x => {
    if (skOk(x, code)) {
      x.d = x.d.filter(r => Array.isArray(r) && r.length >= 6 && DATE_RE.test(r[0]) && [1, 2, 3, 4].every(k => fin(r[k]) && r[k] > 0) && fin(r[5]));
      x.d.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
      if (x.d.length >= 2) { stk.files.set(code, { t: Date.now(), f: x }); return x; }
    }
    return c ? c.f : null;
  });
}

/* ----- 열기·닫기 ----- */
function openStock(code) {
  const p = panel;
  if (!p || skView || !/^[0-9A-Z]{6}$/.test(code || '')) return;
  skUi.tab = 'chart';
  const it = stkItem(code), name = it ? it[0] : code;
  const back = h('button', { class: 'mk-back', type: 'button', 'aria-label': '뒤로' }, '‹');
  const body = h('div', { class: 'mk-body sk-body' });
  const root = h('div', { class: 'sk', role: 'dialog', 'aria-modal': 'true', 'aria-label': `${name} 차트·회사 정보` },
    h('header', { class: 'mk-top' }, back, logoEl(name, { code, size: 34 }),
      h('div', { class: 'mk-ttl' }, h('b', {}, name), h('small', {}, [code, it && MKT_KO[it[1]]].filter(Boolean).join(' · ')))), body);
  const v = skView = { root, body, code, name, off: null, ros: [], pane: null, prevFocus: document.activeElement };
  back.addEventListener('click', () => { click(); skCloseBy(v); });
  root.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); skCloseBy(v); } });
  p.root.append(root);
  const hb = window.hanaBack;
  if (hb && typeof hb.push === 'function') {
    try { const o = hb.push(() => { v.off = null; skClose(v); }); v.off = typeof o === 'function' ? o : null; } catch { /* 뒤로가기 연결 실패 */ }
  }
  try { back.focus({ preventScroll: true }); } catch { /* 무시 */ }
  skRender(v, null);
  skFile(code).then(f => { if (skView === v) skRender(v, f || false); });
}
function skCloseBy(v) { if (v.off) { const o = v.off; v.off = null; try { o(); } catch { /* 무시 */ } } skClose(v); }
function skClose(v) {
  if (!v || skView !== v) return;
  skView = null;
  v.ros.forEach(r => r.disconnect());
  v.root.classList.add('mk-out');
  let gone = false; const done = () => { if (!gone) { gone = true; v.root.remove(); } };
  v.root.addEventListener('animationend', done, { once: true });
  setTimeout(done, 260);
  try { if (v.prevFocus && v.prevFocus.isConnected) v.prevFocus.focus({ preventScroll: true }); } catch { /* 무시 */ }
}
function skSeg(opts, get, onPick, label) {
  const el = h('div', { class: 'mk-seg', role: 'tablist', 'aria-label': label });
  const sync = () => { for (const b of el.children) { const on = b.dataset.id === get(); b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); } };
  for (const [id, text] of opts) el.append(h('button', { type: 'button', role: 'tab', 'data-id': id, onclick: () => { if (id === get()) return; click(); onPick(id); sync(); } }, text));
  sync();
  return el;
}

/* ----- 그리기 ----- */
function skWarn(f) {
  return h('div', { class: 'sk-warn', role: 'note' },
    h('b', { class: 'sk-warn-t' }, '⏰ 하루 한 번 바뀌는 차트예요'),
    h('p', {}, '증권사 앱처럼 1분·틱마다 움직이는 실시간 차트가 아니에요. 공공데이터라 하루 늦게 들어와서 지금 가격과 달라요.'),
    h('p', { class: 'sk-warn-k' }, '이 화면만 보고 사고팔 판단을 하지 마세요.'),
    f && DATE_RE.test(f.asof || '') ? h('span', { class: 'sk-asof num' }, `${mdw(f.asof)} 종가 기준`) : null);
}
function skRender(v, f) {
  v.ros.forEach(r => r.disconnect()); v.ros = [];
  v.body.textContent = '';
  const wrap = h('div', { class: 'sk-wrap' }, skWarn(f || null));
  v.body.append(wrap);
  if (f === null) { wrap.append(h('div', { class: 'mk-load' }, '불러오는 중…')); return; }
  if (f === false) {
    const retry = h('button', { type: 'button' }, '다시 불러오기');
    retry.addEventListener('click', () => { click(); stk.files.delete(v.code); skRender(v, null); skFile(v.code).then(x => { if (skView === v) skRender(v, x || false); }); });
    wrap.append(h('div', { class: 'mk-load' }, '종목 정보를 불러오지 못했어요.', h('br'), '인터넷 연결을 확인해 주세요.', h('br'), retry));
    return;
  }
  v.pane = h('section', { class: 'sk-pane', role: 'tabpanel' });
  wrap.append(skPrice(f), skSeg([['chart', '차트'], ['co', '회사 정보'], ['peer', '경쟁사 비교']], () => skUi.tab, id => { skUi.tab = id; skPaneDraw(v, f); }, '종목 정보 메뉴'), v.pane);
  skPaneDraw(v, f);
  wrap.append(sourcesEl(f.src),
    h('div', { class: 'mk-foot sk-foot' }, '공공데이터포털(금융위원회 주식시세)과 금융감독원 전자공시(OpenDART) 자료를 정리한 참고용 정보예요. 투자 권유가 아니에요.'));
}
function skPaneDraw(v, f) {
  v.ros.forEach(r => r.disconnect()); v.ros = [];
  const pane = v.pane; if (!pane) return;
  pane.style.minHeight = pane.offsetHeight + 'px';
  pane.textContent = '';
  const fn = { chart: skChartPane, co: skCompany, peer: skPeers }[skUi.tab] || skChartPane;
  try { pane.append(...[fn(v, f)].flat(Infinity).filter(x => x != null && x !== false)); }
  catch (e) { pane.textContent = ''; pane.append(h('div', { class: 'mk-empty' }, '이 정보를 보여주다가 문제가 생겼어요.')); console.warn('[market]', e); }
  pane.style.animation = 'none'; void pane.offsetWidth; pane.style.animation = '';
  pane.style.minHeight = '';
}
function skPrice(f) {
  const d = f.d, L = d[d.length - 1], P = d[d.length - 2], ch = L[4] - P[4];
  return h('div', { class: 'sk-px' },
    h('b', { class: 'num ' + dirOf(ch) }, nf(L[4], 0), h('small', {}, '원')),
    h('span', { class: 'num ' + dirOf(ch) }, `${arrow(ch)} ${nf(Math.abs(ch), 0)}원 (${pctStr((ch / P[4]) * 100)})`),
    h('small', {}, `${mdw(L[0])} 종가 · 전날 대비`));
}

/* 차트 탭 */
function skChartPane(v, f) {
  const iv = ['d', 'w', 'm'].includes(skUi.iv) ? skUi.iv : 'd';
  return [
    seg([['d', '일'], ['w', '주'], ['m', '월']], iv, id => { skUi.iv = id; skPaneDraw(v, f); }, '막대 하나의 기간'),
    h('div', { class: 'mk-card sk-chart' }, candleChart(v, f, iv),
      h('p', { class: 'sk-cap' }, `막대 하나가 ${IV_BAR[iv]}예요. 빨강은 시작보다 오른 것, 파랑은 내린 것, 선은 평균 가격(이동평균)이에요.`)),
    skStats(f),
    skDaily(f),
  ];
}
function candleChart(v, f, iv) {
  const bs = skBars(f.d, iv);
  const legend = h('div', { class: 'sk-leg' });
  const box = h('div', { class: 'sk-cv', style: 'min-height:300px', role: 'img' });
  const wrap = h('div', {}, legend, box);
  if (bs.length < 2) { box.append(h('div', { class: 'mk-empty' }, '그릴 기록이 아직 부족해요.')); return wrap; }
  const mas = MA_SET.map(([n, col]) => ({ n, col, v: skMA(bs, n) }));
  const dirB = (b, prev) => (b.c > b.o ? 1 : b.c < b.o ? -1 : prev ? Math.sign(b.c - prev.c) : 0);
  const cls = x => (x > 0 ? 'up' : x < 0 ? 'dn' : 'eq');
  const fmtP = x => nf(x, 0);
  const lab = b => (iv === 'm' ? `${b.t.slice(2, 4)}.${+b.t.slice(5, 7)}` : md(b.t));
  const when = b => (iv === 'd' ? mdw(b.t) : iv === 'w' ? `${md(b.t)}~${md(b.t1)}` : `${b.t.slice(0, 4)}년 ${+b.t.slice(5, 7)}월`);
  let lastW = 0;
  const draw = () => {
    const W = Math.round(box.clientWidth || 0);
    if (W < 160 || W === lastW) return;
    lastW = W;
    box.textContent = '';
    const H = 300, pl = 4, pt = 16, PH = 196, vT = 228, vB = 274;
    const n = Math.min(bs.length, iv === 'm' ? 60 : Math.max(20, Math.min(iv === 'd' ? 90 : 70, Math.floor((W - 64) / (iv === 'd' ? 5 : 6)))));
    const s0 = bs.length - n, vis = bs.slice(s0);
    let hiI = 0, loI = 0;
    vis.forEach((b, i) => { if (b.h > vis[hiI].h) hiI = i; if (b.l < vis[loI].l) loI = i; });
    const mv = mas.map(m => ({ ...m, pts: m.v.slice(s0) })).filter(m => m.pts.filter(x => x != null).length >= 2);
    let lo = vis[loI].l, hi = vis[hiI].h;
    for (const m of mv) for (const x of m.pts) if (x != null) { lo = Math.min(lo, x); hi = Math.max(hi, x); }
    const span = hi - lo || hi * 0.02 || 1;
    lo -= span * 0.09; hi += span * 0.09;
    const ticks = niceTicks(lo, hi, 4);
    const last = vis[n - 1], dl = f.d[f.d.length - 1], dp = f.d[f.d.length - 2];
    const pr = Math.ceil(Math.max(44, Math.max(...ticks.map(t => fmtP(t).length), fmtP(last.c).length) * 6.4 + 12));
    const PW = W - pl - pr, slot = PW / n, bw = Math.max(1, Math.min(11, Math.round(slot * 0.64)));
    const X = i => Math.round(pl + slot * (i + 0.5));
    const Y = x => pt + (1 - (x - lo) / (hi - lo)) * PH;
    const vMax = Math.max(1, ...vis.map(b => b.v));
    const VY = x => vB - (x / vMax) * (vB - vT);
    const svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, 'aria-hidden': 'true', focusable: 'false' });
    const lastY = Y(last.c), lastDir = dp ? Math.sign(dl[4] - dp[4]) : 0; // 가격표 색은 일·주·월 상관없이 전날 대비
    const grid = sv('g', { class: 'grid' });
    for (const t of ticks) {
      const y = Math.round(Y(t)) + 0.5;
      if (y < pt - 2 || y > pt + PH + 2) continue;
      grid.append(sv('line', { x1: pl, x2: pl + PW, y1: y, y2: y }));
      if (Math.abs(y - lastY) > 13) grid.append(sv('text', { class: 'ylab', x: W - 3, y: y + 4, 'text-anchor': 'end' }, fmtP(t)));
    }
    grid.append(sv('line', { x1: pl, x2: pl + PW, y1: vB + 0.5, y2: vB + 0.5 }));
    svg.append(grid);
    const xi = [0, Math.round((n - 1) / 2), n - 1];
    xi.forEach((i, k) => svg.append(sv('text', { class: 'xlab', x: k === 0 ? pl : k === 2 ? pl + PW : X(i), y: H - 6, 'text-anchor': k === 0 ? 'start' : k === 2 ? 'end' : 'middle' }, lab(vis[i]))));
    svg.append(sv('text', { class: 'vlab', x: pl + 2, y: vT + 9 }, '거래량'), sv('text', { class: 'vlab', x: W - 3, y: vT + 9, 'text-anchor': 'end' }, cntStr(vMax)));
    const cg = sv('g', { class: 'cd' }), vg = sv('g', { class: 'vol' });
    vis.forEach((b, i) => {
      const c = cls(dirB(b, i ? vis[i - 1] : bs[s0 - 1] || null)), x = X(i);
      const yo = Y(b.o), yc = Y(b.c), top = Math.min(yo, yc);
      const xl = bw % 2 ? x + 0.5 : x;
      cg.append(sv('line', { class: c, x1: xl, x2: xl, y1: Y(b.h), y2: Y(b.l) }));
      cg.append(sv('rect', { class: c, x: x - Math.floor(bw / 2), y: top, width: bw, height: Math.max(1, Math.abs(yo - yc)) }));
      const vy = VY(b.v);
      vg.append(sv('rect', { class: c, x: x - Math.floor(bw / 2), y: vy, width: bw, height: Math.max(0.5, vB - vy) }));
    });
    svg.append(vg, cg);
    for (const m of mv) {
      let dd = '', pen = false;
      m.pts.forEach((x, i) => { if (x == null) { pen = false; return; } dd += `${pen ? 'L' : 'M'}${X(i)},${Y(x).toFixed(1)}`; pen = true; });
      svg.append(sv('path', { class: 'ma', d: dd, stroke: m.col }));
    }
    // 최고·최저 글자: 폭을 재서 차트 칸 안에 들어가는 쪽에 둬요. 양쪽 다 모자라면 날짜를 빼고, 그래도 모자라면 칸 끝에 맞춰요.
    const marks = [];
    const mark = (i, val, word) => {
      const x = X(i), y = Y(val), ln = sv('line', { y1: y, y2: y }), tx = sv('text', { y: y + 4 });
      const labels = [`${word} ${fmtP(val)} (${lab(vis[i])})`, `${word} ${fmtP(val)}`];
      marks.push(() => {
        const L = pl + 2, Rr = pl + PW - 2, pref = x < pl + PW * 0.55;
        let right = pref, len = 0;
        for (const t of labels) {
          tx.textContent = t;
          len = 0;
          try { len = tx.getComputedTextLength(); } catch { /* 화면에 없을 때 */ }
          if (!len) len = t.length * 6.6;
          const fitR = x + 13 + len <= Rr, fitL = x - 13 - len >= L;
          if (fitR || fitL) { right = pref ? fitR : !fitL; break; }
          right = Rr - x >= x - L;
        }
        const tx0 = right ? Math.min(x + 13, Rr - len) : Math.max(x - 13, L + len), gap = Math.abs(tx0 - x);
        tx.setAttribute('x', tx0); tx.setAttribute('text-anchor', right ? 'start' : 'end');
        ln.setAttribute('x1', x + (right ? 3 : -3)); ln.setAttribute('x2', x + (right ? 1 : -1) * Math.min(10, gap - 3));
        ln.style.display = gap >= 9 ? '' : 'none';
      });
      return sv('g', { class: 'mx' }, ln, tx);
    };
    svg.append(mark(hiI, vis[hiI].h, '최고'), mark(loI, vis[loI].l, '최저'));
    svg.append(sv('line', { class: 'lpl ' + cls(lastDir), x1: X(n - 1) + bw, x2: pl + PW, y1: Math.round(lastY) + 0.5, y2: Math.round(lastY) + 0.5 }));
    svg.append(sv('g', { class: 'lp ' + cls(lastDir) }, sv('rect', { x: pl + PW + 2, y: lastY - 9, width: pr - 3, height: 18, rx: 4 }),
      sv('text', { x: W - 4, y: lastY + 4, 'text-anchor': 'end' }, fmtP(last.c))));
    const xh = sv('g', { class: 'xh', style: 'display:none' }, sv('line', { y1: pt - 4, y2: vB }), sv('line', { class: 'hz', x1: pl, x2: pl + PW }));
    svg.append(xh);
    const tip = h('div', { class: 'mk-tip sk-tip', hidden: true });
    box.append(svg, tip);
    marks.forEach(fn => fn());
    legend.textContent = '';
    if (mv.length) legend.append(h('span', { class: 't' }, '이동평균'), ...mv.map(m => h('span', { class: 'it' }, h('i', { style: `background:${m.col}` }), `${m.n}${IV_UNIT[iv]}`)));
    box.setAttribute('aria-label', `${f.name} ${{ d: '일봉', w: '주봉', m: '월봉' }[iv]} ${n}개: ${when(vis[0])} 종가 ${fmtP(vis[0].c)}원에서 ${when(last)} 종가 ${fmtP(last.c)}원. ` +
      `이 기간 최고 ${fmtP(vis[hiI].h)}원(${when(vis[hiI])}), 최저 ${fmtP(vis[loI].l)}원(${when(vis[loI])}). 아래 '일별 시세 보기'에서 표로 볼 수 있어요.`);
    let hideT = 0;
    const show = ev => {
      clearTimeout(hideT);
      const r = svg.getBoundingClientRect();
      const px = ((ev.clientX - r.left) / r.width) * W;
      const i = Math.max(0, Math.min(n - 1, Math.floor((px - pl) / slot)));
      const b = vis[i], pb = i ? vis[i - 1] : bs[s0 - 1] || null, x = X(i);
      xh.style.display = '';
      xh.firstChild.setAttribute('x1', x); xh.firstChild.setAttribute('x2', x);
      xh.lastChild.setAttribute('y1', Y(b.c)); xh.lastChild.setAttribute('y2', Y(b.c));
      tip.textContent = '';
      const ch = pb ? b.c - pb.c : null;
      tip.append(h('span', {}, when(b)), h('b', { class: 'num' }, fmtP(b.c) + '원'),
        ch != null ? h('span', { class: 'num ' + dirOf(ch) }, `${arrow(ch)}${fmtP(Math.abs(ch))} (${pctStr((ch / pb.c) * 100)})`) : null,
        h('span', { class: 's num' }, `시 ${fmtP(b.o)} · 고 ${fmtP(b.h)} · 저 ${fmtP(b.l)}`),
        h('span', { class: 's num' }, `거래량 ${nf(b.v, 0)}주`));
      tip.hidden = false;
      const tw = tip.offsetWidth || 150;
      tip.style.left = Math.max(tw / 2 + 2, Math.min(W - tw / 2 - 2, x)) + 'px';
    };
    const hide = delay => { clearTimeout(hideT); hideT = setTimeout(() => { xh.style.display = 'none'; tip.hidden = true; }, delay); };
    svg.addEventListener('pointerdown', show);
    svg.addEventListener('pointermove', show);
    svg.addEventListener('pointerleave', () => hide(0));
    svg.addEventListener('pointercancel', () => hide(0));
    svg.addEventListener('pointerup', e => { if (e.pointerType !== 'mouse') hide(1800); });
  };
  if (typeof ResizeObserver === 'function') { const ro = new ResizeObserver(() => draw()); ro.observe(box); v.ros.push(ro); }
  requestAnimationFrame(draw);
  return wrap;
}
function skStats(f) {
  const d = f.d, L = d[d.length - 1];
  const from = addD(L[0], -365), yr = d.filter(r => r[0] > from);
  let hi = yr[0], lo = yr[0];
  for (const r of yr) { if (r[2] > hi[2]) hi = r; if (r[3] < lo[3]) lo = r; }
  const full = d[0][0] <= addD(L[0], -360);
  const kv = (k, val, sub) => h('div', {}, h('span', {}, k), h('b', {}, val, sub ? h('small', {}, sub) : null));
  return [
    h2('시세 한눈에', `${mdw(L[0])} 종가 기준`),
    h('div', { class: 'sk-rets', role: 'list', 'aria-label': '기간별 수익률' }, [['1개월', 1], ['3개월', 3], ['6개월', 6], ['1년', 12]].map(([k, mth]) => {
      const r = skRet(d, mth);
      return h('div', { role: 'listitem' }, h('span', {}, k), h('b', { class: r == null ? '' : dirOf(r) }, r == null ? '–' : pctStr(r)));
    })),
    h('div', { class: 'sk-kv' },
      kv(full ? '52주 최고' : '기록 중 최고', nf(hi[2], 0) + '원', md(hi[0])),
      kv(full ? '52주 최저' : '기록 중 최저', nf(lo[3], 0) + '원', md(lo[0])),
      fin(f.cap) ? kv('시가총액', wonBig(f.cap)) : null,
      fin(f.shares) ? kv('상장 주식 수', nf(f.shares, 0) + '주') : null,
      kv('거래량', nf(L[5], 0) + '주', md(L[0])),
      fin(f.amt) && f.amt > 0 ? kv('거래대금', wonBig(f.amt), md(L[0])) : null),
  ];
}
function skDaily(f) {
  const d = f.d.slice(-31);
  const btn = h('button', { class: 'mk-tgl', type: 'button', 'aria-expanded': 'false' }, '일별 시세 보기');
  const rows = d.slice(1).map((r, i) => { const pv = d[i][4], c = ((r[4] - pv) / pv) * 100; return h('tr', {}, h('td', {}, mdw(r[0])), h('td', {}, nf(r[4], 0)), h('td', { class: dirOf(c) }, pctStr(c)), h('td', {}, cntStr(r[5]))); }).reverse();
  const tbl = h('table', { class: 'mk-table', hidden: true }, h('thead', {}, h('tr', {}, h('th', {}, '날짜'), h('th', {}, '종가'), h('th', {}, '전날 대비'), h('th', {}, '거래량'))), h('tbody', {}, rows));
  btn.addEventListener('click', () => { click(); const open = tbl.hidden; tbl.hidden = !open; btn.setAttribute('aria-expanded', String(open)); btn.textContent = open ? '일별 시세 접기' : '일별 시세 보기'; });
  return [btn, tbl];
}

/* 회사 정보 탭 */
function siteUrl(u) {
  let s = String(u || '').trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  try { const x = new URL(s); return /^https?:$/.test(x.protocol) ? x : null; } catch { return null; }
}
function miniBars(title, yrs, vals) {
  const W = 150, H = 112, top = 22, bot = 86, pl = 4;
  const ok = vals.map(x => (fin(x) ? x : null)), have = ok.filter(x => x != null);
  const mx = Math.max(0, ...have), mn = Math.min(0, ...have), rng = mx - mn || 1;
  const Y = x => top + ((mx - x) / rng) * (bot - top), y0 = Y(0);
  const svg = sv('svg', { class: 'sk-mb', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `${title}: ` + yrs.map((y, i) => `${y}년 ${ok[i] == null ? '자료 없음' : wonBig(ok[i])}`).join(', ') });
  const slot = (W - pl * 2) / yrs.length, bw = Math.min(26, slot * 0.42);
  ok.forEach((x, i) => {
    const cx = pl + slot * (i + 0.5);
    svg.append(sv('text', { class: 'yr', x: cx, y: H - 4, 'text-anchor': 'middle' }, `${String(yrs[i]).slice(2)}년`));
    if (x == null) { svg.append(sv('text', { class: 'na', x: cx, y: y0 - 6, 'text-anchor': 'middle' }, '–')); return; }
    const y = Y(x), yT = Math.min(y, y0), hh = Math.max(1.5, Math.abs(y - y0));
    svg.append(sv('rect', { class: (x < 0 ? 'neg' : 'pos') + (i === ok.length - 1 ? ' last' : ''), x: cx - bw / 2, y: yT, width: bw, height: hh, rx: 3 }));
    svg.append(sv('text', { class: 'val', x: cx, y: x < 0 ? yT + hh + 11 : yT - 5, 'text-anchor': 'middle' }, wonBig(x, '')));
  });
  svg.append(sv('line', { class: 'base', x1: pl, x2: W - pl, y1: y0, y2: y0 }));
  return h('div', { class: 'sk-mbw' }, h('b', {}, title), svg);
}
function skCompany(v, f) {
  const co = isObj(f.co) ? f.co : null, fi = isObj(f.fin) ? f.fin : null, x = isObj(f.x) ? f.x : {};
  if (!co && !fi) return h('div', { class: 'mk-card' }, h('div', { class: 'mk-empty' }, h('b', {}, '회사 정보를 아직 못 받았어요'), '전자공시(OpenDART) 자료가 들어오면 여기에 보여요.'));
  const pref = isPref(f.code), L = f.d[f.d.length - 1];
  const out = [];
  if (fi) {
    const ni = lastOf(fi.ni), eq = lastOf(fi.eq);
    const per = pref || ni == null || !fin(f.cap) ? null : ni > 0 ? f.cap / ni : -1;
    const pbr = pref || !(eq > 0) || !fin(f.cap) ? null : f.cap / eq;
    const roe = ni != null && eq > 0 ? (ni / eq) * 100 : null;
    const dy = !pref && fin(x.dps) && x.dps >= 0 && x.fy === fi.fy ? (x.dps / L[4]) * 100 : null;
    const met = (k, val, sub) => h('div', { class: 'sk-met' }, h('span', {}, k), h('b', { class: 'num' }, val), h('small', {}, sub));
    out.push(h2('투자 지표', `${fi.fy}년 결산 숫자와 ${md(L[0])} 종가로 계산했어요`),
      h('div', { class: 'sk-mets' },
        met('PER', per == null ? '–' : per < 0 ? '적자' : nf(per, 1) + '배', '주가 ÷ 1주당 순이익'),
        met('PBR', pbr == null ? '–' : nf(pbr, 2) + '배', '주가 ÷ 1주당 순자산'),
        met('ROE', roe == null ? '–' : nf(roe, 1) + '%', '자기 돈(자본)으로 낸 이익률'),
        met('배당수익률', dy == null ? '–' : nf(dy, 2) + '%', fin(x.dps) && x.fy === fi.fy && !pref ? `1주당 ${nf(x.dps, 0)}원 (${x.fy}년)` : '주가 대비 1년 배당')),
      pref ? h('p', { class: 'mk-note' }, '우선주는 회사 전체 이익과 바로 비교하기 어려워서 PER·PBR·배당수익률은 빼고 보여줘요.') : null);
  }
  if (co) {
    const kv = (k, val, cls) => (val ? h('div', { class: cls || null }, h('span', {}, k), h('b', {}, val)) : null);
    const est = DATE_RE.test(co.est || '') ? (([y, m, dd]) => `${y}년 ${+m}월 ${+dd}일`)(co.est.split('-')) : '';
    const site = siteUrl(co.url);
    out.push(h2('기본 정보', '전자공시(OpenDART) 회사 개황'),
      h('div', { class: 'sk-kv' },
        kv('대표이사', co.ceo), kv('업종', co.ind), kv('설립일', est), kv('결산월', /^\d{1,2}$/.test(co.acc || '') ? `${+co.acc}월` : ''),
        kv('시장', MKT_KO[f.mkt] || ''), fin(f.shares) ? kv('상장 주식 수', nf(f.shares, 0) + '주') : null,
        site ? h('div', {}, h('span', {}, '홈페이지'), h('b', {}, h('a', { href: site.href, target: '_blank', rel: 'noopener noreferrer' }, site.hostname.replace(/^www\./, '')))) : null,
        kv('주소', co.addr, 'full')));
  }
  if (fi && Array.isArray(fi.years) && fi.years.length === 3) {
    const yrs = fi.years, g = k => (Array.isArray(fi[k]) ? fi[k].map(x => (fin(x) ? x : null)) : [null, null, null]);
    const rev = g('rev'), op = g('op'), ni = g('ni'), as = g('assets'), lb = g('liab'), eq = g('eq');
    const ratio = (a, b) => a.map((x, i) => (x != null && b[i] > 0 ? (x / b[i]) * 100 : null));
    const opm = ratio(op, rev), debt = ratio(lb, eq);
    const money = a => a.map(x => (x == null ? '–' : wonBig(x, '')));
    const pct = a => a.map(x => (x == null ? '–' : nf(x, 1) + '%'));
    const rows = [['매출액', money(rev)], ['영업이익', money(op)], ['영업이익률', pct(opm)], ['순이익', money(ni)], ['자산총계', money(as)], ['부채총계', money(lb)], ['자본총계', money(eq)], ['부채비율', pct(debt)]];
    out.push(h2('실적 3년', `사업보고서 · ${fi.fs === 'CFS' ? '연결' : '별도'} 재무제표`),
      h('div', { class: 'sk-mbs' }, miniBars('매출액', yrs, rev), miniBars('영업이익', yrs, op)),
      h('div', { class: 'sk-tw' }, h('table', { class: 'sk-t' },
        h('thead', {}, h('tr', {}, h('th', {}, '구분'), yrs.map(y => h('th', {}, `${y}년`)))),
        h('tbody', {}, rows.map(([k, vals]) => h('tr', {}, h('th', {}, k), vals.map(s => h('td', { class: s.startsWith('−') ? 'dn' : '' }, s))))))),
      h('p', { class: 'mk-note' }, '단위: 억·조원. 영업이익률 = 영업이익 ÷ 매출액, 부채비율 = 부채 ÷ 자본.'));
  }
  const hold = Array.isArray(x.hold) ? x.hold.filter(r => Array.isArray(r) && typeof r[0] === 'string' && fin(r[1]) && r[1] > 0).slice(0, 6) : [];
  if (hold.length) {
    const mx = Math.max(...hold.map(r => r[1]));
    out.push(h2('주요 주주', `${x.fy}년 사업보고서 · 최대주주와 특수관계인 · 보통주`),
      h('div', { class: 'sk-hold' }, hold.map(([nm, q]) => h('div', {}, h('span', {}, nm), h('i', {}, h('em', { style: `width:${Math.max(3, (q / mx) * 100)}%` })), h('b', {}, nf(q, 2) + '%')))));
  }
  return out;
}

/* 경쟁사 비교 탭 */
const PEER_METS = [
  ['cap', '시가총액', r => r.cap, x => wonBig(x, '')],
  ['rev', '매출액', r => r.rev, x => wonBig(x, '')],
  ['op', '영업이익', r => r.op, x => wonBig(x, '')],
  ['roe', 'ROE', r => r.roe, x => nf(x, 1) + '%'],
  ['per', 'PER', r => (r.per > 0 ? r.per : null), x => nf(x, 1) + '배', true],
  ['r1y', '1년 수익률', r => (r.r1y == null ? null : r.r1y * 100), x => pctStr(x)],
];
function skRank(rows, m) {
  const ok = rows.filter(r => fin(m[2](r)));
  const me = rows.find(r => r.me);
  if (!me || !fin(m[2](me)) || ok.length < 2) return null;
  ok.sort((a, b) => (m[4] ? m[2](a) - m[2](b) : m[2](b) - m[2](a)));
  return { rank: ok.indexOf(me) + 1, n: ok.length };
}
function peerBars(rows, m) {
  const vals = rows.map(m[2]), have = vals.filter(fin);
  const mx = Math.max(0, ...have), mn = Math.min(0, ...have), rng = mx - mn || 1, z = ((0 - mn) / rng) * 100;
  return h('div', { class: 'sk-hb', role: 'list', 'aria-label': `${m[1]} 비교` }, rows.map((r, i) => {
    const x = vals[i], w = fin(x) ? (Math.abs(x) / rng) * 100 : 0, left = !fin(x) || x >= 0 ? z : z - w;
    const txt = fin(x) ? m[3](x) : m[0] === 'per' && r.per === -1 ? '적자' : '–';
    return h('div', { class: 'sk-hbr' + (r.me ? ' me' : ''), role: 'listitem', 'aria-label': `${r.name} ${txt}` },
      h('span', { class: 'nm' }, logoEl(r.name, { code: r.code, size: 20 }), h('span', {}, r.name)),
      h('span', { class: 'tr', 'aria-hidden': 'true' }, fin(x) ? h('i', { style: `left:${left.toFixed(2)}%;width:${Math.max(w, 0.8).toFixed(2)}%` }) : null, mn < 0 ? h('em', { style: `left:${z.toFixed(2)}%` }) : null),
      h('b', { class: 'num' }, txt));
  }));
}
function skPeers(v, f) {
  const rows = skPeerRows(f);
  if (rows.length < 2) return h('div', { class: 'mk-card' }, h('div', { class: 'mk-empty' }, h('b', {}, '비교할 회사를 아직 못 찾았어요'), '같은 업종 회사 자료가 들어오면 여기에 보여요.'));
  const ind = isObj(f.co) && f.co.ind ? f.co.ind : '같은 업종';
  const fy = isObj(f.fin) && f.fin.fy ? f.fin.fy : null;
  const ranks = PEER_METS.map(m => [m, skRank(rows, m)]).filter(([, r]) => r);
  const money = x => (x == null ? '–' : wonBig(x, ''));
  const pctOr = x => (x == null ? '–' : nf(x, 1) + '%');
  const growStr = x => (x == null ? '–' : typeof x === 'string' ? x : pctStr(x));
  const growCls = x => (typeof x === 'number' ? dirOf(x) : x === '흑자전환' ? 'up' : x === '적자전환' || x === '적자지속' ? 'dn' : '');
  const T = [
    ['종가', r => (r.c == null ? '–' : nf(r.c, 0) + '원')],
    ['시가총액', r => money(r.cap)], ['매출액', r => money(r.rev)], ['영업이익', r => money(r.op), r => (r.op < 0 ? 'dn' : '')], ['순이익', r => money(r.ni), r => (r.ni < 0 ? 'dn' : '')],
    ['PER', r => (r.per == null ? '–' : r.per < 0 ? '적자' : nf(r.per, 1) + '배')], ['PBR', r => (r.pbr == null ? '–' : nf(r.pbr, 2) + '배')],
    ['ROE', r => pctOr(r.roe)], ['영업이익률', r => pctOr(r.opm)],
    ['매출 증가율', r => growStr(r.rg), r => growCls(r.rg)], ['영업이익 증가율', r => growStr(r.og), r => growCls(r.og)], ['순이익 증가율', r => growStr(r.ng), r => growCls(r.ng)],
    ['1개월 수익률', r => (r.r1m == null ? '–' : pctStr(r.r1m * 100)), r => (r.r1m == null ? '' : dirOf(r.r1m))],
    ['1년 수익률', r => (r.r1y == null ? '–' : pctStr(r.r1y * 100)), r => (r.r1y == null ? '' : dirOf(r.r1y))],
  ];
  const met = PEER_METS.find(m => m[0] === skUi.met) || PEER_METS[0];
  return [
    h('p', { class: 'mk-lead sk-lead' }, `${ind} 업종에서 시가총액이 큰 회사 ${rows.length - 1}곳과 비교해요.`),
    ranks.length ? h('div', { class: 'sk-ranks', role: 'list', 'aria-label': `${rows.length}곳 중 순위` }, ranks.map(([m, r]) =>
      h('span', { role: 'listitem' }, `${m[1]}${m[4] ? ' 낮은 순' : ''} `, h('b', {}, `${r.rank}위`), `/${r.n}`))) : null,
    h('div', { class: 'sk-tw sk-peer' }, h('table', { class: 'sk-t' },
      h('thead', {}, h('tr', {}, h('th', {}, '구분'), rows.map(r => h('th', { class: r.me ? 'me' : null }, h('span', { class: 'co' }, logoEl(r.name, { code: r.code, size: 22 }), h('span', {}, r.name)))))),
      h('tbody', {}, T.map(([k, fv, fc]) => h('tr', {}, h('th', {}, k), rows.map(r => h('td', { class: [r.me ? 'me' : '', fc ? fc(r) : ''].filter(Boolean).join(' ') || null }, fv(r)))))))),
    h('p', { class: 'mk-note' }, `${fy ? fy + '년 ' : ''}사업보고서 기준이고, 수익률은 1개월·1년 전 종가와 비교했어요. 단위: 억·조원, 배, %. 표는 옆으로 밀어서 볼 수 있어요.`),
    h2('그래프로 비교', '이 회사는 노란 막대예요'),
    chipRow(PEER_METS.map(m => [m[0], m[1]]), met[0], id => { skUi.met = id; skPaneDraw(v, f); }, '비교할 숫자 고르기', 'sk-mets-pick'),
    peerBars(rows, met),
    h('p', { class: 'mk-note' }, '같은 업종은 통계청 산업분류로 골라서 증권사 앱의 경쟁사 목록과 다를 수 있어요. 우선주는 PER·PBR을 빼요.'),
  ];
}

/* ---------- 새 탭 공용 도우미 ---------- */
function seenSet() { try { const a = JSON.parse(localStorage.getItem(SEEN_KEY) || '[]'); return new Set(Array.isArray(a) ? a : []); } catch { return new Set(); } }
function markSeen(id) { try { const s = seenSet(); if (s.has(id)) return; s.add(id); localStorage.setItem(SEEN_KEY, JSON.stringify([...s])); } catch { /* 무시 */ } }
// 1234567 → "123만 4,567원", 750000 → "75만 원"
function korWon(v) {
  const a = Math.round(Math.abs(Number(v) || 0)), eokN = Math.floor(a / 1e8), man = Math.floor((a % 1e8) / 1e4), won = a % 1e4, parts = [];
  if (eokN) parts.push(eokN.toLocaleString('ko-KR') + '억');
  if (man) parts.push(man.toLocaleString('ko-KR') + '만');
  if (won || !parts.length) parts.push(won.toLocaleString('ko-KR'));
  return parts.join(' ') + (won || !eokN && !man ? '원' : ' 원');
}
function goTab(id, label) {
  return h('button', { class: 'mk-go', type: 'button', onclick: () => { click(); ui.tab = id; renderPane(true); } }, label, ' →');
}
const lead = (t, fb) => h('p', { class: 'mk-lead' }, t || fb);
function chipRow(opts, cur, onPick, label, cls) {
  return h('div', { class: 'mk-chips mk-pick' + (cls ? ' ' + cls : ''), role: 'group', 'aria-label': label || null }, opts.map(([v, text]) =>
    h('button', { type: 'button', class: 'mk-chip' + (v === cur ? ' on' : ''), 'aria-pressed': String(v === cur), onclick: e => { if (v === cur) return; click(); onPick(v, e); } }, text)));
}

/* ----- 탭 7: 연결고리 ----- */
function paneChain(d) {
  const c = d.chain || {};
  return [
    lead(c.intro, '어제 일어난 일이 어디까지 번졌는지 순서대로 따라가 봐요.'),
    (c.items || []).filter(x => x && Array.isArray(x.steps)).map((ch, ci) => {
      const steps = ch.steps.filter(s => s && s.t);
      return h('div', { class: 'mk-card mk-chain', 'data-pk': ci < 3 ? 'chain' + (ci + 1) : null },
        h('h3', {}, h('i', { 'aria-hidden': 'true' }, ch.icon || '🔗'), ch.title || ''),
        ch.when ? h('div', { class: 'when' }, ch.when) : null,
        h('ol', { class: 'steps' }, steps.map((s, i) => {
          const dc = fin(s.dir) ? dirOf(s.dir) : 'eq';
          return h('li', { class: i === steps.length - 1 ? 'last' : '' },
            h('span', { class: 'node ' + dc, 'aria-hidden': 'true' }, i + 1),
            h('div', { class: 'tx' }, h('b', {}, s.t), s.s ? h('small', {}, s.s) : null),
            s.v ? h('span', { class: 'v num ' + dc }, s.v) : null);
        })),
        ch.take ? h('div', { class: 'mk-mine' }, h('b', {}, '한 줄 정리'), ch.take) : null);
    }),
    sourcesEl(c.sources),
  ];
}

/* ----- 탭 8: 내 지갑 ----- */
const FX_SYM = { USD: ['$', ''], JPY: ['¥', ''], EUR: ['€', ''], CNY: ['', '위안'] };
const FX_PRE = { USD: [100, 500, 1000], JPY: [10000, 50000, 100000], EUR: [100, 500, 1000], CNY: [500, 1000, 5000] };
const fxAmtStr = (id, v) => { const [a, b] = FX_SYM[id] || ['', '']; return a + nf(v, 0) + b; };
function fxCalc(fx, w) {
  if (!fx.some(x => x.id === ui.fxCur)) ui.fxCur = fx[0].id;
  const card = h('div', { class: 'mk-card mk-fxc', 'data-pk': 'fx' });
  const draw = () => {
    const c = fx.find(x => x.id === ui.fxCur) || fx[0];
    const pre = FX_PRE[c.id] || [100, 1000, 10000];
    if (!fin(ui.fxAmt[c.id])) ui.fxAmt[c.id] = pre[pre.length - 1];
    const input = h('input', { class: 'num', type: 'text', inputmode: 'decimal', autocomplete: 'off', 'aria-label': `${c.name} 금액` });
    input.value = String(ui.fxAmt[c.id]);
    const res = h('div', { class: 'res', 'aria-live': 'polite' });
    const calc = () => {
      const amt = ui.fxAmt[c.id] || 0, krw = (amt / c.per) * c.rate;
      res.textContent = '';
      res.append(h('b', { class: 'num' }, `≈ ${nf(Math.round(krw), 0)}원`));
      if (fin(c.prev)) {
        const diff = (amt / c.per) * (c.rate - c.prev);
        res.append(h('span', { class: 'num ' + dirOf(Math.round(diff)) }, `${c.prevLabel || w.prevLabel || '한 달 전'}보다 ${Math.round(diff) >= 0 ? '+' : '−'}${nf(Math.abs(Math.round(diff)), 0)}원`));
      }
    };
    input.addEventListener('input', () => { const v = parseFloat(input.value.replace(/[^0-9.]/g, '')); ui.fxAmt[c.id] = fin(v) ? v : 0; calc(); });
    card.textContent = '';
    card.append(
      h('div', { class: 'mk-h2', style: 'margin:0 0 2px' }, '환율 계산기', h('small', {}, '해외여행·직구 결제 금액을 원화로 바꿔 봐요')),
      chipRow(fx.map(x => [x.id, `${x.flag || ''} ${x.name}`]), c.id, v => { ui.fxCur = v; draw(); }, '통화 고르기'),
      h('div', { class: 'in' }, h('span', { class: 'sym' }, (FX_SYM[c.id] || [''])[0] || ''), input, h('span', { class: 'sym' }, (FX_SYM[c.id] || ['', ''])[1] || '')),
      chipRow(pre.map(v => [v, fxAmtStr(c.id, v)]), ui.fxAmt[c.id], v => { ui.fxAmt[c.id] = v; draw(); }, '자주 쓰는 금액', 'sm'),
      res,
      h('p', { class: 'mk-note' }, `${c.per === 1 ? '1' : nf(c.per, 0)}${(FX_SYM[c.id] || ['', ''])[1] || ''} ${c.name} = ${nf(c.rate, 2)}원 (${w.fxLabel || '매매기준율'}). 실제로 카드를 쓰거나 환전할 땐 수수료가 더 붙어요.`));
    calc();
  };
  draw();
  return card;
}
function walletItem(x) {
  const num = fin(x.value);
  const dp = fin(x.dp) ? x.dp : num && x.value % 1 ? (x.value < 100 ? 2 : 1) : 0;
  const ch = num && fin(x.prev) ? x.value - x.prev : fin(x.chg) ? x.chg : null;
  const chPct = ch != null && fin(x.prev) && x.prev ? (ch / x.prev) * 100 : fin(x.pct) ? x.pct : null;
  return h('div', { class: 'mk-card mk-wi' },
    h('div', { class: 'hd' }, h('span', { class: 'ic', 'aria-hidden': 'true' }, x.icon || '•'), h('b', {}, x.name)),
    h('div', { class: 'val num' }, num ? nf(x.value, dp) : x.text || '', num && x.unit ? h('small', {}, x.unit) : null),
    x.sub ? h('div', { class: 'sub' }, x.sub) : null,
    ch != null ? h('div', { class: 'chg num ' + dirOf(ch) }, `${x.prevLabel || '이전'}보다 ${arrow(ch)}${nf(Math.abs(ch), dp)}${String(x.unit || '').split('/')[0]}${chPct != null ? ` (${pctStr(chPct)})` : ''}`) : null,
    x.note ? h('p', {}, x.note) : null,
    x.d ? h('div', { class: 'd' }, x.d) : null);
}
function loanCalc(w) {
  const card = h('div', { class: 'mk-card mk-loan', 'data-pk': 'loan' });
  const amts = [[10000, '1억'], [20000, '2억'], [30000, '3억'], [50000, '5억']];
  const drs = [[0.25, '+0.25%p'], [0.5, '+0.5%p'], [1, '+1%p'], [-0.25, '−0.25%p']];
  const draw = () => {
    const amt = ui.loan * 1e4, yr = (amt * ui.dr) / 100, mo = yr / 12;
    card.textContent = '';
    card.append(
      h('div', { class: 'mk-h2', style: 'margin:0 0 2px' }, '금리가 바뀌면 내 이자는?', h('small', {}, w.loanNote || '변동금리 대출을 단순 계산했어요')),
      h('div', { class: 'lab' }, '대출 금액'), chipRow(amts, ui.loan, v => { ui.loan = v; draw(); }, '대출 금액', 'g4'),
      h('div', { class: 'lab' }, '금리 변화'), chipRow(drs, ui.dr, v => { ui.dr = v; draw(); }, '금리 변화', 'g4'),
      h('div', { class: 'res', 'aria-live': 'polite' },
        h('span', {}, `${korWon(amt)} 대출, 금리 ${ui.dr > 0 ? '+' : '−'}${nf(Math.abs(ui.dr), 2)}%p면`),
        h('b', { class: 'num ' + dirOf(ui.dr) }, `1년 이자 ${ui.dr > 0 ? '+' : '−'}${korWon(yr)}`),
        h('span', { class: 'num' }, `한 달에 약 ${ui.dr > 0 ? '+' : '−'}${korWon(Math.round(mo / 10) * 10)}`)),
      h('p', { class: 'mk-note' }, '원금 그대로, 이자만 계산했어요. 상환 방식·우대금리·금리 변경 주기에 따라 실제 금액은 달라요.'));
  };
  draw();
  return card;
}
function paneWallet(d) {
  const w = d.wallet || {};
  const fx = (w.fx || []).filter(x => x && x.id && x.name && fin(x.rate) && fin(x.per) && x.per > 0);
  const items = (w.items || []).filter(x => x && x.name);
  return [
    lead(w.intro, '시장 숫자가 내 생활비에 어떻게 닿는지 모았어요.'),
    fx.length ? fxCalc(fx, w) : null,
    items.length ? [h2('생활 속 숫자', w.label || '숫자마다 기준일이 달라요'), h('div', { class: 'mk-wal', 'data-pk': 'walletItems' }, items.map(walletItem))] : null,
    loanCalc(w),
    Array.isArray(w.tips) && w.tips.length ? [h2('알아두면 좋은 것'), h('div', { class: 'mk-card', 'data-pk': 'tips' }, h('ul', { class: 'mk-bul' }, w.tips.map(t => h('li', {}, t))))] : null,
    sourcesEl(w.sources),
  ];
}

/* ----- 탭 9: 만약에 ----- */
function backCalc(d, w) {
  const card = h('div', { class: 'mk-card mk-bc', 'data-pk': 'back' });
  const build = () => {
    const m = d.markets[ui.wfMkt] || d.markets.kospi;
    const ser = (m.series || []).filter(x => Array.isArray(x) && fin(x[1]));
    card.textContent = '';
    card.append(h('div', { class: 'mk-h2', style: 'margin:0 0 2px' }, '그때 샀다면 지금은?', h('small', {}, '지수를 그대로 따라간다고 가정했어요')),
      seg(MKTS, ui.wfMkt, id => { ui.wfMkt = id; ui.wfStart = null; build(); }, '시장 고르기'));
    if (ser.length < 3) { card.append(h('p', { class: 'mk-note' }, '계산할 데이터가 부족해요.')); return; }
    const last = ser.length - 1;
    if (!Number.isInteger(ui.wfStart) || ui.wfStart < 0 || ui.wfStart > last - 1) ui.wfStart = 0;
    const amtRow = h('div');
    const when = h('div', { class: 'when' });
    const range = h('input', { type: 'range', min: 0, max: last - 1, step: 1, 'aria-label': '산 날짜 고르기' });
    range.value = String(ui.wfStart);
    const quick = h('div', { class: 'mk-chips mk-pick sm' });
    const res = h('div', { class: 'res', 'aria-live': 'polite' });
    const chart = h('div', { class: 'mini' });
    const stats = h('div', { class: 'stats' });
    const W = 300, H = 74, P = 4;
    const vals = ser.map(x => x[1]), lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || 1;
    const X = i => P + (i / last) * (W - P * 2), Y = v => P + (1 - (v - lo) / span) * (H - P * 2);
    const pts = (a, b) => ser.slice(a, b + 1).map((x, k) => `${X(a + k).toFixed(1)},${Y(x[1]).toFixed(1)}`).join(' ');
    const upd = () => {
      const si = ui.wfStart, s0 = ser[si], e = ser[last], ratio = e[1] / s0[1], now = ui.wfAmt * ratio, diff = now - ui.wfAmt;
      const win = ser.slice(si), wv = win.map(x => x[1]);
      const hiI = si + wv.indexOf(Math.max(...wv)), loI = si + wv.indexOf(Math.min(...wv));
      when.textContent = `${mdw(s0[0])}에 샀다면 · ${last - si}거래일 동안`;
      res.textContent = '';
      res.append(h('span', {}, `${korWon(ui.wfAmt)} →`), h('b', { class: 'num' }, korWon(now)),
        h('span', { class: 'num ' + dirOf(diff) }, `${diff >= 0 ? '+' : '−'}${korWon(diff)} (${pctStr((ratio - 1) * 100)})`));
      chart.textContent = '';
      const svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', role: 'img', 'aria-label': `${m.name} ${md(s0[0])} ${nf(s0[1])}에서 ${md(e[0])} ${nf(e[1])}까지` });
      if (si > 0) svg.append(sv('polyline', { class: 'pre', points: pts(0, si) }));
      svg.append(sv('polyline', { class: 'win ' + dirOf(diff), points: pts(si, last) }));
      const dot = (cls, i, v) => h('i', { class: 'dot ' + cls, 'aria-hidden': 'true', style: `left:${((X(i) / W) * 100).toFixed(2)}%;top:${Y(v).toFixed(1)}px` });
      chart.append(svg, dot('s', si, s0[1]), dot('e', last, e[1]), h('div', { class: 'ax' }, h('span', {}, md(ser[0][0])), h('span', {}, md(e[0]))));
      stats.textContent = '';
      stats.append(
        h('div', {}, h('span', {}, '가장 많이 불었을 때'), h('b', { class: 'num' }, korWon((ui.wfAmt * ser[hiI][1]) / s0[1])), h('small', {}, mdw(ser[hiI][0]))),
        h('div', {}, h('span', {}, '가장 쪼그라들었을 때'), h('b', { class: 'num' }, korWon((ui.wfAmt * ser[loI][1]) / s0[1])), h('small', {}, mdw(ser[loI][0]))));
      quick.querySelectorAll('button').forEach(b => { const on = Number(b.dataset.i) === si; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
    };
    const amtChips = () => { amtRow.textContent = ''; amtRow.append(chipRow([[100000, '10만 원'], [1000000, '100만 원'], [10000000, '1,000만 원']], ui.wfAmt, v => { ui.wfAmt = v; amtChips(); upd(); }, '투자 금액')); };
    amtChips();
    const qs = [[0, '처음'], [Math.max(0, last - 10), '2주 전'], [Math.max(0, last - 5), '1주 전'], [last - 1, '어제']].filter((q, i, a) => a.findIndex(z => z[0] === q[0]) === i);
    qs.forEach(([i, t]) => quick.append(h('button', { type: 'button', class: 'mk-chip', 'data-i': i, onclick: () => { if (ui.wfStart === i) return; click(); ui.wfStart = i; range.value = String(i); upd(); } }, t)));
    range.addEventListener('input', () => { ui.wfStart = Number(range.value) || 0; upd(); });
    card.append(...[amtRow, when, range, quick, res, chart, stats,
      ui.wfMkt === 'nasdaq' && w.fxNote ? h('p', { class: 'mk-note fx' }, '💱 ', w.fxNote) : null,
      h('p', { class: 'mk-note' }, w.calcNote || '지난 결과일 뿐 앞으로를 뜻하지 않아요. 수수료·세금·배당은 빼고 계산했어요.')].filter(Boolean));
    upd();
  };
  build();
  return card;
}
function scCard(s, i) { // .map(scCard)로 불려서 i는 순서예요
  return h('div', { class: 'mk-card mk-sc', 'data-pk': i === 0 ? 'sc1' : i === 1 ? 'sc2' : null },
    h('div', { class: 'hd' }, h('span', { class: 'ic', 'aria-hidden': 'true' }, s.icon || '❓'), h('div', {}, h('b', {}, s.title || ''), s.d ? h('small', {}, s.d) : null)),
    s.base ? h('div', { class: 'base' }, s.base) : null,
    h('div', { class: 'cases' }, (s.cases || []).filter(c => c && c.k).map((c, i) => h('div', { class: 'case c' + i },
      h('b', {}, c.k), h('ul', {}, (c.p || []).map(t => h('li', {}, t)))))),
    s.mine ? h('div', { class: 'mk-mine' }, h('b', {}, 'Claude 생각'), s.mine) : null);
}
function paneWhatif(d) {
  const w = d.whatif || {};
  return [
    lead(w.intro, '“그때 샀다면?”과 “이번 주에 이렇게 되면?”을 미리 생각해 봐요.'),
    backCalc(d, w),
    Array.isArray(w.scenarios) && w.scenarios.length ? [h2('이번 주 변수, 이렇게 되면?', w.scNote || '보통 이런 쪽으로 반응해요 · 정답은 아니에요'), w.scenarios.filter(Boolean).map(scCard),
      pdOpen(d) ? h('div', { class: 'mk-cta' }, goTab('predict', '🎯 결과가 어떻게 나올지 맞혀 보기')) : null] : null,
    Array.isArray(w.rules) && w.rules.length ? [h2('알아두면 좋은 연결 법칙', w.rulesNote || '늘 그런 건 아니고, 보통 그런 경향이에요'),
      h('div', { class: 'mk-card mk-rules', 'data-pk': 'rules' }, w.rules.filter(r => r && r.a).map(r => h('div', { class: 'rl' }, h('b', {}, r.a), h('span', { class: 'ar', 'aria-hidden': 'true' }, '→'), h('span', {}, r.b || ''))))] : null,
    sourcesEl(w.sources),
  ];
}

/* ----- 탭 10: 용어 풀이 ----- */
function paneWords(d) {
  const wd = d.words || {};
  const items = (wd.items || []).filter(x => x && x.w && x.easy);
  const cats = ['전체', ...new Set(items.map(x => x.cat).filter(Boolean))];
  if (!cats.includes(ui.wcat)) ui.wcat = '전체';
  const shown = ui.wcat === '전체' ? items : items.filter(x => x.cat === ui.wcat);
  return [
    lead(wd.intro, '오늘 브리핑에 나온 어려운 말을 쉽게 풀었어요.'),
    chipRow(cats.map(c => [c, c === '전체' ? `전체 ${items.length}` : c]), ui.wcat, v => { ui.wcat = v; renderPane(false); }, '분류 고르기', 'flt'),
    h('div', { class: 'mk-words', 'data-pk': 'words' }, shown.map((x, wi) => h('div', { class: 'mk-card mk-wd', 'data-pk': wi === 5 && shown.length > 7 ? 'wordMid' : null },
      h('div', { class: 'hd' }, h('b', {}, x.w), x.cat ? h('span', { class: 'cat' }, x.cat) : null),
      h('p', {}, x.easy),
      x.ex ? h('div', { class: 'ex' }, h('b', {}, '오늘 브리핑에서'), x.ex) : null))),
    sourcesEl(wd.sources),
  ];
}

/* ----- 탭 11: 퀴즈 ----- */
function quizLoad() { try { const o = JSON.parse(localStorage.getItem(QUIZ_KEY) || '{}'); return o && typeof o === 'object' && !Array.isArray(o) ? o : {}; } catch { return {}; } }
function quizSave(o) {
  try { const ks = Object.keys(o).sort(); while (ks.length > 40) delete o[ks.shift()]; localStorage.setItem(QUIZ_KEY, JSON.stringify(o)); } catch { /* 저장 못 해도 계속 풀 수 있어요 */ }
}
function quizStreak(o, key, total) {
  const done = Object.keys(o).filter(k => DATE_RE.test(k) && Array.isArray(o[k]) && o[k].filter(x => x != null).length >= (k === key ? total : 1)).sort();
  if (!done.includes(key)) return 0;
  let n = 1;
  for (let i = done.indexOf(key); i > 0; i--) { if ((Date.parse(done[i]) - Date.parse(done[i - 1])) / 864e5 <= 4) n++; else break; }
  return n;
}
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function paneQuiz(d) {
  const qz = d.quiz || {};
  const items = (qz.items || []).filter(x => x && x.q && Array.isArray(x.opts) && x.opts.length >= 2 && Number.isInteger(x.a) && x.a >= 0 && x.a < x.opts.length);
  const key = (typeof qz.id === 'string' && qz.id) || (d.asof && d.asof.kr) || 'quiz';
  const wrap = h('div', { class: 'mk-quiz', 'data-pk': 'quiz' });
  const draw = () => {
    const st = quizLoad();
    const ans = Array.isArray(st[key]) ? st[key].slice(0, items.length) : [];
    const answered = ans.filter((x, i) => x != null && i < items.length).length;
    const score = items.reduce((s, q, i) => s + (ans[i] === q.a ? 1 : 0), 0);
    wrap.textContent = '';
    wrap.append(h('div', { class: 'mk-card qhd' },
      h('div', { class: 'tt' }, h('b', {}, qz.title || '오늘의 시장 퀴즈'), h('span', { class: 'num' }, `${answered}/${items.length}`)),
      h('div', { class: 'dots', 'aria-hidden': 'true' }, items.map((q, i) => h('i', { class: ans[i] == null ? '' : ans[i] === q.a ? 'ok' : 'no' }))),
      h('small', {}, qz.sub || '브리핑을 읽었다면 쉽게 풀 수 있어요. 동료랑 점수를 비교해 보세요!')));
    items.forEach((q, i) => {
      const picked = ans[i];
      const done = picked != null;
      wrap.append(h('div', { class: 'mk-card qq' + (done ? ' done' : '') },
        h('div', { class: 'qn' }, `Q${i + 1}`), h('h3', {}, q.q),
        h('div', { class: 'qopts' }, q.opts.map((o, j) => {
          const cls = !done ? '' : j === q.a ? ' ok' : j === picked ? ' no' : ' dim';
          return h('button', { type: 'button', class: 'qopt' + cls, disabled: done, 'aria-pressed': done ? String(j === picked) : null, onclick: () => {
            const s = quizLoad(); const a = Array.isArray(s[key]) ? s[key].slice(0, items.length) : [];
            if (a[i] != null) return;
            while (a.length < items.length) a.push(null);
            a[i] = j; s[key] = a; quizSave(s);
            try { if (!audioP) audioP = import('https://falling-rice-82e7.tactical7604.workers.dev/js/audio.js'); audioP.then(m => m && m.sfx && m.sfx(j === q.a ? 'correct' : 'wrong')).catch(() => {}); } catch { /* 소리 없이 */ }
            draw();
          } }, h('span', { class: 'mkr' }, done && j === q.a ? '✓' : done && j === picked ? '✕' : String.fromCharCode(65 + j)), h('span', {}, o));
        })),
        done ? h('div', { class: 'why' + (picked === q.a ? ' ok' : ' no') }, h('b', {}, picked === q.a ? '정답이에요! 🎉' : `아쉬워요. 정답은 ${String.fromCharCode(65 + q.a)}예요`), q.why || '') : null));
    });
    if (items.length && answered === items.length) {
      const ratio = score / items.length, streak = quizStreak(st, key, items.length);
      const msg = ratio === 1 ? '완벽해요! 오늘의 시장 박사 🏆' : ratio >= 0.6 ? '잘했어요! 시장 감각이 좋아요 👏' : '괜찮아요. 해설을 읽으면 내일은 더 잘할 거예요 💪';
      const again = h('button', { type: 'button', class: 'again' }, '다시 풀기');
      again.addEventListener('click', () => { click(); const s = quizLoad(); delete s[key]; quizSave(s); draw(); });
      wrap.append(h('div', { class: 'mk-card qres', 'data-pk': 'quizRes' },
        h('div', { class: 'sc num' }, `${score}`, h('small', {}, ` / ${items.length}`)), h('b', {}, msg),
        streak > 1 ? h('span', { class: 'stk' }, `🔥 ${streak}번 연속 다 풀었어요`) : null, again));
    }
    if (wrap.isConnected) { try { pkAttach(wrap); } catch (e) { console.warn('[market] peek', e); } } // 다 풀면 결과 카드 위에 캐릭터
  };
  draw();
  return [lead(qz.intro, '오늘 브리핑 내용으로 만든 퀴즈예요. 틀려도 해설이 있어요.'), wrap];
}

/* ----- 탭 12: 물어보면 ----- */
function paneAsk(d) {
  const a = d.ask || {};
  const items = (a.items || []).filter(x => x && x.q && Array.isArray(x.a) && x.a.length);
  return [
    lead(a.intro, '가족이나 손님이 물어보면 이렇게 설명해 보세요.'),
    h('div', { class: 'mk-asks', 'data-pk': 'ask' }, items.map((x, i) => {
      const dt = h('details', { class: 'mk-card mk-ask', 'data-pk': i === 3 ? 'ask4' : null },
        h('summary', {}, h('span', { class: 'q', 'aria-hidden': 'true' }, 'Q'), h('b', {}, x.q)),
        h('div', { class: 'ans' },
          x.short ? h('p', { class: 'short' }, h('span', { class: 'a', 'aria-hidden': 'true' }, 'A'), x.short) : null,
          h('ul', { class: 'mk-bul' }, x.a.map(t => h('li', {}, t))),
          x.tab && TABS.some(([id]) => id === x.tab) && (!NEED[x.tab] || NEED[x.tab](d)) ? goTab(x.tab, x.tabLabel || `${TABS.find(([id]) => id === x.tab)[1]} 탭에서 더 보기`) : null));
      if (i === 0) dt.open = true;
      dt.querySelector('summary').addEventListener('click', () => click());
      return dt;
    })),
    h('p', { class: 'mk-note' }, a.note || '상황을 설명하는 말이에요. “사세요/파세요” 같은 투자 권유는 하지 않아요.'),
    sourcesEl(a.sources),
  ];
}

/* ===================== 놀이: 이번 주 맞혀봐 · 동료 리그 ===================== */
// 서버 없이 이 폰에만 저장해요. 각자 폰에서 했으면 'HANA1-' 코드를 주고받아 모아요.
// 점수와 순위는 market.json(매일 아침 갱신)의 정답·종가로 계산해서, 같은 기록이면 어느 폰에서나 똑같이 나와요.
const PLAY_KEY = 'hanafam.market.play';
const LG_START = 10000000, LG_CHIPS = 10, LG_COST = 0.0025, LG_BONUS = 0.002;
const PD_PT = 10, PD_ALL = 10;
const GRP = { kr: ['#9085e9', '한국'], us: ['#199e70', '미국'], cmd: ['#c98500', '금'], fx: ['#d55181', '달러'] };
const KST_MS = 9 * 3600e3;
// util.js의 CHARS를 쓰고, 못 불러오면 같은 목록으로 해요(게임 파일 안에서만 쓰여요).
let chars = [['sanggyeong', '상경', '#F2A900'], ['gyeongmin', '경민', '#F2557A'], ['gyeongho', '경호', '#3D8BFD'], ['dahye', '다혜', '#F47A2A'], ['areum', '아름', '#9B6BF2'], ['sunyoung', '순영', '#13B394']]
  .map(([id, name, color]) => ({ id, name, color }));
let faceOf = id => `assets/chars/face_${id}.webp`;
let charsP = null;
function loadChars() {
  if (!charsP) charsP = import('https://falling-rice-82e7.tactical7604.workers.dev/js/util.js').then(m => {
    const list = Array.isArray(m.CHARS) ? m.CHARS.filter(c => c && /^[a-z0-9_]{1,24}$/.test(c.id || '') && c.name) : [];
    if (list.length) chars = list.map(c => ({ id: c.id, name: String(c.name), color: /^#[0-9a-f]{3,8}$/i.test(c.color || '') ? c.color : '#8aa5a1' }));
    if (typeof m.face === 'function') faceOf = m.face;
  }).catch(() => { /* 기본 목록 그대로 */ });
  return charsP;
}
const charOf = id => chars.find(c => c.id === id);
const jong = s => { const c = String(s).charCodeAt(String(s).length - 1); return c >= 0xac00 && c <= 0xd7a3 && (c - 0xac00) % 28 !== 0; };
const iga = s => s + (jong(s) ? '이' : '가');

/* ----- 저장 ----- */
const isObj = x => !!x && typeof x === 'object' && !Array.isArray(x);
function playLoad() {
  let o = null;
  try { o = JSON.parse(localStorage.getItem(PLAY_KEY) || 'null'); } catch { o = null; }
  if (!isObj(o)) o = {};
  if (!isObj(o.pl)) o.pl = {};
  if (!isObj(o.res)) o.res = {};
  return o;
}
function playSave(o) {
  try {
    const wks = Object.keys(o.res).filter(k => DATE_RE.test(k)).sort();
    while (wks.length > 26) delete o.res[wks.shift()];
    localStorage.setItem(PLAY_KEY, JSON.stringify(o));
  } catch { /* 저장 못 해도 화면은 그대로 */ }
}
function gameMe() { try { const v = JSON.parse(localStorage.getItem('hanafam.me') || 'null'); return typeof v === 'string' ? v : null; } catch { return null; } }
function actId(o) { const me = meId(), g = gameMe(); return charOf(o.act) ? o.act : me || (charOf(g) ? g : chars[0].id); }
const plOf = (o, id) => (isObj(o.pl[id]) ? o.pl[id] : null);
function plMut(o, id) {
  let p = plOf(o, id);
  if (!p) p = o.pl[id] = { src: 'local' };
  if (!isObj(p.pr)) p.pr = {};
  if (!Array.isArray(p.lg)) p.lg = [];
  return p;
}
const isGot = p => !!(p && p.src === 'code');
const hasPlay = p => !!(p && ((Array.isArray(p.lg) && p.lg.length) || (isObj(p.pr) && Object.values(p.pr).some(w => isObj(w) && Object.keys(w).length))));
function plTrim(p) {
  const wks = Object.keys(p.pr).filter(k => DATE_RE.test(k)).sort();
  while (wks.length > 26) delete p.pr[wks.shift()];
  if (p.lg.length > 60) p.lg = p.lg.slice(-60);
}

/* ----- 서버: 모두의 기록이 자동으로 모여요 (Cloudflare 워커 hana-league, v0.4.4) ----- */
// 각자 폰에서 고르면 바로 서버에 저장되고, 열 때마다 모두의 기록을 받아와요. 바꾸는 건 '이 폰 주인'으로 고른 사람 것만 돼요.
const SRV = 'https://hana-league.tactical7604.workers.dev';
const ME_KEY = 'hanafam.market.me';
const srv = { p: null, ok: 0, tried: 0, err: '', sent: 0, pushing: null, again: false };
function meId() { try { const v = JSON.parse(localStorage.getItem(ME_KEY) || 'null'); return typeof v === 'string' && charOf(v) ? v : null; } catch { return null; } }
function meSave(id) { try { if (id) localStorage.setItem(ME_KEY, JSON.stringify(id)); else localStorage.removeItem(ME_KEY); } catch { /* 저장 못 해도 이번엔 그대로 */ } }
const nowS = () => Math.floor(nowT() / 1000);
// 서버에서 온 기록을 앱 형식으로 다듬어요 (받은 코드 검사와 같은 규칙)
function recClean(j) {
  if (!isObj(j) || !fin(j.at)) return null;
  const pr = {};
  if (isObj(j.pr)) for (const [w, its] of Object.entries(j.pr).filter(([k]) => DATE_RE.test(k)).sort().slice(-8)) {
    if (!isObj(its)) continue;
    const o = {};
    for (const [id, v] of Object.entries(its).slice(0, 12)) if (/^[a-z0-9-]{1,24}$/.test(id) && Array.isArray(v) && Number.isInteger(v[0]) && v[0] >= 0 && v[0] < 6 && fin(v[1])) o[id] = [v[0], Math.floor(v[1])];
    if (Object.keys(o).length) pr[w] = o;
  }
  const lg = [];
  if (Array.isArray(j.lg)) for (const x of j.lg.slice(-60)) {
    if (!Array.isArray(x) || !fin(x[0]) || !isObj(x[1])) continue;
    const w = {}; let n = 0;
    for (const [k, v] of Object.entries(x[1]).slice(0, 40)) if (/^[a-z0-9]{1,16}$/.test(k) && Number.isInteger(v) && v > 0 && n + v <= LG_CHIPS && !w[k]) { w[k] = v; n += v; }
    lg.push([Math.floor(x[0]), w]);
  }
  lg.sort((a, b) => a[0] - b[0]);
  return { at: Math.floor(j.at), rev: Number.isInteger(j.rev) ? j.rev : 0, pr, lg };
}
const recEmpty = r => !r || (!r.lg.length && !Object.keys(r.pr).length);
async function srvCall(path, opt) {
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), 7000) : 0;
  try {
    const r = await fetch(SRV + path, { ...opt, credentials: 'omit', cache: 'no-store', signal: ctl ? ctl.signal : undefined });
    let j = null;
    try { j = await r.json(); } catch { j = null; }
    return { st: r.status, j };
  } catch { return { st: 0, j: null }; } finally { if (timer) clearTimeout(timer); }
}
// 모두의 기록 받기. 이 폰 기록이 바뀌었으면 true.
function srvPull(force) {
  if (srv.p) return srv.p;
  if (!force && Date.now() - srv.tried < 20e3) return Promise.resolve(false);
  srv.tried = Date.now();
  srv.p = (async () => {
    const { st, j } = await srvCall('/v1/all', { method: 'GET' });
    if (st !== 200 || !j || !isObj(j.p)) { srv.err = 'net'; return true; }
    const was = srv.err;
    srv.ok = Date.now(); srv.err = '';
    const o = playLoad(), me = meId();
    let ch = !!was, push = false;
    for (const c of chars) {
      const r = recClean(j.p[c.id]), cur = plOf(o, c.id), has = !!r && !recEmpty(r);
      if (c.id === me) {
        const mineAt = cur && fin(cur.at) ? cur.at : 0;
        if (has && (!hasPlay(cur) || r.at > mineAt)) {
          if (!cur || cur.at !== r.at || JSON.stringify([cur.pr, cur.lg]) !== JSON.stringify([r.pr, r.lg])) { o.pl[me] = { src: 'mine', at: r.at, pr: r.pr, lg: r.lg }; ch = true; }
        } else if (hasPlay(cur) && (!has || mineAt > r.at)) push = true;
        continue;
      }
      if (has) {
        if (!cur || cur.src !== 'srv' || cur.at !== r.at || cur.rev !== r.rev) { o.pl[c.id] = { src: 'srv', at: r.at, rev: r.rev, pr: r.pr, lg: r.lg }; ch = true; }
      } else if (cur && me) {
        // 서버에 없는 남의 기록(예전에 이 폰에서 대신 고른 것, 코드로 받은 것)은 화면에서 빼고 따로 보관만 해요
        if (!isObj(o.old)) o.old = {};
        o.old[c.id] = cur; delete o.pl[c.id]; ch = true;
      }
    }
    if (ch) playSave(o);
    if (push) srvPush();
    return ch;
  })().finally(() => { srv.p = null; });
  return srv.p;
}
// 내 기록 보내기. 다른 폰에서 더 나중에 바꾼 게 있으면 그걸로 맞춰요.
function srvPush() {
  const me = meId();
  if (!me) return Promise.resolve(false);
  if (srv.pushing) { srv.again = true; return srv.pushing; }
  srv.pushing = (async () => {
    const o = playLoad(), p = plOf(o, me);
    if (!p) return false;
    if (!fin(p.at) || p.src !== 'mine') { p.at = fin(p.at) ? p.at : nowS(); p.src = 'mine'; playSave(o); }
    const { st, j } = await srvCall('/v1/p/' + me, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ at: p.at, pr: isObj(p.pr) ? p.pr : {}, lg: (Array.isArray(p.lg) ? p.lg : []).slice(-60) }) });
    if (st === 200 && j && j.ok) { const was = srv.err; srv.err = ''; srv.sent = Date.now(); if (was) srvRerender(); return true; }
    if (st === 409 && j && j.cur) {
      const r = recClean(j.cur);
      if (r) { const q = playLoad(); q.pl[me] = { src: 'mine', at: r.at, pr: r.pr, lg: r.lg }; playSave(q); ui.lgDraft = null; toastMk('다른 폰에서 더 나중에 바꾼 기록으로 맞췄어요'); srvRerender(); }
      return false;
    }
    srv.err = 'push';
    srvRerender();
    return false;
  })().finally(() => { srv.pushing = null; if (srv.again) { srv.again = false; srvPush(); } });
  return srv.pushing;
}
function srvRerender() { if (panel && panel.shown && !skView && (ui.tab === 'league' || ui.tab === 'predict')) renderPane(false); }
function srvKick() { srvPull(false).then(ch => { if (ch) srvRerender(); }); }

/* ----- 시간 (한국시간 기준) ----- */
const nowT = () => Date.now();
const kDate = ms => new Date(ms + KST_MS).toISOString().slice(0, 10);
function addD(iso, n) { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); }
const wdOf = iso => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); };
const monOf = iso => addD(iso, -((wdOf(iso) + 6) % 7));
const wkS = wk => Date.parse(wk + 'T00:00:00+09:00');
const wkE = wk => wkS(addD(wk, 7));
const wkLab = wk => `${md(wk)}~${md(addD(wk, 4))}`;
function hmStr(ms) {
  const k = new Date(ms + KST_MS), H = k.getUTCHours(), M = k.getUTCMinutes();
  return `${H < 7 ? '새벽' : H < 12 ? '오전' : H < 18 ? '오후' : H < 21 ? '저녁' : '밤'} ${H % 12 || 12}${M ? ':' + String(M).padStart(2, '0') : '시'}`;
}
const whenStr = ms => `${mdw(kDate(ms))} ${hmStr(ms)}`;
function leftStr(ms) {
  const m = Math.max(0, ms - nowT()) / 60e3;
  if (m >= 2880) return `${Math.floor(m / 1440)}일 남음`;
  if (m >= 360) return `${Math.floor(m / 60)}시간 남음`;
  if (m >= 60) return `${Math.floor(m / 60)}시간 ${Math.floor(m % 60)}분 남음`;
  return `${Math.max(1, Math.floor(m))}분 남음`;
}
function usDst(y, m, d) {
  if (m < 3 || m > 11) return false;
  if (m > 3 && m < 11) return true;
  const sun1 = 1 + (7 - new Date(Date.UTC(y, m - 1, 1)).getUTCDay()) % 7;
  return m === 3 ? d >= sun1 + 7 : d < sun1;
}
// 그날 종가가 정해지는 시각. 한국 자산은 오후 3:30(금은 데이터의 close 시각), 미국은 현지 오후 4시.
function closeAt(iso, a) {
  const [y, m, d] = iso.split('-').map(Number);
  if (a.mkt === 'us') return Date.UTC(y, m - 1, d, usDst(y, m, d) ? 20 : 21, 0);
  const [hh, mi] = (/^\d{2}:\d{2}$/.test(a.close || '') ? a.close : '15:30').split(':').map(Number);
  return Date.UTC(y, m - 1, d, hh - 9, mi);
}
// 이 시각 뒤 첫 정규 마감(주말만 건너뛰어요. 휴장일은 데이터가 와야 알 수 있어요)
function schedNext(t, a) {
  for (let k = -1; k < 12; k++) {
    const iso = addD(kDate(t), k), wd = wdOf(iso);
    if (wd === 0 || wd === 6) continue;
    const c = closeAt(iso, a);
    if (c > t) return c;
  }
  return Infinity;
}

/* ----- 동료 리그 계산 ----- */
function refVal(d, ref) {
  if (typeof ref !== 'string') return NaN;
  const [k, nm] = ref.split(':');
  if (k === 'ticker') { const t = (d.ticker || []).find(x => x && x.id === nm); return t && fin(t.value) ? t.value : NaN; }
  const m = d.markets && d.markets[k], b = m && (m.big || []).find(x => x && x.name === nm);
  return b && fin(b.price) ? b.price : NaN;
}
const y1Ok = y => (isObj(y) && fin(y.lo) && fin(y.hi) && y.lo > 0 && y.hi > y.lo ? { lo: y.lo, hi: y.hi, d: DATE_RE.test(y.d || '') ? y.d : '' } : null);
function lgAssets(d) {
  const L = d && d.league;
  const ids = new Set();
  const out = (L && Array.isArray(L.assets) ? L.assets : []).filter(a => a && /^[a-z0-9]{1,16}$/.test(a.id || '') && a.name && (a.mkt === 'kr' || a.mkt === 'us') && !ids.has(a.id) && ids.add(a.id)).map(a => {
    let ser = a.src ? (d.markets && d.markets[a.src] && d.markets[a.src].series) || [] : a.hist || [];
    ser = ser.filter(x => Array.isArray(x) && DATE_RE.test(x[0]) && fin(x[1]) && x[1] > 0).map(x => [x[0], x[1]]);
    // 기준일 종가가 아직 hist에 없으면 같은 날 다른 섹션(big·ticker)에 있는 값을 이어 붙여요
    const asof = d.asof && d.asof[a.mkt], rv = a.src ? NaN : refVal(d, a.ref);
    if (fin(rv) && rv > 0 && DATE_RE.test(asof || '') && (!ser.length || ser[ser.length - 1][0] < asof)) ser.push([asof, rv]);
    ser.sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0));
    const cl = [];
    for (const [dt, v] of ser) if (!cl.length || cl[cl.length - 1].d !== dt) cl.push({ d: dt, t: closeAt(dt, a), v });
    return { id: a.id, name: String(a.name), icon: a.icon || '•', kind: a.kind || '', mkt: a.mkt, grp: GRP[a.grp] ? a.grp : a.mkt, cur: a.src ? '' : a.cur || (a.mkt === 'us' ? '$' : '원'), close: a.close, cl,
      y1: y1Ok(a.y1), sec: null, code: /^[0-9A-Z]{6}$/.test(a.code || '') ? a.code : null };
  });
  // 업종별 종목(stocks/league.json). 삼성전자·SK하이닉스처럼 이미 있는 자산은 업종만 붙이고, 아침 브리핑에 없는 날 종가만 채워요.
  const secs = lgSecs(), secName = new Map(secs.map(x => [x.id, x.name]));
  if (secs.length) for (const it of lgx.d.items) {
    if (!isObj(it) || !/^[a-z0-9]{1,16}$/.test(it.id || '') || !secName.has(it.sec) || !/^[0-9A-Z]{6}$/.test(it.code || '')) continue;
    const rows = (Array.isArray(it.c) ? it.c : []).filter(x => Array.isArray(x) && DATE_RE.test(x[0]) && fin(x[1]) && x[1] > 0).sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0));
    let a = out.find(x => x.id === it.id);
    if (a) {
      a.sec = it.sec; a.code = a.code || it.code; a.y1 = a.y1 || y1Ok(it.y1);
      const have = new Set(a.cl.map(c => c.d));
      const add = rows.filter(r => !have.has(r[0])).map(([dt, v]) => ({ d: dt, t: closeAt(dt, a), v }));
      if (add.length) a.cl = a.cl.concat(add).sort((x, y) => x.t - y.t);
      continue;
    }
    if (ids.has(it.id)) continue;
    ids.add(it.id);
    a = { id: it.id, name: String(it.n || '').slice(0, 14) || it.id, icon: typeof it.icon === 'string' && it.icon ? it.icon : '•', kind: secName.get(it.sec), mkt: 'kr', grp: 'kr', cur: '원', close: undefined, cl: [], y1: y1Ok(it.y1), sec: it.sec, code: it.code, late: true };
    for (const [dt, v] of rows) if (!a.cl.length || a.cl[a.cl.length - 1].d !== dt) a.cl.push({ d: dt, t: closeAt(dt, a), v });
    out.push(a);
  }
  return out.filter(a => a.cl.length);
}
// 바구니·목록을 업종별로 묶어요. 업종이 없는 자산(지수·미국·금·달러)은 맨 앞 '기본'으로.
function lgGroups(A) {
  const gs = [{ id: '', name: '지수·미국·금·달러', icon: '📌', list: A.filter(a => !a.sec) }];
  for (const x of lgSecs()) gs.push({ ...x, list: A.filter(a => a.sec === x.id) });
  return gs.filter(g => g.list.length);
}
// 저장 형식 [초, {자산: 칸}] → 계산용 {t(ms), w}
function lgOrders(p, A) {
  const ids = new Set(A.map(a => a.id));
  return (p && Array.isArray(p.lg) ? p.lg : []).filter(x => Array.isArray(x) && fin(x[0]) && isObj(x[1])).map(([t, w]) => {
    const o = {}; let n = 0;
    for (const [k, v] of Object.entries(w)) if (ids.has(k) && Number.isInteger(v) && v > 0 && n + v <= LG_CHIPS) { o[k] = v; n += v; }
    return { t: t * 1000, w: o };
  }).sort((x, y) => x.t - y.t);
}
const chipsSum = w => Object.values(w || {}).reduce((s, v) => s + v, 0);
function turnover(a, b) {
  a = a || {}; b = b || {};
  let s = 0;
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) s += Math.abs((b[k] || 0) - (a[k] || 0));
  return s / LG_CHIPS;
}
const fillOf = (t, a) => a.cl.find(c => c.t > t) || null;
// 비중을 그대로 지킨다고 보고 1원이 어떻게 변하는지 따라가요.
// 주문은 자산마다 '주문 뒤 첫 종가'부터 반영되고, 바꿀 때는 사고판 비율 × 0.25%를 빼요(첫 주문은 무료).
function lgSim(os, A, s, e) {
  const ev = [];
  for (const a of A) {
    const fills = os.map(o => { const f = fillOf(o.t, a); return f ? f.t : Infinity; });
    for (let j = 1; j < a.cl.length; j++) {
      const c = a.cl[j];
      if (c.t >= e) break;
      const pt = a.cl[j - 1].t;
      let w = 0;
      for (let k = 0; k < os.length; k++) if (fills[k] <= pt) w = (os[k].w[a.id] || 0) / LG_CHIPS;
      if (w) ev.push({ t: c.t, a: a.id, g: w * (c.v / a.cl[j - 1].v - 1) });
    }
  }
  for (let k = 1; k < os.length; k++) {
    if (os[k].t >= e) break;
    const tv = turnover(os[k - 1].w, os[k].w);
    if (tv) ev.push({ t: os[k].t, cost: tv * LG_COST });
  }
  ev.sort((x, y) => x.t - y.t);
  let V = 1, vs = null, cost = 0;
  const cont = {};
  for (let i = 0; i < ev.length;) {
    const t = ev[i].t;
    if (vs == null && t >= s) vs = V;
    let g = 0, cs = 0;
    const part = [];
    for (; i < ev.length && ev[i].t === t; i++) { const x = ev[i]; if (x.cost != null) cs += x.cost; else { g += x.g; part.push(x); } }
    if (t >= s) { for (const x of part) cont[x.a] = (cont[x.a] || 0) + V * x.g; cost += V * (1 + g) * cs; }
    V = V * (1 + g) * (1 - cs);
  }
  if (vs == null) vs = V;
  for (const k of Object.keys(cont)) cont[k] /= vs;
  return { r: V / vs - 1, cont, cost: cost / vs };
}
// 데이터가 이 주 시작 전부터 있어야 정확해요(처음 며칠은 체결 시각을 확인할 수 있을 때만 계산)
function lgCovered(os, A, s) {
  return A.every(a => a.cl[0].t < s || !os.some((o, k) => o.t < s && (o.w[a.id] || 0) !== ((os[k - 1] && os[k - 1].w[a.id]) || 0) && o.t < a.cl[0].t && schedNext(o.t, a) < a.cl[0].t));
}
function lgWeek(os, A, wk, T) {
  const s = wkS(wk), eF = wkE(wk), e = Math.min(eF, T), done = T >= eF;
  if (!os.some(o => o.t < e)) return null;
  // 이 주가 끝나기 전에 한 칸이라도 체결돼야 이 주 성적이 생겨요(일요일에 담으면 다음 주부터예요)
  const exposed = A.some(a => os.some(o => (o.w[a.id] || 0) > 0 && (fillOf(o.t, a) || { t: Infinity }).t < e));
  if (!exposed && done) return null;
  const before = os.filter(o => o.t < s), nIn = os.filter(o => o.t >= s && o.t < eF).length;
  const base = before.length ? before[before.length - 1].w : {};
  const inv = chipsSum(base) / LG_CHIPS, keep = before.length > 0 && !nIn;
  // n은 '바꾼 횟수'라서 이 주에 처음 담은 건 세지 않아요
  return { ...lgSim(os, A, s, e), n: before.length ? nIn : Math.max(0, nIn - 1), started: !before.length, done, inv, exposed, held: keep && inv > 0, bonus: done && keep ? LG_BONUS * inv : 0, covered: lgCovered(os, A, s) };
}
function lgRoll(os, A, T, n = 4) {
  const cur = monOf(kDate(T));
  let f = 1, k = 0, nn = 0, held = 0;
  for (let i = n - 1; i >= 0; i--) {
    const st = lgWeek(os, A, addD(cur, -7 * i), T);
    if (!st || !st.exposed || !st.covered) continue;
    f *= 1 + st.r + st.bonus; k++; nn += st.n; if (st.bonus) held++;
  }
  return k ? { r: f - 1, weeks: k, n: nn, held } : null;
}
// 마지막 주문이 처음 체결되는 정규 마감 시각. 그 전이면 비용 없이 다시 고를 수 있어요.
function lgExecAt(os, A) {
  const last = os[os.length - 1], prev = os.length > 1 ? os[os.length - 2].w : {};
  let t = Infinity;
  for (const a of A) if ((last.w[a.id] || 0) !== (prev[a.id] || 0)) t = Math.min(t, schedNext(last.t, a));
  return t;
}
function lgPlan(os, A, w, T) {
  if (!os.length) return chipsSum(w) ? { mode: 'first', tv: 0 } : { mode: 'none', tv: 0 };
  const last = os[os.length - 1].w;
  if (!turnover(last, w)) return { mode: 'same', tv: 0 };
  if (T < lgExecAt(os, A)) {
    if (os.length < 2) return chipsSum(w) ? { mode: 'replace', tv: 0 } : { mode: 'cancel', tv: 0 };
    const tv = turnover(os[os.length - 2].w, w);
    return tv ? { mode: 'replace', tv } : { mode: 'revert', tv: 0 };
  }
  return { mode: 'change', tv: turnover(last, w) };
}

/* ----- 맞혀봐 계산 ----- */
function pdItems(list) {
  return (Array.isArray(list) ? list : []).filter(x => x && typeof x.id === 'string' && x.q && Array.isArray(x.opts) && x.opts.length >= 2 && x.opts.length <= 6)
    .map(x => ({ ...x, lockT: Date.parse(x.lock) || 0, ans: Number.isInteger(x.a) && x.a >= 0 && x.a < x.opts.length ? x.a : null, void: x.void === true }));
}
const pdOpen = d => !!(d && d.predict && pdItems(d.predict.items).some(it => it.lockT > nowT()));
// 결과가 나온 문제의 정답을 이 폰에 적어 둬요(지난주가 데이터에서 빠져도 누적 점수가 남게)
function pdRemember(o, P) {
  let ch = false;
  for (const blk of [P, P && P.last]) {
    if (!blk || !DATE_RE.test(blk.wk || '')) continue;
    const its = pdItems(blk.items);
    const r = isObj(o.res[blk.wk]) ? o.res[blk.wk] : (o.res[blk.wk] = {});
    if (r._n !== its.length) { r._n = its.length; ch = true; }
    for (const it of its) {
      const v = it.void ? -1 : it.ans;
      if (v != null && r[it.id] !== v) { r[it.id] = v; ch = true; }
    }
  }
  return ch;
}
function pdWeekScore(pk, res) {
  pk = isObj(pk) ? pk : {}; res = isObj(res) ? res : {};
  let pts = 0, ok = 0, bad = 0, graded = 0, voids = 0;
  for (const [id, a] of Object.entries(res)) {
    if (id === '_n') continue;
    if (a === -1) { voids++; continue; }
    graded++;
    const p = pk[id];
    if (Array.isArray(p) && p[0] === a) { ok++; pts += PD_PT; } else if (Array.isArray(p)) bad++;
  }
  const all = graded > 0 && ok === graded && fin(res._n) && graded + voids >= res._n;
  if (all) pts += PD_ALL;
  return { pts, ok, bad, graded, all };
}
const pdTotal = (p, res) => (p && isObj(p.pr) ? Object.keys(res).reduce((s, w) => s + pdWeekScore(p.pr[w], res[w]).pts, 0) : 0);

/* ----- 기록 코드 (HANA1-…) ----- */
const CODE_RE = /HANA1-([A-Za-z0-9_-]{8,8000})/;
function b64e(str) { const b = new TextEncoder().encode(str); let s = ''; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function b64d(s) { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; const bin = atob(s), b = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i); return new TextDecoder('utf-8', { fatal: true }).decode(b); }
function codeMake(o, id) {
  const p = plOf(o, id) || {}, pr = {};
  Object.keys(isObj(p.pr) ? p.pr : {}).filter(w => DATE_RE.test(w)).sort().slice(-4).forEach(w => { pr[w] = p.pr[w]; });
  const lg = (Array.isArray(p.lg) ? p.lg : []).slice(-40).map(([t, w]) => [t, Object.entries(w || {}).map(([k, v]) => `${k}:${v}`).join(',')]);
  return 'HANA1-' + b64e(JSON.stringify({ v: 1, p: id, at: Math.floor(nowT() / 1000), pr, lg }));
}
function codeRead(text) {
  const m = CODE_RE.exec(String(text || ''));
  if (!m) return null;
  let j;
  try { j = JSON.parse(b64d(m[1])); } catch { return null; }
  if (!isObj(j) || j.v !== 1 || !charOf(j.p) || !fin(j.at) || j.at < 1.7e9 || j.at > nowT() / 1000 + 86400) return null;
  const pr = {};
  if (isObj(j.pr)) for (const [w, its] of Object.entries(j.pr).slice(0, 8)) {
    if (!DATE_RE.test(w) || !isObj(its)) continue;
    const o = {};
    for (const [id, v] of Object.entries(its).slice(0, 12)) if (/^[a-z0-9-]{1,24}$/.test(id) && Array.isArray(v) && Number.isInteger(v[0]) && v[0] >= 0 && v[0] < 6 && fin(v[1])) o[id] = [v[0], Math.floor(v[1])];
    if (Object.keys(o).length) pr[w] = o;
  }
  const lg = [];
  if (Array.isArray(j.lg)) for (const x of j.lg.slice(-60)) {
    if (!Array.isArray(x) || !fin(x[0]) || typeof x[1] !== 'string' || x[0] > j.at + 60) continue;
    const w = {}; let n = 0;
    for (const part of x[1].split(',').slice(0, 12)) {
      const [k, v] = part.split(':'), c = Number(v);
      if (/^[a-z0-9]{1,16}$/.test(k || '') && Number.isInteger(c) && c > 0 && n + c <= LG_CHIPS && !w[k]) { w[k] = c; n += c; }
    }
    lg.push([Math.floor(x[0]), w]);
  }
  lg.sort((a, b) => a[0] - b[0]);
  return { p: j.p, at: Math.floor(j.at), pr, lg };
}
function codeImport(r) {
  const s = playLoad(), cur = plOf(s, r.p);
  if (isGot(cur) && fin(cur.at) && cur.at > r.at) return 'old';
  const was = cur && !isGot(cur) && hasPlay(cur);
  s.pl[r.p] = { src: 'code', at: r.at, got: Math.floor(nowT() / 1000), pr: r.pr, lg: r.lg };
  playSave(s);
  return was ? 'replaced' : 'ok';
}

/* ----- 놀이 화면 공용 ----- */
function toastMk(msg) {
  const p = panel; if (!p) return;
  p.root.querySelectorAll('.mk-toast').forEach(t => t.remove());
  const t = h('div', { class: 'mk-toast', role: 'status' }, msg);
  p.root.append(t);
  setTimeout(() => t.remove(), 2600);
}
function faceEl(c, cls) {
  const box = h('span', { class: 'mk-face' + (cls ? ' ' + cls : ''), style: `--pc:${c.color}`, 'aria-hidden': 'true' });
  const im = h('img', { src: faceOf(c.id), alt: '', decoding: 'async', draggable: 'false' });
  im.addEventListener('error', () => { im.remove(); box.textContent = c.name.slice(0, 1); }, { once: true });
  box.append(im);
  return box;
}
function whoBar(o) {
  const me = meId(), act = actId(o);
  if (!me) return mePicker();
  const reset = ui.meAsk ? h('div', { class: 'mk-meok' },
    h('b', {}, '이 폰 주인을 다시 고를까요?'),
    h('small', {}, `${charOf(me).name}님 기록은 서버에 그대로 남아요.`),
    h('div', { class: 'bt' },
      h('button', { type: 'button', class: 'sh-btn', onclick: () => { click(); meSave(null); ui.meAsk = false; ui.lgDraft = null; const s = playLoad(); delete s.act; playSave(s); renderPane(false); } }, '다시 고를래요'),
      h('button', { type: 'button', class: 'sh-btn ghost', onclick: () => { click(); ui.meAsk = false; renderPane(false); } }, '그대로 둘게요'))) : null;
  return h('div', { class: 'mk-card mk-who' },
    h('div', { class: 'hd' }, h('b', {}, '누구 기록을 볼까요?'), h('small', {}, '바꾸는 건 내 것만 돼요')),
    h('div', { class: 'wl', role: 'radiogroup', 'aria-label': '누구 기록을 볼까요?' }, chars.map(c => {
      const p = plOf(o, c.id), on = c.id === act, mine = c.id === me;
      return h('button', { type: 'button', role: 'radio', 'aria-checked': String(on), 'aria-label': c.name + (mine ? ' (나)' : ''),
        class: 'wb' + (on ? ' on' : '') + (hasPlay(p) ? ' has' : '') + (mine ? ' me' : ''),
        onclick: () => { if (on) return; click(); const s = playLoad(); s.act = c.id; playSave(s); ui.lgDraft = null; renderPane(false); } },
      faceEl(c), h('span', { class: 'nm' }, c.name), mine ? h('i', { class: 'got', 'aria-hidden': 'true' }, '⭐') : null);
    })),
    h('div', { class: 'mk-whoft' }, h('span', {}, '⭐ 이 폰은 ', h('b', {}, charOf(me).name), '님 폰이에요'),
      ui.meAsk ? null : h('button', { type: 'button', class: 'mk-go', onclick: () => { click(); ui.meAsk = true; renderPane(false); } }, '내가 아니에요')),
    reset);
}
// 처음 한 번: 이 폰 주인 고르기 (나이 드신 분도 헷갈리지 않게 크게, 한 번 더 확인)
function mePicker() {
  const sel = charOf(ui.mePick) ? ui.mePick : null, sug = gameMe();
  const ok = sel ? h('div', { class: 'mk-meok' },
    h('b', {}, `${charOf(sel).name}님 맞아요?`),
    h('small', {}, '맞으면 이 폰에서 담는 건 모두 이 이름으로 저장돼요.'),
    h('div', { class: 'bt' },
      h('button', { type: 'button', class: 'sh-btn', onclick: () => {
        click(); meSave(sel); ui.mePick = null; ui.lgDraft = null;
        const s = playLoad(); s.act = sel; playSave(s);
        toastMk(`반가워요, ${charOf(sel).name}님!`); renderPane(false);
        srvPull(true).then(() => srvRerender());
      } }, '네, 저예요'),
      h('button', { type: 'button', class: 'sh-btn ghost', onclick: () => { click(); ui.mePick = null; renderPane(false); } }, '다시 고를래요'))) : null;
  return h('div', { class: 'mk-card mk-who mk-mepick' },
    h('div', { class: 'hd' }, h('b', {}, '👋 이 폰은 누구 거예요?'), h('small', {}, '처음 한 번만 골라요')),
    h('p', { class: 'mk-whonote' }, '내 얼굴을 눌러 주세요. 담은 건 서버에 저장되고 동료들 앱에도 바로 보여요.'),
    h('div', { class: 'wl', role: 'radiogroup', 'aria-label': '이 폰 주인' }, chars.map(c => h('button', { type: 'button', role: 'radio', 'aria-checked': String(c.id === sel),
      class: 'wb has' + (c.id === sel ? ' on' : '') + (!sel && c.id === sug ? ' sug' : ''), onclick: () => { if (c.id === sel) return; click(); ui.mePick = c.id; renderPane(false); } },
    faceEl(c), h('span', { class: 'nm' }, c.name)))),
    ok);
}
function gotNote(o, act) {
  const me = meId(), c = charOf(act);
  if (!c || act === me) return null;
  if (!me) return h('div', { class: 'mk-got' }, '👆 위에서 이 폰 주인(내 얼굴)을 먼저 골라 주세요. 그다음 담거나 고를 수 있어요.');
  const p = plOf(o, act);
  const mine = h('button', { type: 'button', class: 'mk-go' }, `내(${charOf(me).name}) 기록 보기 →`);
  mine.addEventListener('click', () => { click(); const s = playLoad(); s.act = me; playSave(s); ui.lgDraft = null; renderPane(false); });
  return h('div', { class: 'mk-got' }, `👀 ${c.name}님 기록이에요${p && fin(p.at) && p.at > 1.7e9 ? ` (${whenStr(p.at * 1000)}에 바꿈)` : ''}. 보기만 되고, 바꾸는 건 ${c.name}님 폰에서 해요.`, h('br'), mine);
}
function shareCard(o) {
  const st = srv.err === 'push' ? '⚠️ 인터넷이 불안정해서 내 기록을 아직 못 보냈어요. 연결되면 자동으로 다시 보내요.'
    : srv.err ? '⚠️ 서버에 연결하지 못했어요. 지금은 이 폰에 있는 기록으로 보여 드려요.'
    : srv.ok ? `✅ ${hmStr(srv.ok)}에 모두의 기록을 받았어요${srv.sent ? ` · 내 기록은 ${hmStr(srv.sent)}에 보냈어요` : ''}` : '⏳ 모두의 기록을 받는 중이에요…';
  const retry = h('button', { type: 'button', class: 'sh-btn ghost' }, '🔄 지금 다시 받기');
  retry.addEventListener('click', () => { click(); retry.disabled = true; retry.textContent = '받는 중…'; srvPull(true).then(() => (srv.pushing || Promise.resolve())).then(() => { if (!srvRerenderOk()) renderPane(false); }); });
  return h('div', { class: 'mk-card mk-share' },
    h('div', { class: 'mk-h2', style: 'margin:0 0 2px' }, '☁️ 기록은 자동으로 모여요', h('small', {}, '담거나 고르면 서버에 바로 저장되고, 동료들 앱에도 보여요. 코드를 주고받을 필요 없어요.')),
    h('p', { class: 'mk-sync' + (srv.err ? ' bad' : '') }, st), retry);
}
const srvRerenderOk = () => !!(panel && panel.shown && !skView && (ui.tab === 'league' || ui.tab === 'predict') && (renderPane(false), true));

/* ----- 탭: 이번 주 맞혀봐 ----- */
function panePredict(d) {
  const P = d.predict || {};
  const o = playLoad();
  if (pdRemember(o, P)) playSave(o);
  srvKick();
  const T = nowT(), act = actId(o), me = charOf(act) || chars[0], ro = act !== meId();
  const wk = DATE_RE.test(P.wk || '') ? P.wk : monOf(kDate(T));
  const items = pdItems(P.items), res = o.res[wk] || {};
  const pkOf = id => { const p = plOf(o, id); return (p && isObj(p.pr) && isObj(p.pr[wk]) && p.pr[wk]) || {}; };
  const myPk = pkOf(act), sc = pdWeekScore(myPk, res), tot = pdTotal(plOf(o, act), o.res);
  const nPick = items.filter(it => myPk[it.id]).length, nOpen = items.filter(it => it.lockT > T).length;
  const anyRes = items.some(it => it.ans != null);
  const pick = (it, j) => {
    const s = playLoad(), mid = meId();
    if (!mid || actId(s) !== mid) return;
    if (!(it.lockT > nowT())) { toastMk('이미 마감된 문제예요'); renderPane(false); return; }
    const p = plMut(s, mid);
    (isObj(p.pr[wk]) ? p.pr[wk] : (p.pr[wk] = {}))[it.id] = [j, Math.floor(nowT() / 1000)];
    p.src = 'mine'; p.at = nowS();
    plTrim(p); playSave(s); click(); renderPane(false); srvPush();
  };
  const rows = chars.map(c => {
    const pk = pkOf(c.id), n = items.filter(it => pk[it.id]).length;
    return n ? { c, n, s: pdWeekScore(pk, res), tot: pdTotal(plOf(o, c.id), o.res) } : null;
  }).filter(Boolean).sort((a, b) => b.s.pts - a.s.pts || b.tot - a.tot || b.n - a.n);
  const head = h('div', { class: 'mk-card pd-hd', 'data-pk': 'predict' },
    h('div', { class: 'tt' }, faceEl(me, 'md'),
      h('div', { class: 'tx' }, h('b', {}, `${me.name} · ${P.title || wkLab(wk) + ' 맞혀봐'}`),
        h('small', {}, ro ? (meId() ? `${me.name}님 기록 · 보기만 돼요` : '먼저 위에서 이 폰 주인을 골라 주세요') : nOpen ? `${items.length}문제 중 ${nPick}개 골랐어요 · 마감 전엔 바꿀 수 있어요` : '이번 주 문제는 모두 마감됐어요')),
      h('div', { class: 'pts' }, h('b', { class: 'num' }, `${sc.pts}점`), h('small', {}, `누적 ${tot}점`))),
    h('div', { class: 'dots', 'aria-hidden': 'true' }, items.map(it => { const p = myPk[it.id]; return h('i', { class: it.ans != null && p ? (p[0] === it.ans ? 'ok' : 'no') : p ? 'pk' : '' }); })),
    rows.length ? h('div', { class: 'pd-rk' }, h('div', { class: 'lab' }, anyRes ? '이번 주 순위' : '이번 주 고른 사람'),
      h('ol', { class: 'mk-rk' }, rows.map((r, i) => h('li', { class: r.c.id === act ? 'me' : '' },
        h('span', { class: 'no num' }, anyRes ? i + 1 : ''), faceEl(r.c, 'sm'),
        h('div', { class: 'who' }, h('b', {}, r.c.name), h('small', {}, anyRes ? `${r.s.ok}개 맞힘 · 누적 ${r.tot}점` : `${items.length}개 중 ${r.n}개 골랐어요`)),
        h('span', { class: 'sc num' }, anyRes ? `${r.s.pts}점` : r.n === items.length ? '다 골랐어요' : ''))))) : null,
    gotNote(o, act));
  const cards = items.map((it, i) => {
    const open = it.lockT > T, graded = it.ans != null, mine = myPk[it.id] ? myPk[it.id][0] : null;
    const st = it.void ? ['점수 없이 넘어가요', 'vd'] : graded ? ['결과 나왔어요', 'done'] : open ? [`${leftStr(it.lockT)} · ${whenStr(it.lockT)} 마감`, 'open'] : ['마감 · 결과 기다리는 중', 'wait'];
    const L = c => String.fromCharCode(65 + c);
    return h('div', { class: 'mk-card pd-q' + (graded ? ' graded' : ''), 'data-pk': i === 2 ? 'pdQ3' : null },
      h('div', { class: 'top' }, h('span', { class: 'ic', 'aria-hidden': 'true' }, it.icon || '🎯'),
        h('div', { class: 'tt' }, h('small', {}, `Q${i + 1}${it.d ? ' · ' + it.d : ''}`), h('h3', {}, it.q))),
      h('span', { class: 'st ' + st[1] }, st[0]),
      it.why ? h('p', { class: 'why' }, it.why) : null,
      h('div', { class: 'opts' }, it.opts.map((t, j) => {
        const who = chars.filter(c => { const p = pkOf(c.id)[it.id]; return p && p[0] === j; });
        const cls = graded ? (j === it.ans ? ' ok' : j === mine ? ' no' : ' dim') : j === mine ? ' on' : '';
        return h('button', { type: 'button', class: 'pd-opt' + cls, disabled: !open || ro, 'aria-pressed': String(j === mine), onclick: () => { if (j !== mine) pick(it, j); } },
          h('span', { class: 'mkr' }, graded ? (j === it.ans ? '✓' : j === mine ? '✕' : L(j)) : j === mine ? '✓' : L(j)),
          h('span', { class: 'tx' }, String(t)),
          who.length ? h('span', { class: 'who' }, who.slice(0, 6).map(c => faceEl(c, 'xs')), h('span', { class: 'sr' }, ` 고른 사람: ${who.map(c => c.name).join(', ')}`)) : null);
      })),
      it.rule ? h('small', { class: 'rule' }, `채점 기준: ${it.rule}`) : null,
      (graded || it.void) && it.res ? h('div', { class: 'res' + (it.void || mine == null ? '' : mine === it.ans ? ' ok' : ' no') },
        h('b', {}, it.void ? '이 문제는 무효예요' : mine == null ? `정답은 ${L(it.ans)}예요` : mine === it.ans ? `맞혔어요! +${PD_PT}점` : `아쉬워요. 정답은 ${L(it.ans)}예요`), String(it.res)) : null,
      it.tab && TABS.some(([id]) => id === it.tab) && (!NEED[it.tab] || NEED[it.tab](d)) ? goTab(it.tab, `${TABS.find(([id]) => id === it.tab)[1]} 탭에서 더 보기`) : null);
  });
  const Lw = isObj(P.last) && DATE_RE.test(P.last.wk || '') ? P.last : null;
  return [
    lead(P.intro, '이번 주 큰 일정의 결과를 미리 골라 봐요. 맞히면 10점, 다 맞히면 보너스 10점이에요.'),
    whoBar(o), head, items.length ? cards : h('div', { class: 'mk-card mk-empty' }, '이번 주 문제를 준비하고 있어요.'),
    Lw ? pdLastEl(o, Lw) : null,
    shareCard(o),
    h('p', { class: 'mk-note' }, P.note || '마감 전까지는 몇 번이든 바꿀 수 있어요. 결과는 다음 날 아침 업데이트 때 나와요.', ' 점수만 쌓이는 놀이이고 투자 권유가 아니에요.'),
    sourcesEl(P.sources),
  ];
}
function pdLastEl(o, Lw) {
  const its = pdItems(Lw.items);
  if (!its.length) return null;
  const res = o.res[Lw.wk] || {};
  const rows = chars.map(c => { const p = plOf(o, c.id), pk = (p && isObj(p.pr) && isObj(p.pr[Lw.wk]) && p.pr[Lw.wk]) || {}; return Object.keys(pk).length ? { c, s: pdWeekScore(pk, res) } : null; })
    .filter(Boolean).sort((a, b) => b.s.pts - a.s.pts);
  const det = h('details', { class: 'mk-card pd-last', 'data-pk': 'pdLast' },
    h('summary', {}, h('b', {}, `지난주 결과 · ${Lw.title || wkLab(Lw.wk)}`), h('span', { class: 'mk-go' }, '보기')),
    rows.length ? h('ol', { class: 'mk-rk' }, rows.map((r, i) => h('li', {}, h('span', { class: 'no num' }, i + 1), faceEl(r.c, 'sm'),
      h('div', { class: 'who' }, h('b', {}, r.c.name), h('small', {}, `${r.s.ok}/${r.s.graded}개 맞힘${r.s.all ? ' · 다 맞혀서 보너스' : ''}`)), h('span', { class: 'sc num' }, `${r.s.pts}점`))))
      : h('p', { class: 'mk-note' }, '이 폰에는 지난주에 고른 기록이 없어요.'),
    h('ul', { class: 'pd-ans' }, its.map(it => h('li', {}, h('b', {}, it.q), h('span', {}, it.void ? '무효' : it.ans != null ? `정답: ${it.opts[it.ans]}` : '채점 전'), it.res ? h('small', {}, String(it.res)) : null))));
  det.querySelector('summary').addEventListener('click', () => click());
  return det;
}

/* ----- 탭: 동료 리그 ----- */
const lastPx = a => { const c = a.cl[a.cl.length - 1], p = a.cl[a.cl.length - 2]; return { v: c.v, d: c.d, pct: p ? (c.v / p.v - 1) * 100 : null }; };
const pxTxt = (a, v) => (a.cur === '$' ? '$' + nf(v, 2) : a.cur === '원' ? nf(v, v % 1 ? 1 : 0) + '원' : nf(v, 2));
const pctW = x => `${x >= 0.00005 ? '+' : x <= -0.00005 ? '−' : ''}${nf(Math.abs(x) * 100, 2)}%`;
const wonS = v => `${Math.round(v) > 0 ? '+' : Math.round(v) < 0 ? '−' : ''}${korWon(v)}`;
const nb = s => String(s).replace(/ /g, '\u00a0'); // 금액 안에서는 줄을 안 바꿔요
function allocBar(A, w) {
  const cash = LG_CHIPS - chipsSum(w), on = A.filter(a => w[a.id]);
  return h('div', { class: 'lg-bar', role: 'img', 'aria-label': `담은 비율: ${on.map(a => `${a.name} ${w[a.id] * 10}%`).join(', ') || '없음'}${cash ? `, 현금 ${cash * 10}%` : ''}` },
    on.map(a => h('i', { style: `flex:${w[a.id]};background:${GRP[a.grp][0]}` }, a.icon)),
    cash ? h('i', { class: 'c', style: `flex:${cash}` }, cash >= 2 ? `현금 ${cash * 10}%` : '') : null);
}
const legendEl = () => h('div', { class: 'lg-leg', 'aria-hidden': 'true' }, Object.values(GRP).map(([c, t]) => h('span', {}, h('i', { style: `background:${c}` }), t)), h('span', {}, h('i', { class: 'c' }), '현금'));
function lgEditor(A, os, act, ro, T) {
  const last = os.length ? os[os.length - 1].w : {};
  if (!ui.lgDraft || ui.lgDraft.pid !== act) ui.lgDraft = { pid: act, w: { ...last } };
  const box = h('div', { class: 'lg-ed' });
  const save = () => {
    const s = playLoad(), mid = meId();
    if (!mid || actId(s) !== mid) return;
    const p = plMut(s, mid);
    const cur = lgOrders(p, A), w = {}, t = nowT();
    for (const a of A) if (ui.lgDraft.w[a.id]) w[a.id] = ui.lgDraft.w[a.id];
    const plan = lgPlan(cur, A, w, t);
    if (plan.mode === 'same' || plan.mode === 'none') return;
    if (['replace', 'revert', 'cancel'].includes(plan.mode)) p.lg.pop();
    if (['first', 'change', 'replace'].includes(plan.mode)) p.lg.push([Math.floor(t / 1000), w]);
    p.src = 'mine'; p.at = Math.max(nowS(), Math.floor(t / 1000));
    plTrim(p); playSave(s);
    const prev = cur.length ? cur[cur.length - (['replace', 'revert', 'cancel'].includes(plan.mode) ? 2 : 1)] : null;
    const pw = prev ? prev.w : {};
    const nx = Math.min(...A.filter(a => (w[a.id] || 0) !== (pw[a.id] || 0)).map(a => schedNext(t, a)));
    click();
    toastMk(plan.mode === 'revert' || plan.mode === 'cancel' ? '체결 전이라 원래대로 되돌렸어요'
      : plan.mode === 'replace' ? `체결 전이라 방금 고른 걸로 바꿨어요 · ${whenStr(nx)} 종가부터`
      : plan.mode === 'first' ? `담았어요! ${whenStr(nx)} 종가부터 수익률이 붙어요`
      : `바꿨어요 · 비용 ${korWon(plan.tv * LG_COST * LG_START)} · ${whenStr(nx)} 종가부터`);
    ui.lgDraft = null;
    renderPane(false);
    srvPush();
  };
  const draw = () => {
    const w = ui.lgDraft.w, free = LG_CHIPS - chipsSum(w), plan = lgPlan(os, A, w, nowT());
    box.textContent = '';
    box.append(allocBar(A, w), legendEl());
    const row = a => {
      const n = w[a.id] || 0, px = lastPx(a);
      const minus = h('button', { type: 'button', 'aria-label': `${a.name} 한 칸 빼기`, disabled: ro || !n }, '−');
      const plus = h('button', { type: 'button', 'aria-label': `${a.name} 한 칸 더 담기`, disabled: ro || !free }, '+');
      minus.addEventListener('click', () => { click(); const v = (ui.lgDraft.w[a.id] || 0) - 1; if (v > 0) ui.lgDraft.w[a.id] = v; else delete ui.lgDraft.w[a.id]; draw(); });
      plus.addEventListener('click', () => { if (chipsSum(ui.lgDraft.w) >= LG_CHIPS) return; click(); ui.lgDraft.w[a.id] = (ui.lgDraft.w[a.id] || 0) + 1; draw(); });
      const nm = h('div', { class: 'nm' + (a.code ? ' lk' : '') }, h('b', {}, a.name), a.kind ? h('small', {}, a.kind) : null,
        h('small', { class: 'px num' }, pxTxt(a, px.v), px.pct != null ? h('span', { class: dirOf(px.pct) }, ' ' + pctStr(px.pct)) : null, a.late ? ` · ${md(px.d)}` : null));
      // 한국 종목은 이름을 누르면 차트·회사 정보를 봐요
      if (a.code) { nm.setAttribute('role', 'button'); nm.setAttribute('tabindex', '0'); nm.setAttribute('aria-label', `${a.name} 차트·회사 정보 보기`); nm.addEventListener('click', () => { click(); openStock(a.code); }); }
      return h('div', { class: 'lg-a' + (n ? ' on' : '') },
        h('i', { class: 'sw', style: `background:${GRP[a.grp][0]}` }), a.code ? logoEl(a.name, { code: a.code, size: 26 }) : h('span', { class: 'ic', 'aria-hidden': 'true' }, a.icon),
        nm, h('div', { class: 'lg-stp' }, ro ? null : minus, h('b', { class: 'num' }, n ? `${n * 10}%` : '–'), ro ? null : plus));
    };
    if (ro) {
      // 남의 기록은 담은 것만 보여줘요
      const on = A.filter(a => w[a.id]);
      if (on.length) box.append(...on.map(row)); else box.append(h('div', { class: 'mk-empty' }, '아직 담은 게 없어요.'));
      return;
    }
    for (const g of lgGroups(A)) {
      const held = g.list.reduce((t2, a) => t2 + (w[a.id] || 0), 0);
      if (!g.id) { box.append(h('div', { class: 'lg-sech' }, `${g.icon} ${g.name}`), ...g.list.map(row)); continue; }
      const open = ui.lgOpen[g.id] != null ? ui.lgOpen[g.id] : held > 0;
      const det = h('details', { class: 'lg-sec' + (held ? ' has' : ''), open: open ? true : null },
        h('summary', {}, h('span', { class: 'sn' }, `${g.icon} ${g.name}`), h('span', { class: 'sc' }, held ? `${held * 10}% 담음` : `${g.list.length}종목`)),
        ...g.list.map(row));
      det.addEventListener('toggle', () => { ui.lgOpen[g.id] = det.open; });
      det.querySelector('summary').addEventListener('click', () => click());
      box.append(det);
    }
    const label = { first: '이대로 담기 · 처음엔 비용 없어요', change: `바꾸기 · 비용 약 ${korWon(plan.tv * LG_COST * LG_START)} (${nf(plan.tv * LG_COST * 100, 2)}%)`, replace: '다시 고르기 · 체결 전이라 바로 바뀌어요', revert: '원래대로 되돌리기', cancel: '담기 취소하기', same: os.length ? '바꾼 게 없어요' : '칸을 담아 보세요', none: '+를 눌러 담아 보세요' }[plan.mode];
    const btn = h('button', { type: 'button', class: 'lg-save', disabled: plan.mode === 'same' || plan.mode === 'none' }, label);
    btn.addEventListener('click', save);
    const undo = h('button', { type: 'button', class: 'mk-go', hidden: plan.mode === 'same' || !os.length }, '고르던 것 지우기');
    undo.addEventListener('click', () => { click(); ui.lgDraft = null; renderPane(false); });
    box.append(h('div', { class: 'lg-ft' }, h('span', {}, `현금 ${free}칸 (${korWon(free * LG_START / LG_CHIPS)})`), undo), btn,
      h('p', { class: 'mk-note' }, '담거나 바꾸면 다음 장 마감 가격(종가)으로 사요. 바꿀 때마다 사고판 금액의 0.25%가 비용이에요. 업종별 종목은 이름을 누르면 차트를 볼 수 있어요.'));
  };
  draw();
  return box;
}
function lgPendEl(os, A) {
  if (!os.length) return null;
  const last = os[os.length - 1], prev = os.length > 1 ? os[os.length - 2].w : {};
  const wait = A.filter(a => (last.w[a.id] || 0) !== (prev[a.id] || 0) && !fillOf(last.t, a));
  if (!wait.length) return null;
  return h('div', { class: 'lg-pend' }, h('b', {}, '⏳ 체결 기다리는 중'),
    h('ul', {}, wait.map(a => h('li', {}, `${a.icon} ${a.name} · ${whenStr(schedNext(last.t, a))} 종가`))),
    h('small', {}, wait.some(a => a.late) ? '종가는 다음 날 아침 업데이트 때 들어와요(업종별 종목은 다음 날 오후 2시쯤). 그 전엔 비용 없이 다시 고를 수 있어요.' : '종가는 다음 날 아침 업데이트 때 들어와요. 그 전엔 비용 없이 다시 고를 수 있어요.'));
}
function lgContEl(st, A, w) {
  if (!st) return null;
  const rows = A.filter(a => Math.abs(st.cont[a.id] || 0) > 1e-9 || w[a.id]).map(a => ({ a, v: (st.cont[a.id] || 0) * LG_START }));
  if (!rows.length && !st.cost) return null;
  return h('ul', { class: 'lg-ct' }, rows.map(({ a, v }) => h('li', {}, h('span', {}, `${a.icon} ${a.name}`, w[a.id] ? h('small', {}, ` ${w[a.id] * 10}%`) : null), h('b', { class: 'num ' + dirOf(Math.round(v)) }, wonS(v)))),
    st.cost > 1e-9 ? h('li', { class: 'cost' }, h('span', {}, '💸 바꾼 비용'), h('b', { class: 'num' }, '−' + korWon(st.cost * LG_START))) : null);
}
function lgRulesEl() {
  const det = h('details', { class: 'mk-card lg-rules' }, h('summary', {}, h('b', {}, '📏 리그 규칙'), h('span', { class: 'mk-go' }, '보기')),
    h('ul', { class: 'mk-bul' }, [
      '가상 돈 1,000만 원을 10칸(칸당 100만 원)으로 나눠 담아요. 안 담은 칸은 현금이에요.',
      '담거나 바꾸면 그다음 장 마감 가격(종가)으로 사요. 결과를 미리 알고 사는 일이 없게 하려고요.',
      `바꿀 때마다 사고판 금액의 ${nf(LG_COST * 100, 2)}%가 비용으로 빠져요. 처음 담을 땐 무료이고, 체결 전에 다시 고르면 앞의 선택은 없던 걸로 해요.`,
      `한 주 내내 안 바꾸면 꾸준함 보너스를 받아요(다 담았으면 +${nf(LG_BONUS * 100, 1)}%p, 담은 만큼).`,
      '순위는 일주일 수익률(비용 뺀 것)에 보너스를 더해 정해요. 매일 아침 업데이트 때 바뀌어요.',
      '나스닥·엔비디아·애플은 달러 기준 수익률이에요. 환율 효과는 달러를 담으면 따로 볼 수 있어요.',
      '업종별 30종목(업종마다 시가총액 탑 5)은 공식 시세(금융위원회)로 계산해요. 종가가 다음 날 오후 2시쯤 들어와서 순위에 하루 늦게 붙어요.',
      '각자 폰에서 담으면 서버에 바로 저장돼요. 바꾸는 건 이 폰 주인으로 고른 사람 것만 돼요.',
    ].map(t => h('li', {}, t))));
  det.querySelector('summary').addEventListener('click', () => click());
  return det;
}
/* ----- 사람 모형: 1년 중 가장 쌀 때(발) ~ 가장 비쌀 때(머리) 사이 어디쯤인지 ----- */
const BODY = [['발목', 0.05], ['무릎', 0.28], ['허리', 0.55], ['어깨', 0.8], ['머리', 0.95]];
const BODY_PATH = 'M43 49L43 57C36 58 26 59 23 67L15 133C14 140 16 145 20.5 145C24.5 145 26 141 25.5 136L30 87L31 116L29.5 148L33.5 251C28 253 24 256 24 260C24 264 27 266 31 266L44 266C46 266 46.5 263 46 259L46 160Q47 155 48 155Q49 155 50 160L50 259C49.5 263 50 266 52 266L65 266C69 266 72 264 72 260C72 256 68 253 62.5 251L66.5 148L65 116L66 87L70.5 136C70 141 71.5 145 75.5 145C80 145 82 140 81 133L73 67C70 59 60 58 53 57L53 49Z';
function bodyPart(p) {
  if (!fin(p)) return '';
  if (p < -0.02) return '발 아래';
  if (p > 1.02) return '머리 위';
  let b = BODY[0];
  for (const x of BODY) if (Math.abs(x[1] - p) < Math.abs(b[1] - p)) b = x;
  return b[0];
}
// 1년 최저·최고에 그 뒤 종가까지 합쳐서 범위를 정해요
function bodyRange(a) {
  if (!a || !a.y1) return null;
  let lo = a.y1.lo, hi = a.y1.hi;
  for (const c of a.cl) { if (c.v < lo) lo = c.v; if (c.v > hi) hi = c.v; }
  return hi > lo ? { lo, hi } : null;
}
// 담은 가격: 칸을 늘릴 때마다 그 체결 종가로 평균을 내요. 줄이면 평균은 그대로, 다 빼면 지워요.
// 같은 종가에 체결되는 주문이 여러 개면 마지막 것만 쳐요(리그 계산과 같아요).
function lgEntry(os, a) {
  const eff = new Map();
  for (const o of os) { const f = fillOf(o.t, a); if (f) eff.set(f.t, { w: o.w[a.id] || 0, v: f.v }); }
  let cur = 0, sum = 0;
  for (const [, x] of [...eff.entries()].sort((p, q) => p[0] - q[0])) {
    if (x.w > cur) sum += (x.w - cur) * x.v;
    else if (x.w < cur) sum = x.w ? (sum / cur) * x.w : 0;
    cur = x.w;
  }
  return cur ? { px: sum / cur, n: cur } : null;
}
function bodySvg() {
  const gid = 'mk-body-' + (++gradSeq);
  return sv('svg', { class: 'lg-bsvg', viewBox: '0 0 96 282', width: 96, height: 282, 'aria-hidden': 'true' },
    sv('defs', {}, sv('linearGradient', { id: gid, x1: 0, y1: 0, x2: 0, y2: 1 },
      sv('stop', { offset: 0, 'stop-color': '#fff', 'stop-opacity': '.2' }), sv('stop', { offset: 1, 'stop-color': '#fff', 'stop-opacity': '.06' }))),
    sv('g', { fill: `url(#${gid})`, stroke: 'rgba(255,255,255,.42)', 'stroke-width': 1.4, 'stroke-linejoin': 'round' },
      sv('circle', { cx: 48, cy: 34, r: 16 }), sv('path', { d: BODY_PATH })));
}
// 그림 안 세로 위치: 머리 꼭대기(p=1) 16px, 발바닥(p=0) 264px
const bodyY = p => 264 - Math.max(-0.05, Math.min(1.05, p)) * 248;
// 담은 사람이 없는 종목도 볼 수 있게 업종별 고르기 상자
function bodySel(ok, a) {
  const sel = h('select', { class: 'lg-bsel', 'aria-label': '다른 종목 고르기' }, h('option', { value: '' }, `🔎 다른 종목 보기 (${ok.length}개)`),
    lgGroups(ok).map(g => h('optgroup', { label: `${g.icon} ${g.name}` }, g.list.map(x => h('option', { value: x.id }, x.name + (x.id === a.id ? ' ✓' : ''))))));
  sel.addEventListener('change', () => { if (!sel.value) return; click(); ui.lgBody = sel.value; renderPane(false); });
  return sel;
}
function lgBodyEl(A, o, act, d) {
  const ok = A.filter(a => bodyRange(a));
  if (!ok.length) return null;
  const ents = {};
  for (const c of chars) {
    const os = lgOrders(plOf(o, c.id), A), e = {};
    for (const a of ok) { const x = os.length ? lgEntry(os, a) : null; if (x) e[a.id] = x; }
    ents[c.id] = e;
  }
  const cnt = a => chars.filter(c => ents[c.id][a.id]).length;
  const a = ok.find(x => x.id === ui.lgBody) || ok.find(x => ents[act] && ents[act][x.id]) || ok.slice().sort((x, y) => cnt(y) - cnt(x))[0];
  const R = bodyRange(a), pOf = v => (v - R.lo) / (R.hi - R.lo), last = a.cl[a.cl.length - 1];
  const pNow = pOf(last.v), yNow = bodyY(pNow), me = charOf(act);
  const who = chars.filter(c => ents[c.id][a.id]).map(c => ({ c, px: ents[c.id][a.id].px, p: pOf(ents[c.id][a.id].px), me: c.id === act }))
    .sort((x, y) => y.p - x.p || (x.me ? -1 : 0) - (y.me ? -1 : 0));
  // 얼굴이 겹치면 옆 칸으로 밀어요 (세로 27px 안이면 겹친다고 봐요)
  const cols = [];
  for (const w of who) {
    w.y = bodyY(w.p);
    let k = 0;
    while ((cols[k] || []).some(y => Math.abs(y - w.y) < 27)) k++;
    (cols[k] = cols[k] || []).push(w.y);
    w.k = Math.min(k, 5);
  }
  const fig = h('div', { class: 'lg-bfig', style: `--n:${Math.max(1, ...who.map(w => w.k))}`, role: 'img', 'aria-label': `${a.name}: 지금 ${bodyPart(pNow)}쯤${who.length ? ', ' + who.map(w => `${w.c.name} ${bodyPart(w.p)}`).join(', ') : ''}` },
    BODY.map(([t, p]) => h('span', { class: 'lg-bpt' + (Math.abs(bodyY(p) - yNow) < 17 ? ' lg-bhide' : ''), style: `top:${bodyY(p).toFixed(1)}px` }, t)),
    bodySvg(),
    who.map(w => h('i', { class: 'lg-btk' + (w.me ? ' lg-bme' : ''), style: `top:${w.y.toFixed(1)}px;--k:${w.k}` })),
    h('i', { class: 'lg-bnowl', style: `top:${yNow.toFixed(1)}px` }),
    h('b', { class: 'lg-bnow', style: `top:${yNow.toFixed(1)}px` }, '지금'),
    who.map(w => { const f = faceEl(w.c); f.title = `${w.c.name} · 담은 가격 ${pxTxt(a, w.px)}`; return h('span', { class: 'lg-bface' + (w.me ? ' lg-bme' : ''), style: `top:${w.y.toFixed(1)}px;--k:${w.k}` }, f); }));
  const mine = who.find(w => w.me), others = who.filter(w => !w.me);
  const parts = {};
  for (const w of others) { const t = bodyPart(w.p); parts[t] = (parts[t] || 0) + 1; }
  const partTxt = Object.entries(parts).sort((x, y) => y[1] - x[1]).map(([t, n]) => `${t} ${n}명`).join(' · ');
  let cmp = null;
  if (mine && others.length) {
    const hiN = others.filter(w => w.px > mine.px * 1.0005).length, loN = others.filter(w => w.px < mine.px * 0.9995).length, eqN = others.length - hiN - loN;
    const bits = [[hiN, '나보다 비싸게'], [loN, '나보다 싸게'], [eqN, '나와 비슷한 가격에']].filter(x => x[0]);
    cmp = bits.length === 1 ? `🔎 동료 ${others.length}명${others.length > 1 ? ' 모두' : '은'} ${bits[0][1]} 담았어요.` : `🔎 동료 ${others.length}명 중 ${bits.map(([n, t]) => `${n}명은 ${t}`).join(', ')} 담았어요.`;
  }
  const rest = A.filter(x => !bodyRange(x)).map(x => x.name);
  return h('div', { class: 'mk-card lg-body', 'data-pk': 'lgBody' },
    h('div', { class: 'mk-h2', style: 'margin:0' }, '🧍 사람 키로 보는 가격 위치', h('small', {}, '1년 중 가장 쌀 때를 발, 가장 비쌀 때를 머리로 놓고 봐요')),
    chipRow(ok.filter(x => cnt(x) > 0 || x.id === a.id).sort((x, y) => cnt(y) - cnt(x)).map(x => { const n = cnt(x); return [x.id, [`${x.icon} ${x.name}`, n ? h('span', { class: 'lg-bn' }, ` ${n}명`) : null]]; }), a.id, v => { ui.lgBody = v; renderPane(false); }, '볼 종목 고르기', 'sm lg-bchips'),
    bodySel(ok, a),
    h('div', { class: 'lg-bcap' }, h('span', {}, '머리 = 1년 최고'), h('b', { class: 'num' }, pxTxt(a, R.hi))),
    fig,
    h('div', { class: 'lg-bcap' }, h('span', {}, '발 = 1년 최저'), h('b', { class: 'num' }, pxTxt(a, R.lo))),
    h('ul', { class: 'lg-bsum' },
      h('li', {}, '📍 지금은 ', h('b', {}, `${bodyPart(pNow)}쯤`), ` · ${md(last.d)} 종가 ${pxTxt(a, last.v)}`),
      h('li', { class: 'lg-bme' }, `⭐ ${me ? me.name : '나'}: `, mine ? [h('b', {}, bodyPart(mine.p)), ` · 담은 가격 ${pxTxt(a, mine.px)}`] : '아직 안 담았어요'),
      h('li', {}, '👥 동료: ', others.length ? h('b', {}, partTxt) : '아직 담은 사람이 없어요'),
      cmp ? h('li', {}, cmp) : null),
    h('p', { class: 'mk-note' }, `키 높이는 지난 1년 가격 중 어디쯤인지만 보여줘요. 앞으로 오를지 내릴지는 알 수 없고, 투자 권유가 아니에요.${a.y1 && a.y1.d ? ` 1년 최저·최고는 ${md(a.y1.d)} 기준이에요.` : ''}${rest.length ? ` ${rest.join('·')}${jong(rest[rest.length - 1]) ? '은' : '는'} 1년 기록을 확인하는 대로 열려요.` : ''}`));
}
function paneLeague(d) {
  srvKick();
  const A = lgAssets(d), T = nowT(), L = d.league || {};
  const o = playLoad(), act = actId(o), me = charOf(act) || chars[0], ro = act !== meId();
  const wk = monOf(kDate(T)), view = ['cur', 'prev', 'roll'].includes(ui.lgView) ? ui.lgView : 'cur', W = view === 'prev' ? addD(wk, -7) : wk;
  const ordOf = id => lgOrders(plOf(o, id), A);
  const rows = chars.map(c => {
    const os = ordOf(c.id);
    if (!os.length) return null;
    if (view === 'roll') { const r = lgRoll(os, A, T); return r ? { c, score: r.r, sub: `${r.weeks}주 기록 · 바꾼 횟수 ${r.n}번${r.held ? ` · 꾸준함 ${r.held}번` : ''}` } : null; }
    const st = lgWeek(os, A, W, T);
    if (!st) return null;
    if (!st.exposed) return { c, score: 0, sub: '첫 체결 기다리는 중', badge: '⏳', wait: true };
    const sub = [korWon(LG_START * (1 + st.r + st.bonus)), st.n ? `바꾼 횟수 ${st.n}번` : st.held ? '안 바꿈' : st.started ? '이번 주 시작' : '안 바꿈'];
    if (!st.covered) sub.push('기록 일부만');
    return { c, score: st.r + st.bonus, sub: sub.join(' · '), badge: st.bonus ? `🧘 +${nf(st.bonus * 100, 2)}%p` : st.held && !st.done ? '🧘 지키는 중' : null };
  }).filter(Boolean).sort((a, b) => (a.wait ? 1 : 0) - (b.wait ? 1 : 0) || b.score - a.score || a.c.name.localeCompare(b.c.name, 'ko'));
  const rank = h('div', { class: 'mk-card lg-rk', 'data-pk': 'league' },
    h('div', { class: 'mk-h2', style: 'margin:0' }, view === 'roll' ? '최근 4주 순위' : `${view === 'prev' ? '지난주' : '이번 주'} 순위 · ${wkLab(W)}`,
      h('small', {}, `한국 ${md(d.asof.kr)} · 미국 ${md(d.asof.us)} 종가까지 반영 · 매일 아침 바뀌어요`, lgx.d && DATE_RE.test(lgx.d.asof || '') ? h('span', { class: 'lg-delay' }, `업종별 종목은 ${md(lgx.d.asof)} 종가까지 (평일 오후 2시쯤 하루치씩 들어와요)`) : null)),
    seg([['cur', '이번 주'], ['prev', '지난주'], ['roll', '최근 4주']], view, v => { ui.lgView = v; renderPane(false); }, '기간 고르기'),
    rows.length ? h('ol', { class: 'mk-rk lg' }, rows.map((r, i) => h('li', { class: r.c.id === act ? 'me' : '' },
      h('span', { class: 'no' }, r.wait ? '–' : i < 3 && rows.filter(x => !x.wait).length > 1 ? ['🥇', '🥈', '🥉'][i] : i + 1), faceEl(r.c, 'sm'),
      h('div', { class: 'who' }, h('b', {}, r.c.name, r.badge ? h('span', { class: 'bdg' }, r.badge) : null), h('small', {}, r.sub)),
      h('span', { class: 'sc num ' + (r.wait ? '' : dirOf(Math.round(r.score * 1e4))) }, r.wait ? '–' : pctW(r.score)))))
      : h('div', { class: 'mk-empty' }, h('b', {}, view === 'prev' ? '지난주 기록이 없어요' : '아직 아무도 안 담았어요'), view === 'prev' ? '이번 주 순위부터 쌓여요.' : '아래에서 먼저 담아 보세요. 다음 종가부터 수익률이 붙어요.'));
  const os = ordOf(act), stNow = os.length ? lgWeek(os, A, wk, T) : null, lastW = os.length ? os[os.length - 1].w : {};
  const mine = h('div', { class: 'mk-card lg-me', 'data-pk': 'lgMine' },
    h('div', { class: 'tt' }, faceEl(me, 'md'),
      h('div', { class: 'tx' }, h('b', {}, `${me.name}의 바구니`),
        h('small', {}, !os.length ? (ro ? '아직 안 담았어요' : '아직 안 담았어요 · 칸을 골라 담아 보세요') : !stNow ? '이번 주 기록이 아직 없어요' : !stNow.exposed ? '첫 종가가 들어오면 수익률이 붙어요' : `이번 주 ${nb(korWon(LG_START))} → ${nb(korWon(LG_START * (1 + stNow.r)))}`)),
      stNow && stNow.exposed ? h('b', { class: 'lg-pc num ' + dirOf(Math.round(stNow.r * 1e4)) }, pctW(stNow.r)) : null),
    gotNote(o, act),
    stNow && stNow.held && stNow.exposed ? h('div', { class: 'lg-hold' }, `🧘 이번 주 안 바꾸고 있어요. 금요일까지 그대로면 꾸준함 보너스 +${nf(stNow.inv * LG_BONUS * 100, 2)}%p`) : null,
    lgPendEl(os, A),
    lgContEl(stNow, A, lastW),
    h('div', { class: 'lab' }, ro ? '담은 것' : os.length ? '바꾸고 싶으면 칸을 옮겨요' : '10칸을 나눠 담아요 (칸당 100만 원)'),
    lgEditor(A, os, act, ro, T));
  return [
    lead(L.intro, '각자 가상의 1,000만 원으로 담고 싶은 걸 담아요. 일주일 수익률로 순위를 매기고, 덜 바꿀수록 유리해요.'),
    whoBar(o), rank, mine, lgBodyEl(A, o, act, d), lgRulesEl(), shareCard(o),
    h('p', { class: 'mk-note' }, L.note || '가상 돈으로 하는 놀이예요. 실제 투자 권유가 아니에요.'),
    sourcesEl(L.sources),
  ];
}

// 테스트용 (게임에서는 안 써요)
export const _mkTest = { closeAt, schedNext, usDst, kDate, monOf, lgAssets, lgOrders, lgSim, lgWeek, lgRoll, lgPlan, lgExecAt, lgCovered, turnover, pdItems, pdWeekScore, pdRemember, codeMake, codeRead, recClean, lgGroups, LG_COST, LG_BONUS, lgEntry, bodyPart, bodyRange, bodyY, skBars, skMA, skRet, skGrow, skPeerRows, skRank, PEER_METS, addM, wonBig, cntStr, initials, isHana };

/* ---------- 매달린 캐릭터: 카드 윗변에 캐릭터 6명이 상체만 걸치고 한마디 ---------- */
// 그림은 게임 캐릭터 부품(assets/chars)을 그대로 써요(stage.js의 loadCast, fx.js의 효과를 불러 씀). 공용 파일은 고치지 않아요.
// 대사: market.json의 peek(매일 갱신, 이름 없이 자리별 한마디) → 없으면 숫자로 만든 기본 대사.
// 자리: 카드를 만들 때 data-pk를 붙여 두고, 그린 다음 pkAttach가 카드 바로 위에 띠(.mk-pk)를 끼워 넣어요.
// 탭마다 자리 목록(배정 순서). 처음 13곳 + 14개 탭 전체로 늘린 자리(11/26).
const PK_TABS = { movers: ['index', 'movers', 'mover2', 'big'], must: ['oneLine', 'card1', 'card2', 'radar', 'watch', 'cal'], brokers: ['brokers'], kr: ['krMood', 'krPoints'],
  global: ['globalMood', 'cty1', 'cty3'], flows: ['flowToday', 'flowMonth', 'flowWeek', 'flowStats', 'flowTake'], chain: ['chain1', 'chain2', 'chain3'], wallet: ['fx', 'walletItems', 'loan', 'tips'],
  whatif: ['back', 'sc1', 'sc2', 'rules'], words: ['words', 'wordMid'], quiz: ['quiz', 'quizRes'], predict: ['predict', 'pdQ3', 'pdLast'], league: ['league', 'lgMine', 'lgBody'], ask: ['ask', 'ask4'] };
const PK_IDS = ['hl', ...Object.values(PK_TABS).flat()];
const PK_LEFT = ['flowMonth', 'big', 'radar', 'watch', 'cty1', 'flowStats', 'chain2', 'walletItems', 'tips', 'sc1', 'rules', 'wordMid', 'quizRes', 'pdQ3', 'lgMine', 'ask4'];
const PK_MOODS = ['shock', 'dizzy', 'peek', 'cheer', 'sweat', 'tired', 'party', 'puzzled', 'sad', 'angry', 'love', 'cool', 'sly'];
const PK_FX = { shock: 'exclaim', dizzy: 'stars', cheer: 'sparkles', sweat: 'sweat', tired: 'sweat', party: 'notes', puzzled: 'question', sad: 'gloom', angry: 'anger', love: 'hearts', cool: 'sparkles' };
const PK_TINT = { dizzy: '#5fbf6a', sad: '#5a78c8', angry: '#ff3b30', love: '#ff7fa8' };
const PK_DUR = { peek: 1.7, dizzy: 1.9, party: 1.9, sly: 1.9, sad: 2, tired: 1.9, cheer: 1.5 };
const PK_G = 66, PK_W = 88, PK_UP = 34, PK_DN = 10, PK_VIS = 54; // 띠 높이, 캔버스 폭, 위·아래 여유, 머리끝~카드 윗변 키(px)
const pk = { on: true, p: null, mod: null, list: new Set(), raf: 0, io: null, err: 0, tab: null, seen: new Set() }; // seen: 같은 탭에서 다시 그릴 땐 등장 없이 바로
const clamp01 = x => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = x => x * x * (3 - 2 * x);
const backOut = x => { const c = 1.70158; return 1 + (c + 1) * (x - 1) ** 3 + c * (x - 1) ** 2; };
const pkEnv = (k, a = 0.14, b = 0.72) => smooth(clamp01(k / a)) * (1 - smooth(clamp01((k - b) / (1 - b))));
const pkRM = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
const pkNow = () => performance.now() / 1000;

function pkLoad() {
  if (!pk.p) pk.p = Promise.all([import('https://falling-rice-82e7.tactical7604.workers.dev/js/stage.js'), import('https://falling-rice-82e7.tactical7604.workers.dev/js/fx.js')])
    .then(([st, fx]) => st.loadCast().then(pups => (pk.mod = { pups, FX: fx.FX || {} })))
    .catch(e => { console.warn('[market] peek', e); pk.on = false; return null; });
  return pk.p;
}
// 같은 데이터면 모두 같은 배정: 업데이트 날짜로 돌려요. 맨 위 '오늘의 한 줄' 캐릭터는 탭 안 자리와 겹치지 않게.
function pkCast(d) {
  const ids = chars.map(c => c.id), n = ids.length, out = {};
  if (n < 4) return out;
  const day = Math.floor(((Date.parse(d.updated) || Date.now()) + KST_MS) / 864e5);
  const c0 = day % n, rest = ids.filter((_, i) => i !== c0);
  out.hl = ids[c0];
  Object.keys(PK_TABS).forEach((tab, k) => PK_TABS[tab].forEach((id, j) => { const pool = j < rest.length ? rest : ids; out[id] = pool[(day + k * 2 + j) % pool.length]; }));
  return out;
}
function pkPick(v) {
  if (!isObj(v)) return null;
  const t = (Array.isArray(v.t) ? v.t : [v.t]).filter(s => typeof s === 'string' && s.trim()).map(s => s.trim().slice(0, 40)).slice(0, 3);
  return t.length ? { t, m: PK_MOODS.includes(v.m) ? v.m : 'cool' } : null;
}
function pkLine(d, id) {
  const pe = isObj(d.peek) ? d.peek : {};
  const byKey = (v, k) => pkPick(isObj(v) && isObj(v[k]) ? v[k] : null);
  let got;
  if (id === 'index' || id === 'big') got = byKey(pe[id], ui.mkt);
  else if (id === 'movers' || id === 'mover2') got = ui.side === 'up' ? byKey(pe[id], ui.mkt) : null;
  else if (id === 'flowToday') got = ui.flow === 'kosdaq' && (d.flows || {}).todayKQ ? null : pkPick(pe.flowToday);
  else if (id === 'quizRes') got = null; // 내 점수에 맞춰야 해서 앱이 만들어요
  else got = pkPick(pe[id]);
  if (got) return got;
  const g = pkGen(d, id);
  return g ? { t: [g[0]], m: g[1] } : null;
}
// 기본 대사(그날 대사가 없을 때): 숫자만 보고 만들어요.
function pkGen(d, id) {
  const m = d.markets[ui.mkt] || d.markets.kospi, P = x => (x > 0 ? '+' : '') + nf(x, 2) + '%', E = v => eok(Math.abs(v)).replace(/^[+−-]/, '');
  const up = ui.side !== 'down', its = ((up ? m.up : m.down) || []).filter(Boolean);
  const jo = (w, a, b) => { const t = String(w), c = t.charCodeAt(t.length - 1); return c >= 0xac00 && c <= 0xd7a3 && (c - 0xac00) % 28 ? a : b; }; // 은/는, 을/를
  const cut = (w, n) => { const t = String(w).trim(); return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t; };
  switch (id) {
    case 'hl': return ['오늘의 한 줄, 같이 봐요 ☝️', 'cool'];
    case 'index': {
      const p = m.pct; if (!fin(p)) return null;
      return p >= 5 ? [`${P(p)} 실화냐?! 😲`, 'shock'] : p >= 2 ? [`오늘 좀 치는데? ${P(p)} 😎`, 'cool'] : p >= 0.5 ? [`소소하게 ${P(p)} 🙂`, 'cheer']
        : p > -0.5 ? ['오늘은 쉬어 가는 날 ☕', 'puzzled'] : p > -2 ? [`${P(p)}… 살짝 아프다 🤕`, 'sweat'] : p > -5 ? [`${P(p)}?! 오늘 좀 맵다 🥵`, 'sad'] : [`${P(p)}… 할 말을 잃었어 😱`, 'shock'];
    }
    case 'movers': {
      if (!its.length) return [up ? '오늘은 조용했어 😌' : '크게 내린 종목이 거의 없대 😌', 'cool'];
      const lim = its.filter(x => x.tag === (up ? '상한가' : '하한가')).length;
      return up ? (lim >= 2 ? [`상한가만 ${lim}개! 무슨 일이야 👀`, 'shock'] : ['오늘의 급등 명단 공개 👀', 'peek']) : ['내린 이유도 알아 둬요 😢', 'sad'];
    }
    case 'mover2': {
      const a = its[0], b = its[1]; if (!b || !fin(b.pct)) return null;
      if (up && a.tag === '상한가' && b.tag === '상한가') return ['상한가 2연타! ✌️', 'cheer'];
      return up ? [`2등도 ${P(b.pct)}! 박수 👏`, 'cheer'] : [`${P(b.pct)}… 아프다 아파 😣`, 'sad'];
    }
    case 'oneLine': return ['이번 주는 이것만 기억해요 📌', 'puzzled'];
    case 'card1': case 'card2': return ['이건 꼭 알아 둬요 ☝️', 'cool'];
    case 'brokers': return ['전망은 전망일 뿐, 참고만 해요 🔮', 'puzzled'];
    case 'krMood': { const t = Number((d.newsKR || {}).tone) || 0; return t >= 1 ? ['다들 기분 좋아 보이네 😊', 'cheer'] : t <= -1 ? ['분위기가 좀 무겁다… 😟', 'sad'] : ['아직은 눈치 게임 👀', 'sly']; }
    case 'krPoints': { const n = ((d.newsKR || {}).points || []).filter(Boolean).length; return n ? [`핵심만 ${n}줄, 금방 읽어요 📝`, 'cool'] : null; }
    case 'globalMood': {
      const l = (d.newsGlobal || []).filter(c => c && c.name && fin(Number(c.tone))); if (!l.length) return null;
      const b = l.reduce((x, y) => (Number(y.tone) > Number(x.tone) ? y : x));
      return Number(b.tone) >= 2 ? [`${b.name} 분위기 최고네 🎉`, 'party'] : ['나라마다 표정이 달라 🌏', 'puzzled'];
    }
    case 'flowToday': case 'flowMonth': {
      const f = d.flows || {}, x = id === 'flowMonth' ? f.month : (ui.flow === 'kosdaq' && f.todayKQ ? f.todayKQ : f.today);
      const rows = ((x && x.rows) || []).filter(r => Array.isArray(r) && fin(r[1])); if (!rows.length) return null;
      const big = rows.reduce((a, b) => (Math.abs(b[1]) > Math.abs(a[1]) ? b : a));
      return id === 'flowMonth' ? [`${big[0]} 한 달 ${E(big[1])} ${big[1] < 0 ? '매도' : '매수'}… 손 크다 😳`, 'shock']
        : [`${big[0]} ${E(big[1])} ${big[1] < 0 ? '팔았어' : '샀어'} 👀`, big[1] < 0 ? 'sad' : 'cheer'];
    }
    case 'big': {
      const bs = (m.big || []).filter(b => b && b.name && fin(b.pct)); if (!bs.length) return null;
      const top = bs.reduce((a, b) => (Math.abs(b.pct) > Math.abs(a.pct) ? b : a)), ups = bs.filter(b => b.pct > 0).length;
      if (ups === bs.length) return Math.abs(top.pct) >= 5 ? ['대장주가 다 같이 뛰었어 🏃', 'cheer'] : ['대장주들 다 같이 올랐어 🙂', 'cheer'];
      if (!ups && bs.every(b => b.pct < 0)) return ['대장주들 다 같이 쉬어 가 😮‍💨', 'tired'];
      return [`${cut(top.name, 8)} ${P(top.pct)}, 제일 바빴어 💨`, top.pct > 0 ? 'cool' : 'sweat'];
    }
    case 'radar': {
      const L = (((d.mustKnow || {}).radar || {}).items || []).filter(x => x && [0, 1, 2].includes(x.lv)); if (!L.length) return null;
      const hi = L.filter(x => x.lv === 2).length, mid = L.filter(x => x.lv === 1).length;
      return hi * 2 >= L.length ? [`${L.length}개 중 ${hi}개가 빨간불이래 🚨`, 'sweat'] : hi ? [`빨간불 ${hi}개, 눈 크게 뜨고 👀`, 'sly'] : mid ? ['노란불 몇 개, 아직은 괜찮아 🙂', 'cool'] : ['신호등 거의 다 초록불 😌', 'cool'];
    }
    case 'watch': {
      const ws = ((d.mustKnow || {}).watch || []).filter(x => x && x.t); if (!ws.length) return null;
      let on = []; try { on = JSON.parse(localStorage.getItem(WATCH_KEY) || '[]'); } catch { on = []; }
      const n = Array.isArray(on) ? ws.filter(x => on.includes(x.t)).length : 0;
      return n >= ws.length ? ['다 체크했네! 꼼꼼하다 👏', 'love'] : n ? [`${ws.length}개 중 ${n}개 체크! 조금만 더 ✅`, 'cheer'] : [`이번 주 볼 거 ${ws.length}개, 눌러서 체크 ✅`, 'peek'];
    }
    case 'cal': {
      const cs = ((d.mustKnow || {}).calendar || []).filter(c => c && c.t); if (!cs.length) return null;
      const n3 = cs.filter(c => c.imp === 3).length;
      return n3 ? [`중요 일정 ${n3}개! 날짜 체크 📅`, 'sweat'] : [`다가오는 일정 ${cs.length}개 📅`, 'cool'];
    }
    case 'cty1': case 'cty3': {
      const c = (d.newsGlobal || []).filter(Boolean)[id === 'cty1' ? 0 : 2]; if (!c || !c.name) return null;
      const t = Number(c.tone) || 0, nm = cut(c.name, 6), n = nm + jo(nm, '은', '는');
      return t >= 2 ? [`${n} 완전 신났어 🎉`, 'party'] : t >= 1 ? [`${n} 분위기 좋아 😊`, 'cheer'] : t <= -1 ? [`${n} 좀 우울하대 😟`, 'sad'] : [`${n} 눈치 보는 중 👀`, 'sly'];
    }
    case 'flowWeek': {
      const gs = (((d.flows || {}).week || {}).groups || []).filter(g => g && Array.isArray(g.items) && g.items.length && Array.isArray(g.items[0]) && g.items[0][0]);
      const g = gs.find(x => /외국인/.test(x.who || '')) || gs[0]; if (!g) return null;
      const who = String(g.who || '').split(' ')[0] || '큰손', nm = cut(g.items[0][0], 8), v = Number(g.items[0][1]);
      return [`${who}${jo(who, '은', '는')} ${nm}${jo(nm, '을', '를')} 제일 많이 ${v < 0 ? '팔았어' : '샀어'} 👀`, v < 0 ? 'sly' : 'peek'];
    }
    case 'flowStats': {
      const s = ((d.flows || {}).stats || []).find(x => x && x.label && x.value); if (!s) return null;
      return [`${cut(s.label, 8)} ${cut(s.value, 8)}, 체온 재 봤어 🌡️`, 'puzzled'];
    }
    case 'flowTake': return ['돈의 흐름, 한 줄로 정리했어 💬', 'cool'];
    case 'chain1': case 'chain2': case 'chain3': {
      const k = Number(id.slice(5)) - 1, ch = ((d.chain || {}).items || []).filter(x => x && Array.isArray(x.steps))[k]; if (!ch) return null;
      const n = ch.steps.filter(s => s && s.t).length;
      return k === 0 ? [`${n}단계 도미노, 따라와 봐 👉`, 'peek'] : k === 1 ? [`여기도 ${n}단계나 이어져 🔗`, 'puzzled'] : ['마지막 연결고리까지 🧩', 'cool'];
    }
    case 'fx': {
      const u = ((d.wallet || {}).fx || []).find(x => x && x.id === 'USD' && fin(x.rate));
      if (!u) return ['환율 계산기, 숫자만 넣어 봐 🧮', 'cool'];
      if (!fin(u.prev)) return [`달러 ${nf(u.rate, 1)}원, 계산해 볼까? 🧮`, 'cool'];
      const df = u.rate - u.prev;
      return Math.abs(df) < 1 ? ['달러는 한 달째 제자리 😌', 'cool'] : df > 0 ? [`달러 한 달 새 +${nf(df, 1)}원… 여행비 😵`, 'dizzy'] : [`달러 한 달 새 −${nf(-df, 1)}원 내렸어 🙂`, 'cheer'];
    }
    case 'walletItems': {
      const g = ((d.wallet || {}).items || []).find(x => x && /^금\s/.test(x.name || '') && fin(x.chg));
      if (g) return g.chg > 0 ? ['금값 또 올랐대, 반지 비싸다 💍', 'shock'] : g.chg < 0 ? ['금값 살짝 내렸대 💍', 'puzzled'] : ['금값은 그대로래 💍', 'cool'];
      return ['내 생활비에 닿는 숫자들 🧾', 'puzzled'];
    }
    case 'loan': return ['금리 0.5%p만 올라도 이자가… 😵', 'dizzy'];
    case 'tips': return ['알아 두면 쓸모 있는 팁 💡', 'cool'];
    case 'back': {
      const s = ((d.markets[ui.wfMkt] || d.markets.kospi).series || []).filter(x => Array.isArray(x) && fin(x[1])); if (s.length < 2) return null;
      const r = (s[s.length - 1][1] / s[0][1] - 1) * 100;
      return r >= 0 ? [`한 달 전에 샀다면 ${P(r)}! 😎`, 'cool'] : [`한 달 전에 샀다면 ${P(r)}… 😢`, 'sad'];
    }
    case 'sc1': case 'sc2': {
      const s = ((d.whatif || {}).scenarios || []).filter(Boolean)[id === 'sc1' ? 0 : 1]; if (!s || !s.title) return null;
      return id === 'sc1' ? [`${cut(s.title, 14)}, 어느 쪽일까? 🤔`, 'puzzled'] : [`${cut(s.title, 14)}도 미리 생각해 둬 🧐`, 'sly'];
    }
    case 'rules': return ['늘 그렇진 않지만 보통은 이래 📏', 'cool'];
    case 'words': { const n = ((d.words || {}).items || []).filter(x => x && x.w && x.easy).length; return n ? [`어려운 말 ${n}개, 쉽게 풀었어 📖`, 'cool'] : null; }
    case 'wordMid': return ['여기까지 읽었으면 반 박사 🎓', 'party'];
    case 'quiz': case 'quizRes': {
      const qz = d.quiz || {}, qs = (qz.items || []).filter(x => x && x.q && Array.isArray(x.opts) && x.opts.length >= 2 && Number.isInteger(x.a) && x.a >= 0 && x.a < x.opts.length);
      if (!qs.length) return null;
      const key = (typeof qz.id === 'string' && qz.id) || (d.asof && d.asof.kr) || 'quiz', st = quizLoad();
      const ans = Array.isArray(st[key]) ? st[key].slice(0, qs.length) : [];
      const done = ans.filter(x => x != null).length, ok = qs.reduce((n, q, i) => n + (ans[i] === q.a ? 1 : 0), 0);
      if (id === 'quiz') return !done ? [`${qs.length}문제! 몇 개 맞힐까? ✏️`, 'peek'] : done < qs.length ? [`${done}/${qs.length} 풀었어, 계속 가자 🔥`, 'cheer'] : ['다 풀었네! 결과는 아래 👇', 'cool'];
      return ok === qs.length ? ['만점! 오늘의 시장 박사 🎉', 'party'] : ok * 5 >= qs.length * 3 ? [`${ok}개나 맞혔어! 꽤 하는데? 😎`, 'cool'] : [`${ok}개… 해설 보면 내일은 만점 💪`, 'sweat'];
    }
    case 'predict': {
      const ps = pdItems((d.predict || {}).items); if (!ps.length) return null;
      const g = ps.filter(it => it.ans != null || it.void).length;
      return g ? [`벌써 ${g}문제 채점됐어! 맞혔나? 👀`, 'peek'] : ['마감 전에 골라 둬! ⏰', 'sweat'];
    }
    case 'pdQ3': return ['헷갈리면 왜 중요한지부터 봐 🧐', 'puzzled'];
    case 'pdLast': return ['지난주 성적표 나왔어 📜', 'shock'];
    case 'league': return ['순위는 매일 아침 바뀌어 🏁', 'cool'];
    case 'lgMine': return ['안 바꾸면 꾸준함 보너스 🧘', 'cool'];
    case 'lgBody': return ['머리 쪽이면 1년 중 비싼 편 🧍', 'puzzled'];
    case 'ask': { const n = ((d.ask || {}).items || []).filter(x => x && x.q && Array.isArray(x.a) && x.a.length).length; return n ? [`이런 질문 ${n}개, 이렇게 답해요 🙋`, 'peek'] : null; }
    case 'ask4': return ['설명하다 막히면 탭으로 가 봐 👉', 'sly'];
    default: return null;
  }
}
// 팔 그림 아래쪽(손)만 잘라 둬요. 손이 비스듬하면 똑바로 세울 각도도 같이.
function pkHands(pup) {
  if (pup._pkHands) return pup._pkHands;
  const out = {};
  for (const k of ['armL', 'armR']) {
    try {
      const im = pup.img[k], W = im.naturalWidth || im.width, H = im.naturalHeight || im.height, pb = pup.rig.parts[k];
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(im, 0, 0);
      const px = g.getImageData(0, 0, W, H).data;
      const span = y => { let a = -1, b = -1; for (let x = 0; x < W; x++) if (px[(y * W + x) * 4 + 3] > 40) { if (a < 0) a = x; b = x; } return a < 0 ? null : [a, b]; };
      let top = 0, bot = H - 1;
      while (top < H - 1 && !span(top)) top++;
      while (bot > top && !span(bot)) bot--;
      const len = bot - top; if (len < 20) continue;
      const y0 = Math.round(bot - len * 0.26);
      const cen = (a, b) => { let s = 0, n = 0; for (let y = Math.round(a); y <= b; y += 2) { const r = span(y); if (r) { s += (r[0] + r[1]) / 2; n++; } } return n ? s / n : W / 2; };
      const cTop = cen(top, top + len * 0.2), cHand = cen(y0, bot);
      let x0 = W, x1 = 0;
      for (let y = y0; y <= bot; y++) { const r = span(y); if (r) { x0 = Math.min(x0, r[0]); x1 = Math.max(x1, r[1]); } }
      const hc = document.createElement('canvas'); hc.width = x1 - x0 + 1; hc.height = bot - y0 + 1;
      hc.getContext('2d').drawImage(c, x0, y0, hc.width, hc.height, 0, 0, hc.width, hc.height);
      const ux = pb[2] / W, uy = pb[3] / H;
      out[k] = { cv: hc, w: hc.width * ux, h: hc.height * uy, ang: Math.atan2((cHand - cTop) * ux, ((y0 + bot) / 2 - (top + len * 0.1)) * uy) };
    } catch { /* 손을 못 자르면 손 없이 */ }
  }
  return (pup._pkHands = out);
}
function pkMake(el, id, cid, line) {
  const c = charOf(cid); if (!c) return null;
  const cs = getComputedStyle(el);
  const cv = h('canvas', { class: 'mk-pk-cv', 'aria-hidden': 'true' });
  const say = h('div', { class: 'mk-pk-say', 'aria-hidden': 'true' }, line.t[0]);
  const hit = h('button', { class: 'mk-pk-hit', type: 'button', 'aria-label': `${c.name}: ${line.t[0]}` });
  const strip = h('div', { class: 'mk-pk' + (PK_LEFT.includes(id) ? ' l' : ''), 'data-spot': id }, cv, say, hit);
  strip.style.marginTop = cs.marginTop; strip.style.marginLeft = cs.marginLeft; strip.style.marginRight = cs.marginRight;
  const p = { el: strip, at: el, mt0: el.style.marginTop, cv, g: cv.getContext('2d'), say, hit, name: c.name, id, cid, line, li: 0, m: line.m, left: PK_LEFT.includes(id),
    dpr: Math.min(2, window.devicePixelRatio || 1), vis: false, t0: null, gag: null, next: 0, pop: 0, ph: Math.random() * 6, pup: null, drawn: false };
  cv.width = Math.round(PK_W * p.dpr); cv.height = Math.round((PK_UP + PK_G + PK_DN) * p.dpr);
  el.before(strip); el.style.marginTop = '0px';
  const poke = () => { click(); pkPoke(p); };
  hit.addEventListener('click', poke); say.addEventListener('click', poke);
  return p;
}
function pkAttach(scope) {
  if (!pk.on || !data || !scope) return;
  const els = [...scope.querySelectorAll('[data-pk]')].filter(el => !(el.previousElementSibling && el.previousElementSibling.classList.contains('mk-pk')));
  if (!els.length) return;
  if (pk.tab !== ui.tab) { pk.tab = ui.tab; pk.seen.clear(); }
  const cast = pkCast(data), made = [];
  for (const el of els) {
    const id = el.dataset.pk; if (!PK_IDS.includes(id) || !cast[id]) continue;
    const line = pkLine(data, id); if (!line) continue;
    const p = pkMake(el, id, cast[id], line); if (p) { p.quick = pk.seen.has(id); pk.seen.add(id); made.push(p); }
  }
  if (!made.length) return;
  pkLoad().then(mod => {
    for (const p of made) {
      if (!mod || !mod.pups[p.cid]) { p.el.remove(); p.at.style.marginTop = p.mt0; continue; } // 그림을 못 불러오면 띠를 빼요
      if (!p.el.isConnected) continue;
      p.pup = mod.pups[p.cid]; pk.list.add(p); pkWatch(p);
    }
    pkKick();
  });
}
function pkWatch(p) {
  if (!pk.io && 'IntersectionObserver' in window) {
    pk.io = new IntersectionObserver(es => { for (const e of es) { const q = e.target._pk; if (q) { q.vis = e.isIntersecting; q.drawn = false; } } pkKick(); }, { rootMargin: '40px 0px' });
  }
  p.el._pk = p;
  if (pk.io) pk.io.observe(p.el); else p.vis = true;
}
function pkPoke(p) {
  if (p.line.t.length > 1) { p.li = (p.li + 1) % p.line.t.length; p.say.textContent = p.line.t[p.li]; p.hit.setAttribute('aria-label', `${p.name}: ${p.line.t[p.li]}`); }
  if (pkRM() || p.t0 == null) return;
  const t = pkNow(); p.gag = { t, dur: PK_DUR[p.m] || 1.4 }; p.pop = t; p.next = t + 5 + Math.random() * 2; pkKick();
}
function pkKick() { if (!pk.raf && pk.list.size) pk.raf = requestAnimationFrame(pkTick); }
function pkTick(ms) {
  pk.raf = 0;
  const t = ms / 1000, rm = pkRM(); let live = 0;
  for (const p of pk.list) {
    if (!p.el.isConnected) { pk.list.delete(p); if (pk.io) pk.io.unobserve(p.el); continue; }
    if (!p.vis || !pk.mod) continue;
    if (p.t0 == null) { p.t0 = p.quick ? t - 9 : t; p.next = t + (p.quick ? 3.5 : 1.3) + Math.random() * 1.6; }
    if (rm) { if (!p.drawn) { p.drawn = true; pkFrameSafe(p, t, true); } continue; }
    live++;
    if (!p.gag && t >= p.next) { p.gag = { t, dur: PK_DUR[p.m] || 1.4 }; p.next = t + 4.6 + Math.random() * 2.6; }
    pkFrameSafe(p, t, false);
  }
  if (live) pk.raf = requestAnimationFrame(pkTick);
}
function pkFrameSafe(p, t, rm) { try { pkFrame(p, t, rm); } catch (e) { if (!pk.err) { pk.err = 1; console.warn('[market] peek draw', e); } } }
function pkGag(m, gt, k, o, hide) {
  const e = pkEnv(k);
  switch (m) {
    case 'shock': o.rise += 10 * e; o.hs = 1 + 0.1 * e; break;
    case 'dizzy': o.head += Math.sin(gt * 7) * 14 * e; o.hx = Math.sin(gt * 7) * 4 * e; break;
    case 'peek': { const dn = smooth(clamp01((k - 0.04) / 0.22)), up = backOut(clamp01((k - 0.55) / 0.3)); o.rise -= hide * 0.72 * dn * (1 - up); break; }
    case 'cheer': o.rise += 8 * e; o.arms = e; o.head += Math.sin(gt * 11) * 5 * e; break;
    case 'sweat': o.x = Math.sin(gt * 46) * 1.6 * e; break;
    case 'tired': o.rise -= 8 * e; o.head += 11 * e; break;
    case 'party': o.head += Math.sin(gt * 8) * 10 * e; o.rise += Math.abs(Math.sin(gt * 8)) * 5 * e; break;
    case 'puzzled': o.head += 14 * e; break;
    case 'sad': o.rise -= 7 * e; o.head -= 9 * e; break;
    case 'angry': o.x = Math.sin(gt * 50) * 1.4 * e; o.rise += 3 * e; break;
    case 'love': o.rise += Math.abs(Math.sin(gt * 6)) * 5 * e; break;
    case 'cool': o.head += 7 * e; o.rise += 3 * e; break;
    case 'sly': o.hx = Math.sin(gt * 4.5) * 6 * e; o.head += Math.sin(gt * 4.5) * 7 * e; break;
    default: break;
  }
  o.fx = PK_FX[m] || null; o.ft = gt; o.fa = Math.min(1, e * 1.6);
  if (PK_TINT[m]) { const a = Math.round(0.32 * e * 10) / 10; if (a > 0) o.tint = [PK_TINT[m], a]; }
}
function pkFrame(p, t, rm) {
  const { g, dpr, pup } = p, FX = pk.mod.FX, W = PK_W, H = PK_UP + PK_G + PK_DN, ledge = PK_UP + PK_G;
  g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
  const r = pup.rig, hb = pup.headBox, lf = hb.y + hb.h + 40; // 턱 아래 어깨 윗부분까지 보여요
  const S = PK_VIS / (lf - hb.y), hide = PK_VIS + 6;
  const lt = rm ? 9 : t - p.t0;
  const o = { rise: 0, x: 0, hx: 0, head: 0, hs: 1, arms: 0, fx: null, ft: 0, fa: 1, tint: null };
  const kh = clamp01(lt / 0.22), kb = clamp01((lt - 0.12) / 0.5);
  o.rise = -hide * (1 - backOut(kb)); // 등장: 손 먼저 짚고 머리가 쏙
  if (!rm) { o.rise += Math.sin(t * 2.1 + p.ph) * 1.1; o.head = Math.sin(t * 1.3 + p.ph) * 4; }
  if (p.gag && !rm) { const gt = t - p.gag.t, k = gt / p.gag.dur; if (k >= 1 || k < 0) p.gag = null; else pkGag(p.m, gt, k, o, hide); }
  const P = { x: o.x / S, y: 0, rot: 0, sx: 1, sy: 1, flip: 1, waist: 0, tx: 0, ty: 0, head: o.head, hx: o.hx / S, hy: 0, hs: o.hs,
    armL: pup.rest.L + (168 - pup.rest.L) * o.arms, armR: pup.rest.R + (168 - pup.rest.R) * o.arms, legL: 0, legR: 0, legSY: 1, armFront: true, tint: o.tint, alpha: 1 };
  const X = W / 2, Y = ledge - o.rise + S * (r.h - lf);
  g.save(); g.beginPath(); g.rect(0, 0, W, ledge); g.clip(); pup.draw(g, X, Y, S, P); g.restore();
  // 손: 카드 윗변을 잡고 손가락이 앞으로 넘어와요(만세할 땐 떼요)
  const ha = (1 - clamp01(o.arms * 3)) * kh;
  if (ha > 0.01) {
    const hs = pkHands(pup), dy = -7 * (1 - backOut(kh));
    g.save(); g.globalAlpha = ha;
    for (const [k, fx] of [['armL', hb.x + hb.w * 0.1], ['armR', hb.x + hb.w * 0.9]]) {
      const hd = hs[k]; if (!hd) continue;
      const w = hd.w * S * 1.35, hh = hd.h * S * 1.35;
      g.save(); g.translate(X + S * (fx - r.w / 2), ledge + dy); g.rotate(hd.ang); g.drawImage(hd.cv, -w / 2, -hh * 0.45, w, hh); g.restore();
    }
    g.restore();
  }
  if (o.fx && FX[o.fx]) {
    const a = pup.anchor(X, Y, S, P, 'head');
    if (['exclaim', 'question', 'anger', 'sweat'].includes(o.fx)) a.y += 10; // 머리 위보다 옆에(위 글자를 덜 가리게)
    g.save(); g.globalAlpha = o.fa;
    if (p.left && o.fx !== 'question' && o.fx !== 'notes') { g.translate(a.x * 2, 0); g.scale(-1, 1); } // 왼쪽 캐릭터는 효과도 바깥쪽으로
    try { FX[o.fx](g, a, o.ft); } catch { /* 효과 하나 실패는 무시 */ }
    g.restore();
  }
  // 말풍선: 등장 뒤 톡 나오고 둥둥 떠 있어요(누르면 한 번 더 톡)
  const ks = rm ? 1 : clamp01((lt - 0.45) / 0.25);
  const pop = !rm && p.pop ? clamp01(1 - (t - p.pop) / 0.35) : 0;
  const sc = (0.7 + 0.3 * backOut(ks)) * (1 + 0.12 * Math.sin(pop * Math.PI));
  p.say.style.opacity = ks.toFixed(3);
  p.say.style.transform = `translateY(calc(-50% + ${rm ? 0 : (Math.sin(t * 2 + p.ph) * 1.5).toFixed(2)}px)) scale(${sc.toFixed(3)})`;
}
function pkStop() {
  if (pk.raf) cancelAnimationFrame(pk.raf);
  pk.raf = 0; pk.list.clear(); pk.tab = null; pk.seen.clear();
  if (pk.io) { pk.io.disconnect(); pk.io = null; }
}
