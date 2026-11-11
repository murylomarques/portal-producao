/* FUP · assistente do portal (chat). Fala com /chat do server.py, que chama a API da Anthropic com os dados do dw_fup.
   Usa os helpers e o estado do app.js ($, $$, esc, icon, S, D, E, T, VIEWS, render, syncDi, closeDetail, scopeLabel, typeLabel, fBR).
   A conversa fica no servidor (sid). Modo apresentação: o assistente manda "cenas" (ação 'action') e o portal muda de tela,
   aproxima a cidade no mapa, destaca o polo e mostra uma legenda; cada cena vira um botão ▶ na resposta para rever. */
const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { } };
const CHAT = { sid: null, busy: false, open: false, show: lsGet('fup-chat-show') !== '0', capTimer: null };
const CHAT_SUGEST = ['Qual cidade está mais crítica hoje e por quê?', 'Por que o Desktop ficou abaixo do compromisso ontem?', 'Algum polo com tempo ruim amanhã e fila alta?', 'Como está a meta de Ativação do mês?'];
const chatNewSid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));

/** Markdown mínimo e seguro: escapa tudo e depois aplica negrito, itálico, código, links http(s) e listas. */
function chatMd(src) {
  const inline = s => esc(s)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, t, u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${t}</a>`)
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<i>$2</i>').replace(/`([^`]+)`/g, '<code>$1</code>');
  const out = []; let list = null;
  for (const line of String(src).split('\n')) {
    const m = line.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/);
    if (m) { if (!list) { list = []; } list.push(`<li>${inline(m[1])}</li>`); continue; }
    if (list) { out.push(`<ul>${list.join('')}</ul>`); list = null; }
    if (line.trim()) out.push(`<p>${inline(line.replace(/^#+\s*/, ''))}</p>`);
  }
  if (list) out.push(`<ul>${list.join('')}</ul>`);
  return out.join('');
}

function chatTela() {
  const v = VIEWS[S.view]?.[0] || S.view;
  const city = S.view === 'mapa' && S.mcity ? `; cidade selecionada ${D.mapa?.municipios.find(m => m.ibge === S.mcity)?.nome || S.mcity}` : '';
  return `tela ${v}; período do realizado ${S.from === S.to ? fBR(S.from) : fBR(S.from) + ' a ' + fBR(S.to)}; abrangência ${scopeLabel()}; serviço ${typeLabel(S.type)}${city}`;
}

/* ------------------------------------------------------------------ modo apresentação */
const presLabel = a => [VIEWS[a.view]?.[0], a.cityName, a.ent != null && E[a.ent] ? (E[a.ent].level === 'polo' ? `Polo ${E[a.ent].code} ${E[a.ent].name}` : E[a.ent].name) : null, a.type != null && a.type >= 0 ? T[a.type] : null].filter(Boolean).join(' · ');

/** Aplica uma cena: estado do portal + render + efeitos (zoom, destaque, legenda). manual = clique no botão ▶ da resposta. */
function presApply(a, manual = false) {
  if (!a || !VIEWS[a.view] || (!CHAT.show && !manual)) return;
  closeDetail(); if (typeof ppClose === 'function') ppClose();
  if (a.from) { S.from = a.from; S.to = a.to; S.month = null; syncDi(); }
  if (a.reg != null) S.reg = a.reg;
  if (a.type != null) { S.type = a.type; const sel = $('#f-type'); if (sel) sel.value = String(a.type); }
  S.view = a.view;
  if (a.matrix) S.matrix = a.matrix;
  if (a.month) S.month = a.month;
  if (a.service) S.service = a.service;
  if (a.view === 'mapa') {
    if (a.mday != null) S.mday = String(a.mday);
    S.mcity = a.city || null;
    if (a.city) {
      S.msit = 'all'; S.mrisk = 'all';  // a cidade tem de aparecer, qualquer que seja o filtro
      const m = D.mapa?.municipios.find(x => x.ibge === a.city);
      if (m && S.reg !== 12 && !(m.ger || '').startsWith(E[S.reg].code)) S.reg = 12;
    }
  }
  if ($('#chat').classList.contains('wide')) chatWide(false, false);  // o site precisa aparecer
  render();
  const v = $('#view'); v.classList.remove('pres-enter'); void v.offsetWidth; v.classList.add('pres-enter');
  window.scrollTo({ top: 0, behavior: 'smooth' });
  presCaption(a);
  requestAnimationFrame(() => setTimeout(() => { if (a.city) presZoom(a.city); if (a.ent != null) presSpot(a.ent); }, 120));
}

/** Legenda fixa no rodapé do site (estilo "apresentador"). */
function presCaption(a) {
  let el = $('#pres-cap');
  if (!el) { document.body.insertAdjacentHTML('beforeend', '<div class="pres-cap" id="pres-cap" role="status"></div>'); el = $('#pres-cap'); }
  el.innerHTML = `<div class="pres-cap-in"><span class="pres-live">Apresentando</span><b>${esc(presLabel(a))}</b>${a.cap ? `<span class="pres-cap-txt">${esc(a.cap)}</span>` : ''}<button type="button" class="pres-cap-x" aria-label="Fechar legenda">${icon('i-close')}</button></div>`;
  el.querySelector('.pres-cap-x').addEventListener('click', presCaptionHide);
  el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
  clearTimeout(CHAT.capTimer);
  if (!CHAT.busy) CHAT.capTimer = setTimeout(presCaptionHide, 9000);
}
function presCaptionHide() { $('#pres-cap')?.classList.remove('show'); }

/** Aproxima o mapa da cidade (anima o viewBox) e marca com anéis pulsando. */
function presZoom(ib) {
  const svg = $('.mp-svg'), m = D.mapa?.municipios.find(x => x.ibge === ib);
  if (!svg || !m) return;
  const [x0, y0, w0, h0] = svg.getAttribute('viewBox').split(/\s+/).map(Number);
  const w1 = Math.min(w0, Math.max(110, w0 * 0.34)), h1 = w1 * h0 / w0, x1 = m.x - w1 / 2, y1 = m.y - h1 / 2;
  const ease = t => t < .5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2, t0 = performance.now(), dur = 1300;
  const step = now => {
    if (!svg.isConnected) return;
    const k = ease(Math.min(1, (now - t0) / dur));
    svg.setAttribute('viewBox', `${x0 + (x1 - x0) * k} ${y0 + (y1 - y0) * k} ${w0 + (w1 - w0) * k} ${h0 + (h1 - h0) * k}`);
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
  const NS = 'http://www.w3.org/2000/svg', r = w1 / 16;
  [0, 1].forEach(i => { const c = document.createElementNS(NS, 'circle'); c.setAttribute('cx', m.x); c.setAttribute('cy', m.y); c.setAttribute('r', r); c.setAttribute('class', 'pres-ring'); c.style.animationDelay = `${0.6 + i * 0.9}s`; svg.appendChild(c); });
  svg.querySelector(`.mp-city[data-ib="${ib}"]`)?.classList.add('pres-sel');
  svg.closest('.mp-map')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/** Destaca o polo/regional nas tabelas e cartões da tela. */
function presSpot(e) {
  const els = $$(`#view [data-ent="${e}"]`);
  if (!els.length) return;
  els.forEach(el => el.classList.add('pres-hl'));
  els[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
}

/* ------------------------------------------------------------------ painel do chat */
function chatDock() { document.body.classList.toggle('chat-dock', CHAT.open && !$('#chat').classList.contains('wide')); }

function chatToggle(open = !CHAT.open) {
  CHAT.open = open;
  $('#chat').classList.toggle('open', open);
  $('#chat-fab').setAttribute('aria-expanded', open);
  chatDock();
  if (open) setTimeout(() => $('#chat-q').focus(), 50); else presCaptionHide();
}

/** Tamanho do chat: normal (painel lateral) ou expandido (quase a tela toda); lembrado no navegador. */
function chatWide(on, persist = true) {
  $('#chat').classList.toggle('wide', on);
  const b = $('#chat-wide'), l = on ? 'Reduzir' : 'Expandir';
  b.innerHTML = `<svg><use href="#${on ? 'i-shrink' : 'i-expand'}"/></svg>`; b.title = l; b.setAttribute('aria-label', l);
  if (persist) lsSet('fup-chat-wide', on ? '1' : '0');
  chatDock();
}

function chatShow(on) {
  CHAT.show = on; lsSet('fup-chat-show', on ? '1' : '0');
  const b = $('#chat-show');
  b.classList.toggle('on', on); b.setAttribute('aria-pressed', on);
  b.title = `Apresentar no portal enquanto responde: ${on ? 'ligado' : 'desligado'}`;
  if (!on) presCaptionHide();
}

function chatReset() {
  if (CHAT.busy) return;
  CHAT.sid = chatNewSid();
  presCaptionHide();
  $('#chat-log').innerHTML = `<div class="chat-hello"><b>Pergunte sobre o portal.</b> Respondo com os dados do dw_fup, as ocorrências registradas e, quando ajuda, notícias da web sobre as cidades. Enquanto explico, mostro no portal: abro a aba, aproximo a cidade no mapa e destaco o polo.
    <div class="chat-sug">${CHAT_SUGEST.map(s => `<button type="button">${esc(s)}</button>`).join('')}</div></div>`;
  $$('#chat-log .chat-sug button').forEach(b => b.addEventListener('click', () => chatSend(b.textContent)));
}

async function chatSend(q) {
  q = String(q || '').trim();
  if (!q || CHAT.busy) return;
  CHAT.busy = true; $('#chat-send').disabled = true; clearTimeout(CHAT.capTimer);
  const log = $('#chat-log');
  log.querySelector('.chat-hello')?.remove();
  log.insertAdjacentHTML('beforeend', `<div class="msg user">${esc(q)}</div><div class="msg bot"><div class="chat-status">Lendo os dados do portal…</div><div class="chat-body"></div><div class="chat-src"></div></div>`);
  const bot = log.lastElementChild, body = bot.querySelector('.chat-body'), status = bot.querySelector('.chat-status'), src = bot.querySelector('.chat-src');
  const parts = [];  // trechos de texto e cenas, na ordem em que chegaram
  const draw = () => { body.innerHTML = parts.map((p, i) => p.a ? `<button class="pres-chip" type="button" data-scene="${i}" title="Mostrar de novo no portal">${icon('i-present')}<span>${esc(presLabel(p.a))}</span></button>` : chatMd(p.s)).join(''); };
  body.addEventListener('click', ev => { const b = ev.target.closest('[data-scene]'); if (b) presApply(parts[+b.dataset.scene].a, true); });
  const scroll = () => { log.scrollTop = log.scrollHeight; };
  scroll();
  let fontes = 0;
  try {
    const r = await fetch('/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sid: CHAT.sid, q, tela: chatTela() }) });
    if (!r.ok || !r.body) throw new Error(r.status === 404 || r.status === 501 ? 'O servidor do portal está desatualizado: feche a janela do Iniciar Portal e abra de novo.' : `HTTP ${r.status}`);
    const reader = r.body.getReader(), dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 2);
        if (!line.startsWith('data: ')) continue;
        const ev = JSON.parse(line.slice(6));
        if (ev.t === 'text') { const last = parts.at(-1); if (last && !last.a) last.s += ev.v; else parts.push({ s: ev.v }); draw(); status.textContent = ''; }
        else if (ev.t === 'action') { parts.push({ a: ev.a }); draw(); presApply(ev.a); }
        else if (ev.t === 'status') status.textContent = ev.v;
        else if (ev.t === 'source' && fontes < 8) {
          let host = ''; try { host = new URL(ev.url).hostname.replace(/^www\./, ''); } catch (e) { continue; }
          if (!fontes++) src.innerHTML = '<span>Fontes consultadas</span>';
          src.insertAdjacentHTML('beforeend', `<a href="${esc(ev.url)}" target="_blank" rel="noopener noreferrer" title="${esc(ev.title)}">${esc(host)}</a>`);
        }
        else if (ev.t === 'error') throw new Error(ev.v);
        scroll();
      }
    }
    if (!parts.some(p => p.s)) body.insertAdjacentHTML('beforeend', '<p>Sem resposta. Tente reformular a pergunta.</p>');
  } catch (e) {
    body.insertAdjacentHTML('beforeend', `<p class="chat-err">${esc(e.message || e)}</p>`);
  } finally {
    status.remove();
    CHAT.busy = false; $('#chat-send').disabled = false; scroll();
    if ($('#pres-cap')?.classList.contains('show')) CHAT.capTimer = setTimeout(presCaptionHide, 9000);
  }
}

function chatInit() {
  document.body.insertAdjacentHTML('beforeend', `
  <button class="chat-fab" id="chat-fab" type="button" aria-controls="chat" aria-expanded="false" title="Assistente do portal"><svg><use href="#i-chat"/></svg><span>Pergunte ao FUP</span></button>
  <section class="chat" id="chat" role="dialog" aria-label="Assistente do portal">
    <header><div><div class="eyebrow">Assistente · Claude</div><h2>Pergunte ao FUP</h2></div>
      <div class="chat-actions"><button class="btn ghost" id="chat-new" type="button">Nova conversa</button><button class="icon-btn" id="chat-show" type="button" aria-label="Apresentar no portal"><svg><use href="#i-present"/></svg></button><button class="icon-btn" id="chat-wide" type="button" aria-label="Expandir" title="Expandir"><svg><use href="#i-expand"/></svg></button><button class="icon-btn" id="chat-close" type="button" aria-label="Fechar"><svg><use href="#i-close"/></svg></button></div></header>
    <div class="chat-log" id="chat-log" aria-live="polite"></div>
    <form class="chat-form" id="chat-form"><textarea id="chat-q" rows="1" maxlength="2000" placeholder="Ex.: por que Jundiaí ficou tão fora?" aria-label="Pergunta"></textarea><button class="btn primary" id="chat-send" type="submit">Enviar</button></form>
    <p class="chat-foot">Respostas geradas por IA a partir dos dados do portal; notícias da web não são causa confirmada.</p>
  </section>`);
  $('#chat-fab').addEventListener('click', () => chatToggle());
  $('#chat-close').addEventListener('click', () => chatToggle(false));
  $('#chat-new').addEventListener('click', chatReset);
  $('#chat-wide').addEventListener('click', () => chatWide(!$('#chat').classList.contains('wide')));
  $('#chat-show').addEventListener('click', () => chatShow(!CHAT.show));
  if (lsGet('fup-chat-wide') === '1') chatWide(true);
  chatShow(CHAT.show);
  const q = $('#chat-q');
  $('#chat-form').addEventListener('submit', ev => { ev.preventDefault(); const v = q.value; q.value = ''; q.style.height = ''; chatSend(v); });
  q.addEventListener('keydown', ev => { if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); $('#chat-form').requestSubmit(); } if (ev.key === 'Escape') chatToggle(false); });
  q.addEventListener('input', () => { q.style.height = ''; q.style.height = Math.min(q.scrollHeight, 140) + 'px'; });
  chatReset();
}
// com login, o assistente só aparece para quem tem a permissão 'chat' (o servidor também recusa /chat sem ela)
if (typeof window !== 'undefined' && window.PORTAL_DATA && !(window.PORTAL_USER && !window.PORTAL_USER.telas.includes('chat'))) chatInit();
