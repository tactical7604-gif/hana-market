import w from './worker.js';
const store = new Map();
const env = { LG: {
  async get(k, t) { const v = store.get(k); return v == null ? null : (t === 'json' ? JSON.parse(v) : v); },
  async put(k, v, o) { store.set(k, v); },
  async list({ prefix }) { return { keys: [...store.keys()].filter(k => k.startsWith(prefix)).sort().map(name => ({ name })) }; },
} };
const B = 'https://x.workers.dev';
const call = async (m, p, body) => { const r = await w.fetch(new Request(B + p, { method: m, body: body == null ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)) }), env); let j = null; try { j = await r.clone().json(); } catch {} return [r.status, j, r.headers.get('access-control-allow-origin')]; };
const now = Math.floor(Date.now() / 1000);
let ok = 0, bad = 0; const t = (n, c, x = '') => { if (c) ok++; else { bad++; console.log('FAIL', n, x); } };
let [s, j, cors] = await call('GET', '/v1/all'); t('empty all', s === 200 && j.v === 1 && Object.keys(j.p).length === 0 && cors === '*');
[s, j] = await call('PUT', '/v1/p/areum', { at: now, pr: { '2026-11-23': { q1: [1, now - 10] } }, lg: [[now - 5, { samsung: 3, k005380: 2 }]] }); t('put ok', s === 200 && j.ok && j.rev === 1, JSON.stringify(j));
[s, j] = await call('GET', '/v1/all'); t('all has areum', j.p.areum && j.p.areum.lg[0][1].k005380 === 2 && j.p.areum.rev === 1);
[s, j] = await call('PUT', '/v1/p/areum', { at: now - 100, pr: {}, lg: [] }); t('stale rejected', s === 409 && j.err === 'stale' && j.cur.rev === 1);
[s, j] = await call('PUT', '/v1/p/areum', { at: now + 1, pr: {}, lg: [[now, { a: 11 }], [now, { b: 4, c: 7 }]] }); t('chips capped', s === 200 && j.rev === 2);
[s, j] = await call('GET', '/v1/all'); t('chips >10 dropped', JSON.stringify(j.p.areum.lg) === JSON.stringify([[now, {}], [now, { b: 4 }]]), JSON.stringify(j.p.areum.lg));
[s, j] = await call('PUT', '/v1/p/nobody', { at: now }); t('unknown id 404', s === 404);
[s, j] = await call('PUT', '/v1/p/dahye', 'not json'); t('bad json 400', s === 400);
[s, j] = await call('PUT', '/v1/p/dahye', { at: 5 }); t('bad at 400', s === 400);
[s, j] = await call('PUT', '/v1/p/dahye', 'x'.repeat(30000)); t('too big 413', s === 413);
[s, j] = await call('GET', '/v1/h/areum'); t('history list', j.revs.length === 2 && j.revs[0] === '000001', JSON.stringify(j));
[s, j] = await call('GET', '/v1/h/areum?rev=1'); t('history rec', j.rec && j.rec.rev === 1);
const r = await w.fetch(new Request(B + '/v1/all', { method: 'OPTIONS' }), env); t('options cors', r.status === 204 && r.headers.get('access-control-allow-methods').includes('PUT'));
[s, j] = await call('PUT', '/v1/p/sunyoung', { at: now, pr: { 'bad': { q: [0, 1] }, '2026-11-16': { 'Q!': [0, 1], ok: [9, 1], ok2: [2, now] } }, lg: [[now + 999, { a: 1 }]] }); t('filters bad', s === 200);
[s, j] = await call('GET', '/v1/all'); t('filtered content', JSON.stringify(j.p.sunyoung.pr) === JSON.stringify({ '2026-11-16': { ok2: [2, now] } }) && j.p.sunyoung.lg.length === 0, JSON.stringify(j.p.sunyoung));
// 빈 기록(테스트로 담았다 뺀 것)이 더 나중이어도, 폰에 있던 진짜 기록은 올라가야 해요
[s, j] = await call('PUT', '/v1/p/sanggyeong', { at: now - 10, pr: {}, lg: [[now - 20, { samsung: 1 }]] }); t('seed', s === 200 && j.rev === 1);
[s, j] = await call('PUT', '/v1/p/sanggyeong', { at: now, pr: {}, lg: [] }); t('emptied later', s === 200 && j.rev === 2);
[s, j] = await call('PUT', '/v1/p/sanggyeong', { at: now - 3600, pr: { '2026-11-23': { q1: [0, now - 3600] } }, lg: [[now - 4000, { hynix: 2 }]] }); t('older real rec beats newer empty', s === 200 && j.rev === 3, JSON.stringify(j));
[s, j] = await call('GET', '/v1/all'); t('real rec kept', j.p.sanggyeong.lg[0][1].hynix === 2 && j.p.sanggyeong.pr['2026-11-23'].q1[0] === 0, JSON.stringify(j.p.sanggyeong));
[s, j] = await call('PUT', '/v1/p/sanggyeong', { at: now - 7200, pr: {}, lg: [] }); t('older empty still rejected', s === 409 && j.cur.rev === 3);
[s, j] = await call('PUT', '/v1/p/sanggyeong', { at: now - 7200, pr: {}, lg: [[now - 7300, { samsung: 1 }]] }); t('older real vs newer real rejected', s === 409);
console.log(`ok ${ok} bad ${bad}`);
