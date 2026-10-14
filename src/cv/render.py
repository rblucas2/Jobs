"""Estrutura comum de renderização (pré-visualização HTML e Word).

Só os pontos verificados são incluídos. Cabeçalhos vêm diretamente do perfil-base.
"""
from __future__ import annotations

import html

from ..perfil.modelo import Perfil
from .schemas import VERIFICADO, Carta, CVAdaptado

ROTULOS = {
    "pt": {"resumo": "Perfil", "experiencia": "Experiência Profissional", "formacao": "Formação",
           "competencias": "Competências", "linguas": "Línguas", "certificacoes": "Certificações",
           "atual": "Atual"},
    "en": {"resumo": "Profile", "experiencia": "Professional Experience", "formacao": "Education",
           "competencias": "Skills", "linguas": "Languages", "certificacoes": "Certifications",
           "atual": "Present"},
    "fr": {"resumo": "Profil", "experiencia": "Expérience professionnelle", "formacao": "Formation",
           "competencias": "Compétences", "linguas": "Langues", "certificacoes": "Certifications",
           "atual": "Présent"},
}
MESES = {
    "pt": ["jan.", "fev.", "mar.", "abr.", "mai.", "jun.", "jul.", "ago.", "set.", "out.", "nov.", "dez."],
    "en": ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
    "fr": ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."],
}


def _data(v: str | None, idioma: str) -> str:
    if not v:
        return ""
    if v == "atual":
        return ROTULOS.get(idioma, ROTULOS["pt"])["atual"]
    if len(v) >= 7:
        return f"{MESES.get(idioma, MESES['pt'])[int(v[5:7]) - 1]} {v[:4]}"
    return v


def periodo(a: str | None, b: str | None, idioma: str) -> str:
    a, b = _data(a, idioma), _data(b, idioma)
    return f"{a} – {b}" if a and b else (a or b)


def blocos_cv(cv: CVAdaptado, perfil: Perfil) -> list[tuple[str, str]]:
    """Lista de (estilo, texto). Estilos: nome, contactos, seccao, entrada, detalhe, ponto, texto."""
    r = ROTULOS.get(cv.idioma, ROTULOS["pt"])
    dp = perfil.dados_pessoais
    out = [("nome", dp.nome)]
    contactos = " · ".join(x for x in (dp.localizacao, dp.email, dp.telefone, dp.linkedin) if x)
    if contactos:
        out.append(("contactos", contactos))

    resumo = [p for p in cv.resumo if p.estado == VERIFICADO]
    if resumo:
        out.append(("seccao", r["resumo"]))
        out += [("texto", p.texto) for p in resumo]

    exps = {e.id: e for e in perfil.experiencia}
    blocos = [b for b in cv.experiencia if b.experiencia_id in exps]
    if blocos:
        out.append(("seccao", r["experiencia"]))
        for b in blocos:
            e = exps[b.experiencia_id]
            out.append(("entrada", f"{e.cargo} — {e.empresa}"))
            det = " · ".join(x for x in (e.local, periodo(e.data_inicio, e.data_fim, cv.idioma)) if x)
            if det:
                out.append(("detalhe", det))
            out += [("ponto", p.texto) for p in b.pontos if p.estado == VERIFICADO]

    forms = {f.id: f for f in perfil.formacao}
    sel = [forms[i] for i in cv.formacao_ids if i in forms]
    if sel:
        out.append(("seccao", r["formacao"]))
        for f in sel:
            out.append(("entrada", f"{f.grau}" + (f" — {f.instituicao}" if f.instituicao else "")))
            p = periodo(f.data_inicio, f.data_fim, cv.idioma)
            if p:
                out.append(("detalhe", p))

    comps = {c.id: c for c in perfil.competencias}
    selc = [comps[i] for i in cv.competencias_ids if i in comps]
    if selc:
        out.append(("seccao", r["competencias"]))
        out.append(("texto", " · ".join(c.nome + (f" ({c.nivel})" if c.nivel else "") for c in selc)))

    lings = {l.id: l for l in perfil.linguas}
    sell = [lings[i] for i in cv.linguas_ids if i in lings]
    if sell:
        out.append(("seccao", r["linguas"]))
        out.append(("texto", " · ".join(l.nome + (f" — {l.nivel}" if l.nivel else "") for l in sell)))

    certs = {c.id: c for c in perfil.certificacoes}
    selt = [certs[i] for i in cv.certificacoes_ids if i in certs]
    if selt:
        out.append(("seccao", r["certificacoes"]))
        for c in selt:
            out.append(("ponto", " · ".join(x for x in (c.nome, c.entidade, c.data or "") if x)))
    return out


def blocos_carta(carta: Carta, perfil: Perfil, vaga: dict, cfg: dict) -> list[tuple[str, str]]:
    dp = perfil.dados_pessoais
    out = [("nome", dp.nome)]
    contactos = " · ".join(x for x in (dp.localizacao, dp.email, dp.telefone) if x)
    if contactos:
        out.append(("contactos", contactos))
    out.append(("entrada", f"{vaga.get('cargo', '')} — {vaga.get('empresa', '')}"))
    out.append(("texto", cfg["carta"].get("abertura", "")))
    out += [("texto", p.texto) for p in carta.paragrafos if p.estado == VERIFICADO]
    out.append(("texto", cfg["carta"].get("fecho", "")))
    out.append(("texto", dp.nome))
    return out


def html_preview(blocos: list[tuple[str, str]]) -> str:
    partes, em_lista = ['<div class="cvprev">'], False
    for estilo, texto in blocos:
        t = html.escape(texto)
        if estilo == "ponto":
            if not em_lista:
                partes.append("<ul>"); em_lista = True
            partes.append(f"<li>{t}</li>")
            continue
        if em_lista:
            partes.append("</ul>"); em_lista = False
        tag = "p" if estilo in ("nome",) else "div"
        partes.append(f'<{tag} class="{estilo}">{t}</{tag}>')
    if em_lista:
        partes.append("</ul>")
    partes.append("</div>")
    return "".join(partes)
