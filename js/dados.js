/* Operações sobre o estado da app (equivalente às tabelas vagas, analises, cvs, candidaturas).

   estado = {
     vagas: [{id, cargo, empresa, localizacao, link_canonico, link_original, chave_normalizada, fonte,
              data_publicacao, data_recolha, descricao, descricao_completa, gmail_message_id, origem,
              // candidatura (1:1 com a vaga):
              estado, cv_id, data_candidatura, data_entrevista, contacto, notas, data_followup, _u}],
     analises: [{id, vaga_id, pontuacao_global, subpontuacoes, requisitos_cumpridos, lacunas, preliminar,
                 eliminatoria_falhada, resumo, metodo, versao_perfil, data, _u}],
     cvs: [{id, vaga_id, tipo, versao_perfil, conteudo, estado, data_criacao, data_aprovacao, _u}],
     naoReconhecidos: [{id (= id do e-mail), fonte, remetente, assunto, data_email, motivo, data_registo, resolvido, _u}],
     perfis: [...], config: {...}
   }
   Cada item tem _u (momento da última alteração), usado pela sincronização. */
import { uid } from "./texto.js";

const agora = () => new Date().toISOString().slice(0, 19);
export const tocar = (x) => { x._u = Date.now(); return x; };

export function garantirEstrutura(estado) {
  for (const k of ["vagas", "analises", "cvs", "naoReconhecidos", "perfis"]) if (!Array.isArray(estado[k])) estado[k] = [];
  if (!estado.config || typeof estado.config !== "object") estado.config = {};
  return estado;
}

// ---------------------------------------------------------------- vagas

export function encontrarDuplicado(estado, linkCanonico, chave) {
  if (linkCanonico) {
    const v = estado.vagas.find((x) => x.link_canonico === linkCanonico);
    if (v) return v.id;
  }
  const v = estado.vagas.find((x) => x.chave_normalizada === chave);
  return v ? v.id : null;
}

export function inserirVaga(estado, v) {
  const vaga = tocar({
    id: uid(), cargo: v.cargo.trim(), empresa: (v.empresa || "").trim(), localizacao: (v.localizacao || "").trim(),
    link_canonico: v.link_canonico || null, link_original: v.link_original || null, chave_normalizada: v.chave_normalizada,
    fonte: v.fonte, data_publicacao: v.data_publicacao || null, data_recolha: v.data_recolha || agora(),
    descricao: v.descricao || "", descricao_completa: !!v.descricao_completa, gmail_message_id: v.gmail_message_id || null,
    origem: v.origem || "gmail",
    estado: "Por candidatar", cv_id: null, data_candidatura: null, data_entrevista: null, contacto: "", notas: "", data_followup: null,
  });
  estado.vagas.push(vaga);
  return vaga.id;
}

export const obterVaga = (estado, id) => estado.vagas.find((v) => v.id === id) || null;

export function atualizarVaga(estado, id, campos) {
  const v = obterVaga(estado, id);
  if (!v) throw new Error("Vaga inexistente.");
  const permitidos = ["cargo", "empresa", "localizacao", "fonte", "data_publicacao", "descricao", "descricao_completa"];
  for (const k of permitidos) if (k in campos) v[k] = campos[k];
  tocar(v);
}

export function atualizarCandidatura(estado, id, campos) {
  const v = obterVaga(estado, id);
  const permitidos = ["cv_id", "estado", "data_candidatura", "data_entrevista", "contacto", "notas", "data_followup"];
  for (const k of permitidos) if (k in campos) v[k] = campos[k];
  tocar(v);
}

// ---------------------------------------------------------------- análises

export function guardarAnalise(estado, vagaId, r, versaoPerfil) {
  const a = tocar({ id: uid(), vaga_id: vagaId, ...JSON.parse(JSON.stringify(r)), versao_perfil: versaoPerfil, data: agora() });
  estado.analises.push(a);
  // Guarda só as 3 análises mais recentes por vaga, para a sincronização não crescer sem limite.
  const daVaga = estado.analises.filter((x) => x.vaga_id === vagaId);
  if (daVaga.length > 3) {
    const remover = new Set(daVaga.slice(0, daVaga.length - 3).map((x) => x.id));
    estado.analises = estado.analises.filter((x) => !remover.has(x.id));
  }
  return a.id;
}

export function ultimaAnalise(estado, vagaId) {
  const lista = estado.analises.filter((a) => a.vaga_id === vagaId);
  return lista.length ? lista.reduce((a, b) => ((a.data || "") > (b.data || "") ? a : b)) : null;
}

export function vagasSemAnalise(estado) {
  const com = new Set(estado.analises.map((a) => a.vaga_id));
  return estado.vagas.filter((v) => !com.has(v.id)).map((v) => v.id);
}

/** Vagas com a última análise, ordenadas por pontuação (sem pontuação no fim). */
export function listarVagas(estado) {
  return estado.vagas.map((v) => {
    const a = ultimaAnalise(estado, v.id);
    return { ...v, pontuacao_global: a ? a.pontuacao_global : null, preliminar: a ? a.preliminar : null,
      eliminatoria_falhada: a ? a.eliminatoria_falhada : false, metodo: a ? a.metodo : null };
  }).sort((a, b) => (b.pontuacao_global ?? -1) - (a.pontuacao_global ?? -1) || String(b.data_recolha).localeCompare(String(a.data_recolha)));
}

export function apagarVaga(estado, id) {
  estado.vagas = estado.vagas.filter((v) => v.id !== id);
  estado.analises = estado.analises.filter((a) => a.vaga_id !== id);
  estado.cvs = estado.cvs.filter((c) => c.vaga_id !== id);
}

// ---------------------------------------------------------------- CVs

export function guardarCv(estado, vagaId, tipo, versaoPerfil, conteudo) {
  const c = tocar({ id: uid(), vaga_id: vagaId, tipo, versao_perfil: versaoPerfil, conteudo: JSON.parse(JSON.stringify(conteudo)),
    estado: "rascunho", data_criacao: agora(), data_aprovacao: null });
  estado.cvs.push(c);
  return c.id;
}

export const obterCv = (estado, id) => estado.cvs.find((c) => c.id === id) || null;

export function listarCvs(estado, { vagaId, estado: est, tipo } = {}) {
  return estado.cvs.filter((c) => (vagaId == null || c.vaga_id === vagaId) && (!est || c.estado === est) && (!tipo || c.tipo === tipo))
    .sort((a, b) => String(b.data_criacao).localeCompare(String(a.data_criacao)));
}

export function atualizarConteudoCv(estado, id, conteudo) {
  const c = obterCv(estado, id);
  if (!c) throw new Error("Documento inexistente.");
  if (c.estado !== "rascunho") throw new Error("Só rascunhos podem ser editados. Um CV aprovado ou rejeitado é imutável.");
  c.conteudo = JSON.parse(JSON.stringify(conteudo));
  tocar(c);
}

export function definirEstadoCv(estado, id, novo) {
  const c = obterCv(estado, id);
  c.estado = novo;
  c.data_aprovacao = novo === "aprovado" ? agora() : null;
  tocar(c);
}

// ---------------------------------------------------------------- e-mails não reconhecidos

export function registarNaoReconhecido(estado, msgId, fonte, meta, motivo) {
  if (estado.naoReconhecidos.some((r) => r.id === msgId)) return false;
  estado.naoReconhecidos.push(tocar({ id: msgId, fonte, remetente: meta.from || "", assunto: meta.subject || "",
    data_email: meta.date || "", motivo, data_registo: agora(), resolvido: false }));
  return true;
}

export const pendentesNaoReconhecidos = (estado) => estado.naoReconhecidos.filter((r) => !r.resolvido);

export function resolverNaoReconhecido(estado, id) {
  const r = estado.naoReconhecidos.find((x) => x.id === id);
  if (r) { r.resolvido = true; tocar(r); }
}

export function removerNaoReconhecido(estado, id) {
  estado.naoReconhecidos = estado.naoReconhecidos.filter((r) => r.id !== id);
}
