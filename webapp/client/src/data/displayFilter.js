// Small safe parser for a subset of Wireshark display filter syntax. No eval.
// Grammar:  or := and ('||' and)* ; and := atom ('&&' atom)* ;
//           atom := '(' or ')' | '!' atom | field [ ('=='|'!='|'contains') value ]

const hostOf = (s) => String(s || '').split(':')[0];

export function fieldValue(p, field) {
  const d = p.detail || {};
  switch (field) {
    case 'ip.src': return hostOf(p.src);
    case 'ip.dst': return hostOf(p.dst);
    case 'ip.addr': return [hostOf(p.src), hostOf(p.dst)];
    case 'frame.number': return p.no;
    case 'frame.len': return p.length;
    case 'http.response.code':
      if (p.kind === 'http_401') return 401;
      if (p.kind === 'http_101') return 101;
      if (p.kind === 'http_503') return 503;
      return undefined;
    case 'http.request':
      return p.kind === 'http_req' ? 1 : undefined;
    case 'http.request.uri':
      return p.kind === 'http_req' ? (d.uri || d.path || (/\/ocpp\/\S+/.exec(p.info || '') || [''])[0]) : undefined;
    case 'http.authbasic':
      return d.authorization ? String(d.decoded || d.authorization) : undefined;
    case 'http.user_agent':
      return d.userAgent || d.user_agent || undefined;
    case 'tcp.flags.syn': return p.kind === 'syn' || p.kind === 'synack' ? 1 : 0;
    case 'tcp.flags.ack': return p.kind === 'syn' ? 0 : 1;
    case 'websocket': return p.proto === 'WebSocket' ? 1 : undefined;
    case 'websocket.payload.text':
      return d.json !== undefined ? JSON.stringify(d.json) : undefined;
    case 'ocpp.action':
      return Array.isArray(d.json) && d.json[0] === 2 ? d.json[2] : undefined;
    case 'cp': return p.cp;
    case 'attack': return p.attack ? 1 : 0;
    case 'info': return p.info;
    default: return undefined;
  }
}

function tokenize(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (src.startsWith('&&', i)) { out.push({ t: 'and' }); i += 2; continue; }
    if (src.startsWith('||', i)) { out.push({ t: 'or' }); i += 2; continue; }
    if (src.startsWith('==', i)) { out.push({ t: 'op', v: '==' }); i += 2; continue; }
    if (src.startsWith('!=', i)) { out.push({ t: 'op', v: '!=' }); i += 2; continue; }
    if (c === '(') { out.push({ t: 'lp' }); i++; continue; }
    if (c === ')') { out.push({ t: 'rp' }); i++; continue; }
    if (c === '!') { out.push({ t: 'not' }); i++; continue; }
    if (c === '"') {
      let j = i + 1; let s = '';
      while (j < src.length && src[j] !== '"') { s += src[j]; j++; }
      if (j >= src.length) throw new Error('Unterminated string');
      out.push({ t: 'str', v: s }); i = j + 1; continue;
    }
    let j = i; let s = '';
    while (j < src.length && !/[\s()"!=&|]/.test(src[j])) { s += src[j]; j++; }
    if (!s) throw new Error(`Unexpected character ${c}`);
    out.push({ t: 'word', v: s }); i = j;
  }
  return out;
}

export function parseFilter(src) {
  const text = (src || '').trim();
  if (!text) return { fn: () => true, error: null };
  try {
    const toks = tokenize(text);
    let pos = 0;
    const peek = () => toks[pos];
    const next = () => toks[pos++];
    const parseOr = () => {
      let l = parseAnd();
      while (peek() && peek().t === 'or') { next(); const r = parseAnd(); const a = l; l = (p) => a(p) || r(p); }
      return l;
    };
    const parseAnd = () => {
      let l = parseAtom();
      while (peek() && peek().t === 'and') { next(); const r = parseAtom(); const a = l; l = (p) => a(p) && r(p); }
      return l;
    };
    const parseAtom = () => {
      const t = next();
      if (!t) throw new Error('Unexpected end of filter');
      if (t.t === 'lp') { const e = parseOr(); if (!peek() || next().t !== 'rp') throw new Error('Missing )'); return e; }
      if (t.t === 'not') { const e = parseAtom(); return (p) => !e(p); }
      if (t.t !== 'word') throw new Error('Expected a field name');
      const field = t.v;
      const nx = peek();
      const isContains = nx && nx.t === 'word' && nx.v === 'contains';
      if (!nx || !(nx.t === 'op' || isContains)) {
        return (p) => { const v = fieldValue(p, field); return v !== undefined && v !== 0 && v !== ''; };
      }
      next();
      const vt = next();
      if (!vt || (vt.t !== 'word' && vt.t !== 'str')) throw new Error('Expected a value');
      const want = vt.v;
      if (isContains) {
        const w = want.toLowerCase();
        return (p) => {
          const v = fieldValue(p, field);
          if (v === undefined) return false;
          return (Array.isArray(v) ? v : [v]).some((x) => String(x).toLowerCase().includes(w));
        };
      }
      const eq = nx.v === '==';
      return (p) => {
        const v = fieldValue(p, field);
        const hit = v !== undefined && (Array.isArray(v) ? v : [v]).some((x) => String(x) === String(want));
        return eq ? hit : !hit;
      };
    };
    const fn = parseOr();
    if (pos < toks.length) throw new Error('Unexpected token');
    return { fn, error: null };
  } catch (e) {
    return { fn: () => true, error: e.message };
  }
}

export const QUICK_FILTERS = [
  { label: 'A1 failed logins', f: 'http.response.code==401' },
  { label: 'A1 passwords in clear', f: 'http.authbasic && ip.src==10.10.99.66' },
  { label: 'Card guessing', f: 'websocket.payload.text contains "Authorize"' },
  { label: 'A2 absurd power', f: 'websocket.payload.text contains "Power.Active" && ip.src==10.10.99.66' },
  { label: 'A2 probing', f: 'websocket.payload.text contains "DataTransfer"' },
  { label: 'Two sources on CP-03', f: 'http.request.uri contains "/ocpp/CP-03"' },
  { label: 'A3 SYN flood', f: 'tcp.flags.syn==1 && tcp.flags.ack==0 && ip.src==10.10.99.66' },
  { label: 'A3 saturation', f: 'http.response.code==503' },
  { label: 'Healthy logins', f: 'http.response.code==101' },
];
