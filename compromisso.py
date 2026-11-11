"""Compromisso D0 pelo portal (substitui o lançamento manual na man_compromisso).

Regras:
· Dia de hoje (D0): abre depois que o robô grava a foto do dia (fat_snapshot_diario com os 63 polos × serviços: é dela que vem
  a necessidade) e trava às 09:00.
· Fim de semana (aba PLAN_FDS da planilha): a partir de quarta-feira já dá para lançar o sábado e o domingo seguintes; cada um
  trava às 09:00 do próprio dia. Sem foto ainda, a referência é a projeção de entrantes (média do mesmo dia da semana nas
  4 semanas anteriores, igual à aba Entrantes) e a semana passada; a necessidade aparece quando o robô rodar no dia.
· A trava vale para todos, inclusive administrador. O administrador pode prorrogar o dia de hoje para todos ou para um
  usuário (até HH:MM). Tudo é conferido aqui no servidor: o navegador só mostra.
· Grava só o que mudou (INSERT … ON DUPLICATE KEY UPDATE), com atualizado_por = "portal:<usuário>".
· Se outra pessoa salvou a mesma célula depois que a tela foi aberta, recusa e avisa (não sobrescreve no escuro).
· Toda alteração (de → para, quem, quando, dia do compromisso) e toda prorrogação vão para compromisso_log.jsonl. Só o
  administrador consulta.
Teste sem gravar no banco: FUP_COMPROMISSO_SECO=<arquivo.json> (grava nesse arquivo) e, só nesse modo, FUP_AGORA=AAAA-MM-DDTHH:MM.
"""
import datetime as dt, json, os, sys, threading
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'dw_fup'))
import conn  # noqa: E402
import auth  # noqa: E402
from db_portal import ENTR_FERIADOS  # noqa: E402  (feriados que a média de entrantes troca pelo dia seguinte)

HORA_TRAVA = dt.time(9, 0)
QUARTA = 2                                   # weekday() da quarta-feira: abre o sábado e o domingo seguintes
PASTA = auth.ARQ.parent                      # junto do usuarios.json (fora do git)
ARQ_LOG = PASTA / 'compromisso_log.jsonl'
ARQ_PRORROG = PASTA / 'compromisso_prorrogacoes.json'
SECO = os.environ.get('FUP_COMPROMISSO_SECO')  # modo teste: grava num arquivo, não no banco
MAX_VALOR = 100000
DIAS_SEM = ['segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado', 'domingo']
_lock = threading.Lock()


def agora():
    if SECO and os.environ.get('FUP_AGORA'):
        return dt.datetime.fromisoformat(os.environ['FUP_AGORA'])
    return dt.datetime.now()


def _num(v):
    return None if v is None else float(v) if isinstance(v, Decimal) else v


def _q(cur, sql, args=()):
    cur.execute(sql, args)
    return cur.fetchall()


# ------------------------------------------------------------------ prorrogações e log
def _prorrogacoes():
    try:
        return json.loads(ARQ_PRORROG.read_text(encoding='utf-8'))
    except FileNotFoundError:
        return {}


def _grava_json(arq, obj):
    tmp = arq.with_suffix('.tmp')
    tmp.write_text(json.dumps(obj, ensure_ascii=False, indent=1), encoding='utf-8')
    os.replace(tmp, arq)


def _log(registros):
    with open(ARQ_LOG, 'a', encoding='utf-8') as f:
        for r in registros:
            f.write(json.dumps(r, ensure_ascii=False) + '\n')


def log_periodo(de, ate):
    """Registros cujo dia do compromisso está entre de e ate (AAAA-MM-DD), mais recentes primeiro."""
    if not ARQ_LOG.exists():
        return []
    out = []
    with open(ARQ_LOG, encoding='utf-8') as f:
        for linha in f:
            try:
                r = json.loads(linha)
            except ValueError:
                continue
            if de <= r.get('data', '') <= ate:
                out.append(r)
    return sorted(out, key=lambda r: r['em'], reverse=True)


def limite(usuario, data):
    """Horário até quando o usuário pode lançar no dia `data` (09:00 ou a prorrogação maior)."""
    p = _prorrogacoes().get(data, {})
    horas = [HORA_TRAVA] + [dt.time.fromisoformat(h) for h in (p.get('todos'), p.get('usuarios', {}).get(usuario)) if h]
    return max(horas)


def prorrogar(admin, data, ate, usuario=None):
    """ate 'HH:MM' (None = cancela). usuario None = todos. Só o dia de hoje."""
    if data != agora().date().isoformat():
        return 'Só dá para prorrogar o dia de hoje.'
    if ate is not None:
        try:
            h = dt.time.fromisoformat(str(ate))
        except ValueError:
            return 'Horário inválido (use HH:MM).'
        if h <= HORA_TRAVA:
            return f'A prorrogação precisa ser depois das {HORA_TRAVA:%H:%M}.'
        ate = f'{h:%H:%M}'
    if usuario is not None:
        usuario = str(usuario).strip().lower()
        if not any(u['usuario'] == usuario for u in auth.listar()):
            return 'Usuário não encontrado.'
    with _lock:
        tudo = _prorrogacoes()
        p = tudo.setdefault(data, {'todos': None, 'usuarios': {}})
        if usuario is None:
            p['todos'] = ate
        elif ate is None:
            p['usuarios'].pop(usuario, None)
        else:
            p['usuarios'][usuario] = ate
        _grava_json(ARQ_PRORROG, tudo)
        _log([{'em': agora().isoformat(timespec='seconds'), 'usuario': admin, 'acao': 'prorrogacao', 'data': data,
               'para_quem': usuario or 'todos', 'ate': ate}])
    return None


# ------------------------------------------------------------------ quais dias podem ser lançados
def _fds(d):
    return d.weekday() >= 5


def datas_abertas(hoje):
    """Hoje + sábado/domingo seguintes quando já passou da quarta-feira daquela semana."""
    out = [hoje]
    for k in range(1, 5):
        d = hoje + dt.timedelta(k)
        if _fds(d) and hoje >= d - dt.timedelta(d.weekday() - QUARTA):
            out.append(d)
    return out


def _robo_ok(cur, d, n_celulas):
    foto = _q(cur, 'SELECT COUNT(*) FROM fat_snapshot_diario WHERE data_ref = %s', (d,))[0][0]
    ex = _q(cur, "SELECT status, fim FROM log_execucao WHERE data_ref = %s AND status IN ('OK','ALERTA') AND fim IS NOT NULL ORDER BY id DESC LIMIT 1", (d,))
    return (foto >= n_celulas and bool(ex)), (dict(status=ex[0][0], fim=ex[0][1].isoformat(timespec='seconds')) if ex else None)


def janela(cur, usuario, d, n_celulas):
    """Situação do dia d para o usuário: pode lançar? até quando? (sempre calculado no servidor)."""
    hoje = agora()
    data = d.isoformat()
    robo_ok, robo = _robo_ok(cur, d, n_celulas)
    lim = limite(usuario, data)
    fim = dt.datetime.combine(d, lim)
    if d == hoje.date():
        # dia útil: espera a necessidade do robô; sábado/domingo já vêm lançados desde quarta, então seguem abertos
        disponivel, motivo = (robo_ok or _fds(d)), None if (robo_ok or _fds(d)) else 'espera'
    elif d in datas_abertas(hoje.date()):
        disponivel, motivo = True, None
    else:
        disponivel, motivo = False, 'fora'
    travado = hoje >= fim
    return dict(data=data, diaSemana=DIAS_SEM[d.weekday()], tipo='hoje' if d == hoje.date() else 'fds', disponivel=disponivel, motivo=motivo,
                robo=robo, temNecessidade=robo_ok, hora=f'{HORA_TRAVA:%H:%M}', limite=f'{lim:%H:%M}', prorrogado=lim > HORA_TRAVA,
                travado=travado, restanteS=max(0, int((fim - hoje).total_seconds())))


# ------------------------------------------------------------------ leitura do banco
def _seco_ler():
    try:
        return json.loads(Path(SECO).read_text(encoding='utf-8'))
    except FileNotFoundError:
        return {}


def _atuais(cur, d):
    """{(cod, tipo): (valor, por, em)} do compromisso já gravado no dia."""
    out = {(c, t): (_num(v), por, em.isoformat(timespec='seconds') if em else None)
           for c, t, v, por, em in _q(cur, 'SELECT cod_ger, tipo, compromisso, atualizado_por, atualizado_em FROM man_compromisso WHERE data = %s', (d,))}
    if SECO:
        for k, r in _seco_ler().get(str(d), {}).items():
            c, t = k.split('|')
            out[(int(c), t)] = (r['v'], r['por'], r['em'])
    return out


def _proj_entrante(cur, d):
    """Média do entrante do mesmo dia da semana nas 4 semanas anteriores (feriado → dia seguinte), por polo × serviço.
    Entrante do dia x: aba ENTRANTE importada (leg_entrante_diario) ou foto da manhã seguinte (entr_d1 de x+1)."""
    dias = []
    for k in range(1, 5):
        x = d - dt.timedelta(7 * k)
        dias.append(x + dt.timedelta(1) if x.isoformat() in ENTR_FERIADOS else x)
    leg = {(x, c, t): _num(v) for x, c, t, v in _q(cur, 'SELECT data, cod_ger, tipo, SUM(entrante) FROM leg_entrante_diario WHERE data IN %s GROUP BY data, cod_ger, tipo', (tuple(dias),))}
    foto = {(x - dt.timedelta(1), c, t): _num(v) for x, c, t, v in
            _q(cur, 'SELECT data_ref, cod_ger, tipo, entr_d1 FROM fat_snapshot_diario WHERE data_ref IN %s', (tuple(x + dt.timedelta(1) for x in dias),))}
    out = {}
    for (x, c, t) in set(leg) | set(foto):
        out.setdefault((c, t), None)
    for (c, t) in out:
        vs = [leg.get((x, c, t)) if leg.get((x, c, t)) is not None else foto.get((x, c, t)) for x in dias]
        out[(c, t)] = sum(vs) / 4 if None not in vs else None
    return out


def _dimensoes(cur):
    polos = [dict(cod=c, sigla=s, regional=r, nome=n, nomeRegional=nr) for c, s, r, n, nr in
             _q(cur, 'SELECT cod_ger, sigla, regional, nome, nome_regional FROM dim_gerencia ORDER BY ordem')]
    tipos = [dict(tipo=t, nome=n, du=bool(du)) for t, n, du in _q(cur, 'SELECT tipo, nome_painel, tem_du FROM dim_tipo ORDER BY ordem')]
    return polos, tipos


def estado(u, data=None):
    """Tudo o que a tela precisa para o dia escolhido (padrão: hoje) + a lista de dias que dá para lançar."""
    hoje = agora()
    abertas = datas_abertas(hoje.date())
    try:
        d = dt.date.fromisoformat(data) if data else hoje.date()
    except ValueError:
        d = hoje.date()
    if d not in abertas:
        d = hoje.date()
    db = conn.destino()
    try:
        cur = db.cursor()
        polos, tipos = _dimensoes(cur)
        n = len(polos) * len(tipos)
        jan = janela(cur, u['usuario'], d, n)
        dias = [janela(cur, u['usuario'], x, n) for x in abertas]
        foto = {(c, t): dict(nec=_num(nv), fila=_num(f), du=_num(du), emax=_num(e)) for c, t, nv, f, du, e in
                _q(cur, 'SELECT cod_ger, tipo, necessidade, fila, du, emax FROM fat_snapshot_diario WHERE data_ref = %s', (d,))}
        atuais = _atuais(cur, d)
        proj = _proj_entrante(cur, d)
        # mesmo dia da semana anterior: compromisso e realizado (realizado do dia X = real_d1 da foto de X+1)
        d7 = d - dt.timedelta(7)
        comp7 = {(c, t): _num(v) for c, t, v in _q(cur, 'SELECT cod_ger, tipo, compromisso FROM man_compromisso WHERE data = %s', (d7,))}
        real7 = {(c, t): _num(v) for c, t, v in _q(cur, 'SELECT cod_ger, tipo, real_d1 FROM fat_snapshot_diario WHERE data_ref = %s', (d7 + dt.timedelta(1),))}
    finally:
        db.close()
    celulas = {}
    for p in polos:
        for t in tipos:
            k = (p['cod'], t['tipo'])
            a = atuais.get(k, (None, None, None))
            celulas[f"{p['cod']}|{t['tipo']}"] = dict(**foto.get(k, dict(nec=None, fila=None, du=None, emax=None)), proj=proj.get(k),
                                                     valor=a[0], por=a[1], em=a[2], comp7=comp7.get(k), real7=real7.get(k))
    out = dict(data=d.isoformat(), hoje=hoje.date().isoformat(), agora=hoje.isoformat(timespec='seconds'), janela=jan, dias=dias,
               polos=polos, tipos=tipos, celulas=celulas, semanaAnterior=d7.isoformat(), modoTeste=bool(SECO))
    if u['admin']:
        p = _prorrogacoes().get(hoje.date().isoformat(), {})
        out['prorrogacoes'] = dict(todos=p.get('todos'), usuarios=p.get('usuarios', {}))
        out['usuariosCompromisso'] = [x['usuario'] for x in auth.listar() if x['ativo'] and 'compromisso' in x['telas']]
    return out


# ------------------------------------------------------------------ gravação
def salvar(u, corpo):
    """corpo: {data, base: {"cod|tipo": valor carregado}, valores: {"cod|tipo": novo valor ou null}}.
    Retorna (resultado, None) ou (None, mensagem)."""
    hoje = agora()
    try:
        d = dt.date.fromisoformat(str(corpo.get('data')))
    except ValueError:
        return None, 'Dia inválido.'
    data = d.isoformat()
    if d not in datas_abertas(hoje.date()):
        return None, 'Esse dia não está aberto para lançamento (ou a tela está desatualizada: recarregue a página).'
    base, valores = corpo.get('base') or {}, corpo.get('valores') or {}
    if not isinstance(valores, dict) or not isinstance(base, dict) or len(valores) > 200:
        return None, 'Dados inválidos.'
    with _lock:
        db = conn.destino()
        try:
            cur = db.cursor()
            polos, tipos = _dimensoes(cur)
            jan = janela(cur, u['usuario'], d, len(polos) * len(tipos))
            if not jan['disponivel']:
                return None, 'A base de hoje ainda não foi atualizada pelo robô.'
            if jan['travado']:
                return None, f"Lançamento de {d:%d/%m} travado desde as {jan['limite']}. Peça uma prorrogação ao administrador."
            cods, tps = {p['cod'] for p in polos}, {t['tipo'] for t in tipos}
            atuais = _atuais(cur, d)
            mudancas, conflitos = [], []
            for k, v in valores.items():
                try:
                    c, t = k.split('|'); c = int(c)
                except ValueError:
                    return None, 'Dados inválidos.'
                if c not in cods or t not in tps:
                    return None, 'Dados inválidos.'
                if v is not None:
                    if isinstance(v, bool) or not isinstance(v, (int, float)) or v != int(v) or not 0 <= v <= MAX_VALOR:
                        return None, f'Valor inválido em {k}: use um número inteiro de 0 a {MAX_VALOR}.'
                    v = int(v)
                atual = atuais.get((c, t), (None,))[0]
                atual = None if atual is None else int(round(atual))
                if v == atual:
                    continue
                b = base.get(k)
                if (None if b is None else int(b)) != atual:  # alguém mudou essa célula depois que a tela foi aberta
                    conflitos.append((c, t, atual))
                    continue
                mudancas.append((c, t, atual, v))
            if conflitos:
                return None, 'Outra pessoa alterou ' + ', '.join(f'{c}/{t} (agora {a if a is not None else "vazio"})' for c, t, a in conflitos[:6]) + \
                    '. Recarregue a tela para ver os valores atuais; nada foi gravado.'
            por = f"portal:{u['usuario']}"[:60]
            if mudancas:
                if SECO:
                    tudo = _seco_ler(); dia = tudo.setdefault(data, {})
                    for c, t, _, v in mudancas:
                        dia[f'{c}|{t}'] = dict(v=v, por=por, em=hoje.isoformat(timespec='seconds'))
                    _grava_json(Path(SECO), tudo)
                else:
                    cur.executemany('''INSERT INTO man_compromisso (data, cod_ger, tipo, compromisso, atualizado_por) VALUES (%s,%s,%s,%s,%s)
                                       ON DUPLICATE KEY UPDATE compromisso = VALUES(compromisso), atualizado_por = VALUES(atualizado_por)''',
                                    [(data, c, t, v, por) for c, t, _, v in mudancas])
                    db.commit()
                _log([{'em': hoje.isoformat(timespec='seconds'), 'usuario': u['usuario'], 'acao': 'valor', 'data': data,
                       'cod': c, 'tipo': t, 'de': a, 'para': v} for c, t, a, v in mudancas])
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()
    return dict(gravadas=len(mudancas)), None
