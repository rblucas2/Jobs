// M4 (geração, aprovação humana, exportação) e M5 (tracker e métricas).
import assert from "node:assert/strict";
import { test } from "node:test";
import * as docx from "docx";
import * as cvM from "../js/cv.js";
import * as dados from "../js/dados.js";
import * as tracker from "../js/tracker.js";
import { podeAprovar } from "../js/validador.js";
import { cfg, comPerfil, estado, HOJE, perfil } from "./comum.js";

function comVaga(e) {
  return dados.inserirVaga(e, { cargo: "Analista de Controlo de Gestão", empresa: "Retalho Alfa", localizacao: "Lisboa", chave_normalizada: "k1",
    fonte: "LinkedIn", descricao: "Reporting mensal em Excel e Power BI, automatização em VBA.", descricao_completa: true });
}

test("fallback por regras gera CV totalmente verificado", async () => {
  const e = estado(); const id = comVaga(e);
  const cv = await cvM.gerarCv(perfil(), dados.obterVaga(e, id), cfg(), { usarLLM: false, hoje: HOJE });
  assert.equal(cv.metodo, "regras"); assert.ok(podeAprovar(cv));
  assert.equal(cv.experiencia[0].experiencia_id, "exp_intermarche");
  assert.deepEqual(cv.competencias_ids.slice(0, 3), ["comp_excel", "comp_power_bi", "comp_vba"]);
});
test("sem perfil validado não gera", async () => {
  const e = estado(); const id = comVaga(e);
  await assert.rejects(cvM.criarRascunho(e, cfg(), id, { usarLLM: false }), /perfil-base validado/);
});
test("aprovação exige confirmação e todos os pontos verificados", async () => {
  const [e, c] = comPerfil(); const id = comVaga(e);
  const cid = await cvM.criarRascunho(e, c, id, { usarLLM: false, hoje: HOJE });
  const conteudo = JSON.parse(JSON.stringify(dados.obterCv(e, cid).conteudo));
  conteudo.experiencia[0].pontos[0].texto = "Gestão de uma equipa de 12 analistas.";
  assert.equal(cvM.editar(e, c, cid, conteudo, HOJE).experiencia[0].pontos[0].estado, "nao_verificado");
  assert.throws(() => cvM.aprovar(e, c, cid, true, HOJE), cvM.AprovacaoRecusada);
  assert.throws(() => cvM.prepararExportacao(e, c, cid, HOJE), /aprovados/);
  conteudo.experiencia[0].pontos.shift();
  cvM.editar(e, c, cid, conteudo, HOJE);
  assert.throws(() => cvM.aprovar(e, c, cid, false, HOJE), /explicitamente/);
  cvM.aprovar(e, c, cid, true, HOJE);
  assert.equal(dados.obterCv(e, cid).estado, "aprovado");
  assert.throws(() => cvM.editar(e, c, cid, conteudo, HOJE), /imutável/);
});
test("exportação exige o formato aprovado, liga ao tracker e gera Word", async () => {
  const [e, c] = comPerfil(); const id = comVaga(e);
  const cid = await cvM.criarRascunho(e, c, id, { usarLLM: false, hoje: HOJE });
  cvM.aprovar(e, c, cid, true, HOJE);
  assert.throws(() => cvM.prepararExportacao(e, c, cid, HOJE), /formato/);
  c.cv.modelo_aprovado = true;
  const blocos = cvM.prepararExportacao(e, c, cid, HOJE);
  assert.equal(dados.obterVaga(e, id).cv_id, cid);
  const textos = blocos.map((b) => b[1]);
  assert.ok(textos.includes("Pessoa Exemplo") && textos.includes("Analista de Controlo de Gestão — Intermarché"));
  assert.ok(textos.includes("Lisboa · set. 2021 – Atual"));
  const blob = await cvM.gerarDocx(blocos, docx);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  assert.ok(bytes.length > 3000); assert.equal(String.fromCharCode(bytes[0], bytes[1]), "PK"); // ficheiro .docx (zip)
});
test("carta por regras", async () => {
  const [e, c] = comPerfil(); const id = comVaga(e);
  const cid = await cvM.criarRascunho(e, c, id, { tipo: "carta", usarLLM: false, hoje: HOJE });
  const reg = dados.obterCv(e, cid);
  assert.equal(reg.tipo, "carta"); assert.ok(reg.conteudo.paragrafos.length);
  cvM.aprovar(e, c, cid, true, HOJE);
  const b = cvM.blocos(e, c, dados.obterCv(e, cid));
  assert.deepEqual(b[b.length - 2], ["texto", "Com os melhores cumprimentos,"]);
});
test("saída do modelo local com factos inventados é bloqueada", async () => {
  const e = estado(); const id = comVaga(e);
  const resposta = cvM.validarRespostaCv({
    resumo: [{ texto: "Analista com 12 anos de experiência em M&A.", source_ids: ["resumo_01"] }],
    experiencia: [{ experiencia_id: "exp_intermarche", pontos: [
      { texto: "Reporting mensal de vendas e margens para 45 lojas, em Excel e Power BI.", source_ids: ["exp_intermarche_01"] },
      { texto: "Liderança de uma equipa de 6 analistas na Sonae.", source_ids: ["exp_intermarche_99"] }] }],
    formacao_ids: ["form_nova_sbe"], competencias_ids: ["comp_excel"], linguas_ids: ["ling_ingles"], certificacoes_ids: ["cert_cfa"],
  });
  const cv = await cvM.gerarCv(perfil(), dados.obterVaga(e, id), cfg(), { usarLLM: true, hoje: HOJE, gerar: async () => resposta });
  assert.equal(cv.metodo, "llm");
  assert.equal(cv.resumo[0].estado, "nao_verificado");
  assert.deepEqual(cv.experiencia[0].pontos.map((p) => p.estado), ["verificado", "nao_verificado"]);
  assert.ok(cv.erros.some((x) => x.includes("cert_cfa"))); assert.ok(!podeAprovar(cv));
});
test("modelo indisponível recorre às regras", async () => {
  const e = estado(); const id = comVaga(e);
  const cv = await cvM.gerarCv(perfil(), dados.obterVaga(e, id), cfg(), { usarLLM: true, hoje: HOJE, gerar: async () => { throw new Error("sem servidor"); } });
  assert.equal(cv.metodo, "regras"); assert.ok(podeAprovar(cv));
});
test("diff realça palavras novas e retiradas", () => {
  const h = cvM.diffHtml("Elaboração do reporting mensal", "Reporting mensal");
  assert.match(h, /<del>[^<]*Elaboração[^<]*<\/del>/); assert.match(h, /<del>[^<]*do reporting[^<]*<\/del>/);
  assert.match(h, /<ins>Reporting<\/ins>/); assert.match(h, /mensal$/);
  assert.equal(cvM.diffHtml("igual", "igual"), "igual");
});

// ---------------------------------------------------------------- tracker

test("transições e follow-up", () => {
  const e = estado(), c = cfg(); const id = comVaga(e);
  tracker.mudarEstado(e, c, id, tracker.CANDIDATADO, { data: "2026-10-01" });
  let v = dados.obterVaga(e, id);
  assert.equal(v.data_candidatura, "2026-10-01"); assert.equal(v.data_followup, "2026-10-11");
  assert.throws(() => tracker.mudarEstado(e, c, id, tracker.POR_CANDIDATAR), tracker.TransicaoInvalida);
  assert.equal(tracker.followupsEmAtraso(e, "2026-10-14")[0].id, id);
  tracker.mudarEstado(e, c, id, tracker.ENTREVISTA, { data: "2026-10-12" });
  tracker.mudarEstado(e, c, id, tracker.REJEITADO);
  v = dados.obterVaga(e, id);
  assert.equal(v.data_entrevista, "2026-10-12"); assert.equal(v.data_followup, null);
});
test("dias de follow-up configuráveis", () => {
  const e = estado(), c = cfg(); c.tracker.dias_followup = 5; const id = comVaga(e);
  tracker.mudarEstado(e, c, id, tracker.CANDIDATADO, { data: "2026-10-01" });
  assert.equal(dados.obterVaga(e, id).data_followup, "2026-10-06");
});
test("só um CV aprovado pode ser marcado como usado", async () => {
  const [e, c] = comPerfil(); const id = comVaga(e);
  const cid = await cvM.criarRascunho(e, c, id, { usarLLM: false, hoje: HOJE });
  assert.throws(() => tracker.mudarEstado(e, c, id, tracker.CANDIDATADO, { cvId: cid }), /aprovado/);
  cvM.aprovar(e, c, cid, true, HOJE);
  tracker.mudarEstado(e, c, id, tracker.CANDIDATADO, { cvId: cid });
  assert.equal(dados.obterVaga(e, id).cv_id, cid);
});
test("métricas e CSV", () => {
  const e = estado(), c = cfg(); const a = comVaga(e);
  const b = dados.inserirVaga(e, { cargo: "Valuation Analyst", empresa: "B", localizacao: "Porto", chave_normalizada: "k2", fonte: "Indeed" });
  tracker.mudarEstado(e, c, a, tracker.CANDIDATADO); tracker.mudarEstado(e, c, b, tracker.CANDIDATADO); tracker.mudarEstado(e, c, b, tracker.ENTREVISTA);
  const m = tracker.metricas(e, c);
  assert.equal(m.candidaturas, 2); assert.equal(m.respondidas, 1); assert.equal(m.taxa_resposta, 0.5);
  assert.deepEqual(m.entrevistas_por_fonte, { Indeed: 1 }); assert.deepEqual(m.entrevistas_por_tipo, { Valuation: 1 });
  const csv = tracker.exportarCsv(e, c);
  assert.ok(csv.startsWith("﻿"));
  const linhas = csv.slice(1).trim().split("\r\n").map((l) => l.split(";"));
  const col = (n) => linhas[0].indexOf(n);
  assert.deepEqual(new Set(linhas.slice(1).map((l) => l[col("estado")])), new Set(["Candidatado", "Entrevista"]));
  assert.deepEqual(new Set(linhas.slice(1).map((l) => l[col("tipo_vaga")])), new Set(["Outra", "Valuation"]));
});
