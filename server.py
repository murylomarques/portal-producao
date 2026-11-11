"""Servidor local do portal FUP. Os dados vêm do banco dw_fup (db_portal.py), nunca de planilha:
/data.js e /validation.js são montados a partir do banco a cada abertura (cache curto).
Acesso com login (auth.py): sem sessão só abrem a tela de login e os arquivos dela; cada usuário recebe só os dados
das telas liberadas para ele. Primeiro administrador: "Criar Admin.cmd"."""
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from http.cookies import SimpleCookie
import json, os, threading, time, traceback, webbrowser
from urllib.parse import parse_qs, urlsplit
from pathlib import Path
import auth, compromisso, db_portal, chat

ROOT = Path(__file__).resolve().parent
PORT = int(os.environ.get('FUP_PORTA') or 8765)  # FUP_PORTA: só para teste
CACHE_S = 60
COOKIE = 'fup_sess'
ORIGENS = (f'http://127.0.0.1:{PORT}', f'http://localhost:{PORT}')
# sem login só abrem a tela de login e o que ela carrega
PUBLICOS = {'/login', '/login.html', '/login.css', '/login.js', '/login3d.js', '/vendor/three/three.module.min.js', '/favicon.ico'}
CSP_LOGIN = ("default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
             "img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
_cache = {'t': 0, 'files': None, 'data': None, 'val': None, 'por_perfil': {}}
_lock = threading.Lock()


def dados():
    """(data.js, validation.js) do banco; reaproveita por CACHE_S segundos."""
    with _lock:
        if _cache['files'] and time.time() - _cache['t'] < CACHE_S:
            return _cache['files']
        try:
            data, validation = db_portal.build()
            _cache['files'], _cache['data'], _cache['val'] = db_portal.js(data, validation), data, validation
            _cache['por_perfil'] = {}
        except Exception as e:
            traceback.print_exc()
            msg = json.dumps(f'Não foi possível ler o banco dw_fup: {type(e).__name__}: {e}', ensure_ascii=False)
            return (f'window.PORTAL_DATA=null;window.PORTAL_ERROR={msg};', 'window.PORTAL_VALIDATION=null;')
        _cache['t'] = time.time()
        return _cache['files']


def filtrar(data, telas):
    """Tira do PORTAL_DATA o que só serve a telas não liberadas (os blocos diários são a base de todas e ficam)."""
    t = set(telas)
    d = dict(data)
    if 'mapa' not in t:
        d['mapa'] = None
    if 'metas' not in t:
        d['monthly'] = []
    if not t & {'capacity', 'resumo'}:
        d['capacity'] = {k: [] for k in data['capacity']}
    if not t & {'entrantes', 'backlog'}:
        d['entrante'] = None
    return d


def dados_usuario(u):
    """(data.js, validation.js) do usuário logado: só os dados das telas dele + window.PORTAL_USER."""
    base = dados()
    if not _cache.get('data'):
        return base
    perfil = tuple(u['telas'])
    with _lock:
        if perfil not in _cache['por_perfil']:
            dj, vj = db_portal.js(filtrar(_cache['data'], perfil), _cache['val'] if 'conferencia' in perfil else None)
            _cache['por_perfil'][perfil] = (dj, vj)
        dj, vj = _cache['por_perfil'][perfil]
    pub = {k: u[k] for k in ('usuario', 'nome', 'admin', 'telas')}
    return dj + f'window.PORTAL_USER={json.dumps(pub, ensure_ascii=False)};', vj


def dados_dict(u):
    """PORTAL_DATA do usuário como dict (para o assistente: ele só enxerga o que o usuário enxerga)."""
    dados()
    if not _cache.get('data'):
        raise RuntimeError('Não foi possível ler o banco dw_fup.')
    return filtrar(_cache['data'], u['telas'])


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT / 'dist'), **kwargs)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('X-Frame-Options', 'DENY')
        self.send_header('Referrer-Policy', 'no-referrer')
        if getattr(self, '_csp', None):
            self.send_header('Content-Security-Policy', self._csp)
        super().end_headers()

    def log_message(self, fmt, *args):  # sem log de requisições no console (e nunca de corpo/senha)
        pass

    # ---------------------------------------------------------------- utilidades
    def _token(self):
        c = SimpleCookie()
        try:
            c.load(self.headers.get('Cookie', ''))
        except Exception:
            return None
        return c[COOKIE].value if COOKIE in c else None

    def _usuario(self):
        return auth.usuario_da_sessao(self._token())

    def _json(self, code, obj, cookie=None):
        body = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        if cookie is not None:
            self.send_header('Set-Cookie', cookie)
        self.end_headers()
        self.wfile.write(body)

    def _js(self, texto):
        body = texto.encode('utf-8')
        self.send_response(200)
        self.send_header('Content-Type', 'application/javascript; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _param(self, nome):
        v = parse_qs(urlsplit(self.path).query).get(nome)
        return v[0][:20] if v else None

    def _redir(self, para):
        self.send_response(302)
        self.send_header('Location', para)
        self.send_header('Content-Length', '0')
        self.end_headers()

    def _corpo(self, limite=20000):
        """JSON do corpo, só da própria origem (outra página aberta no navegador não consegue postar aqui)."""
        origin = self.headers.get('Origin')
        if not self.headers.get('Content-Type', '').startswith('application/json') or (origin and origin not in ORIGENS):
            return None
        try:
            n = int(self.headers.get('Content-Length', 0))
            if n > limite:
                return None
            obj = json.loads(self.rfile.read(n) or b'{}')
            return obj if isinstance(obj, dict) else None
        except Exception:
            return None

    # ---------------------------------------------------------------- GET
    def do_GET(self):
        self._csp = None
        path = self.path.split('?')[0]
        if path in ('/login', '/login.html'):
            if self._usuario():
                return self._redir('/')
            self._csp = CSP_LOGIN
            self.path = '/login.html'
            return super().do_GET()
        if path == '/api/estado':  # a tela de login avisa quando ainda não há nenhum usuário criado
            return self._json(200, {'configurado': auth.existe_algum()})
        if path in PUBLICOS:
            return super().do_GET()
        u = self._usuario()
        if not u:
            if path in ('/', '/index.html'):
                return self._redir('/login')
            return self._json(401, {'erro': 'Sessão expirada. Entre de novo.'})
        if path in ('/data.js', '/validation.js'):
            return self._js(dados_usuario(u)[0 if path == '/data.js' else 1])
        if path == '/api/me':
            return self._json(200, u)
        if path == '/api/compromisso':
            if 'compromisso' not in u['telas']:
                return self._json(403, {'erro': 'Lançamento de compromisso não liberado para o seu usuário.'})
            return self._json(200, compromisso.estado(u, self._param('data')))
        if path == '/api/compromisso/log':
            if not u['admin']:
                return self._json(403, {'erro': 'Só administradores.'})
            hoje = compromisso.agora().date().isoformat()
            de, ate = (self._param('de') or hoje)[:10], (self._param('ate') or hoje)[:10]
            return self._json(200, {'de': de, 'ate': ate, 'registros': compromisso.log_periodo(de, ate)})
        if path == '/api/usuarios':
            if not u['admin']:
                return self._json(403, {'erro': 'Só administradores.'})
            return self._json(200, {'usuarios': auth.listar(), 'telas': auth.TELAS, 'senhaMin': auth.SENHA_MIN})
        super().do_GET()

    def do_HEAD(self):  # sem atalho que pule o login (o SimpleHTTPRequestHandler serviria cabeçalhos de qualquer arquivo)
        self.send_error(405)

    # ---------------------------------------------------------------- POST
    def do_POST(self):
        path = self.path.split('?')[0]
        body = self._corpo()
        if body is None:
            return self.send_error(403)
        if path == '/api/login':
            token, erro = auth.login(body.get('usuario'), body.get('senha'))
            if not token:
                return self._json(401, {'erro': erro})
            return self._json(200, {'ok': True}, cookie=f'{COOKIE}={token}; HttpOnly; SameSite=Strict; Path=/; Max-Age={auth.SESSAO_S}')
        if path == '/api/logout':
            auth.logout(self._token())
            return self._json(200, {'ok': True}, cookie=f'{COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0')
        u = self._usuario()
        if not u:
            return self._json(401, {'erro': 'Sessão expirada. Entre de novo.'})
        if path == '/api/senha':
            erro = auth.trocar_senha(u['usuario'], body.get('atual'), body.get('nova'))
            return self._json(400 if erro else 200, {'erro': erro} if erro else {'ok': True})
        if path in ('/api/usuarios', '/api/usuarios/excluir'):
            if not u['admin']:
                return self._json(403, {'erro': 'Só administradores.'})
            erro = auth.salvar(body, u['usuario']) if path == '/api/usuarios' else auth.excluir(body.get('usuario'), u['usuario'])
            return self._json(400 if erro else 200, {'erro': erro} if erro else {'ok': True, 'usuarios': auth.listar()})
        if path == '/api/compromisso':
            if 'compromisso' not in u['telas']:
                return self._json(403, {'erro': 'Lançamento de compromisso não liberado para o seu usuário.'})
            res, erro = compromisso.salvar(u, body)
            if erro:
                return self._json(409, {'erro': erro})
            with _lock:
                _cache['t'] = 0  # o portal passa a mostrar o compromisso novo na próxima leitura
            return self._json(200, {**res, 'estado': compromisso.estado(u, body.get('data'))})
        if path == '/api/compromisso/prorrogar':
            if not u['admin']:
                return self._json(403, {'erro': 'Só administradores.'})
            erro = compromisso.prorrogar(u['usuario'], body.get('data'), body.get('ate'), body.get('usuario'))
            return self._json(400 if erro else 200, {'erro': erro} if erro else {'ok': True, 'estado': compromisso.estado(u)})
        if path == '/chat':
            return self._chat(u, body)
        self.send_error(404)

    def _chat(self, u, body):
        """/chat: pergunta ao assistente; resposta em stream (text/event-stream). Só para quem tem a permissão 'chat'."""
        if 'chat' not in u['telas']:
            return self._json(403, {'erro': 'O assistente não está liberado para o seu usuário.'})
        try:
            sid, pergunta, tela = str(body['sid'])[:64], str(body['q']).strip()[:2000], str(body.get('tela', ''))[:300]
            assert sid and pergunta
        except Exception:
            return self.send_error(400)
        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream; charset=utf-8')
        self.end_headers()

        def emit(ev):
            self.wfile.write(f'data: {json.dumps(ev, ensure_ascii=False)}\n\n'.encode('utf-8'))
            self.wfile.flush()
        try:
            # conversa separada por usuário (o sid vem do navegador); dados só das telas dele
            chat.responder(f"{u['usuario']}:{sid}", pergunta, tela, lambda: dados_dict(u), emit)
        except (BrokenPipeError, ConnectionResetError):
            pass  # usuário fechou o chat no meio da resposta
        except Exception as e:
            traceback.print_exc()
            try:
                emit({'t': 'error', 'v': f'{type(e).__name__}: {e}'})
            except OSError:
                pass


if __name__ == '__main__':
    try:
        server = ThreadingHTTPServer(('127.0.0.1', PORT), Handler)
    except OSError:
        print(f'A porta {PORT} já está em uso: o portal provavelmente já está aberto em outra janela.')
        print(f'Use http://127.0.0.1:{PORT} ou feche a outra janela e tente de novo.')
        webbrowser.open(f'http://127.0.0.1:{PORT}')
        raise SystemExit(1)
    print(f'FUP disponível em http://127.0.0.1:{PORT} · dados do banco dw_fup · Ctrl+C para encerrar', flush=True)
    if not auth.existe_algum():
        print('Nenhum usuário criado ainda: rode "Criar Admin.cmd" para criar o primeiro administrador.', flush=True)
    if not os.environ.get('FUP_PORTA'):
        threading.Timer(1, lambda: webbrowser.open(f'http://127.0.0.1:{PORT}')).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.server_close()
