# Procura de Emprego

Aplicação local e gratuita que recolhe vagas dos alertas de emprego no Gmail, as ordena pela
compatibilidade com o seu perfil, gera CVs adaptados **apenas com dados reais** e regista as
candidaturas. A submissão das candidaturas é sempre manual. Especificação completa: [SPEC.md](SPEC.md).

> Os dados (perfil, CVs, base de dados, e-mails) e as credenciais do Gmail ficam no seu computador e
> estão no `.gitignore`: `credentials.json`, `token.json`, `data/` e `logs/` nunca vão para o repositório.

## Instalação (Windows ou Mac)

1. **Python 3.11 ou superior** — https://www.python.org/downloads/ (no Windows, marque *Add Python to PATH*).
2. Abra um terminal na pasta do repositório (`jobs`) e crie um ambiente virtual:

   ```bash
   python -m venv .venv
   # Windows:  .venv\Scripts\activate
   # Mac:      source .venv/bin/activate
   pip install -r requirements.txt
   ```

3. **LibreOffice** (opcional, para exportar PDF) — https://www.libreoffice.org/. Sem ele, a app exporta só Word.
4. **Ollama** (opcional, modelo local) — https://ollama.com. Depois: `ollama pull qwen3:8b`
   (ou outro modelo de 7–8B; confirme o mais recente e o desempenho no seu PC — cerca de 16 GB de RAM
   é a referência aproximada). Sem Ollama, a app funciona em **modo por regras**: a pontuação usa
   palavras-chave e o CV é montado com o texto do perfil-base, para reformular à mão.
5. Arranque a app:

   ```bash
   streamlit run app.py
   ```

   Abre em http://localhost:8501. A página **Início** mostra o que falta configurar.

## Configurar o Gmail (uma vez, gratuito)

1. Em https://console.cloud.google.com crie um projeto.
2. Ative a **Gmail API** (APIs e serviços → Biblioteca → Gmail API → Ativar).
3. Configure o ecrã de consentimento OAuth (tipo *Externo*, estado *Teste*) e adicione o seu e-mail
   como **utilizador de teste**.
4. Crie credenciais **ID de cliente OAuth → Aplicação de ambiente de trabalho**, descarregue o JSON e
   guarde-o como `credentials.json` na pasta do repositório.
5. Descubra os remetentes dos seus alertas (a app não os assume à partida):

   ```bash
   python setup_gmail.py --descobrir
   ```

   Copie os endereços certos para `gmail.remetentes` no `config.yaml` (ou na página **Definições**).
6. Crie as etiquetas `Vagas/*`, os filtros e arquive os alertas antigos:

   ```bash
   python setup_gmail.py
   ```

   Pode repetir o comando sempre que alterar os remetentes: não cria duplicados.

Notas:
- Permissões pedidas: `gmail.modify` (ler e etiquetar) e `gmail.settings.basic` (criar filtros).
- Com o projeto em modo *Teste*, a Google faz expirar a autorização ao fim de alguns dias (7, segundo a
  documentação da Google consultada até 2025). Quando isso acontecer, a app volta a abrir o browser para
  autorizar. Não precisa de publicar a app.
- Alternativa manual: criar a etiqueta e o filtro no Gmail em Definições → Filtros.

## Primeira utilização

1. **Perfil-base** → importe o CV atual (PDF/Word). A app propõe um perfil com IDs estáveis
   (ex.: `exp_intermarche_03`) e assinala os itens que não encontrou literalmente no CV. Reveja, edite
   e **valide**. Só a versão validada é usada nos CVs; qualquer alteração cria uma versão nova.
2. **Definições** → confirme áreas e localizações-alvo, pesos da grelha e **aprove o modelo Word**
   (`templates/cv_modelo.docx`, que pode personalizar no Word mantendo os nomes dos estilos).

## Fluxo diário (≈15 min)

1. Os alertas chegam ao Gmail e o filtro envia-os para `Vagas/*`, fora da caixa de entrada.
2. **Vagas** → *Recolher novas vagas*: lê, deduplica, guarda e pontua (preliminar, marcada com \*).
3. Nas vagas de interesse, **Detalhe da vaga** → cole a descrição completa → pontuação final.
4. *Gerar CV adaptado* → **Revisão de CV**: original vs. adaptado lado a lado, origem de cada ponto,
   pontos "não verificados" bloqueados. Edite, confirme e aprove; depois exporte Word/PDF.
5. Candidate-se **manualmente** na plataforma.
6. **Tracker** → marque *Candidatado*; o follow-up fica agendado (10 dias por defeito).
   Exporte o CSV para o Power BI quando quiser.

## Como a ferramenta garante dados reais no CV

O validador (`src/cv/validador.py`) corre sempre antes de um CV ser mostrado, a cada edição, na
aprovação e na exportação. Um ponto fica **não verificado** (e o CV não pode ser aprovado) se:

- não tiver `source_ids`, ou citar um ID inexistente;
- citar itens de outra experiência, ou uma competência num ponto de experiência (o que acrescentaria
  o facto "usei X neste cargo");
- tiver um número, data ou percentagem que não exista nos itens citados (inclui números por extenso,
  "mil", "milhões", "50k", "2M€");
- mencionar uma ferramenta, certificação, competência ou língua ausente dos itens citados;
- usar termos quantitativos ou de distinção ausentes da origem ("duplicou", "melhor", "prémio", "todos"…);
- mencionar um nome próprio ou sigla ausente da origem (empresa, cliente, norma).

Única exceção: no resumo, "N anos de experiência" é aceite se N não exceder os anos calculados a partir
das datas do perfil. O validador é deliberadamente conservador: prefere bloquear um ponto legítimo
(que corrige à mão) a deixar passar um facto que não está no perfil. Os cabeçalhos (cargo, empresa,
datas, formação, línguas) nunca são escritos pelo modelo: vêm diretamente do perfil-base.

A pontuação de compatibilidade mede a adequação do perfil aos requisitos da vaga. **Não é uma
probabilidade de contratação.** Dimensões sem informação na vaga ficam de fora da ponderação, em vez de
receberem um valor neutro arbitrário. Requisito sem evidência válida no perfil conta como não cumprido.

## Testes

```bash
python -m pytest
```

94 testes automáticos, sem rede nem Gmail real: validador do M4 (incluindo um teste de propriedade
que insere números aleatórios em todos os itens do perfil e verifica que são sempre bloqueados),
parsers e deduplicação, organização do Gmail com um serviço simulado (idempotência), perfil-base,
compatibilidade, aprovação/exportação e tracker.

## Estado das fases e o que falta validar com dados reais

| Fase | Código e testes | Validação que só pode ser feita por si |
|---|---|---|
| 1. Gmail (M0) | ✅ | Confirmar que um alerta novo vai direto para `Vagas/<fonte>` |
| 2. Recolha (M1) | ✅ | **Parsers calibrados apenas com e-mails sintéticos.** Ler uma semana de alertas reais; e-mails não reconhecidos aparecem na página Vagas e em `logs/emails_nao_reconhecidos.log`. Ajustes de padrões em `parsers.padroes_link_extra`. |
| 3. Perfil-base (M2) | ✅ | Importar o seu CV, rever e validar |
| 4. Compatibilidade (M3) | ✅ | O caminho com Ollama foi testado com respostas simuladas, não com um modelo real. Comparar 10 vagas reais com a sua avaliação manual e ajustar os pesos. |
| 5. Otimizador de CV (M4) | ✅ critério cumprido | Rever a qualidade da reformulação do modelo no seu hardware |
| 6. Tracker (M5) | ✅ | — |

## Estrutura

```
jobs/
├── app.py                  # entrada Streamlit (navegação e página Início)
├── pages/                  # Vagas, Detalhe da vaga, Revisão de CV, Tracker, Perfil-base, Definições
├── src/
│   ├── gmail/              # auth.py, organizacao.py (M0), recolha.py (M1)
│   ├── parsers/            # base.py, fontes.py (um parser por fonte), normalizacao.py (dedup)
│   ├── perfil/             # modelo.py (pydantic), versoes.py, extracao.py (M2)
│   ├── compatibilidade/    # schemas.py, regras.py (fallback), motor.py (grelha e corte) (M3)
│   ├── cv/                 # schemas, validador, gerador, diff, render, exportacao, fluxo (M4)
│   ├── tracker/            # estados.py, metricas.py (M5)
│   ├── llm.py              # cliente Ollama com saída JSON validada
│   ├── config.py · db.py · texto.py · ui.py
├── templates/              # cv_modelo.docx + criar_modelo.py
├── tests/                  # pytest (fixtures sintéticas e perfil fictício)
├── config.yaml · setup_gmail.py · requirements.txt · SPEC.md
└── data/ · logs/           # locais, fora do repositório
```
