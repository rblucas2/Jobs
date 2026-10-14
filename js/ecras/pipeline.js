/* Ecrã Pipeline (M5): quadro Kanban por fase, follow-ups, métricas e exportação CSV.
   No PC as vagas arrastam-se entre colunas (só para fases permitidas); no telemóvel desliza-se entre colunas. */
import * as dados from "../dados.js";
import * as tracker from "../tracker.js";
import { avatar, botao, card, cfg, dataCurta, download, el, estado, FASES, gauge, icone, irPara, mut, toast, verificar } from "./comum.js";

// Ordem natural do quadro (como nos trackers Kanban): do interesse à decisão.
const ORDEM_QUADRO = [tracker.POR_CANDIDATAR, tracker.CANDIDATADO, tracker.ENTREVISTA, tracker.OFERTA, tracker.REJEITADO, tracker.DESCARTADA];

export function folhaEstado(v) {
  const e = estado();
  const corrigir = verificar("Corrigir um engano (permite qualquer fase)");
  const opcoes = () => (corrigir.cb.checked ? tracker.ESTADOS.filter((s) => s !== v.estado) : tracker.transicoesPossiveis(v.estado));
  const fases = el("div", { class: "chips" });
  let escolhido = "";
  const desenharFases = () => {
    fases.replaceChildren(...opcoes().map((s) => el("span", { class: "chip click" + (escolhido === s ? " on" : ""), onclick: () => { escolhido = escolhido === s ? "" : s; desenharFases(); } }, [icone(FASES[s].ic), s])));
    if (!opcoes().length) fases.appendChild(el("span", { class: "tiny faint", text: "Fase final. Use “Corrigir um engano” para mudar." }));
  };
  corrigir.cb.addEventListener("change", () => { escolhido = ""; desenharFases(); });
  desenharFases();
  const data = UI.field("Data", { type: "date", value: UI.todayISO() });
  const aprovados = dados.listarCvs(e, { vagaId: v.id, estado: "aprovado", tipo: "cv" });
  const cvSel = UI.field("CV usado", { type: "select", value: v.cv_id || "", options: [{ value: "", label: aprovados.length ? "—" : "Nenhum CV aprovado para esta vaga" }, ...aprovados.map((d) => ({ value: d.id, label: `CV aprovado ${dataCurta(d.data_aprovacao)}` }))] });
  const contacto = UI.field("Contacto", { value: v.contacto || "", placeholder: "Nome, e-mail ou telefone" });
  const notas = UI.field("Notas", { type: "textarea", value: v.notas || "", rows: 3 });
  const fu = UI.field("Follow-up", { type: "date", value: v.data_followup || "" });
  const s = UI.sheet(v.cargo, [
    el("div", { class: "row" }, [avatar(v.empresa || v.cargo, "sm"), el("div", { class: "grow" }, [el("div", { class: "small", style: "font-weight:650", text: v.empresa || "—" }), el("div", { class: "tiny faint", text: `Fase atual: ${v.estado}` })])]),
    el("div", { class: "field" }, [el("span", { text: "Mover para" }), fases]), corrigir,
    el("div", { class: "grid-2" }, [data, fu]), cvSel, contacto, notas,
    el("p", { class: "tiny faint", text: `Ao marcar “Candidatado”, o follow-up fica a ${cfg().tracker.dias_followup} dias. Só um CV aprovado pode ser marcado como usado.` }),
    botao("Guardar", () => {
      mut((st, c) => {
        const cvId = cvSel.input.value || null;
        if (escolhido) tracker.mudarEstado(st, c, v.id, escolhido, { data: data.input.value || undefined, cvId, forcar: corrigir.cb.checked });
        else if (cvId && cvId !== v.cv_id) tracker.definirCv(st, v.id, cvId);
        const campos = { contacto: contacto.input.value, notas: notas.input.value };
        if (!escolhido) campos.data_followup = fu.input.value || null; // a mudança de fase recalcula o follow-up
        dados.atualizarCandidatura(st, v.id, campos);
      });
      s.close(); toast("Atualizado");
    }, "btn btn-primary btn-block btn-lg"),
    botao("Abrir a vaga", () => { s.close(); irPara("vaga", { vagaId: v.id }); }, "btn btn-ghost btn-block"),
  ]);
}

function kcard(v) {
  const atraso = v.data_followup && v.data_followup < UI.todayISO() && ["Candidatado", "Entrevista"].includes(v.estado);
  const c = el("div", { class: "kcard", draggable: "true", onclick: () => folhaEstado(v) }, [
    el("div", { class: "row", style: "align-items:flex-start" }, [avatar(v.empresa || v.cargo, "sm"),
      el("div", { class: "grow" }, [el("div", { class: "t", text: v.cargo }), el("div", { class: "m truncate", text: v.empresa || "—" })]),
      gauge(v.pontuacao_global, { tam: 30, preliminar: v.preliminar })]),
    el("div", { class: "f" }, [
      atraso ? el("span", { class: "chip warn", style: "height:20px" }, [icone("bell"), "follow-up"])
        : v.data_followup ? el("span", { class: "row", style: "gap:4px" }, [icone("bell", 13), dataCurta(v.data_followup)])
          : el("span", { class: "row", style: "gap:4px" }, [icone("clock", 13), dataCurta(v.data_candidatura || v.data_recolha)]),
      el("span", { class: "spacer" }), v.cv_id ? el("span", { class: "row", style: "gap:4px", title: "CV aprovado associado" }, [icone("file", 13), "CV"]) : null,
    ]),
  ]);
  c.addEventListener("dragstart", (ev) => { ev.dataTransfer.setData("text/plain", v.id); c.classList.add("dragging"); });
  c.addEventListener("dragend", () => c.classList.remove("dragging"));
  return c;
}

function coluna(estadoFase, vagas) {
  const f = FASES[estadoFase];
  const corpo = el("div", { class: "col-b" }, vagas.length ? vagas.map(kcard) : [el("div", { class: "col-empty", text: "Sem vagas" })]);
  const col = el("div", { class: "col" }, [el("div", { class: "col-h" }, [el("i", { class: "dot", style: `background:${f.cor}` }), estadoFase, el("span", { class: "n", text: vagas.length })]), corpo]);
  col.addEventListener("dragover", (ev) => { ev.preventDefault(); col.classList.add("drop"); });
  col.addEventListener("dragleave", () => col.classList.remove("drop"));
  col.addEventListener("drop", (ev) => {
    ev.preventDefault(); col.classList.remove("drop");
    const id = ev.dataTransfer.getData("text/plain");
    const v = dados.obterVaga(estado(), id);
    if (!v || v.estado === estadoFase) return;
    try { mut((s, c) => tracker.mudarEstado(s, c, id, estadoFase)); toast(`${v.cargo} → ${estadoFase}`); }
    catch (err) { toast(err.message + ". Abra o cartão para corrigir.", 4500); }
  });
  return col;
}

export function vistaPipeline() {
  const e = estado(), c = cfg();
  const m = tracker.metricas(e, c);
  const atraso = tracker.followupsEmAtraso(e);
  const vagas = dados.listarVagas(e);
  const porFase = (s) => vagas.filter((v) => v.estado === s).sort((a, b) => String(b.data_candidatura || b.data_recolha).localeCompare(String(a.data_candidatura || a.data_recolha)));
  const kpi = (ic, k, v, d) => el("div", { class: "kpi" }, [el("div", { class: "k" }, [icone(ic), k]), el("div", { class: "v", text: v }), d ? el("div", { class: "d", text: d }) : null]);
  const contagens = (obj) => { const ent = Object.entries(obj).sort((a, b) => b[1] - a[1]); return ent.length ? el("div", { class: "list" }, ent.map(([k, n]) => el("div", { class: "item" }, [el("span", { class: "grow small", text: k }), el("b", { class: "num", text: n })]))) : el("div", { class: "empty", text: "Ainda sem entrevistas." }); };

  const corpo = el("div", { class: "stack" }, [
    el("div", { class: "kpis" }, [
      kpi("send", "Candidaturas", m.candidaturas, `${m.aguardam_resposta} a aguardar`),
      kpi("trend", "Taxa de resposta", m.taxa_resposta == null ? "—" : Math.round(m.taxa_resposta * 100) + "%", "das candidaturas enviadas"),
      kpi("chat", "Entrevistas", m.entrevistas, `${m.por_estado.Oferta} oferta(s)`),
      kpi("bell", "Follow-ups em atraso", m.followups_em_atraso, atraso.length ? "toque num cartão para atualizar" : "tudo em dia"),
    ]),
    atraso.length ? el("div", { class: "card warn" }, [el("div", { class: "card-h", style: "margin-bottom:6px" }, [icone("bell"), el("h3", { text: "Follow-ups em atraso" })]),
      ...atraso.map((v) => el("div", { class: "item click", onclick: () => folhaEstado(v) }, [avatar(v.empresa || v.cargo, "sm"), el("div", { class: "grow" }, [el("div", { class: "t", text: v.cargo }), el("div", { class: "s", text: `${v.empresa} · previsto ${dataCurta(v.data_followup)}` })]), icone("right")]))]) : null,
    el("div", { class: "kanban" }, ORDEM_QUADRO.map((s) => coluna(s, porFase(s)))),
    el("div", { class: "bento", style: "grid-template-columns:repeat(auto-fit,minmax(260px,1fr))" }, [
      card("Entrevistas por fonte", [contagens(m.entrevistas_por_fonte)], { icone: "globe" }),
      card("Entrevistas por tipo de vaga", [contagens(m.entrevistas_por_tipo)], { icone: "layers" }),
    ]),
  ].filter(Boolean));

  const exportar = () => download(new Blob([tracker.exportarCsv(e, c)], { type: "text/csv;charset=utf-8" }), `candidaturas_${UI.todayISO()}.csv`);
  return {
    titulo: "Pipeline", sub: `${m.candidaturas} candidaturas · ${m.total_vagas} vagas`,
    acoes: [botao("Exportar CSV", exportar, "btn btn-sm only-desktop", { icone: "download" }), botao("", exportar, "btn btn-icon btn-ghost only-mobile", { icone: "download", title: "Exportar CSV (Power BI)", "aria-label": "Exportar CSV" })],
    corpo,
  };
}
