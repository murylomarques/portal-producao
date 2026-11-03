# FUP · Produção regional

Abra **Iniciar Portal.cmd** para iniciar o portal em http://127.0.0.1:8765. Mantenha a janela do servidor aberta durante o uso.

**Os dados vêm do banco `dw_fup` (MySQL 172.29.5.3), não de planilha.** O `server.py` monta `data.js` e `validation.js` a partir do banco a cada abertura (cache de 60 s), pelo `db_portal.py`, com as credenciais de `Desktop\FUP\.env`. O banco é alimentado pelo robô diário das 07:13 e pelas tabelas manuais `man_*` (ver `Desktop\FUP\dw_fup\README.md`). Aberto direto do disco (`dist/index.html`), o portal apenas avisa que precisa do servidor.

**Período do realizado (topo):** De/Até ou atalho Mês, no máximo 1 ano, vale para todas as vistas. Um dia = valores do banco para o dia; vários dias = soma dos dias (% = Σ realizado ÷ Σ compromisso). D0 (necessidade, compromisso, fila e DU de hoje) = dia seguinte ao "Até".

**Conferência:** mostra a última execução do robô (`log_execucao`) e as conferências automáticas (`chk_conciliacao`).

Teste no navegador: `python ..\dw_fup\teste_portal_db.py` (com o servidor aberto).

Dependências: Python e pymysql.

Legado (não usado pelo portal; referência da auditoria das planilhas): `extract.py`, `validate.py`, `known_issues.json`, `legado_planilha/` (antigo `data.js` gerado da planilha) e `smoke.cjs`.

O portal é local e não foi publicado na internet. Para publicação corporativa é necessário definir hospedagem e acesso.
