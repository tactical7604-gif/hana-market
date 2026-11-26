// 하나 마켓 리그 서버
// 사람별 기록(이번 주 맞혀봐 고른 답 · 동료 리그 바구니)을 Workers KV에 저장해요.
// 앱(하나 패밀리 파티 → 마켓 브리핑)이 담을 때마다 PUT, 열 때마다 GET 해요.
// 바인딩: KV 이름 LG
const IDS = ['sanggyeong', 'gyeongmin', 'gyeongho', 'dahye', 'areum', 'sunyoung'];
const MAX_BODY = 24000;
const KEEP_HIST_SEC = 90 * 86400;
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const isObj = x => !!x && typeof x === 'object' && !Array.isArray(x);
const fin = x => typeof x === 'number' && Number.isFinite(x);
const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...CORS },
});

// 앱의 기록 형식 검사와 같은 규칙: 맞혀봐는 최근 8주·주마다 12문제까지, 리그 주문은 60개까지·한 번에 10칸까지
function clean(body, now) {
  if (!isObj(body)) return null;
  const at = Math.floor(Number(body.at));
  if (!fin(at) || at < 1.7e9 || at > now + 86400) return null;
  const pr = {};
  if (isObj(body.pr)) {
    for (const [w, its] of Object.entries(body.pr).filter(([w]) => DATE.test(w)).sort().slice(-8)) {
      if (!isObj(its)) continue;
      const o = {};
      for (const [id, v] of Object.entries(its).slice(0, 12)) {
        if (/^[a-z0-9-]{1,24}$/.test(id) && Array.isArray(v) && Number.isInteger(v[0]) && v[0] >= 0 && v[0] < 6 && fin(v[1])) o[id] = [v[0], Math.floor(v[1])];
      }
      if (Object.keys(o).length) pr[w] = o;
    }
  }
  const lg = [];
  if (Array.isArray(body.lg)) {
    for (const x of body.lg.slice(-60)) {
      if (!Array.isArray(x) || !fin(x[0]) || !isObj(x[1]) || x[0] > at + 60 || x[0] < 1.7e9) continue;
      const w = {};
      let n = 0;
      for (const [k, v] of Object.entries(x[1]).slice(0, 40)) {
        if (/^[a-z0-9]{1,16}$/.test(k) && Number.isInteger(v) && v > 0 && n + v <= 10 && !w[k]) { w[k] = v; n += v; }
      }
      lg.push([Math.floor(x[0]), w]);
    }
  }
  lg.sort((a, b) => a[0] - b[0]);
  return { at, pr, lg };
}

async function readAll(env) {
  const vals = await Promise.all(IDS.map(id => env.LG.get('p:' + id, 'json')));
  const p = {};
  IDS.forEach((id, i) => { if (vals[i]) p[id] = vals[i]; });
  return p;
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const now = Math.floor(Date.now() / 1000);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (!env.LG) return json({ ok: false, err: 'no-kv' }, 500);
    const path = url.pathname.replace(/\/+$/, '');

    if (req.method === 'GET' && (path === '' || path === '/')) {
      return new Response('하나 마켓 리그 서버예요. (앱 전용)', { headers: { 'Content-Type': 'text/plain; charset=utf-8', ...CORS } });
    }
    if (req.method === 'GET' && path === '/v1/all') {
      return json({ v: 1, t: now, p: await readAll(env) });
    }
    let m = path.match(/^\/v1\/p\/([a-z0-9_]{1,24})$/);
    if (m && req.method === 'PUT') {
      const id = m[1];
      if (!IDS.includes(id)) return json({ ok: false, err: 'who' }, 404);
      const text = await req.text();
      if (text.length > MAX_BODY) return json({ ok: false, err: 'big' }, 413);
      let body;
      try { body = JSON.parse(text); } catch { return json({ ok: false, err: 'json' }, 400); }
      const c = clean(body, now);
      if (!c) return json({ ok: false, err: 'shape' }, 400);
      const cur = await env.LG.get('p:' + id, 'json');
      // 다른 폰에서 더 나중에 바꾼 기록이 있으면 덮어쓰지 않고 그걸 돌려줘요
      if (cur && fin(cur.at) && cur.at > c.at) return json({ ok: false, err: 'stale', cur }, 409);
      const rev = ((cur && cur.rev) || 0) + 1;
      const rec = { ...c, rev, t: now };
      await env.LG.put('p:' + id, JSON.stringify(rec));
      // 실수로 지웠을 때 되돌릴 수 있게 90일 동안 이전 판을 남겨요
      await env.LG.put(`h:${id}:${String(rev).padStart(6, '0')}`, JSON.stringify(rec), { expirationTtl: KEEP_HIST_SEC });
      return json({ ok: true, rev, t: now });
    }
    m = path.match(/^\/v1\/h\/([a-z0-9_]{1,24})$/);
    if (m && req.method === 'GET') {
      const id = m[1];
      if (!IDS.includes(id)) return json({ ok: false, err: 'who' }, 404);
      const list = await env.LG.list({ prefix: `h:${id}:` });
      const revs = list.keys.map(k => k.name.split(':')[2]).slice(-30);
      const r = url.searchParams.get('rev');
      if (r && /^\d{1,6}$/.test(r)) return json({ v: 1, rec: await env.LG.get(`h:${id}:${r.padStart(6, '0')}`, 'json') });
      return json({ v: 1, revs });
    }
    return json({ ok: false, err: 'path' }, 404);
  },
};
