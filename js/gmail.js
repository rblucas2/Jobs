/* M0 + M1 — Gmail diretamente no browser (sem servidor).

   Autenticação: Google Identity Services (token flow), como o Google Calendar do Vida OS.
   Permissões: gmail.modify (ler e etiquetar) e gmail.settings.basic (criar filtros).
   Todas as funções recebem `api(metodo, caminho, corpo)`, o que permite testá-las sem rede. */
import { FONTES } from "./config.js";
import { metadados, partesEmail, processarEmail } from "./recolha.js";

export const SCOPES = "https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/gmail.settings.basic";
const BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

// ---------------------------------------------------------------- autenticação (browser)

let token = null, expira = 0;

function carregarGIS() {
  return new Promise((res, rej) => {
    if (globalThis.google && google.accounts && google.accounts.oauth2) return res();
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client"; s.async = true;
    s.onload = () => res(); s.onerror = () => rej(new Error("Não foi possível carregar o Google (sem ligação?)"));
    document.head.appendChild(s);
  });
}

export const ligado = () => !!token && Date.now() < expira;

export async function ligar(clientId) {
  if (!clientId) throw new Error("Falta o Client ID do Google (Definições → Gmail).");
  await carregarGIS();
  return new Promise((resolve, reject) => {
    const cliente = google.accounts.oauth2.initTokenClient({
      client_id: clientId, scope: SCOPES,
      callback: (r) => {
        if (r && r.error) return reject(new Error(r.error_description || r.error));
        token = r.access_token;
        expira = Date.now() + (r.expires_in || 3500) * 1000 - 60000;
        resolve(token);
      },
      error_callback: (e) => reject(new Error((e && e.message) || "Autorização cancelada")),
    });
    cliente.requestAccessToken({ prompt: "" });
  });
}

export function desligar() {
  if (token && globalThis.google && google.accounts) { try { google.accounts.oauth2.revoke(token); } catch (e) { /* ignorar */ } }
  token = null; expira = 0;
}

/** Cliente REST para a Gmail API real (pede autorização se o token tiver expirado). */
export function apiReal(clientId) {
  return async function api(metodo, caminho, corpo) {
    if (!ligado()) await ligar(clientId);
    const r = await fetch(BASE + caminho, {
      method: metodo, headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: corpo ? JSON.stringify(corpo) : undefined,
    });
    if (r.status === 401) { token = null; throw new Error("A autorização do Google expirou. Volte a ligar o Gmail."); }
    if (!r.ok) throw new Error(`Gmail API ${r.status}: ${(await r.text()).slice(0, 200)}`);
    return r.status === 204 ? null : r.json().catch(() => null);
  };
}

// ---------------------------------------------------------------- M0: etiquetas, filtros, arquivo

export function nomesEtiquetas(cfg) {
  const raiz = cfg.gmail.etiqueta_raiz;
  const n = Object.fromEntries(FONTES.map((f) => [f, `${raiz}/${f}`]));
  n._raiz = raiz;
  n._processado = cfg.gmail.etiqueta_processado;
  return n;
}

export function novoRelatorio() {
  return { etiquetas_criadas: [], etiquetas_existentes: [], filtros_criados: [], filtros_existentes: [],
    filtros_substituidos: [], fontes_sem_remetentes: [], arquivados: {} };
}

export async function garantirEtiquetas(api, cfg, rel = novoRelatorio()) {
  const existentes = Object.fromEntries(((await api("GET", "/labels")).labels || []).map((l) => [l.name, l.id]));
  const nomes = nomesEtiquetas(cfg);
  const ordem = ["_raiz", ...Object.keys(nomes).filter((k) => k !== "_raiz")]; // a raiz primeiro, para aninhar
  const ids = {};
  for (const k of ordem) {
    const nome = nomes[k];
    if (existentes[nome]) { ids[k] = existentes[nome]; rel.etiquetas_existentes.push(nome); continue; }
    const c = await api("POST", "/labels", { name: nome, labelListVisibility: "labelShow", messageListVisibility: "show" });
    ids[k] = c.id; existentes[nome] = c.id; rel.etiquetas_criadas.push(nome);
  }
  return ids;
}

export const criterioRemetentes = (lista) => [...new Set((lista || []).map((r) => r.trim()).filter(Boolean))].sort().join(" OR ");

/** Um filtro por fonte: remetente → aplica a etiqueta e retira da caixa de entrada.
 *  Se os remetentes mudarem, o filtro antigo dessa etiqueta é apagado e criado de novo. */
export async function garantirFiltros(api, cfg, ids, rel = novoRelatorio()) {
  const filtros = (await api("GET", "/settings/filters")).filter || [];
  for (const fonte of FONTES) {
    const criterio = criterioRemetentes(cfg.gmail.remetentes[fonte]);
    if (!criterio) { rel.fontes_sem_remetentes.push(fonte); continue; }
    const daFonte = filtros.filter((f) => ((f.action || {}).addLabelIds || []).includes(ids[fonte]));
    const igual = daFonte.filter((f) => (f.criteria || {}).from === criterio && ((f.action || {}).removeLabelIds || []).includes("INBOX"));
    if (igual.length) { rel.filtros_existentes.push(fonte); continue; }
    for (const antigo of daFonte) await api("DELETE", `/settings/filters/${antigo.id}`);
    await api("POST", "/settings/filters", { criteria: { from: criterio }, action: { addLabelIds: [ids[fonte]], removeLabelIds: ["INBOX"] } });
    (daFonte.length ? rel.filtros_substituidos : rel.filtros_criados).push(fonte);
  }
}

async function listarIds(api, params, limite) {
  const ids = [];
  let pagina = null;
  do {
    const q = new URLSearchParams({ ...params, ...(pagina ? { pageToken: pagina } : {}) });
    const r = await api("GET", "/messages?" + q.toString());
    (r.messages || []).forEach((m) => ids.push(m.id));
    pagina = r.nextPageToken;
  } while (pagina && !(limite && ids.length >= limite));
  return limite ? ids.slice(0, limite) : ids;
}

/** Os filtros só atuam sobre e-mails novos: etiqueta e arquiva em lote os alertas já recebidos. */
export async function arquivarAntigos(api, cfg, ids, rel = novoRelatorio()) {
  for (const fonte of FONTES) {
    const criterio = criterioRemetentes(cfg.gmail.remetentes[fonte]);
    if (!criterio) continue;
    const msgs = await listarIds(api, { q: `from:(${criterio})`, maxResults: "500" });
    for (let i = 0; i < msgs.length; i += 1000) {
      await api("POST", "/messages/batchModify", { ids: msgs.slice(i, i + 1000), addLabelIds: [ids[fonte]], removeLabelIds: ["INBOX"] });
    }
    rel.arquivados[fonte] = msgs.length;
  }
}

export async function configurar(api, cfg, { arquivar = true } = {}) {
  const rel = novoRelatorio();
  const ids = await garantirEtiquetas(api, cfg, rel);
  await garantirFiltros(api, cfg, ids, rel);
  if (arquivar) await arquivarAntigos(api, cfg, ids, rel);
  return rel;
}

export function textoRelatorio(rel) {
  const l = [];
  if (rel.etiquetas_criadas.length) l.push("Etiquetas criadas: " + rel.etiquetas_criadas.join(", "));
  if (rel.filtros_criados.length) l.push("Filtros criados: " + rel.filtros_criados.join(", "));
  if (rel.filtros_existentes.length) l.push("Filtros já existentes: " + rel.filtros_existentes.join(", "));
  if (rel.filtros_substituidos.length) l.push("Filtros atualizados: " + rel.filtros_substituidos.join(", "));
  if (rel.fontes_sem_remetentes.length) l.push("Sem remetentes (sem filtro): " + rel.fontes_sem_remetentes.join(", "));
  for (const [f, n] of Object.entries(rel.arquivados)) l.push(`Alertas antigos arquivados (${f}): ${n}`);
  return l.join("\n") || "Tudo já estava configurado.";
}

const CONSULTA_DESCOBERTA = (dias) =>
  `newer_than:${dias}d (subject:(vaga OR vagas OR emprego OR job OR jobs OR "job alert" OR alerta OR offre OR emploi OR career OR careers) ` +
  "OR from:(linkedin OR indeed OR net-empregos OR jobs.lu OR deloitte OR pwc OR ey OR kpmg OR workday OR successfactors))";

/** Remetentes prováveis de alertas [{endereco, n, assunto}] — só para o utilizador confirmar. */
export async function descobrirRemetentes(api, dias = 60, maximo = 150) {
  const ids = await listarIds(api, { q: CONSULTA_DESCOBERTA(dias), maxResults: "100" }, maximo);
  const contagem = new Map();
  for (const id of ids) {
    const m = await api("GET", `/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`);
    const cab = Object.fromEntries(((m.payload || {}).headers || []).map((h) => [h.name.toLowerCase(), h.value]));
    const end = (cab.from || "").split("<").pop().replace(">", "").trim().toLowerCase();
    if (!end) continue;
    const c = contagem.get(end) || { endereco: end, n: 0, assunto: cab.subject || "" };
    c.n++; contagem.set(end, c);
  }
  return [...contagem.values()].sort((a, b) => b.n - a.n);
}

// ---------------------------------------------------------------- M1: recolha

/** Lê os e-mails Vagas/* ainda não processados, guarda as vagas e marca-os com Vagas/Processado.
 *  Os e-mails não reconhecidos NÃO são marcados: voltam a ser lidos quando o parser for corrigido. */
export async function recolher(api, estado, cfg, res, parseHTML) {
  const ids = await garantirEtiquetas(api, cfg);
  const processado = ids._processado;
  const maximo = Number(cfg.gmail.max_emails_por_recolha || 100);
  const qProc = "-label:" + cfg.gmail.etiqueta_processado.toLowerCase().replace(/[/ ]/g, "-");
  const ignorados = new Set(estado.naoReconhecidos.filter((r) => r.resolvido).map((r) => r.id));
  for (const fonte of FONTES) {
    if (res.emails_lidos >= maximo) break;
    const msgs = await listarIds(api, { labelIds: ids[fonte], q: qProc, maxResults: "100" }, maximo);
    for (const id of msgs) {
      if (res.emails_lidos >= maximo) break;
      if (ignorados.has(id)) continue;
      const m = await api("GET", `/messages/${id}?format=full`);
      if ((m.labelIds || []).includes(processado)) continue;
      res.emails_lidos++;
      const [html, texto] = partesEmail(m.payload || {});
      const meta = metadados(m.payload || {});
      if (processarEmail(estado, cfg, fonte, id, html, texto, meta, res, parseHTML)) {
        await api("POST", `/messages/${id}/modify`, { addLabelIds: [processado] });
      }
    }
  }
  if (res.emails_lidos >= maximo) res.avisos.push(`Limite de ${maximo} e-mails por recolha atingido; recolha de novo para continuar.`);
  return res;
}

