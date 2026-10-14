/* Definições (equivalente ao config.yaml), em folha deslizante como nas apps Vida OS. */
import { DIMENSOES, FONTES, NOMES_DIMENSOES } from "../config.js";
import * as cvM from "../cv.js";
import * as gmail from "../gmail.js";
import * as llm from "../llm.js";
import { botao, cfg, el, estado, mut, mutAsync, toast } from "./comum.js";
import { clientIdGoogle } from "./vagas.js";

const linhas = (t) => String(t || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
const titulo = (t) => el("div", { class: "section", style: "margin-top:22px", text: t });
const nota = (t, html) => el("p", { class: "tiny muted", style: "margin:0 0 4px", [html ? "html" : "text"]: t });

function exemploDocumento() {
  return [["nome", "Nome Apelido"], ["contactos", "Lisboa · nome@email.com · +351 900 000 000"], ["seccao", "Experiência Profissional"],
    ["entrada", "Cargo — Empresa"], ["detalhe", "Lisboa · set. 2021 – Atual"], ["ponto", "Ponto do CV com um resultado concreto."], ["ponto", "Outro ponto."],
    ["seccao", "Formação"], ["entrada", "Mestrado — Universidade"], ["detalhe", "set. 2018 – jun. 2020"], ["seccao", "Competências"], ["texto", "Excel · Power BI · VBA"]];
}

export function abrirDefinicoes(aplicarTema, instalar) {
  const c = cfg();
  const sys = Store.get("sys");

  // Aparência
  const tema = UI.field("Tema", { type: "select", value: sys.theme || "auto", options: [{ value: "auto", label: "Automático (segue o sistema)" }, { value: "light", label: "Claro" }, { value: "dark", label: "Escuro" }] });
  tema.input.addEventListener("change", () => { Store.update("sys", (s) => { s.theme = tema.input.value; }); aplicarTema(); });

  // Sincronização (igual às apps Vida OS; usa a mesma configuração se já existir)
  const vida = Store.peekVidaOS("sys").sync || {};
  const propria = sys.sync || {};
  const fUrl = UI.field("URL do projeto Supabase", { value: propria.url || vida.url || "", placeholder: "https://xxxx.supabase.co" });
  const fKey = UI.field("Chave anónima (anon public)", { value: propria.key || vida.key || "" });
  const fCode = UI.field("Código de sincronização (igual nos 2 dispositivos)", { value: propria.code || vida.code || "" });
  const estadoSync = el("span", { class: "pill" });
  const mapa = { off: ["Desligada", "var(--text-mute)"], ready: ["Ligada ✓", "var(--good)"], syncing: ["A sincronizar…", "var(--accent)"], error: ["Erro", "var(--bad)"] };
  Sync.onStatus((s) => { const [t, cor] = mapa[s] || mapa.off; estadoSync.innerHTML = `<span class="dot" style="background:${cor}"></span>${t}`; });

  // Gmail
  const fCid = UI.field("Client ID do Google (OAuth, tipo “Web application”)", { value: c.gmail.client_id || clientIdGoogle(c), placeholder: "…apps.googleusercontent.com" });
  const arquivar = el("input", { type: "checkbox", checked: true });
  const remet = Object.fromEntries(FONTES.map((f) => [f, UI.field(f, { type: "textarea", rows: 2, value: (c.gmail.remetentes[f] || []).join("\n"), placeholder: "um endereço por linha" })]));
  const padroesOutras = UI.field("Padrões de link para “Outras” (expressões regulares, uma por linha)", { type: "textarea", rows: 2, value: (c.parsers.padroes_link_extra.Outras || []).join("\n") });
  const descobertos = el("div", { class: "list" });
  const guardarGmail = () => mut((s, cc) => {
    cc.gmail.client_id = fCid.input.value.trim();
    for (const f of FONTES) cc.gmail.remetentes[f] = linhas(remet[f].input.value);
    cc.parsers.padroes_link_extra.Outras = linhas(padroesOutras.input.value);
  });

  // Alvos e grelha
  const areas = UI.field("Áreas-alvo (uma por linha; sinónimos com |)", { type: "textarea", rows: 3, value: c.areas_alvo.join("\n") });
  const locs = UI.field("Localizações-alvo (uma por linha; sinónimos com |)", { type: "textarea", rows: 3, value: c.localizacoes_alvo.join("\n") });
  const remoto = el("input", { type: "checkbox", checked: !!c.aceita_remoto });
  const pesos = Object.fromEntries(DIMENSOES.map((d) => [d, UI.field(NOMES_DIMENSOES[d], { type: "number", value: c.compatibilidade.pesos[d], min: 0, max: 100 })]));
  const limite = UI.field("Limite com requisito eliminatório em falta", { type: "number", value: c.compatibilidade.limite_eliminatoria, min: 0, max: 100 });

  // Modelo local
  const ollAtivo = el("input", { type: "checkbox", checked: !!c.ollama.ativo });
  const ollHost = UI.field("Endereço do Ollama", { value: c.ollama.host });
  const ollModelo = UI.field("Modelo", { value: c.ollama.modelo, placeholder: "qwen3:8b" });
  const prelimLLM = el("input", { type: "checkbox", checked: !!c.compatibilidade.preliminar_com_llm });

  // CV, carta, tracker
  const idioma = UI.field("Idioma por defeito do CV", { type: "select", value: c.cv.idioma, options: [{ value: "pt", label: "Português" }, { value: "en", label: "Inglês" }, { value: "fr", label: "Francês" }] });
  const maxPontos = UI.field("Máx. de pontos por experiência", { type: "number", value: c.cv.max_pontos_por_experiencia, min: 1, max: 15 });
  const abertura = UI.field("Abertura da carta", { value: c.carta.abertura });
  const fecho = UI.field("Fecho da carta", { value: c.carta.fecho });
  const dias = UI.field("Dias até ao follow-up", { type: "number", value: c.tracker.dias_followup, min: 1, max: 90 });
  const sep = UI.field("Separador do CSV", { type: "select", value: c.exportacao.separador_csv, options: [{ value: ";", label: "; (Excel/Power BI em português)" }, { value: ",", label: ", (inglês)" }] });

  const gravarTudo = () => {
    const soma = DIMENSOES.reduce((a, d) => a + Number(pesos[d].input.value || 0), 0);
    if (soma <= 0) throw new Error("A soma dos pesos tem de ser positiva.");
    mut((s, cc) => {
      cc.gmail.client_id = fCid.input.value.trim();
      for (const f of FONTES) cc.gmail.remetentes[f] = linhas(remet[f].input.value);
      cc.parsers.padroes_link_extra.Outras = linhas(padroesOutras.input.value);
      cc.areas_alvo = linhas(areas.input.value); cc.localizacoes_alvo = linhas(locs.input.value); cc.aceita_remoto = remoto.checked;
      for (const d of DIMENSOES) cc.compatibilidade.pesos[d] = Number(pesos[d].input.value || 0);
      cc.compatibilidade.limite_eliminatoria = Number(limite.input.value || 49);
      cc.compatibilidade.preliminar_com_llm = prelimLLM.checked;
      Object.assign(cc.ollama, { ativo: ollAtivo.checked, host: ollHost.input.value.trim(), modelo: ollModelo.input.value.trim() });
      Object.assign(cc.cv, { idioma: idioma.input.value, max_pontos_por_experiencia: Number(maxPontos.input.value || 5) });
      Object.assign(cc.carta, { abertura: abertura.input.value, fecho: fecho.input.value });
      cc.tracker.dias_followup = Number(dias.input.value || 10);
      cc.exportacao.separador_csv = sep.input.value;
    });
    toast("Definições gravadas ✓" + (soma !== 100 ? ` (pesos somam ${soma}; são normalizados)` : ""), 3500);
  };

  const importar = el("input", { type: "file", accept: "application/json", class: "hide" });
  importar.addEventListener("change", async () => {
    const f = importar.files[0]; if (!f) return;
    try { Store.importAll(JSON.parse(await f.text())); toast("Dados importados ✓"); } catch (e) { toast("Ficheiro inválido."); }
  });

  const folha = UI.sheet("Definições", [
    titulo("Aparência"), tema,
    el("button", { class: "btn btn-soft btn-block", text: "Instalar app no dispositivo", onclick: instalar }),

    titulo("Sincronização telemóvel ↔ PC"),
    el("div", { class: "row" }, [el("span", { class: "tiny muted", text: "Estado:" }), estadoSync]),
    vida.url && !propria.url ? nota("A usar a mesma sincronização das apps Vida OS (mesmo Supabase e código). Os dados desta app ficam numa linha própria (“jobs”).") : null,
    fUrl, fKey, fCode,
    botao("Ligar / guardar sincronização", async () => {
      const s = { url: fUrl.input.value.trim(), key: fKey.input.value.trim(), code: fCode.input.value.trim() };
      if (!s.url || !s.key || !s.code) throw new Error("Preencha os 3 campos.");
      await Sync.test(s);
      Store.update("sys", (x) => { x.sync = s; }); Sync.reload(); toast("Sincronização ligada ✓");
    }, "btn btn-primary btn-block"),
    botao("↻ Sincronizar agora", async () => { if (!Sync.enabled) throw new Error("Ligue a sincronização primeiro."); Sync.flushAllPending(); await new Promise((r) => setTimeout(r, 400)); await Sync.pullAll(); toast("Sincronizado ✓"); }, "btn btn-block"),
    el("details", { class: "card tint" }, [el("summary", { text: "Como ativar (se ainda não usa nas outras apps)" }),
      el("ol", { class: "tiny muted", style: "line-height:1.7;padding-left:18px" }, [
        el("li", { html: 'Conta grátis em <a class="link" href="https://supabase.com" target="_blank" rel="noopener">supabase.com</a> e um projeto.' }),
        el("li", { text: "SQL Editor → cole o código abaixo → RUN." }),
        el("li", { text: "Project Settings → API: copie o Project URL e a chave anon public." }),
        el("li", { text: "Use o MESMO código de sincronização no telemóvel e no PC." })]),
      el("pre", { text: Sync.sqlSchema })]),

    titulo("Gmail (M0 e recolha)"),
    nota("Usa o mesmo projeto Google Cloud que o Google Calendar do Vida OS: ative também a Gmail API. A autorização é pedida no browser e dura cerca de 1 hora; depois volta a pedir."),
    fCid,
    el("div", { class: "row", style: "gap:8px" }, [
      botao("Ligar Gmail", async () => { guardarGmail(); await gmail.ligar(fCid.input.value.trim()); toast("Gmail ligado ✓"); }, "btn btn-primary btn-block"),
      botao("Descobrir remetentes", async () => {
        guardarGmail();
        toast("A procurar alertas dos últimos 60 dias…");
        const lista = await gmail.descobrirRemetentes(gmail.apiReal(fCid.input.value.trim()));
        descobertos.innerHTML = "";
        if (!lista.length) descobertos.appendChild(el("div", { class: "empty tiny", text: "Nada encontrado. Confirme que já recebeu alertas." }));
        lista.forEach((r) => {
          const destino = el("select", {}, FONTES.map((f) => el("option", { value: f, text: f })));
          descobertos.appendChild(el("div", { class: "item" }, [el("div", { class: "grow" }, [el("div", { class: "t wrap", text: r.endereco }), el("div", { class: "s wrap", text: `${r.n} e-mails · ex.: ${r.assunto.slice(0, 60)}` })]), destino,
            el("button", { class: "btn btn-sm", text: "Usar", onclick: () => { const t = remet[destino.value].input; if (!linhas(t.value).includes(r.endereco)) t.value = linhas(t.value).concat(r.endereco).join("\n"); toast(`Adicionado a ${destino.value}. Grave as definições.`); } })]));
        });
      }, "btn btn-block"),
    ]),
    descobertos,
    nota("Remetentes dos alertas por fonte — confirme-os a partir dos primeiros alertas (botão acima). Não são assumidos à partida."),
    ...FONTES.map((f) => remet[f]), padroesOutras,
    el("label", { class: "check" }, [arquivar, el("span", { text: "Etiquetar e arquivar também os alertas antigos" })]),
    botao("Criar etiquetas Vagas/* e filtros", async () => {
      guardarGmail();
      const rel = await mutAsync(async (s, cc) => gmail.configurar(gmail.apiReal(cc.gmail.client_id), cc, { arquivar: arquivar.checked }));
      UI.sheet("Gmail configurado", [el("pre", { class: "tiny", style: "white-space:pre-wrap", text: gmail.textoRelatorio(rel) }),
        nota("Pode repetir sempre que mudar os remetentes: não cria duplicados. Os alertas novos vão diretos para Vagas/* sem passar pela caixa de entrada.")]);
    }, "btn btn-block"),

    titulo("Alvos"), areas, locs,
    el("label", { class: "check" }, [remoto, el("span", { text: "Aceito trabalho remoto" })]),
    titulo("Grelha de compatibilidade"),
    nota("A pontuação mede a adequação ao perfil pedido na vaga. Não é uma probabilidade de contratação."),
    el("div", { class: "grid-2", style: "gap:8px" }, DIMENSOES.map((d) => pesos[d])), limite,

    titulo("Modelo local (Ollama) — opcional, só no PC"),
    nota('Sem Ollama (ou no telemóvel), a pontuação e o CV funcionam por regras. Para o ativar no PC: instale o Ollama, corra <code>ollama pull qwen3:8b</code> e defina a variável <code>OLLAMA_ORIGINS=' + location.origin + "</code> antes de o iniciar (ver README).", true),
    el("label", { class: "check" }, [ollAtivo, el("span", { text: "Usar o modelo local quando disponível" })]),
    ollHost, ollModelo,
    el("label", { class: "check" }, [prelimLLM, el("span", { text: "Usar também nas pontuações preliminares (mais lento)" })]),
    botao("Testar ligação", async () => { mut((s, cc) => Object.assign(cc.ollama, { ativo: ollAtivo.checked, host: ollHost.input.value.trim(), modelo: ollModelo.input.value.trim() })); const [ok, msg] = await llm.estado(cfg()); toast(msg, 5000); if (!ok) console.warn(msg); }, "btn btn-block"),

    titulo("CV, carta e tracker"), idioma, maxPontos, abertura, fecho, dias, sep,
    titulo("Formato do CV"),
    nota("O formato é fixo e é o mesmo no Word e no PDF. Aprove-o uma vez; sem aprovação não há exportação."),
    el("div", { class: "doc-wrap", style: "padding:22px 24px;font-size:90%" }, [el("style", { text: cvM.CSS_DOCUMENTO }), el("div", { html: cvM.htmlDocumento(exemploDocumento()) })]),
    c.cv.modelo_aprovado
      ? botao("Formato aprovado ✓ — retirar aprovação", () => { mut((s, cc) => { cc.cv.modelo_aprovado = false; }); toast("Aprovação retirada."); }, "btn btn-ghost btn-block")
      : botao("Aprovar este formato", () => { mut((s, cc) => { cc.cv.modelo_aprovado = true; }); toast("Formato aprovado ✓"); }, "btn btn-soft btn-block"),

    botao("Gravar definições", gravarTudo, "btn btn-primary btn-block", { style: "margin-top:14px" }),

    titulo("Cópia de segurança"),
    el("button", { class: "btn btn-block", text: "Exportar cópia (.json)", onclick: () => {
      const a = el("a", { href: URL.createObjectURL(new Blob([JSON.stringify(Store.exportAll(), null, 2)], { type: "application/json" })), download: `jobs-backup-${UI.todayISO()}.json` }); a.click();
    } }),
    el("button", { class: "btn btn-block", text: "Importar cópia (.json)", onclick: () => importar.click() }), importar,
    el("p", { class: "tiny muted center", style: "margin-top:18px", text: `Procura de Emprego · ${estado().vagas.length} vagas · dados no dispositivo${Sync.enabled ? " e no seu Supabase" : ""}` }),
  ].filter(Boolean));
}
