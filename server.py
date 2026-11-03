"""Servidor local do portal FUP. Os dados vêm do banco dw_fup (db_portal.py), nunca de planilha:
/data.js e /validation.js são montados a partir do banco a cada abertura (cache curto)."""
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
import json, threading, time, traceback, webbrowser
from pathlib import Path
import db_portal

ROOT = Path(__file__).resolve().parent
PORT = 8765
CACHE_S = 60
_cache = {'t': 0, 'files': None}
_lock = threading.Lock()


def dados():
    """(data.js, validation.js) do banco; reaproveita por CACHE_S segundos."""
    with _lock:
        if _cache['files'] and time.time() - _cache['t'] < CACHE_S:
            return _cache['files']
        try:
            _cache['files'] = db_portal.js(*db_portal.build())
        except Exception as e:
            traceback.print_exc()
            msg = json.dumps(f'Não foi possível ler o banco dw_fup: {type(e).__name__}: {e}', ensure_ascii=False)
            return (f'window.PORTAL_DATA=null;window.PORTAL_ERROR={msg};', 'window.PORTAL_VALIDATION=null;')
        _cache['t'] = time.time()
        return _cache['files']


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT / 'dist'), **kwargs)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        super().end_headers()

    def log_message(self, fmt, *args):  # sem log de requisições no console
        pass

    def do_GET(self):
        path = self.path.split('?')[0]
        if path in ('/data.js', '/validation.js'):
            body = dados()[0 if path == '/data.js' else 1].encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/javascript; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()


if __name__ == '__main__':
    try:
        server = ThreadingHTTPServer(('127.0.0.1', PORT), Handler)
    except OSError:
        print(f'A porta {PORT} já está em uso: o portal provavelmente já está aberto em outra janela.')
        print(f'Use http://127.0.0.1:{PORT} ou feche a outra janela e tente de novo.')
        webbrowser.open(f'http://127.0.0.1:{PORT}')
        raise SystemExit(1)
    print(f'FUP disponível em http://127.0.0.1:{PORT} · dados do banco dw_fup · Ctrl+C para encerrar', flush=True)
    threading.Timer(1, lambda: webbrowser.open(f'http://127.0.0.1:{PORT}')).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.server_close()
