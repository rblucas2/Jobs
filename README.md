# Procura de Emprego

App instalável (PWA), igual em estilo e funcionamento às apps Vida OS: abre no telemóvel e no PC,
funciona offline e fica sincronizada entre os dois através do seu Supabase (gratuito).
Recolhe vagas dos alertas do Gmail, ordena-as pela compatibilidade com o seu perfil, gera CVs
adaptados **só com dados reais** e regista as candidaturas. A submissão é sempre manual.
Especificação: [SPEC.md](SPEC.md) (inclui as adaptações feitas para o formato de app web).

Tudo é HTML/CSS/JS puro, sem servidor próprio e sem custos.

## Design

Inspirado nos trackers de candidaturas mais usados (Huntr, Teal) e em plataformas de emprego
(Otta / Welcome to the Jungle): painel inicial em grelha, cartões de vaga com as iniciais da empresa e
um indicador circular da compatibilidade, pipeline em Kanban (arrastar e largar no PC), navegação
inferior no telemóvel e barra lateral no PC, com a lista e o detalhe lado a lado. Modo claro e escuro,
ícones [Lucide](https://lucide.dev) (licença ISC) e tipografia Plus Jakarta Sans.

## Pôr online (GitHub Pages)

1. **O repositório tem de ser público** para o GitHub Pages ser gratuito (num repositório privado
   o Pages exige um plano pago). Os seus dados **não** ficam no repositório: ficam no dispositivo e no
   seu Supabase. O repositório só tem código e um perfil fictício usado nos testes.
   → Settings → General → Danger Zone → *Change visibility* → Public.
2. Settings → Pages → *Deploy from a branch* → `main` / `(root)` → Save.
3. Em cerca de 1 minuto fica em `https://<utilizador>.github.io/<repositório>/`
   (ex.: `https://rblucas2.github.io/Jobs/`).

Fica na mesma origem que as apps Vida OS (`<utilizador>.github.io`), por isso aproveita a configuração
de sincronização e o Client ID do Google que já lá tiver.

## Instalar no telemóvel / PC

- **Android/Chrome:** menu ⋮ → “Instalar app” / “Adicionar ao ecrã principal”.
- **iPhone/Safari:** Partilhar → “Adicionar ao ecrã principal”.
- **PC (Chrome/Edge):** ícone de instalar na barra de endereço.

## Sincronização telemóvel ↔ PC

Se já usa a sincronização nas apps Vida OS, **não precisa de fazer nada**: esta app usa o mesmo Supabase
e o mesmo código, numa linha própria (`app = "jobs"`). Caso contrário: ⚙︎ Definições → Sincronização
(os passos e o SQL estão na própria app). O merge é sem perdas e, se o mesmo item for alterado nos dois
dispositivos, fica a alteração mais recente desse item.

## Ligar o Gmail (uma vez)

Usa o mesmo projeto Google Cloud do Google Calendar do Vida OS:

1. Em https://console.cloud.google.com → APIs e serviços → Biblioteca → **Gmail API** → Ativar.
2. No ecrã de consentimento OAuth, em *Data access*, acrescente os âmbitos `gmail.modify` e
   `gmail.settings.basic`. Com a app em modo *Teste*, o seu e-mail tem de estar em *Test users*.
3. Na credencial **OAuth client ID (Web application)**, em *Authorized JavaScript origins*, tem de estar
   `https://<utilizador>.github.io` (se o Calendar já funciona, já está).
4. Na app: ⚙︎ → Gmail → cole o Client ID (vem preenchido se já o tiver no Vida OS) → **Ligar Gmail**.
5. **Descobrir remetentes** → escolha a fonte de cada endereço → **Gravar definições**.
6. **Criar etiquetas Vagas/\* e filtros** (pode repetir: não cria duplicados).

A autorização do Google no browser dura cerca de 1 hora; depois a app volta a pedi-la quando precisar.

## Modelo local (opcional, só no PC)

Sem modelo, a pontuação e o CV funcionam **por regras** (no telemóvel é sempre assim). No PC pode usar
o [Ollama](https://ollama.com):

```bash
ollama pull qwen3:8b            # ou outro modelo de 7–8B; confirme o mais recente e o desempenho no seu PC
# Permitir que a app (no GitHub Pages) fale com o Ollama:
#   Windows (PowerShell):  setx OLLAMA_ORIGINS "https://rblucas2.github.io"   e reinicie o Ollama
#   Mac:                   launchctl setenv OLLAMA_ORIGINS "https://rblucas2.github.io"   e reinicie o Ollama
```

Depois: ⚙︎ → Modelo local → ativar → **Testar ligação**. O browser pode pedir autorização para aceder a
dispositivos na rede local.

## Fluxo diário (≈15 min)

1. Os alertas chegam ao Gmail e o filtro envia-os para `Vagas/*`, fora da caixa de entrada.
2. **Início** ou **Vagas** → *Recolher do Gmail*: lê, deduplica, guarda e pontua (preliminar = anel tracejado).
3. Numa vaga de interesse, **Vaga** → cole a descrição completa → *Guardar e analisar*.
4. *Gerar CV adaptado* → **CV**: original vs. adaptado, origem de cada ponto, pontos não verificados
   bloqueados. Edite, confirme e aprove; descarregue o Word ou o PDF.
5. Candidate-se **manualmente** na plataforma.
6. **Pipeline** → arraste a vaga para *Candidatado* (ou toque no cartão); o follow-up fica agendado (10 dias por defeito). Exporte o CSV
   para o Power BI quando quiser.

## Como a app garante dados reais no CV

O validador (`js/validador.js`) corre sempre antes de mostrar um CV, a cada edição, na aprovação e na
exportação. Um ponto fica **não verificado** (e o CV não pode ser aprovado) se:

- não tiver `source_ids`, ou citar um ID inexistente;
- citar itens de outra experiência, ou uma competência num ponto de experiência (o que acrescentaria
  o facto “usei X neste cargo”);
- tiver um número, data ou percentagem que não exista nos itens citados (inclui números por extenso,
  “mil”, “milhões”, “50k”, “2M€”);
- mencionar uma ferramenta, certificação, competência ou língua ausente dos itens citados;
- usar termos quantitativos ou de distinção ausentes da origem (“duplicou”, “melhor”, “prémio”, “todos”…);
- mencionar um nome próprio ou sigla ausente da origem (empresa, cliente, norma).

Única exceção: no resumo, “N anos de experiência” é aceite se N não exceder os anos calculados a partir
das datas do perfil. Os cabeçalhos (cargo, empresa, datas, formação, línguas) nunca são escritos pelo
modelo: vêm do perfil-base. O validador é conservador de propósito: prefere bloquear um ponto legítimo
(que corrige à mão) a deixar passar um facto que não está no perfil.

A pontuação mede a adequação do perfil aos requisitos da vaga. **Não é uma probabilidade de
contratação.** Dimensões sem informação na vaga saem da ponderação; um requisito sem evidência válida
no perfil conta como não cumprido.

## Testes

```bash
npm install     # só para os testes (linkedom e docx)
npm test        # 92 testes, sem rede
```

Cobrem o validador do M4 (incluindo um teste de propriedade que insere números aleatórios em todos os
itens do perfil e confirma que são sempre bloqueados), parsers e deduplicação, organização do Gmail com
uma API simulada (idempotência), perfil-base, compatibilidade, aprovação/exportação e tracker.
Correm também automaticamente no GitHub a cada envio (`.github/workflows/testes.yml`).

## Limitações conhecidas

- **Parsers testados só com e-mails sintéticos.** Falta validar com uma semana de alertas reais. Os
  e-mails não reconhecidos aparecem na lista de Vagas; padrões novos acrescentam-se nas Definições.
- **O caminho com Ollama foi testado com respostas simuladas**, não com um modelo real.
- As áreas e localizações-alvo são os exemplos da especificação: confirme-as nas Definições.

## Estrutura

```
index.html  manifest.webmanifest  sw.js        App, instalação e modo offline
shared/     ui.js store.js sync.js            Base copiada das apps Vida OS (dados e sincronização)
css/app.css                                   Sistema de design da app
js/         config texto perfil parsers dados recolha gmail llm compat validador cv tracker
js/ecras/   inicio vagas vaga pipeline cv perfil definicoes comum   (ecrãs)
icons/      jobs.svg + PNG para iPhone/Android
tests/      node --test (fixtures sintéticas e perfil fictício)
```
