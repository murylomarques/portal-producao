"""Conferência do portal FUP contra a planilha de origem (somente leitura).

1. RESUMO da planilha (o que é apresentado hoje) x dados do portal (D-1 e D0, capacity, ativação).
2. Consistência interna de todos os dias: regional = Σ polos, DESKTOP = Σ regionais, TOTAL = Σ tipos,
   % = razão (usando os valores do próprio arquivo).
3. Conferência célula a célula com o cache independente da engenharia reversa (se existir).
Gera dist/validation.js (exibido em "Conferência") e imprime um resumo.
"""
import datetime as dt, json, math, pickle, re, sys
from pathlib import Path
import openpyxl
from openpyxl.utils import column_index_from_string as ci
from extract import ROOT, SOURCE, ENTITIES

TOL = 1e-6


def eq(a, b, tol=TOL):
    if a is None or b is None:
        return a is None and b is None
    return abs(a - b) <= tol * max(1, abs(b))


def numv(v):
    if isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v):
        return float(v)
    if v == '0':
        return 0.0
    return None


COMMIT_SOURCE = ROOT.parent / 'COMPROMISSOS_D0.xlsx'
AUX_CAUSES = {
    'AUX_REF_DESLOCADA': 'Aba auxiliar oculta do COMPROMISSOS_D0 com referência ao D0 deslocada: a linha Chip foi inserida '
                         'nos blocos de polo (D0!23/36/49) e a fórmula passou a ler a linha vizinha.',
    'AUX_REF_ERRO': 'Aba auxiliar oculta do COMPROMISSOS_D0 com fórmula =D0!#REF! (linha de origem excluída).',
    'AUX_SOMA_DE_PARCELA_ERRADA': 'Subtotal (regional/DESKTOP) da aba auxiliar que soma parcelas já erradas.',
}


def read_d0_file(path):
    """Leitura independente (endereços fixos de célula, sem a lógica do extract.py) do COMPROMISSOS_D0.xlsx."""
    if not Path(path).exists():
        return None
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    ws = {n: [list(r) for r in wb[n].iter_rows(values_only=True)] for n in ('NECESSIDADE_PROD', 'COMPROMISSO_FUP', 'PBI_COMPR', 'Consolidado_Compromisso_Planj.')}
    wb.close()
    cell = lambda n, r, c: ws[n][r - 1][c - 1] if r <= len(ws[n]) and c <= len(ws[n][r - 1]) else None
    a15 = cell('NECESSIDADE_PROD', 15, 1)
    out = dict(date=a15.date().isoformat() if isinstance(a15, dt.datetime) else None,
               ref=lambda e, t: f'{"BCDEFGHI"[t]}{e + 2}',
               need=[[numv(cell('NECESSIDADE_PROD', e + 2, t + 2)) for t in range(8)] for e in range(13)],
               commit=[[numv(cell('COMPROMISSO_FUP', e + 2, t + 2)) for t in range(8)] for e in range(13)],
               hc=[[numv(cell('COMPROMISSO_FUP', e + 2, c)) for c in (11, 12)] for e in range(13)], aux=[])
    # Fórmulas das abas auxiliares: explicam cada divergência pela linha do D0 que a célula realmente lê.
    wf = openpyxl.load_workbook(path, data_only=False)
    fx = lambda n, r, c: wf[n].cell(r, c).value
    d0_label = lambda r: str(wf['D0'].cell(r, 3).value or '').strip().upper()
    D0_TYPE = ['REPARO', 'INSTALAÇÃO', 'MES', 'PREVENTIVA', 'OUTROS', 'CHIP', 'RETIRADAS']
    POLO_AT = {('DE', 18): 1, ('DE', 31): 2, ('DE', 44): 3, ('JK', 18): 5, ('JK', 31): 6, ('JK', 44): 7,
               ('PQ', 18): 9, ('PQ', 31): 10, ('PQ', 44): 11}

    def why_ref(formula, e, t):
        """(causa, detalhe) se a fórmula aponta para outra linha/polo do D0 ou tem #REF!; None se aponta certo."""
        f = str(formula or '')
        if '#REF!' in f:
            return ('AUX_REF_ERRO', f'fórmula {f}')
        m = re.fullmatch(r"=D0!\$?([A-Z])\$?(\d+)", f)
        if not m:
            return None
        col, row = m.group(1), int(m.group(2))
        grp = next((g for g in ('DE', 'JK', 'PQ') if col in g), None)
        base = max((b for b in (18, 31, 44) if b <= row), default=None)
        lab, exp = d0_label(row), D0_TYPE[t]
        if POLO_AT.get((grp, base)) != e:
            return ('AUX_REF_DESLOCADA', f'{f} lê outro polo/bloco do D0')
        if not lab.startswith(exp[:4]):
            return ('AUX_REF_DESLOCADA', f'{f} lê a linha "{lab.title()}" do D0 (esperado {exp.title()})')
        return None

    # PBI_COMPR: cada linha diz polo + tipo; confere se o valor corresponde ao rótulo
    POLO = {'SUMARÉ': 1, 'SOROCABA': 2, 'CAMPINAS': 3, 'LENÇÓIS PAULISTA': 5, 'ARARAQUARA': 6, 'BARRETOS': 7,
            'PRAIA GRANDE': 9, 'SÃO JOSE DOS CAMPOS': 10, 'JUNDIAÍ': 11}
    TIPO = {'REPARO': 0, 'ATIVAÇÃO': 1, 'MUD END': 2, 'REPARO PREV': 3, 'OUTROS SERVIÇOS': 4, 'RETIRADA': 6}
    pairs, why = [], {}
    for r in range(2, len(ws['PBI_COMPR']) + 1):
        p, t = cell('PBI_COMPR', r, 2), cell('PBI_COMPR', r, 3)
        if p in POLO and t in TIPO:
            for c, k, lab in [(4, 'need', 'necessidade'), (5, 'commit', 'compromisso')]:
                ref = f'PBI_COMPR!{"DE"[c - 4]}{r} {p} {t} ({lab})'
                pairs.append((ref, numv(cell('PBI_COMPR', r, c)), out[k][POLO[p]][TIPO[t]]))
                why[ref] = why_ref(fx('PBI_COMPR', r, c), POLO[p], TIPO[t])
    out['aux'].append(('COMPROMISSOS_D0 · aba PBI_COMPR: valor corresponde ao polo/tipo do rótulo (não usada pelo portal)', pairs, why))
    COLT = {2: 0, 3: 1, 4: 2, 5: 3, 6: 4, 7: 6}  # Consolidado não tem CHIP nem TOTAL comparável
    CS = 'Consolidado_Compromisso_Planj.'
    pairs, why = [], {}
    REGS = {0: [1, 2, 3], 4: [5, 6, 7], 8: [9, 10, 11], 12: [0, 4, 8]}
    for c, t in COLT.items():
        bad_row = {}
        for e in [1, 2, 3, 5, 6, 7, 9, 10, 11, 0, 4, 8, 12]:  # polos antes das somas
            ref = f"{CS}!{'ABCDEFG'[c - 1]}{e + 2} {ENTITIES[e][1]}"
            v, exp = numv(cell(CS, e + 2, c)), out['commit'][e][t]
            pairs.append((ref, v, exp))
            if e in REGS:
                parts = [p for p in REGS[e] if bad_row.get(p)]
                why[ref] = ('AUX_SOMA_DE_PARCELA_ERRADA', f"{fx(CS, e + 2, c)} inclui {', '.join(ENTITIES[p][1] for p in parts)}") if parts else None
            else:
                why[ref] = why_ref(fx(CS, e + 2, c), e, t)
            bad_row[e] = not eq(v, exp)
    out['aux'].append((f'COMPROMISSOS_D0 · aba {CS} x COMPROMISSO_FUP (não usada pelo portal)', pairs, why))
    wf.close()
    return out


def run(source=SOURCE, data=None, use_cache=True, commit_source=COMMIT_SOURCE):
    if data is None:
        data = json.loads((ROOT / 'dist/data.js').read_text(encoding='utf-8')[len('window.PORTAL_DATA='):-1])
    days = {d['date']: d for d in data['days']}
    checks = []
    kf = ROOT / 'known_issues.json'
    known = json.loads(kf.read_text(encoding='utf-8')) if kf.exists() else dict(causes={}, items=[])
    KNOWN = {(x['check'], x['ref']): x for x in known['items']}

    def add(group, desc, pairs, explain=None):
        """explain(ref) -> (código da causa, detalhe) de uma inconsistência documentada da origem, ou None.
        Divergência sem causa = não explicada = reprova a validação."""
        bad = [p for p in pairs if not eq(p[1], p[2])]
        why = {r: (explain(r) if explain else None) for r, _, _ in bad}
        unexp = [p for p in bad if not why[p[0]]]
        causes = {}
        for w in why.values():
            if w:
                causes[w[0]] = causes.get(w[0], 0) + 1
        hyp = sum(1 for w in why.values() if w and len(w) > 2 and w[2] == 'hipótese')
        checks.append(dict(group=group, desc=desc, ok=len(pairs) - len(bad), total=len(pairs), unexplained=len(unexp), hypotheses=hyp,
                           causes=[dict(cause=k, n=n, text=CAUSE_TEXT.get(k, '')) for k, n in sorted(causes.items(), key=lambda x: -x[1])],
                           examples=[dict(ref=r, portal=a, planilha=b, why=why[r] and why[r][1]) for r, a, b in (unexp + [p for p in bad if why[p[0]]])[:8]]))

    CAUSE_TEXT = dict(known['causes'], **AUX_CAUSES)
    known_why = lambda key: lambda r: (lambda x: x and (x['cause'], f"{x['cell']} = {x['formula']}" + (' [hipótese — confirmar]' if x.get('evidence') == 'hipótese' else ''), x.get('evidence')))(KNOWN.get((key, r)))
    # ------------------------------------------------------------------ 1. RESUMO
    if hasattr(source, 'seek'):
        source.seek(0)
    wb = openpyxl.load_workbook(source, read_only=True, data_only=True)
    rs = [list(r) for r in wb['RESUMO'].iter_rows(min_row=1, max_row=40, values_only=True)]
    R = lambda ref: rs[int(''.join(ch for ch in ref if ch.isdigit())) - 1][ci(''.join(ch for ch in ref if ch.isalpha())) - 1]
    d1 = R('B4').date().isoformat(); d0 = R('J4').date().isoformat()
    D1, D0 = days[d1], days[d0]
    cols8 = ['V', 'W', 'X', 'Y', 'Z', 'AA', 'AB', 'AC']
    rows13 = list(range(7, 20))  # CENTRAL..DESKTOP no RESUMO
    rows13_b = list(range(23, 36))
    pairs = []
    for row, key in [(2, 'need'), (3, 'commit'), (4, 'actual')]:
        for t, c in enumerate(cols8):
            pairs.append((f'RESUMO!{c}{row}', D1[key][12][t], numv(R(f'{c}{row}'))))
    add('RESUMO', f'Necessidade, compromisso e realizado DESKTOP de {d1} (U2:AC4)', pairs)
    for label, blk, cols in [(d1, D1, ['C', 'D', 'E', 'F', 'G', 'H']), (d0, D0, ['K', 'M', 'O', 'Q', 'R', 'S'])]:
        add('RESUMO', f'DU CONTROLE de {label} — 13 linhas × 6 tipos', [(f'RESUMO!{c}{r}', blk['du'][i][t], numv(R(f'{c}{r}'))) for i, r in enumerate(rows13) for t, c in enumerate(cols)])
        add('RESUMO', f'Fila total de {label} — 13 linhas × 6 tipos', [(f'RESUMO!{c}{r}', blk['queue'][i][t], numv(R(f'{c}{r}'))) for i, r in enumerate(rows13_b) for t, c in enumerate(cols)])
    add('RESUMO', f'% Compromisso de {d1} — 13 × 8', [(f'RESUMO!{c}{r}', D1['pctCommit'][i][t], numv(R(f'{c}{r}'))) for i, r in enumerate(rows13) for t, c in enumerate(cols8)])
    add('RESUMO', f'% Necessidade de {d1} — 13 × 8', [(f'RESUMO!{c}{r}', D1['pctNeed'][i][t], numv(R(f'{c}{r}'))) for i, r in enumerate(rows13_b) for t, c in enumerate(cols8)])
    add('RESUMO', f'Efetividade de instalação de {d1} (AE:AG)', [(f'RESUMO!{c}{r}', D1['efet'][i][j], numv(R(f'{c}{r}'))) for i, r in enumerate(rows13) for j, c in enumerate(['AE', 'AF', 'AG'])])
    cap = data['capacity']; ci_d1 = cap['dates'].index(d1) if d1 in cap['dates'] else None
    cap_map = {'AK': 'mopPlan', 'AL': 'motPlan', 'AM': 'mopConf', 'AN': 'motConf', 'AO': 'mopActual', 'AP': 'motActual'}
    # no RESUMO a ordem das linhas é CENTRAL, polos..., DESKTOP — igual a ENTITIES
    d0w = dt.date.fromisoformat(d0)
    def cap_d1(key, e):
        if d0w.weekday() == 0:  # segunda: D-1 = sábado + domingo
            a, b = cap[key][e][cap['dates'].index((d0w - dt.timedelta(2)).isoformat())], cap[key][e][cap['dates'].index((d0w - dt.timedelta(1)).isoformat())]
            return None if a is None and b is None else (a or 0) + (b or 0)
        return cap[key][e][ci_d1]
    add('RESUMO', 'Capacity D-1: HC planejado, confirmado COP e presente, MOP e MOT (AK:AP)', [(f'RESUMO!{c}{r}', cap_d1(k, i), numv(R(f'{c}{r}'))) for i, r in enumerate(rows13) for c, k in cap_map.items()])
    # o RESUMO aponta para uma aba "Ati <mês>" fixa na fórmula; identifica qual pelos valores
    def ati_pairs(m):
        return [(f'RESUMO!{c}{r}', v(m, i), numv(R(f'{c}{r}'))) for i, r in enumerate(rows13)
                for c, v in [('AY', lambda m, i: m['target'][i]), ('AZ', lambda m, i: m['actual'][i]),
                             ('BC', lambda m, i: m['projection'][i]), ('BD', lambda m, i: m['coverage'][i])]]
    atis = [m for m in data['monthly'] if m['service'] == 'Ativação']
    best = max(atis, key=lambda m: sum(eq(a, b) for _, a, b in ati_pairs(m)))
    add('RESUMO', f"Ativação do mês (AY:BD) — o RESUMO lê a aba '{best['sheet']}'", ati_pairs(best))
    wb.close()

    # ------------------------------------------------------------------ 2. consistência interna (todos os dias)
    REG = {0: [1, 2, 3], 4: [5, 6, 7], 8: [9, 10, 11]}
    LABEL = {'queue': 'Fila', 'need': 'Necessidade', 'commit': 'Compromisso', 'actual': 'Realizado'}
    for key, ntypes in [('queue', 6), ('need', 7), ('commit', 7), ('actual', 7)]:
        pairs = []
        for d in data['days']:
            m = d[key]
            for reg, ps in REG.items():
                for t in range(ntypes):
                    if m[reg][t] is not None:
                        pairs.append((f"{d['date']} {ENTITIES[reg][1]} {data['types'][t]}", sum(m[p][t] or 0 for p in ps), m[reg][t]))
            for t in range(ntypes):
                if m[12][t] is not None:
                    pairs.append((f"{d['date']} Desktop {data['types'][t]}", sum(m[r][t] or 0 for r in REG), m[12][t]))
            if ntypes == 7:
                for e in range(13):
                    if m[e][7] is not None:
                        pairs.append((f"{d['date']} {ENTITIES[e][1]} TOTAL", sum(m[e][t] or 0 for t in range(7)), m[e][7]))
        add('Consistência', f'{LABEL[key]}: regional = Σ polos, Desktop = Σ regionais' + (', TOTAL = Σ serviços' if ntypes == 7 else '') + ' (todos os dias)', pairs, known_why(key))
    pairs = []
    for d in data['days']:
        for e in range(13):
            for t in range(8):
                a, c, p = d['actual'][e][t], d['commit'][e][t], d['pctCommit'][e][t]
                if p is not None and a is not None and c:
                    pairs.append((f"{d['date']} {ENTITIES[e][1]} {(data['types'] + ['TOTAL'])[t]}", a / c, p))
    add('Consistência', '% Compromisso = realizado ÷ compromisso (todos os dias)', pairs, known_why('pctCommit'))
    pairs = []
    for m in data['monthly']:
        for e in range(13):
            if m['actual'][e] is not None:
                pairs.append((f"{m['sheet']} {ENTITIES[e][1]} realizado acumulado", sum(x or 0 for x in m['actualDay'][e]), m['actual'][e]))
    add('Mensal', 'Abas mensais: realizado acumulado (coluna C) = Σ realizado diário', pairs)
    # realizado do bloco diário x aba mensal (regionais e Desktop; polos têm a reorganização da Central, doc. 08 X9/X10)
    MT = {'Ativação': 1, 'Retirada': 6}
    pairs = [(f"{m['sheet']} {iso} {ENTITIES[e][1]}", days[iso]['actual'][e][MT[m['service']]] or 0, m['actualDay'][e][j])
             for m in data['monthly'] for j, iso in enumerate(m['dates']) if iso in days
             for e in (0, 4, 8, 12) if m['actualDay'][e][j] is not None]
    add('Consistência', 'Realizado: bloco diário (Compromissos D0) = aba mensal Ati/Ret, por regional e Desktop (todos os dias)', pairs, known_why('monthlyVsBlock'))

    # ------------------------------------------------------------------ 2b. COMPROMISSOS_D0.xlsx (formulário do dia)
    cf = data.get('commitFile')
    F = read_d0_file(commit_source) if cf else None
    if F and F['date'] in days:
        dd, ty, fd = days[F['date']], data['types'] + ['TOTAL'], F['date']
        add('COMPROMISSOS_D0', f"Necessidade de {fd}: NECESSIDADE_PROD!B2:I14 x portal (13 × 8)",
            [(f'NECESSIDADE_PROD!{F["ref"](e, t)} {ENTITIES[e][1]} {ty[t]}', dd['need'][e][t], F['need'][e][t]) for e in range(13) for t in range(8)])
        add('COMPROMISSOS_D0', f"Compromisso de {fd}: COMPROMISSO_FUP!B2:I14 x portal (13 × 8)"
            + (' — Acompanhamento ainda vazio neste dia; o portal usa o arquivo' if cf.get('used') else ' — Acompanhamento já preenchido'),
            [(f'COMPROMISSO_FUP!{F["ref"](e, t)} {ENTITIES[e][1]} {ty[t]}', dd['commit'][e][t], F['commit'][e][t]) for e in range(13) for t in range(8)])
        add('COMPROMISSOS_D0', f"HC comprometido de {fd}: COMPROMISSO_FUP!K2:L14 (HC INT/EPS) x portal",
            [(f"COMPROMISSO_FUP!{'KL'[j]}{e + 2} {ENTITIES[e][1]}", (dd.get('hcCommit') or [[None, None]] * 13)[e][j], F['hc'][e][j]) for e in range(13) for j in range(2)])
        REG = {0: [1, 2, 3], 4: [5, 6, 7], 8: [9, 10, 11]}
        for nm, m in [('NECESSIDADE_PROD', F['need']), ('COMPROMISSO_FUP', F['commit'])]:
            pairs = [(f'{nm} {ENTITIES[r][1]} {ty[t]} = Σ polos', sum(m[p][t] or 0 for p in ps), m[r][t]) for r, ps in REG.items() for t in range(8)]
            pairs += [(f'{nm} Desktop {ty[t]} = Σ regionais', sum(m[r][t] or 0 for r in REG), m[12][t]) for t in range(8)]
            pairs += [(f'{nm} {ENTITIES[e][1]} TOTAL = Σ serviços', sum(m[e][t] or 0 for t in range(7)), m[e][7]) for e in range(13)]
            add('Consistência', f'COMPROMISSOS_D0 · {nm}: regional = Σ polos, Desktop = Σ regionais, TOTAL = Σ serviços', pairs)
        for desc, pairs, why in F['aux']:
            add('Consistência', desc, pairs, why.get)

    # ------------------------------------------------------------------ 3. cache independente (engenharia reversa)
    cache = ROOT.parent / '_analise_scripts/regionais/cache.pkl'
    if use_cache and cache.exists():
        s = pickle.load(open(cache, 'rb'))['Compromissos D0']
        starts = {v[1].date().isoformat(): col for (r, col), v in s.items() if r == 1 and isinstance(v[1], dt.datetime)}
        pairs = []
        off = {'du': 5, 'queue': 20, 'need': 35, 'commit': 50, 'actual': 80, 'pctCommit': 95, 'pctNeed': 110}
        for d in data['days']:
            c0 = starts[d['date']]
            # colunas por layout: 7 tipos (Reparo..Retiradas, TOTAL) ou 6 tipos (sem CHIP)
            tcols = list(range(8)) if d['layout'] == 7 else [0, 1, 2, 3, 4, None, 5, 6]
            for key, r0 in off.items():
                for e in range(13):
                    for t in range(6 if key in ('du', 'queue') else 8):
                        j = tcols[t]
                        exp = None if j is None else numv((s.get((r0 + e, c0 + 1 + j)) or [None, None])[1])
                        if key in ('du', 'queue') and d['layout'] == 6 and t == 5:
                            exp = None
                        if key == 'commit' and d.get('commitSource'):
                            continue  # compromisso deste dia vem do COMPROMISSOS_D0.xlsx (conferido acima)
                        pairs.append((f"{d['date']} {key} {ENTITIES[e][1]} {(data['types'] + ['TOTAL'])[t]}", d[key][e][t], exp))
        add('Célula a célula', f'{len(data["days"])} blocos × 13 linhas × (DU, fila, necessidade, compromisso, realizado, %) — cache independente', pairs)

    # Valores do portal precisam ser idênticos à origem; inconsistências internas da origem só passam se explicadas.
    ok = all(c['ok'] == c['total'] for c in checks if c['group'] != 'Consistência') and all(c['unexplained'] == 0 for c in checks)
    out = dict(generated=dt.datetime.now().isoformat(timespec='seconds'), reference=dict(d1=d1, d0=d0), passed=ok, checks=checks)
    (ROOT / 'dist/validation.js').write_text('window.PORTAL_VALIDATION=' + json.dumps(out, ensure_ascii=False) + ';', encoding='utf-8')
    return out


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')  # console do Windows (cp1252) não imprime Σ/×
    out = run()
    for c in out['checks']:
        flag = 'OK ' if c['ok'] == c['total'] else 'ORI' if c['unexplained'] == 0 else 'DIF'
        print(f"[{flag}] {c['group']:15s} {c['ok']:>7}/{c['total']:<7} {c['desc']}")
        for k in c['causes']:
            print(f"         {'HIPÓTESE ' if k['text'].startswith('[HIPÓTESE') else 'explicada'}: {k['n']:>3} × {k['cause']}")
        for ex in c['examples'][:3 if c['unexplained'] == 0 else 8]:
            if not ex['why']:
                print('         NÃO EXPLICADA:', ex)
    print('Legenda: OK = confere · ORI = inconsistência da própria planilha, causa documentada · DIF = divergência sem explicação')
    nh = sum(c.get('hypotheses', 0) for c in out['checks'])
    if nh:
        print(f'PENDENTE: {nh} ocorrência(s) com causa provável (hipótese) ainda não comprovada — confirmar com os responsáveis (doc. 10)')
    print('RESULTADO:', 'PASS' if out['passed'] else 'FALHAS (ver acima)')
    sys.exit(0 if out['passed'] else 1)
