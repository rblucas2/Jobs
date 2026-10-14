/* M1 — Recolha: extrai, deduplica e guarda as vagas de um e-mail; inserção manual. */
import * as dados from "./dados.js";
import { chaveNormalizada, extrair, fontePorLink, linkCanonico } from "./parsers.js";
import { hojeISO } from "./texto.js";

export function novoResultado() {
  return { emails_lidos: 0, vagas_novas: [], duplicadas: 0, nao_reconhecidos: 0, avisos: [] };
}

/** Insere a vaga se não for duplicada. Devolve [id, nova]. */
export function guardarVaga(estado, v) {
  const canon = linkCanonico(v.link);
  const chave = chaveNormalizada(v.empresa, v.cargo, v.localizacao);
  const existente = dados.encontrarDuplicado(estado, canon, chave);
  if (existente) return [existente, false];
  const id = dados.inserirVaga(estado, { ...v, link_canonico: canon, link_original: v.link || null, chave_normalizada: chave });
  return [id, true];
}

export function inserirManual(estado, { cargo, empresa = "", localizacao = "", link = "", descricao = "", descricao_completa = true, fonte }) {
  if (!cargo || !cargo.trim()) throw new Error("O cargo é obrigatório.");
  return guardarVaga(estado, {
    cargo, empresa, localizacao, link: link || null, descricao, descricao_completa,
    fonte: fonte || fontePorLink(link), data_publicacao: hojeISO(), origem: "manual",
  });
}

/** Extrai e guarda as vagas de um e-mail. Devolve true se o e-mail foi reconhecido. */
export function processarEmail(estado, cfg, fonte, msgId, html, texto, meta, res, parseHTML) {
  let vagas;
  try {
    vagas = extrair(fonte, html, texto, cfg, parseHTML);
  } catch (e) { // nunca falhar em silêncio
    if (dados.registarNaoReconhecido(estado, msgId, fonte, meta, `erro no parser: ${e.name}: ${e.message}`)) res.nao_reconhecidos++;
    return false;
  }
  if (!vagas.length) {
    let motivo = "nenhuma vaga reconhecida";
    if (fonte === "Outras" && !((cfg.parsers.padroes_link_extra || {}).Outras || []).length) {
      motivo += " (a fonte 'Outras' precisa de padrões de link nas Definições)";
    }
    if (dados.registarNaoReconhecido(estado, msgId, fonte, meta, motivo)) res.nao_reconhecidos++;
    return false;
  }
  for (const v of vagas) {
    const [id, nova] = guardarVaga(estado, {
      ...v, fonte, descricao: v.resumo, descricao_completa: false,
      data_publicacao: meta.date || null, gmail_message_id: msgId, origem: "gmail",
    });
    if (nova) res.vagas_novas.push(id); else res.duplicadas++;
    if (v.avisos.length) res.avisos.push(`${v.cargo}: ${v.avisos.join(", ")} (e-mail: ${meta.subject || ""})`);
  }
  dados.removerNaoReconhecido(estado, msgId);
  return true;
}

// ---------------------------------------------------------------- mensagens da Gmail API

function decodificar(b64) {
  const s = b64.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(s + "=".repeat((4 - (s.length % 4)) % 4));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder("utf-8").decode(bytes);
}

/** [html, texto] de um payload da Gmail API. */
export function partesEmail(payload) {
  let html = null, texto = null;
  const pilha = [payload];
  while (pilha.length) {
    const p = pilha.pop();
    (p.parts || []).forEach((x) => pilha.push(x));
    const corpo = p.body && p.body.data;
    if (!corpo) continue;
    if (p.mimeType === "text/html" && html === null) html = decodificar(corpo);
    else if (p.mimeType === "text/plain" && texto === null) texto = decodificar(corpo);
  }
  return [html, texto];
}

export function metadados(payload) {
  const cab = Object.fromEntries((payload.headers || []).map((h) => [h.name.toLowerCase(), h.value]));
  let data = "";
  if (cab.date) { const d = new Date(cab.date); if (!isNaN(d)) data = d.toISOString().slice(0, 10); }
  return { from: cab.from || "", subject: cab.subject || "", date: data };
}
