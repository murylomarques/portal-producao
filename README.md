# FUP · Produção regional

Abra **Iniciar Portal.cmd** para iniciar o portal em http://127.0.0.1:8765. Mantenha a janela do servidor aberta durante o uso.

**Os dados vêm do banco `dw_fup` (MySQL 172.29.5.3), não de planilha.** O `server.py` monta `data.js` e `validation.js` a partir do banco a cada abertura (cache de 60 s), pelo `db_portal.py`, com as credenciais de `Desktop\FUP\.env`. O banco é alimentado pelo robô diário das 07:13 e pelas tabelas manuais `man_*` (ver `Desktop\FUP\dw_fup\README.md`). Aberto direto do disco (`dist/index.html`), o portal apenas avisa que precisa do servidor.

**Período do realizado (topo):** De/Até ou atalho Mês, no máximo 1 ano, vale para todas as vistas. Um dia = valores do banco para o dia; vários dias = soma dos dias (% = Σ realizado ÷ Σ compromisso). D0 (necessidade, compromisso, fila e DU de hoje) = dia seguinte ao "Até".

**Resumo:** mesmo layout do RESUMO da planilha (DU CONTROLE e Fila Total de D-1 e D0 com a variação, Necessidade/Compromisso/Real, % Comp. com EFETIV/REAL/COBERT, % Necess., Entrantes D-1, Capacity D-1 e D-0). D-1 = "Até" do período; D0 = dia seguinte. Use **Apresentar** (ou a tecla P) para tela cheia. **Ver fim de semana (sáb + dom):** só aparece com D0 na segunda; troca Necessidade/Compromisso/Real, % Comp., % Necess., Efetividade e Entrantes D-1 pelo consolidado de sábado + domingo (somas; % = Σ real ÷ Σ base; efetividade e entrantes pela soma das partes `efetParts`/`entrParts`, nunca média de %). DU e Fila seguem o dia; os dias individuais não mudam (clique de novo para voltar). **Baixar imagem** salva um PNG com todos os quadros (cabeçalho com datas, horário e fonte); **Copiar imagem** copia para colar no WhatsApp/Teams/e-mail (exige o portal aberto pelo Iniciar Portal.cmd). Biblioteca local: `dist/vendor/html2canvas.min.js` (html2canvas 1.4.1, MIT). EFETIV = compromisso de instalação ÷ média de instalação: a colada no bloco do dia do Compromissos D0 (coluna "Inst", tabela `leg_media_inst`, importada pelo robô com `dw_fup/importar_media_inst.py`) para bater com a planilha; sem ela, a média das vendas dos 4 mesmos dias da semana (a dica da célula diz qual). REAL = realizado de instalação ÷ vendas do dia; COBERT = REAL ÷ EFETIV. Entrantes D-1 = entrante do dia ÷ média dos 4 mesmos dias da semana (base atual; a partir de 29/10).

**Mapa:** as 202 cidades atendidas sobre o mapa de SP (malha IBGE). Cor = situação da fila da cidade = Σ fila ÷ Σ (média DU × alvo), mesmas faixas do Resumo (≤ 1 normal, ≤ 1,25 atenção, ≤ 1,5 alerta, > 1,5 crítico), conforme Abrangência e Serviço do topo. Ícone = previsão Open-Meteo (hoje, amanhã, depois). Tempo ruim = tempestade (trovoada com ≥ 10 mm ou probabilidade ≥ 70%) ou chuva ≥ 20 mm. Prioridade = tempo ruim primeiro e, depois, mais ordens acima do estoque máximo (+N). Filtros de dia, situação e tempo; clique na cidade para a previsão de 3 dias e os números por serviço; botões de imagem.

**Assistente (Pergunte ao FUP):** botão no canto inferior direito. Responde só sobre o portal, com base nos mesmos dados do banco (últimos 31 dias por polo, 8 dias por serviço, metas, capacity, as 202 cidades com previsão), nas ocorrências de `man_ocorrencia` e, quando ajuda a explicar um desvio, em notícias da web (com link; notícia não é causa confirmada). Recusa assuntos fora do portal. **Modo apresentação** (botão de tela no topo do chat, ligado por padrão): enquanto responde, o assistente muda a aba e os filtros, aproxima a cidade no mapa, destaca o polo nas tabelas e mostra uma legenda com o número-chave; cada cena vira um botão ▶ na resposta para rever. As cenas vêm no próprio texto como `<cena>{json}</cena>` (o servidor tira o marcador e valida em `chat.cena`); não é ferramenta porque no Opus 5.5 o texto entre chamadas de ferramenta não aparece para quem lê. Com o chat aberto em tela larga, o site se ajusta ao lado do painel. Usa a API da Anthropic (modelo `claude-opus-5-5`, busca na web) com a chave `APICALUDE` do `Desktop\FUP\.env`; as perguntas e o resumo dos dados (agregados, sem OS nem dados de cliente) são enviados à Anthropic. Código: `chat.py` (servidor, endpoint `/chat`) e `dist/chat.js`. SDK em `_libs/` (instalado com `pip install --target _libs anthropic`, porque o caminho do site-packages passa do limite de 260 caracteres do Windows). Teste pelo terminal: `python chat.py "pergunta"`.

**Conferência:** mostra a última execução do robô (`log_execucao`) e as conferências automáticas (`chk_conciliacao`).

Teste no navegador: `python ..\dw_fup\teste_portal_db.py` (com o servidor aberto).

Dependências: Python, pymysql e anthropic (em `_libs/`).

Legado (não usado pelo portal; referência da auditoria das planilhas): `extract.py`, `validate.py`, `known_issues.json`, `legado_planilha/` (antigo `data.js` gerado da planilha) e `smoke.cjs`.

O portal é local e não foi publicado na internet. Para publicação corporativa é necessário definir hospedagem e acesso.

## Login e usuários (servidor local)

O portal aberto pelo `Iniciar Portal.cmd` (http://127.0.0.1:8765) exige login.

1. **Primeiro administrador:** rode `Criar Admin.cmd` uma vez. A senha é digitada no terminal e não aparece na tela.
2. **Demais usuários:** entre como administrador → menu **Usuários**. Lá você cria, edita, desativa e exclui usuários, e escolhe as telas que cada um vê. A permissão "Pergunte ao FUP" libera o assistente.
3. Cada usuário pode trocar a própria senha em **Trocar senha**, na barra lateral.

Como funciona (`auth.py`, `server.py`):

- **Usuários** ficam em `usuarios.json`, fora do git. A senha nunca é gravada: só o hash PBKDF2-SHA256 (600 mil iterações, sal próprio).
- **Sessão** fica no servidor. O navegador guarda só um cookie aleatório `HttpOnly` / `SameSite=Strict`. A sessão expira em 12 h, ou em 2 h sem uso. Reiniciar o servidor desloga todos.
- **Permissões:** o servidor só entrega os dados das telas liberadas para cada usuário. `/chat` e `/api/usuarios` recusam quem não tem permissão. Os blocos diários são a base de todas as telas e vão para todos.
- **Tentativas erradas:** 5 seguidas bloqueiam o usuário por 5 minutos. A mensagem é sempre genérica.
- **Tela de login:**
  - Cena 3D em Three.js r170, local em `dist/vendor/three/`, MIT.
  - Os modelos são procedurais, sem arquivos externos.
  - Sem WebGL, a tela mostra uma arte em CSS.
  - Sem placa de vídeo ou com "reduzir movimento" ligado, a cena fica parada.
  - O formulário nunca depende da cena.
- **Cópia pública no IQT:** não tem login. O `app.js` só aplica permissões quando o servidor do FUP manda o usuário (`window.PORTAL_USER`).
- **Rede:** o servidor escuta só em `127.0.0.1`. Para abrir a outros computadores seria preciso HTTPS, e isso ainda não foi feito.
