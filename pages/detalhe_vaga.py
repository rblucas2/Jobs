"""Página Detalhe da vaga: descrição, pontuação decomposta, requisitos e lacunas, gerar CV."""
from __future__ import annotations

import pandas as pd
import streamlit as st

from src import db, llm, ui
from src.compatibilidade.motor import AVISO, analisar_e_guardar
from src.config import NOMES_DIMENSOES, pesos_normalizados
from src.cv import fluxo
from src.perfil.modelo import indexar
from src.perfil.versoes import PerfilNaoValidado

cfg = ui.cfg()
conn = ui.conn(cfg)
perfil = ui.perfil_ou_none(cfg)

st.title("Detalhe da vaga")
vaga = ui.escolher_vaga(conn)
if not vaga:
    st.stop()
vid = vaga["id"]
v = db.obter_vaga(conn, vid)

c1, c2 = st.columns([3, 2])
with c1:
    st.subheader(f"{v['cargo']}")
    st.write(f"**{v['empresa'] or '?'}** · {v['localizacao'] or 's/ localização'} · fonte: {v['fonte']} · "
             f"publicada: {v['data_publicacao'] or '?'} · estado: {vaga['estado']}")
    if v["link_canonico"] or v["link_original"]:
        st.link_button("Abrir a vaga na plataforma", v["link_canonico"] or v["link_original"])
with c2:
    with st.expander("Corrigir dados da vaga"):
        with st.form("dados"):
            cargo = st.text_input("Cargo", v["cargo"])
            empresa = st.text_input("Empresa", v["empresa"])
            local = st.text_input("Localização", v["localizacao"])
            if st.form_submit_button("Guardar"):
                db.atualizar_vaga(conn, vid, cargo=cargo, empresa=empresa, localizacao=local)
                st.rerun()

st.markdown("#### Descrição")
if not v["descricao_completa"]:
    st.info("Esta vaga só tem o resumo do alerta: a pontuação é **preliminar**. "
            "Cole a descrição completa para a pontuação final.")
with st.form("descricao"):
    texto = st.text_area("Descrição completa (colar da página da vaga)", v["descricao"], height=260)
    completa = st.checkbox("É a descrição completa", value=True)
    ok_llm, msg_llm = llm.estado(cfg)
    usar = st.toggle("Usar o modelo local (Ollama)", value=ok_llm, disabled=not ok_llm, help=msg_llm)
    if st.form_submit_button("Guardar e analisar", type="primary"):
        db.atualizar_descricao(conn, vid, texto, completa)
        if perfil:
            with st.spinner("A analisar…"):
                analisar_e_guardar(conn, cfg, perfil, vid, usar_llm=usar)
        st.rerun()

st.markdown("#### Compatibilidade")
st.caption(AVISO)
a = db.ultima_analise(conn, vid)
if not perfil:
    st.warning("Valide o perfil-base (página Perfil-base) para analisar as vagas.")
if a:
    m1, m2, m3 = st.columns(3)
    m1.metric("Pontuação global", f"{a['pontuacao_global']}/100")
    m2.metric("Tipo", "Preliminar" if a["preliminar"] else "Final")
    m3.metric("Método", "Modelo local" if a["metodo"] == "llm" else "Regras")
    if a["eliminatoria_falhada"]:
        st.error(f"Requisito eliminatório em falta: pontuação limitada a "
                 f"{cfg['compatibilidade']['limite_eliminatoria']}.")
    if a["resumo"]:
        st.write(a["resumo"])
    pesos = pesos_normalizados(cfg)
    st.dataframe(pd.DataFrame([{
        "Dimensão": NOMES_DIMENSOES[d], "Peso": f"{pesos[d] * 100:.0f}%",
        "Subpontuação": a["subpontuacoes"].get(d),
    } for d in NOMES_DIMENSOES]), hide_index=True, use_container_width=True, column_config={
        "Subpontuação": st.column_config.ProgressColumn("Subpontuação (vazio = sem dados na vaga)",
                                                        min_value=0, max_value=100, format="%d"),
    })
    idx = indexar(perfil) if perfil else {}

    def tabela(reqs):
        return pd.DataFrame([{
            "Requisito": r["descricao"], "Obrigatório": "sim" if r["obrigatorio"] else "",
            "Eliminatório": "⚠️" if r["eliminatorio"] else "",
            "Evidência no perfil": "; ".join(f"[{i}] {idx[i].texto[:70]}" if i in idx else i for i in r["evidencia_ids"]),
            "Nota": r.get("justificacao", ""),
        } for r in reqs])

    x, y = st.columns(2)
    x.markdown(f"**Requisitos cumpridos ({len(a['requisitos_cumpridos'])})**")
    if a["requisitos_cumpridos"]:
        x.dataframe(tabela(a["requisitos_cumpridos"]), hide_index=True, use_container_width=True)
    y.markdown(f"**Lacunas ({len(a['lacunas'])})**")
    if a["lacunas"]:
        y.dataframe(tabela(a["lacunas"]), hide_index=True, use_container_width=True)
    st.caption(f"Análise de {a['data']} com o perfil v{a['versao_perfil']}.")
    if perfil and st.button("Repetir a análise"):
        analisar_e_guardar(conn, cfg, perfil, vid)
        st.rerun()
elif perfil and st.button("Analisar agora", type="primary"):
    analisar_e_guardar(conn, cfg, perfil, vid)
    st.rerun()

st.markdown("#### CV adaptado e carta")
idiomas = {"pt": "Português", "en": "Inglês", "fr": "Francês"}
g1, g2, g3 = st.columns([1, 1, 1])
idioma = g1.selectbox("Idioma", list(idiomas), format_func=idiomas.get,
                      index=list(idiomas).index(cfg["cv"].get("idioma", "pt")) if cfg["cv"].get("idioma", "pt") in idiomas else 0)
if not v["descricao_completa"]:
    st.caption("Recomenda-se colar a descrição completa antes de gerar o CV.")
for col, tipo, rotulo in ((g2, "cv", "Gerar CV adaptado"), (g3, "carta", "Gerar carta de apresentação")):
    if col.button(rotulo, type="primary" if tipo == "cv" else "secondary", disabled=perfil is None):
        try:
            with st.spinner("A gerar e a validar…"):
                cid = fluxo.criar_rascunho(conn, cfg, vid, tipo=tipo, idioma=idioma)
            st.session_state["cv_id"] = cid
            st.switch_page("pages/revisao_cv.py")
        except PerfilNaoValidado as e:
            st.error(str(e))

docs = db.listar_cvs(conn, vaga_id=vid)
if docs:
    st.dataframe(pd.DataFrame([{"#": d["id"], "Tipo": d["tipo"], "Estado": d["estado"], "Perfil": f"v{d['versao_perfil']}",
                                "Criado": d["data_criacao"], "Aprovado": d["data_aprovacao"] or ""} for d in docs]),
                 hide_index=True, use_container_width=True)
