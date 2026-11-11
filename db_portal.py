"""Monta os dados do portal (mesma estrutura de window.PORTAL_DATA) a partir do banco dw_fup.

Fonte única: tabelas/views do dw_fup gravadas pelo robô (dw_fup/robo.py) e as tabelas man_* (manuais).
Bloco do dia X (igual ao Compromissos D0 da planilha):
  fila, DU, estoque máximo, entrante médio, necessidade = foto D0 de X (fat_snapshot_diario)
  compromisso = man_compromisso de X
  realizado   = real_d1 da foto de X+1 (foto da manhã seguinte); sem essa foto, a base atual (fat_producao_diaria)
"""
import datetime as dt, json, sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'dw_fup'))
import conn  # noqa: E402
from extract import ENTITIES, TYPES  # noqa: E402

ENT_CODE = ['CE', 'CE01', 'CE02', 'CE03', 'CO', 'CO01', 'CO02', 'CO03', 'SE', 'SE01', 'SE02', 'SE03', 'DESKTOP']
TIPOS = ['REPARO', 'ATIVACAO', 'MUD_END', 'PREV', 'OUTROS', 'CHIP', 'RETIRADA']
# feriados que a aba ENTRANTE troca pelo dia seguinte nas médias de 4 semanas (só os que a planilha troca: 02/11 ela mantém)
ENTR_FERIADOS = ['2026-10-12']
MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
EI = {c: i for i, c in enumerate(ENT_CODE)}
TI = {t: i for i, t in enumerate(TIPOS)}


def f(v):
    return None if v is None else round(float(v), 6)


def blank(n):
    return [[None] * n for _ in ENT_CODE]


def ratio(a, b):
    return a / b if a is not None and b else None


def q(cur, sql, args=()):
    cur.execute(sql, args)
    return cur.fetchall()


def build():
    db = conn.destino()
    cur = db.cursor()
    P = {k: float(v) for k, v in q(cur, 'SELECT chave, valor FROM man_parametro')}
    target = [P.get(f'META_DU_{t}') for t in TIPOS[:6]]

    snap = defaultdict(dict)  # data -> {(e, t): row}
    for r in q(cur, 'SELECT data_ref, entidade, tipo, fila, du, estoque_maximo, entrante_medio_d0, necessidade, realizado_d1 FROM vw_bloco_diario'):
        snap[r[0]][(EI[r[1]], TI[r[2]])] = r[3:]
    vendas = defaultdict(dict)  # data da foto -> {e: entrante de ativação D-1} (vendas da aba Ati)
    entr_foto = defaultdict(dict)  # data da foto -> {(e, t): entrante D-1 congelado}
    for d, e, t, v in q(cur, '''SELECT s.data_ref, e.entidade, s.tipo, SUM(s.entr_d1) FROM fat_snapshot_diario s
                                JOIN vw_entidade e ON e.cod_ger = s.cod_ger GROUP BY s.data_ref, e.entidade, s.tipo'''):
        entr_foto[d][(EI[e], TI[t])] = v
        if t == 'ATIVACAO':
            vendas[d][EI[e]] = v
    leg_entr = defaultdict(dict)  # aba ENTRANTE da planilha (até 02/11/2026)
    for d, e, t, v in q(cur, '''SELECT l.data, e.entidade, l.tipo, SUM(l.entrante) FROM leg_entrante_diario l
                                JOIN vw_entidade e ON e.cod_ger = l.cod_ger GROUP BY l.data, e.entidade, l.tipo'''):
        leg_entr[d][(EI[e], TI[t])] = v
    leg_vendas = defaultdict(dict)
    for d, e, v in q(cur, 'SELECT data, entidade, vendas FROM leg_vendas_ati'):
        leg_vendas[d][EI[e]] = v
    leg_media = defaultdict(dict)  # média de instalação colada no bloco do Compromissos D0 (denominador do EFETIV da planilha)
    for d, e, v in q(cur, 'SELECT data, entidade, media FROM leg_media_inst'):
        leg_media[d][EI[e]] = v

    def vendas_dia(x, e):  # vendas (entrante de ativação congelado) do dia x: aba Ati onde a planilha cobre, senão a foto da manhã seguinte
        v = leg_vendas.get(x, {}).get(e)
        return f(v if v is not None else vendas.get(x + dt.timedelta(1), {}).get(e))
    commit = defaultdict(dict)
    for d, e, t, v in q(cur, '''SELECT c.data, e.entidade, c.tipo, SUM(c.compromisso) FROM man_compromisso c
                                JOIN vw_entidade e ON e.cod_ger = c.cod_ger GROUP BY c.data, e.entidade, c.tipo'''):
        commit[d][(EI[e], TI[t])] = v
    hc, hcconf = defaultdict(dict), defaultdict(dict)
    for d, e, a, b, ca, cb in q(cur, '''SELECT h.data, e.entidade, SUM(h.hc_proprio), SUM(h.hc_terceiro), SUM(h.hc_conf_proprio), SUM(h.hc_conf_terceiro) FROM man_hc_compromisso h
                                JOIN vw_entidade e ON e.cod_ger = h.cod_ger GROUP BY h.data, e.entidade'''):
        if a is not None or b is not None:
            hc[d][EI[e]] = [f(a), f(b)]
        if ca is not None or cb is not None:  # HC confirmado COP informado pelas regionais
            hcconf[d][EI[e]] = [f(ca), f(cb)]
    live, entrante = defaultdict(dict), defaultdict(dict)
    for d, e, t, v, en in q(cur, '''SELECT p.data, e.entidade, p.tipo, SUM(p.realizado), SUM(p.entrante) FROM fat_producao_diaria p
                                    JOIN vw_entidade e ON e.cod_ger = p.cod_ger GROUP BY p.data, e.entidade, p.tipo'''):
        live[d][(EI[e], TI[t])] = v
        entrante[d][(EI[e], TI[t])] = en

    # dias: fotos D0 e o dia anterior de cada foto (para o realizado D-1 do painel)
    dates = sorted(set(snap) | {d - dt.timedelta(1) for d in snap})
    days = []
    for d in dates:
        S, nxt = snap.get(d, {}), snap.get(d + dt.timedelta(1), {})
        day = dict(date=d.isoformat(), col='foto ' + d.strftime('%d/%m') if S else '—', layout=7, target=target)
        for key in ('du', 'queue', 'emax', 'entrAvg', 'need', 'commit', 'actual'):
            day[key] = blank(8)
        for (e, t), (fila, du, emax, entr, nec, _) in S.items():
            day['queue'][e][t] = f(fila) if t < 6 else None
            day['du'][e][t] = f(du) if t < 6 else None
            day['emax'][e][t] = f(emax) if t < 6 else None
            day['entrAvg'][e][t] = f(entr)
            day['need'][e][t] = f(nec)
        for (e, t), v in commit.get(d, {}).items():
            day['commit'][e][t] = f(v)
        for e in range(13):
            for t in range(7):
                if (e, t) in nxt:
                    day['actual'][e][t] = f(nxt[(e, t)][5])
                elif (e, t) in live.get(d, {}):
                    day['actual'][e][t] = f(live[d][(e, t)])
            for key in ('need', 'commit', 'actual'):
                vals = [day[key][e][t] for t in range(7)]
                day[key][e][7] = round(sum(v for v in vals if v is not None), 6) if any(v is not None for v in vals) else None
        day['pctCommit'] = [[ratio(day['actual'][e][t], day['commit'][e][t]) for t in range(8)] for e in range(13)]
        day['pctNeed'] = [[ratio(day['actual'][e][t], day['need'][e][t]) for t in range(8)] for e in range(13)]
        day['pctCommitNeed'] = [[ratio(day['commit'][e][t], day['need'][e][t]) for t in range(8)] for e in range(13)]
        # EFETIV = compromisso de instalação ÷ entrante médio de instalação (conferido 767/780 com a planilha).
        # REAL = efetividade do dia da aba Ati (realizado de ativação ÷ vendas = entrante de ativação), que a planilha colava;
        # mesma origem do realizado: foto da manhã seguinte, sem ela a base atual. COBERT = real ÷ comprometida.
        # Regra conferida contra a efetividade colada: 2.988/3.601 (decidido em 05/11/2026).
        # EFETIV = compromisso de instalação ÷ média das vendas do mesmo dia da semana nas 4 semanas anteriores (igual à planilha:
        # 2.735/3.224 no histórico); sem as 4 semanas, o entrante médio da foto.
        # A média colada no bloco do dia (leg_media_inst) vale sobre a calculada, para bater com a planilha mesmo quando ela
        # foge da regra (09/11/2026 usou a terça 13/10 no lugar da segunda 12/10; decidido em 10/11/2026).
        V = vendas.get(d + dt.timedelta(1)) or {e: entrante[d].get((e, 1)) for e in range(13) if (e, 1) in entrante.get(d, {})}
        day['efet'], day['efetParts'] = [], []  # partes [compromisso inst, média vendas, realizado inst, vendas]: consolidado de fim de semana
        day['efetSrc'] = 'planilha' if len(leg_media.get(d, {})) == 13 else 'calculada'
        for e in range(13):
            sem = [vendas_dia(d - dt.timedelta(7 * k), e) for k in range(1, 5)]
            base = sum(sem) / 4 if None not in sem else day['entrAvg'][e][1]
            if leg_media.get(d, {}).get(e) is not None:
                base = f(leg_media[d][e])
            ef, real = ratio(day['commit'][e][1], base), ratio(day['actual'][e][1], f(V.get(e)))
            day['efet'].append([ef, real, ratio(real, ef)])
            day['efetParts'].append([day['commit'][e][1], base, day['actual'][e][1], f(V.get(e))])
        if hc.get(d):
            day['hcCommit'] = [hc[d].get(e, [None, None]) for e in range(13)]
        days.append(day)

    # curva mensal
    mens = defaultdict(lambda: defaultdict(dict))
    for mes, svc, d, ent, peso, md, real, fc in q(cur, 'SELECT mes, servico, data, entidade, peso, meta_dia, realizado, forecast FROM vw_mensal ORDER BY data'):
        mens[(mes, svc)][d][EI[ent]] = (f(peso), f(md), f(real), f(fc))
    metas = {(m, s, EI[e]): (f(a), f(b)) for m, s, e, a, b in q(cur, '''SELECT mm.mes, mm.servico, e.entidade, SUM(mm.meta_mes), SUM(mm.churn_base)
        FROM man_meta_mensal mm JOIN vw_entidade e ON e.cod_ger = mm.cod_ger GROUP BY mm.mes, mm.servico, e.entidade''')}
    # meta de efetividade de Ativação: polos em man_meta_mensal; regionais e Desktop digitados à parte (não são a média dos polos)
    meta_efet = {(m, EI[e]): f(v) for m, e, v in q(cur, '''SELECT mm.mes, g.sigla, mm.meta_efetividade FROM man_meta_mensal mm
        JOIN dim_gerencia g ON g.cod_ger = mm.cod_ger WHERE mm.servico = 'ATIVACAO' AND mm.meta_efetividade IS NOT NULL''')}
    meta_efet.update({(m, EI[e]): f(v) for m, e, v in q(cur, 'SELECT mes, entidade, meta_efetividade FROM man_meta_efetividade_regional')})
    hoje = max(snap) if snap else dt.date.today()
    monthly = []
    for (mes, svc), byday in sorted(mens.items()):
        ds = sorted(byday)
        weights = [byday[d][12][0] for d in ds]
        feitos = [i for i, d in enumerate(ds) if d < hoje]
        SP, SPd = sum(weights), sum(weights[i] for i in feitos)
        targetDay = [[byday[d].get(e, (None,) * 4)[1] for d in ds] for e in range(13)]
        actualDay = [[byday[d].get(e, (None,) * 4)[2] if d < hoje else None for d in ds] for e in range(13)]
        forecastDay = [[byday[d].get(e, (None,) * 4)[3] for d in ds] for e in range(13)]
        tgt = [metas.get((mes, svc, e), (None, None))[0] for e in range(13)]
        act = [round(sum(v or 0 for v in actualDay[e]), 6) for e in range(13)]
        proj = [a / SPd * SP if SPd else None for a in act]
        nome = 'Ativação' if svc == 'ATIVACAO' else 'Retirada'
        rec = dict(month=mes.isoformat()[:7], service=nome, sheet=f"{'Ati' if svc == 'ATIVACAO' else 'Ret'} {MESES[mes.month - 1].title()}",
                   dates=[d.isoformat() for d in ds], weights=weights, sumWeights=SP, sumWeightsDone=SPd,
                   target=tgt, targetDay=targetDay, actual=act, actualDay=actualDay, forecastDay=forecastDay,
                   gapDay=[[(actualDay[e][i] or 0) - (targetDay[e][i] or 0) if i in feitos else None for i in range(len(ds))] for e in range(13)],
                   projection=proj, coverage=[ratio(p, t) for p, t in zip(proj, tgt)], labels={})
        if svc == 'RETIRADA':
            # aba Ret <mês>: Meta 69% = meta do mês; Meta 72% = churn × 0,72; OBJETIVO = Proj ÷ Meta 72% (fatores digitados na planilha)
            churn = [metas.get((mes, svc, e), (None, None))[1] for e in range(13)]
            metaB = [c * 0.72 if c is not None else None for c in churn]
            rec.update(churn=churn, metaA=tgt, metaB=metaB, pctMetaB=[ratio(p, b) for p, b in zip(proj, metaB)],
                       labels={'churn': 'Base churn', 'metaA': 'Meta', 'metaB': 'Meta B', 'projection': 'Proj'})
        else:
            rec.update(efetMonth=[None] * 13, efetTarget=[meta_efet.get((mes, e)) for e in range(13)], metaComercial=[None] * 13)
        monthly.append(rec)

    # capacity
    capd = defaultdict(dict)
    for d, e, a, b in q(cur, 'SELECT data, entidade, hc_presente_proprio, hc_presente_terceiro FROM vw_capacity'):
        capd[d][EI[e]] = (f(a), f(b))
    cdates = sorted(set(capd) | set(hc) | set(hcconf))
    capacity = dict(dates=[d.isoformat() for d in cdates])
    for key, src, j in [('mopActual', capd, 0), ('motActual', capd, 1), ('mopPlan', hc, 0), ('motPlan', hc, 1), ('mopConf', hcconf, 0), ('motConf', hcconf, 1)]:
        capacity[key] = [[(src.get(d, {}).get(e) or (None, None))[j] for d in cdates] for e in range(13)]

    days, monthly, capacity, leg_ate = legado(cur, days, monthly, capacity)
    # cobertura de entrantes D-1 (RESUMO AE:AH = ENTRANTE!Q): entrante do dia ÷ média dos 4 mesmos dias da semana anteriores.
    # Reparo, Instalação e MEs; entrante congelado: aba ENTRANTE onde a planilha cobre, senão a foto da manhã seguinte
    # (a base atual perde o mês anterior)
    def entr_dia(x, e, t):
        v = leg_entr.get(x, {}).get((e, t))
        return f(v if v is not None else entr_foto.get(x + dt.timedelta(1), {}).get((e, t)))
    for day in days:
        x = dt.date.fromisoformat(day['date'])
        cob = [[None] * 3 for _ in range(13)]
        partes = [[None] * 3 for _ in range(13)]  # [entrante, média]: consolidado de fim de semana
        for e in range(13):
            for t in range(3):
                vs = [entr_dia(x - dt.timedelta(7 * k), e, t) for k in range(1, 5)]
                if None not in vs:
                    cob[e][t] = ratio(entr_dia(x, e, t), sum(vs) / 4)
                    partes[e][t] = [entr_dia(x, e, t), sum(vs) / 4]
        if any(v is not None for r in cob for v in r):
            day['entrCob'], day['entrParts'] = cob, partes
    # aba ENTRANTE da planilha: entrante congelado por dia e tipo (7 tipos), do 1º dia do portal − 56 dias (médias de até 8 semanas)
    # até o último dia com foto; só os dias com algum valor
    entrante_dia = dict(dates=[], values=[], feriados=ENTR_FERIADOS)
    if days:
        x, fim = dt.date.fromisoformat(days[0]['date']) - dt.timedelta(56), dt.date.fromisoformat(days[-1]['date'])
        while x <= fim:
            m = [[entr_dia(x, e, t) for t in range(7)] for e in range(13)]
            if any(v is not None for r in m for v in r):
                entrante_dia['dates'].append(x.isoformat())
                entrante_dia['values'].append(m)
            x += dt.timedelta(1)

    mp = mapa(cur)
    ult = q(cur, 'SELECT id, data_ref, inicio, fim, status, mensagem FROM log_execucao ORDER BY id DESC LIMIT 1')
    chk = q(cur, 'SELECT verificacao, ok, total, detalhe FROM chk_conciliacao WHERE execucao_id = %s', (ult[0][0],)) if ult else []
    db.close()
    data = dict(source='dw_fup (MySQL 172.29.5.3)', sourceKind='db',
                sourceModified=ult[0][3].isoformat() if ult and ult[0][3] else None,
                extracted=dt.datetime.now().isoformat(timespec='seconds'),
                entities=[dict(code=c, name=n, level=l, regional=r) for c, n, l, r in ENTITIES], types=TYPES,
                days=days, monthly=monthly, capacity=capacity, stats=dict(blocks=len(days), monthly=len(monthly), errors=0), commitFile=None,
                robot=dict(id=ult[0][0], date=ult[0][1].isoformat(), start=ult[0][2].isoformat(), end=ult[0][3] and ult[0][3].isoformat(),
                           status=ult[0][4], message=ult[0][5]) if ult else None,
                legacyUntil=leg_ate and leg_ate.isoformat(), mapa=mp, entrante=entrante_dia)
    validation = dict(generated=data['sourceModified'] or data['extracted'],
                      reference=dict(d1=days[-2]['date'] if len(days) > 1 else None, d0=days[-1]['date'] if days else None),
                      passed=bool(ult) and ult[0][4] == 'OK',
                      checks=[dict(group='Robô dw_fup', desc=v, ok=o, total=t, unexplained=t - o, hypotheses=0, causes=[],
                                   examples=[dict(ref=dd[:300], portal=None, planilha=None, why=None)] if o != t and dd else []) for v, o, t, dd in chk])
    return data, validation


def mapa(cur):
    """Municípios de SP projetados para SVG (contornos), foto operacional por cidade e previsão de 3 dias (último D0)."""
    import math
    mun = q(cur, 'SELECT m.cod_ibge, m.nome, m.atua, g.sigla, m.lat, m.lon, m.contorno FROM dim_municipio m LEFT JOIN dim_gerencia g ON g.cod_ger = m.cod_ger')
    if not mun:
        return None
    geos = [(r, json.loads(r[6])) for r in mun]
    pts = [p for _, g in geos for poly in (g['coordinates'] if g['type'] == 'MultiPolygon' else [g['coordinates']]) for ring in poly for p in ring]
    lon0, lon1 = min(p[0] for p in pts), max(p[0] for p in pts)
    lat0, lat1 = min(p[1] for p in pts), max(p[1] for p in pts)
    kx = math.cos(math.radians((lat0 + lat1) / 2))
    S = 1000 / ((lon1 - lon0) * kx)
    X = lambda lon: round((lon - lon0) * kx * S, 1)
    Y = lambda lat: round((lat1 - lat) * S, 1)
    out = []
    for (ib, nome, atua, sigla, lat, lon, _), g in geos:
        d = []
        for poly in (g['coordinates'] if g['type'] == 'MultiPolygon' else [g['coordinates']]):
            for ring in poly:
                d.append('M' + 'L'.join(f'{X(x)} {Y(y)}' for x, y in ring) + 'Z')
        out.append(dict(ibge=ib, nome=nome, atua=bool(atua), ger=sigla, x=X(float(lon)), y=Y(float(lat)), d=''.join(d)))
    r = q(cur, 'SELECT MAX(data_ref) FROM fat_cidade_diaria')
    d0 = r[0][0] if r else None
    ops = defaultdict(lambda: [[None] * 5 for _ in TIPOS])
    if d0:
        for ib, t, fila, mdu, real, entr, emed in q(cur, 'SELECT cod_ibge, tipo, fila, media_du, real_d1, entr_d1, entr_medio_d0 FROM fat_cidade_diaria WHERE data_ref = %s', (d0,)):
            ops[ib][TI[t]] = [f(fila), f(mdu), f(real), f(entr), f(emed)]
    r = q(cur, 'SELECT MAX(data_ref) FROM fat_tempo')
    t0 = r[0][0] if r else None
    tempo, dias = defaultdict(list), set()
    if t0:
        for ib, dia, cod, tmax, tmin, chuva, prob, vento in q(cur, 'SELECT cod_ibge, dia, codigo_tempo, temp_max, temp_min, chuva_mm, prob_chuva, vento_max FROM fat_tempo WHERE data_ref = %s ORDER BY dia', (t0,)):
            tempo[ib].append([dia.isoformat(), cod, f(tmax), f(tmin), f(chuva), prob, f(vento)])
            dias.add(dia.isoformat())
    for m in out:
        m['op'] = ops.get(m['ibge']) if m['atua'] else None
        m['tempo'] = tempo.get(m['ibge'])
    return dict(d0=d0 and d0.isoformat(), tempoRef=t0 and t0.isoformat(), dias=sorted(dias), width=1000, height=round((lat1 - lat0) * S, 1), municipios=out)


LEG_KEYS = [('du', 'du'), ('queue', 'fila'), ('emax', 'estoque_maximo'), ('entrAvg', 'entrante_medio_d0'), ('need', 'necessidade'),
            ('commit', 'compromisso'), ('actual', 'realizado'), ('pctCommit', 'pct_compromisso'), ('pctNeed', 'pct_necessidade'),
            ('pctCommitNeed', 'pct_compromisso_x_necessidade')]
TIPO8 = TIPOS + ['TOTAL']


def legado(cur, days, monthly, capacity):
    """Histórico importado da planilha (leg_*), até leg_importacao.ate. Regras:
    dias <= ate: valores do legado (exatos); o realizado vazio no legado é completado pelo robô (foto do dia seguinte);
    meses: legado só para (mês, serviço) que o robô não calculou; capacity: legado para datas < ate."""
    r = q(cur, 'SELECT MAX(ate) FROM leg_importacao')
    ate = r[0][0] if r else None
    if not ate:
        return days, monthly, capacity, None
    robo = {d['date']: d for d in days}
    leg = defaultdict(lambda: dict(col=None, target=None, **{k: blank(8) for k, _ in LEG_KEYS}))
    cols = ', '.join(c for _, c in LEG_KEYS)
    for row in q(cur, f'SELECT data, entidade, tipo, bloco_planilha, alvo_du, {cols} FROM leg_bloco_diario WHERE data <= %s', (ate,)):
        d, e, t, col, alvo, *vals = row
        L = leg[d]
        L['col'] = col
        if alvo is not None and t != 'TOTAL':
            L.setdefault('_alvo', [None] * 6)[TIPO8.index(t)] = f(alvo)
        for (k, _), v in zip(LEG_KEYS, vals):
            L[k][EI[e]][TIPO8.index(t)] = f(v)
    efet = defaultdict(dict)
    for d, e, a, b, c in q(cur, 'SELECT data, entidade, efetividade, efetividade_real, cobertura FROM leg_efetividade WHERE data <= %s', (ate,)):
        efet[d][EI[e]] = [f(a), f(b), f(c)]
    out = []
    for d in sorted(leg):
        L, iso = leg[d], d.isoformat()
        day = dict(date=iso, col=L['col'], layout=7, target=L.get('_alvo') or [None] * 6, efet=[efet[d].get(e, [None] * 3) for e in range(13)], source='legado_planilha')
        for k, _ in LEG_KEYS:
            day[k] = L[k]
        R = robo.get(iso)
        if R:  # completa só o que o legado não tem (ex.: realizado de 03/11, gravado pela foto de 04/11)
            for e in range(13):
                for t in range(8):
                    if day['actual'][e][t] is None and R['actual'][e][t] is not None:
                        day['actual'][e][t] = R['actual'][e][t]
                        day['pctCommit'][e][t] = ratio(day['actual'][e][t], day['commit'][e][t])
                        day['pctNeed'][e][t] = ratio(day['actual'][e][t], day['need'][e][t])
            if R.get('hcCommit'):
                day['hcCommit'] = R['hcCommit']
            # efetividade que a planilha ainda não tinha calculado na extração (03/11: EFETIV 0 e REAL vazia): vem do robô
            for e in range(13):
                if day['efet'][e][1] is None and R['efet'][e][1] is not None:
                    day['efet'][e] = list(R['efet'][e]) if not day['efet'][e][0] else [day['efet'][e][0], R['efet'][e][1], ratio(R['efet'][e][1], day['efet'][e][0])]
        out.append(day)
    out += [d for d in days if d['date'] > ate.isoformat()]

    # mensal: legado só onde o robô não tem o mês
    feitos = {(m['month'], m['service']) for m in monthly}
    res = defaultdict(dict)
    for row in q(cur, '''SELECT mes, servico, entidade, aba, meta, realizado, projecao, cobertura, churn, meta_a, meta_b, pct_meta_b,
                          efetividade, meta_efetividade, soma_pesos, soma_pesos_realizados, rotulos FROM leg_mensal_resumo'''):
        res[(row[0], row[1])][EI[row[2]]] = row[3:]
    curva = defaultdict(lambda: defaultdict(dict))
    for mes, svc, d, e, peso, md, real, fc, gap in q(cur, 'SELECT mes, servico, data, entidade, peso, meta_dia, realizado, forecast, gap FROM leg_mensal'):
        curva[(mes, svc)][d][EI[e]] = (f(peso), f(md), f(real), f(fc), f(gap))
    for (mes, svc), byday in sorted(curva.items()):
        nome = 'Ativação' if svc == 'ATIVACAO' else 'Retirada'
        if (mes.isoformat()[:7], nome) in feitos:
            continue
        ds, R0 = sorted(byday), res[(mes, svc)]
        col = lambda i: [f(R0[e][i]) if e in R0 else None for e in range(13)]
        serie = lambda i: [[byday[d].get(e, (None,) * 5)[i] for d in ds] for e in range(13)]
        rec = dict(month=mes.isoformat()[:7], service=nome, sheet=R0[12][0], dates=[d.isoformat() for d in ds], weights=[byday[d][12][0] for d in ds],
                   sumWeights=f(R0[12][11]), sumWeightsDone=f(R0[12][12]), target=col(1), actual=col(2), projection=col(3), coverage=col(4),
                   targetDay=serie(1), actualDay=serie(2), forecastDay=serie(3), gapDay=serie(4), labels=json.loads(R0[12][13] or '{}'), source='legado_planilha')
        if svc == 'RETIRADA':
            rec.update(churn=col(5), metaA=col(6), metaB=col(7), pctMetaB=col(8))
        else:
            rec.update(efetMonth=col(9), efetTarget=col(10))
        monthly.append(rec)
    monthly.sort(key=lambda m: (m['month'], m['service']))

    # capacity: legado antes de "ate"
    lc = defaultdict(dict)
    for d, e, *v in q(cur, 'SELECT data, entidade, mop_plan, mop_conf, mop_real, mot_plan, mot_conf, mot_real FROM leg_capacity WHERE data < %s', (ate,)):
        lc[d.isoformat()][EI[e]] = [f(x) for x in v]
    keys = ['mopPlan', 'mopConf', 'mopActual', 'motPlan', 'motConf', 'motActual']
    rob_dates = [x for x in capacity['dates'] if x >= ate.isoformat()]
    rob_idx = [capacity['dates'].index(x) for x in rob_dates]
    dates = sorted(lc) + rob_dates
    cap = dict(dates=dates)
    for j, k in enumerate(keys):
        cap[k] = [[lc[x].get(e, [None] * 6)[j] for x in sorted(lc)] + [capacity[k][e][i] for i in rob_idx] for e in range(13)]
    return out, monthly, cap, ate


def js(data, validation):
    dump = lambda x: json.dumps(x, ensure_ascii=False, separators=(',', ':'), default=str)
    return f'window.PORTAL_DATA={dump(data)};', f'window.PORTAL_VALIDATION={dump(validation)};'


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    d, v = build()
    print(f"{len(d['days'])} dias ({d['days'][0]['date']} a {d['days'][-1]['date']}), {len(d['monthly'])} meses, {len(d['capacity']['dates'])} datas de capacity; robô {d['robot'] and d['robot']['status']}")
