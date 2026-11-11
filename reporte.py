"""Imagens de reporte do FUP (sem tela): gera os PNGs no padrão das imagens enviadas no WhatsApp, para um robô pegar e enviar.

Uso:  python reporte.py                      -> D0 = última foto do banco; pasta ..\\imagesdereporte\\saida\\AAAA-MM-DD
      python reporte.py --d0 2026-11-09      -> refaz um dia
      python reporte.py --forcar             -> gera mesmo se o robô do dia falhou ou a última foto não for de hoje
      python reporte.py --json dados.json    -> lê {data, validation} de um arquivo (teste, sem banco)

Números = os mesmos do portal (db_portal.build()). Só dois dados não existem no portal e são lidos aqui:
  entrante D-1 dos 8 tipos (foto da manhã seguinte, fat_snapshot_diario.entr_d1; sem a foto, fat_producao_diaria.entrante)
  fila de Retiradas da foto D0 (vw_bloco_diario)
Segunda-feira: D-1 = sábado + domingo somados (FDS), como no portal; Realizado/Entrante saem um por dia.

Cada PNG é gravado como .tmp e renomeado quando completo; ao final é criado pronto.ok (sinal para o robô de envio).
Sai com código 1, sem pronto.ok, se o robô do dia falhou ou a foto D0 não é de hoje (a não ser com --forcar).
"""
import argparse, datetime as dt, json, os, sys
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

AQUI = Path(__file__).resolve().parent
SAIDA = AQUI.parent / 'imagesdereporte' / 'saida'
SC = 2  # escala do desenho (nitidez no WhatsApp)
NT = 7  # tipos sem TOTAL
REG = [0, 4, 8]
MESC = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

# ------------------------------------------------------------------ números (pt-BR, arredondamento comercial como o Excel)


def _r(v, dec):
    return Decimal(str(v)).quantize(Decimal(1).scaleb(-dec), ROUND_HALF_UP)


def nf(v, dec=0, vazio=''):
    if v is None:
        return vazio
    s = f'{_r(v, dec):,.{dec}f}'
    return s.replace(',', '_').replace('.', ',').replace('_', '.')


def pc(v, dec=0, vazio='-'):
    return vazio if v is None else nf(v * 100, dec) + '%'


def ratio(a, b):
    return a / b if a is not None and b else None


def soma(vs):
    vs = [v for v in vs if v is not None]
    return sum(vs) if vs else None


def add(a, b):
    return None if a is None and b is None else (a or 0) + (b or 0)


def d_iso(s):
    return dt.date.fromisoformat(s)


def ddmm(s):
    return d_iso(s).strftime('%d/%m')

# ------------------------------------------------------------------ desenho de tabelas


_FONTES = {}


def fonte(px, bold=False, italic=False):
    nome = {(0, 0): 'calibri.ttf', (1, 0): 'calibrib.ttf', (0, 1): 'calibrii.ttf', (1, 1): 'calibriz.ttf'}[(bool(bold), bool(italic))]
    k = (nome, px)
    if k not in _FONTES:
        try:
            _FONTES[k] = ImageFont.truetype(nome, px * SC)
        except OSError:
            _FONTES[k] = ImageFont.truetype('arialbd.ttf' if bold else 'arial.ttf', px * SC)
    return _FONTES[k]


def C(txt='', bg='#ffffff', fg='#111111', b=False, i=False, px=14, al='c', span=1, borda=None):
    return dict(txt=txt, bg=bg, fg=fg, b=b, i=i, px=px, al=al, span=span, borda=borda)


def tabela(cols, linhas, grade='#ffffff', moldura=None):
    """cols: larguras; linhas: [(altura, [células])]. Desenha com escala SC."""
    W, H = sum(cols), sum(h for h, _ in linhas)
    im = Image.new('RGB', (W * SC, H * SC), '#ffffff')
    dr = ImageDraw.Draw(im)
    y = 0
    for h, cel in linhas:
        x, ci = 0, 0
        for c in cel:
            w = sum(cols[ci:ci + c['span']])
            box = (x * SC, y * SC, (x + w) * SC - 1, (y + h) * SC - 1)
            dr.rectangle(box, fill=c['bg'], outline=c['borda'] or grade, width=1)
            if c['txt'] != '':
                f = fonte(c['px'], c['b'], c['i'])
                tw = dr.textlength(str(c['txt']), font=f)
                pad = 6 * SC
                tx = box[0] + pad if c['al'] == 'l' else box[2] - pad - tw if c['al'] == 'r' else (box[0] + box[2] - tw) / 2
                dr.text((tx, (box[1] + box[3]) / 2), str(c['txt']), font=f, fill=c['fg'], anchor='lm')
            x += w
            ci += c['span']
        y += h
    if moldura:
        dr.rectangle((0, 0, W * SC - 1, H * SC - 1), outline=moldura, width=SC)
    return im


def empilhar(ims, gap=24):
    W = max(i.width for i in ims)
    H = sum(i.height for i in ims) + gap * SC * (len(ims) - 1)
    out = Image.new('RGB', (W, H), '#ffffff')
    y = 0
    for i in ims:
        out.paste(i, (0, y))
        y += i.height + gap * SC
    return out

# ------------------------------------------------------------------ estilo roxo (Realizado, Entrante, DU Controle, Fila Total)


ROXO, AMAR, AZUL = '#7030a0', '#ffc000', '#ddebf7'


def roxo_linhas(E, vals, fmt, share, extra_cls=None):
    """Linhas Reg/Gerência: regionais em azul, polos com código + território, Total (Desktop)."""
    out = []
    for e in list(range(12)) + [12]:
        ent = E[e]
        reg = ent['level'] != 'polo'
        if reg:
            nome = 'Total' if e == 12 else ent['name']
            cel = [C(nome, AZUL, b=True, px=16, al='l', span=2)]
        else:
            cel = [C(ent['code'], al='l', px=12), C(ent['name'].upper(), al='l', px=12)]
        for j, v in enumerate(vals(e)):
            c = C(fmt(v), AZUL if reg else '#ffffff', b=reg, px=16 if reg else 15)
            if extra_cls:
                extra_cls(c, e, j, v)
            cel.append(c)
        cel.append(C(pc(share(e), 0, ''), AZUL if reg else '#ffffff', b=reg, px=16 if reg else 15))
        out.append((26 if reg else 25, cel))
    return out


def share_de(tot):
    """Share como na planilha: regional ÷ Desktop, polo ÷ sua regional, Desktop = 100%."""
    def s(e):
        if e == 12:
            return 1.0 if tot(12) else None
        pai = 12 if e in REG else e - (e % 4)
        return ratio(tot(e), tot(pai))
    return s


def img_realizado_entrante(E, T, d_iso_, actual, entr):
    cols = [130, 230] + [118] * 8 + [100]
    def bloco(titulo, M):
        tot = lambda e: M[e][7]
        head = [(26, [C(ddmm(d_iso_) + '/' + d_iso_[:4], ROXO, '#ffffff', b=True, px=17, span=1), C(titulo, ROXO, '#ffffff', px=17, al='l', span=10)]),
                (26, [C('Reg//Gerencia', AMAR, b=True, px=15, al='l'), C('Território', AMAR, b=True, px=15, al='l')]
                     + [C(t, AMAR, b=True, px=15) for t in T] + [C('TOTAL', AMAR, b=True, px=15), C('Share', AMAR, b=True, px=15)])]
        return tabela(cols, head + roxo_linhas(E, lambda e: M[e][:8], lambda v: nf(v), share_de(tot)), moldura='#222222')
    return empilhar([bloco('REALIZADO', actual), bloco('ENTRANTE', entr)])


def du_roxo(du, alvo):
    """Faixas tiradas da imagem de exemplo (DU ÷ meta): < 0,75 verde escuro · ≤ 1 verde · ≤ 1,25 amarelo · > 1,25 vermelho."""
    if not alvo:
        return '#f2f2f2', '#888888'
    r = (du or 0) / alvo
    if r < 0.75:
        return '#2e9b5f', '#ffffff'
    if r <= 1 + 1e-9:
        return '#a9d08e', '#375623'
    if r <= 1.25 + 1e-9:
        return '#ffe699', '#c65911'
    return '#ff9b9b', '#ffffff'


def img_du_fila_roxo(E, T, d0, filaRet):
    data = ddmm(d0['date']) + '/' + d0['date'][:4]
    Q = d0['queue']
    fila6 = lambda e: soma(Q[e][:6])
    sh = share_de(fila6)
    # DU CONTROLE
    cols = [130, 230] + [118] * 6 + [118]
    head = [(30, [C(data, '#00b050', '#ffffff', b=True, px=17), C('DU CONTROLE', ROXO, '#ffffff', b=True, px=17, span=8)]),
            (30, [C('', '#ffffff'), C('META DU', ROXO, '#ffffff', b=True, px=17)] + [C(nf(d0['target'][t], 1), ROXO, '#ffffff', b=True, px=19) for t in range(6)] + [C('', ROXO)]),
            (26, [C('Reg//Gerencia', AMAR, b=True, px=15, al='l'), C('Território', AMAR, b=True, px=15, al='l')] + [C(t, AMAR, b=True, px=15) for t in T[:6]] + [C('Share', AMAR, b=True, px=15)])]

    def cor(c, e, j, v):
        c['bg'], c['fg'] = du_roxo(v, d0['target'][j])
        c['b'] = True
    du = tabela(cols, head + roxo_linhas(E, lambda e: d0['du'][e][:6], lambda v: nf(v or 0, 2), sh, cor), grade='#ffffff', moldura='#222222')  # DU sem base = 0,00, como a planilha
    # FILA TOTAL (Retiradas à parte; TOTAL e Share sem Retiradas, como na planilha)
    cols = [130, 230] + [118] * 6 + [118, 118, 100]
    head = [(40, [C(data, ROXO, '#ffffff', b=True, px=17), C('FILA TOTAL', ROXO, '#ffffff', b=True, px=17, al='l', span=10)]),
            (30, [C('Reg//Gerencia', AMAR, b=True, px=15, al='l'), C('Território', AMAR, b=True, px=15, al='l')]
                 + [C(t, AMAR, b=True, px=15) for t in T[:6]] + [C('Retiradas', AMAR, b=True, px=15), C('TOTAL', AMAR, b=True, px=15), C('Share', AMAR, b=True, px=15)])]

    def ret(c, e, j, v):
        if j == 6:
            c['bg'] = '#f2f2f2'
    fila = tabela(cols, head + roxo_linhas(E, lambda e: Q[e][:6] + [filaRet.get(e), fila6(e)], lambda v: nf(v), sh, ret), moldura='#222222')
    return empilhar([du, fila])

# ------------------------------------------------------------------ estilo escuro DESKTOP (DU, Fila, Necessidade, Compromisso, Resultado, Capacity)


ESC, OURO = '#222b35', '#ffc000'
G, Y, O, P = '#c6e0b4', '#ffe699', '#f4b183', '#b4a7d6'


def esc_cab(chave, tipos, total=True, px=15):
    cel = [C(chave, OURO, b=True, px=17, al='l')] + [C(t, '#d9d9d9' if i % 2 else '#f2f2f2', b=False, px=px) for i, t in enumerate(tipos)]
    if total:
        cel.append(C('TOTAL', ESC, OURO, b=True, i=True, px=17))
    return (28, cel)


def esc_linhas(E, vals, cls, px=15, alt=26, desk_bg=None):
    out = []
    for e in range(13):
        ent, lv = E[e], E[e]['level']
        if lv == 'regional':
            lab = C(ent['name'].upper(), '#a6a6a6', '#ffffff', px=15, al='l')
        elif lv == 'polo':
            lab = C('  ' + ent['name'], '#d9d9d9', '#222222', px=14, al='l')
        else:
            lab = C('DESKTOP', ESC, OURO, b=True, i=True, px=17)
        cel = [lab]
        for j, v in enumerate(vals(e)):
            bg, fg, txt = cls(e, j, v)
            c = C(txt, bg, fg, b=lv != 'polo', px=px + (3 if lv != 'polo' else 0))
            if lv == 'total' and desk_bg:
                c['bg'], c['fg'] = desk_bg
            cel.append(c)
        out.append((alt if lv == 'polo' else alt + 4, cel))
    return out


def du_esc(du, alvo):
    """Mesma regra do Resumo do portal (DU ÷ alvo): ≤ 1 verde · ≤ 1,25 amarelo · ≤ 1,5 laranja · > 1,5 roxo."""
    if not alvo:
        return '#f2f2f2'
    r = (du or 0) / alvo
    return '#a9d08e' if r <= 1 + 1e-9 else '#ffff99' if r <= 1.25 + 1e-9 else '#ffd966' if r <= 1.5 + 1e-9 else P


def pct_comp(v):
    """% Comp. / % Necess. (faixas da imagem de exemplo): ≥ 100% verde · ≥ 80% amarelo · ≥ 70% laranja · abaixo roxo; sem base ('-') verde."""
    if v is None:
        return G
    return G if v >= 1 else Y if v >= .8 else O if v >= .7 else P  # valor cheio, como a planilha (69,6% mostra 70% e fica roxo)


def pct_cob(v):
    """Coberturas (capacity e efetividade, faixas do portal): ≥ 100% verde · ≥ 90% amarelo · ≥ 80% laranja · abaixo roxo."""
    if v is None:
        return '#ffffff'
    return G if v >= 1 else '#ffff99' if v >= .9 else '#ffd966' if v >= .8 else P  # valor cheio (89,9% mostra 90% e fica laranja)


def img_resumo_d0(E, T, d0):
    """DU, Fila Total, Nec. Produção e Compromisso do D0 (imagem '09/nov')."""
    cols = [212] + [106] * 8
    d = d_iso(d0['date'])
    alvo = d0['target']
    du_head = [(28, [C(f'{d.day:02d}/{MESC[d.month - 1]}', ESC, OURO, b=True, px=22, span=1), C('DU CONTROLE', ESC, OURO, b=True, i=True, px=16, al='l', span=6)]),
               (24, [C('', ESC)] + [C(nf(alvo[t], 1), ESC, OURO, b=True, px=14) for t in range(6)])]
    du = tabela(cols[:7], du_head + [esc_cab('DU', T[:6], total=False)] + esc_linhas(
        E, lambda e: d0['du'][e][:6], lambda e, j, v: (du_esc(v, alvo[j]), '#111111', nf(v or 0, 2)), alt=22))
    Q = d0['queue']
    fila = tabela(cols[:7], [esc_cab('Fila Total', T[:6], total=False)] + esc_linhas(
        E, lambda e: Q[e][:6], lambda e, j, v: ('#c6e0b4' if v == 0 else '#ffff99', '#111111', nf(v)), alt=22))
    nec = tabela(cols, [esc_cab('Nec. Produção', T)] + esc_linhas(
        E, lambda e: d0['need'][e][:8], lambda e, j, v: ('#ffffff', '#111111', nf(v)), desk_bg=('#bfbfbf', '#111111')))
    need, com = d0['need'], d0['commit']
    comp = tabela(cols, [esc_cab(f"Compr. {ddmm(d0['date'])}", T)] + esc_linhas(
        E, lambda e: com[e][:8],
        lambda e, j, v: (G if j < 7 and v is not None and need[e][j] is not None and v >= need[e][j] else '#ffff99', '#111111', nf(v))))
    return empilhar([du, fila, nec, comp])


def img_resultado_d1(E, T, p):
    """Compr., Realiz., % Comp. e % Necess. do D-1 (na segunda: FDS)."""
    cols = [212] + [106] * 8
    rot = p['rot']
    need, com, act = p['need'], p['commit'], p['actual']
    comp = tabela(cols, [esc_cab(f'Compr. {rot}', T)] + esc_linhas(
        E, lambda e: com[e][:8],
        lambda e, j, v: (G if j < 7 and v is not None and need[e][j] is not None and v >= need[e][j] else '#ffff99', '#111111', nf(v))))
    real = tabela(cols, [esc_cab(f'Realiz. {rot}', T)] + esc_linhas(
        E, lambda e: act[e][:8], lambda e, j, v: ('#ffffff', '#111111', nf(v)), desk_bg=('#bfbfbf', '#111111')))
    pcom = tabela(cols, [esc_cab('% Comp.', T)] + esc_linhas(
        E, lambda e: [ratio(act[e][t], com[e][t]) for t in range(8)], lambda e, j, v: (pct_comp(v), '#111111', pc(v)), alt=22))
    pnec = tabela(cols, [esc_cab('% Necess.', T)] + esc_linhas(
        E, lambda e: [ratio(act[e][t], need[e][t]) for t in range(8)], lambda e, j, v: (pct_comp(v), '#111111', pc(v)), alt=22))
    return empilhar([comp, real, pcom, pnec])


def img_efetividade(p):
    """EFETIV / REAL / COBERT (mesmas linhas das outras tabelas, sem a coluna de nomes, como no exemplo)."""
    cols = [150, 150, 150]
    head = [(36, [C('EFETIV', '#d9d9d9', b=True, px=17), C('REAL', '#f2f2f2', b=True, px=17), C('COBERT', '#bfbfbf', b=True, px=17)])]
    linhas = []
    for e in range(13):
        ef, real, cob = p['efet'][e]
        forte = p['E'][e]['level'] != 'polo'
        px = 19 if forte else 17
        linhas.append((32 if forte else 31, [C(pc(ef, 1, ''), b=forte, px=px), C(pc(real, 1, ''), b=forte, px=px),
                                             C(pc(cob, 0, ''), pct_cob(cob), b=forte, px=px + 3 if forte else px)]))
    return tabela(cols, head + linhas)


CAPK = ['mopPlan', 'motPlan', 'mopConf', 'motConf', 'mopActual', 'motActual']


def cap_em(cap, data, e):
    if data not in cap['dates']:
        return None
    i = cap['dates'].index(data)
    return {k: cap[k][e][i] for k in CAPK}


def cap_d1(cap, d0, e):
    """D-1 do capacity como no portal: segunda-feira soma sábado + domingo."""
    x = d_iso(d0)
    if x.weekday() == 0:
        a, b = cap_em(cap, (x - dt.timedelta(2)).isoformat(), e), cap_em(cap, (x - dt.timedelta(1)).isoformat(), e)
        if not a or not b:
            return None
        return {k: add(a[k], b[k]) for k in CAPK}
    return cap_em(cap, (x - dt.timedelta(1)).isoformat(), e)


def cap_lab(e, E):
    lv = E[e]['level']
    if lv == 'regional':
        return C(E[e]['name'].upper(), '#a6a6a6', '#ffffff', px=16, al='l')
    if lv == 'polo':
        return C('  ' + E[e]['name'], '#d9d9d9', '#222222', px=15, al='l')
    return C('DESKTOP', '#000000', OURO, b=True, i=True, px=16)


def img_capacity_d1(E, cap, d0):
    cols = [200] + [153] * 6 + [143, 143, 143]
    head = [(32, [C('', '#ffffff'), C('CAPACITY D-1', ESC, OURO, b=True, i=True, px=19, span=4), C('', ESC, span=2),
                  C('Planejedo X Real', ESC, OURO, b=True, i=True, px=19, span=3)]),
            (24, [C('', '#ffffff'), C('PLANEJADO', '#d9d9d9', px=15, span=2), C('CONF. COP', '#d9d9d9', px=15, span=2), C('REAL', '#f2f2f2', px=15, span=2),
                  C('COBERT PROPRIO', '#f2f2f2', b=True, px=14), C('COBERT TERCEIRA', '#f2f2f2', b=True, px=14), C('COBERT TOTAL', '#f2f2f2', b=True, px=14)]),
            (28, [C('CAPACITY', '#000000', OURO, b=True, i=True, px=18, al='l')] + [C(h, '#d9d9d9' if k < 4 else '#f2f2f2', b=True, px=15) for k, h in enumerate(['HC PROPRIO', 'HC TERCEIRO'] * 3)]
                 + [C('', '#f2f2f2', span=3)])]
    linhas = []
    for e in range(13):
        c = cap_d1(cap, d0, e) or {}
        lv = E[e]['level']
        forte = lv != 'polo'
        # como no portal: sem real lançado, a cobertura sai 0%
        cob = [ratio(c.get('mopActual') if c.get('mopActual') is not None else (0 if c.get('mopPlan') else None), c.get('mopPlan')),
               ratio(c.get('motActual') if c.get('motActual') is not None else (0 if c.get('motPlan') else None), c.get('motPlan')),
               ratio((c.get('mopActual') or 0) + (c.get('motActual') or 0), (c.get('mopPlan') or 0) + (c.get('motPlan') or 0)) if c else None]
        bg = '#a6a6a6' if lv == 'regional' else '#000000' if lv == 'total' else '#ffffff'
        fg = OURO if lv == 'total' else '#111111'
        cel = [cap_lab(e, E)] + [C(nf(c.get(k)), bg, fg, b=forte, px=15) for k in CAPK]
        cel += [C(pc(v, 0, ''), pct_cob(v), b=forte, px=19 if forte else 15) for v in cob]
        linhas.append((34 if forte else 30, cel))
    return tabela(cols, head + linhas)


def img_capacity_plan(E, cap, d0):
    cols = [245, 188, 188]
    head = [(36, [C('', '#ffffff'), C('PLANEJADO', '#d9d9d9', px=17, span=2)]),
            (40, [C('CAPACITY', '#000000', OURO, b=True, i=True, px=20, al='l'), C('HC PROPRIO', '#d9d9d9', b=True, px=17), C('HC TERCEIRO', '#d9d9d9', b=True, px=17)])]
    linhas = []
    for e in range(13):
        c = cap_em(cap, d0, e) or {}
        lv = E[e]['level']
        bg = '#a6a6a6' if lv == 'regional' else '#000000' if lv == 'total' else '#ffffff'
        fg = OURO if lv == 'total' else '#111111'
        lab = cap_lab(e, E)
        lab['px'] += 2
        linhas.append((37, [lab, C(nf(c.get('mopPlan')), bg, fg, b=lv != 'polo', px=17), C(nf(c.get('motPlan')), bg, fg, b=lv != 'polo', px=17)]))
    return tabela(cols, head + linhas)

# ------------------------------------------------------------------ dados


def periodo_d1(days, i0):
    """D-1 do reporte: na segunda, sábado + domingo (como o botão Fim de semana do portal); senão o dia anterior."""
    d0 = days[i0]
    x = d_iso(d0['date'])
    fds = x.weekday() == 0 and i0 >= 2 and d_iso(days[i0 - 1]['date']).weekday() == 6 and d_iso(days[i0 - 2]['date']).weekday() == 5
    if not fds:
        d1 = days[i0 - 1]
        return dict(dias=[d1], rot=ddmm(d1['date']), need=d1['need'], commit=d1['commit'], actual=d1['actual'], efet=d1['efet'])
    ds = [days[i0 - 2], days[i0 - 1]]
    sm = lambda k: [[add(ds[0][k][e][t], ds[1][k][e][t]) for t in range(8)] for e in range(13)]
    efet = []
    for e in range(13):
        p = [d.get('efetParts', [None] * 13)[e] for d in ds]
        if not all(p):
            efet.append([None] * 3)
            continue
        s = lambda j: add(p[0][j], p[1][j])
        ef, real = ratio(s(0), s(1)), ratio(s(2), s(3))
        efet.append([ef, real, ratio(real, ef)])
    return dict(dias=ds, rot='FDS', need=sm('need'), commit=sm('commit'), actual=sm('actual'), efet=efet)


def ler_extras(datas_entr, d0):
    """Entrante D-1 (8 tipos) dos dias pedidos e fila de Retiradas da foto D0, direto do dw_fup."""
    import db_portal
    db = db_portal.conn.destino()
    cur = db.cursor()
    entr = {x: {} for x in datas_entr}
    for x in datas_entr:
        prox = (d_iso(x) + dt.timedelta(1)).isoformat()
        for e, t, v in db_portal.q(cur, '''SELECT e.entidade, s.tipo, SUM(s.entr_d1) FROM fat_snapshot_diario s
                                           JOIN vw_entidade e ON e.cod_ger = s.cod_ger WHERE s.data_ref = %s GROUP BY e.entidade, s.tipo''', (prox,)):
            if e in db_portal.EI and t in db_portal.TI and v is not None:
                entr[x][f'{db_portal.EI[e]},{db_portal.TI[t]}'] = float(v)
        for e, t, v in db_portal.q(cur, '''SELECT e.entidade, p.tipo, SUM(p.entrante) FROM fat_producao_diaria p
                                           JOIN vw_entidade e ON e.cod_ger = p.cod_ger WHERE p.data = %s GROUP BY e.entidade, p.tipo''', (x,)):
            if e in db_portal.EI and t in db_portal.TI and v is not None:
                entr[x].setdefault(f'{db_portal.EI[e]},{db_portal.TI[t]}', float(v))  # sem a foto da manhã seguinte
    ret = {}
    for e, v in db_portal.q(cur, "SELECT entidade, fila FROM vw_bloco_diario WHERE data_ref = %s AND tipo = 'RETIRADA'", (d0,)):
        if e in db_portal.EI and v is not None:
            ret[str(db_portal.EI[e])] = float(v)
    db.close()
    return dict(entrante=entr, filaRet=ret)


def matriz_entr(m):
    M = [[m.get(f'{e},{t}') for t in range(NT)] for e in range(13)]
    for r in M:
        r.append(soma(r))
    return M


def gravar(im, pasta, nome):
    tmp = pasta / (nome + '.tmp')
    im.save(tmp, 'PNG', optimize=True)
    os.replace(tmp, pasta / nome)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--d0')
    ap.add_argument('--saida', default=str(SAIDA))
    ap.add_argument('--json', help='arquivo {data, validation[, extras]} (teste sem banco)')
    ap.add_argument('--forcar', action='store_true')
    a = ap.parse_args()

    if a.json:
        J = json.load(open(a.json, encoding='utf-8'))
        data, val, extras = J['data'], J.get('validation') or {}, J.get('extras')
    else:
        sys.path.insert(0, str(AQUI))
        import db_portal
        data, val = db_portal.build()
        extras = None
    days = data['days']
    i0 = next((i for i, d in enumerate(days) if d['date'] == a.d0), None) if a.d0 else len(days) - 1
    if i0 is None or i0 < 1:
        sys.exit(f'D0 {a.d0} não encontrado nos dados.')
    d0 = days[i0]
    if not a.forcar and not a.d0:
        if not val.get('passed'):
            sys.exit('Robô do dia não terminou OK (validation.passed = false): reporte não gerado. Use --forcar para gerar assim mesmo.')
        if d0['date'] != dt.date.today().isoformat():
            sys.exit(f"Última foto do banco é {d0['date']}, não hoje: reporte não gerado. Use --forcar para gerar assim mesmo.")
    p = periodo_d1(days, i0)
    datas = [d['date'] for d in p['dias']]
    if extras is None:
        extras = ler_extras(datas, d0['date'])
    E, T = data['entities'], data['types']
    p['E'] = E

    pasta = Path(a.saida) / d0['date']
    pasta.mkdir(parents=True, exist_ok=True)
    (pasta / 'pronto.ok').unlink(missing_ok=True)
    feitos = []
    for n, x in enumerate(datas, 1):
        dd = next(d for d in days if d['date'] == x)
        nome = f'01_realizado_entrante_{x}.png'
        gravar(img_realizado_entrante(E, T, x, dd['actual'], matriz_entr(extras['entrante'].get(x, {}))), pasta, nome)
        feitos.append(nome)
    fila_ret = {int(k): v for k, v in extras['filaRet'].items()}
    for nome, im in [('02_du_fila_total.png', img_du_fila_roxo(E, T, d0, fila_ret)),
                     ('03_resumo_d0.png', img_resumo_d0(E, T, d0)),
                     ('04_resultado_d1.png', img_resultado_d1(E, T, p)),
                     ('05_efetividade.png', img_efetividade(p)),
                     ('06_capacity_d1.png', img_capacity_d1(E, data['capacity'], d0['date'])),
                     ('07_capacity_planejado.png', img_capacity_plan(E, data['capacity'], d0['date']))]:
        gravar(im, pasta, nome)
        feitos.append(nome)
    (pasta / 'pronto.ok').write_text(json.dumps(dict(d0=d0['date'], d1=datas, gerado=dt.datetime.now().isoformat(timespec='seconds'), arquivos=feitos),
                                                ensure_ascii=False, indent=1), encoding='utf-8')
    print(f'{len(feitos)} imagens em {pasta}')


if __name__ == '__main__':
    main()
