# Ferramenta de Procura de Emprego — Especificação

14/10/2026 · @Rodrigo

> **Adaptação (14/10/2026):** a pedido do Rodrigo, a ferramenta foi feita como app web instalável
> (PWA), ao estilo das apps Vida OS, para funcionar no telemóvel e no PC sempre sincronizada.
> As regras de fundo mantêm-se; as diferenças face à stack original estão na secção
> “Adaptações para app web”, no fim deste documento.

## Objetivo e âmbito

Uma aplicação local e gratuita que recolhe vagas dos alertas de emprego no Gmail, as ordena pela compatibilidade com o meu perfil, gera CVs adaptados apenas com dados reais e regista todas as candidaturas. A submissão das candidaturas é sempre manual.

**A ferramenta faz:**

- Organizar automaticamente todos os alertas de emprego numa etiqueta própria do Gmail ("Vagas"), fora da caixa de entrada.
- Recolher as vagas desses alertas (LinkedIn, Indeed, Net-Empregos, Jobs.lu, portais das Big 4) e permitir adicionar vagas manualmente.
- Pontuar a compatibilidade de cada vaga com o meu CV (0–100), com lacunas identificadas, e ordenar as vagas.
- Gerar um CV adaptado por vaga, só com dados do perfil-base, com revisão lado a lado antes da aprovação.
- Registar o estado de cada candidatura e mostrar métricas da procura.

**A ferramenta não faz:**

- Submeter candidaturas.
- Aceder diretamente ao LinkedIn, Indeed ou outras plataformas por scraping ou automação de sessão (proibido pelos termos de utilização).
- Inventar ou inflacionar experiência, competências ou números no CV.

## Restrições e princípios de desenho

São regras obrigatórias: qualquer funcionalidade que as viole fica fora do âmbito.

1. **Custo zero.** Sem subscrições nem APIs pagas. Tudo corre localmente no meu computador ou usa planos gratuitos.
2. **Dentro dos termos das plataformas.** As vagas entram apenas por e-mails de alerta que recebo, por fontes públicas oficiais ou por inserção manual. Nada de scraping do LinkedIn ou do Indeed.
3. **Dados reais no CV.** O perfil-base validado por mim é a única fonte de verdade. A adaptação pode reordenar, selecionar, omitir e reformular sem mudar o significado, mas nunca acrescentar factos.
4. **Rastreabilidade.** Cada ponto do CV adaptado referencia o item do perfil-base de onde vem. Um ponto sem correspondência, ou com um número que não existe na origem, é bloqueado e assinalado como "não verificado".
5. **Aprovação humana.** Nenhum CV é exportado nem marcado como usado sem a minha aprovação explícita.
6. **Pontuação honesta.** A compatibilidade mede a adequação ao perfil pedido na vaga. Não é uma probabilidade de contratação e não deve ser apresentada como tal.
7. **Privacidade.** O CV, o perfil e os e-mails ficam no meu computador. Credenciais e tokens do Gmail nunca vão para o repositório (.gitignore).

## Stack técnica gratuita

Todo o projeto é em Python 3 e corre localmente. Não há servidor nem custos recorrentes.

| Camada | Tecnologia | Função |
|---|---|---|
| Linguagem | Python 3.11+ | Código da aplicação |
| Interface | Streamlit | App web local no browser (`streamlit run app.py`) |
| Base de dados | SQLite (sqlite3, biblioteca padrão) | Vagas, análises, CVs e candidaturas num ficheiro local |
| E-mail | Gmail API (google-api-python-client, google-auth-oauthlib) | Criar a etiqueta e o filtro e ler os alertas. Gratuito para uso pessoal. |
| Leitura de e-mails | beautifulsoup4 | Extrair as vagas do HTML dos alertas |
| Modelo de linguagem | Ollama (local) + biblioteca ollama | Pontuação de compatibilidade e reformulação do CV, com saída JSON estruturada |
| Validação | pydantic | Validar o JSON devolvido pelo modelo e o perfil-base |
| Leitura do CV | pdfplumber ou python-docx | Extrair o texto do CV atual para criar o perfil-base |
| Geração do CV | python-docx + LibreOffice em modo headless | CV adaptado em Word e conversão gratuita para PDF |
| Comparação | difflib (biblioteca padrão) | Mostrar o CV original e o adaptado lado a lado, com diferenças realçadas |
| Análise | Exportação CSV | Ligar o tracker ao Power BI, se quiser |

Notas:

- **Permissões do Gmail:** `gmail.modify` para ler e etiquetar e `gmail.settings.basic` para criar o filtro. As credenciais OAuth ficam em `credentials.json` e `token.json`, ambos no `.gitignore`.
- **Modelo local:** usar um modelo de 7–8B parâmetros (por exemplo, da família Qwen ou Llama disponível no Ollama). Confirmar a versão mais recente e o desempenho no meu hardware. Cerca de 16 GB de RAM é a referência aproximada, a confirmar.
- **Fallback sem modelo:** se o PC não aguentar o Ollama, a pontuação faz-se por palavras-chave e regras, e a reformulação do CV fica manual. A rastreabilidade mantém-se.

## Módulos funcionais

A aplicação tem seis módulos, executados por esta ordem no fluxo diário.

### M0 — Organização do Gmail (pasta "Vagas")

Todos os alertas de emprego ficam numa etiqueta própria e saem da caixa de entrada, para não a entupir.

- Criar as etiquetas Vagas, com subetiquetas por fonte: Vagas/LinkedIn, Vagas/Indeed, Vagas/Net-Empregos, Vagas/Jobs.lu, Vagas/Big4, Vagas/Outras. Criar também Vagas/Processado, para os e-mails já lidos pela ferramenta.
- Criar um filtro do Gmail por fonte. Critério: endereço do remetente dos alertas. Ação: aplicar a etiqueta e arquivar (retirar da caixa de entrada). Os e-mails ficam por ler na etiqueta.
- Remetentes guardados em `config.yaml`, editáveis. Os endereços exatos de cada plataforma confirmam-se a partir dos primeiros alertas recebidos, sem assumir à partida.
- O filtro só atua sobre e-mails novos. Na primeira execução, a ferramenta pesquisa os alertas antigos e aplica-lhes a etiqueta e o arquivamento em lote.
- Comando de configuração único (`python setup_gmail.py`), repetível sem criar duplicados. A alternativa é criar a etiqueta e o filtro manualmente no Gmail, em Definições → Filtros.

### M1 — Recolha de vagas

- Ler os e-mails com etiquetas Vagas/* ainda não processados. Um parser por fonte extrai cargo, empresa, localização, link, data e fonte.
- Deduplicação: link canónico (sem parâmetros de rastreio) e, em alternativa, a chave normalizada empresa + cargo + localização.
- Depois de processado, o e-mail recebe a etiqueta Vagas/Processado.
- Inserção manual: colar o link ou o texto da descrição de uma vaga.
- Os alertas costumam trazer só um resumo. A descrição completa é colada por mim nas vagas que me interessam, antes da pontuação detalhada.
- Se um e-mail não for reconhecido pelo parser, é registado para revisão. Não pode falhar sem aviso.

### M2 — Perfil-base (fonte única de verdade)

- Extrair o texto do CV atual (PDF ou Word) e propor um `perfil_base.yaml` estruturado: dados pessoais, experiência (cargo, empresa, datas, responsabilidades, resultados), formação, competências, línguas e certificações.
- Cada item tem um ID estável (ex.: `exp_intermarche_03`).
- Revejo e valido o perfil uma vez. Só a versão validada pode ser usada pelo M4.
- As alterações ao perfil são feitas por mim e ficam versionadas.

### M3 — Compatibilidade e ordenação

- Entrada: perfil-base + descrição da vaga. Saída: JSON validado com a pontuação global (0–100), as subpontuações, os requisitos cumpridos e em falta (cada um com evidência no perfil) e um resumo de 2–3 frases.
- Grelha de ponderação, como proposta inicial ajustável em `config.yaml`:

| Dimensão | Peso |
|---|---|
| Requisitos obrigatórios | 35 |
| Experiência (anos e tipo) | 20 |
| Competências técnicas | 20 |
| Línguas | 10 |
| Localização e condições | 10 |
| Alinhamento com as áreas-alvo | 5 |

- Regra de corte: se falhar um requisito eliminatório (ex.: uma língua obrigatória), a pontuação fica limitada a 49 e a vaga é assinalada.
- Vagas só com o resumo do alerta recebem uma pontuação preliminar, marcada como tal.
- A lista de vagas aparece ordenada por pontuação, com filtros por fonte, localização e estado.

### M4 — Otimizador de CV com dados reais

- Entrada: perfil-base validado + vaga. O modelo devolve o CV adaptado em JSON: secções e pontos, cada ponto com `source_ids` que apontam para itens do perfil-base.
- Validador automático, antes de mostrar o resultado:
  - todos os `source_ids` existem no perfil-base;
  - todos os números, datas e percentagens do ponto existem no item de origem;
  - ferramentas, certificações e línguas mencionadas existem no perfil-base;
  - qualquer ponto que falhe é bloqueado e marcado como "não verificado".
- Pode reordenar, selecionar, omitir e reformular com o vocabulário da vaga. Não pode acrescentar factos.
- Revisão: vista lado a lado (original vs. adaptado), com as alterações realçadas e a origem de cada ponto visível. Pré-visualização com o formato final.
- Modelo de CV em Word fixo, aprovado por mim uma vez, para o formato ser sempre o mesmo.
- Só depois de eu aprovar: exportação em Word e PDF, gravação da versão e ligação à vaga no tracker.
- Carta de apresentação opcional, com as mesmas regras.

### M5 — Tracker de candidaturas

- Estados: Por candidatar → Candidatado → Entrevista → Rejeitado / Oferta, e ainda Descartada (vagas que decido não seguir).
- Campos: os da vaga, a pontuação, a versão do CV usada, a data da candidatura, o contacto, as notas e a data de follow-up (por defeito 10 dias após a candidatura, configurável).
- Painel: candidaturas por estado, taxa de resposta, entrevistas por fonte e por tipo de vaga, follow-ups em atraso.
- Exportação CSV para o Power BI.

## Modelo de dados

Quatro tabelas SQLite e um ficheiro YAML para o perfil. A vaga é a entidade central.

| Tabela | Campos principais | Relação |
|---|---|---|
| vagas | id, cargo, empresa, localizacao, link_canonico, fonte, data_publicacao, data_recolha, descricao, descricao_completa (sim/não), gmail_message_id | Entidade central |
| analises | id, vaga_id, pontuacao_global, subpontuacoes (JSON), requisitos_cumpridos (JSON), lacunas (JSON), preliminar (sim/não), versao_perfil, data | N:1 com vagas |
| cvs | id, vaga_id, versao_perfil, conteudo (JSON com source_ids), estado (rascunho / aprovado / rejeitado), caminho_docx, caminho_pdf, data_aprovacao | N:1 com vagas |
| candidaturas | id, vaga_id, cv_id, estado, data_candidatura, contacto, notas, data_followup | 1:1 com vagas |

- `perfil_base.yaml`: a fonte de verdade, com um ID estável por item e versionado (ex.: `perfil_base_v3.yaml`). A versão validada está marcada em `config.yaml`.
- `config.yaml`: áreas e localizações-alvo, remetentes dos alertas, pesos da grelha, dias de follow-up, modelo do Ollama e caminho do modelo de CV.
- `logs/emails_nao_reconhecidos.log`: e-mails que nenhum parser conseguiu ler.

## Interface e fluxo diário

Uma app Streamlit com seis páginas, aberta no browser. O uso diário deve levar cerca de 15 minutos.

| Página | O que mostra | Ações |
|---|---|---|
| Vagas | Lista ordenada por pontuação, com filtros por fonte, localização, estado e data | Recolher novas vagas, adicionar vaga manual, descartar |
| Detalhe da vaga | Descrição, pontuação decomposta, requisitos cumpridos e lacunas | Colar a descrição completa, repetir a análise, gerar CV |
| Revisão de CV | Original e adaptado lado a lado, alterações realçadas, origem de cada ponto, pontos "não verificados" | Editar, aprovar, rejeitar, exportar Word/PDF |
| Tracker | Candidaturas por estado e follow-ups em atraso | Mudar o estado, notas, data de follow-up, exportar CSV |
| Perfil-base | Itens do perfil com os IDs | Validar, editar, criar nova versão |
| Definições | config.yaml em formulário | Áreas, remetentes, pesos, modelo do Ollama |

**Fluxo diário**

1. Os alertas chegam ao Gmail e o filtro envia-os para Vagas/*, fora da caixa de entrada.
2. Abro a app e carrego em "Recolher novas vagas": o M1 lê, deduplica e guarda.
3. O M3 pontua as vagas novas e a lista aparece ordenada.
4. Escolho as vagas de interesse, colo a descrição completa e vejo a pontuação final.
5. Gero o CV adaptado (M4), reviso-o lado a lado e aprovo-o.
6. Candidato-me manualmente na plataforma da vaga.
7. No tracker, marco a vaga como "Candidatado" e fica agendado o follow-up.

## Estrutura de pastas e plano de desenvolvimento

Desenvolver por fases, cada uma testada antes da seguinte. O M0 vem primeiro porque é útil de imediato, mesmo sem o resto.

```
procura-emprego/
├── app.py                  # entrada Streamlit
├── pages/                  # páginas da interface
├── src/
│   ├── gmail/              # autenticação, etiquetas, filtros, leitura (M0, M1)
│   ├── parsers/            # um parser por fonte de alertas
│   ├── perfil/             # extração e validação do perfil-base (M2)
│   ├── compatibilidade/    # grelha, prompts, schemas pydantic (M3)
│   ├── cv/                 # geração, validador, diff, exportação (M4)
│   ├── tracker/            # estados, follow-ups, métricas (M5)
│   └── db.py               # SQLite
├── data/                   # base de dados, perfil_base_vN.yaml, CVs gerados
├── templates/cv_modelo.docx
├── config.yaml
├── setup_gmail.py
├── tests/
├── SPEC.md                 # este documento exportado em Markdown
└── .gitignore              # credentials.json, token.json, data/
```

**Fases**

1. **Base e Gmail (M0).** Estrutura do projeto, autenticação OAuth, criação das etiquetas Vagas/* e dos filtros, arquivamento dos alertas antigos. *Concluída quando:* um alerta novo vai diretamente para a etiqueta certa, sem passar pela caixa de entrada.
2. **Recolha (M1).** Parsers por fonte, deduplicação, SQLite, inserção manual, registo de e-mails não reconhecidos. *Concluída quando:* uma semana de alertas reais é lida sem duplicados nem falhas silenciosas.
3. **Perfil-base (M2).** Extração do CV, `perfil_base.yaml` com IDs, página de validação. *Concluída quando:* eu tiver validado o perfil e cada item tiver um ID.
4. **Compatibilidade (M3).** Integração com o Ollama, schema pydantic, grelha configurável, regra de corte, lista ordenada. *Concluída quando:* as pontuações de 10 vagas reais forem coerentes com a minha avaliação manual.
5. **Otimizador de CV (M4).** Geração com source_ids, validador, vista lado a lado, modelo Word, exportação Word/PDF após aprovação. *Concluída quando:* os testes provarem que um número ou facto inexistente no perfil é sempre bloqueado.
6. **Tracker e painel (M5).** Estados, follow-ups, métricas, exportação CSV.

## Pontos a confirmar antes de começar

- [ ] Computador (Windows ou Mac) e RAM disponível: decide se o Ollama é viável ou se se usa o fallback por regras.
- [ ] Experiência com Python: decide o nível de detalhe das instruções de instalação.
- [ ] Áreas e localizações-alvo para o `config.yaml` (ex.: Transaction Services, Valuation, M&A; Lisboa, Porto, Luxemburgo).
- [ ] Alertas criados no LinkedIn, Indeed, Net-Empregos, Jobs.lu e portais das Big 4, e endereços dos remetentes confirmados a partir dos primeiros e-mails.
- [ ] CV atual em PDF ou Word, para gerar o perfil-base.
- [ ] Modelo de CV em Word (o formato final) aprovado.
- [ ] Projeto no Google Cloud com a Gmail API ativa e credenciais OAuth de "aplicação de ambiente de trabalho" (gratuito).

## Adaptações para app web (PWA)

| Especificação original | Na app web | Porquê / efeito |
|---|---|---|
| Python + Streamlit, local | HTML/CSS/JS (sem servidor), GitHub Pages, instalável | Funciona no telemóvel e no PC, como as apps Vida OS |
| SQLite (4 tabelas) | Mesmas entidades (vagas, análises, CVs, candidaturas) guardadas no dispositivo | A candidatura fica junto da vaga (relação 1:1) |
| Privacidade: tudo só no computador | Dados no dispositivo **e** no Supabase do próprio utilizador | Necessário para a sincronização; continua a não haver dados no repositório |
| `setup_gmail.py` + `credentials.json`/`token.json` | Botões nas Definições; OAuth no browser (Google Identity Services) | Sem ficheiros de credenciais; a autorização dura ~1 h e é pedida de novo quando preciso |
| Ollama sempre disponível | Ollama opcional e só no PC (`OLLAMA_ORIGINS`); no telemóvel, modo por regras | Um modelo de 7–8B não corre no telemóvel |
| Modelo Word (`cv_modelo.docx`) + LibreOffice para PDF | Formato fixo, aprovado uma vez nas Definições; Word gerado no browser; PDF pela impressão do browser | Sem software instalado e igual no telemóvel e no PC |
| `perfil_base_vN.yaml` | Versões do perfil na app, com editor por formulário e IDs estáveis | Mesmas regras: só a versão validada é usada; a validada é imutável |
| `logs/emails_nao_reconhecidos.log` | Lista “E-mails não reconhecidos” no ecrã Vagas | Nunca falha em silêncio |
| `config.yaml` | Definições na app (sincronizadas) | Mesmos parâmetros e valores por defeito |
