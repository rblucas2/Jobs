"""Página Revisão de CV: original vs. adaptado lado a lado, origem de cada ponto, edição,
aprovação explícita e exportação Word/PDF."""
from __future__ import annotations

from pathlib import Path

import pandas as pd
import streamlit as st

from src import db, ui
from src.cv import fluxo, render
from src.cv.diff import diff_html, texto_origem
from src.cv.schemas import Carta
from src.cv.validador import problemas
from src.perfil import versoes
from src.perfil.modelo import indexar

cfg = ui.cfg()
conn = ui.conn(cfg)
ui.css_diff()
st.title("Revisão de CV")

docs = db.listar_cvs(conn)
if not docs:
    st.info("Ainda não há CVs. Gere um a partir do Detalhe da vaga.")
    st.stop()
docs.sort(key=lambda d: (d["estado"] != "rascunho", -d["id"]))
ids = [d["id"] for d in docs]
atual = st.session_state.get("cv_id")
reg = st.selectbox(
    "Documento", docs, index=ids.index(atual) if atual in ids else 0,
    format_func=lambda d: f"#{d['id']} · {'CV' if d['tipo'] == 'cv' else 'Carta'} · {d['estado']} · {d['cargo']} — {d['empresa']}",
)
st.session_state["cv_id"] = reg["id"]
cv_id = reg["id"]
reg = db.obter_cv(conn, cv_id)
perfil = versoes.carregar(cfg, reg["versao_perfil"])
idx = indexar(perfil)
doc = fluxo.revalidar(conn, cfg, reg)  # o validador corre sempre antes de mostrar
falhas = problemas(doc)
e_carta = isinstance(doc, Carta)
rascunho = reg["estado"] == "rascunho"

pontos = doc.pontos()
n_ok = sum(p.estado == "verificado" for p in pontos)
c1, c2, c3, c4 = st.columns(4)
c1.metric("Estado", reg["estado"])
c2.metric("Pontos verificados", f"{n_ok}/{len(pontos)}")
c3.metric("Perfil-base", f"v{reg['versao_perfil']}")
c4.metric("Gerado por", "modelo local" if doc.metodo == "llm" else "regras")
if doc.metodo != "llm" and rascunho:
    st.info("Gerado sem modelo local: o texto foi copiado do perfil-base, selecionado e ordenado pela "
            "relevância para a vaga. Pode reformulá-lo no separador Editar (o validador corre a cada gravação).")
if falhas:
    st.error("**Não pode ser aprovado enquanto houver pontos não verificados:**\n\n" +
             "\n".join(f"- {f}" for f in falhas))


def ponto_html(p) -> str:
    origem = texto_origem(p.source_ids, idx)
    selo = "✅" if p.estado == "verificado" else "⛔ <b>não verificado</b>"
    motivos = "".join(f"<li>{m}</li>" for m in p.motivos)
    return (f"<div class='diff' style='margin-bottom:10px'>{selo} {diff_html(origem, p.texto)}"
            f"<div style='opacity:.7;font-size:.85em'>origem: {', '.join(p.source_ids) or '—'}</div>"
            + (f"<ul style='color:#d33;font-size:.85em'>{motivos}</ul>" if motivos else "") + "</div>")


tab_lado, tab_editar, tab_prev = st.tabs(["Lado a lado", "Editar", "Pré-visualização"])

with tab_lado:
    st.markdown("<div class='diff' style='opacity:.75;font-size:.9em'>À esquerda, os itens do perfil-base; à direita, "
                "o texto adaptado com as diferenças em relação à origem: <ins>verde</ins> = novo, "
                "<del>vermelho</del> = retirado.</div>", unsafe_allow_html=True)
    if e_carta:
        for p in doc.paragrafos:
            a, b = st.columns(2)
            a.write(texto_origem(p.source_ids, idx) or "—")
            b.markdown(ponto_html(p), unsafe_allow_html=True)
    else:
        if doc.resumo or perfil.resumo:
            st.markdown("##### Perfil / resumo")
            a, b = st.columns(2)
            a.markdown("\n".join(f"- `{r.id}` {r.texto}" for r in perfil.resumo) or "—")
            b.markdown("".join(ponto_html(p) for p in doc.resumo) or "—", unsafe_allow_html=True)
        exps = {e.id: e for e in perfil.experiencia}
        usados = [b.experiencia_id for b in doc.experiencia]
        for bloco in doc.experiencia:
            e = exps.get(bloco.experiencia_id)
            st.markdown(f"##### {e.cargo} — {e.empresa}" if e else f"##### ⛔ {bloco.experiencia_id}")
            a, b = st.columns(2)
            if e:
                a.markdown("\n".join(f"- `{i.id}` {i.texto}" for i in e.itens))
            b.markdown("".join(ponto_html(p) for p in bloco.pontos) or "_(sem pontos)_", unsafe_allow_html=True)
        omitidas = [e for e in perfil.experiencia if e.id not in usados]
        if omitidas:
            st.caption("Experiências omitidas: " + ", ".join(f"{e.cargo} — {e.empresa}" for e in omitidas))
        st.markdown("##### Outras secções (copiadas do perfil-base)")
        nomes = lambda ids: ", ".join(idx[i].texto for i in ids if i in idx) or "—"  # noqa: E731
        st.write(f"**Formação:** {nomes(doc.formacao_ids)}")
        st.write(f"**Competências:** {nomes(doc.competencias_ids)}")
        st.write(f"**Línguas:** {nomes(doc.linguas_ids)}")
        st.write(f"**Certificações:** {nomes(doc.certificacoes_ids)}")

with tab_editar:
    if not rascunho:
        st.info("Este documento já não é um rascunho: é imutável.")
    else:
        st.caption("Para acrescentar um facto novo, edite o perfil-base (e valide a nova versão). "
                   "Aqui só pode reformular, reordenar, selecionar e omitir. IDs separados por vírgulas.")
        conteudo = doc.model_dump()

        def editor(pontos_lista, chave):
            df = pd.DataFrame([{"texto": p["texto"], "source_ids": ", ".join(p["source_ids"])} for p in pontos_lista]
                              or [{"texto": "", "source_ids": ""}])
            ed = st.data_editor(df, key=chave, num_rows="dynamic", use_container_width=True, column_config={
                "texto": st.column_config.TextColumn("Texto", width="large"),
                "source_ids": st.column_config.TextColumn("source_ids"),
            })
            return [{"texto": str(r["texto"] or ""), "source_ids": [s.strip() for s in str(r["source_ids"] or "").split(",") if s.strip()]}
                    for _, r in ed.iterrows() if str(r["texto"] or "").strip()]

        if e_carta:
            conteudo["paragrafos"] = editor(conteudo["paragrafos"], f"ed_carta_{cv_id}")
        else:
            st.markdown("**Resumo**")
            conteudo["resumo"] = editor(conteudo["resumo"], f"ed_res_{cv_id}")
            exps = {e.id: e for e in perfil.experiencia}
            ordem = st.multiselect("Experiências incluídas (pela ordem em que aparecem)", list(exps),
                                   default=[b["experiencia_id"] for b in conteudo["experiencia"] if b["experiencia_id"] in exps],
                                   format_func=lambda i: f"{exps[i].cargo} — {exps[i].empresa}")
            blocos_atuais = {b["experiencia_id"]: b for b in conteudo["experiencia"]}
            novos = []
            for eid in ordem:
                st.markdown(f"**{exps[eid].cargo} — {exps[eid].empresa}** · itens: " +
                            ", ".join(f"`{i.id}`" for i in exps[eid].itens))
                novos.append({"experiencia_id": eid,
                              "pontos": editor(blocos_atuais.get(eid, {"pontos": []})["pontos"], f"ed_{eid}_{cv_id}")})
            conteudo["experiencia"] = novos
            for campo, tipo, rotulo in (("formacao_ids", "formacao", "Formação"), ("competencias_ids", "competencia", "Competências"),
                                         ("linguas_ids", "lingua", "Línguas"), ("certificacoes_ids", "certificacao", "Certificações")):
                opcoes = [i for i, it in idx.items() if it.tipo == tipo]
                conteudo[campo] = st.multiselect(rotulo, opcoes, default=[i for i in conteudo[campo] if i in opcoes],
                                                 format_func=lambda i: idx[i].texto, key=f"{campo}_{cv_id}")
        if st.button("Guardar e revalidar", type="primary"):
            novo = fluxo.editar(conn, cfg, cv_id, conteudo)
            n = len(problemas(novo))
            (st.success if not n else st.warning)("Guardado. " + ("Tudo verificado." if not n else f"{n} problema(s) por resolver."))
            st.rerun()

with tab_prev:
    st.caption("Pré-visualização aproximada do formato final (só os pontos verificados). O Word usa o modelo aprovado.")
    st.markdown(render.html_preview(fluxo.blocos(conn, cfg, reg)), unsafe_allow_html=True)

st.divider()
if rascunho:
    a, b = st.columns([3, 1])
    confirmo = a.checkbox("Revi o documento e confirmo que todos os pontos correspondem a factos reais do meu perfil.")
    if a.button("Aprovar", type="primary", disabled=bool(falhas) or not confirmo):
        try:
            fluxo.aprovar(conn, cfg, cv_id, confirmado=confirmo)
            st.success("Aprovado.")
            st.rerun()
        except fluxo.AprovacaoRecusada as e:
            st.error(str(e))
    if b.button("Rejeitar"):
        fluxo.rejeitar(conn, cv_id)
        st.rerun()
elif reg["estado"] == "aprovado":
    st.success(f"Aprovado em {reg['data_aprovacao']}.")
    if not cfg["cv"].get("modelo_aprovado"):
        st.warning("Aprove o modelo Word nas Definições para poder exportar.")
    if st.button("Exportar Word e PDF", type="primary", disabled=not cfg["cv"].get("modelo_aprovado")):
        try:
            with st.spinner("A exportar…"):
                fluxo.exportar(conn, cfg, cv_id)
            st.rerun()
        except fluxo.AprovacaoRecusada as e:
            st.error(str(e))
    reg = db.obter_cv(conn, cv_id)
    for chave, mime in (("caminho_docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
                        ("caminho_pdf", "application/pdf")):
        if reg.get(chave) and Path(reg[chave]).exists():
            st.download_button(f"Descarregar {Path(reg[chave]).suffix[1:].upper()}", Path(reg[chave]).read_bytes(),
                               file_name=Path(reg[chave]).name, mime=mime, key=chave)
    if reg.get("caminho_docx") and not reg.get("caminho_pdf"):
        st.caption("PDF não gerado: LibreOffice não encontrado (indique o caminho nas Definições).")
else:
    st.info("Documento rejeitado. Gere um novo a partir do Detalhe da vaga.")
