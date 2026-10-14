// M1 — parsers, deduplicação, e-mails não reconhecidos, inserção manual. E-mails de teste SINTÉTICOS.
import assert from "node:assert/strict";
import { test } from "node:test";
import * as dados from "../js/dados.js";
import { chaveNormalizada, extrair, fontePorLink, linkCanonico } from "../js/parsers.js";
import { inserirManual, novoResultado, processarEmail } from "../js/recolha.js";
import { cfg, estado, ler, parseHTML } from "./comum.js";

const email = (n) => ler("emails/" + n);
const META = { from: "alertas@exemplo.com", subject: "Novas vagas", date: "2026-10-13" };

test("link canónico do LinkedIn remove rastreio", () => {
  const a = linkCanonico("https://www.linkedin.com/comm/jobs/view/3901234567/?trackingId=abc&refId=x");
  const b = linkCanonico("https://pt.linkedin.com/jobs/view/analista-at-alfa-3901234567?trk=public");
  assert.equal(a, "https://www.linkedin.com/jobs/view/3901234567/"); assert.equal(a, b);
});
test("link canónico do Indeed usa jk", () => {
  assert.equal(linkCanonico("https://pt.indeed.com/rc/clk/dl?jk=a1b2c3&from=ja&tk=1"), "https://pt.indeed.com/viewjob?jk=a1b2c3");
  assert.equal(linkCanonico("https://pt.indeed.com/viewjob?jk=a1b2c3&from=serp"), "https://pt.indeed.com/viewjob?jk=a1b2c3");
});
test("link canónico genérico remove utm", () => {
  assert.equal(linkCanonico("https://www.net-empregos.com/123/x/?utm_source=a&utm_medium=b"), "https://www.net-empregos.com/123/x/");
  assert.equal(linkCanonico("https://empresa.pt/vaga?id=7&utm_campaign=z&gclid=1"), "https://empresa.pt/vaga?id=7");
});
test("chave normalizada ignora acentos, maiúsculas e país", () => {
  assert.equal(chaveNormalizada("Consultora Alfa", "Analista de Transaction Services", "Lisboa, Portugal (Híbrido)"),
    chaveNormalizada("CONSULTORA ALFA", "analista de transaction services", "lisboa"));
});
test("fonte por link", () => {
  assert.equal(fontePorLink("https://www.linkedin.com/jobs/view/1"), "LinkedIn");
  assert.equal(fontePorLink("https://careers.kpmg.pt/job/123"), "Big4");
  assert.equal(fontePorLink("https://www.survey.com/x"), "Outras");
  assert.equal(fontePorLink(""), "Manual");
});

test("parser LinkedIn", () => {
  const v = extrair("LinkedIn", email("linkedin.html"), null, cfg(), parseHTML);
  assert.deepEqual(v.map((x) => x.cargo), ["Analista de Transaction Services", "Valuation Associate"]);
  assert.equal(v[0].empresa, "Consultora Alfa"); assert.match(v[0].localizacao, /Lisboa/);
  assert.equal(v[1].empresa, "Banco Beta"); assert.match(v[1].localizacao, /Luxembourg/);
});
test("parser Indeed", () => {
  const v = extrair("Indeed", email("indeed.html"), null, cfg(), parseHTML);
  assert.deepEqual(v.map((x) => [x.cargo, x.empresa, x.localizacao]), [["Controller Financeiro (m/f)", "Empresa Gama", "Porto"], ["Analista de M&A", "Grupo Delta", "Lisboa"]]);
});
test("parser de texto simples (Net-Empregos)", () => {
  const v = extrair("Net-Empregos", null, email("net_empregos.txt"), cfg(), parseHTML);
  assert.deepEqual(v.map((x) => [x.cargo, x.empresa, x.localizacao]), [["Técnico de Contabilidade", "Empresa Épsilon", "Braga"], ["Analista Financeiro Júnior", "Empresa Zeta", "Lisboa"]]);
});
test("'Outras' sem padrões não reconhece nada", () => assert.deepEqual(extrair("Outras", email("linkedin.html"), null, cfg(), parseHTML), []));
test("padrões extra das Definições", () => {
  const c = cfg(); c.parsers.padroes_link_extra.Outras = ["exemplo\\.pt/blog"];
  assert.equal(extrair("Outras", email("desconhecido.html"), null, c, parseHTML).length, 1);
});

test("processar e-mail guarda e deduplica", () => {
  const e = estado(), c = cfg();
  const r1 = novoResultado();
  assert.ok(processarEmail(e, c, "LinkedIn", "m1", email("linkedin.html"), null, META, r1, parseHTML));
  assert.equal(r1.vagas_novas.length, 2);
  const r2 = novoResultado();
  processarEmail(e, c, "LinkedIn", "m2", email("linkedin.html").replace("trackingId=abc", "trackingId=zzz"), null, META, r2, parseHTML);
  assert.equal(r2.vagas_novas.length, 0); assert.equal(r2.duplicadas, 2); assert.equal(e.vagas.length, 2);
  assert.equal(e.vagas[0].estado, "Por candidatar"); assert.equal(e.vagas[0].data_publicacao, "2026-10-13");
});
test("deduplicação entre fontes pela chave", () => {
  const e = estado();
  inserirManual(e, { cargo: "Analista de Transaction Services", empresa: "Consultora Alfa", localizacao: "Lisboa", descricao: "texto" });
  const r = novoResultado();
  processarEmail(e, cfg(), "LinkedIn", "m1", email("linkedin.html"), null, META, r, parseHTML);
  assert.equal(r.duplicadas, 1); assert.equal(r.vagas_novas.length, 1);
});
test("e-mail não reconhecido fica registado (uma vez)", () => {
  const e = estado(), r = novoResultado();
  assert.ok(!processarEmail(e, cfg(), "LinkedIn", "m9", email("desconhecido.html"), null, META, r, parseHTML));
  assert.equal(r.nao_reconhecidos, 1);
  assert.equal(dados.pendentesNaoReconhecidos(e)[0].id, "m9");
  processarEmail(e, cfg(), "LinkedIn", "m9", email("desconhecido.html"), null, META, novoResultado(), parseHTML);
  assert.equal(e.naoReconhecidos.length, 1);
});
test("erro no parser não falha em silêncio", () => {
  const e = estado(), r = novoResultado();
  const rebenta = () => { throw new Error("HTML inesperado"); };
  assert.ok(!processarEmail(e, cfg(), "Indeed", "m5", "<html></html>", null, META, r, rebenta));
  assert.match(e.naoReconhecidos[0].motivo, /HTML inesperado/);
});
test("inserção manual", () => {
  const e = estado();
  const [id, nova] = inserirManual(e, { cargo: "Analista", empresa: "Empresa", localizacao: "Porto", link: "https://pt.indeed.com/viewjob?jk=1&from=x", descricao: "desc" });
  assert.ok(nova);
  const v = dados.obterVaga(e, id);
  assert.equal(v.fonte, "Indeed"); assert.equal(v.descricao_completa, true); assert.equal(v.origem, "manual");
  assert.equal(inserirManual(e, { cargo: "Analista", empresa: "Empresa", localizacao: "Porto", link: "https://pt.indeed.com/viewjob?jk=1" })[1], false);
  assert.throws(() => inserirManual(e, { cargo: " " }), /obrigatório/);
});
