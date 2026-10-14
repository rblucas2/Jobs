"""Ferramenta de Procura de Emprego — entrada Streamlit.

Executar com:  streamlit run app.py
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import streamlit as st  # noqa: E402

st.set_page_config(page_title="Procura de Emprego", page_icon="💼", layout="wide")


def inicio() -> None:
    from src import db, llm, ui
    from src.config import resolver
    from src.cv.exportacao import caminho_modelo, encontrar_soffice
    from src.gmail.auth import token_existe
    from src.perfil import versoes
    from src.tracker.estados import followups_em_atraso

    cfg = ui.cfg()
    conn = ui.conn(cfg)
    st.title("Procura de Emprego")
    st.caption("Aplicação local e gratuita. As candidaturas são sempre submetidas manualmente por si.")

    vagas = db.listar_vagas(conn)
    c1, c2, c3, c4 = st.columns(4)
    c1.metric("Vagas", len(vagas))
    c2.metric("Por candidatar", sum(v["estado"] == "Por candidatar" for v in vagas))
    c3.metric("Candidatadas", sum(bool(v["data_candidatura"]) for v in vagas))
    c4.metric("Follow-ups em atraso", len(followups_em_atraso(conn)))

    st.subheader("Estado da configuração")
    ok_ollama, msg_ollama = llm.estado(cfg)
    v = versoes.versao_validada(cfg)
    verificacoes = [
        (v is not None, f"Perfil-base validado (versão {v})" if v else "Perfil-base por validar — página Perfil-base"),
        (resolver(cfg, cfg["gmail"]["credenciais"]).exists(),
         "credentials.json presente" if resolver(cfg, cfg["gmail"]["credenciais"]).exists()
         else "Falta credentials.json (Google Cloud → credenciais OAuth de aplicação de ambiente de trabalho)"),
        (token_existe(cfg), "Gmail autorizado (token.json)" if token_existe(cfg)
         else "Gmail por autorizar — corra: python setup_gmail.py"),
        (any(cfg["gmail"]["remetentes"].get(f) for f in cfg["gmail"]["remetentes"]),
         "Remetentes dos alertas configurados" if any(cfg["gmail"]["remetentes"].values())
         else "Sem remetentes — python setup_gmail.py --descobrir, depois Definições"),
        (ok_ollama, msg_ollama + ("" if ok_ollama else " Pontuação e CV funcionam por regras (fallback).")),
        (bool(cfg["cv"].get("modelo_aprovado")) and caminho_modelo(cfg).exists(),
         "Modelo Word do CV aprovado" if cfg["cv"].get("modelo_aprovado") else "Modelo Word por aprovar — Definições"),
        (encontrar_soffice(cfg) is not None,
         "LibreOffice encontrado (exportação PDF)" if encontrar_soffice(cfg)
         else "LibreOffice não encontrado: só exporta Word (instale-o para PDF)"),
    ]
    for ok, texto in verificacoes:
        (st.success if ok else st.warning)(texto, icon="✅" if ok else "⚠️")

    st.subheader("Fluxo diário (≈15 min)")
    st.markdown(
        """
1. Os alertas chegam ao Gmail e o filtro envia-os para **Vagas/\\***, fora da caixa de entrada.
2. Em **Vagas**, carregue em **Recolher novas vagas** (lê, deduplica e guarda).
3. As vagas novas são pontuadas e a lista aparece ordenada.
4. Nas vagas de interesse, abra o **Detalhe**, cole a descrição completa e veja a pontuação final.
5. Gere o CV adaptado e reveja-o lado a lado em **Revisão de CV**; aprove-o.
6. Candidate-se **manualmente** na plataforma da vaga.
7. No **Tracker**, marque como *Candidatado*; o follow-up fica agendado.
"""
    )


paginas = [
    st.Page(inicio, title="Início", icon=":material/home:", default=True),
    st.Page("pages/vagas.py", title="Vagas", icon=":material/work:"),
    st.Page("pages/detalhe_vaga.py", title="Detalhe da vaga", icon=":material/description:"),
    st.Page("pages/revisao_cv.py", title="Revisão de CV", icon=":material/fact_check:"),
    st.Page("pages/tracker.py", title="Tracker", icon=":material/timeline:"),
    st.Page("pages/perfil_base.py", title="Perfil-base", icon=":material/person:"),
    st.Page("pages/definicoes.py", title="Definições", icon=":material/settings:"),
]
st.navigation(paginas).run()
