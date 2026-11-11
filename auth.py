"""Login do portal FUP: usuários, senhas, sessões e permissões por tela.

· Usuários em usuarios.json (mesma pasta; fora do git). Senha nunca é gravada: só o hash PBKDF2-SHA256 com sal próprio.
· Sessão no servidor (memória): o navegador só guarda um cookie aleatório HttpOnly. Reiniciar o servidor desloga todos.
· Permissão = lista de telas que o usuário vê (+ 'chat' para o assistente). Admin vê tudo e gerencia usuários.
· Tentativas erradas: 5 seguidas por usuário bloqueiam o login dele por 5 minutos (mensagem genérica, sem dizer o motivo).
· Dono do portal (campo "dono" no usuarios.json, o primeiro administrador): nenhum outro administrador consegue alterar,
  desativar ou excluir esse usuário; só ele mesmo.
Primeiro admin: python criar_admin.py (ou "Criar Admin.cmd").
"""
import hashlib, hmac, json, os, re, secrets, threading, time
from pathlib import Path

ARQ = Path(os.environ.get('FUP_USUARIOS') or Path(__file__).resolve().with_name('usuarios.json'))
ITER = 600_000          # PBKDF2-SHA256 (recomendação OWASP 2023)
SESSAO_S = 12 * 3600    # sessão expira em 12 h (e após 2 h sem uso)
OCIOSO_S = 2 * 3600
MAX_ERROS, BLOQUEIO_S = 5, 300
SENHA_MIN = 8

# telas que podem ser liberadas (id = chave do VIEWS no app.js); 'chat' = assistente "Pergunte ao FUP"
TELAS = [('resumo', 'Resumo'), ('entrantes', 'Entrantes'), ('backlog', 'Backlog'), ('mapa', 'Mapa'),
         ('metas', 'Metas do mês'), ('capacity', 'Capacity'), ('conferencia', 'Conferência'), ('compromisso', 'Compromisso D0 (lançar)'), ('chat', 'Pergunte ao FUP (assistente)')]
TELA_IDS = [t for t, _ in TELAS]
RE_USUARIO = re.compile(r'[a-z0-9._-]{3,40}')

_lock = threading.Lock()
_sessoes = {}   # token -> {usuario, criada, uso}
_erros = {}     # usuario -> [quantidade, bloqueado_ate]
_cache = {'mtime': None, 'dados': None}


# ------------------------------------------------------------------ arquivo de usuários
def _ler():
    try:
        mt = ARQ.stat().st_mtime_ns
    except FileNotFoundError:
        return {}
    if _cache['mtime'] != mt:
        _cache['dados'], _cache['mtime'] = json.loads(ARQ.read_text(encoding='utf-8')).get('usuarios', {}), mt
    return _cache['dados']


def _gravar(us):
    tmp = ARQ.with_suffix('.tmp')
    tmp.write_text(json.dumps({'usuarios': us}, ensure_ascii=False, indent=1), encoding='utf-8')
    os.replace(tmp, ARQ)
    _cache['mtime'] = None


def existe_algum():
    with _lock:
        return bool(_ler())


# ------------------------------------------------------------------ senha
def _hash(senha, sal):
    return hashlib.pbkdf2_hmac('sha256', senha.encode('utf-8'), sal, ITER).hex()


def _novo_hash(senha):
    sal = secrets.token_bytes(16)
    return {'alg': 'pbkdf2_sha256', 'iter': ITER, 'sal': sal.hex(), 'hash': _hash(senha, sal)}


def _confere(senha, h):
    calc = hashlib.pbkdf2_hmac('sha256', senha.encode('utf-8'), bytes.fromhex(h['sal']), h['iter']).hex()
    return hmac.compare_digest(calc, h['hash'])


_FALSO = _novo_hash(secrets.token_urlsafe(16))  # usuário inexistente: confere contra um hash qualquer (mesmo tempo de resposta)


def valida_senha(senha):
    if not isinstance(senha, str) or len(senha) < SENHA_MIN:
        return f'A senha precisa ter pelo menos {SENHA_MIN} caracteres.'
    if len(senha) > 200:
        return 'Senha longa demais.'
    return None


# ------------------------------------------------------------------ login / sessão
def login(usuario, senha):
    """(token, None) ou (None, mensagem). Mensagem nunca diz se o usuário existe."""
    usuario = str(usuario or '').strip().lower()[:40]
    senha = str(senha or '')[:200]
    agora = time.time()
    with _lock:
        n, ate = _erros.get(usuario, [0, 0])
        if ate > agora:
            return None, 'Muitas tentativas. Aguarde alguns minutos e tente de novo.'
        u = _ler().get(usuario)
    ok = _confere(senha, u['senha'] if u else _FALSO) and bool(u) and u.get('ativo', True)
    with _lock:
        if not ok:
            n = n + 1 if ate <= agora else 1
            _erros[usuario] = [0, agora + BLOQUEIO_S] if n >= MAX_ERROS else [n, 0]
            return None, 'Usuário ou senha inválidos.'
        _erros.pop(usuario, None)
        token = secrets.token_urlsafe(32)
        _sessoes[token] = {'usuario': usuario, 'criada': agora, 'uso': agora}
        for k in [k for k, s in _sessoes.items() if agora - s['criada'] > SESSAO_S or agora - s['uso'] > OCIOSO_S]:
            del _sessoes[k]
        return token, None


def logout(token):
    with _lock:
        _sessoes.pop(token, None)


def usuario_da_sessao(token):
    """Dados públicos do usuário logado (sem hash) ou None. Relê o arquivo: desativar/alterar vale na hora."""
    if not token:
        return None
    agora = time.time()
    with _lock:
        s = _sessoes.get(token)
        if not s or agora - s['criada'] > SESSAO_S or agora - s['uso'] > OCIOSO_S:
            _sessoes.pop(token, None)
            return None
        u = _ler().get(s['usuario'])
        if not u or not u.get('ativo', True):
            _sessoes.pop(token, None)
            return None
        s['uso'] = agora
        return _publico(s['usuario'], u)


def _publico(usuario, u):
    admin = bool(u.get('admin'))
    return {'usuario': usuario, 'nome': u.get('nome') or usuario, 'admin': admin, 'ativo': u.get('ativo', True),  # 'dono' não sai daqui (fica invisível)
            'telas': list(TELA_IDS) if admin else [t for t in TELA_IDS if t in u.get('telas', [])]}


def _derruba(usuario):
    for k in [k for k, s in _sessoes.items() if s['usuario'] == usuario]:
        del _sessoes[k]


# ------------------------------------------------------------------ administração (só admin chama)
def listar():
    with _lock:
        return [dict(_publico(k, u), criado=u.get('criado'), alterado=u.get('alterado')) for k, u in sorted(_ler().items())]


def salvar(dados, por):
    """Cria ou altera. dados: usuario, nome, admin, ativo, telas, senha (obrigatória ao criar; opcional ao alterar).
    Retorna None ou mensagem de erro."""
    usuario = str(dados.get('usuario', '')).strip().lower()
    if not RE_USUARIO.fullmatch(usuario):
        return 'Usuário: 3 a 40 caracteres, só letras minúsculas, números, ponto, hífen ou sublinhado.'
    nome = str(dados.get('nome', '')).strip()[:80] or usuario
    telas = [t for t in TELA_IDS if t in (dados.get('telas') or [])]
    admin, ativo, senha = bool(dados.get('admin')), bool(dados.get('ativo', True)), dados.get('senha') or None
    with _lock:
        us = dict(_ler())
        novo = usuario not in us
        if not novo and us[usuario].get('dono') and por != usuario:
            return 'Você não tem permissão para alterar este usuário.'
        if novo and not senha:
            return 'Defina a senha inicial do usuário.'
        if senha and (erro := valida_senha(senha)):
            return erro
        if not admin and not telas:
            return 'Marque pelo menos uma tela (ou deixe como administrador).'
        if usuario == por and (not admin or not ativo):
            return 'Você não pode tirar o seu próprio acesso de administrador nem se desativar.'
        u = dict(us.get(usuario, {}))
        u.update(nome=nome, admin=admin, ativo=ativo, telas=telas, alterado=time.strftime('%Y-%m-%dT%H:%M:%S'))
        if novo:
            u['criado'] = u['alterado']
        if senha:
            u['senha'] = _novo_hash(senha)
        us[usuario] = u
        if not any(x.get('admin') and x.get('ativo', True) for x in us.values()):
            return 'Precisa existir pelo menos um administrador ativo.'
        _gravar(us)
        if not ativo or senha:
            _derruba(usuario) if usuario != por else None
    return None


def excluir(usuario, por):
    usuario = str(usuario or '').strip().lower()
    with _lock:
        us = dict(_ler())
        if usuario not in us:
            return 'Usuário não encontrado.'
        if usuario == por:
            return 'Você não pode excluir o seu próprio usuário.'
        if us[usuario].get('dono'):
            return 'Você não tem permissão para excluir este usuário.'
        del us[usuario]
        if not any(x.get('admin') and x.get('ativo', True) for x in us.values()):
            return 'Precisa existir pelo menos um administrador ativo.'
        _gravar(us)
        _derruba(usuario)
    return None


def trocar_senha(usuario, atual, nova):
    with _lock:
        u = _ler().get(usuario)
    if not u or not _confere(str(atual or '')[:200], u['senha']):
        return 'Senha atual incorreta.'
    if erro := valida_senha(nova):
        return erro
    with _lock:
        us = dict(_ler())
        us[usuario] = dict(us[usuario], senha=_novo_hash(nova), alterado=time.strftime('%Y-%m-%dT%H:%M:%S'))
        _gravar(us)
    return None


def criar_admin(usuario, nome, senha):
    """Só para o criar_admin.py (linha de comando, no próprio computador)."""
    with _lock:
        us = dict(_ler())
    us_novo = {'usuario': usuario, 'nome': nome, 'admin': True, 'ativo': True, 'telas': TELA_IDS, 'senha': senha}
    if us:
        return 'Já existem usuários: crie os próximos pela tela Usuários do portal.'
    erro = salvar(us_novo, por=None)
    if not erro:
        with _lock:
            us = dict(_ler()); us[usuario] = dict(us[usuario], dono=True); _gravar(us)
    return erro
