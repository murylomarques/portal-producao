"""Extração do 'Acompanhamento Produção Regionais' para o portal FUP.

Somente leitura (openpyxl read_only + data_only): usa os valores salvos pelo Excel.
Todas as colunas e linhas são localizadas pelos RÓTULOS da planilha (não por posição fixa),
porque o layout muda ao longo do ano (ex.: jan–fev/2026 não têm a coluna CHIP).
"""
from pathlib import Path
import datetime as dt
import json, math, re, sys, unicodedata
import openpyxl

ROOT = Path(__file__).resolve().parent
SOURCE = ROOT.parent / 'Acompanhamento Produção Regionais 2026 v1_Copia.xlsx'

# 13 linhas padrão da planilha (ordem do Compromissos D0)
ENTITIES = [
    ('CE', 'Central', 'regional', 'CE'), ('CE01', 'Sumaré', 'polo', 'CE'), ('CE02', 'Sorocaba', 'polo', 'CE'), ('CE03', 'Campinas', 'polo', 'CE'),
    ('CO', 'Centro Oeste', 'regional', 'CO'), ('CO01', 'Lençóis Paulista', 'polo', 'CO'), ('CO02', 'Araraquara', 'polo', 'CO'), ('CO03', 'Barretos', 'polo', 'CO'),
    ('SE', 'Sudeste', 'regional', 'SE'), ('SE01', 'Praia Grande', 'polo', 'SE'), ('SE02', 'São José dos Campos', 'polo', 'SE'), ('SE03', 'Jundiaí', 'polo', 'SE'),
    ('DESKTOP', 'Desktop', 'total', ''),
]
TYPES = ['Reparo', 'Instalação', 'MEs', 'PREV', 'Outros', 'Chip', 'Retiradas']  # índice 7 = TOTAL


def norm(s):
    s = unicodedata.normalize('NFKD', str(s)).encode('ascii', 'ignore').decode().upper()
    return re.sub(r'[^A-Z0-9%]+', ' ', s).strip()


ENT_BY_NAME = {norm(n): i for i, (_, n, _, _) in enumerate(ENTITIES)}
ENT_BY_NAME.update({'CENTRAL': 0, 'CENTRO OESTE': 4, 'SUDESTE': 8, 'DESKTOP': 12})
TYPE_BY_LABEL = {'REPARO': 0, 'INSTALACAO': 1, 'INST': 1, 'MES': 2, 'PREV': 3, 'OUTROS': 4, 'CHIP': 5, 'RETIRADAS': 6, 'TOTAL': 7}


def num(v):
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)) and math.isfinite(v):
        return round(float(v), 6)
    if isinstance(v, str) and v.strip() == '0':
        return 0.0
    return None


def is_error(v):
    return isinstance(v, str) and v.startswith('#')


class Grid:
    def __init__(self, ws):
        self.rows = [list(r) for r in ws.iter_rows(values_only=True)]

    def __call__(self, r, c):
        if r < 1 or c < 1 or r > len(self.rows):
            return None
        row = self.rows[r - 1]
        return row[c - 1] if c <= len(row) else None


def entity_rows(g, first_row, col, n=13):
    """Mapeia índice de entidade -> linha, lendo os nomes na coluna `col`."""
    out = {}
    for r in range(first_row, first_row + n + 2):
        v = g(r, col)
        if isinstance(v, str) and norm(v) in ENT_BY_NAME:
            out.setdefault(ENT_BY_NAME[norm(v)], r)
    return out


def type_cols(g, row, c_from, c_to):
    out = {}
    for c in range(c_from, c_to + 1):
        v = g(row, c)
        if isinstance(v, str) and norm(v) in TYPE_BY_LABEL:
            out.setdefault(TYPE_BY_LABEL[norm(v)], c)
    return out


# ---------------------------------------------------------------- Compromissos D0
SECTIONS = {  # rótulo na coluna da data do bloco -> chave
    'DU': 'du', 'FILA TOTAL': 'queue', 'NEC PRODUCAO': 'need', 'COMPR': 'commit',
    '% COMPR X NECESS': 'pctCommitNeed', 'REALIZ': 'actual', '% COMP': 'pctCommit', '% NECESS': 'pctNeed',
}


def section_key(label):
    n = norm(label)
    for k, v in SECTIONS.items():
        if n == k or (k in ('COMPR', 'REALIZ') and n.startswith(k + ' ')):
            return v
    return None


def blank(cols):
    return [[None] * cols for _ in ENTITIES]


def extract_blocks(g, stats):
    starts = []
    for c, v in enumerate(g.rows[0], 1):
        if isinstance(v, dt.datetime):
            starts.append((c, v.date()))
    days = []
    for i, (c0, date) in enumerate(starts):
        if date.year < 2026:
            continue
        c_end = min(starts[i + 1][0] - 1 if i + 1 < len(starts) else c0 + 19, c0 + 19)
        sec_rows = {}
        du_left = {}
        for r in range(2, 124):
            v = g(r, c0)
            if isinstance(v, str):
                k = section_key(v)
                if k and k not in sec_rows:
                    sec_rows[k] = r
        day = {'date': date.isoformat(), 'col': openpyxl.utils.get_column_letter(c0)}
        has_chip = False
        for key, hr in sec_rows.items():
            left = type_cols(g, hr, c0 + 1, c0 + 9)
            if key == 'du':
                du_left = left
            if key == 'queue' and not left:
                # blocos antigos: a Fila não tem cabeçalho próprio; usa os tipos do cabeçalho de DU
                left = dict(du_left)
            # a coluna órfã de Retiradas na Fila não tem cabeçalho: fica de fora automaticamente
            erows = entity_rows(g, hr + 1, c0)
            m = blank(8)
            for e, r in erows.items():
                for t, c in left.items():
                    raw = g(r, c)
                    m[e][t] = num(raw)
                    if is_error(raw):
                        stats['errors'] += 1
            day[key] = m
            has_chip = has_chip or 5 in left
            if key == 'du':
                day['target'] = [num(g(2, left[t])) if t in left else None for t in range(6)]
                right = type_cols(g, hr, c0 + 9, c_end)
                em = blank(6)
                for e, r in entity_rows(g, hr + 1, c0).items():
                    for t, c in right.items():
                        if t < 6:
                            em[e][t] = num(g(r, c))
                day['emax'] = em
            if key == 'commit':
                right = type_cols(g, hr, c0 + 9, c_end)
                en = blank(7)
                for e, r in entity_rows(g, hr + 1, c0).items():
                    for t, c in right.items():
                        if t < 7:
                            en[e][t] = num(g(r, c))
                day['entrAvg'] = en
            if key == 'need':
                lab = {norm(g(hr, c)): c for c in range(c0 + 9, c_end + 1) if isinstance(g(hr, c), str)}
                ef = blank(3)
                for e, r in entity_rows(g, hr + 1, c0).items():
                    for j, k in enumerate(['EFETIV', 'REAL', 'COBERT']):
                        if k in lab:
                            ef[e][j] = num(g(r, lab[k]))
                day['efet'] = ef
        day['layout'] = 7 if has_chip else 6
        stats['blocks'] += 1
        days.append(day)
    days.sort(key=lambda d: d['date'])
    return days


# ---------------------------------------------------------------- abas mensais
MONTHS = {'JAN': 1, 'FEV': 2, 'MAR': 3, 'ABR': 4, 'MAI': 5, 'JUN': 6, 'JUL': 7, 'AGO': 8, 'SET': 9, 'OUT': 10, 'NOV': 11, 'DEZ': 12}


def find_label_row(g, label, col=2, start=1):
    for r in range(start, min(len(g.rows), 130) + 1):
        v = g(r, col)
        if isinstance(v, str) and norm(v).startswith(label):
            return r
    return None


def block_series(g, hr, date_cols):
    """Bloco mensal: hr = linha do rótulo (pesos), hr+1 = datas, entidades abaixo."""
    rows = entity_rows(g, hr + 2, 2)
    total = [None] * 13
    series = [[None] * len(date_cols) for _ in range(13)]
    for e, r in rows.items():
        total[e] = num(g(r, 3))
        for j, c in enumerate(date_cols):
            series[e][j] = num(g(r, c))
    return dict(header=num(g(hr, 3)), total=total, series=series, rows=rows)


def extract_monthly(wb, stats):
    out = []
    for name in wb.sheetnames:
        m = re.fullmatch(r'(Ati|Ret) ([A-Za-z]{3})(\d{2})?', name)
        if not m:
            continue
        mon = MONTHS[m.group(2).upper()]
        year = 2000 + int(m.group(3)) if m.group(3) else 2026
        g = Grid(wb[name])
        service = 'Ativação' if m.group(1) == 'Ati' else 'Retirada'
        meta_hr = find_label_row(g, 'CAPACITY')
        if not meta_hr:
            continue
        date_cols, dates = [], []
        for c in range(5, 45):
            v = g(meta_hr + 1, c)
            if isinstance(v, dt.datetime):
                date_cols.append(c); dates.append(v.date().isoformat())
        weights = [num(g(meta_hr, c)) for c in date_cols]
        rec = dict(month=f'{year}-{mon:02}', service=service, sheet=name, dates=dates, weights=weights)
        meta = block_series(g, meta_hr, date_cols)
        rec['sumWeights'] = meta['header']; rec['target'] = meta['total']; rec['targetDay'] = meta['series']
        real_hr = find_label_row(g, 'REALIZADO', start=meta_hr + 1)
        real = block_series(g, real_hr, date_cols)
        rec['sumWeightsDone'] = real['header']; rec['actual'] = real['total']; rec['actualDay'] = real['series']
        # colunas à direita do bloco de realizado, por rótulo
        heads = {}
        for c in range(date_cols[-1] + 1, date_cols[-1] + 12):
            for rr in ((real_hr, meta_hr) if service == 'Ativação' else (real_hr,)):
                v = g(rr, c)
                if isinstance(v, str):
                    heads.setdefault(norm(v), c)
        def col_of(prefix, nth=0):
            cs = sorted(c for k, c in heads.items() if k.startswith(prefix))
            return cs[nth] if len(cs) > nth else None
        def colvals(c):
            return [num(g(real['rows'][e], c)) if c and e in real['rows'] else None for e in range(13)]
        if service == 'Ativação':
            cp, cc, ce = col_of('PROJECAO'), col_of('% COBERTURA'), col_of('EFETIVIDADE')
            rec['projection'] = colvals(cp); rec['coverage'] = colvals(cc); rec['efetPasted'] = colvals(ce)
            rec['labels'] = {'projection': g(real_hr, cp) if cp else None}
            cm = col_of('META COMERCIAL')
            rec['metaComercial'] = [num(g(meta['rows'][e], cm)) if cm and e in meta['rows'] else None for e in range(13)]
        else:
            cch, cm1, cm2, cp = col_of('CHURN'), col_of('META', 0), col_of('META', 1), col_of('PROJ')
            co, cmt = col_of('OBJETIVO'), col_of('META', 2)
            rec['churn'] = colvals(cch); rec['metaA'] = colvals(cm1); rec['metaB'] = colvals(cm2)
            rec['projection'] = colvals(cp); rec['pctMetaB'] = colvals(co); rec['pctChurn'] = colvals(cmt)
            rec['labels'] = {k: g(real_hr, c) if c else None for k, c in [('churn', cch), ('metaA', cm1), ('metaB', cm2), ('projection', cp)]}
        gap_hr = find_label_row(g, 'GAP', start=real_hr + 1)
        if gap_hr:
            rec['gapDay'] = block_series(g, gap_hr, date_cols)['series']
        fc_hr = find_label_row(g, 'FORECAST', start=real_hr + 1)
        if fc_hr:
            fc = block_series(g, fc_hr, date_cols)
            rec['sumWeightsLeft'] = fc['header']; rec['balance'] = fc['total']; rec['forecastDay'] = fc['series']
        if service == 'Ativação':
            ef_hr = find_label_row(g, 'EFETIVIDADE', start=real_hr + 1)
            if ef_hr:
                ef = block_series(g, ef_hr, date_cols)
                rec['efetMonth'] = ef['total']; rec['efetDay'] = ef['series']
                lab = {norm(g(ef_hr + 1, c)): c for c in range(date_cols[-1] + 1, date_cols[-1] + 8) if isinstance(g(ef_hr + 1, c), str)}
                cmeta = next((c for k, c in lab.items() if k.startswith('META')), None)
                rec['efetTarget'] = [num(g(ef['rows'][e], cmeta)) if cmeta and e in ef['rows'] else None for e in range(13)]
            v_hr = find_label_row(g, 'VENDAS', start=real_hr + 1)
            if v_hr:
                vd = block_series(g, v_hr, date_cols)
                rec['sales'] = vd['total']; rec['salesDay'] = vd['series']
        stats['monthly'] += 1
        out.append(rec)
    out.sort(key=lambda r: (r['month'], r['service']))
    return out


# ---------------------------------------------------------------- CAPACITY
CAP_BLOCKS = [('mopPlan', 'HC MOP COMPROMISS'), ('mopActual', 'HC MOP PRESENTE'), ('mopConf', 'HC MOP CONFIRM'),
              ('motPlan', 'HC MOT COMPROMISS'), ('motActual', 'HC MOT PRESENTE'), ('motConf', 'HC MOT CONFIRM')]


def extract_capacity(wb):
    g = Grid(wb['CAPACITY'])
    cols, dates = [], []
    for c, v in enumerate(g.rows[1], 1):
        if isinstance(v, dt.datetime) and c >= 12:
            cols.append(c); dates.append(v.date().isoformat())
    out = dict(dates=dates)
    for key, label in CAP_BLOCKS:
        hr = find_label_row(g, label, col=1)
        m = [[None] * len(cols) for _ in range(13)]
        if hr:
            for e, r in entity_rows(g, hr, 2).items():
                for j, c in enumerate(cols):
                    m[e][j] = num(g(r, c))
        out[key] = m
    return out


# ---------------------------------------------------------------- COMPROMISSOS_D0.xlsx (formulário do dia)
COMMIT_SOURCE = ROOT.parent / 'COMPROMISSOS_D0.xlsx'
D0_COLS = {'REPARO': 0, 'INSTALACAO': 1, 'MES': 2, 'PREV': 3, 'OUTROS': 4, 'CHIP': 5, 'RETIRADA': 6, 'RETIRADAS': 6, 'TOTAL': 7}


def _sheet_matrix(g, ncols_map):
    """Aba no formato linha 1 = cabeçalhos, coluna A = CENTRAL..DESKTOP. Localiza por rótulo."""
    cols = {}
    for c, v in enumerate(g.rows[0], 1):
        if isinstance(v, str) and norm(v) in ncols_map:
            cols.setdefault(ncols_map[norm(v)], c)
    rows = entity_rows(g, 2, 1)
    width = max(ncols_map.values()) + 1
    m = [[None] * width for _ in ENTITIES]
    for e, r in rows.items():
        for t, c in cols.items():
            m[e][t] = num(g(r, c))
    return m, cols, rows


def extract_commit_file(path=COMMIT_SOURCE):
    """Lê NECESSIDADE_PROD e COMPROMISSO_FUP (as abas que o D0 consolida corretamente).
    PBI_COMPR e Consolidado_Compromisso_Planj. NÃO são usadas: têm #REF! e linhas trocadas (ver auditoria)."""
    if not Path(path).exists():
        return None
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    gn, gc = Grid(wb['NECESSIDADE_PROD']), Grid(wb['COMPROMISSO_FUP'])
    date = next((v.date() for r in gn.rows for v in r[:1] if isinstance(v, dt.datetime)), None)
    need, _, _ = _sheet_matrix(gn, D0_COLS)
    commit, _, _ = _sheet_matrix(gc, D0_COLS)
    hc, _, _ = _sheet_matrix(gc, {'HC INT': 0, 'HC EPS': 1})
    props = wb.properties
    wb.close()
    return dict(source=Path(path).name, date=date.isoformat() if date else None,
                modified=props.modified.isoformat() if props.modified else None,
                need=need, commit=commit, hc=hc)


def merge_commit_file(days, cf):
    """O compromisso de D0 é digitado no COMPROMISSOS_D0.xlsx antes de ser colado no Acompanhamento.
    Regra: o Acompanhamento prevalece; o arquivo só preenche o compromisso se o bloco do dia estiver vazio."""
    if not cf or not cf['date']:
        return None
    day = next((d for d in days if d['date'] == cf['date']), None)
    info = dict(source=cf['source'], date=cf['date'], modified=cf['modified'], block=day and day['col'], used=False)
    if day is None:
        return info
    day['hcCommit'] = cf['hc']
    empty = all(v is None for row in day.get('commit', []) for v in row)
    if empty:
        day['commit'] = [row[:8] for row in cf['commit']]
        day['commitSource'] = cf['source']
        info['used'] = True
    info['fileNeed'] = cf['need']; info['fileCommit'] = cf['commit']
    return info


def extract(source=SOURCE, commit_source=COMMIT_SOURCE):
    wb = openpyxl.load_workbook(source, read_only=True, data_only=True)
    stats = dict(blocks=0, monthly=0, errors=0)
    days = extract_blocks(Grid(wb['Compromissos D0']), stats)
    monthly = extract_monthly(wb, stats)
    capacity = extract_capacity(wb)
    props = wb.properties
    wb.close()
    commit_file = merge_commit_file(days, extract_commit_file(commit_source))
    name = getattr(source, 'name', None) or Path(str(source)).name
    if not isinstance(name, str) or not name.lower().endswith(('.xlsx', '.xlsm')):
        name = 'planilha importada'
    return dict(
        source=Path(name).name, sourceModified=props.modified.isoformat() if props.modified else None,
        extracted=dt.datetime.now().isoformat(timespec='seconds'),
        entities=[dict(code=c, name=n, level=l, regional=r) for c, n, l, r in ENTITIES],
        types=TYPES, days=days, monthly=monthly, capacity=capacity, stats=stats, commitFile=commit_file,
    )


def save(data):
    (ROOT / 'dist').mkdir(exist_ok=True)
    (ROOT / 'dist' / 'data.js').write_text('window.PORTAL_DATA=' + json.dumps(data, ensure_ascii=False, separators=(',', ':')) + ';', encoding='utf-8')


if __name__ == '__main__':
    data = extract(Path(sys.argv[1]) if len(sys.argv) > 1 else SOURCE)
    save(data)
    s = data['stats']
    print(f"Extraídos {s['blocks']} dias (Compromissos D0), {s['monthly']} abas mensais, "
          f"{len(data['capacity']['dates'])} datas de capacity; {s['errors']} células com erro na origem.")
    cf = data.get('commitFile')
    if cf:
        print(f"{cf['source']} ({cf['date']}): " + ('compromisso D0 aplicado ao bloco ' + str(cf['block']) if cf['used']
              else 'Acompanhamento já tem o compromisso do dia; arquivo usado só para conferência'))
