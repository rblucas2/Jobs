"""Página Definições: config.yaml em formulário."""
from __future__ import annotations

import streamlit as st

from src import llm, ui
from src.config import DIMENSOES, FONTES, NOMES_DIMENSOES, guardar_config
from src.cv.exportacao import caminho_modelo, encontrar_soffice

cfg = ui.cfg()
st.title("Definições")
st.caption("Grava em config.yaml. Sinónimos separados por \"|\" (ex.: Lisboa|Lisbon).")


def linhas(txt: str) -> list[str]:
    return [l.strip() for l in (txt or "").splitlines() if l.strip()]


with st.form("defs"):
    st.subheader("Alvos")
    a, b = st.columns(2)
    areas = a.text_area("Áreas-alvo (uma por linha)", "\n".join(cfg["areas_alvo"]), height=120)
    locs = b.text_area("Localizações-alvo (uma por linha)", "\n".join(cfg["localizacoes_alvo"]), height=120)
    remoto = st.checkbox("Aceito trabalho remoto", value=cfg.get("aceita_remoto", True))

    st.subheader("Remetentes dos alertas (Gmail)")
    st.caption("Um endereço por linha. Confirme-os a partir dos primeiros alertas: python setup_gmail.py --descobrir. "
               "Depois de alterar, corra python setup_gmail.py para atualizar os filtros.")
    cols = st.columns(3)
    remetentes = {}
    for i, f in enumerate(FONTES):
        remetentes[f] = cols[i % 3].text_area(f, "\n".join(cfg["gmail"]["remetentes"].get(f) or []), height=90)
    padroes_outras = st.text_area("Padrões de link para a fonte 'Outras' (expressões regulares, uma por linha)",
                                  "\n".join(cfg["parsers"]["padroes_link_extra"].get("Outras") or []))

    st.subheader("Grelha de compatibilidade")
    cols = st.columns(len(DIMENSOES))
    pesos = {d: cols[i].number_input(NOMES_DIMENSOES[d], 0, 100, int(cfg["compatibilidade"]["pesos"].get(d, 0)))
             for i, d in enumerate(DIMENSOES)}
    st.caption(f"Soma atual gravada: {sum(int(v) for v in cfg['compatibilidade']['pesos'].values())} "
               "(os pesos são normalizados se a soma não for 100).")
    a, b = st.columns(2)
    limite = a.number_input("Limite com requisito eliminatório em falta", 0, 100,
                            int(cfg["compatibilidade"]["limite_eliminatoria"]))
    prelim_llm = b.checkbox("Usar o modelo local também nas pontuações preliminares (mais lento)",
                            value=bool(cfg["compatibilidade"].get("preliminar_com_llm")))

    st.subheader("Modelo local (Ollama)")
    a, b, c = st.columns(3)
    ativo = a.checkbox("Ativo", value=cfg["ollama"].get("ativo", True))
    host = b.text_input("Endereço", cfg["ollama"]["host"])
    modelo = c.text_input("Modelo", cfg["ollama"]["modelo"], help="Ex.: qwen3:8b, qwen2.5:7b, llama3.1:8b")

    st.subheader("CV, carta e tracker")
    a, b, c = st.columns(3)
    idioma = a.selectbox("Idioma por defeito do CV", ["pt", "en", "fr"],
                         index=["pt", "en", "fr"].index(cfg["cv"].get("idioma", "pt")))
    max_pontos = b.number_input("Máx. de pontos por experiência", 1, 15, int(cfg["cv"].get("max_pontos_por_experiencia", 5)))
    dias = c.number_input("Dias até ao follow-up", 1, 90, int(cfg["tracker"]["dias_followup"]))
    soffice = st.text_input("Caminho do LibreOffice (soffice), se não for encontrado automaticamente",
                            cfg["cv"].get("soffice") or "")
    a, b = st.columns(2)
    abertura = a.text_input("Abertura da carta", cfg["carta"]["abertura"])
    fecho = b.text_input("Fecho da carta", cfg["carta"]["fecho"])

    if st.form_submit_button("Gravar definições", type="primary"):
        cfg["areas_alvo"] = linhas(areas)
        cfg["localizacoes_alvo"] = linhas(locs)
        cfg["aceita_remoto"] = remoto
        cfg["gmail"]["remetentes"] = {f: linhas(v) for f, v in remetentes.items()}
        cfg["parsers"]["padroes_link_extra"]["Outras"] = linhas(padroes_outras)
        cfg["compatibilidade"]["pesos"] = {d: int(v) for d, v in pesos.items()}
        cfg["compatibilidade"]["limite_eliminatoria"] = int(limite)
        cfg["compatibilidade"]["preliminar_com_llm"] = prelim_llm
        cfg["ollama"].update(ativo=ativo, host=host.strip(), modelo=modelo.strip())
        cfg["cv"].update(idioma=idioma, max_pontos_por_experiencia=int(max_pontos), soffice=soffice.strip() or None)
        cfg["tracker"]["dias_followup"] = int(dias)
        cfg["carta"].update(abertura=abertura, fecho=fecho)
        if sum(pesos.values()) <= 0:
            st.error("A soma dos pesos tem de ser positiva.")
        else:
            guardar_config(cfg)
            st.success("Definições gravadas.")

ok, msg = llm.estado(cfg)
(st.success if ok else st.info)(msg)
soff = encontrar_soffice(cfg)
(st.success if soff else st.info)(f"LibreOffice: {soff}" if soff else "LibreOffice não encontrado: só exportação Word.")

st.subheader("Modelo Word do CV")
modelo_path = caminho_modelo(cfg)
if modelo_path.exists():
    st.download_button("Descarregar o modelo para rever no Word", modelo_path.read_bytes(), file_name=modelo_path.name)
    st.caption("Pode editar tipos de letra, cores e margens no Word, mantendo os nomes dos estilos "
               "(CV Nome, CV Secção, CV Entrada, CV Detalhe, CV Ponto, CV Texto, CV Contactos). "
               "Substitua o ficheiro em templates/ e aprove de novo.")
    if cfg["cv"].get("modelo_aprovado"):
        st.success("Modelo aprovado.")
        if st.button("Retirar aprovação"):
            cfg["cv"]["modelo_aprovado"] = False
            guardar_config(cfg)
            st.rerun()
    elif st.button("Aprovar este modelo", type="primary"):
        cfg["cv"]["modelo_aprovado"] = True
        guardar_config(cfg)
        st.rerun()
else:
    st.error(f"Modelo não encontrado em {modelo_path}. Crie-o com: python templates/criar_modelo.py")
