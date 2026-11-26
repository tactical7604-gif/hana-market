#!/usr/bin/env python3
"""하나 패밀리 파티 v0.4.3 → v0.4.4 마켓 브리핑 패치
- 동료 리그·맞혀봐 기록을 서버(hana-league 워커)로 자동 공유 (코드 주고받기 없앰)
- '이 폰은 누구 거예요?' 처음 한 번 고르기, 남의 기록은 보기만
- 업종별 30종목(stocks/league.json) 합치기, 바구니를 업종별로 접기, 종목 이름 누르면 차트
"""
import re, sys, os

ROOT = sys.argv[1] if len(sys.argv) > 1 else '.'
P = os.path.join(ROOT, 'js', 'market.js')
s = open(P, encoding='utf-8').read()


def func_span(src, start_marker):
    i = src.index(start_marker)
    j = src.index('{', i)
    depth, k, n = 0, j, len(src)
    in_str = None
    while k < n:
        ch = src[k]
        if in_str:
            if ch == '\\':
                k += 2
                continue
            if ch == in_str:
                in_str = None
            elif in_str == '`' and ch == '$' and src[k + 1] == '{':
                pass
        elif ch in '\'"`':
            in_str = ch
        elif ch == '/' and src[k + 1] == '/':
            k = src.index('\n', k)
            continue
        elif ch == '{':
            depth += 1
        elif ch == '}':
            depth -= 1
            if depth == 0:
                return i, k + 1
        k += 1
    raise ValueError('no end for ' + start_marker)


def replace_func(src, start_marker, new):
    a, b = func_span(src, start_marker)
    return src[:a] + new.strip('\n') + src[b:]


def sub1(src, old, new):
    if src.count(old) != 1:
        raise ValueError(f'anchor count {src.count(old)}: {old[:80]!r}')
    return src.replace(old, new, 1)


# ---------- 1) 헤더 설명 ----------
s = sub1(s, "// 데이터: 게임에 들어 있는 market.json → 저장소(remote)에 더 새 파일이 있으면 그걸 받아서 씀(localStorage에 보관).\n",
         "// 데이터: 게임에 들어 있는 market.json → 저장소(remote)에 더 새 파일이 있으면 그걸 받아서 씀(localStorage에 보관).\n"
         "// 동료 리그 업종별 30종목: 저장소 stocks/league.json. 동료들 기록: 서버(hana-league 워커)에 자동으로 모아요(v0.4.4).\n")

# ---------- 2) ui 상태 ----------
s = sub1(s, "lgView: 'cur', lgDraft: null, lgBody: null };",
         "lgView: 'cur', lgDraft: null, lgBody: null, lgOpen: {}, mePick: null, meAsk: false };")

# ---------- 3) 업종 종목 파일 불러오기 (stkItem 앞) ----------
LGX = r'''
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
'''
s = sub1(s, "function stkItem(code) {", LGX.strip('\n') + "\nfunction stkItem(code) {")

# ---------- 4) 열 때 업종 종목·서버 기록 미리 받기 ----------
s = sub1(s, "  ready().then(() => stkLoad()).then(x => { if (panel && panel.shown && x && x !== had && !skView && (ui.tab === 'movers' || ui.tab === 'flows')) renderPane(false); });\n}",
         "  ready().then(() => stkLoad()).then(x => { if (panel && panel.shown && x && x !== had && !skView && (ui.tab === 'movers' || ui.tab === 'flows')) renderPane(false); });\n"
         "  lgxPrime();\n"
         "  ready().then(() => lgxLoad()).then(ch => { if (ch) srvRerender(); });\n"
         "  srvPull(false).then(ch => { if (ch) srvRerender(); });\n}")

# ---------- 5) 저장: 나(이 폰 주인) · 서버 동기화 (plTrim 뒤) ----------
SRV = r'''
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
'''
a, b = func_span(s, "function plTrim(p) {")
s = s[:b] + '\n' + SRV.rstrip('\n') + s[b:]

# ---------- 6) 누가 하는지: 이 폰 주인 → 그다음 고른 사람 ----------
s = replace_func(s, "function actId(o) {", "function actId(o) { const me = meId(), g = gameMe(); return charOf(o.act) ? o.act : me || (charOf(g) ? g : chars[0].id); }")

# ---------- 7) 업종 종목 합치기 ----------
LGA = r'''
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
'''
s = replace_func(s, "function lgAssets(d) {", LGA)

# ---------- 8) 맨 위 얼굴 줄: 이 폰 주인 고르기 / 동료 기록 보기 ----------
WHO = r'''
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
'''
s = replace_func(s, "function whoBar(o) {", WHO)

GOT = r'''
function gotNote(o, act) {
  const me = meId(), c = charOf(act);
  if (!c || act === me) return null;
  if (!me) return h('div', { class: 'mk-got' }, '👆 위에서 이 폰 주인(내 얼굴)을 먼저 골라 주세요. 그다음 담거나 고를 수 있어요.');
  const p = plOf(o, act);
  const mine = h('button', { type: 'button', class: 'mk-go' }, `내(${charOf(me).name}) 기록 보기 →`);
  mine.addEventListener('click', () => { click(); const s = playLoad(); s.act = me; playSave(s); ui.lgDraft = null; renderPane(false); });
  return h('div', { class: 'mk-got' }, `👀 ${c.name}님 기록이에요${p && fin(p.at) && p.at > 1.7e9 ? ` (${whenStr(p.at * 1000)}에 바꿈)` : ''}. 보기만 되고, 바꾸는 건 ${c.name}님 폰에서 해요.`, h('br'), mine);
}
'''
s = replace_func(s, "function gotNote(o, act) {", GOT)

SHARE = r'''
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
'''
s = replace_func(s, "function shareCard(o) {", SHARE)

# ---------- 9) 맞혀봐: 이 폰 주인만 고르기 + 서버로 보내기 ----------
s = sub1(s, "  const T = nowT(), act = actId(o), me = charOf(act) || chars[0], ro = isGot(plOf(o, act));\n  const wk = DATE_RE.test(P.wk || '') ? P.wk : monOf(kDate(T));",
         "  srvKick();\n  const T = nowT(), act = actId(o), me = charOf(act) || chars[0], ro = act !== meId();\n  const wk = DATE_RE.test(P.wk || '') ? P.wk : monOf(kDate(T));")
s = sub1(s, """  const pick = (it, j) => {
    const s = playLoad(), p = plMut(s, actId(s));
    if (isGot(p)) return;
    if (!(it.lockT > nowT())) { toastMk('이미 마감된 문제예요'); renderPane(false); return; }
    (isObj(p.pr[wk]) ? p.pr[wk] : (p.pr[wk] = {}))[it.id] = [j, Math.floor(nowT() / 1000)];
    plTrim(p); playSave(s); click(); renderPane(false);
  };""", """  const pick = (it, j) => {
    const s = playLoad(), mid = meId();
    if (!mid || actId(s) !== mid) return;
    if (!(it.lockT > nowT())) { toastMk('이미 마감된 문제예요'); renderPane(false); return; }
    const p = plMut(s, mid);
    (isObj(p.pr[wk]) ? p.pr[wk] : (p.pr[wk] = {}))[it.id] = [j, Math.floor(nowT() / 1000)];
    p.src = 'mine'; p.at = nowS();
    plTrim(p); playSave(s); click(); renderPane(false); srvPush();
  };""")
s = sub1(s, "h('small', {}, ro ? '받은 기록이에요' : nOpen ?",
         "h('small', {}, ro ? (meId() ? `${me.name}님 기록 · 보기만 돼요` : '먼저 위에서 이 폰 주인을 골라 주세요') : nOpen ?")

# ---------- 10) 바구니 편집: 저장은 이 폰 주인만 + 서버로, 업종별로 접기, 이름 누르면 차트 ----------
s = sub1(s, """  const save = () => {
    const s = playLoad(), p = plMut(s, actId(s));
    if (isGot(p)) return;
    const cur = lgOrders(p, A), w = {}, t = nowT();""", """  const save = () => {
    const s = playLoad(), mid = meId();
    if (!mid || actId(s) !== mid) return;
    const p = plMut(s, mid);
    const cur = lgOrders(p, A), w = {}, t = nowT();""")
s = sub1(s, """    if (['first', 'change', 'replace'].includes(plan.mode)) p.lg.push([Math.floor(t / 1000), w]);
    plTrim(p); playSave(s);""", """    if (['first', 'change', 'replace'].includes(plan.mode)) p.lg.push([Math.floor(t / 1000), w]);
    p.src = 'mine'; p.at = Math.max(nowS(), Math.floor(t / 1000));
    plTrim(p); playSave(s);""")
s = sub1(s, """    ui.lgDraft = null;
    renderPane(false);
  };
  const draw = () => {""", """    ui.lgDraft = null;
    renderPane(false);
    srvPush();
  };
  const draw = () => {""")

OLD_LOOP = """    box.append(allocBar(A, w), legendEl());
    for (const a of A) {
      const n = w[a.id] || 0, px = lastPx(a);
      const minus = h('button', { type: 'button', 'aria-label': `${a.name} 한 칸 빼기`, disabled: ro || !n }, '−');
      const plus = h('button', { type: 'button', 'aria-label': `${a.name} 한 칸 더 담기`, disabled: ro || !free }, '+');
      minus.addEventListener('click', () => { click(); const v = (ui.lgDraft.w[a.id] || 0) - 1; if (v > 0) ui.lgDraft.w[a.id] = v; else delete ui.lgDraft.w[a.id]; draw(); });
      plus.addEventListener('click', () => { if (chipsSum(ui.lgDraft.w) >= LG_CHIPS) return; click(); ui.lgDraft.w[a.id] = (ui.lgDraft.w[a.id] || 0) + 1; draw(); });
      box.append(h('div', { class: 'lg-a' + (n ? ' on' : '') },
        h('i', { class: 'sw', style: `background:${GRP[a.grp][0]}` }), h('span', { class: 'ic', 'aria-hidden': 'true' }, a.icon),
        h('div', { class: 'nm' }, h('b', {}, a.name), a.kind ? h('small', {}, a.kind) : null, h('small', { class: 'px num' }, pxTxt(a, px.v), px.pct != null ? h('span', { class: dirOf(px.pct) }, ' ' + pctStr(px.pct)) : null)),
        h('div', { class: 'lg-stp' }, ro ? null : minus, h('b', { class: 'num' }, n ? `${n * 10}%` : '–'), ro ? null : plus)));
    }
    if (ro) return;"""
NEW_LOOP = """    box.append(allocBar(A, w), legendEl());
    const row = a => {
      const n = w[a.id] || 0, px = lastPx(a);
      const minus = h('button', { type: 'button', 'aria-label': `${a.name} 한 칸 빼기`, disabled: ro || !n }, '−');
      const plus = h('button', { type: 'button', 'aria-label': `${a.name} 한 칸 더 담기`, disabled: ro || !free }, '+');
      minus.addEventListener('click', () => { click(); const v = (ui.lgDraft.w[a.id] || 0) - 1; if (v > 0) ui.lgDraft.w[a.id] = v; else delete ui.lgDraft.w[a.id]; draw(); });
      plus.addEventListener('click', () => { if (chipsSum(ui.lgDraft.w) >= LG_CHIPS) return; click(); ui.lgDraft.w[a.id] = (ui.lgDraft.w[a.id] || 0) + 1; draw(); });
      const nm = h('div', { class: 'nm' + (a.code ? ' lk' : '') }, h('b', {}, a.name), a.kind ? h('small', {}, a.kind) : null,
        h('small', { class: 'px num' }, pxTxt(a, px.v), px.pct != null ? h('span', { class: dirOf(px.pct) }, ' ' + pctStr(px.pct)) : null));
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
    }"""
s = sub1(s, OLD_LOOP, NEW_LOOP)
s = sub1(s, "      h('p', { class: 'mk-note' }, '담거나 바꾸면 다음 장 마감 가격(종가)으로 사요. 바꿀 때마다 사고판 금액의 0.25%가 비용이에요.'));",
         "      h('p', { class: 'mk-note' }, '담거나 바꾸면 다음 장 마감 가격(종가)으로 사요. 바꿀 때마다 사고판 금액의 0.25%가 비용이에요. 업종별 종목은 이름을 누르면 차트를 볼 수 있어요.'));")

# ---------- 11) 체결 기다림 안내: 업종 종목은 다음 날 오후에 종가가 들어와요 ----------
s = sub1(s, "    h('small', {}, '종가는 다음 날 아침 업데이트 때 들어와요. 그 전엔 비용 없이 다시 고를 수 있어요.'));",
         "    h('small', {}, wait.some(a => a.late) ? '종가는 다음 날 아침 업데이트 때 들어와요(업종별 종목은 다음 날 오후 2시쯤). 그 전엔 비용 없이 다시 고를 수 있어요.' : '종가는 다음 날 아침 업데이트 때 들어와요. 그 전엔 비용 없이 다시 고를 수 있어요.'));")

# ---------- 12) 규칙 ----------
s = sub1(s, "      '나스닥·엔비디아·애플은 달러 기준 수익률이에요. 환율 효과는 달러를 담으면 따로 볼 수 있어요.',",
         "      '나스닥·엔비디아·애플은 달러 기준 수익률이에요. 환율 효과는 달러를 담으면 따로 볼 수 있어요.',\n"
         "      '업종별 30종목(업종마다 시가총액 탑 5)은 공식 시세(금융위원회)로 계산해요. 종가가 다음 날 오후 2시쯤 들어와서 순위에 하루 늦게 붙어요.',\n"
         "      '각자 폰에서 담으면 서버에 바로 저장돼요. 바꾸는 건 이 폰 주인으로 고른 사람 것만 돼요.',")

# ---------- 13) 사람 모형: 담은 종목만 칩으로 + 나머지는 고르기 상자 ----------
s = sub1(s, "    chipRow(ok.map(x => { const n = cnt(x); return [x.id, [`${x.icon} ${x.name}`, n ? h('span', { class: 'lg-bn' }, ` ${n}명`) : null]]; }), a.id, v => { ui.lgBody = v; renderPane(false); }, '볼 종목 고르기', 'sm lg-bchips'),",
         "    chipRow(ok.filter(x => cnt(x) > 0 || x.id === a.id).sort((x, y) => cnt(y) - cnt(x)).map(x => { const n = cnt(x); return [x.id, [`${x.icon} ${x.name}`, n ? h('span', { class: 'lg-bn' }, ` ${n}명`) : null]]; }), a.id, v => { ui.lgBody = v; renderPane(false); }, '볼 종목 고르기', 'sm lg-bchips'),\n"
         "    bodySel(ok, a),")
BSEL = r'''
// 담은 사람이 없는 종목도 볼 수 있게 업종별 고르기 상자
function bodySel(ok, a) {
  const sel = h('select', { class: 'lg-bsel', 'aria-label': '다른 종목 고르기' }, h('option', { value: '' }, `🔎 다른 종목 보기 (${ok.length}개)`),
    lgGroups(ok).map(g => h('optgroup', { label: `${g.icon} ${g.name}` }, g.list.map(x => h('option', { value: x.id }, x.name + (x.id === a.id ? ' ✓' : ''))))));
  sel.addEventListener('change', () => { if (!sel.value) return; click(); ui.lgBody = sel.value; renderPane(false); });
  return sel;
}
'''
s = sub1(s, "function lgBodyEl(A, o, act, d) {", BSEL.strip('\n') + "\nfunction lgBodyEl(A, o, act, d) {")

# ---------- 14) 리그 탭 ----------
s = sub1(s, "  const A = lgAssets(d), T = nowT(), L = d.league || {};\n  const o = playLoad(), act = actId(o), me = charOf(act) || chars[0], ro = isGot(plOf(o, act));",
         "  srvKick();\n  const A = lgAssets(d), T = nowT(), L = d.league || {};\n  const o = playLoad(), act = actId(o), me = charOf(act) || chars[0], ro = act !== meId();")
s = sub1(s, "      h('small', {}, `한국 ${md(d.asof.kr)} · 미국 ${md(d.asof.us)} 종가까지 반영 · 매일 아침 바뀌어요`)),",
         "      h('small', {}, `한국 ${md(d.asof.kr)} · 미국 ${md(d.asof.us)} 종가까지 반영 · 매일 아침 바뀌어요`, lgx.d && DATE_RE.test(lgx.d.asof || '') ? h('span', { class: 'lg-delay' }, `업종별 종목은 ${md(lgx.d.asof)} 종가까지 (평일 오후 2시쯤 하루치씩 들어와요)`) : null)),")
s = sub1(s, "        h('small', {}, !os.length ? '아직 안 담았어요 · 칸을 골라 담아 보세요' :",
         "        h('small', {}, !os.length ? (ro ? '아직 안 담았어요' : '아직 안 담았어요 · 칸을 골라 담아 보세요') :")

# ---------- 15) 테스트용 내보내기 ----------
s = sub1(s, "codeMake, codeRead, LG_COST, LG_BONUS,", "codeMake, codeRead, recClean, lgGroups, LG_COST, LG_BONUS,")

open(P, 'w', encoding='utf-8').write(s)

# ---------- CSS ----------
C = os.path.join(ROOT, 'css', 'market.css')
css = open(C, encoding='utf-8').read()
css += r'''
/* ===== v0.4.4: 이 폰 주인 고르기 · 서버 상태 · 업종별 바구니 ===== */
.mk-who .wb.me .nm { color: var(--mk-ink); }
.mk-who .wb.sug .mk-face { opacity: .95; filter: none; box-shadow: 0 0 0 2px var(--mk-card), 0 0 0 3.5px var(--mk-line2); }
.mk-mepick { border: 1px solid rgba(242,169,0,.45); }
.mk-mepick .wb .mk-face { width: 48px; height: 48px; opacity: .9; filter: none; }
.mk-mepick .wb .nm { font-size: 13.5px; color: var(--mk-ink); }
.mk-whonote { margin: 6px 6px 0; font-size: 13px; line-height: 1.5; color: var(--mk-ink2); }
.mk-whoft { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin: 8px 6px 0; font-size: 12.5px; color: var(--mk-mute); }
.mk-whoft b { color: var(--mk-ink); }
.mk-whoft .mk-go { padding: 2px 0; font-size: 12.5px; }
.mk-meok { margin: 12px 4px 2px; padding: 12px; border-radius: 12px; background: rgba(242,169,0,.08); border: 1px solid rgba(242,169,0,.35); text-align: center; }
.mk-meok b { display: block; font-size: 16.5px; }
.mk-meok small { display: block; margin-top: 3px; font-size: 12.5px; color: var(--mk-ink2); line-height: 1.45; }
.mk-meok .bt { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 10px; }
.mk-meok .sh-btn { display: block; width: 100%; border: 0; border-radius: 12px; padding: 13px 8px; font-size: 15px; font-weight: 800; background: var(--mk-ink); color: #0b1d1c !important; }
.mk-meok .sh-btn.ghost { background: transparent; border: 1px solid var(--mk-line2); color: var(--mk-ink) !important; }
.mk-meok .sh-btn:focus-visible { outline: 2px solid var(--mk-gold); outline-offset: 1px; }
.mk-sync { margin: 10px 0 0; font-size: 13.5px; color: var(--mk-ink2); line-height: 1.5; }
.mk-sync.bad { color: #ffc2b8; }
.lg-delay { display: block; margin-top: 2px; font-size: 11.5px; color: var(--mk-mute); }
.lg-sech { margin: 14px 0 0; padding-bottom: 2px; font-size: 13px; font-weight: 800; color: var(--mk-ink2); }
.lg-sec { margin-top: 8px; border: 1px solid var(--mk-line); border-radius: 12px; padding: 0 10px; background: rgba(255,255,255,.02); }
.lg-sec.has { border-color: rgba(242,169,0,.4); }
.lg-sec > summary { list-style: none; display: flex; align-items: center; gap: 8px; min-height: 46px; padding: 4px 2px; cursor: pointer; font-weight: 800; font-size: 15px; }
.lg-sec > summary::-webkit-details-marker { display: none; }
.lg-sec > summary .sc { margin-left: auto; font-size: 12.5px; font-weight: 700; color: var(--mk-mute); }
.lg-sec.has > summary .sc { color: var(--mk-gold); }
.lg-sec > summary::after { content: '▾'; color: var(--mk-mute); font-size: 13px; transition: transform .15s; }
.lg-sec[open] > summary::after { transform: rotate(180deg); }
.lg-sec[open] { padding-bottom: 2px; }
.lg-sec > summary:focus-visible { outline: 2px solid var(--mk-gold); outline-offset: 2px; border-radius: 8px; }
.lg-a .sk-logo { justify-self: center; }
.lg-a .nm.lk { cursor: pointer; }
.lg-a .nm.lk b::after { content: ' ›'; color: var(--mk-mute); font-weight: 600; }
.lg-a .nm.lk:focus-visible { outline: 2px solid var(--mk-gold); outline-offset: 2px; border-radius: 6px; }
.lg-bsel { display: block; width: 100%; box-sizing: border-box; margin-top: 8px; padding: 10px 12px; border-radius: 12px; border: 1px solid var(--mk-line2); background: var(--mk-card2); color: var(--mk-ink); font: 600 14px var(--mk-sans); }
.lg-bsel:focus-visible { outline: 2px solid var(--mk-gold); outline-offset: 1px; }
@media (prefers-reduced-motion: reduce) { .lg-sec > summary::after { transition: none; } }
'''
open(C, 'w', encoding='utf-8').write(css)

# ---------- 서비스 워커 캐시 이름 ----------
W = os.path.join(ROOT, 'sw.js')
sw = open(W, encoding='utf-8').read()
sw = sub1(sw, "const CACHE='hanaparty-0.4.3';", "const CACHE='hanaparty-0.4.4';")
open(W, 'w', encoding='utf-8').write(sw)
print('patched OK')
