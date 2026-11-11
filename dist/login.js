/* FUP · tela de login: formulário (independe da cena 3D) + carregamento tardio da cena.
   A senha só vai no corpo do POST /api/login (mesma origem); nada é gravado no navegador. Quem decide o acesso é o servidor. */
(() => {
  const $ = s => document.querySelector(s);
  const form = $('#form'), usuario = $('#usuario'), senha = $('#senha'), btn = $('#entrar'), erro = $('#erro'), status = $('#status');
  let ocupado = false;
  const cena = () => window.FUP_CENA;  // definida pelo login3d.js quando a cena carrega (pode nunca existir)
  // Servidor local: /api com cookie. Cópia do IQT (/fup-portal/login.html): API do Laravel; o token fica no navegador.
  const IQT = location.pathname.includes('/fup-portal/');
  const API = IQT ? (() => { try { const u = window.parent !== window && window.parent.FUP_DATA_URL; if (u) return u.replace(/\/dados$/, ''); } catch (e) { } return '/api/api/fup'; })() : '/api';

  // ---------------------------------------------------------------- estado do servidor (já existe usuário?)
  fetch(API + '/estado', { cache: 'no-store' }).then(r => r.json()).then(j => { if (!j.configurado) $('#aviso-config').hidden = false; }).catch(() => { });

  // ---------------------------------------------------------------- mostrar/ocultar senha e Caps Lock
  $('#olho').addEventListener('click', () => {
    const ver = senha.type === 'password';
    senha.type = ver ? 'text' : 'password';
    const b = $('#olho'); b.setAttribute('aria-pressed', String(ver)); b.setAttribute('aria-label', ver ? 'Ocultar senha' : 'Mostrar senha');
    b.querySelector('use').setAttribute('href', ver ? '#i-eye-off' : '#i-eye');
    senha.focus({ preventScroll: true });
  });
  const caps = ev => { if (ev.getModifierState) $('#caps').hidden = !ev.getModifierState('CapsLock'); };
  senha.addEventListener('keydown', caps); senha.addEventListener('keyup', caps);
  senha.addEventListener('blur', () => { $('#caps').hidden = true; });

  // ---------------------------------------------------------------- validação
  const campoErro = (input, msg) => {
    const c = input.closest('.campo'); c.classList.toggle('invalido', !!msg);
    input.setAttribute('aria-invalid', msg ? 'true' : 'false');
    c.querySelector('.erro-campo').textContent = msg || '';
  };
  [usuario, senha].forEach(i => i.addEventListener('input', () => { campoErro(i, ''); erro.hidden = true; }));
  const mostraErro = msg => {
    erro.querySelector('span').textContent = msg; erro.hidden = false;
    const p = $('.painel-in'); p.classList.remove('tremor'); void p.offsetWidth; p.classList.add('tremor');
  };

  // ---------------------------------------------------------------- envio
  form.addEventListener('submit', async ev => {
    ev.preventDefault();
    if (ocupado) return;  // sem duplo envio
    erro.hidden = true;
    const u = usuario.value.trim(), s = senha.value;
    campoErro(usuario, u ? '' : 'Informe o seu usuário.');
    campoErro(senha, s ? '' : 'Informe a sua senha.');
    if (!u || !s) { (u ? senha : usuario).focus(); return; }

    ocupado = true; btn.classList.add('ocupado'); btn.setAttribute('aria-busy', 'true'); btn.disabled = true;
    status.textContent = 'Verificando acesso…';
    cena()?.autenticando(true);
    const ctl = new AbortController(), limite = setTimeout(() => ctl.abort(), 20000);
    let r = null;
    try {
      r = await fetch(API + '/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ usuario: u, senha: s }), cache: 'no-store', credentials: 'same-origin', signal: ctl.signal });
    } catch (e) { r = null; }
    clearTimeout(limite);

    let token = null;
    if (r && r.ok && IQT) { try { token = (await r.json()).token; } catch (e) { token = null; } if (!token) r = null; }
    if (r && r.ok) {  // só aqui o acesso é dado como liberado (confirmação real do servidor)
      if (token) { try { localStorage.setItem('fup-token', token); } catch (e) { } }
      btn.classList.remove('ocupado'); btn.classList.add('feito'); status.textContent = 'Acesso liberado. Abrindo o portal…';
      senha.value = '';
      const espera = cena()?.sucesso?.() || Promise.resolve();
      document.body.classList.add('saindo');
      await Promise.race([espera, new Promise(ok => setTimeout(ok, 1400))]);
      location.replace(IQT ? 'index.html' : '/');
      return;
    }
    let msg = 'Não foi possível conectar ao servidor do portal. Confira se ele está aberto e tente de novo.';
    if (r) { try { msg = (await r.json()).erro || 'Usuário ou senha inválidos.'; } catch (e) { msg = 'Usuário ou senha inválidos.'; } }
    cena()?.autenticando(false); cena()?.erro?.();
    ocupado = false; btn.classList.remove('ocupado'); btn.removeAttribute('aria-busy'); btn.disabled = false;
    status.textContent = '';
    senha.value = ''; mostraErro(msg); senha.focus();
  });

  // ---------------------------------------------------------------- cena 3D: depois do formulário estar pronto, sem bloquear nada
  const temWebGL = () => { try { const c = document.createElement('canvas'); return !!(window.WebGL2RenderingContext && c.getContext('webgl2')) || !!c.getContext('webgl'); } catch (e) { return false; } };
  const semCena = () => document.body.classList.add('sem-cena');
  const carrega = () => {
    if (!temWebGL()) return semCena();
    import(new URL('login3d.js', document.baseURI).href).then(m => m.iniciar(document.getElementById('cena'))).catch(err => { console.warn('Cena 3D indisponível:', err && err.message); semCena(); });
  };
  document.body.classList.remove('carregando');
  if (matchMedia('(pointer: fine)').matches) usuario.focus({ preventScroll: true });  // no celular não abre o teclado sozinho
  if (document.readyState === 'complete') setTimeout(carrega, 60); else window.addEventListener('load', () => setTimeout(carrega, 60), { once: true });
})();
