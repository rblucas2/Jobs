/* M5 — Estados das candidaturas, transições, follow-ups, métricas e exportação CSV (Power BI). */
import * as dados from "./dados.js";
import { contemTermo, hojeISO, sinonimos, somarDias } from "./texto.js";

export const POR_CANDIDATAR = "Por candidatar", CANDIDATADO = "Candidatado", ENTREVISTA = "Entrevista";
export const REJEITADO = "Rejeitado", OFERTA = "Oferta", DESCARTADA = "Descartada";
export const ESTADOS = [POR_CANDIDATAR, CANDIDATADO, ENTREVISTA, REJEITADO, OFERTA, DESCARTADA];

export const TRANSICOES = {
  [POR_CANDIDATAR]: [CANDIDATADO, DESCARTADA],
  [CANDIDATADO]: [ENTREVISTA, REJEITADO, OFERTA, DESCARTADA],
  [ENTREVISTA]: [REJEITADO, OFERTA, DESCARTADA],
  [REJEITADO]: [], [OFERTA]: [],
  [DESCARTADA]: [POR_CANDIDATAR],
};

export class TransicaoInvalida extends Error {}

export const transicoesPossiveis = (estado) => ESTADOS.filter((e) => (TRANSICOES[estado] || []).includes(e));

function verificarCv(estado, vagaId, cvId) {
  const c = dados.obterCv(estado, cvId);
  if (!c || c.estado !== "aprovado" || c.vaga_id !== vagaId || c.tipo !== "cv") throw new TransicaoInvalida("Só um CV aprovado desta vaga pode ser marcado como usado.");
}

/** Muda o estado. `forcar` permite corrigir enganos (ex.: voltar atrás). */
export function mudarEstado(estado, cfg, vagaId, novo, { data, cvId, forcar = false } = {}) {
  if (!ESTADOS.includes(novo)) throw new TransicaoInvalida(`Estado desconhecido: ${novo}`);
  const v = dados.obterVaga(estado, vagaId);
  if (novo === v.estado) return;
  if (!forcar && !TRANSICOES[v.estado].includes(novo)) throw new TransicaoInvalida(`Transição não permitida: ${v.estado} → ${novo}`);
  data = data || hojeISO();
  const campos = { estado: novo };
  if (cvId) { verificarCv(estado, vagaId, cvId); campos.cv_id = cvId; }
  if (novo === CANDIDATADO) { campos.data_candidatura = data; campos.data_followup = somarDias(data, Number(cfg.tracker.dias_followup || 10)); }
  if (novo === ENTREVISTA && !v.data_entrevista) campos.data_entrevista = data;
  if ([REJEITADO, OFERTA, DESCARTADA].includes(novo)) campos.data_followup = null;
  dados.atualizarCandidatura(estado, vagaId, campos);
}

export function definirCv(estado, vagaId, cvId) {
  verificarCv(estado, vagaId, cvId);
  dados.atualizarCandidatura(estado, vagaId, { cv_id: cvId });
}

export function followupsEmAtraso(estado, hoje = hojeISO()) {
  return estado.vagas.filter((v) => [CANDIDATADO, ENTREVISTA].includes(v.estado) && v.data_followup && v.data_followup < hoje);
}

export function tipoVaga(cargo, cfg) {
  for (const area of cfg.areas_alvo || []) { const s = sinonimos(area); if (s.some((t) => contemTermo(cargo, t))) return s[0]; }
  return "Outra";
}

export function metricas(estado, cfg, hoje = hojeISO()) {
  const vs = estado.vagas;
  const porEstado = Object.fromEntries(ESTADOS.map((e) => [e, vs.filter((v) => v.estado === e).length]));
  const candidatadas = vs.filter((v) => v.data_candidatura);
  const respondidas = candidatadas.filter((v) => [ENTREVISTA, REJEITADO, OFERTA].includes(v.estado) || v.data_entrevista);
  const conta = (lista, f) => lista.reduce((o, v) => { const k = f(v); o[k] = (o[k] || 0) + 1; return o; }, {});
  const comEntrevista = vs.filter((v) => v.data_entrevista);
  return {
    por_estado: porEstado, total_vagas: vs.length, candidaturas: candidatadas.length, respondidas: respondidas.length,
    taxa_resposta: candidatadas.length ? respondidas.length / candidatadas.length : null,
    entrevistas: comEntrevista.length,
    entrevistas_por_fonte: conta(comEntrevista, (v) => v.fonte),
    entrevistas_por_tipo: conta(comEntrevista, (v) => tipoVaga(v.cargo, cfg)),
    candidaturas_por_fonte: conta(candidatadas, (v) => v.fonte),
    followups_em_atraso: followupsEmAtraso(estado, hoje).length,
    aguardam_resposta: porEstado[CANDIDATADO],
  };
}

export const COLUNAS = ["vaga_id", "cargo", "empresa", "localizacao", "fonte", "tipo_vaga", "link_canonico", "data_publicacao", "data_recolha",
  "pontuacao_global", "preliminar", "estado", "cv_id", "data_candidatura", "data_entrevista", "data_followup", "contacto", "notas"];

/** CSV em UTF-8 com BOM (abre corretamente no Excel e no Power BI). */
export function exportarCsv(estado, cfg) {
  const sep = cfg.exportacao.separador_csv || ";";
  const campo = (v) => { const s = v == null ? "" : String(v); return /["\n\r]/.test(s) || s.includes(sep) ? `"${s.replace(/"/g, '""')}"` : s; };
  const linhas = [COLUNAS.join(sep)];
  for (const v of dados.listarVagas(estado)) {
    const linha = { ...v, vaga_id: v.id, tipo_vaga: tipoVaga(v.cargo, cfg), preliminar: v.preliminar == null ? "" : v.preliminar ? "sim" : "não" };
    linhas.push(COLUNAS.map((c) => campo(linha[c])).join(sep));
  }
  return "﻿" + linhas.join("\r\n") + "\r\n";
}
