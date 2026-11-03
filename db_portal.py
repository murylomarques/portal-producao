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
    commit = defaultdict(dict)
    for d, e, t, v in q(cur, '''SELECT c.data, e.entidade, c.tipo, SUM(c.compromisso) FROM man_compromisso c
                                JOIN vw_entidade e ON e.cod_ger = c.cod_ger GROUP BY c.data, e.entidade, c.tipo'''):
        commit[d][(EI[e], TI[t])] = v
    hc = defaultdict(dict)
    for d, e, a, b in q(cur, '''SELECT h.data, e.entidade, SUM(h.hc_proprio), SUM(h.hc_terceiro) FROM man_hc_compromisso h
                                JOIN vw_entidade e ON e.cod_ger = h.cod_ger GROUP BY h.data, e.entidade'''):
        hc[d][EI[e]] = [f(a), f(b)]
    live = defaultdict(dict)
    for d, e, t, v in q(cur, '''SELECT p.data, e.entidade, p.tipo, SUM(p.realizado) FROM fat_producao_diaria p
                                JOIN vw_entidade e ON e.cod_ger = p.cod_ger GROUP BY p.data, e.entidade, p.tipo'''):
        live[d][(EI[e], TI[t])] = v

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
        day['efet'] = blank(3)
        if hc.get(d):
            day['hcCommit'] = [hc[d].get(e, [None, None]) for e in range(13)]
        days.append(day)

    # curva mensal
    mens = defaultdict(lambda: defaultdict(dict))
    for mes, svc, d, ent, peso, md, real, fc in q(cur, 'SELECT mes, servico, data, entidade, peso, meta_dia, realizado, forecast FROM vw_mensal ORDER BY data'):
        mens[(mes, svc)][d][EI[ent]] = (f(peso), f(md), f(real), f(fc))
    metas = {(m, s, EI[e]): (f(a), f(b)) for m, s, e, a, b in q(cur, '''SELECT mm.mes, mm.servico, e.entidade, SUM(mm.meta_mes), SUM(mm.churn_base)
        FROM man_meta_mensal mm JOIN vw_entidade e ON e.cod_ger = mm.cod_ger GROUP BY mm.mes, mm.servico, e.entidade''')}
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
            rec.update(churn=[metas.get((mes, svc, e), (None, None))[1] for e in range(13)], metaA=[None] * 13, metaB=[None] * 13, pctMetaB=[None] * 13,
                       labels={'churn': 'Base churn', 'metaA': 'Meta', 'metaB': 'Meta B', 'projection': 'Proj'})
        else:
            rec.update(efetMonth=[None] * 13, efetTarget=[None] * 13, metaComercial=[None] * 13)
        monthly.append(rec)

    # capacity
    capd = defaultdict(dict)
    for d, e, a, b in q(cur, 'SELECT data, entidade, hc_presente_proprio, hc_presente_terceiro FROM vw_capacity'):
        capd[d][EI[e]] = (f(a), f(b))
    cdates = sorted(set(capd) | set(hc))
    capacity = dict(dates=[d.isoformat() for d in cdates])
    for key, src, j in [('mopActual', capd, 0), ('motActual', capd, 1), ('mopPlan', hc, 0), ('motPlan', hc, 1)]:
        capacity[key] = [[(src.get(d, {}).get(e) or (None, None))[j] for d in cdates] for e in range(13)]
    capacity['mopConf'] = [[None] * len(cdates) for _ in range(13)]
    capacity['motConf'] = [[None] * len(cdates) for _ in range(13)]

    days, monthly, capacity, leg_ate = legado(cur, days, monthly, capacity)

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
                legacyUntil=leg_ate and leg_ate.isoformat())
    validation = dict(generated=data['sourceModified'] or data['extracted'],
                      reference=dict(d1=days[-2]['date'] if len(days) > 1 else None, d0=days[-1]['date'] if days else None),
                      passed=bool(ult) and ult[0][4] == 'OK',
                      checks=[dict(group='Robô dw_fup', desc=v, ok=o, total=t, unexplained=t - o, hypotheses=0, causes=[],
                                   examples=[dict(ref=dd[:300], portal=None, planilha=None, why=None)] if o != t and dd else []) for v, o, t, dd in chk])
    return data, validation


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
    out = []
    for d in sorted(leg):
        L, iso = leg[d], d.isoformat()
        day = dict(date=iso, col=L['col'], layout=7, target=L.get('_alvo') or [None] * 6, efet=blank(3), source='legado_planilha')
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
