// M2 — perfil-base: IDs estáveis, versões, validação e extração do CV.
import assert from "node:assert/strict";
import { test } from "node:test";
import * as perfilM from "../js/perfil.js";
import { cfg, estado, HOJE, perfil } from "./comum.js";

const CV = `Pessoa Exemplo
Lisboa | exemplo@example.com | +351 900 000 000

Perfil
Analista financeiro com experiência em controlo de gestão.

Experiência Profissional
Analista de Controlo de Gestão | Intermarché
Set 2021 – Atual
• Elaboração do reporting mensal para 45 lojas.
• Redução de 15% no tempo de fecho mensal.
Estagiário de Auditoria | Auditora Exemplo
Fev 2020 - Jul 2021
• Apoio a trabalhos de auditoria de 8 clientes.

Formação
Mestrado em Finanças, Universidade Exemplo
2018 - 2020

Competências
Excel, Power BI, VBA

Línguas
Português – nativo; Inglês – C1

Certificações
CFA Level I (2022)
`;

test("IDs repetidos são rejeitados", () => {
  const p = perfil(); p.competencias[1].id = "comp_excel";
  assert.ok(perfilM.validarPerfil(p).some((e) => e.includes("repetidos")));
});
test("atribuir IDs não altera IDs existentes", () => {
  const p = perfil(); const antes = perfilM.todosIds(p);
  p.experiencia[0].itens.push({ id: "", texto: "Novo", tipo: "responsabilidade" });
  perfilM.atribuirIds(p);
  const depois = perfilM.todosIds(p);
  assert.deepEqual(depois.filter((i) => antes.includes(i)), antes);
  assert.ok(depois.includes("exp_intermarche_04"));
});
test("versão validada é imutável e as novas não ficam validadas sozinhas", () => {
  const e = estado(), c = cfg();
  const n = perfilM.guardarNovaVersao(e, perfil());
  assert.equal(perfilM.perfilValidado(e, c), null);
  perfilM.validarVersao(e, c, n);
  assert.equal(perfilM.perfilValidado(e, c).versao, n);
  assert.throws(() => perfilM.atualizarRascunho(e, c, n, perfil()), /imutável/);
  const n2 = perfilM.guardarNovaVersao(e, perfil(), "alteração");
  assert.equal(n2, n + 1); assert.equal(c.perfil_validado, n);
});
test("data inválida é rejeitada", () => {
  const p = perfil(); p.experiencia[0].data_inicio = "09/2021";
  assert.ok(perfilM.validarPerfil(p).some((e) => e.includes("Data inválida")));
  assert.throws(() => perfilM.guardarNovaVersao(estado(), p), /Data inválida/);
});
test("anos de experiência sem sobreposição", () => {
  const p = perfil();
  p.experiencia[0].data_fim = "2023-08";
  Object.assign(p.experiencia[1], { data_inicio: "2020-09", data_fim: "2021-08" });
  assert.equal(perfilM.anosExperiencia(p, HOJE), 3);
});
test("proposta por regras a partir do texto do CV", () => {
  const p = perfilM.propostaPorRegras(CV);
  assert.equal(p.dados_pessoais.nome, "Pessoa Exemplo"); assert.equal(p.dados_pessoais.email, "exemplo@example.com");
  assert.deepEqual(p.experiencia.map((e) => [e.cargo, e.empresa, e.data_inicio, e.data_fim]), [
    ["Analista de Controlo de Gestão", "Intermarché", "2021-09", "atual"], ["Estagiário de Auditoria", "Auditora Exemplo", "2020-02", "2021-07"]]);
  assert.deepEqual(p.experiencia[0].itens.map((i) => i.texto), ["Elaboração do reporting mensal para 45 lojas.", "Redução de 15% no tempo de fecho mensal."]);
  assert.equal(p.experiencia[0].itens[1].tipo, "resultado");
  assert.equal(p.experiencia[0].id, "exp_intermarche"); assert.equal(p.experiencia[0].itens[0].id, "exp_intermarche_01");
  assert.equal(p.formacao[0].grau, "Mestrado em Finanças");
  assert.deepEqual(p.competencias.map((c) => c.nome), ["Excel", "Power BI", "VBA"]);
  assert.deepEqual(p.linguas.map((l) => [l.nome, l.nivel]), [["Português", "nativo"], ["Inglês", "C1"]]);
  assert.equal(p.certificacoes[0].nome, "CFA Level I"); assert.equal(p.certificacoes[0].data, "2022");
  assert.deepEqual(perfilM.itensNaoEncontrados(p, CV), []);
});
test("itens alterados face ao CV original são assinalados", () => {
  const p = perfilM.propostaPorRegras(CV);
  p.experiencia[0].itens[0].texto = "Gestão de uma equipa de 20 pessoas.";
  assert.deepEqual(perfilM.itensNaoEncontrados(p, CV).map((f) => f[0]), ["exp_intermarche_01"]);
});
