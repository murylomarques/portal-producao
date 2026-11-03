'use strict';
window.addEventListener('error', ev => {
  if (!document.body) return; document.body.dataset.error = ev.message + ' @' + ev.lineno + ':' + ev.colno;
  let b = document.getElementById('fatal'); if (!b) { b = document.createElement('div'); b.id = 'fatal'; b.className = 'notice'; b.style.cssText = 'position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:200;max-width:720px'; document.body.appendChild(b); }
  b.innerHTML = '<div><b>Erro no portal:</b> ' + String(ev.message).replace(/</g, '&lt;') + ' <span class="mono">(app.js:' + ev.lineno + ')</span><br>Envie esta mensagem ao suporte.</div>';
});
if (!window.PORTAL_DATA) document.addEventListener('DOMContentLoaded', () => { document.getElementById('view').innerHTML = `<div class="notice"><div><b>Sem dados do banco dw_fup.</b> ${window.PORTAL_ERROR ? String(window.PORTAL_ERROR).replace(/[<>&]/g, '') : 'Abra o portal pelo “Iniciar Portal.cmd” (http://127.0.0.1:8765): os dados são lidos do banco pelo servidor local.'}</div></div>`; });
/* FUP · Produção regional — todos os números exibidos vêm do banco dw_fup (robô diário + tabelas manuais)
   (Compromissos D0, abas mensais Ati/Ret e CAPACITY). Regionais, Desktop e percentuais
   NÃO são recalculados: vêm das próprias linhas da planilha, para bater 1:1 com o arquivo. */
const D = window.PORTAL_DATA, VAL = window.PORTAL_VALIDATION || null;
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
  view: 'painel', di: D.days.length - 1, reg: 12, type: -1, matrix: 'du',
  from: D.days.at(-2).date, to: D.days.at(-2).date,  // período do realizado; padrão = D-1 do último bloco
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
/** Gráfico de linhas com crosshair + tooltip. series: [{name, color, values, dash, area}] */
function lineChart({ labels, series, height = 260, yfmt = n1, ref = null, tipfmt = null, xfmt = fShort, minZero = true, width = 880 }) {
  const id = 'c' + (++chartSeq), W = width, H = height, L = 54, R = 92, Tp = 12, B = 30;
  const all = series.flatMap(s => s.values).filter(v => v != null).concat(ref != null ? [ref] : []);
  if (!all.length) return `<div class="empty">Sem valores no banco para este recorte.</div>`;
  let mn = Math.min(...all), mx = Math.max(...all); if (minZero) mn = Math.min(0, mn);
  const tk = ticksFor(mn, mx), y0 = tk[0], y1 = tk[tk.length - 1];
  const n = labels.length, x = i => L + (n <= 1 ? (W - L - R) / 2 : i * (W - L - R) / (n - 1)), y = v => Tp + (1 - (v - y0) / (y1 - y0)) * (H - Tp - B);
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
  g += `<line class="cross" x1="0" x2="0" y1="${Tp}" y2="${H - B}"/>` + series.map((s, k) => `<circle class="hover-dot" data-k="${k}" r="4.5" fill="${s.color}"/>`).join('');
  g += `<rect class="hit" x="${L}" y="0" width="${W - L - R}" height="${H}" fill="transparent"/>`;
  CHARTS[id] = { labels, series, x, y, W, L, R, n, yfmt: tipfmt || yfmt, xfmt };
  return `<div class="chart" data-chart="${id}"><svg class="plot" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(series.map(s => s.name).join(', '))}">${g}</svg></div>`;
}
function bindCharts(root) {
  root.querySelectorAll('[data-chart]').forEach(el => {
    const c = CHARTS[el.dataset.chart]; if (!c) return; const svg = el.querySelector('svg'), hit = svg.querySelector('.hit');
    const move = ev => {
      const r = svg.getBoundingClientRect(), px = (ev.clientX - r.left) / r.width * c.W;
      const i = Math.max(0, Math.min(c.n - 1, Math.round((px - c.L) / ((c.W - c.L - c.R) / Math.max(1, c.n - 1)))));
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
const periodCtl = () => { const { from, to } = period(), mo = from.slice(0, 7); return `<div class="period" data-period><label>De <input type="date" data-p="from" value="${from}" min="${P_MIN()}" max="${P_MAX()}"></label><label>Até <input type="date" data-p="to" value="${to}" min="${P_MIN()}" max="${P_MAX()}"></label><label>Mês <input type="month" data-p="month" value="${mo === to.slice(0, 7) ? mo : ''}" min="${P_MIN().slice(0, 7)}" max="${P_MAX().slice(0, 7)}"></label><small>máx. 1 ano</small></div>`; };

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
    lineChart({ labels, series: [{ name: 'Necessidade', short: 'Necessidade', color: 'var(--s-need)', values: need }, { name: 'Compromisso', short: 'Compromisso', color: 'var(--s-comp)', values: comp }, { name: 'Realizado', short: 'Realizado', color: 'var(--s-real)', values: real, area: true }], height: 300, tipfmt: exact })
    + `<div class="legend"><span><i class="line-need"></i>Necessidade</span><span><i style="background:var(--s-comp)"></i>Compromisso</span><span><i></i>Realizado</span></div>`, rangeTabs);
  const c2 = card('Atingimento diário', 'Linha tracejada = 100%', lineChart({ labels, series: [{ name: '% Compromisso', short: '% Comp.', color: 'var(--s-real)', values: pc }, { name: '% Necessidade', short: '% Nec.', color: 'var(--s-need)', values: pn }], height: 240, width: 560, yfmt: v => pct(v, 0), tipfmt: v => pct(v), ref: 1 })
    + `<div class="legend"><span><i></i>% Compromisso</span><span><i class="line-need"></i>% Necessidade</span></div>`);
  const c3 = card('Fila total', 'Estoque de ordens em aberto (D0 de cada bloco)', lineChart({ labels, series: [{ name: 'Fila', short: 'Fila', color: 'var(--s-comp)', values: q, area: true }], height: 240, width: 560, tipfmt: exact }));
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
    lineChart({ labels, series: [{ name: 'Fila', short: 'Fila', color: 'var(--s-real)', values: ds.map(d => get(d, 'queue', e, tt)), area: true }, { name: 'Estoque máximo', short: 'Estoque máx.', color: 'var(--s-need)', values: ds.map(d => get(d, 'queue', e, tt) == null ? null : get(d, 'emax', e, tt)), dash: true }], height: 280, width: 560, tipfmt: exact })
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
  const monthTabs = `<div style="display:flex;gap:8px;flex-wrap:wrap">${tabs('service', [['Ativação', 'Ativação'], ['Retirada', 'Retirada']], S.service)}<select class="month-select" id="f-month" style="border:1px solid var(--line-strong);background:var(--surface-2);border-radius:10px;padding:5px 10px;font-weight:650">${monthRecs().slice().reverse().map(r => `<option value="${r.month}" ${r.month === m.month ? 'selected' : ''}>${fMonth(r.month)} · ${r.sheet}</option>`).join('')}</select></div>`;
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
    lineChart({ labels: m.dates, series: [{ name: 'Meta acumulada', short: 'Meta', color: 'var(--s-need)', values: cumMeta }, { name: 'Realizado acumulado', short: 'Realizado', color: 'var(--s-real)', values: cumReal, area: true }, { name: 'Projeção', short: 'Projeção', color: 'var(--s-real)', values: projLine, dash: true }], height: 290, width: 560, tipfmt: exact })
    + `<div class="legend"><span><i class="line-need"></i>Meta acumulada</span><span><i></i>Realizado acumulado</span><span><i class="dash"></i>Projeção</span></div>`);
  const daily = card('Diário: meta × realizado × necessidade', 'Necessidade (forecast) = o que falta produzir por dia para fechar a meta', lineChart({ labels: m.dates, series: [{ name: 'Meta do dia', short: 'Meta', color: 'var(--s-need)', values: m.targetDay[e] }, { name: 'Realizado', short: 'Realizado', color: 'var(--s-real)', values: m.actualDay[e] }, { name: 'Necessidade (forecast)', short: 'Necessidade', color: 'var(--s-comp)', values: (m.forecastDay?.[e] || []).map((v, i) => i <= lastIdx ? null : v), dash: true }], height: 290, width: 560, tipfmt: exact })
    + `<div class="legend"><span><i class="line-need"></i>Meta do dia</span><span><i></i>Realizado</span><span><i class="dash" style="background:repeating-linear-gradient(90deg,var(--s-comp) 0 4px,transparent 4px 7px)"></i>Necessidade${fc != null ? ` · hoje ${n1(fc)}` : ''}</span></div>`);
  const cols = ati
    ? [['Meta', r => m.target[r]], ['Realizado', r => m.actual[r]], ['% realizado', r => ratio(m.actual[r], m.target[r]), 'p'], ['GAP vs curva', r => m.gapDay?.[r].reduce((a, v) => a + (v || 0), 0)], ['Projeção', r => m.projection[r]], ['% Cobertura', r => m.coverage[r], 'ps'], ['Nec. hoje', r => fi >= 0 ? m.forecastDay?.[r]?.[fi] : null], ['Efetividade', r => m.efetMonth?.[r], 'p'], ['Meta efet.', r => m.efetTarget?.[r], 'p']]
    : [['Base churn', r => m.churn?.[r]], [m.labels?.metaA || 'Meta A', r => m.metaA?.[r]], [m.labels?.metaB || 'Meta B', r => m.metaB?.[r]], ['Realizado', r => m.actual[r]], ['GAP vs curva', r => m.gapDay?.[r].reduce((a, v) => a + (v || 0), 0)], ['Projeção', r => m.projection[r]], ['Proj ÷ meta', r => ratio(m.projection[r], m.target[r]), 'ps'], ['Proj ÷ ' + (m.labels?.metaB || 'meta B'), r => m.pctMetaB?.[r], 'p'], ['Nec. hoje', r => fi >= 0 ? m.forecastDay?.[r]?.[fi] : null]];
  S.export = { name: `metas-${m.sheet}`, rows: scope(S.reg).map(r => Object.fromEntries([['Polo/regional', entName(r)], ...cols.map(([l, f]) => [l, f(r) ?? ''])])) };
  const table = card(`Metas por polo · ${fMonth(m.month)}`, `Valores da aba ${esc(m.sheet)}`,
    `<div class="table-wrap"><table><thead><tr><th>Polo / regional</th>${cols.map(c => `<th>${esc(c[0])}</th>`).join('')}</tr></thead><tbody>${scope(S.reg).map(r => `<tr class="lvl-${lvl(r)}"><td>${rowName(r)}</td>${cols.map(([l, f, k]) => { const v = f(r); return `<td>${k === 'ps' ? (v == null ? '—' : statusCell(pct(v), pctStatus(v))) : k === 'p' ? pct(v) : `<span data-tip="${esc(l + ': ' + exact(v))}">${n1(v)}</span>`}</td>` }).join('')}</tr>`).join('')}</tbody></table></div>`);
  const note = '';
  return `<div class="card" style="padding:12px 16px;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap"><div><b>${esc(m.service)} · ${fMonth(m.month)}</b> <span class="na">· ${m.dates.length} dias · ${lastIdx + 1} com realizado</span></div>${monthTabs}</div>${note}${k}<div class="grid g-2">${chart}${daily}</div>${table}`;
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
    lineChart({ labels: idx.map(i => C.dates[i]), series: [{ name: 'Comprometido', short: 'Comprometido', color: 'var(--s-comp)', values: idx.map(i => sum2(C.mopPlan[e][i], C.motPlan[e][i])) }, { name: 'Presente', short: 'Presente', color: 'var(--s-real)', values: idx.map(i => sum2(C.mopActual[e][i], C.motActual[e][i])), area: true }], height: 280, width: 560, tipfmt: exact })
    + `<div class="legend"><span><i style="background:var(--s-comp)"></i>HC comprometido</span><span><i></i>HC presente</span></div>`,
    '');
  const split = card('Próprio × terceiro', 'HC presente por tipo de mão de obra', lineChart({ labels: idx.map(i => C.dates[i]), series: [{ name: 'MOP (próprio)', short: 'MOP', color: 'var(--s-real)', values: idx.map(i => C.mopActual[e][i]) }, { name: 'MOT (terceiro)', short: 'MOT', color: 'var(--s-need)', values: idx.map(i => C.motActual[e][i]) }], height: 280, width: 560, tipfmt: exact }) + `<div class="legend"><span><i></i>MOP · próprio</span><span><i class="line-need"></i>MOT · terceiro</span></div>`);
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
    <div style="height:14px"></div>${card('Últimos 30 registros', 'Todos os serviços', lineChart({ labels: ds.map(d => d.date), series: [{ name: 'Necessidade', short: 'Nec.', color: 'var(--s-need)', values: ds.map(d => get(d, 'need', e, -1)) }, { name: 'Compromisso', short: 'Comp.', color: 'var(--s-comp)', values: ds.map(d => get(d, 'commit', e, -1)) }, { name: 'Realizado', short: 'Real.', color: 'var(--s-real)', values: ds.map(d => get(d, 'actual', e, -1)), area: true }], height: 230, width: 560, tipfmt: exact }))}`;
  bindCharts($('#drawer-body'));
  $('#drawer').classList.add('open'); $('#drawer').setAttribute('aria-hidden', 'false'); $('#drawer-close').focus();
}
function closeDetail() { $('#drawer').classList.remove('open'); $('#drawer').setAttribute('aria-hidden', 'true'); }

/* ------------------------------------------------------------------ render */
const VIEWS = {
  painel: ['Painel do dia', 'Necessidade, compromisso e realizado — dados do banco dw_fup', vPainel],
  evolucao: ['Evolução', 'Série histórica dos blocos diários do Compromissos D0', vEvolucao],
  estoque: ['Estoque & DU', 'Fila, dias úteis de estoque e estoque máximo por serviço', vEstoque],
  metas: ['Metas do mês', 'Ativação e Retirada: curva de meta, realizado, projeção e necessidade diária', vMetas],
  capacity: ['Capacity', 'Equipes próprias e terceiras: comprometido, confirmado e presente', vCapacity],
  conferencia: ['Conferência', 'Execução do robô e conferências automáticas do banco', vConferencia],
};
function render() {
  const [title, sub, fn] = VIEWS[S.view];
  document.title = `${title} · FUP`;
  $('#title').textContent = title; $('#subtitle').textContent = sub;
  $$('nav button').forEach(b => b.classList.toggle('active', b.dataset.view === S.view));
  $$('#f-reg button').forEach(b => b.setAttribute('aria-checked', String(+b.dataset.reg === S.reg)));
  const d0 = day(S.di), d1 = realizedDay();
  $('#f-period').innerHTML = periodCtl();
  $$('#f-period input').forEach(inp => inp.addEventListener('change', ev => ev.target.dataset.p === 'month' ? setMonth(ev.target.value) : setPeriod(ev.target.dataset.p, ev.target.value)));
  $('#context').innerHTML = `<span class="chip" data-tip="Dia(s) cujo realizado está sendo exibido">${d1?.n > 1 ? 'Realizado' : 'Realizado (D-1)'} <b>${d1 ? realLabel(d1) : '—'}</b></span><span class="chip" data-tip="Dia da necessidade, compromisso, fila e DU">D0 <b>${fShort(d0.date)}</b></span><span class="chip">${esc(scopeLabel())} · ${esc(typeLabel(S.type))}</span>`;
  S.export = null; chartSeq = 0; for (const k in CHARTS) delete CHARTS[k];
  const v = $('#view'); v.innerHTML = fn(); bindCharts(v);
  $('#export').disabled = !S.export;
  v.querySelectorAll('[data-tabs]').forEach(tb => tb.addEventListener('click', ev => {
    const b = ev.target.closest('button'); if (!b) return; const k = tb.dataset.tabs, val = b.dataset.k;
    if (k === 'matrix') S.matrix = val; else if (k === 'service') { S.service = val; }
    render();
  }));
  v.querySelectorAll('[data-ent]').forEach(el => el.addEventListener('click', () => openDetail(+el.dataset.ent)));
  $('#f-month')?.addEventListener('change', ev => { S.month = ev.target.value; render(); });
  const badgeEl = $('#nav-check');
  if (VAL) { const core = VAL.checks.filter(c => c.group !== 'Consistência'); const all = core.every(c => c.ok === c.total) && VAL.checks.every(c => (c.unexplained ?? 0) === 0); badgeEl.textContent = all ? '100%' : '!'; }
  history.replaceState(null, '', '#' + S.view);
}
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 2200); }

/* ------------------------------------------------------------------ init */
function init() {
  $('#f-type').innerHTML = `<option value="-1">Todos os serviços</option>` + T.map((t, i) => `<option value="${i}">${esc(t)}</option>`).join('');
  $('#f-type').addEventListener('change', ev => { S.type = +ev.target.value; render(); });
  $$('#f-reg button').forEach(b => b.addEventListener('click', () => { S.reg = +b.dataset.reg; render(); }));
  $$('nav button').forEach(b => b.addEventListener('click', () => { S.view = b.dataset.view; render(); window.scrollTo({ top: 0, behavior: 'smooth' }); }));
  $('#drawer-close').addEventListener('click', closeDetail);
  $('#drawer').addEventListener('click', ev => { if (ev.target.id === 'drawer') closeDetail(); });
  document.addEventListener('keydown', ev => {
    if (ev.key === 'Escape') { closeDetail(); document.body.classList.remove('present'); }
    if (ev.key.toLowerCase() === 'p' && !ev.target.closest('input,select,textarea') && !ev.ctrlKey && !ev.metaKey) togglePresent();
  });
  $('#present').addEventListener('click', togglePresent);
  $('#print').addEventListener('click', () => window.print());
  $('#theme').addEventListener('click', () => { const h = document.documentElement; h.dataset.theme = h.dataset.theme === 'dark' ? 'light' : 'dark'; try { localStorage.setItem('fup-theme', h.dataset.theme) } catch (e) { } render(); });
  $('#export').addEventListener('click', exportCSV);
  const h = location.hash.slice(1); if (VIEWS[h]) S.view = h;
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
