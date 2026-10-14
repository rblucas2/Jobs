// Validador do M4 — critério da Fase 5: um número ou facto inexistente no perfil é SEMPRE bloqueado.
import assert from "node:assert/strict";
import { test } from "node:test";
import { indexar } from "../js/perfil.js";
import { numeros, podeAprovar, problemas, validarCarta, validarCv } from "../js/validador.js";
import { cfg, HOJE, perfil } from "./comum.js";

const P = perfil(), C = cfg();
const item = (id) => indexar(P).get(id);

function cvCom(pontos, expId = "exp_intermarche", resumo = []) {
  return { resumo, experiencia: [{ experiencia_id: expId, pontos }], formacao_ids: ["form_nova_sbe"], competencias_ids: ["comp_excel"], linguas_ids: ["ling_ingles"], certificacoes_ids: [] };
}
const umPonto = (texto, ids, expId = "exp_intermarche") => validarCv(cvCom([{ texto, source_ids: ids }], expId), P, C, HOJE).experiencia[0].pontos[0];
const umResumo = (texto, ids) => validarCv(cvCom([], "exp_intermarche", [{ texto, source_ids: ids }]), P, C, HOJE).resumo[0];
const ok = (p) => assert.equal(p.estado, "verificado", p.motivos.join("; "));
const bloqueado = (p, msg) => assert.equal(p.estado, "nao_verificado", msg);

// ---------------------------------------------------------------- casos válidos

test("ponto copiado da origem é verificado", () => ok(umPonto(item("exp_intermarche_01").texto, ["exp_intermarche_01"])));
test("reformulação sem factos novos é verificada", () => ok(umPonto("Reporting mensal de vendas e margens de 45 lojas com Excel e Power BI.", ["exp_intermarche_01"])));
test("separadores de milhares equivalentes", () => ok(umPonto("Análise de desvios orçamentais em 1500 artigos por trimestre.", ["exp_intermarche_03"])));
test("ano do cabeçalho da experiência é aceite", () => ok(umPonto("Desde 2021, reporting mensal de vendas para 45 lojas.", ["exp_intermarche_01"])));
test("juntar dois itens da mesma experiência", () => ok(umPonto("Automatização de relatórios em VBA (redução de 15% no fecho) e reporting para 45 lojas.", ["exp_intermarche_01", "exp_intermarche_02"])));
test("resumo pode citar competências", () => ok(umResumo("Utilizador de Excel, Power BI e SQL.", ["comp_excel", "comp_power_bi", "comp_sql"])));
test("resumo: anos de experiência derivados das datas", () => ok(umResumo("Analista financeiro com 3 anos de experiência.", ["resumo_01", "exp_intermarche"])));

// ---------------------------------------------------------------- source_ids

test("sem source_ids é bloqueado", () => { const p = umPonto("Reporting mensal de vendas.", []); bloqueado(p); assert.ok(p.motivos.some((m) => m.includes("source_ids"))); });
test("source_id inexistente é bloqueado", () => { const p = umPonto("Reporting mensal de vendas.", ["exp_intermarche_99"]); bloqueado(p); assert.ok(p.motivos.some((m) => m.includes("inexistentes"))); });
test("citar outra experiência é bloqueado", () => { const p = umPonto("Apoio a trabalhos de auditoria financeira de 8 clientes.", ["exp_auditora_01"]); bloqueado(p); assert.ok(p.motivos.some((m) => m.includes("outra"))); });
test("competência não justifica ferramenta numa experiência", () => bloqueado(umPonto("Análise de desvios orçamentais em SQL.", ["exp_intermarche_03", "comp_sql"])));
test("experiência inexistente é erro estrutural", () => {
  const cv = validarCv(cvCom([{ texto: "x", source_ids: ["resumo_01"] }], "exp_inventada"), P, C, HOJE);
  assert.ok(cv.erros.some((e) => e.includes("exp_inventada"))); assert.ok(!podeAprovar(cv));
});
test("IDs de secções inválidos são erro", () => {
  const cv = cvCom([{ texto: item("exp_intermarche_01").texto, source_ids: ["exp_intermarche_01"] }]);
  cv.competencias_ids = ["comp_excel", "comp_inventada"]; cv.linguas_ids = ["comp_excel"];
  const v = validarCv(cv, P, C, HOJE);
  assert.ok(v.erros.some((e) => e.includes("comp_inventada"))); assert.ok(v.erros.some((e) => e.includes("línguas")));
});

// ---------------------------------------------------------------- números, datas e percentagens

for (const texto of [
  "Reporting mensal de vendas e margens para 50 lojas, em Excel e Power BI.",
  "Reporting mensal de vendas e margens para 45 lojas e 3 regiões.",
  "Redução de 20% no tempo de fecho mensal com VBA.",
  "Redução de 15% no tempo de fecho mensal, poupando 120 horas por ano.",
  "Análise de desvios orçamentais com 1,5 artigos.",
  "Desde 2019, reporting mensal para 45 lojas.",
  "Reporting mensal para 45 lojas, com um orçamento de 2M€.",
  "Reporting mensal para 45 lojas, com vendas de 50k.",
  "Reporting mensal para 45 lojas e cinco regiões.",
  "Reporting mensal para 45 lojas e milhares de artigos.",
  "Redução de 15 % do tempo de fecho e de 10 % dos erros.",
]) test(`número inexistente é bloqueado: ${texto}`, () => bloqueado(umPonto(texto, ["exp_intermarche_01", "exp_intermarche_02"]), texto));

test("percentagem não pode vir de um número simples", () => bloqueado(umPonto("Aumento de 45% nas vendas das lojas.", ["exp_intermarche_01"])));
test("número de outro item não citado é bloqueado", () => bloqueado(umPonto("Reporting mensal para 45 lojas com redução de 15% no fecho.", ["exp_intermarche_01"])));
test("anos de experiência acima do real são bloqueados", () => bloqueado(umResumo("Analista financeiro com 10 anos de experiência.", ["resumo_01", "exp_intermarche"])));

test("propriedade: qualquer número novo é sempre bloqueado", () => {
  let semente = 42;
  const rnd = (a, b) => { semente = (semente * 1103515245 + 12345) % 2 ** 31; return a + (semente % (b - a + 1)); };
  const idx = indexar(P);
  let casos = 0;
  for (const e of P.experiencia) for (const it of e.itens) {
    const origem = numeros(idx.get(it.id).contexto);
    for (let k = 0; k < 40; k++) {
      const n = [rnd(2, 99), rnd(100, 9999), rnd(10000, 999999)][rnd(0, 2)];
      if (origem.has(String(n))) continue;
      const escrito = [`${n}`, `${n}%`, `${n} €`, `+${n}`, n.toLocaleString("en-US").replace(/,/g, ".")][rnd(0, 4)];
      const texto = `${it.texto} Resultado: ${escrito}.`;
      bloqueado(umPonto(texto, [it.id], e.id), texto);
      casos++;
    }
  }
  assert.ok(casos > 150);
});

// ---------------------------------------------------------------- ferramentas, línguas, certificações, entidades

for (const [texto, motivo] of [
  ["Reporting mensal de vendas para 45 lojas em Tableau.", "Tableau"],
  ["Reporting mensal de vendas para 45 lojas em Excel e SAP.", "SAP"],
  ["Reporting mensal de vendas para 45 lojas, com certificação CFA.", "CFA"],
  ["Reporting mensal de vendas para 45 lojas em inglês e francês.", "Francês"],
  ["Reporting mensal de vendas para 45 lojas em SQL.", "SQL"],
  ["Reporting mensal de vendas para 45 lojas da Sonae.", "Sonae"],
  ["Reporting mensal de vendas para 45 lojas segundo IFRS.", "IFRS"],
]) test(`termo inexistente na origem é bloqueado: ${motivo}`, () => {
  const p = umPonto(texto, ["exp_intermarche_01"]);
  bloqueado(p); assert.ok(p.motivos.some((m) => m.toLowerCase().includes(motivo.toLowerCase())), p.motivos.join("; "));
});

test("língua inexistente no perfil é bloqueada no resumo", () => bloqueado(umResumo("Fluente em inglês e alemão.", ["ling_ingles"])));
test("certificação inventada no resumo é bloqueada", () => bloqueado(umResumo("Analista financeiro certificado ACCA.", ["resumo_01"])));

for (const texto of [
  "Duplicou a eficiência do reporting mensal de vendas para 45 lojas.",
  "Melhor analista do reporting mensal de vendas para 45 lojas.",
  "Reporting mensal de vendas para todas as 45 lojas.",
  "Prémio pelo reporting mensal de vendas para 45 lojas.",
]) test(`termo quantitativo/de distinção é bloqueado: ${texto}`, () => bloqueado(umPonto(texto, ["exp_intermarche_01"])));

// ---------------------------------------------------------------- aprovação

test("CV com ponto não verificado não pode ser aprovado", () => {
  const cv = validarCv(cvCom([{ texto: item("exp_intermarche_01").texto, source_ids: ["exp_intermarche_01"] }, { texto: "Gestão de uma equipa de 12 pessoas.", source_ids: ["exp_intermarche_01"] }]), P, C, HOJE);
  assert.ok(!podeAprovar(cv)); assert.ok(problemas(cv).some((p) => p.includes("12")));
});
test("CV totalmente verificado pode ser aprovado", () => {
  const e = P.experiencia[0];
  assert.ok(podeAprovar(validarCv(cvCom(e.itens.map((i) => ({ texto: i.texto, source_ids: [i.id] }))), P, C, HOJE)));
});
test("estado dado pelo modelo é ignorado", () => {
  const cv = cvCom([{ texto: "Gestão de 12 pessoas.", source_ids: ["exp_intermarche_01"], estado: "verificado" }]);
  assert.equal(validarCv(cv, P, C, HOJE).experiencia[0].pontos[0].estado, "nao_verificado");
});
test("carta permite cargo e empresa da vaga, mas não factos novos", () => {
  const vaga = { cargo: "Analista de Valuation", empresa: "Consultora Alfa" };
  const c = validarCarta({ paragrafos: [
    { texto: "Candidato-me à posição de Analista de Valuation na Consultora Alfa, com experiência em controlo de gestão e reporting no retalho.", source_ids: ["resumo_01"] },
    { texto: "Na Consultora Alfa poderei aplicar os meus 6 anos de experiência em M&A.", source_ids: ["resumo_01"] },
  ] }, P, C, vaga, HOJE);
  ok(c.paragrafos[0]); bloqueado(c.paragrafos[1]);
});
