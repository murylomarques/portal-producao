'use strict';
window.addEventListener('error', ev => {
  if (!document.body) return; document.body.dataset.error = ev.message + ' @' + ev.lineno + ':' + ev.colno;
  let b = document.getElementById('fatal'); if (!b) { b = document.createElement('div'); b.id = 'fatal'; b.className = 'notice'; b.style.cssText = 'position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:200;max-width:720px'; document.body.appendChild(b); }
  b.innerHTML = '<div><b>Erro no portal:</b> ' + String(ev.message).replace(/</g, '&lt;') + ' <span class="mono">(app.js:' + ev.lineno + ')</span><br>Envie esta mensagem ao suporte.</div>';
});
if (!window.PORTAL_DATA) document.addEventListener('DOMContentLoaded', () => { document.documentElement.classList.add('pronto'); document.getElementById('view').innerHTML = `<div class="notice"><div><b>Sem dados do banco dw_fup.</b> ${window.PORTAL_ERROR ? String(window.PORTAL_ERROR).replace(/[<>&]/g, '') : 'Abra o portal pelo “Iniciar Portal.cmd” (http://127.0.0.1:8765): os dados são lidos do banco pelo servidor local.'}</div></div>`; });
/* FUP · Produção regional — todos os números exibidos vêm do banco dw_fup (robô diário + tabelas manuais)
   (Compromissos D0, abas mensais Ati/Ret e CAPACITY). Regionais, Desktop e percentuais
   NÃO são recalculados: vêm das próprias linhas da planilha, para bater 1:1 com o arquivo. */
const D = window.PORTAL_DATA, VAL = window.PORTAL_VALIDATION || null;
// Usuário logado (só existe no servidor local do FUP, com login). Sem ele (ex.: cópia pública no IQT) o portal funciona como antes.
const USER = window.PORTAL_USER || null;
const E = D.entities, T = D.types, TT = [...T, 'Total'];
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const WD = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const dObj = s => new Date(s + 'T12:00:00');
const fDate = s => s ? dObj(s).toLocaleDateString('pt-BR') : '—';
const fShort = s => { const d = dObj(s); return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}` };
const fLong = s => { const d = dObj(s); return `${WD[d.getDay()]}, ${d.getDate()} de ${MONTHS[d.getMonth()]}` };
const fMonth = m => { const [y, mm] = m.split('-'); return `${MONTHS[+mm - 1]}/${y.slice(2)}` };
const nf = (v, dec = 0) => v == null || Number.isNaN(v) ? '—' : v.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: dec });
const n1 = v => nf(v, Math.abs(v ?? 0) >= 100 ? 0 : 1);
const exact = v => v == null ? '—' : v.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
const pct = (v, dec = 1) => v == null || !isFinite(v) ? '—' : (v * 100).toLocaleString('pt-BR', { minimumFractionDigits: dec, maximumFractionDigits: dec }) + '%';
const ratio = (a, b) => a == null || b == null || !b ? null : a / b;
const icon = id => `<svg aria-hidden="true"><use href="#${id}"/></svg>`;
const ENT_COLOR = { CE: 'var(--r-ce)', CO: 'var(--r-co)', SE: 'var(--r-se)' };

/* ------------------------------------------------------------------ estado */
const S = {
  view: 'resumo', di: D.days.length - 1, reg: 12, type: -1, matrix: 'du',
  from: D.days.at(-2).date, to: D.days.at(-2).date, mday: '1', msit: 'all', mrisk: 'all', micons: 'risk', mcity: null,  // mapa: previsão de amanhã por padrão
  // período do realizado; padrão = D-1 do último bloco
  month: null, service: 'Ativação', export: null,
};
const day = i => D.days[i] || null;
const scope = reg => reg === 12 ? [...Array(13).keys()] : [reg, reg + 1, reg + 2, reg + 3];
const children = reg => reg === 12 ? [0, 4, 8] : [reg + 1, reg + 2, reg + 3];
const entName = e => E[e].name;

/** Valor da planilha. t = -1 → visão "todos os serviços": usa a coluna TOTAL; Fila = Σ dos 6 serviços. */
function get(d, key, e, t) {
  const m = d && d[key];
  if (!m || !m[e]) return null;
  if (t < 0) {
    if (key === 'queue') { let s = null; for (let k = 0; k < 6; k++) if (m[e][k] != null) s = (s || 0) + m[e][k]; return s; }
    if (key === 'du' || key === 'emax' || key === 'entrAvg') return null;
    return m[e][7] ?? null;
  }
  return m[e][t] ?? null;
}
const hasDU = t => t < 6;  // Retiradas não tem DU

/* ------------------------------------------------------------------ status (sempre com ícone + rótulo) */
function duStatus(du, alvo) {
  if (du == null || !alvo) return { cls: 'st-none', label: 'Sem dado', ic: 'i-dot' };
  const r = du / alvo;
  if (r > 1.25) return { cls: 'st-crit', label: 'Crítico', ic: 'i-warn' };
  if (r > 1) return { cls: 'st-warn', label: 'Acima do alvo', ic: 'i-warn' };
  if (r >= .75) return { cls: 'st-good', label: 'No alvo', ic: 'i-ok' };
  return { cls: 'st-good', label: 'Folga', ic: 'i-ok' };
}
function pctStatus(p) {  // faixas da aba PALETA da planilha (100 / 90 / 80 %)
  if (p == null) return { cls: 'st-none', label: 'Sem dado', ic: 'i-dot' };
  if (p >= 1) return { cls: 'st-good', label: 'Atingido', ic: 'i-ok' };
  if (p >= .9) return { cls: 'st-warn', label: 'Próximo', ic: 'i-warn' };
  if (p >= .8) return { cls: 'st-serious', label: 'Atenção', ic: 'i-warn' };
  return { cls: 'st-crit', label: 'Abaixo', ic: 'i-down' };
}
const badge = st => `<span class="status ${st.cls}">${icon(st.ic)}${st.label}</span>`;
const statusCell = (txt, st, tip) => `<span class="cell ${st.cls}" data-tip="${esc(tip || st.label)}">${st.cls === 'st-none' ? '' : icon(st.ic)}${txt}</span>`;

/* ------------------------------------------------------------------ gráficos (SVG) */
const CHARTS = {};
let chartSeq = 0;
function niceStep(raw) { const p = 10 ** Math.floor(Math.log10(raw || 1)), f = raw / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p; }
function ticksFor(min, max, n = 4) {
  if (max === min) max = min + 1;
  const step = niceStep((max - min) / n); const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
  const out = []; for (let v = lo; v <= hi + step / 2; v += step) out.push(+v.toFixed(10)); return out;
}
/** Gráfico de linhas com crosshair + tooltip. series: [{name, color, values, dash, area, bar}] — bar: série em barras (várias séries em barras ficam agrupadas lado a lado em cada dia) */
function lineChart({ labels, series, height = 260, yfmt = n1, ref = null, tipfmt = null, xfmt = fShort, minZero = true, width = 880 }) {
  const id = 'c' + (++chartSeq), W = width, H = height, L = 54, R = 92, Tp = 12, B = 30;
  const all = series.flatMap(s => s.values).filter(v => v != null).concat(ref != null ? [ref] : []);
  if (!all.length) return `<div class="empty">Sem valores no banco para este recorte.</div>`;
  let mn = Math.min(...all), mx = Math.max(...all); if (minZero) mn = Math.min(0, mn);
  const tk = ticksFor(mn, mx), y0 = tk[0], y1 = tk[tk.length - 1];
  const n = labels.length, barS = series.filter(s => s.bar), bars = barS.length > 0, slot = (W - L - R) / Math.max(1, bars ? n : n - 1);
  const x = i => bars ? L + (i + .5) * slot : L + (n <= 1 ? (W - L - R) / 2 : i * slot), ix = px => Math.round(bars ? (px - L) / slot - .5 : (px - L) / slot), y = v => Tp + (1 - (v - y0) / (y1 - y0)) * (H - Tp - B);
  let g = '';
  tk.forEach(v => { g += `<line class="grid-line" x1="${L}" x2="${W - R + 6}" y1="${y(v)}" y2="${y(v)}"/><text class="axis-label" x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${yfmt(v)}</text>` });
  if (ref != null) g += `<line class="ref" x1="${L}" x2="${W - R + 6}" y1="${y(ref)}" y2="${y(ref)}"/>`;
  const every = Math.max(1, Math.ceil(n / 9));
  labels.forEach((lb, i) => { if ((i % every === 0 && n - 1 - i >= every * .6) || i === n - 1) g += `<text class="axis-label" x="${x(i)}" y="${H - 8}" text-anchor="middle">${xfmt(lb)}</text>` });
  const ends = [];
  series.forEach(s => {
    let seg = [], segs = [];
    s.values.forEach((v, i) => { if (v == null) { if (seg.length) segs.push(seg); seg = []; } else seg.push([x(i), y(v)]) });
    if (seg.length) segs.push(seg);
    if (s.bar) {
      const base = y(Math.max(0, y0)), bw = Math.max(1.5, slot * .8 / barS.length), off = (barS.indexOf(s) - (barS.length - 1) / 2) * bw;
      s.values.forEach((v, i) => { if (v != null) g += `<rect class="bar" fill="${s.color}" x="${x(i) + off - bw / 2}" y="${Math.min(base, y(v))}" width="${bw}" height="${Math.abs(base - y(v))}" rx="2"/>` });
      return;
    }
    segs.forEach(sg => {
      if (s.area && sg.length > 1) g += `<path class="area" fill="${s.color}" d="M${sg[0][0]},${y(Math.max(0, y0))} ${sg.map(p => 'L' + p.join(',')).join(' ')} L${sg[sg.length - 1][0]},${y(Math.max(0, y0))}Z"/>`;
      if (sg.length === 1) g += `<circle cx="${sg[0][0]}" cy="${sg[0][1]}" r="3.5" fill="${s.color}"/>`;
      else g += `<polyline class="series" stroke="${s.color}" ${s.dash ? 'stroke-dasharray="6 5"' : ''} points="${sg.map(p => p.join(',')).join(' ')}"/>`;
    });
    const li = s.values.map((v, i) => v == null ? -1 : i).filter(i => i >= 0).pop();
    if (li != null && li >= 0 && !s.noEnd) ends.push({ x: x(li), y: y(s.values[li]), color: s.color, text: s.short || s.name, v: s.values[li] });
  });
  // rótulos diretos no fim das linhas, sem sobreposição
  ends.sort((a, b) => a.y - b.y); for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 14) ends[i].y = ends[i - 1].y + 14;
  ends.forEach(e => { g += `<circle cx="${e.x}" cy="${e.y}" r="3.5" fill="${e.color}" stroke="var(--surface)" stroke-width="2"/><text class="end-label" x="${W - R + 12}" y="${e.y + 4}" fill="var(--ink-2)">${esc(e.text)}</text>` });
  g += `<line class="cross" x1="0" x2="0" y1="${Tp}" y2="${H - B}"/>` + series.map((s, k) => s.bar ? '' : `<circle class="hover-dot" data-k="${k}" r="4.5" fill="${s.color}"/>`).join('');
  g += `<rect class="hit" x="${L}" y="0" width="${W - L - R}" height="${H}" fill="transparent"/>`;
  CHARTS[id] = { labels, series, x, ix, y, W, L, R, n, yfmt: tipfmt || yfmt, xfmt };
  return `<div class="chart" data-chart="${id}"><svg class="plot" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(series.map(s => s.name).join(', '))}">${g}</svg></div>`;
}
function bindCharts(root) {
  root.querySelectorAll('[data-chart]').forEach(el => {
    const c = CHARTS[el.dataset.chart]; if (!c) return; const svg = el.querySelector('svg'), hit = svg.querySelector('.hit');
    const move = ev => {
      const r = svg.getBoundingClientRect(), px = (ev.clientX - r.left) / r.width * c.W;
      const i = Math.max(0, Math.min(c.n - 1, c.ix(px)));
      const xx = c.x(i); el.classList.add('hovering');
      svg.querySelector('.cross').setAttribute('x1', xx); svg.querySelector('.cross').setAttribute('x2', xx);
      svg.querySelectorAll('.hover-dot').forEach(dt => { const v = c.series[dt.dataset.k].values[i]; if (v == null) dt.setAttribute('r', 0); else { dt.setAttribute('r', 4.5); dt.setAttribute('cx', xx); dt.setAttribute('cy', c.y(v)); } });
      showTip(`<div class="tt-title">${esc(typeof c.xfmt === 'function' && c.labels[i]?.length === 10 ? fLong(c.labels[i]) : c.xfmt(c.labels[i]))}</div>` + c.series.map(s => `<div class="tt-row"><span><i style="background:${s.color}"></i>${esc(s.name)}</span><b>${s.values[i] == null ? '—' : c.yfmt(s.values[i])}</b></div>`).join(''), ev);
    };
    hit.addEventListener('mousemove', move); hit.addEventListener('mouseleave', () => { el.classList.remove('hovering'); hideTip(); });
  });
}
function spark(values, color = 'var(--s-real)') {
  const v = values.filter(x => x != null); if (v.length < 2) return '';
  const mn = Math.min(...v), mx = Math.max(...v), W = 200, H = 34, n = values.length;
  const pts = values.map((x, i) => x == null ? null : `${(i / (n - 1) * W).toFixed(1)},${(H - 3 - (mx === mn ? .5 : (x - mn) / (mx - mn)) * (H - 6)).toFixed(1)}`).filter(Boolean);
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts.join(' ')}" fill="none" stroke="${color}" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

/* ------------------------------------------------------------------ tooltip genérico */
const tip = () => $('#tooltip');
function showTip(html, ev) {
  const t = tip(); t.innerHTML = html; t.classList.add('show');
  const w = t.offsetWidth, h = t.offsetHeight; let x = ev.clientX + 16, y = ev.clientY + 16;
  if (x + w > innerWidth - 8) x = ev.clientX - w - 16; if (y + h > innerHeight - 8) y = ev.clientY - h - 16;
  t.style.left = x + 'px'; t.style.top = y + 'px';
}
function hideTip() { tip().classList.remove('show'); }
document.addEventListener('mouseover', ev => { const el = ev.target.closest?.('[data-tip]'); if (el && !el.closest('[data-chart]')) showTip(el.dataset.tip, ev); });
document.addEventListener('mousemove', ev => { const el = ev.target.closest?.('[data-tip]'); if (el && !el.closest('[data-chart]')) showTip(el.dataset.tip, ev); });
document.addEventListener('mouseout', ev => { if (ev.target.closest?.('[data-tip]')) hideTip(); });

/* ------------------------------------------------------------------ componentes */
const card = (title, sub, body, extra = '', cls = '') => `<section class="card ${cls}"><div class="card-head"><div><h2>${title}</h2>${sub ? `<div class="sub">${sub}</div>` : ''}</div>${extra}</div>${body}</section>`;
function kpi(label, value, foot = '', sp = '', tipTxt = '') {
  return `<article class="card kpi"${tipTxt ? ` data-tip="${esc(tipTxt)}"` : ''}><div class="kpi-label">${label}</div><div class="kpi-value">${value}</div><div class="kpi-foot">${foot}</div>${sp}</article>`;
}
function delta(cur, prev, { lowerIsBetter = true, asPct = false } = {}) {
  if (cur == null || prev == null) return '';
  const dv = cur - prev, rel = prev ? dv / prev : null;
  if (Math.abs(dv) < 1e-9) return `<span class="delta flat">= D-1</span>`;
  const good = lowerIsBetter ? dv < 0 : dv > 0;
  return `<span class="delta ${good ? 'good' : 'bad'}">${dv > 0 ? '▲' : '▼'} ${asPct ? pct(Math.abs(dv)) + ' p.p.' : n1(Math.abs(dv))}${rel != null && !asPct ? ` (${pct(Math.abs(rel), 0)})` : ''}</span>`;
}
const tabs = (name, items, cur) => `<div class="tabs" data-tabs="${name}">${items.map(([k, l]) => `<button data-k="${k}" class="${String(k) === String(cur) ? 'on' : ''}">${l}</button>`).join('')}</div>`;
const lvl = e => E[e].level;
const rowName = e => `<strong>${esc(entName(e))}</strong>${lvl(e) === 'polo' ? `<small>${E[e].code}</small>` : ''}`;
const typeLabel = t => t < 0 ? 'Todos os serviços' : T[t];
const scopeLabel = () => S.reg === 12 ? 'Desktop' : entName(S.reg);

/* ------------------------------------------------------------------ matriz (réplica dos blocos do RESUMO) */
const MATRIX = {
  du: { label: 'DU D0', title: 'DU controle — estoque em dias úteis', when: 'd0', types: 6 },
  queue: { label: 'Fila D0', title: 'Fila total (estoque de ordens)', when: 'd0', types: 6 },
  need: { label: 'Necessidade D0', title: 'Necessidade de produção de hoje', when: 'd0', types: 8 },
  commit: { label: 'Compromisso D0', title: 'Compromisso de hoje', when: 'd0', types: 8 },
  pctCommit: { label: '% Comp. D-1', title: '% do compromisso realizado ontem', when: 'd1', types: 8 },
  pctNeed: { label: '% Nec. D-1', title: '% da necessidade realizada ontem', when: 'd1', types: 8 },
  actual: { label: 'Realizado D-1', title: 'Realizado de ontem', when: 'd1', types: 8 },
};
function matrix(key, d0, d1) {
  const M = MATRIX[key], d = M.when === 'd0' ? d0 : d1, prev = M.when === 'd0' ? d1 : null;
  const types = [...Array(M.types).keys()];
  const head = `<tr><th>Polo / regional</th>${types.map(t => `<th>${esc(TT[t])}</th>`).join('')}</tr>`;
  const rows = scope(S.reg).map(e => `<tr class="lvl-${lvl(e)} click" data-ent="${e}">` + `<td>${rowName(e)}</td>` + types.map(t => {
    const v = d?.[key]?.[e]?.[t] ?? null;
    if (key === 'du') {
      const alvo = d?.target?.[t], st = duStatus(v, alvo), pv = prev?.du?.[e]?.[t];
      const dv = v != null && pv != null ? v - pv : null;
      return `<td>${statusCell(nf(v, 2), st, `${TT[t]} · ${entName(e)}<br>DU ${exact(v)} · alvo ${nf(alvo, 2)}<br>${st.label}`)}${dv != null && Math.abs(dv) > 1e-9 ? `<span class="var ${dv > 0 ? 'up' : 'down'}">${dv > 0 ? '+' : ''}${nf(dv, 2)}</span>` : ''}</td>`;
    }
    if (key === 'pctCommit' || key === 'pctNeed') {
      const st = pctStatus(v);
      return `<td>${v == null ? '<span class="na">—</span>' : statusCell(pct(v, 0), st, `${TT[t]} · ${entName(e)}<br>${pct(v)} · ${st.label}`)}</td>`;
    }
    if (key === 'queue') {
      const pv = prev?.queue?.[e]?.[t], dv = v != null && pv != null ? v - pv : null;
      return `<td><span data-tip="${esc(`${TT[t]} · ${entName(e)}<br>Fila ${exact(v)}${pv != null ? ` · D-1 ${exact(pv)}` : ''}`)}">${n1(v)}</span>${dv ? `<span class="var ${dv > 0 ? 'up' : 'down'}">${dv > 0 ? '+' : ''}${n1(dv)}</span>` : ''}</td>`;
    }
    return `<td>${v == null ? '<span class="na">—</span>' : `<span data-tip="${esc(`${TT[t]} · ${entName(e)}<br>${exact(v)}`)}">${n1(v)}</span>`}</td>`;
  }).join('') + '</tr>').join('');
  S.export = { name: `${key}-${d?.date}`, rows: scope(S.reg).map(e => Object.fromEntries([['Polo/regional', entName(e)], ...types.map(t => [TT[t], d?.[key]?.[e]?.[t] ?? ''])])) };
  const legend = key === 'du'
    ? `<div class="legend">${['st-good|Folga / no alvo (≤ alvo)', 'st-warn|Acima do alvo (até 1,25×)', 'st-crit|Crítico (> 1,25× o alvo)'].map(x => { const [c, l] = x.split('|'); return `<span class="status ${c}">${l}</span>` }).join('')}<span>Alvo: ${types.map(t => `${TT[t]} ${nf(d?.target?.[t], 2)}`).join(' · ')}</span></div>`
    : key.startsWith('pct') ? `<div class="legend">${['st-good|≥ 100%', 'st-warn|90–99%', 'st-serious|80–89%', 'st-crit|< 80%'].map(x => { const [c, l] = x.split('|'); return `<span class="status ${c}">${l}</span>` }).join('')}<span>Faixas da aba PALETA</span></div>` : '';
  return `<div class="table-wrap"><table><thead>${head}</thead><tbody>${rows}</tbody></table></div><div class="table-foot">${legend}<span>${M.title} · ${fDate(d?.date)} · ${key === 'commit' ? 'man_compromisso (dw_fup)' : `${esc(d?.col || '—')} · dw_fup`}</span></div>`;
}

/* ------------------------------------------------------------------ capacity helpers */
const CAPK = ['mopPlan', 'mopConf', 'mopActual', 'motPlan', 'motConf', 'motActual'];
function capAt(date, e) {
  const C = D.capacity, i = C.dates.indexOf(date); if (i < 0) return null;
  return Object.fromEntries(CAPK.map(k => [k, C[k][e][i]]));
}
/** D-1 do capacity como no RESUMO: segunda-feira soma sábado + domingo. */
function capD1(d0date, e) {
  const d = dObj(d0date), iso = x => { const z = new Date(d); z.setDate(z.getDate() - x); return z.toISOString().slice(0, 10) };
  if (d.getDay() === 1) {
    const a = capAt(iso(2), e), b = capAt(iso(1), e); if (!a || !b) return null;
    return Object.fromEntries(CAPK.map(k => [k, a[k] == null && b[k] == null ? null : (a[k] || 0) + (b[k] || 0)]));
  }
  return capAt(iso(1), e);
}

/* ------------------------------------------------------------------ VIEW: painel do dia */
function vPainel() {
  const d0 = day(S.di), d1 = realizedDay(), e = S.reg, t = S.type, multi = d1?.n > 1;
  const real = get(d1, 'actual', e, t), comp1 = get(d1, 'commit', e, t), need1 = get(d1, 'need', e, t);
  const pc = get(d1, 'pctCommit', e, t < 0 ? 7 : t), pn = get(d1, 'pctNeed', e, t < 0 ? 7 : t);
  const need0 = get(d0, 'need', e, t), comp0 = get(d0, 'commit', e, t), q0 = get(d0, 'queue', e, t), q1 = get(d1, 'queue', e, t);
  const scale = Math.max(need1 || 0, comp1 || 0, real || 0) || 1;
  const notices = [];
  if (multi) notices.push(`<div class="card" style="padding:10px 16px;margin-bottom:14px;font-size:13px">Período ${realLabel(d1)}: soma dos blocos diários do Compromissos D0 (foto do D-1 de cada dia). O acumulado das abas mensais (Metas do mês) pode diferir quando a aba foi atualizada depois da foto — causas por dia na <b>Conferência</b>. Fila, DU e D0 referem-se ao último dia.</div>`);
  const hist = D.days.slice(Math.max(0, S.di - 14), S.di);
  const hero = `<section class="card hero"><div class="eyebrow">${multi ? 'Realizado no período' : 'Realizado D-1'} · ${realLabel(d1, true)}</div>
    <div class="hero-main"><span class="hero-value">${n1(real)}</span><span class="hero-unit">ordens executadas · ${esc(scopeLabel())} · ${esc(typeLabel(t))}</span></div>
    <div class="hero-note">${pct(pc)} do compromisso · ${pn != null ? `${pct(pn)} da necessidade` : 'necessidade —'}</div>
    <div class="meter" data-tip="Barra = realizado ÷ necessidade · marca branca = compromisso"><i style="width:${Math.min(100, (real || 0) / scale * 100)}%"></i>${comp1 != null ? `<em style="left:${Math.min(100, comp1 / scale * 100)}%"></em>` : ''}</div>
    <div class="meter-legend"><span>0</span><span>Compromisso ${n1(comp1)}</span><span>Necessidade ${n1(need1)}</span></div>
    <div class="hero-stats">
      <div class="hero-stat"><span>Necessidade</span><b>${n1(need1)}</b><small>${multi ? 'Σ dos dias do período' : `Calculada para ${fShort(d1?.date)}`}</small></div>
      <div class="hero-stat"><span>Compromisso</span><b>${n1(comp1)}</b><small>${multi ? 'Σ dos dias do período' : 'Acordado com as regionais'}</small></div>
      <div class="hero-stat"><span>Realizado</span><b>${n1(real)}</b><small>${badge(pctStatus(pc))}</small></div>
    </div></section>`;
  const today = card(`Hoje · ${fLong(d0.date)}`, 'Necessidade de produção e estoque para D0', `
    <div class="grid g-2" style="gap:12px">
      ${miniStat('Necessidade D0', n1(need0), 'Fila + entrante previsto − estoque máximo')}
      ${miniStat('Compromisso D0', n1(comp0), d0.commitSource ? `Digitado pelas regionais · fonte ${esc(d0.commitSource)} (ainda não colado no Acompanhamento)` : 'Digitado pelas regionais')}
      ${miniStat('Fila D0', n1(q0), delta(q0, q1))}
      ${miniStat(t >= 0 && hasDU(t) ? `DU ${T[t]}` : 'Entrante médio D0', t >= 0 && hasDU(t) ? `${nf(get(d0, 'du', e, t), 2)} <small class="na">/ alvo ${nf(d0.target?.[t], 2)}</small>` : n1(t >= 0 ? get(d0, 'entrAvg', e, t) : sumTypes(d0, 'entrAvg', e)), t >= 0 && hasDU(t) ? badge(duStatus(get(d0, 'du', e, t), d0.target?.[t])) : `Média das 4 últimas semanas${t < 0 ? ' · soma dos 7 serviços' : ''}`)}
    </div>`);
  const cp = capD1(d0.date, e), capCov = cp ? ratio((cp.mopActual || 0) + (cp.motActual || 0), (cp.mopPlan || 0) + (cp.motPlan || 0)) : null;
  const kpis = `<div class="grid g-4">
    ${kpi(multi ? '% Compromisso do período' : '% Compromisso D-1', pct(pc), badge(pctStatus(pc)), spark(hist.map(x => get(x, 'pctCommit', e, t < 0 ? 7 : t))), multi ? 'Σ realizado ÷ Σ compromisso do período · linha: 14 registros até o fim' : 'Realizado ÷ compromisso · últimos 14 registros na linha')}
    ${kpi(multi ? '% Necessidade do período' : '% Necessidade D-1', pct(pn), badge(pctStatus(pn)), spark(hist.map(x => get(x, 'pctNeed', e, t < 0 ? 7 : t)), 'var(--s-need)'), multi ? 'Σ realizado ÷ Σ necessidade do período' : 'Realizado ÷ necessidade · últimos 14 registros')}
    ${kpi('Fila total D0', n1(q0), `${delta(q0, q1)} <span>vs ${fShort(d1?.date)}</span>`, spark(hist.concat([d0]).map(x => get(x, 'queue', e, t)), 'var(--s-comp)'), t < 0 ? 'Soma dos 6 serviços com fila (Retiradas não tem fila no RESUMO)' : '')}
    ${kpi('Capacity D-1', pct(capCov), cp ? `${n1((cp.mopActual || 0) + (cp.motActual || 0))} presentes de ${n1((cp.mopPlan || 0) + (cp.motPlan || 0))} comprometidos` : 'Sem capacity', '', `HC presente ÷ HC comprometido (próprio + terceiro)${multi ? ` · último dia do período (${fShort(d1.date)})` : ''}. Na segunda-feira, D-1 = sábado + domingo.`)}
  </div>`;
  const bullets = card(`Execução por serviço · ${realLabel(d1)}`, `${esc(scopeLabel())} — necessidade (faixa), compromisso (marca) e realizado (barra)`,
    `<div class="bullets">${[...Array(7).keys()].filter(x => t < 0 || x === t).map(x => bullet(T[x], get(d1, 'need', e, x), get(d1, 'commit', e, x), get(d1, 'actual', e, x), get(d1, 'pctCommit', e, x))).join('')}</div>
     <div class="legend" style="margin-top:14px"><span><i class="need"></i>Necessidade</span><span><i class="comp"></i>Compromisso</span><span><i></i>Realizado</span></div>`);
  const regs = card((S.reg === 12 ? 'Regionais' : `Polos da ${esc(entName(S.reg))}`) + (multi ? ` · ${realLabel(d1)}` : ' · D-1'), 'Realizado contra compromisso — clique para detalhar', `<div class="reg-list">${children(S.reg).map(c => regCard(c, d1, d0, t)).join('')}</div>`);
  const mx = card('Quadro do dia', multi ? `Mesma estrutura do RESUMO · realizado e % = Σ de ${realLabel(d1)}; D0 = ${fShort(d0.date)}` : 'Mesma estrutura do RESUMO · dados do dw_fup', matrix(S.matrix, d0, d1), tabs('matrix', Object.entries(MATRIX).map(([k, v]) => [k, v.label]), S.matrix));
  return notices.join('') + `<div class="grid g-hero">${hero}${today}</div>${kpis}<div class="grid g-7-5">${bullets}${regs}</div>${mx}`;
}
const miniStat = (l, v, f) => `<div class="card" style="box-shadow:none;background:var(--surface-2);padding:14px"><div class="kpi-label">${l}</div><div class="kpi-value" style="font-size:24px">${v}</div><div class="kpi-foot">${f}</div></div>`;
function sumTypes(d, key, e) { const r = d?.[key]?.[e]; if (!r) return null; let s = null; r.forEach(v => { if (v != null) s = (s || 0) + v }); return s; }
function bullet(name, need, comp, real, p) {
  const sc = Math.max(need || 0, comp || 0, real || 0) || 1;
  return `<div class="bullet"><div class="bullet-name">${esc(name)}<small>Nec. ${n1(need)}</small></div>
    <div class="bullet-track" data-tip="${esc(`<b>${name}</b><br>Necessidade ${exact(need)}<br>Compromisso ${exact(comp)}<br>Realizado ${exact(real)}`)}">
      <div class="need" style="width:${(need || 0) / sc * 100}%"></div><div class="real" style="width:${(real || 0) / sc * 100}%"></div>${comp != null ? `<div class="comp" style="left:calc(${comp / sc * 100}% - 1.5px)"></div>` : ''}</div>
    <div class="bullet-figs"><b>${n1(real)}</b>&nbsp;<span class="na">/ ${n1(comp)}</span>&nbsp;${badge(pctStatus(p)).replace(/>([^<]+)<\/span>$/, `>${pct(p, 0)}</span>`)}</div></div>`;
}
function regCard(c, d1, d0, t) {
  const real = get(d1, 'actual', c, t), comp = get(d1, 'commit', c, t), p = get(d1, 'pctCommit', c, t < 0 ? 7 : t), pn = get(d1, 'pctNeed', c, t < 0 ? 7 : t);
  const sub = lvl(c) === 'regional' ? [c + 1, c + 2, c + 3] : [];
  const color = ENT_COLOR[E[c].regional] || 'var(--s-real)';
  return `<article class="card reg-card" data-ent="${c}" style="box-shadow:none">
    <div class="reg-title"><span class="reg-swatch" style="background:${color}"></span>${esc(entName(c))}<span style="margin-left:auto">${badge(pctStatus(p))}</span></div>
    <div class="reg-figs"><div><span>Realizado</span><b>${n1(real)}</b></div><div><span>% Comp.</span><b>${pct(p, 0)}</b></div><div><span>% Nec.</span><b>${pct(pn, 0)}</b></div></div>
    ${sub.length ? `<div class="polos">${sub.map(s => { const r = get(d1, 'actual', s, t), cm = get(d1, 'commit', s, t), sc = Math.max(r || 0, cm || 0) || 1; return `<div class="polo-line" data-tip="${esc(`${entName(s)}<br>Realizado ${exact(r)} · Compromisso ${exact(cm)}`)}"><span>${esc(entName(s))}</span><div class="bar"><i style="width:${(r || 0) / sc * 100}%"></i>${cm ? `<em style="left:calc(${cm / sc * 100}% - 1px)"></em>` : ''}</div><b>${pct(ratio(r, cm), 0)}</b></div>` }).join('')}</div>` : `<div class="kpi-foot">Fila D0 ${n1(get(d0, 'queue', c, t))} · Nec. D0 ${n1(get(d0, 'need', c, t))}</div>`}
  </article>`;
}

/* ------------------------------------------------------------------ período (De / Até, no máximo 1 ano) */
const isoOf = z => `${z.getFullYear()}-${String(z.getMonth() + 1).padStart(2, '0')}-${String(z.getDate()).padStart(2, '0')}`;
const isoAdd = (s, days = 0, years = 0) => { const z = dObj(s); z.setFullYear(z.getFullYear() + years); z.setDate(z.getDate() + days); return isoOf(z); };
// Período do REALIZADO (filtro do topo, vale para todas as vistas). D0 = bloco do dia seguinte ao "Até".
const P_MIN = () => D.days[0].date;
const P_MAX = () => D.days.at(-2).date;  // último dia com bloco seguinte (D0)
const syncDi = () => { S.di = Math.max(1, D.days.findIndex(d => d.date > S.to)); if (S.di < 1 || D.days[S.di - 1].date > S.to) S.di = D.days.length - 1; };
const period = () => ({ from: S.from, to: S.to });
/** Vistas de série histórica: período de 1 dia vira os 30 dias até o "Até" (um único ponto não forma série). */
const seriesPeriod = () => S.from === S.to ? { from: isoAdd(S.to, -29), to: S.to, auto: true } : { from: S.from, to: S.to };
/** Aplica a escolha do usuário respeitando os limites dos dados e o máximo de 1 ano (ajusta o outro extremo). */
function setPeriod(which, val) {
  if (!val) return;
  let { from, to } = period(), note = '';
  val = val < P_MIN() ? P_MIN() : val > P_MAX() ? P_MAX() : val;
  if (which === 'from') { from = val; if (to < from) to = from; if (to > isoAdd(from, -1, 1)) { to = isoAdd(from, -1, 1); note = 'Período limitado a 1 ano: data final ajustada'; } }
  else { to = val; if (from > to) from = to; if (from < isoAdd(to, 1, -1)) { from = isoAdd(to, 1, -1); note = 'Período limitado a 1 ano: data inicial ajustada'; } }
  S.from = from; S.to = to; S.month = null; syncDi();
  render();
  if (note) toast(note);
}
/** Atalho "Mês": De = dia 1, Até = último dia do mês (ou o último dia com dados). */
function setMonth(ym) {
  if (!ym) return;
  const z = dObj(`${ym}-01`); z.setMonth(z.getMonth() + 1); z.setDate(0);
  S.from = `${ym}-01` < P_MIN() ? P_MIN() : `${ym}-01`; S.to = isoOf(z) > P_MAX() ? P_MAX() : isoOf(z); S.month = null;
  if (S.from > S.to) S.from = S.to;
  syncDi(); render();
}
/* ---------------------------------------------------------------- seletor de período (popover com calendário, estilo Metabase) */
const MESES_L = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const PP = { open: false, tab: 'entre', from: null, to: null, step: 0, hover: null, view: null, year: null };
const fBR = iso => iso ? iso.split('-').reverse().join('/') : '';
const parseBR = v => { const m = String(v).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); if (!m) return null; const iso = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; return isNaN(dObj(iso)) ? null : iso; };
const monthAdd = (ym, n) => { const [y, m] = ym.split('-').map(Number), z = new Date(y, m - 1 + n, 1); return `${z.getFullYear()}-${String(z.getMonth() + 1).padStart(2, '0')}`; };
const monthEnd = ym => { const z = dObj(ym + '-01'); z.setMonth(z.getMonth() + 1); z.setDate(0); return isoOf(z); };
/** Aplica De/Até de uma vez: limites dos dados, De ≤ Até e no máximo 1 ano (ajusta o início). */
function applyPeriod(from, to) {
  const clamp = v => v < P_MIN() ? P_MIN() : v > P_MAX() ? P_MAX() : v;
  from = clamp(from || to); to = clamp(to || from);
  if (from > to) [from, to] = [to, from];
  let note = '';
  if (from < isoAdd(to, 1, -1)) { from = isoAdd(to, 1, -1); note = 'Período limitado a 1 ano: data inicial ajustada'; }
  S.from = from; S.to = to; S.month = null; PP.open = false; syncDi(); render();
  if (note) toast(note);
}
const PP_CAL = '<svg class="pp-ic" viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>';
const periodCtl = () => `<div class="pp" data-period><button type="button" class="pp-trigger" id="pp-btn" aria-haspopup="dialog" aria-expanded="${PP.open}">${PP_CAL}<span>${viewF().per === 'dia' || S.from === S.to ? fBR(S.to) : `${fBR(S.from)} – ${fBR(S.to)}`}</span><svg class="pp-caret" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></button><div class="pp-pop" id="pp-pop" role="dialog" aria-label="Escolher período"${PP.open ? '' : ' hidden'}>${PP.open ? ppBody() : ''}</div></div>`;
function ppMonth(ym) {
  const [y, m] = ym.split('-').map(Number), lead = new Date(y, m - 1, 1).getDay(), dim = new Date(y, m, 0).getDate();
  const a = PP.from, b = PP.step && PP.hover ? PP.hover : PP.to;
  const lo = a && b ? (a < b ? a : b) : a, hi = a && b ? (a < b ? b : a) : a;
  let cells = '<span></span>'.repeat(lead);
  for (let d = 1; d <= dim; d++) {
    const iso = `${ym}-${String(d).padStart(2, '0')}`, dis = iso < P_MIN() || iso > P_MAX();
    const cls = ['pp-d', dis && 'dis', iso === lo && 'start', iso === hi && 'end', lo && hi && iso > lo && iso < hi && 'in', iso === P_MAX() && 'last'].filter(Boolean).join(' ');
    cells += `<button type="button" class="${cls}" data-pp-day="${iso}"${dis ? ' disabled' : ''}${iso === P_MAX() ? ' title="Último dia com realizado"' : ''}>${d}</button>`;
  }
  return `<div class="pp-cal"><div class="pp-cal-t">${MESES_L[m - 1]} ${y}</div><div class="pp-wd">${['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map(w => `<span>${w}</span>`).join('')}</div><div class="pp-grid">${cells}</div></div>`;
}
function ppBody() {
  const mx = P_MAX(), m0 = mx.slice(0, 7) + '-01';
  const dia = viewF().per === 'dia';
  const presets = dia ? [['Último dia', mx, mx], ['Dia anterior', isoAdd(mx, -1), isoAdd(mx, -1)], ['Há 1 semana', isoAdd(mx, -7), isoAdd(mx, -7)]]
    : [['Último dia', mx, mx], ['Últimos 7 dias', isoAdd(mx, -6), mx], ['Últimos 30 dias', isoAdd(mx, -29), mx], ['Este mês', m0, mx],
      ['Mês passado', monthAdd(mx.slice(0, 7), -1) + '-01', isoAdd(m0, -1)], ['Últimos 90 dias', isoAdd(mx, -89), mx]];
  const tabs_ = `<div class="pp-tabs">${(dia ? [['dia', 'Dia']] : [['entre', 'Entre'], ['dia', 'Dia'], ['mes', 'Mês']]).map(([k, l]) => `<button type="button" data-pp-tab="${k}" class="${PP.tab === k ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  const pre = `<div class="pp-presets"><small>Atalhos</small>${presets.map(([l, a, b]) => `<button type="button" data-pp-pre="${a}|${b}" class="${PP.from === a && PP.to === b ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  let main;
  if (PP.tab === 'mes') {
    const y = PP.year;
    main = `<div class="pp-mhead"><button type="button" class="pp-nav" data-pp-y="-1" aria-label="Ano anterior">‹</button><b>${y}</b><button type="button" class="pp-nav" data-pp-y="1" aria-label="Próximo ano">›</button></div>
      <div class="pp-months">${MESES_L.map((nm, i) => { const ym = `${y}-${String(i + 1).padStart(2, '0')}`, dis = ym > mx.slice(0, 7) || ym < P_MIN().slice(0, 7), on = PP.from?.slice(0, 7) === ym && PP.to === (monthEnd(ym) > mx ? mx : monthEnd(ym)); return `<button type="button" data-pp-month="${ym}"${dis ? ' disabled' : ''} class="${on ? 'on' : ''}">${nm}</button>`; }).join('')}</div>`;
  } else {
    main = `<div class="pp-inputs"><label>${PP.tab === 'dia' ? 'Dia' : 'De'}<input data-pp-in="from" value="${fBR(PP.from)}" placeholder="dd/mm/aaaa" inputmode="numeric"></label>${PP.tab === 'entre' ? `<span class="pp-dash">–</span><label>Até<input data-pp-in="to" value="${fBR(PP.to)}" placeholder="dd/mm/aaaa" inputmode="numeric"></label>` : ''}</div>
      <div class="pp-cals"><button type="button" class="pp-nav" data-pp-nav="-1" aria-label="Mês anterior">‹</button>${ppMonth(PP.view)}${ppMonth(monthAdd(PP.view, 1))}<button type="button" class="pp-nav" data-pp-nav="1" aria-label="Próximo mês">›</button></div>`;
  }
  const hint = PP.tab === 'entre' ? (PP.step ? 'Agora clique no dia final' : 'Clique no dia inicial e depois no final') : PP.tab === 'dia' ? 'Clique no dia' : 'Escolha o mês';
  return `${tabs_}<div class="pp-body">${pre}<div class="pp-main">${main}</div></div>
    <div class="pp-foot"><span class="na">${hint} · dados de ${fBR(P_MIN())} a ${fBR(mx)} · máx. 1 ano</span><button type="button" class="btn" data-pp-cancel>Cancelar</button><button type="button" class="btn primary" data-pp-apply>Aplicar</button></div>`;
}
function ppDraw() { const pop = $('#pp-pop'); if (!pop) return; pop.innerHTML = ppBody(); pop.hidden = false; $('#pp-btn')?.setAttribute('aria-expanded', 'true'); }
function ppOpen() {
  const dia = viewF().per === 'dia';  // tela diária: escolhe um dia só (o "Até")
  Object.assign(PP, { open: true, tab: dia || S.from === S.to ? 'dia' : 'entre', from: dia ? S.to : S.from, to: S.to, step: 0, hover: null, year: +S.to.slice(0, 4) });
  PP.view = monthAdd(S.to.slice(0, 7), -1);
  if (PP.view < P_MIN().slice(0, 7)) PP.view = P_MIN().slice(0, 7);
  ppDraw();
}
function ppClose() { PP.open = false; const pop = $('#pp-pop'); if (pop) { pop.hidden = true; pop.innerHTML = ''; } $('#pp-btn')?.setAttribute('aria-expanded', 'false'); }
/** Eventos do seletor (delegados no contêiner #f-period, que não é recriado). */
function ppBind() {
  const host = $('#f-period');
  host.addEventListener('click', ev => {
    const t = ev.target.closest('button'); if (!t) return;
    const ds = t.dataset;
    if (t.id === 'pp-btn') return PP.open ? ppClose() : ppOpen();
    if (ds.ppTab) { PP.tab = ds.ppTab; PP.step = 0; if (PP.tab === 'dia') PP.to = PP.from; if (PP.tab === 'mes') PP.year = +(PP.to || S.to).slice(0, 4); return ppDraw(); }
    if (ds.ppPre) { [PP.from, PP.to] = ds.ppPre.split('|'); PP.tab = PP.from === PP.to ? 'dia' : 'entre'; PP.step = 0; PP.view = monthAdd(PP.to.slice(0, 7), -1); return ppDraw(); }
    if (ds.ppNav) { PP.view = monthAdd(PP.view, +ds.ppNav); return ppDraw(); }
    if (ds.ppY) { PP.year += +ds.ppY; return ppDraw(); }
    if (ds.ppMonth) { PP.from = ds.ppMonth + '-01'; PP.to = monthEnd(ds.ppMonth); return ppDraw(); }
    if (ds.ppDay) {
      const d = ds.ppDay;
      if (PP.tab === 'dia') { PP.from = PP.to = d; }
      else if (!PP.step) { PP.from = PP.to = d; PP.step = 1; }
      else { if (d < PP.from) { PP.to = PP.from; PP.from = d; } else PP.to = d; PP.step = 0; }
      PP.hover = null; return ppDraw();
    }
    if ('ppCancel' in ds) return ppClose();
    if ('ppApply' in ds) return applyPeriod(PP.from, PP.to);
  });
  host.addEventListener('mouseover', ev => { const t = ev.target.closest('[data-pp-day]'); if (PP.step && t && t.dataset.ppDay !== PP.hover) { PP.hover = t.dataset.ppDay; ppDraw(); } });
  host.addEventListener('change', ev => {
    const k = ev.target.dataset?.ppIn; if (!k) return;
    const iso = parseBR(ev.target.value); if (!iso) { ev.target.classList.add('bad'); return; }
    PP[k] = iso; if (PP.tab === 'dia') PP.to = PP.from; PP.step = 0; PP.view = monthAdd(iso.slice(0, 7), k === 'to' ? -1 : 0); ppDraw();
  });
  host.addEventListener('keydown', ev => {
    if (ev.key !== 'Enter' || !PP.open || !ev.target.dataset?.ppIn) return;
    const iso = parseBR(ev.target.value); if (iso) { PP[ev.target.dataset.ppIn] = iso; if (PP.tab === 'dia') PP.to = PP.from; }
    applyPeriod(PP.from, PP.to);
  });
  // fecha ao clicar fora (composedPath: o alvo pode ter sido redesenhado dentro do seletor)
  document.addEventListener('click', ev => { if (PP.open && !ev.composedPath().includes(host)) ppClose(); });
}

/** Realizado exibido no Painel. 1 dia: o bloco D-1, valores da planilha. Período: Σ necessidade, compromisso e
 *  realizado dos blocos do período; % = Σ realizado ÷ Σ compromisso (ou necessidade); fila = último dia. */
function realizedDay() {
  const ds = D.days.filter(d => d.date >= S.from && d.date <= S.to);
  if (ds.length <= 1) return day(S.di - 1);
  const sumM = key => ds.at(-1)[key].map((row, e) => row.map((_, t) => { let s = null; ds.forEach(d => { const v = d[key]?.[e]?.[t]; if (v != null) s = (s || 0) + v; }); return s; }));
  const need = sumM('need'), commit = sumM('commit'), actual = sumM('actual');
  const div = (a, b) => a.map((row, e) => row.map((v, t) => v != null && b[e][t] ? v / b[e][t] : null));
  return { ...ds.at(-1), from: ds[0].date, n: ds.length, need, commit, actual, pctCommit: div(actual, commit), pctNeed: div(actual, need) };
}
const realLabel = (d1, long) => d1?.n > 1 ? `${fShort(d1.from)} a ${fShort(d1.date)} (${d1.n} dias)` : long ? fLong(d1?.date) : fShort(d1?.date);

/* ------------------------------------------------------------------ VIEW: evolução */
function rangeDays() {
  const { from, to } = seriesPeriod();
  return D.days.filter(d => d.date >= from && d.date <= to);
}
const autoNote = () => seriesPeriod().auto ? `<div class="card" style="padding:10px 16px;margin-bottom:14px;font-size:13px">Período de 1 dia: as séries mostram os 30 dias até ${fShort(S.to)}. Ajuste <b>De/Até</b> ou <b>Mês</b> no topo.</div>` : '';
function vEvolucao() {
  const e = S.reg, t = S.type, ds = rangeDays(), labels = ds.map(d => d.date);
  const real = ds.map(d => get(d, 'actual', e, t)), comp = ds.map(d => get(d, 'commit', e, t)), need = ds.map(d => get(d, 'need', e, t));
  const pc = ds.map(d => get(d, 'pctCommit', e, t < 0 ? 7 : t)), pn = ds.map(d => get(d, 'pctNeed', e, t < 0 ? 7 : t)), q = ds.map(d => get(d, 'queue', e, t));
  const sR = real.reduce((a, v) => a + (v || 0), 0), sC = comp.reduce((a, v, i) => a + (real[i] != null && v != null ? v : 0), 0), sN = need.reduce((a, v, i) => a + (real[i] != null && v != null ? v : 0), 0);
  const rangeTabs = '';
  S.export = { name: `evolucao-${E[e].code}`, rows: ds.map((d, i) => ({ Data: d.date, Necessidade: need[i] ?? '', Compromisso: comp[i] ?? '', Realizado: real[i] ?? '', '% Compromisso': pc[i] ?? '', '% Necessidade': pn[i] ?? '', Fila: q[i] ?? '' })) };
  const k = `<div class="grid g-4">
    ${kpi('Realizado no período', n1(sR), `${ds.filter((d, i) => real[i] != null).length} registros diários`)}
    ${kpi('% Compromisso no período', pct(ratio(sR, sC)), badge(pctStatus(ratio(sR, sC))), '', 'Σ realizado ÷ Σ compromisso dos dias com realizado')}
    ${kpi('% Necessidade no período', pct(ratio(sR, sN)), badge(pctStatus(ratio(sR, sN))), '', 'Σ realizado ÷ Σ necessidade dos dias com realizado')}
    ${kpi('Fila — início → fim', `${n1(q.find(v => v != null))} → ${n1(q.filter(v => v != null).pop())}`, delta(q.filter(v => v != null).pop(), q.find(v => v != null)))}
  </div>`;
  const c1 = card('Necessidade, compromisso e realizado', `${esc(scopeLabel())} · ${esc(typeLabel(t))} · um ponto por foto diária do robô`,
    lineChart({ labels, series: [{ name: 'Necessidade', short: 'Necessidade', color: 'var(--s-need)', values: need }, { name: 'Compromisso', short: 'Compromisso', color: 'var(--s-comp)', values: comp }, { name: 'Realizado', short: 'Realizado', color: 'var(--s-real)', values: real, area: true }], height: 300, tipfmt: nf })
    + `<div class="legend"><span><i class="line-need"></i>Necessidade</span><span><i style="background:var(--s-comp)"></i>Compromisso</span><span><i></i>Realizado</span></div>`, rangeTabs);
  const c2 = card('Atingimento diário', 'Linha tracejada = 100%', lineChart({ labels, series: [{ name: '% Compromisso', short: '% Comp.', color: 'var(--s-real)', values: pc }, { name: '% Necessidade', short: '% Nec.', color: 'var(--s-need)', values: pn }], height: 240, width: 560, yfmt: v => pct(v, 0), tipfmt: v => pct(v), ref: 1 })
    + `<div class="legend"><span><i></i>% Compromisso</span><span><i class="line-need"></i>% Necessidade</span></div>`);
  const c3 = card('Fila total', 'Estoque de ordens em aberto (D0 de cada bloco)', lineChart({ labels, series: [{ name: 'Fila', short: 'Fila', color: 'var(--s-comp)', values: q, area: true }], height: 240, width: 560, tipfmt: nf }));
  return autoNote() + k + c1 + `<div class="grid g-2">${c2}${c3}</div>`;
}

/* ------------------------------------------------------------------ VIEW: estoque & DU */
function vEstoque() {
  const d0 = day(S.di), d1 = day(S.di - 1), e = S.reg;
  const types = [...Array(6).keys()].filter(x => S.type < 0 || x === S.type);
  const cards = types.map(t => {
    const q = get(d0, 'queue', e, t), qp = get(d1, 'queue', e, t), du = get(d0, 'du', e, t), alvo = d0.target?.[t], em = get(d0, 'emax', e, t), ent = get(d0, 'entrAvg', e, t), st = duStatus(du, alvo);
    const exc = q != null && em != null ? q - em : null;
    return `<article class="card kpi"><div class="kpi-label">${esc(T[t])}${badge(st)}</div><div class="kpi-value">${nf(du, 2)} <small class="na" style="font-size:14px">DU · alvo ${nf(alvo, 2)}</small></div>
      <div class="kpi-foot">Fila <b>${n1(q)}</b> ${delta(q, qp)}</div>
      <dl class="kv" style="margin-top:6px"><dt>Estoque máximo</dt><dd>${n1(em)}</dd><dt>${exc != null && exc > 0 ? 'Excesso de fila' : 'Folga até o máximo'}</dt><dd style="color:${exc > 0 ? 'var(--crit)' : 'var(--good)'}">${n1(exc == null ? null : Math.abs(exc))}</dd><dt>Entrante médio D0</dt><dd>${n1(ent)}</dd></dl></article>`;
  }).join('');
  const ds = rangeDays(), labels = ds.map(d => d.date);
  const tt = S.type >= 0 && S.type < 6 ? S.type : 0;
  const chart = card(`Fila × estoque máximo · ${esc(T[tt])}`, `${esc(scopeLabel())} — acima da linha de estoque máximo, a fila excede o alvo de DU`,
    lineChart({ labels, series: [{ name: 'Fila', short: 'Fila', color: 'var(--s-real)', values: ds.map(d => get(d, 'queue', e, tt)), area: true }, { name: 'Estoque máximo', short: 'Estoque máx.', color: 'var(--s-need)', values: ds.map(d => get(d, 'queue', e, tt) == null ? null : get(d, 'emax', e, tt)), dash: true }], height: 280, width: 560, tipfmt: nf })
    + `<div class="legend"><span><i></i>Fila</span><span><i class="dash" style="background:repeating-linear-gradient(90deg,var(--s-need) 0 4px,transparent 4px 7px)"></i>Estoque máximo = fila ÷ DU × alvo</span></div>`,
    '');
  const duTrend = card(`DU ${esc(T[tt])} × alvo`, 'Evolução do estoque em dias úteis', lineChart({ labels, series: [{ name: `DU ${T[tt]}`, short: 'DU', color: 'var(--s-real)', values: ds.map(d => get(d, 'du', e, tt)) }], height: 280, width: 560, yfmt: v => nf(v, 1), tipfmt: v => nf(v, 3), ref: d0.target?.[tt] }) + `<div class="legend"><span><i></i>DU</span><span><i class="dash" style="background:repeating-linear-gradient(90deg,var(--ink-3) 0 4px,transparent 4px 7px)"></i>Alvo ${nf(d0.target?.[tt], 2)}</span></div>`);
  const m = card('DU controle por polo · D0', `Variação contra ${fShort(d1?.date)} abaixo de cada valor`, matrix('du', d0, d1));
  return autoNote() + `<div class="grid ${types.length > 3 ? 'g-3' : 'g-' + Math.max(1, types.length)}">${cards}</div><div class="grid g-2">${chart}${duTrend}</div>${m}`;
}

/* ------------------------------------------------------------------ VIEW: metas do mês */
function monthRecs() { return D.monthly.filter(m => m.service === S.service); }
function curMonth() {
  const recs = monthRecs(); const want = S.month || day(S.di).date.slice(0, 7);
  return recs.find(m => m.month === want) || recs[recs.length - 1];
}
function vMetas() {
  const m = curMonth(), e = S.reg, ati = m.service === 'Ativação';
  const lastIdx = m.actualDay[12].map((v, i) => v == null ? -1 : i).filter(i => i >= 0).pop() ?? -1;
  const target = m.target[e], actual = m.actual[e], proj = m.projection?.[e];
  const curveToDate = lastIdx >= 0 ? m.targetDay[e].slice(0, lastIdx + 1).reduce((a, v) => a + (v || 0), 0) : 0;
  const gap = m.gapDay ? m.gapDay[e].reduce((a, v) => a + (v || 0), 0) : actual - curveToDate;
  const cov = ati ? m.coverage?.[e] : ratio(proj, target);
  const d0date = day(S.di).date, fi = m.dates.indexOf(d0date);
  const fc = fi >= 0 ? m.forecastDay?.[e]?.[fi] : null;
  const k = `<div class="grid g-4">
    ${kpi(ati ? 'Meta do mês' : 'Meta do mês (churn × %)', n1(target), ati ? `Curva por peso de dia · ΣP ${nf(m.sumWeights, 2)}` : `${esc(m.labels?.metaA || 'Meta')} · base ${esc(m.labels?.churn || 'churn')} ${n1(m.churn?.[e])}`)}
    ${kpi('Realizado acumulado', n1(actual), `Meta até ${lastIdx >= 0 ? fShort(m.dates[lastIdx]) : '—'}: ${n1(curveToDate)} · <span class="delta ${gap >= 0 ? 'good' : 'bad'}">GAP ${gap >= 0 ? '+' : ''}${n1(gap)}</span>`)}
    ${kpi('Projeção do mês', n1(proj), `Realizado ÷ ΣP decorrido (${nf(m.sumWeightsDone, 2)}) × ΣP do mês`)}
    ${kpi(ati ? '% Cobertura da meta' : '% Projeção ÷ meta', pct(cov), badge(pctStatus(cov)) + (ati ? '' : ` <span class="na">vs ${esc(m.labels?.metaB || 'meta 2')}: ${pct(m.pctMetaB?.[e])}</span>`))}
  </div>`;
  // curva acumulada
  const cum = arr => { let s = 0; return arr.map(v => v == null ? null : (s += v)); };
  const cumMeta = cum(m.targetDay[e].map(v => v ?? 0));
  const cumReal = cum(m.actualDay[e].slice(0, lastIdx + 1)).concat(Array(m.dates.length - lastIdx - 1).fill(null));
  const cw = cum(m.weights.map(v => v ?? 0)), wDone = lastIdx >= 0 ? cw[lastIdx] : 0;
  const projLine = m.dates.map((_, i) => i < lastIdx || lastIdx < 0 || proj == null ? null : actual + (proj - actual) * (m.sumWeights - wDone ? (cw[i] - wDone) / (m.sumWeights - wDone) : 0));
  const chart = card(`Curva do mês · ${esc(scopeLabel())}`, `${esc(m.sheet)} — meta acumulada pela curva de pesos, realizado e projeção`,
    lineChart({ labels: m.dates, series: [{ name: 'Meta acumulada', short: 'Meta', color: 'var(--s-need)', values: cumMeta }, { name: 'Realizado acumulado', short: 'Realizado', color: 'var(--s-real)', values: cumReal, area: true }, { name: 'Projeção', short: 'Projeção', color: 'var(--s-real)', values: projLine, dash: true }], height: 290, tipfmt: nf })
    + `<div class="legend"><span><i class="line-need"></i>Meta acumulada</span><span><i></i>Realizado acumulado</span><span><i class="dash"></i>Projeção</span></div>`);
  const daily = card('Diário: meta × realizado × necessidade', 'Necessidade (forecast) = o que falta produzir por dia para fechar a meta', lineChart({ labels: m.dates, series: [{ name: 'Realizado', short: 'Realizado', color: 'var(--s-real)', values: m.actualDay[e], bar: true }, { name: 'Meta do dia', short: 'Meta', color: 'var(--s-need)', values: m.targetDay[e], bar: true }, { name: 'Necessidade (forecast)', short: 'Necessidade', color: 'var(--s-comp)', values: m.forecastDay?.[e] || [], bar: true }], height: 290, tipfmt: nf })
    + `<div class="legend"><span><i class="sq" style="background:var(--s-real)"></i>Realizado</span><span><i class="sq" style="background:var(--s-need)"></i>Meta do dia</span><span><i class="sq" style="background:var(--s-comp)"></i>Necessidade${fc != null ? ` · hoje ${n1(fc)}` : ''}</span></div>`);
  const cols = ati
    ? [['Meta', r => m.target[r]], ['Realizado', r => m.actual[r]], ['% realizado', r => ratio(m.actual[r], m.target[r]), 'p'], ['GAP vs curva', r => m.gapDay?.[r].reduce((a, v) => a + (v || 0), 0)], ['Projeção', r => m.projection[r]], ['% Cobertura', r => m.coverage[r], 'ps'], ['Nec. hoje', r => fi >= 0 ? m.forecastDay?.[r]?.[fi] : null], ['Efetividade', r => m.efetMonth?.[r], 'p'], ['Meta efet.', r => m.efetTarget?.[r], 'p']]
    : [['Base churn', r => m.churn?.[r]], [m.labels?.metaA || 'Meta A', r => m.metaA?.[r]], [m.labels?.metaB || 'Meta B', r => m.metaB?.[r]], ['Realizado', r => m.actual[r]], ['GAP vs curva', r => m.gapDay?.[r].reduce((a, v) => a + (v || 0), 0)], ['Projeção', r => m.projection[r]], ['Proj ÷ meta', r => ratio(m.projection[r], m.target[r]), 'ps'], ['Proj ÷ ' + (m.labels?.metaB || 'meta B'), r => m.pctMetaB?.[r], 'p'], ['Nec. hoje', r => fi >= 0 ? m.forecastDay?.[r]?.[fi] : null]];
  S.export = { name: `metas-${m.sheet}`, rows: scope(S.reg).map(r => Object.fromEntries([['Polo/regional', entName(r)], ...cols.map(([l, f]) => [l, f(r) ?? ''])])) };
  const table = card(`Metas por polo · ${fMonth(m.month)}`, `Valores da aba ${esc(m.sheet)}`,
    `<div class="table-wrap"><table><thead><tr><th>Polo / regional</th>${cols.map(c => `<th>${esc(c[0])}</th>`).join('')}</tr></thead><tbody>${scope(S.reg).map(r => `<tr class="lvl-${lvl(r)}"><td>${rowName(r)}</td>${cols.map(([l, f, k]) => { const v = f(r); return `<td>${k === 'ps' ? (v == null ? '—' : statusCell(pct(v), pctStatus(v))) : k === 'p' ? pct(v) : `<span data-tip="${esc(l + ': ' + exact(v))}">${n1(v)}</span>`}</td>` }).join('')}</tr>`).join('')}</tbody></table></div>`);
  const note = '';
  return `<div class="card" style="padding:12px 16px;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap"><div><b>${esc(m.service)} · ${fMonth(m.month)}</b> <span class="na">· ${m.dates.length} dias · ${lastIdx + 1} com realizado</span></div></div>${note}${k}${chart}${daily}${table}`;
}

/* ------------------------------------------------------------------ VIEW: capacity */
function vCapacity() {
  const d0 = day(S.di), e = S.reg, c1 = capD1(d0.date, e), c0 = capAt(d0.date, e);
  const monday = dObj(d0.date).getDay() === 1;
  const covT = c => c ? ratio((c.mopActual || 0) + (c.motActual || 0), (c.mopPlan || 0) + (c.motPlan || 0)) : null;
  const k = `<div class="grid g-4">
    ${kpi('HC próprio (MOP) presente', n1(c1?.mopActual), `de ${n1(c1?.mopPlan)} comprometidos · ${badge(pctStatus(ratio(c1?.mopActual, c1?.mopPlan)))}`)}
    ${kpi('HC terceiro (MOT) presente', n1(c1?.motActual), `de ${n1(c1?.motPlan)} comprometidos · ${badge(pctStatus(ratio(c1?.motActual, c1?.motPlan)))}`)}
    ${kpi('Cobertura total D-1', pct(covT(c1)), 'Presente ÷ comprometido (MOP + MOT)')}
    ${kpi('Confirmado COP D-1', n1(c1 ? (c1.mopConf || 0) + (c1.motConf || 0) : null), `Próprio ${n1(c1?.mopConf)} · terceiro ${n1(c1?.motConf)}`)}
  </div>`;
  const C = D.capacity, { from: pFrom, to: pTo } = seriesPeriod();
  const idx = C.dates.map((x, i) => x >= pFrom && x <= pTo ? i : -1).filter(i => i >= 0);
  const sum2 = (a, b) => (a == null && b == null) ? null : (a || 0) + (b || 0);
  const chart = card(`HC presente × comprometido · ${esc(scopeLabel())}`, 'Próprio + terceiro, por dia da aba CAPACITY',
    lineChart({ labels: idx.map(i => C.dates[i]), series: [{ name: 'Comprometido', short: 'Comprometido', color: 'var(--s-comp)', values: idx.map(i => sum2(C.mopPlan[e][i], C.motPlan[e][i])) }, { name: 'Presente', short: 'Presente', color: 'var(--s-real)', values: idx.map(i => sum2(C.mopActual[e][i], C.motActual[e][i])), area: true }], height: 280, width: 560, tipfmt: nf })
    + `<div class="legend"><span><i style="background:var(--s-comp)"></i>HC comprometido</span><span><i></i>HC presente</span></div>`,
    '');
  const split = card('Próprio × terceiro', 'HC presente por tipo de mão de obra', lineChart({ labels: idx.map(i => C.dates[i]), series: [{ name: 'MOP (próprio)', short: 'MOP', color: 'var(--s-real)', values: idx.map(i => C.mopActual[e][i]) }, { name: 'MOT (terceiro)', short: 'MOT', color: 'var(--s-need)', values: idx.map(i => C.motActual[e][i]) }], height: 280, width: 560, tipfmt: nf }) + `<div class="legend"><span><i></i>MOP · próprio</span><span><i class="line-need"></i>MOT · terceiro</span></div>`);
  const cols = [['MOP plan.', 'mopPlan'], ['MOP conf. COP', 'mopConf'], ['MOP real', 'mopActual'], ['MOT plan.', 'motPlan'], ['MOT conf. COP', 'motConf'], ['MOT real', 'motActual']];
  const rows = scope(S.reg).map(r => { const c = capD1(d0.date, r); return { r, c }; });
  S.export = { name: `capacity-${d0.date}`, rows: rows.map(({ r, c }) => Object.fromEntries([['Polo/regional', entName(r)], ...cols.map(([l, k]) => [l, c?.[k] ?? '']), ['Cobert. próprio', ratio(c?.mopActual, c?.mopPlan) ?? ''], ['Cobert. terceiro', ratio(c?.motActual, c?.motPlan) ?? ''], ['Cobert. total', covT(c) ?? '']])) };
  const table = card(`Capacity D-1 por polo${monday ? ' · segunda-feira: sábado + domingo' : ''}`, 'HC presente (VIEW_BSC) × HC comprometido (man_hc_compromisso)',
    `<div class="table-wrap"><table><thead><tr><th>Polo / regional</th>${cols.map(c => `<th>${c[0]}</th>`).join('')}<th>Cob. próprio</th><th>Cob. terceiro</th><th>Cob. total</th></tr></thead><tbody>${rows.map(({ r, c }) => `<tr class="lvl-${lvl(r)}"><td>${rowName(r)}</td>${cols.map(([, k]) => `<td><span data-tip="${esc(exact(c?.[k]))}">${n1(c?.[k])}</span></td>`).join('')}${[ratio(c?.mopActual, c?.mopPlan), ratio(c?.motActual, c?.motPlan), covT(c)].map(v => `<td>${v == null ? '<span class="na">—</span>' : statusCell(pct(v, 0), pctStatus(v), pct(v))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
    <div class="table-foot"><span>HC fracionado: técnico em mais de um polo no dia é rateado (regra da planilha de capacity).</span><span>D-0 (${fShort(d0.date)}): ${c0 && c0.mopActual != null ? n1((c0.mopActual || 0) + (c0.motActual || 0)) + ' presentes' : '—'}${d0.hcCommit?.[e] ? ` · HC comprometido D0 (man_hc_compromisso): próprio ${n1(d0.hcCommit[e][0])} · terceiro ${n1(d0.hcCommit[e][1])}` : ''}</span></div>`);
  const last = C.dates[C.dates.length - 1];
  const warn = '';
  return autoNote() + warn + k + `<div class="grid g-2">${chart}${split}</div>${table}`;
}

/* ------------------------------------------------------------------ VIEW: conferência */
function ring(ok, total, size = 44) {
  const r = size / 2 - 5, c = 2 * Math.PI * r, f = total ? ok / total : 0, col = f === 1 ? 'var(--good)' : f > .99 ? 'var(--warn)' : 'var(--crit)';
  return `<svg class="ring" viewBox="0 0 ${size} ${size}" aria-hidden="true"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" stroke="var(--line)" style="stroke-width:5"/><circle cx="${size / 2}" cy="${size / 2}" r="${r}" stroke="${col}" style="stroke-width:5" stroke-dasharray="${c * f} ${c}" transform="rotate(-90 ${size / 2} ${size / 2})" stroke-linecap="round"/></svg>`;
}
function vConferencia() {
  S.export = null;
  const st = D.stats || {};
  if (!VAL) return card('Conferência', '', `<div class="empty">Sem execução do robô registrada no banco (log_execucao).</div>`);
  const core = VAL.checks.filter(c => c.group !== 'Consistência');
  const ok = core.reduce((a, c) => a + c.ok, 0), tot = core.reduce((a, c) => a + c.total, 0);
  // Consistência: inconsistência da PRÓPRIA planilha. Só é aceitável com causa documentada (known_issues.json / fórmula).
  const unexp = c => c.unexplained ?? (c.total - c.ok);
  const list = (arr, isCons) => arr.map(c => { const okAll = c.ok === c.total, expl = isCons && !okAll && unexp(c) === 0; return `<div class="check">${ring(c.ok, c.total)}<div><h3>${esc(c.desc)}</h3><p>${esc(c.group)} · ${nf(c.ok)} de ${nf(c.total)} ${isCons ? 'somas coerentes' : 'valores idênticos'}${isCons && !okAll ? ` · ${nf(c.total - c.ok - unexp(c) - (c.hypotheses || 0))} com causa comprovada${c.hypotheses ? ` · ${nf(c.hypotheses)} com causa provável a confirmar` : ''}${unexp(c) ? ` · <b>${nf(unexp(c))} sem explicação</b>` : ''}` : ''}</p></div><span class="status ${okAll ? 'st-good' : expl ? 'st-warn' : 'st-crit'}">${icon(okAll ? 'i-ok' : 'i-warn')}${okAll ? 'Confere' : expl ? (c.hypotheses ? 'Inconsistência da planilha · confirmar causa' : 'Inconsistência da planilha · explicada') : isCons ? 'Inconsistência sem explicação' : 'Divergente'}</span>
    ${c.examples.length ? `<details><summary>${c.total - c.ok} ocorrência(s) — causas e exemplos</summary>${(c.causes || []).length ? `<ul>${c.causes.map(k => `<li><b>${nf(k.n)} × ${esc(k.cause)}</b>${k.text ? ` — ${esc(k.text)}` : ''}</li>`).join('')}</ul>` : ''}<ul>${c.examples.map(x => `<li><code>${esc(x.ref)}</code>${x.portal == null && x.planilha == null ? '' : `: ${isCons ? 'soma calculada' : 'portal'} ${exact(x.portal)} · valor na planilha ${exact(x.planilha)}${x.why ? ` · <span class="na">${esc(x.why)}</span>` : ' · <b>sem explicação</b>'}`}</li>`).join('')}</ul></details>` : ''}</div>` }).join('');
  const hero = `<section class="card hero"><div class="eyebrow">Conferências do robô · execução ${esc(D.robot?.id ?? '—')} · ${esc(D.robot?.status ?? '—')}</div><div class="big-check" style="margin-top:10px">${ring(ok, tot, 92).replace('var(--line)', 'rgba(255,255,255,.2)')}<div><b>${nf(ok)} / ${nf(tot)}</b><div class="hero-note">verificações automáticas gravadas em chk_conciliacao${D.robot?.message ? ` · ${esc(D.robot.message)}` : ''}</div></div></div>
    <div class="hero-stats"><div class="hero-stat"><span>Referência</span><b>${fShort(VAL.reference.d1)} → ${fShort(VAL.reference.d0)}</b><small>D-1 e D0</small></div><div class="hero-stat"><span>Dias no banco</span><b>${nf(st.blocks)}</b><small>fotos diárias do robô</small></div><div class="hero-stat"><span>Gerado em</span><b>${esc(VAL.generated.slice(0, 10).split('-').reverse().join('/'))}</b><small>${esc(VAL.generated.slice(11, 16))}</small></div></div></section>`;
  return `<div class="grid g-hero">${hero}${card('Origem dos dados', 'Banco dw_fup — gravado pelo robô diário e pelas tabelas manuais', `<dl class="kv"><dt>Banco</dt><dd>${esc(D.source)}</dd><dt>Robô</dt><dd>${D.robot ? `execução ${esc(D.robot.id)} · D0 ${fDate(D.robot.date)} · ${esc(D.robot.status)}` : '—'}</dd><dt>Concluído em</dt><dd>${D.sourceModified ? esc(new Date(D.sourceModified).toLocaleString('pt-BR')) : '—'}</dd><dt>Lido pelo portal em</dt><dd>${esc(D.extracted.replace('T', ' '))}</dd><dt>Dias</dt><dd>${fDate(D.days[0].date)} a ${fDate(D.days.at(-1).date)}</dd><dt>Meses (curva)</dt><dd>${D.monthly.length}</dd><dt>Datas de capacity</dt><dd>${D.capacity.dates.length}</dd><dt>Manuais</dt><dd>man_compromisso, man_hc_compromisso, man_meta_mensal, man_calendario, man_parametro</dd></dl>`)}</div>
    ${card('Conferências da última execução', 'Foto completa, realizado recontado, manuais preenchidos', list(core, false))}
`;
}

/* ------------------------------------------------------------------ drawer de detalhe */
function openDetail(e) {
  const d0 = day(S.di), d1 = realizedDay();
  $('#drawer-eyebrow').textContent = `${E[e].level === 'polo' ? 'Polo ' + E[e].code : E[e].level === 'regional' ? 'Regional' : 'Total'} · ${d1?.n > 1 ? realLabel(d1) : fDate(d1?.date)} → ${fDate(d0.date)}`;
  $('#drawer-title').textContent = entName(e);
  const rows = [...Array(7).keys()].map(t => `<tr><td><strong>${esc(T[t])}</strong></td><td>${hasDU(t) ? statusCell(nf(get(d0, 'du', e, t), 2), duStatus(get(d0, 'du', e, t), d0.target?.[t])) : '<span class="na">—</span>'}</td><td>${n1(get(d0, 'queue', e, t))}</td><td>${n1(get(d0, 'need', e, t))}</td><td>${n1(get(d0, 'commit', e, t))}</td><td>${n1(get(d1, 'need', e, t))}</td><td>${n1(get(d1, 'commit', e, t))}</td><td>${n1(get(d1, 'actual', e, t))}</td><td>${get(d1, 'pctCommit', e, t) == null ? '—' : statusCell(pct(get(d1, 'pctCommit', e, t), 0), pctStatus(get(d1, 'pctCommit', e, t)))}</td></tr>`).join('')
    + `<tr class="lvl-total"><td>Total</td><td>—</td><td>${n1(get(d0, 'queue', e, -1))}</td><td>${n1(get(d0, 'need', e, -1))}</td><td>${n1(get(d0, 'commit', e, -1))}</td><td>${n1(get(d1, 'need', e, -1))}</td><td>${n1(get(d1, 'commit', e, -1))}</td><td>${n1(get(d1, 'actual', e, -1))}</td><td>${statusCell(pct(get(d1, 'pctCommit', e, 7), 0), pctStatus(get(d1, 'pctCommit', e, 7)))}</td></tr>`;
  const ds = D.days.slice(Math.max(0, S.di - 29), S.di + 1);
  $('#drawer-body').innerHTML = `<div class="grid g-3" style="gap:12px;margin-bottom:16px">${miniStat('Realizado D-1', n1(get(d1, 'actual', e, -1)), badge(pctStatus(get(d1, 'pctCommit', e, 7))))}${miniStat('Necessidade D0', n1(get(d0, 'need', e, -1)), 'Todos os serviços')}${miniStat('Fila D0', n1(get(d0, 'queue', e, -1)), delta(get(d0, 'queue', e, -1), get(d1, 'queue', e, -1)))}</div>
    ${card('Por serviço', 'D0 = hoje · D-1 = ontem', `<div class="table-wrap"><table><thead><tr><th>Serviço</th><th>DU D0</th><th>Fila D0</th><th>Nec. D0</th><th>Comp. D0</th><th>Nec. D-1</th><th>Comp. D-1</th><th>Real. D-1</th><th>% Comp.</th></tr></thead><tbody>${rows}</tbody></table></div>`)}
    <div style="height:14px"></div>${card('Últimos 30 registros', 'Todos os serviços', lineChart({ labels: ds.map(d => d.date), series: [{ name: 'Necessidade', short: 'Nec.', color: 'var(--s-need)', values: ds.map(d => get(d, 'need', e, -1)) }, { name: 'Compromisso', short: 'Comp.', color: 'var(--s-comp)', values: ds.map(d => get(d, 'commit', e, -1)) }, { name: 'Realizado', short: 'Real.', color: 'var(--s-real)', values: ds.map(d => get(d, 'actual', e, -1)), area: true }], height: 230, width: 560, tipfmt: nf }))}`;
  bindCharts($('#drawer-body'));
  $('#drawer').classList.add('open'); $('#drawer').setAttribute('aria-hidden', 'false'); $('#drawer-close').focus();
}
function closeDetail() { $('#drawer').classList.remove('open'); $('#drawer').setAttribute('aria-hidden', 'true'); }

/* ------------------------------------------------------------------ render */
/* ------------------------------------------------------------------ VIEW: resumo (layout do RESUMO da planilha) */
// Esquerda = D-1 ("Até" do período), direita = D0 (dia seguinte), como RESUMO!B4 e J4.
const MESC = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const rsDate = iso => iso ? `${iso.slice(8, 10)}/${MESC[+iso.slice(5, 7) - 1]}` : '—';
const rsF = (v, d) => v == null || !isFinite(v) ? '' : v.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
const RS_NAME = e => E[e].level === 'polo' ? esc(entName(e)) : esc(entName(e).toUpperCase());
/** DU ÷ alvo: ≤ 1 verde · ≤ 1,25 amarelo · ≤ 1,5 laranja · > 1,5 roxo (mesmas faixas do portal + laranja). */
function rsDuCls(du, alvo) {
  if (du == null || !alvo) return 'rs-na';
  const r = du / alvo;
  return r <= 1 ? 'rs-g' : r <= 1.25 ? 'rs-y' : r <= 1.5 ? 'rs-o' : 'rs-p';
}
/** Percentuais: faixas da aba PALETA (100 / 90 / 80 %). */
const rsPctCls = p => p == null || !isFinite(p) ? 'rs-empty' : p >= 1 ? 'rs-g' : p >= .9 ? 'rs-y' : p >= .8 ? 'rs-o' : 'rs-p';
const rsRow = (e, cells) => `<tr class="rs-${lvl(e)}"><th>${RS_NAME(e)}</th>${cells}</tr>`;
const rsTypeHead = (label, n, extra = '') => `<tr class="rs-head"><th class="rs-key">${label}</th>${T.slice(0, n).map((t, i) => `<th class="${i % 2 ? 'rs-alt' : ''}">${esc(t)}</th>`).join('')}${extra}</tr>`;

function rsDu(d, prev, title) {
  const varCell = (e, t) => {
    const a = get(d, 'du', e, t), b = get(prev, 'du', e, t);
    if (!prev || a == null || b == null) return '<td class="rs-var"></td>';
    const dv = a - b, c = Math.abs(dv) < 1e-9 ? 'flat' : dv > 0 ? 'up' : 'down';
    return `<td class="rs-var"><i class="rs-dot ${c}" data-tip="${esc(`${T[t]} · ${entName(e)}<br>DU ${nf(b, 2)} → ${nf(a, 2)} (${dv > 0 ? '+' : ''}${nf(dv, 2)})`)}"></i></td>`;
  };
  const withVar = t => prev && t < 3;
  const cols = [...Array(6).keys()];
  const head = `<tr class="rs-bar"><th class="rs-date">${rsDate(d?.date)}</th><th colspan="${6 + (prev ? 3 : 0)}">DU CONTROLE</th></tr>
    <tr class="rs-alvo"><th></th>${cols.map(t => `<th${withVar(t) ? ' colspan="2"' : ''}>${rsF(d?.target?.[t], 1)}</th>`).join('')}</tr>
    <tr class="rs-head"><th class="rs-key">DU</th>${cols.map(t => `<th class="${t % 2 ? 'rs-alt' : ''}"${withVar(t) ? ' colspan="2"' : ''}>${esc(T[t])}</th>`).join('')}</tr>`;
  const body = [...Array(13).keys()].map(e => rsRow(e, cols.map(t => {
    const v = get(d, 'du', e, t);
    return `<td class="${rsDuCls(v, d?.target?.[t])}" data-tip="${esc(`${T[t]} · ${entName(e)}<br>DU ${exact(v)} · alvo ${nf(d?.target?.[t], 2)}`)}">${rsF(v, 2)}</td>${withVar(t) ? varCell(e, t) : ''}`;
  }).join(''))).join('');
  const foot = prev ? `<tr class="rs-varrow"><th></th>${cols.map(t => { const a = get(d, 'du', 12, t), b = get(prev, 'du', 12, t); const r = a != null && b ? a / b - 1 : null; return `<td${withVar(t) ? ' colspan="2"' : ''}>${r == null ? '' : (r > 0 ? '+' : '') + pct(r, 0)}</td>`; }).join('')}</tr>` : '';
  return `<table class="rs rs-du">${head}${body}${foot}</table>`;
}
function rsFila(d, prev) {
  const cols = [...Array(6).keys()], withVar = t => prev && t < 3;
  const head = `<tr class="rs-head"><th class="rs-key">Fila Total</th>${cols.map(t => `<th class="${t % 2 ? 'rs-alt' : ''}"${withVar(t) ? ' colspan="2"' : ''}>${esc(T[t])}</th>`).join('')}</tr>`;
  const body = [...Array(13).keys()].map(e => rsRow(e, cols.map(t => {
    const v = get(d, 'queue', e, t), b = get(prev, 'queue', e, t);
    const vc = withVar(t) ? (v == null || b == null ? '<td class="rs-var"></td>' : `<td class="rs-var"><i class="rs-dot ${v - b > 0 ? 'up' : v - b < 0 ? 'down' : 'flat'}" data-tip="${esc(`Fila ${n1(b)} → ${n1(v)} (${v - b > 0 ? '+' : ''}${nf(v - b)})`)}"></i></td>`) : '';
    return `<td class="${v === 0 ? 'rs-zero' : 'rs-fila'}" data-tip="${esc(`${T[t]} · ${entName(e)}<br>Fila ${exact(v)}`)}">${nf(v)}</td>${vc}`;
  }).join(''))).join('');
  // linha de variação do Desktop (RESUMO K20:S20)
  const foot = prev ? `<tr class="rs-varrow"><th></th>${cols.map(t => { const a = get(d, 'queue', 12, t), b = get(prev, 'queue', 12, t); const r = a != null && b ? a / b - 1 : null; return `<td${withVar(t) ? ' colspan="2"' : ''}>${r == null ? '' : (r > 0 ? '+' : '') + pct(r, 0)}</td>`; }).join('')}</tr>` : '';
  return `<table class="rs rs-fila-t">${head}${body}${foot}</table>`;
}
function rsTop(d) {
  const rows = [['NECESSIDADE', 'need'], ['COMPROMISSO', 'commit'], ['REAL', 'actual']];
  return `<table class="rs rs-top"><tr class="rs-head"><th class="rs-blank"></th>${T.map((t, i) => `<th class="${i % 2 ? 'rs-alt' : ''}">${esc(t)}</th>`).join('')}<th class="rs-total">TOTAL</th></tr>
    ${rows.map(([l, k]) => `<tr><th class="rs-toplabel">${l}</th>${[...Array(8).keys()].map(t => `<td data-tip="${esc(`${l} ${TT[t]} · Desktop · ${d?.fdsLabel || fDate(d?.date)}<br>${exact(get(d, k, 12, t))}`)}">${nf(get(d, k, 12, t))}</td>`).join('')}</tr>`).join('')}</table>`;
}
/** Consolidado do fim de semana (só com D0 na segunda): Σ sábado + domingo de necessidade, compromisso e real;
 *  % = Σ real ÷ Σ compromisso/necessidade; efetividade e entrantes pela soma das partes (nunca média de %).
 *  DU e Fila não entram (são estoque). Os dias individuais não mudam. */
function fdsPair() {
  const d0 = day(S.di), sun = day(S.di - 1), sat = day(S.di - 2);
  return d0 && dObj(d0.date).getDay() === 1 && sun && sat && dObj(sun.date).getDay() === 0 && dObj(sat.date).getDay() === 6 ? [sat, sun] : null;
}
function fdsDay() {
  const ds = fdsPair(); if (!ds) return null;
  const add = (a, b) => a == null && b == null ? null : (a || 0) + (b || 0);
  const sumM = key => ds[1][key].map((row, e) => row.map((_, t) => add(ds[0][key]?.[e]?.[t], ds[1][key]?.[e]?.[t])));
  const need = sumM('need'), commit = sumM('commit'), actual = sumM('actual');
  const div = (a, b) => a.map((row, e) => row.map((v, t) => ratio(v, b[e][t])));
  const efet = [...Array(13).keys()].map(e => {
    const p = ds.map(d => d.efetParts?.[e]); if (p.some(x => !x)) return [null, null, null];
    const s = j => add(p[0][j], p[1][j]), ef = ratio(s(0), s(1)), real = ratio(s(2), s(3));
    return [ef, real, ratio(real, ef)];
  });
  const entrCob = [...Array(13).keys()].map(e => [0, 1, 2].map(t => { const p = ds.map(d => d.entrParts?.[e]?.[t]); return p.some(x => !x) ? null : ratio(p[0][0] + p[1][0], p[0][1] + p[1][1]); }));
  return { ...ds[1], fdsLabel: `sáb+dom ${rsDate(ds[0].date)}–${rsDate(ds[1].date)}`, need, commit, actual, pctCommit: div(actual, commit), pctNeed: div(actual, need), efet, entrCob };
}
function rsPct(d, key, label, efet) {
  const bar = efet ? `<tr class="rs-bar"><th class="rs-date">${d?.fdsLabel ? esc(d.fdsLabel) : rsDate(d?.date)}</th><th colspan="8">% COMPROMISSO</th><th class="rs-sep"></th><th colspan="3">EFETIVIDADE</th></tr>
    <tr class="rs-alvo"><th></th><th colspan="8"></th><th class="rs-sep"></th><th colspan="3"></th></tr>` : '';
  const head = bar + rsTypeHead(label, 7, `<th class="rs-total">TOTAL</th>${efet ? '<th class="rs-sep"></th><th class="rs-alt">EFETIV</th><th>REAL</th><th class="rs-alt">COBERT</th>' : ''}`);
  const body = [...Array(13).keys()].map(e => rsRow(e, [...Array(8).keys()].map(t => {
    const v = get(d, key, e, t);
    return `<td class="${rsPctCls(v)}" data-tip="${esc(`${label} ${TT[t]} · ${entName(e)}<br>${pct(v)}`)}">${v == null ? '' : pct(v, 0)}</td>`;
  }).join('') + (efet ? '<td class="rs-sep"></td>' + [0, 1, 2].map(j => { const v = d?.efet?.[e]?.[j]; return `<td class="${j === 2 ? 'rs-cob' : 'rs-ef'}" data-tip="${esc([`Efetividade comprometida (compromisso inst. ÷ entrante médio inst.; média ${d?.efetSrc === 'planilha' ? 'colada na planilha, coluna Inst do Compromissos D0' : 'calculada: vendas dos 4 mesmos dias da semana'})`, 'Efetividade real (realizado inst. ÷ vendas do dia)', 'Cobertura = real ÷ comprometida'][j])}">${v == null ? '—' : pct(v, 0)}</td>`; }).join('') : ''))).join('');
  return `<table class="rs rs-pct">${head}${body}</table>`;
}
function rsEntr(d) {
  const head = `<tr class="rs-head"><th class="rs-key rs-italic">ENTRANTES D-1</th>${T.slice(0, 3).map((t, i) => `<th class="${i % 2 ? 'rs-alt' : ''}">${esc(t)}</th>`).join('')}</tr>`;
  const body = [...Array(13).keys()].map(e => rsRow(e, [0, 1, 2].map(t => {
    const v = d?.entrCob?.[e]?.[t];
    return `<td class="${v == null ? 'rs-empty' : v >= 1 ? 'rs-entr-up' : 'rs-entr-dn'}" data-tip="${esc('Entrante do dia ÷ média dos 4 mesmos dias da semana anteriores (base atual)')}">${v == null ? '—' : pct(v, 0)}</td>`;
  }).join(''))).join('');
  return `<table class="rs rs-entr">${head}${body}</table>`;
}
function rsCap(d0date, mode) {
  const d1 = mode === 'D-1';
  const cols = d1 ? [['mopPlan', 'motPlan', 'PLANEJADO'], ['mopConf', 'motConf', 'CONF. COP'], ['mopActual', 'motActual', 'REAL']] : [['mopPlan', 'motPlan', 'PLANEJADO'], ['mopConf', 'motConf', 'CONF. COP']];
  const num = d1 ? ['mopActual', 'motActual'] : ['mopConf', 'motConf'];
  const head = `<tr class="rs-bar"><th class="rs-blank"></th><th colspan="${cols.length * 2 + (d1 ? 0 : 2)}">CAPACITY ${mode}</th><th colspan="3" class="rs-italic">${d1 ? 'Planejado X Real' : 'Planejado X Confirmado'}</th></tr>
    <tr class="rs-capgrp"><th class="rs-blank"></th>${cols.map(c => `<th colspan="2">${c[2]}</th>`).join('')}${d1 ? '' : '<th colspan="2"></th>'}<th rowspan="2">COBERT<br>PROPRIO</th><th rowspan="2">COBERT<br>TERCEIRA</th><th rowspan="2">COBERT<br>TOTAL</th></tr>
    <tr class="rs-head"><th class="rs-key rs-italic">CAPACITY</th>${cols.map(() => '<th>HC PROPRIO</th><th>HC TERCEIRO</th>').join('')}${d1 ? '' : '<th></th><th></th>'}</tr>`;
  const body = [...Array(13).keys()].map(e => {
    const c = d1 ? capD1(d0date, e) : capAt(d0date, e);
    // como na planilha: sem confirmado/real lançado, a cobertura sai 0%
    const cob = [ratio(c?.[num[0]] ?? (c?.mopPlan ? 0 : null), c?.mopPlan), ratio(c?.[num[1]] ?? (c?.motPlan ? 0 : null), c?.motPlan), c ? ratio((c[num[0]] || 0) + (c[num[1]] || 0), (c.mopPlan || 0) + (c.motPlan || 0)) : null];
    return rsRow(e, cols.map(k => `<td>${nf(c?.[k[0]])}</td><td>${nf(c?.[k[1]])}</td>`).join('') + (d1 ? '' : '<td></td><td></td>')
      + cob.map(v => `<td class="${rsPctCls(v)}" data-tip="${esc(d1 ? 'HC real ÷ HC planejado' : 'HC confirmado ÷ HC planejado')}">${v == null ? '' : pct(v, 0)}</td>`).join(''));
  }).join('');
  return `<table class="rs rs-cap">${head}${body}</table>`;
}
/** Imagem do Resumo. html2canvas (dist/vendor) é carregado junto com a página, para o botão não depender
 *  do servidor continuar no ar depois que a página abriu. mode: 'download' | 'copy'. */
async function rsImage(mode) {
  const st = $('#rs-status'), d0 = day(S.di), d1 = day(S.di - 1);
  st.textContent = 'Gerando imagem…';
  try {
    if (!window.html2canvas) throw Error('o gerador de imagem não carregou. Abra o portal pelo “Iniciar Portal.cmd”, mantenha a janela do servidor aberta e recarregue a página (Ctrl+F5)');
    const box = document.createElement('div');
    box.className = 'rs-shot';
    const agora = new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
    const fds = S.fds && fdsPair();
    box.innerHTML = `<div class="rs-shot-head"><b>FUP · Resumo de produção</b><span>${esc(scopeLabel())} · Realizado ${fds ? `fim de semana ${fDate(fds[0].date)} + ${fDate(fds[1].date)}` : fDate(d1?.date)} · D0 ${fDate(d0?.date)}</span><small>Gerado em ${esc(agora)} · fonte: banco dw_fup</small></div>`;
    box.appendChild(document.querySelector('.rs-sheet').cloneNode(true));
    const lg = document.querySelector('.rs-legend').cloneNode(true); lg.lastElementChild?.remove(); box.appendChild(lg);
    document.body.appendChild(box);
    let canvas;
    try { canvas = await window.html2canvas(box, { scale: 2, backgroundColor: '#ffffff', logging: false }); } finally { box.remove(); }
    const blob = await new Promise(ok => canvas.toBlob(ok, 'image/png'));
    const name = `resumo-fup-${d1?.date || 'dia'}.png`;
    if (mode === 'copy') {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      st.textContent = 'Imagem copiada: cole no WhatsApp, Teams ou e-mail (Ctrl+V).';
    } else {
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      st.textContent = `Imagem salva: ${name}`;
    }
  } catch (e) {
    st.textContent = mode === 'copy' && !window.isSecureContext ? 'Copiar exige o portal aberto pelo “Iniciar Portal.cmd” (http://127.0.0.1:8765). Use “Baixar imagem”.' : `Não foi possível gerar a imagem: ${e.message || e}`;
  }
}
function vResumo() {
  S.export = null;
  const d0 = day(S.di), d1 = day(S.di - 1), pair = fdsPair(), fds = pair && S.fds ? fdsDay() : null, p1 = fds || d1;
  const multi = '';
  const fdsBtn = pair ? `<button class="btn${fds ? ' primary' : ''}" id="rs-fds" type="button" aria-pressed="${!!fds}" data-tip="${esc('Produção de sábado + domingo somada (Nec., Comp., Real, %, Efetividade, Entrantes). DU e Fila seguem o dia. Clique de novo para voltar ao dia.')}">${fds ? `Fim de semana ${fShort(pair[0].date)}–${fShort(pair[1].date)}` : 'Ver fim de semana (sáb + dom)'}</button>` : '';
  const fdsNote = fds ? `<div class="card" style="padding:10px 16px;margin-bottom:14px;font-size:13px"><b>Consolidado do fim de semana</b> (${fShort(pair[0].date)} + ${fShort(pair[1].date)}): Necessidade, Compromisso, Real, % Comp., % Necess., Efetividade e Entrantes somam os dois dias (% = Σ real ÷ Σ base). DU e Fila continuam de ${fShort(d1?.date)}. Para o detalhe de cada dia, desligue o botão ou escolha o dia no topo.</div>` : '';
  const legend = `<div class="rs-legend"><span><i class="rs-g"></i>DU ≤ alvo · % ≥ 100%</span><span><i class="rs-y"></i>DU até 1,25× · % ≥ 90%</span><span><i class="rs-o"></i>DU até 1,5× · % ≥ 80%</span><span><i class="rs-p"></i>DU &gt; 1,5× · % &lt; 80%</span><span><i class="rs-dot up"></i>subiu vs D-1</span><span><i class="rs-dot down"></i>caiu</span><span>Passe o mouse para o valor exato</span></div>`;
  const actions = `<div class="rs-actions"><button class="btn primary" id="rs-png" type="button">${icon('i-download')}Baixar imagem</button><button class="btn" id="rs-copy" type="button">${icon('i-print')}Copiar imagem</button>${fdsBtn}<span class="na" id="rs-status">PNG com todos os quadros do Resumo (${fds ? `fim de semana ${fShort(pair[0].date)}–${fShort(pair[1].date)}` : fShort(d1?.date)} → ${fShort(d0?.date)})</span></div>`;
  return `${multi}${fdsNote}${actions}<div class="rs-wrap"><div class="rs-sheet">
    <div class="rs-grid">
      <div></div><div></div>${rsTop(p1)}
      ${rsDu(d1, null)}${rsDu(d0, d1)}${rsPct(p1, 'pctCommit', '% Comp.', true)}
      ${rsFila(d1, null)}${rsFila(d0, d1)}<div class="rs-pair">${rsPct(p1, 'pctNeed', '% Necess.', false)}${rsEntr(p1)}</div>
    </div>
    <div class="rs-row rs-row-cap">${rsCap(d0.date, 'D-1')}${rsCap(d0.date, 'D-0')}</div>
  </div></div>${legend}`;
}

/* ------------------------------------------------------------------ VIEW: mapa (cidades atendidas · tempo · situação) */
// Situação = estoque ÷ estoque máximo = Σ fila ÷ Σ (média DU × alvo) dos serviços filtrados (mesmas faixas do Resumo).
const MAP_SIT = [['normal', 'Normal', 'r ≤ 1'], ['atencao', 'Atenção', '≤ 1,25'], ['alerta', 'Alerta', '≤ 1,5'], ['critico', 'Crítico', '> 1,5']];
const WX_DAY = ['Hoje', 'Amanhã', 'Depois'];
function citySit(m, t, alvo) {
  if (!m.op || t === 6) return { k: 'none', l: t === 6 ? 'Retiradas não têm DU' : 'Sem dado', r: null, exc: 0 };
  let fila = 0, cap = 0;
  (t >= 0 ? [t] : [0, 1, 2, 3, 4, 5]).forEach(x => { const [f, mdu] = m.op[x]; fila += f || 0; if (mdu && alvo?.[x]) cap += mdu * alvo[x]; });
  if (!cap) return { k: fila ? 'critico' : 'none', l: fila ? 'Fila sem produção recente' : 'Sem fila', r: null, exc: fila };
  const r = fila / cap, k = r <= 1 ? 'normal' : r <= 1.25 ? 'atencao' : r <= 1.5 ? 'alerta' : 'critico';
  return { k, l: MAP_SIT.find(s => s[0] === k)[1], r, exc: fila - cap };  // exc = ordens acima do estoque máximo
}
/** Risco do tempo no dia (código WMO e chuva em mm). */
function wxRisk(w) {
  if (!w) return { k: 'none', l: 'Sem previsão', ic: 'cloud', peso: 0 };
  const [, cod, tmax, , chuva, prob] = w;
  // o código diário da Open-Meteo é o pior momento do dia: trovoada só vira "tempestade" com volume ou probabilidade relevante
  if (cod >= 95 && ((chuva ?? 0) >= 10 || (prob ?? 0) >= 70)) return { k: 'tempestade', l: 'Tempestade', ic: 'storm', peso: 3 };
  if (cod >= 95) return { k: 'chuva', l: 'Pancadas c/ trovoada', ic: 'rain', peso: 1 };
  if ((chuva ?? 0) >= 20 || cod === 65 || cod === 82) return { k: 'forte', l: 'Chuva forte', ic: 'rain', peso: 2 };
  if ((chuva ?? 0) >= 5 || (cod >= 61 && cod <= 67) || (cod >= 80 && cod <= 82)) return { k: 'chuva', l: 'Chuva', ic: 'rain', peso: 1 };
  if ((tmax ?? 0) >= 34) return { k: 'calor', l: 'Calor', ic: 'sun', peso: 1 };
  return cod <= 1 ? { k: 'ok', l: 'Céu limpo', ic: 'sun', peso: 0 } : cod <= 3 || cod === 45 || cod === 48 ? { k: 'ok', l: 'Nublado', ic: 'cloud', peso: 0 } : { k: 'ok', l: 'Garoa', ic: 'drizzle', peso: 0 };
}
/** Desenhos dos ícones de tempo (embutidos: o gerador de imagem não resolve <use> entre SVGs diferentes). */
const WX_SVG = {
  sun: `<g stroke="#f59e0b" stroke-width="2" stroke-linecap="round"><path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3M4.6 4.6l2.1 2.1M17.3 17.3l2.1 2.1M4.6 19.4l2.1-2.1M17.3 6.7l2.1-2.1"/></g><circle cx="12" cy="12" r="5" fill="#fbbf24" stroke="#f59e0b"/>`,
  cloud: `<path d="M7 18h10.5a4 4 0 00.4-8 6 6 0 00-11.4 1.5A3.3 3.3 0 007 18z" fill="#f1f5f9" stroke="#64748b" stroke-width="1.4"/>`,
  drizzle: `<path d="M7 15h10.5a4 4 0 00.4-8 6 6 0 00-11.4 1.5A3.3 3.3 0 007 15z" fill="#e2e8f0" stroke="#64748b" stroke-width="1.4"/><path d="M9 18l-.6 2M14 18l-.6 2" stroke="#60a5fa" stroke-width="1.6" stroke-linecap="round"/>`,
  rain: `<path d="M7 14h10.5a4 4 0 00.4-8 6 6 0 00-11.4 1.5A3.3 3.3 0 007 14z" fill="#cbd5e1" stroke="#475569" stroke-width="1.4"/><path d="M8 16.5l-1.2 3.5M12 16.5l-1.2 3.5M16 16.5l-1.2 3.5" stroke="#2563eb" stroke-width="2" stroke-linecap="round"/>`,
  storm: `<path d="M7 13h10.5a4 4 0 00.4-8 6 6 0 00-11.4 1.5A3.3 3.3 0 007 13z" fill="#64748b" stroke="#334155" stroke-width="1.4"/><path d="M12.5 13l-3 5h3l-1.5 5 5-7h-3l1.5-3z" fill="#facc15" stroke="#a16207" stroke-width=".8" stroke-linejoin="round"/>`
};
const WX_SYMBOLS = `<defs>${Object.entries(WX_SVG).map(([k, v]) => `<symbol id="w-${k}" viewBox="0 0 24 24">${v}</symbol>`).join('')}</defs>`;
const wxIcon = (ic, size = 22) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true">${WX_SVG[ic] || WX_SVG.cloud}</svg>`;
function mapScope() {
  const reg = S.reg === 12 ? '' : E[S.reg].code;
  return D.mapa.municipios.filter(m => m.atua && m.ger && m.ger.startsWith(reg));
}
function vMapa() {
  S.export = null;
  const M = D.mapa;
  if (!M) return card('Mapa', '', '<div class="empty">Sem municípios no banco (dim_municipio). Rode dw_fup/carregar_municipios.py.</div>');
  const di = Math.min(+S.mday || 0, M.dias.length - 1), dia = M.dias[di];
  const alvo = day(S.di)?.target, t = S.type;
  const all = mapScope().map(m => ({ ...m, sit: citySit(m, t, alvo), wx: wxRisk(m.tempo?.[di]) }));
  const pass = m => (S.msit === 'all' || m.sit.k === S.msit) && (S.mrisk === 'all' || (S.mrisk === 'risco' ? m.wx.peso >= 2 : m.wx.k === S.mrisk));
  const vis = all.filter(pass);
  // enquadramento: caixa das cidades do escopo
  const xs = all.map(m => m.x), ys = all.map(m => m.y), pad = 26;
  const vx = Math.min(...xs) - pad, vy = Math.min(...ys) - pad, vw = Math.max(80, Math.max(...xs) - Math.min(...xs) + 2 * pad), vh = Math.max(60, Math.max(...ys) - Math.min(...ys) + 2 * pad);
  const ics = Math.max(vw, vh) / 42;
  const inScope = new Set(all.map(m => m.ibge)), visSet = new Set(vis.map(m => m.ibge)), sitOf = Object.fromEntries(all.map(m => [m.ibge, m]));
  const tipOf = m => `<b>${esc(m.nome)}</b> · ${esc(m.ger)}<br>Situação: ${esc(m.sit.l)}${m.sit.r != null ? ` (${nf(m.sit.r, 2)}× o estoque máximo)` : ''}<br>${esc(dia ? fShort(dia) : '')} · ${esc(m.wx.l)}${m.tempo?.[di] ? ` · ${nf(m.tempo[di][4], 1)} mm (${m.tempo[di][5] ?? '—'}%) · ${nf(m.tempo[di][3], 0)}–${nf(m.tempo[di][2], 0)} °C` : ''}`;
  const paths = M.municipios.map(m => {
    const c = sitOf[m.ibge];
    if (!c) return `<path class="mp-bg${m.atua ? ' mp-out' : ''}" d="${m.d}"/>`;
    return `<path class="mp-city sit-${c.sit.k}${visSet.has(m.ibge) ? '' : ' dim'}${S.mcity === m.ibge ? ' sel' : ''}" d="${m.d}" data-ib="${m.ibge}" data-tip="${esc(tipOf(c))}"/>`;
  }).join('');
  const icons = vis.filter(m => S.micons !== 'off' && (S.micons === 'all' || m.wx.peso >= 1)).map(m => `<use href="#w-${m.wx.ic}" x="${m.x - ics / 2}" y="${m.y - ics / 2}" width="${ics}" height="${ics}" class="mp-ic" data-ib="${m.ibge}" data-tip="${esc(tipOf(m))}"/>`).join('');
  const svg = `<svg class="mp-svg" viewBox="${vx} ${vy} ${vw} ${vh}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Mapa das cidades atendidas">${WX_SYMBOLS}${paths}${icons}</svg>`;

  // indicadores
  const cnt = k => all.filter(m => m.sit.k === k).length;
  const ruins = all.filter(m => m.wx.peso >= 2), combo = all.filter(m => m.wx.peso >= 2 && (m.sit.k === 'alerta' || m.sit.k === 'critico'));
  const dayName = i => `${WX_DAY[i] || ''} ${fShort(M.dias[i])}`;
  const kpis = `<div class="grid g-4">
    ${kpi('Cidades atendidas', nf(all.length), `${esc(scopeLabel())} · ${new Set(all.map(m => m.ger)).size} polos`)}
    ${kpi('Em alerta ou crítico', nf(cnt('alerta') + cnt('critico')), `${nf(cnt('critico'))} crítico · ${nf(cnt('alerta'))} alerta · +${nf(all.reduce((a, m) => a + Math.max(0, m.sit.exc || 0), 0))} ordens acima do máximo`, '', 'Fila acima de 1,25× o estoque máximo da cidade (média DU × alvo)')}
    ${kpi(`Tempo ruim · ${dayName(di)}`, nf(ruins.length), `${nf(all.filter(m => m.wx.k === 'tempestade').length)} tempestade · ${nf(all.filter(m => m.wx.k === 'forte').length)} chuva forte`, '', 'Tempestade (trovoada com ≥ 10 mm ou probabilidade ≥ 70%) ou chuva ≥ 20 mm')}
    ${kpi('Risco combinado', nf(combo.length), combo.length ? `Tempo ruim + fila alta · +${nf(combo.reduce((a, m) => a + Math.max(0, m.sit.exc || 0), 0))} ordens acima do máximo` : 'Nenhuma cidade com tempo ruim e fila alta')}
  </div>`;

  // painel lateral: cidade selecionada ou prioridade do dia
  let side;
  const sel = S.mcity && all.find(m => m.ibge === S.mcity);
  if (sel) {
    const w = sel.tempo || [];
    const op = sel.op || [];
    side = `<div class="mp-side-head"><button class="btn" id="mp-back" type="button">← Prioridades</button><span class="sit-pill sit-${sel.sit.k}">${esc(sel.sit.l)}${sel.sit.r != null ? ` · ${nf(sel.sit.r, 2)}× · +${nf(Math.max(0, sel.sit.exc))} ordens` : ''}</span></div>
      <h3 class="mp-city-name">${esc(sel.nome)}</h3><div class="sub">${esc(sel.ger)} · ${esc(E.find(x => x.code === sel.ger)?.name || '')} · IBGE ${sel.ibge}</div>
      <div class="mp-fc">${w.map((x, i) => { const r = wxRisk(x); return `<div class="mp-fc-day risk-${r.k}${i === di ? ' on' : ''}"><small>${dayName(i)}</small>${wxIcon(r.ic, 34)}<b>${nf(x[2], 0)}° <span class="na">${nf(x[3], 0)}°</span></b><span>${esc(r.l)}</span><span>${nf(x[4], 1)} mm · ${x[5] ?? '—'}%</span><span class="na">vento ${nf(x[6], 0)} km/h</span></div>`; }).join('') || '<div class="empty">Sem previsão</div>'}</div>
      <div class="table-wrap"><table class="mp-tab"><thead><tr><th>Serviço</th><th>Fila</th><th>Méd. DU</th><th>DU</th><th>Real. D-1</th><th>Entr. D-1</th><th>Entr. méd.</th></tr></thead><tbody>
      ${T.map((nm, x) => { const [f, mdu, real, en, em] = op[x] || []; const du = mdu ? f / mdu : null; return `<tr><td>${esc(nm)}</td><td>${nf(f)}</td><td>${nf(mdu, 1)}</td><td>${x < 6 && du != null ? `<span class="cell ${rsDuCls(du, alvo?.[x])}">${nf(du, 2)}</span>` : '—'}</td><td>${nf(real)}</td><td>${nf(en, 1)}</td><td>${nf(em, 1)}</td></tr>`; }).join('')}
      </tbody></table></div><div class="table-foot"><span>Foto de ${fDate(M.d0)} · previsão Open-Meteo de ${fDate(M.tempoRef)}</span></div>`;
  } else {
    // prioridade: tempo ruim primeiro; dentro dele, mais ordens acima do estoque máximo (impacto, não só a razão)
    const rank = vis.slice().sort((a, b) => (Math.min(b.wx.peso, 2) - Math.min(a.wx.peso, 2)) || ((b.sit.exc ?? 0) - (a.sit.exc ?? 0))).slice(0, 14);
    side = `<div class="mp-side-head"><h3>Prioridade · ${esc(dayName(di))}</h3><span class="na">${nf(vis.length)} de ${nf(all.length)} cidades no filtro</span></div>
      <div class="mp-rank">${rank.map(m => `<button class="mp-row" data-ib="${m.ibge}" type="button">${wxIcon(m.wx.ic, 26)}<span class="mp-row-name"><b>${esc(m.nome)}</b><small>${esc(m.ger)} · ${esc(m.wx.l)}${m.tempo?.[di] ? ` · ${nf(m.tempo[di][4], 1)} mm` : ''}</small></span><span class="sit-pill sit-${m.sit.k}" data-tip="${esc(m.sit.r != null ? `Fila ${nf(m.sit.r, 2)}× o estoque máximo` : m.sit.l)}">${esc(m.sit.l)}${m.sit.exc > 0.5 ? ` · +${nf(m.sit.exc)}` : ''}</span></button>`).join('') || '<div class="empty">Nenhuma cidade neste filtro.</div>'}</div>
      <div class="table-foot"><span>Ordem: tempo ruim primeiro e, depois, mais ordens acima do estoque máximo (+N). Clique para detalhar.</span></div>`;
  }
  const filters = `<div class="mp-filters">
    ${tabs('mday', M.dias.map((d, i) => [i, `${WX_DAY[i] || ''} ${fShort(d)}`]), String(di))}
    ${tabs('msit', [['all', 'Todas'], ...MAP_SIT.map(s => [s[0], s[1]])], S.msit)}
    ${tabs('mrisk', [['all', 'Qualquer tempo'], ['risco', 'Tempo ruim'], ['tempestade', 'Tempestade'], ['chuva', 'Chuva'], ['calor', 'Calor']], S.mrisk)}
    ${tabs('micons', [['risk', 'Ícones: risco'], ['all', 'Todos'], ['off', 'Ocultar']], S.micons)}
  </div>`;
  const legend = `<div class="mp-legend">${MAP_SIT.map(s => `<span><i class="sit-${s[0]}"></i>${s[1]} <small>${s[2]}</small></span>`).join('')}<span><i class="sit-none"></i>Sem dado</span><span class="mp-legend-sep"></span>${['sun', 'cloud', 'drizzle', 'rain', 'storm'].map((ic, i) => `<span>${wxIcon(ic, 18)}${['Sol', 'Nublado', 'Garoa', 'Chuva', 'Tempestade'][i]}</span>`).join('')}</div>`;
  const actions = `<div class="rs-actions"><button class="btn primary" id="mp-png" type="button">${icon('i-download')}Baixar imagem</button><button class="btn" id="mp-copy" type="button">${icon('i-print')}Copiar imagem</button><span class="na" id="mp-status">${esc(scopeLabel())} · ${esc(typeLabel(t))} · situação de ${fDate(M.d0)} · tempo de ${esc(dayName(di))}</span></div>`;
  return `${actions}<div class="mp-shot">${kpis}<div class="mp-grid"><section class="card mp-map"><div class="card-head"><div><h2>Cidades atendidas · ${esc(scopeLabel())}</h2><div class="sub">Cor = situação da fila (${esc(typeLabel(t))}) · ícone = previsão de ${esc(dayName(di))}</div></div></div>${filters}${svg}${legend}</section><section class="card mp-side">${side}</section></div></div>`;
}
/** Imagem de uma área da tela (mesmo gerador local do Resumo). */
async function shotImage(sel, titulo, nome, mode, st) {
  st.textContent = 'Gerando imagem…';
  try {
    if (!window.html2canvas) throw Error('o gerador de imagem não carregou. Recarregue a página (Ctrl+F5) com o portal aberto pelo “Iniciar Portal.cmd”');
    const box = document.createElement('div');
    box.className = 'rs-shot mp-shot-box';
    box.innerHTML = `<div class="rs-shot-head"><b>FUP · ${esc(titulo)}</b><span>${esc(st.dataset.label || '')}</span><small>Gerado em ${esc(new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }))} · fonte: banco dw_fup · tempo: Open-Meteo</small></div>`;
    const node = document.querySelector(sel).cloneNode(true); node.style.width = document.querySelector(sel).offsetWidth + 'px';
    box.appendChild(node); document.body.appendChild(box);
    let canvas; try { canvas = await window.html2canvas(box, { scale: 2, backgroundColor: '#ffffff', logging: false }); } finally { box.remove(); }
    const blob = await new Promise(ok => canvas.toBlob(ok, 'image/png'));
    if (mode === 'copy') { await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]); st.textContent = 'Imagem copiada: cole no WhatsApp, Teams ou e-mail (Ctrl+V).'; }
    else { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nome; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); st.textContent = `Imagem salva: ${nome}`; }
  } catch (e) { st.textContent = `Não foi possível gerar a imagem: ${e.message || e}`; }
}

/* ------------------------------------------------------------------ VIEW: entrantes (aba ENTRANTE da planilha) */
// MÉDIA = média do mesmo dia da semana nas 4 semanas anteriores (feriado da lista -> dia seguinte, como a planilha); REAL = entrante congelado do dia
// (aba ENTRANTE onde a planilha cobre, senão a foto da manhã seguinte); COBERT = real ÷ média. Na segunda, D-1 = sáb + dom
// (sem as colunas separadas de sábado e domingo da planilha).
const EN_TIPOS = [[1, 'ATIVAÇÕES'], [0, 'REPAROS'], [2, 'MUD END'], [3, 'PREVENTIVAS'], [4, 'OUTROS'], [5, 'CHIP'], [6, 'RETIRADAS']];
const EN_ORDEM = [12, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const enSem = () => S.enSem || 4;  // semanas da média: 4 (igual à planilha) ou 8
const enDias = () => 63;  // histórico na tela: 9 semanas (~2 meses) — cabe o último dia e os 8 mesmos dias da semana anteriores
const EN_IDX = Object.fromEntries((D.entrante?.dates || []).map((d, i) => [d, i]));
const enAdd = (iso, n) => { const z = dObj(iso); z.setDate(z.getDate() + n); return z.toISOString().slice(0, 10); };
const enReal = (iso, e, t) => D.entrante?.values?.[EN_IDX[iso]]?.[e]?.[t] ?? null;
function enMed(iso, e, t) {
  const fer = D.entrante?.feriados || [];
  const n = enSem(), vs = [...Array(n).keys()].map(k => { const x = enAdd(iso, -7 * (k + 1)); return enReal(fer.includes(x) ? enAdd(x, 1) : x, e, t); });
  return vs.includes(null) ? null : vs.reduce((a, b) => a + b, 0) / n;
}
/** Faixas da formatação condicional da aba: regionais/polos (alto = bom) e linha DESKTOP (alto = alerta). */
function enCls(v, e) {
  if (v == null || !isFinite(v)) return 'en-na';
  return v > 1 ? 'en-c1' : v >= 0.9 ? 'en-c2' : v >= 0.8 ? 'en-c3' : v >= 0.7 ? 'en-c4' : 'en-c5';
}
/** Fixa as colunas do resumo (nome, MÉDIA D0, MÉDIA/REAL/COBERT D-1): só o histórico diário rola para o lado.
 *  As posições saem do próprio cabeçalho já desenhado (sem depender de larguras fixas). */
function enFix() {
  $$('#view table.en').forEach(tb => {
    const head = tb.rows[0]; if (!head) return;
    const n = [...head.cells].findIndex(c => c.classList.contains('en-dia')); if (n <= 0) return;
    // posição na tela (offsetLeft muda de referência quando a célula já é sticky); mede com a tabela sem rolagem
    const wrap = tb.parentElement, sl = wrap.scrollLeft; wrap.scrollLeft = 0;
    const x0 = head.cells[0].getBoundingClientRect().left, left = [...head.cells].slice(0, n).map(c => c.getBoundingClientRect().left - x0);
    wrap.scrollLeft = sl;
    [...tb.rows].forEach(r => [...r.cells].slice(0, n).forEach((c, i) => { c.classList.add('en-fx'); c.style.left = `${left[i]}px`; c.classList.toggle('en-fx-last', i === n - 1); }));
  });
}
/** Marca o dia clicado e os 4 mesmos dias da semana anteriores (feriado da lista -> dia seguinte, como na média). */
function enMark(sel) {
  const fer = D.entrante?.feriados || [];
  // marca sempre os 8 anteriores: os da média escolhida (4 ou 8) em azul forte, o restante até 8 em azul claro
  const todos = sel ? [...Array(8).keys()].map(k => { const x = enAdd(sel, -7 * (k + 1)); return fer.includes(x) ? enAdd(x, 1) : x; }) : [];
  const refs = todos.slice(0, enSem()), extra = todos.slice(enSem());
  $$('#view [data-d]').forEach(el => { const d = el.dataset.d; el.classList.toggle('en-sel', d === sel); el.classList.toggle('en-ref', refs.includes(d)); el.classList.toggle('en-ref2', extra.includes(d)); });
  const st = $('#en-sel'); if (!st) return;
  st.innerHTML = sel ? `<i class="en-k sel"></i><b>${fLong(sel)}</b> <i class="en-k ref"></i>os ${enSem()} da média: <b>${refs.map(fShort).join(' · ')}</b>${extra.length ? ` <i class="en-k ref2"></i>até 8 semanas: <b>${extra.map(fShort).join(' · ')}</b>` : ''} <button type="button" class="btn" data-en-limpa>Limpar</button>`
    : `Clique em um dia (no cabeçalho ou no número) para marcar ele e os 8 mesmos dias da semana anteriores (em azul forte, os que entram na média de ${enSem()} semanas).`;
  st.querySelector('[data-en-limpa]')?.addEventListener('click', () => { S.enSel = null; enMark(null); });
}
function vEntrantes() {
  const d0 = day(S.di).date, d1 = enAdd(d0, -1), seg = dObj(d0).getDay() === 1;
  const sab = enAdd(d0, -2), dom = d1;
  const blocos = [['D-1', seg ? [sab, dom] : [d1]]];  // na segunda, D-1 = sábado + domingo somados
  const nh = enDias(), hist = [...Array(nh).keys()].map(k => enAdd(d1, k - nh + 1));
  const ents = EN_ORDEM.filter(e => scope(S.reg).includes(e));
  const tipos = EN_TIPOS.filter(([t]) => S.type < 0 || S.type === t);
  const soma = (vs) => vs.includes(null) ? null : vs.reduce((a, b) => a + b, 0);
  const rows = [];
  const tabela = ([t, nome]) => {
    const head = `<tr class="rs-head"><th class="rs-key">${nome}</th><th>MÉDIA D0</th><th class="rs-sep"></th>${blocos.map(([b]) => `<th class="rs-alt">MÉDIA ${b}</th><th>REAL ${b}</th><th class="rs-alt">COBERT</th><th class="rs-sep"></th>`).join('')}${hist.map(x => `<th class="en-dia" data-d="${x}" data-tip="Clique para marcar este dia e os 8 mesmos dias da semana anteriores">${WD[dObj(x).getDay()].toUpperCase()}<br><small>${fShort(x)}</small></th>`).join('')}</tr>`;
    const body = ents.map(e => {
      const med0 = enMed(d0, e, t);
      const rec = { servico: nome, entidade: entName(e), media_d0: med0 };
      const cel = blocos.map(([b, ds]) => {
        const med = soma(ds.map(x => enMed(x, e, t))), real = soma(ds.map(x => enReal(x, e, t))), cob = ratio(real, med);
        Object.assign(rec, { [`media_${b}`]: med, [`real_${b}`]: real, [`cobert_${b}`]: cob });
        return `<td>${nf(med)}</td><td>${nf(real)}</td><td class="${enCls(cob, e)}" data-tip="${esc(`${nome} · ${entName(e)} · ${b}<br>real ${exact(real)} ÷ média ${exact(med)}`)}">${cob == null ? '-' : pct(cob, 0)}</td><td class="rs-sep"></td>`;
      }).join('');
      rows.push(rec);
      return rsRow(e, `<td>${nf(med0)}</td><td class="rs-sep"></td>${cel}${hist.map(x => `<td class="en-hist" data-d="${x}">${nf(enReal(x, e, t), 0)}</td>`).join('')}`);
    }).join('');
    return `<div class="rs-wrap en-wrap"><table class="rs en">${head}${body}</table></div>`;
  };
  const html = tipos.map(tabela).join('');
  S.export = { name: `entrantes-${d0}`, rows };
  const nota = `<div class="card" style="padding:10px 16px;margin-bottom:14px;font-size:13px">Mesmo layout da aba <b>ENTRANTE</b> da planilha. <b>MÉDIA</b> = média do mesmo dia da semana nas <b>${enSem()} semanas</b> anteriores${enSem() === 4 ? ' (igual à planilha)' : ' (a planilha usa 4)'}; <b>REAL</b> = entrante do dia (congelado na foto da manhã seguinte); <b>COBERT</b> = real ÷ média.${seg ? ` Segunda-feira: D-1 = sábado (${fShort(sab)}) + domingo (${fShort(dom)}).` : ` D-1 = ${fShort(d1)}.`} Feriado na média usa o dia seguinte, como a planilha${(D.entrante?.feriados || []).length ? ` (${D.entrante.feriados.map(fShort).join(', ')})` : ''}. CANCELADA N2 não está no banco.</div>`;
  const legend = `<div class="rs-legend"><span><i class="en-c1"></i>&gt; 100%</span><span><i class="en-c2"></i>90%</span><span><i class="en-c3"></i>80%</span><span><i class="en-c4"></i>70%</span><span><i class="en-c5"></i>&lt; 70%</span></div>`;
  const marca = `<div class="en-marca" id="en-sel"></div>`;
  return `${nota}${marca}${D.entrante ? html : '<div class="notice"><div>Sem a série de entrantes nos dados.</div></div>'}${legend}`;
}

/* ------------------------------------------------------------------ VIEW: backlog (Realizado + Entrante do dia, layout do reporte) */
// Realizado = bloco do dia (mesmo do Resumo); Entrante = série congelada da aba Entrantes. Share: regional ÷ Desktop,
// polo ÷ sua regional (igual à planilha). Na segunda-feira mostra sábado e domingo, um de cada vez, como o reporte.
const BK_ORDEM = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];  // índice das entidades (Desktop = 12)
function bkTabela(titulo, data, M, rows) {
  const tot = e => M[e][7];
  const share = e => e === 12 ? (tot(12) ? 1 : null) : ratio(tot(e), tot(lvl(e) === 'regional' ? 12 : e - (e % 4)));
  const ents = scope(S.reg);
  const body = ents.map(e => {
    rows.push({ tabela: titulo, dia: data, gerencia: e === 12 ? 'Desktop' : E[e].code, territorio: entName(e), ...Object.fromEntries(TT.map((t, i) => [t, M[e][i] ?? ''])), share: share(e) ?? '' });
    return `<tr class="lvl-${lvl(e)}"><td>${rowName(e)}</td>${M[e].map((v, i) => `<td class="num"><span data-tip="${esc(`${titulo} · ${TT[i]} · ${entName(e)}<br>${exact(v)}`)}">${nf(v)}</span></td>`).join('')}<td class="num">${pct(share(e), 0)}</td></tr>`;
  }).join('');
  return card(`${titulo} · ${fLong(data)}`, titulo === 'Realizado' ? 'Produção do dia por gerência (mesmo realizado do Resumo)' : 'Entrante do dia por gerência (congelado na foto da manhã seguinte)',
    `<div class="table-wrap"><table><thead><tr><th>Polo / regional</th>${T.map(t => `<th class="num">${esc(t)}</th>`).join('')}<th class="num">Total</th><th class="num">Share</th></tr></thead><tbody>${body}</tbody></table></div>`);
}
function vBacklog() {
  const d0 = day(S.di).date, seg = dObj(d0).getDay() === 1;
  const datas = seg ? [enAdd(d0, -2), enAdd(d0, -1)] : [enAdd(d0, -1)];
  const rows = [];
  const blocos = datas.map(x => {
    const dd = D.days.find(d => d.date === x);
    const real = BK_ORDEM.map(e => [...Array(8).keys()].map(t => dd?.actual?.[e]?.[t] ?? null));
    const entr = BK_ORDEM.map(e => { const r = [...Array(7).keys()].map(t => enReal(x, e, t)); return [...r, r.some(v => v != null) ? r.reduce((a, v) => a + (v || 0), 0) : null]; });
    return `<div class="bk-wrap">${bkTabela('Realizado', x, real, rows)}${bkTabela('Entrante', x, entr, rows)}</div>`;
  }).join('');
  S.export = { name: `backlog-${datas.join('_')}`, rows };
  const nota = seg ? `<div class="card" style="padding:10px 16px;margin-bottom:14px;font-size:13px">Segunda-feira: sábado (${fShort(datas[0])}) e domingo (${fShort(datas[1])}), um quadro para cada dia, como no reporte.</div>` : '';
  return `${nota}${blocos}<div class="rs-legend"><span><b>Share</b>: regional ÷ Desktop · polo ÷ sua regional</span><span><b>Entrante</b>: congelado na foto da manhã seguinte (o mesmo da aba Entrantes)</span></div>`;
}

/* ------------------------------------------------------------------ VIEW: usuários (só administrador; servidor local do FUP) */
// Lista, cria e altera usuários e as telas que cada um vê. Quem confere tudo é o servidor (/api/usuarios); aqui é só a tela.
const US = { lista: null, telas: [], senhaMin: 8, edit: null, msg: '', erro: '' };
// Servidor local: API em /api com cookie. Cópia do IQT (/fup-portal/): API do Laravel (/api/api/fup) com token no cabeçalho.
const FUP_IQT = typeof location !== 'undefined' && location.pathname.includes('/fup-portal/');
const FUP_API = FUP_IQT ? (window.FUP_API_BASE || '/api/api/fup') : '/api';
const FUP_LOGIN = FUP_IQT ? 'login.html' : '/login';
const fupToken = v => { try { if (v === null) localStorage.removeItem('fup-token'); return localStorage.getItem('fup-token'); } catch (e) { return null; } };
const fupSair = () => { if (FUP_IQT) fupToken(null); location.replace(FUP_LOGIN); };
const usApi = async (url, body) => {
  const h = body ? { 'Content-Type': 'application/json' } : {}, t = FUP_IQT && fupToken();
  if (t) h.Authorization = 'Bearer ' + t;
  const r = await fetch(url.replace(/^\/api/, FUP_API), body ? { method: 'POST', headers: h, body: JSON.stringify(body), credentials: 'same-origin' } : { headers: h, credentials: 'same-origin', cache: 'no-store' });
  if (r.status === 401) { fupSair(); throw Error('Sessão expirada'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Error(j.erro || 'Não foi possível concluir.');
  return j;
};
async function usCarrega() {
  try { const j = await usApi('/api/usuarios'); Object.assign(US, { lista: j.usuarios, telas: j.telas, senhaMin: j.senhaMin }); }
  catch (e) { US.erro = e.message; US.lista = US.lista || []; }
  if (S.view === 'usuarios') render();
}
function vUsuarios() {
  if (!US.lista) { usCarrega(); return card('Usuários', '', '<div class="empty">Carregando…</div>'); }
  const nomeTela = Object.fromEntries(US.telas);
  const e = US.edit, novo = e && !e.usuario0;
  const linhas = US.lista.map(u => `<tr><td><b>${esc(u.usuario)}</b>${u.usuario === USER.usuario ? ' <span class="na">(você)</span>' : ''}</td><td>${esc(u.nome)}</td>
    <td>${u.admin ? '<span class="us-tag us-admin">Administrador · tudo</span>' : u.telas.map(t => `<span class="us-tag">${esc(nomeTela[t] || t)}</span>`).join('')}</td>
    <td>${u.ativo ? '<span class="status st-good">Ativo</span>' : '<span class="status st-crit">Inativo</span>'}</td><td class="na">${esc(u.alterado ? fShort(u.alterado.slice(0, 10)) : '')}</td>
    <td class="us-acoes"><button class="btn ghost" data-us-edita="${esc(u.usuario)}">Editar</button>${u.usuario !== USER.usuario ? `<button class="btn ghost us-del" data-us-exclui="${esc(u.usuario)}">Excluir</button>` : ''}</td></tr>`).join('');
  const tabela = card('Usuários do portal', 'Quem entra no FUP e quais telas cada um vê · senhas guardadas só como hash no servidor',
    `<div class="us-topo"><button class="btn primary" id="us-novo" type="button">+ Novo usuário</button></div>
     <div class="table-wrap"><table><thead><tr><th>Usuário</th><th>Nome</th><th>Pode ver</th><th>Situação</th><th>Alterado</th><th></th></tr></thead><tbody>${linhas}</tbody></table></div>`);
  const form = !e ? '' : card(novo ? 'Novo usuário' : `Editar ${esc(e.usuario0)}`, novo ? 'Defina usuário, senha inicial e as telas liberadas' : 'Deixe a senha em branco para manter a atual',
    `<form id="us-form" class="us-form" novalidate autocomplete="off">
      <label class="us-campo"><span>Usuário (login)</span><input name="usuario" value="${esc(e.usuario)}" ${novo ? '' : 'readonly'} maxlength="40" autocapitalize="none" spellcheck="false" placeholder="ex.: joao.silva" required></label>
      <label class="us-campo"><span>Nome</span><input name="nome" value="${esc(e.nome)}" maxlength="80" placeholder="Nome para exibir"></label>
      <label class="us-campo"><span>${novo ? 'Senha inicial' : 'Nova senha (opcional)'}</span><input name="senha" type="password" autocomplete="new-password" maxlength="200" placeholder="mínimo ${US.senhaMin} caracteres"></label>
      <div class="us-campo us-checks"><label><input type="checkbox" name="admin" ${e.admin ? 'checked' : ''}> Administrador <span class="na">(vê tudo e gerencia usuários)</span></label>
        <label><input type="checkbox" name="ativo" ${e.ativo ? 'checked' : ''}> Ativo <span class="na">(desmarque para bloquear o acesso)</span></label></div>
      <fieldset class="us-telas" ${e.admin ? 'disabled' : ''}><legend>Telas que pode ver</legend>
        ${US.telas.map(([k, n]) => `<label><input type="checkbox" name="tela" value="${esc(k)}" ${e.admin || e.telas.includes(k) ? 'checked' : ''}> ${esc(n)}</label>`).join('')}
        <p class="na">O assistente (Pergunte ao FUP) só enxerga os dados das telas liberadas para o usuário.</p></fieldset>
      ${US.erro ? `<div class="notice us-erro" role="alert"><div>${esc(US.erro)}</div></div>` : ''}
      <div class="us-botoes"><button class="btn primary" type="submit">${novo ? 'Criar usuário' : 'Salvar alterações'}</button><button class="btn ghost" type="button" id="us-cancela">Cancelar</button></div>
    </form>`);
  const msg = US.msg ? `<div class="card us-ok" role="status">${esc(US.msg)}</div>` : '';
  const erroGeral = !e && US.erro ? `<div class="notice us-erro" role="alert"><div>${esc(US.erro)}</div></div>` : '';
  return `${msg}${erroGeral}<div class="us-grid${e ? ' com-form' : ''}">${tabela}${form}</div>`;
}
function usBind() {
  const v = $('#view');
  $('#us-novo')?.addEventListener('click', () => { US.edit = { usuario: '', nome: '', admin: false, ativo: true, telas: [] }; US.msg = US.erro = ''; render(); $('#us-form [name=usuario]')?.focus(); });
  v.querySelectorAll('[data-us-edita]').forEach(b => b.addEventListener('click', () => { const u = US.lista.find(x => x.usuario === b.dataset.usEdita); US.edit = { ...u, usuario0: u.usuario }; US.msg = US.erro = ''; render(); $('#us-form [name=nome]')?.focus(); }));
  v.querySelectorAll('[data-us-exclui]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm(`Excluir o usuário ${b.dataset.usExclui}? Ele perde o acesso na hora.`)) return;
    try { const j = await usApi('/api/usuarios/excluir', { usuario: b.dataset.usExclui }); US.lista = j.usuarios; US.msg = `Usuário ${b.dataset.usExclui} excluído.`; US.erro = ''; US.edit = null; }
    catch (err) { US.erro = err.message; }
    render();
  }));
  $('#us-cancela')?.addEventListener('click', () => { US.edit = null; US.erro = ''; render(); });
  const f = $('#us-form'); if (!f) return;
  f.admin.addEventListener('change', () => { f.querySelector('.us-telas').disabled = f.admin.checked; });
  f.addEventListener('submit', async ev => {
    ev.preventDefault();
    const bt = f.querySelector('[type=submit]'); if (bt.disabled) return; bt.disabled = true;
    const corpo = { usuario: f.usuario.value.trim().toLowerCase(), nome: f.nome.value.trim(), admin: f.admin.checked, ativo: f.ativo.checked,
      telas: [...f.querySelectorAll('[name=tela]:checked')].map(x => x.value), senha: f.senha.value || undefined };
    US.edit = { ...US.edit, ...corpo, senha: undefined };
    try { const j = await usApi('/api/usuarios', corpo); US.lista = j.usuarios; US.msg = `Usuário ${corpo.usuario} ${US.edit.usuario0 ? 'alterado' : 'criado'}.`; US.erro = ''; US.edit = null; }
    catch (err) { US.erro = err.message; }
    f.senha.value = ''; render();
  });
}

/* ------------------------------------------------------------------ VIEW: compromisso D0 (lançamento; servidor local do FUP) */
// Hoje abre depois que o robô grava a necessidade e trava às 09:00. A partir de quarta-feira também dá para lançar o sábado e o
// domingo seguintes (aba PLAN_FDS da planilha), cada um travando às 09:00 do próprio dia. Quem decide é o servidor
// (/api/compromisso); a tela sugere, avisa e mostra o histórico, mas nunca grava sem a confirmação dele.
const CP = { est: null, data: null, vals: {}, base: {}, msg: '', erro: '', log: null, relogio: null, carregadoEm: 0, salvando: false,
  f: { de: null, ate: null, usuario: '', polo: '', tipo: '', acao: '', busca: '' } };
const cpK = (c, t) => `${c}|${t}`;
const cpInt = v => v == null || v === '' ? null : Math.round(+v);
const cpDia = j => `${j.diaSemana.charAt(0).toUpperCase() + j.diaSemana.slice(1)} ${fShort(j.data)}`;
function cpAplica(est) {
  CP.est = est; CP.data = est.data; CP.carregadoEm = Date.now(); CP.vals = {}; CP.base = {};
  for (const [k, c] of Object.entries(est.celulas)) { CP.base[k] = cpInt(c.valor); CP.vals[k] = cpInt(c.valor); }
}
async function cpCarrega(data) {
  try { cpAplica(await usApi('/api/compromisso' + (data ? '?data=' + encodeURIComponent(data) : ''))); CP.erro = ''; }
  catch (e) { CP.erro = e.message; }
  if (USER?.admin && !CP.log) await cpLog(true);
  if (S.view === 'compromisso') render();
}
async function cpLog(semRender) {
  const hoje = CP.est?.hoje || new Date().toISOString().slice(0, 10);
  if (!CP.f.de) { CP.f.de = new Date(dObj(hoje).getTime() - 6 * 864e5).toISOString().slice(0, 10); CP.f.ate = CP.est?.dias?.at(-1)?.data || hoje; }
  try { const j = await usApi(`/api/compromisso/log?de=${CP.f.de}&ate=${CP.f.ate}`); CP.log = j.registros; } catch (e) { CP.log = []; }
  if (!semRender && S.view === 'compromisso') render();
}
const cpSujo = () => CP.est && Object.keys(CP.vals).some(k => CP.vals[k] !== CP.base[k]);
/** Referência da célula: necessidade (quando o robô já rodou no dia) ou projeção de entrantes (fim de semana lançado antes). */
const cpRef = c => c.nec != null ? c.nec : c.proj;
/** Avisos de uma célula (não bloqueiam): vazio, abaixo da necessidade, acima da fila, muito diferente da semana anterior. */
function cpAvisos(k) {
  const c = CP.est.celulas[k], v = CP.vals[k], a = [];
  if (v == null) { a.push(['vazio', 'Sem compromisso']); return a; }
  if (c.nec != null && v < Math.round(c.nec)) a.push(['baixo', `Abaixo da necessidade (${nf(c.nec)})`]);
  if (c.fila != null && v > Math.ceil(c.fila) && c.fila > 0) a.push(['alto', `Acima da fila (${nf(c.fila)})`]);
  if (c.comp7 != null && Math.abs(v - c.comp7) > Math.max(20, c.comp7 * 0.5)) a.push(['dif', `Muito diferente da semana passada (${nf(c.comp7)})`]);
  return a;
}
function cpTempo(s) { const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60); return d ? `${d}d ${h}h` : h ? `${h}h${String(m).padStart(2, '0')}` : m ? `${m} min` : `${s % 60} s`; }
function vCompromisso() {
  if (!CP.est) { if (!CP.erro) cpCarrega(CP.data); return CP.erro ? `<div class="notice"><div>${esc(CP.erro)}</div></div>` : card('Compromisso D0', '', '<div class="empty">Carregando…</div>'); }
  const E0 = CP.est, J = E0.janela, aberto = J.disponivel && !J.travado, temNec = J.temNecessidade;
  const restante = Math.max(0, J.restanteS - Math.floor((Date.now() - CP.carregadoEm) / 1000));
  // abas: hoje + sábado/domingo (a partir de quarta)
  const abas = E0.dias.length > 1 ? `<div class="cp-abas" role="tablist">${E0.dias.map(j => `<button type="button" role="tab" data-cp-dia="${j.data}" aria-selected="${j.data === E0.data}" class="${j.travado ? 'trav' : ''}">
      <b>${j.tipo === 'hoje' ? 'Hoje · ' : ''}${esc(cpDia(j))}</b><small>${j.travado ? `travado ${esc(j.limite)}` : !j.disponivel ? 'aguardando base' : `trava ${j.tipo === 'hoje' ? '' : fShort(j.data) + ' '}às ${esc(j.limite)}`}</small></button>`).join('')}</div>` : '';
  const faixa = !J.disponivel
    ? `<div class="cp-faixa cp-espera"><b>Aguardando a base de hoje.</b> O lançamento abre assim que o robô gravar a necessidade de ${fDate(E0.data)}. <button class="btn ghost" id="cp-recarrega" type="button">Verificar de novo</button></div>`
    : J.travado
      ? `<div class="cp-faixa cp-trava"><b>${esc(cpDia(J))} travado desde as ${esc(J.limite)}.</b> Os valores abaixo são os gravados. Para corrigir, peça uma prorrogação ao administrador.</div>`
      : `<div class="cp-faixa cp-aberto"><b>${esc(cpDia(J))}: aberto até ${J.tipo === 'hoje' ? '' : fShort(J.data) + ' às '}${esc(J.limite)}</b>${J.prorrogado ? ' <span class="cp-prorrog">prorrogado</span>' : ''} · faltam <b id="cp-relogio">${cpTempo(restante)}</b>${J.robo ? ` · base atualizada às ${esc(J.robo.fim.slice(11, 16))}` : ''}</div>`;
  const semNec = J.disponivel && !temNec ? `<div class="cp-faixa cp-info">Lançamento antecipado de <b>${esc(cpDia(J))}</b>: a necessidade só sai quando o robô rodar no dia. A referência aqui é a <b>projeção de entrantes</b> (média do mesmo dia da semana nas 4 semanas anteriores) e a semana passada, como na aba PLAN_FDS.</div>` : '';
  const teste = E0.modoTeste ? '<div class="cp-faixa cp-teste"><b>MODO TESTE:</b> grava num arquivo local, não no banco dw_fup.</div>' : '';
  const T7 = E0.tipos, regs = [...new Set(E0.polos.map(p => p.regional))], rotRef = temNec ? 'nec' : 'proj';
  const soma = (cods, t, f) => { let s = 0, ok = false; for (const c of cods) { const v = f(cpK(c, t)); if (v != null) { s += v; ok = true; } } return ok ? s : null; };
  const linhaTotal = (rot, cods, cls) => `<tr class="${cls}"><th>${esc(rot)}</th>${T7.map(t => { const v = soma(cods, t.tipo, k => CP.vals[k]), n = soma(cods, t.tipo, k => cpRef(E0.celulas[k])); return `<td><b>${v == null ? '—' : nf(v)}</b><small>${rotRef} ${n == null ? '—' : nf(n)}${v != null && n ? ` · ${pct(v / n, 0)}` : ''}</small></td>`; }).join('')}</tr>`;
  let corpo = '';
  for (const r of regs) {
    const ps = E0.polos.filter(p => p.regional === r);
    corpo += ps.map(p => `<tr><th>${esc(p.nome)}<small>${esc(p.sigla)}</small></th>${T7.map(t => {
      const k = cpK(p.cod, t.tipo), c = E0.celulas[k], av = cpAvisos(k);
      const tip = [`<b>${esc(p.nome)} · ${esc(t.nome)} · ${esc(cpDia(J))}</b>`, `Necessidade: ${c.nec == null ? 'sai quando o robô rodar no dia' : nf(c.nec)}`,
        `Projeção de entrantes: ${c.proj == null ? '—' : nf(c.proj)}${c.proj && CP.vals[k] != null ? ` · cobertura ${pct(CP.vals[k] / c.proj, 0)}` : ''}`,
        c.fila != null ? `Fila: ${nf(c.fila)}${t.du && c.du != null ? ` · DU ${nf(c.du, 2)}` : ''}` : '',
        `Semana passada (${fShort(E0.semanaAnterior)}): compromisso ${c.comp7 == null ? '—' : nf(c.comp7)} · realizado ${c.real7 == null ? '—' : nf(c.real7)}`,
        c.por ? `Gravado por ${esc(String(c.por).replace('portal:', ''))}${c.em ? ' em ' + esc(c.em.slice(8, 10) + '/' + c.em.slice(5, 7) + ' ' + c.em.slice(11, 16)) : ''}` : 'Ainda não gravado', ...av.map(a => '⚠ ' + a[1])].filter(Boolean).join('<br>');
      const sub = temNec ? `nec <b>${c.nec == null ? '—' : nf(c.nec)}</b> · fila ${c.fila == null ? '—' : nf(c.fila)}` : `proj <b>${c.proj == null ? '—' : nf(c.proj)}</b> · sem. ant. ${c.comp7 == null ? '—' : nf(c.comp7)}`;
      return `<td class="cp-cel ${av.map(a => 'cp-' + a[0]).join(' ')}${CP.vals[k] !== CP.base[k] ? ' cp-mudou' : ''}" data-tip="${esc(tip)}"><input data-k="${k}" inputmode="numeric" autocomplete="off" value="${CP.vals[k] ?? ''}" ${aberto ? '' : 'disabled'} aria-label="Compromisso ${esc(t.nome)} ${esc(p.nome)}"><small>${sub}</small></td>`;
    }).join('')}</tr>`).join('') + linhaTotal(ps[0].nomeRegional, ps.map(p => p.cod), 'cp-reg');
  }
  corpo += linhaTotal('Desktop', E0.polos.map(p => p.cod), 'cp-desk');
  const todos = Object.keys(CP.vals), mud = todos.filter(k => CP.vals[k] !== CP.base[k]).length;
  const nAv = { vazio: 0, baixo: 0, alto: 0, dif: 0 }; todos.forEach(k => cpAvisos(k).forEach(a => nAv[a[0]]++));
  const ferramentas = aberto ? `<div class="cp-ferr">${temNec ? '<button class="btn ghost" type="button" id="cp-nec">Preencher vazios com a necessidade</button>' : '<button class="btn ghost" type="button" id="cp-proj">Preencher vazios com a projeção de entrantes</button>'}<button class="btn ghost" type="button" id="cp-sem">Preencher vazios com a semana passada</button><button class="btn ghost" type="button" id="cp-desfaz" ${mud ? '' : 'disabled'}>Desfazer alterações</button></div>` : '';
  const resumo = `<div class="cp-resumo"><span class="chip">${mud} alteração(ões) não salva(s)</span>${nAv.vazio ? `<span class="chip cp-c-vazio">${nAv.vazio} vazia(s)</span>` : ''}${nAv.baixo ? `<span class="chip cp-c-baixo">${nAv.baixo} abaixo da necessidade</span>` : ''}${nAv.alto ? `<span class="chip cp-c-alto">${nAv.alto} acima da fila</span>` : ''}${nAv.dif ? `<span class="chip cp-c-dif">${nAv.dif} muito diferente(s) da semana passada</span>` : ''}</div>`;
  const grade = card(`Compromisso · ${esc(cpDia(J))} ${E0.data.slice(0, 4)}`, temNec ? 'Ordens comprometidas por polo e serviço · referência = necessidade do dia (foto do robô) · passe o mouse para ver fila, DU, projeção e semana passada'
    : 'Ordens comprometidas por polo e serviço · referência = projeção de entrantes (a necessidade sai no dia) · passe o mouse para ver a semana passada',
    `${USER?.admin ? `<div class="cp-csv"><button class="btn ghost" type="button" id="cp-csv">Exportar CSV de ${esc(cpDia(J))}</button><span class="na">valores gravados no banco (o que ainda não foi salvo não entra)</span></div>` : ''}${ferramentas}<div class="table-wrap cp-wrap"><table class="cp"><thead><tr><th>Polo</th>${T7.map(t => `<th>${esc(t.nome)}</th>`).join('')}</tr></thead><tbody>${corpo}</tbody></table></div>
     <div class="cp-legenda"><span><i class="cp-i-baixo"></i>abaixo da necessidade</span><span><i class="cp-i-alto"></i>acima da fila</span><span><i class="cp-i-dif"></i>muito diferente da semana passada</span><span><i class="cp-i-mudou"></i>alterado, ainda não salvo</span></div>
     ${aberto ? `<div class="cp-barra">${resumo}<button class="btn primary" type="button" id="cp-salva" ${mud && !CP.salvando ? '' : 'disabled'}>${CP.salvando ? 'Salvando…' : `Salvar ${esc(cpDia(J))}`}</button></div>` : ''}`);
  // administrador: prorrogação (hoje) e histórico com filtros
  let adm = '';
  if (USER?.admin && E0.prorrogacoes) {
    const pr = E0.prorrogacoes, ind = Object.entries(pr.usuarios || {});
    adm += card('Prorrogação do prazo de hoje', `Padrão: cada dia trava às 09:00 para todos, inclusive administrador · vale só para ${fDate(E0.hoje)}`,
      `<form class="cp-pr" id="cp-pr" novalidate><label class="us-campo"><span>Para quem</span><select name="quem"><option value="">Todos</option>${(E0.usuariosCompromisso || []).map(u => `<option value="${esc(u)}">${esc(u)}</option>`).join('')}</select></label>
        <label class="us-campo"><span>Até</span><input name="ate" type="time" min="09:01" value="10:00" required></label><button class="btn primary" type="submit">Prorrogar</button></form>
       <ul class="cp-pr-lista">${pr.todos ? `<li><b>Todos</b> até ${esc(pr.todos)} <button class="btn ghost" data-pr-tira="">remover</button></li>` : ''}${ind.map(([u, h]) => `<li><b>${esc(u)}</b> até ${esc(h)} <button class="btn ghost" data-pr-tira="${esc(u)}">remover</button></li>`).join('')}${!pr.todos && !ind.length ? '<li class="na">Nenhuma prorrogação hoje.</li>' : ''}</ul>`);
    const nomeP = Object.fromEntries(E0.polos.map(p => [p.cod, p.nome])), nomeT = Object.fromEntries(E0.tipos.map(t => [t.tipo, t.nome]));
    const f = CP.f, todosReg = CP.log || [];
    const usuarios = [...new Set(todosReg.map(r => r.usuario))].sort();
    const busca = f.busca.trim().toLowerCase();
    const reg = todosReg.filter(r => (!f.usuario || r.usuario === f.usuario) && (!f.acao || r.acao === f.acao) && (!f.polo || String(r.cod) === f.polo) && (!f.tipo || r.tipo === f.tipo)
      && (!busca || [r.usuario, nomeP[r.cod], nomeT[r.tipo], r.para_quem, r.de, r.para, r.ate].join(' ').toLowerCase().includes(busca)));
    S.export = { name: `historico-compromisso-${f.de}_${f.ate}`, rows: reg.map(r => ({ alterado_em: r.em.replace('T', ' '), dia_compromisso: r.data, usuario: r.usuario, acao: r.acao === 'prorrogacao' ? 'prorrogação' : 'valor', polo: nomeP[r.cod] || '', servico: nomeT[r.tipo] || '', de: r.de ?? '', para: r.acao === 'prorrogacao' ? (r.ate ? 'até ' + r.ate : 'removida') + ' · ' + r.para_quem : r.para ?? '' })) };
    const sel = (nome, rot, ops) => `<label class="us-campo"><span>${rot}</span><select data-cp-f="${nome}"><option value="">Todos</option>${ops.map(([v, t]) => `<option value="${esc(v)}" ${String(f[nome]) === String(v) ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>`;
    const filtros = `<div class="cp-filtros"><label class="us-campo"><span>Dia do compromisso: de</span><input type="date" data-cp-f="de" value="${esc(f.de)}"></label><label class="us-campo"><span>até</span><input type="date" data-cp-f="ate" value="${esc(f.ate)}"></label>
      ${sel('usuario', 'Usuário', usuarios.map(u => [u, u]))}${sel('polo', 'Polo', E0.polos.map(p => [p.cod, p.nome]))}${sel('tipo', 'Serviço', E0.tipos.map(t => [t.tipo, t.nome]))}${sel('acao', 'O quê', [['valor', 'Valores'], ['prorrogacao', 'Prorrogações']])}
      <label class="us-campo cp-busca"><span>Buscar</span><input type="search" data-cp-f="busca" value="${esc(f.busca)}" placeholder="usuário, polo, valor…"></label>
      <button class="btn ghost" type="button" id="cp-f-limpa">Limpar filtros</button></div>`;
    adm += card('Histórico de alterações', `Quem alterou o quê e quando · visível só para administradores · ${reg.length} de ${todosReg.length} registro(s) · "Exportar CSV" no topo baixa esta lista`,
      `${filtros}<div class="table-wrap cp-log"><table><thead><tr><th>Alterado em</th><th>Dia do compromisso</th><th>Usuário</th><th>O quê</th><th>De</th><th>Para</th></tr></thead><tbody>${reg.map(r => `<tr><td>${esc(r.em.slice(8, 10) + '/' + r.em.slice(5, 7) + ' ' + r.em.slice(11, 19))}</td><td>${esc(fShort(r.data))}</td><td>${esc(r.usuario)}</td>${r.acao === 'prorrogacao'
        ? `<td>Prorrogação para <b>${esc(r.para_quem)}</b></td><td></td><td>${r.ate ? 'até ' + esc(r.ate) : 'removida'}</td>`
        : `<td>${esc(nomeP[r.cod] || r.cod)} · ${esc(nomeT[r.tipo] || r.tipo)}</td><td>${r.de == null ? '<span class="na">vazio</span>' : nf(r.de)}</td><td><b>${r.para == null ? 'vazio' : nf(r.para)}</b></td>`}</tr>`).join('') || '<tr><td colspan="6" class="na">Nenhum registro com esses filtros.</td></tr>'}</tbody></table></div>`);
  } else S.export = { name: `compromisso-${E0.data}`, rows: E0.polos.flatMap(p => [{ polo: p.nome, sigla: p.sigla, ...Object.fromEntries(E0.tipos.map(t => [t.nome, CP.vals[cpK(p.cod, t.tipo)] ?? ''])) }]) };
  const msg = CP.msg ? `<div class="card us-ok" role="status">${esc(CP.msg)}</div>` : '';
  const erro = CP.erro ? `<div class="notice us-erro" role="alert"><div>${esc(CP.erro)}</div></div>` : '';
  return `${teste}${abas}${faixa}${semNec}${msg}${erro}${grade}${adm ? `<div class="cp-adm">${adm}</div>` : ''}`;
}
function cpBind() {
  const v = $('#view');
  $('#export').disabled = !S.export?.rows?.length;
  clearInterval(CP.relogio);
  const J = CP.est?.janela;
  if (J?.disponivel && !J.travado) CP.relogio = setInterval(() => {
    if (S.view !== 'compromisso') return clearInterval(CP.relogio);
    const r = J.restanteS - Math.floor((Date.now() - CP.carregadoEm) / 1000), el = $('#cp-relogio');
    if (r <= 0) { clearInterval(CP.relogio); cpCarrega(CP.data); return; }  // o servidor confirma a trava
    if (el) el.textContent = cpTempo(r);
  }, 1000);
  $('#cp-recarrega')?.addEventListener('click', () => { CP.est = null; render(); });
  v.querySelectorAll('[data-cp-dia]').forEach(b => b.addEventListener('click', () => {
    if (b.dataset.cpDia === CP.data) return;
    if (cpSujo() && !confirm('Há alterações neste dia que não foram salvas. Trocar de dia mesmo assim?')) return;
    CP.msg = ''; CP.erro = ''; CP.est = null; CP.data = b.dataset.cpDia; render();
  }));
  const atualiza = () => { const y = scrollY, foco = document.activeElement?.dataset?.k, pos = document.activeElement?.selectionStart; render(); scrollTo(0, y); if (foco) { const i = $(`#view input[data-k="${foco}"]`); i?.focus(); try { i?.setSelectionRange(pos, pos); } catch (e) { } } };
  v.querySelectorAll('input[data-k]').forEach((inp, i, arr) => {
    inp.addEventListener('input', () => { const s = inp.value.replace(/\D/g, '').slice(0, 6); if (s !== inp.value) inp.value = s; CP.vals[inp.dataset.k] = s === '' ? null : +s; CP.msg = ''; atualiza(); });
    inp.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); const cols = CP.est.tipos.length; const prox = arr[i + cols] || arr[(i % cols) + 1]; (prox || arr[0]).focus(); (prox || arr[0]).select(); } });
    inp.addEventListener('focus', () => inp.select());
  });
  const preenche = f => { for (const k of Object.keys(CP.vals)) if (CP.vals[k] == null) { const x = f(CP.est.celulas[k]); if (x != null) CP.vals[k] = Math.round(x); } CP.msg = ''; render(); };
  $('#cp-nec')?.addEventListener('click', () => preenche(c => c.nec));
  $('#cp-proj')?.addEventListener('click', () => preenche(c => c.proj));
  $('#cp-sem')?.addEventListener('click', () => preenche(c => c.comp7));
  $('#cp-desfaz')?.addEventListener('click', () => { CP.vals = { ...CP.base }; CP.msg = ''; render(); });
  $('#cp-csv')?.addEventListener('click', cpExportaDia);
  $('#cp-salva')?.addEventListener('click', async () => {
    if (CP.salvando) return;
    const mud = Object.keys(CP.vals).filter(k => CP.vals[k] !== CP.base[k]);
    const nAv = mud.reduce((s, k) => s + cpAvisos(k).length, 0);
    if (nAv && !confirm(`${nAv} aviso(s) nas células alteradas (abaixo da necessidade, acima da fila ou muito diferente da semana passada). Salvar mesmo assim?`)) return;
    CP.salvando = true; CP.erro = ''; render();
    try {
      const j = await usApi('/api/compromisso', { data: CP.data, base: Object.fromEntries(mud.map(k => [k, CP.base[k]])), valores: Object.fromEntries(mud.map(k => [k, CP.vals[k]])) });
      cpAplica(j.estado); CP.msg = `${j.gravadas} valor(es) de ${cpDia(CP.est.janela)} gravado(s) às ${new Date().toLocaleTimeString('pt-BR').slice(0, 5)}.`;
      if (USER?.admin) await cpLog(true);
    } catch (e) { CP.erro = e.message; }
    CP.salvando = false; render();
  });
  // administrador: prorrogação
  const f = $('#cp-pr');
  const recarregaMantendo = async j => { const vals = CP.vals, data = CP.data; if (data === j.estado.data) { cpAplica(j.estado); CP.vals = { ...CP.vals, ...vals }; } else await cpCarrega(data); await cpLog(true); };
  f?.addEventListener('submit', async ev => {
    ev.preventDefault();
    try { const j = await usApi('/api/compromisso/prorrogar', { data: CP.est.hoje, ate: f.ate.value, usuario: f.quem.value || null }); await recarregaMantendo(j); CP.msg = `Prorrogado até ${f.ate.value} para ${f.quem.value || 'todos'}.`; CP.erro = ''; }
    catch (e) { CP.erro = e.message; }
    render();
  });
  v.querySelectorAll('[data-pr-tira]').forEach(b => b.addEventListener('click', async () => {
    try { const j = await usApi('/api/compromisso/prorrogar', { data: CP.est.hoje, ate: null, usuario: b.dataset.prTira || null }); await recarregaMantendo(j); CP.msg = 'Prorrogação removida.'; }
    catch (e) { CP.erro = e.message; }
    render();
  }));
  // administrador: filtros do histórico (período busca no servidor; o resto filtra na tela)
  v.querySelectorAll('[data-cp-f]').forEach(el => el.addEventListener(el.type === 'search' ? 'input' : 'change', async () => {
    const k = el.dataset.cpF; CP.f[k] = el.value;
    if (k === 'de' || k === 'ate') { if (CP.f.de && CP.f.ate && CP.f.de <= CP.f.ate) await cpLog(true); }
    const pos = el.selectionStart; render();
    if (el.type === 'search') { const n = $('#view [data-cp-f="busca"]'); n?.focus(); try { n?.setSelectionRange(pos, pos); } catch (e) { } }
  }));
  $('#cp-f-limpa')?.addEventListener('click', async () => { CP.f = { de: null, ate: null, usuario: '', polo: '', tipo: '', acao: '', busca: '' }; await cpLog(true); render(); });
}
/** CSV do dia aberto (administrador): o que está gravado, por polo, regional e Desktop, com a referência ao lado. */
function cpExportaDia() {
  const E0 = CP.est, T7 = E0.tipos, temNec = E0.janela.temNecessidade, ref = temNec ? 'necessidade' : 'projeção entrantes';
  const soma = (cods, t, f) => { let s = 0, ok = false; for (const c of cods) { const v = f(cpK(c, t)); if (v != null) { s += v; ok = true; } } return ok ? s : ''; };
  const linha = (regional, nome, sigla, cods) => {
    const r = { dia: E0.data, dia_semana: E0.janela.diaSemana, regional, polo: nome, sigla };
    T7.forEach(t => { r[t.nome] = soma(cods, t.tipo, k => CP.base[k]); });
    r.TOTAL = T7.some(t => r[t.nome] !== '') ? T7.reduce((a, t) => a + (+r[t.nome] || 0), 0) : '';
    T7.forEach(t => { const v = soma(cods, t.tipo, k => cpRef(E0.celulas[k])); r[`${ref} ${t.nome}`] = v === '' ? '' : Math.round(v); });
    if (cods.length === 1) { const ult = T7.map(t => E0.celulas[cpK(cods[0], t.tipo)]).filter(c => c.em).sort((a, b) => a.em < b.em ? 1 : -1)[0]; r.ultima_gravacao = ult ? `${String(ult.por).replace('portal:', '')} ${ult.em.replace('T', ' ')}` : ''; }
    return r;
  };
  const rows = [];
  for (const reg of [...new Set(E0.polos.map(p => p.regional))]) {
    const ps = E0.polos.filter(p => p.regional === reg);
    ps.forEach(p => rows.push(linha(p.nomeRegional, p.nome, p.sigla, [p.cod])));
    rows.push(linha(ps[0].nomeRegional, ps[0].nomeRegional.toUpperCase(), reg, ps.map(p => p.cod)));
  }
  rows.push(linha('DESKTOP', 'DESKTOP', 'DESKTOP', E0.polos.map(p => p.cod)));
  const chaves = [...new Set(rows.flatMap(r => Object.keys(r)))];
  rows.forEach(r => chaves.forEach(k => { if (!(k in r)) r[k] = ''; }));
  const antes = S.export; S.export = { name: `compromisso-${E0.data}-${E0.janela.diaSemana}`, rows }; exportCSV(); S.export = antes;
}
window.addEventListener('beforeunload', ev => { if (cpSujo()) { ev.preventDefault(); ev.returnValue = ''; } });

// Telas ocultas por enquanto (Painel do dia, Evolução, Estoque & DU): para reativar, descomente aqui e no menu do index.html.
const VIEWS = {
  // painel: ['Painel do dia', 'Necessidade, compromisso e realizado — dados do banco dw_fup', vPainel],
  // 4º item = filtros que valem na tela (os outros somem da barra): per 'dia' | 'periodo', reg, type, metas (mês + Ativação/Retirada)
  backlog: ['Backlog', 'Realizado e entrante do dia por gerência · mesmos números do reporte · dados do banco dw_fup', vBacklog, { per: 'dia', reg: true }],
  mapa: ['Mapa', 'Cidades atendidas · previsão do tempo (Open-Meteo) e situação da fila por cidade · dados do banco dw_fup', vMapa, { reg: true, type: true }],
  resumo: ['Resumo', 'Mesmo layout do RESUMO da planilha · D-1 (realizado) e D0 · dados do banco dw_fup', vResumo, { per: 'dia' }],
  entrantes: ['Entrantes', 'Mesmo layout da aba ENTRANTE da planilha · média de 4 ou 8 semanas × real · dados do banco dw_fup', vEntrantes, { per: 'dia', reg: true, type: true, ensem: true }],
  // evolucao: ['Evolução', 'Série histórica dos blocos diários do Compromissos D0', vEvolucao],
  // estoque: ['Estoque & DU', 'Fila, dias úteis de estoque e estoque máximo por serviço', vEstoque],
  metas: ['Metas do mês', 'Ativação e Retirada: curva de meta, realizado, projeção e necessidade diária', vMetas, { reg: true, metas: true }],
  capacity: ['Capacity', 'Equipes próprias e terceiras: comprometido, confirmado e presente', vCapacity, { per: 'periodo', reg: true }],
  conferencia: ['Conferência', 'Execução do robô e conferências automáticas do banco', vConferencia, {}],
};
const viewF = () => VIEWS[S.view]?.[3] || {};
/** Barra de filtros: mostra só o que vale na tela atual (filtro que não faz nada confunde). */
function filterBar(F) {
  $('#fld-period').hidden = !F.per; $('#fld-reg').hidden = !F.reg; $('#fld-type').hidden = !F.type;
  $('#fld-msvc').hidden = $('#fld-month').hidden = !F.metas;
  $('#fld-ensem').hidden = !F.ensem;
  $$('#f-ensem button').forEach(b => b.setAttribute('aria-checked', String(+b.dataset.sem === enSem())));
  $('.filterbar').hidden = !F.per && !F.reg && !F.type && !F.metas;  // Conferência: nenhum filtro vale
  $('#fld-period-label').textContent = F.per === 'dia' ? 'Dia do realizado (D-1) · D0 = dia seguinte' : 'Período do realizado · D0 = dia seguinte ao “Até”';
  if (F.metas) {
    const m = curMonth();
    $$('#f-msvc button').forEach(b => b.setAttribute('aria-checked', String(b.dataset.svc === S.service)));
    $('#f-month').innerHTML = monthRecs().slice().reverse().map(r => `<option value="${r.month}" ${r.month === m?.month ? 'selected' : ''}>${fMonth(r.month)} · ${esc(r.sheet)}</option>`).join('');
  }
}
function render() {
  const [title, sub, fn] = VIEWS[S.view], F = viewF();
  document.title = `${title} · FUP`;
  $('#title').textContent = title; $('#subtitle').textContent = sub;
  $$('nav button').forEach(b => b.classList.toggle('active', b.dataset.view === S.view));
  $$('#f-reg button').forEach(b => b.setAttribute('aria-checked', String(+b.dataset.reg === S.reg)));
  const d0 = day(S.di), d1 = F.per === 'periodo' ? realizedDay() : day(S.di - 1);
  filterBar(F);
  $('#f-period').innerHTML = periodCtl();
  const chips = [];
  if (F.per) chips.push(`<span class="chip" data-tip="Dia(s) cujo realizado está sendo exibido">${d1?.n > 1 ? 'Realizado' : 'Realizado (D-1)'} <b>${d1 ? realLabel(d1) : '—'}</b></span><span class="chip" data-tip="Dia da necessidade, compromisso, fila e DU">D0 <b>${fShort(d0.date)}</b></span>`);
  if (S.view === 'mapa' && D.mapa?.d0) chips.push(`<span class="chip" data-tip="O mapa mostra sempre a última foto do robô">Foto <b>${fShort(D.mapa.d0)}</b></span>`);
  if (F.metas) { const m = curMonth(); if (m) chips.push(`<span class="chip">${esc(m.service)} · <b>${fMonth(m.month)}</b></span>`); }
  if (F.reg) chips.push(`<span class="chip">${esc(scopeLabel())}${F.type ? ` · ${esc(typeLabel(S.type))}` : ''}</span>`);
  $('#context').innerHTML = chips.join('');
  S.export = null; chartSeq = 0; for (const k in CHARTS) delete CHARTS[k];
  const v = $('#view'); v.innerHTML = fn(); bindCharts(v);
  $('#export').disabled = !S.export;
  v.querySelectorAll('[data-tabs]').forEach(tb => tb.addEventListener('click', ev => {
    const b = ev.target.closest('button'); if (!b) return; const k = tb.dataset.tabs, val = b.dataset.k;
    if (k === 'matrix') S.matrix = val; else if (k === 'service') { S.service = val; } else if (['mday', 'msit', 'mrisk', 'micons'].includes(k)) { S[k] = val; if (k !== 'micons') S.mcity = null; }
    render();
  }));
  v.querySelectorAll('[data-ent]').forEach(el => el.addEventListener('click', () => openDetail(+el.dataset.ent)));
  $('#rs-png')?.addEventListener('click', () => rsImage('download'));
  v.querySelectorAll('[data-ib]').forEach(el => el.addEventListener('click', () => { S.mcity = +el.dataset.ib; render(); }));
  $('#mp-back')?.addEventListener('click', () => { S.mcity = null; render(); });
  const mpSt = $('#mp-status'); if (mpSt) mpSt.dataset.label = mpSt.textContent;
  $('#mp-png')?.addEventListener('click', () => shotImage('.mp-shot', 'Mapa de cidades', `mapa-fup-${D.mapa?.d0 || 'dia'}.png`, 'download', $('#mp-status')));
  $('#mp-copy')?.addEventListener('click', () => shotImage('.mp-shot', 'Mapa de cidades', '', 'copy', $('#mp-status')));
  $('#rs-copy')?.addEventListener('click', () => rsImage('copy'));
  $('#rs-fds')?.addEventListener('click', () => { S.fds = !S.fds; render(); });
  v.querySelectorAll('table.en').forEach(tb => tb.addEventListener('click', ev => {
    const c = ev.target.closest('[data-d]'); if (!c) return;
    S.enSel = S.enSel === c.dataset.d ? null : c.dataset.d; enMark(S.enSel);
  }));
  if (S.view === 'entrantes') { enFix(); enMark(S.enSel); }
  if (S.view === 'usuarios') usBind();
  if (S.view === 'compromisso') cpBind();
  const badgeEl = $('#nav-check');
  if (VAL) { const core = VAL.checks.filter(c => c.group !== 'Consistência'); const all = core.every(c => c.ok === c.total) && VAL.checks.every(c => (c.unexplained ?? 0) === 0); badgeEl.textContent = all ? '100%' : '!'; }
  history.replaceState(null, '', '#' + S.view);
}
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 2200); }

/* ------------------------------------------------------------------ init */
/** Login (servidor local): tira do menu e do VIEWS as telas não liberadas; admin ganha a tela Usuários. */
function initUsuario() {
  if (!USER) return;
  for (const k of Object.keys(VIEWS)) if (!USER.telas.includes(k)) delete VIEWS[k];
  if (USER.telas.includes('compromisso')) VIEWS.compromisso = ['Compromisso D0', 'Lançamento do compromisso por polo e serviço · hoje abre com a base atualizada e trava às 09:00 · a partir de quarta, também sábado e domingo', vCompromisso, {}];
  if (USER.admin) VIEWS.usuarios = ['Usuários', 'Quem acessa o portal FUP e quais telas cada um vê', vUsuarios, {}];
  $$('nav button[data-view]').forEach(b => { b.hidden = !VIEWS[b.dataset.view]; });
  $$('nav .nav-label').forEach(l => { let x = l.nextElementSibling, algum = false; while (x && !x.classList.contains('nav-label')) { if (x.matches('button') && !x.hidden) algum = true; x = x.nextElementSibling; } l.hidden = !algum; });
  const box = $('#user-box'); box.hidden = false;
  $('#user-nome').textContent = USER.nome; $('#user-login').textContent = USER.admin ? `${USER.usuario} · administrador` : USER.usuario;
  $('#user-sair').addEventListener('click', async () => { try { await usApi('/api/logout', {}); } catch (e) { } fupSair(); });
  const dlg = $('#dlg-senha'), fs = $('#form-senha'), err = $('#senha-erro');
  $('#user-senha').addEventListener('click', () => { fs.reset(); err.hidden = true; dlg.showModal(); fs.atual.focus(); });
  $('#senha-cancela').addEventListener('click', () => dlg.close());
  fs.addEventListener('submit', async ev => {
    ev.preventDefault(); err.hidden = true;
    if (fs.nova.value !== fs.repete.value) { err.textContent = 'As senhas novas não conferem.'; err.hidden = false; return; }
    const bt = fs.querySelector('[type=submit]'); bt.disabled = true;
    try { await usApi('/api/senha', { atual: fs.atual.value, nova: fs.nova.value }); dlg.close(); toast('Senha alterada'); }
    catch (e) { err.textContent = e.message; err.hidden = false; }
    bt.disabled = false; fs.atual.value = fs.nova.value = fs.repete.value = '';
  });
}
function init() {
  initUsuario();
  document.documentElement.classList.add('pronto');  // libera o menu (escondido até saber as telas do usuário)
  ppBind();
  $('#f-type').innerHTML = `<option value="-1">Todos os serviços</option>` + T.map((t, i) => `<option value="${i}">${esc(t)}</option>`).join('');
  $('#f-type').addEventListener('change', ev => { S.type = +ev.target.value; render(); });
  $$('#f-reg button').forEach(b => b.addEventListener('click', () => { S.reg = +b.dataset.reg; render(); }));
  $$('#f-msvc button').forEach(b => b.addEventListener('click', () => { S.service = b.dataset.svc; render(); }));
  $$('#f-ensem button').forEach(b => b.addEventListener('click', () => { S.enSem = +b.dataset.sem; render(); }));
  $('#f-month').addEventListener('change', ev => { S.month = ev.target.value; render(); });
  $$('nav button').forEach(b => b.addEventListener('click', () => {
    if (S.view === 'compromisso' && b.dataset.view !== 'compromisso' && cpSujo() && !confirm('Há alterações no compromisso que não foram salvas. Sair mesmo assim?')) return;
    S.view = b.dataset.view; render(); window.scrollTo({ top: 0, behavior: 'smooth' });
  }));
  $('#drawer-close').addEventListener('click', closeDetail);
  $('#drawer').addEventListener('click', ev => { if (ev.target.id === 'drawer') closeDetail(); });
  document.addEventListener('keydown', ev => {
    if (ev.key === 'Escape') { closeDetail(); ppClose(); document.body.classList.remove('present'); }
    if (ev.key.toLowerCase() === 'p' && !ev.target.closest('input,select,textarea') && !ev.ctrlKey && !ev.metaKey) togglePresent();
  });
  $('#present').addEventListener('click', togglePresent);
  $('#print').addEventListener('click', () => window.print());
  $('#theme').addEventListener('click', () => { const h = document.documentElement; h.dataset.theme = h.dataset.theme === 'dark' ? 'light' : 'dark'; try { localStorage.setItem('fup-theme', h.dataset.theme) } catch (e) { } render(); });
  $('#export').addEventListener('click', exportCSV);
  const h = location.hash.slice(1); if (VIEWS[h]) S.view = h;
  if (!VIEWS[S.view]) S.view = $$('nav button[data-view]').find(b => !b.hidden && VIEWS[b.dataset.view])?.dataset.view || Object.keys(VIEWS)[0];
  render();
}
function togglePresent() {
  document.body.classList.toggle('present');
  if (document.body.classList.contains('present')) { document.documentElement.requestFullscreen?.().catch(() => { }); toast('Modo apresentação · P ou Esc para sair'); }
  else if (document.fullscreenElement) document.exitFullscreen?.();
  setTimeout(render, 60);
}
function exportCSV() {
  if (!S.export || !S.export.rows.length) return;
  const rows = S.export.rows, keys = Object.keys(rows[0]);
  const cell = v => '"' + String(typeof v === 'number' ? String(v).replace('.', ',') : v ?? '').replace(/^[=+@-](?![\d,])/, "'$&").replace(/"/g, '""') + '"';
  const csv = '﻿' + [keys.map(cell).join(';'), ...rows.map(r => keys.map(k => cell(r[k])).join(';'))].join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })), a = document.createElement('a');
  a.href = url; a.download = `FUP-${S.export.name}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); toast('CSV exportado');
}
if (typeof window !== 'undefined' && window.PORTAL_DATA) init();
