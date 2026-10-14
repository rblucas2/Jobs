"""Parser genérico de alertas de emprego, baseado nos links de vagas presentes no e-mail.

Cada fonte define os padrões dos seus links. Para cada link de vaga, o cargo é o texto
do link e a empresa/localização vêm das linhas do bloco HTML que contém esse link.

NOTA: o HTML dos alertas muda com frequência e não foi possível calibrar estes parsers
com e-mails reais. Um e-mail sem vagas reconhecidas nunca falha em silêncio: é
registado em logs/emails_nao_reconhecidos.log e na página Vagas, para revisão.
"""
from __future__ import annotations

import html as htmllib
import re
from dataclasses import dataclass, field

from bs4 import BeautifulSoup

from .normalizacao import link_canonico

TEXTOS_GENERICOS = re.compile(
    r"^(ver( a)? vaga|ver todas?.*|ver mais.*|see (all|more).*|view (job|all.*)|apply( now)?|"
    r"candidat(ar|e-se|ura).*|easy apply|candidatura simplificada|promovida|promoted|novo|nova|new|"
    r"guardar|save|partilhar|share|mais vagas.*|search.*|pesquisar.*|há \d+.*|\d+ (dias?|horas?|days?|hours?) ago|"
    r"publicad[ao].*|posted.*|actively recruiting|recrutamento ativo|be an early applicant|"
    r"seja um dos primeiros.*|\d+ (candidatos|applicants).*|responds? .*|sponsored|patrocinad[ao]|"
    r"urgente|urgent|top applicant|melhor candidato.*)$",
    re.IGNORECASE,
)

LOCAL = re.compile(
    r"(remot|híbrid|hibrid|hybrid|presencial|on-?site|portugal|luxemb|lisbo|porto|braga|coimbra|"
    r"faro|aveiro|setúbal|setubal|leiria|viseu|madeira|açores|, )",
    re.IGNORECASE,
)


@dataclass
class VagaExtraida:
    cargo: str
    link: str
    empresa: str = ""
    localizacao: str = ""
    resumo: str = ""
    data_publicacao: str | None = None
    avisos: list[str] = field(default_factory=list)


def _limpar(t: str) -> str:
    return re.sub(r"\s+", " ", htmllib.unescape(t or "")).strip(" \t\r\n·•|-–")


def _id_link(href: str) -> str:
    return link_canonico(href) or href


def texto_para_html(texto: str) -> str:
    """Converte um e-mail só de texto em HTML simples: um bloco por parágrafo, URLs como links."""
    blocos = []
    for bloco in re.split(r"\n\s*\n", texto or ""):
        linhas = [l.strip() for l in bloco.splitlines() if l.strip()]
        urls = [l for l in linhas if re.match(r"^https?://\S+$", l)]
        resto = [l for l in linhas if l not in urls]
        if urls and resto:
            titulo, outras = resto[0], resto[1:]
            partes = [f'<a href="{htmllib.escape(urls[0])}">{htmllib.escape(titulo)}</a>']
            partes += [f"<p>{htmllib.escape(l)}</p>" for l in outras]
            blocos.append("<div>" + "".join(partes) + "</div>")
    return "<html><body>" + "".join(blocos) + "</body></html>"


class ParserAlerta:
    fonte = "Outras"
    padroes_link: list[str] = []
    empresa_por_defeito: str = ""

    def __init__(self, padroes_extra: list[str] | None = None):
        self._padroes = [re.compile(p, re.I) for p in list(self.padroes_link) + list(padroes_extra or [])]

    def reconhece_link(self, href: str) -> bool:
        return any(p.search(href) for p in self._padroes)

    def extrair(self, html: str | None, texto: str | None = None) -> list[VagaExtraida]:
        if not self._padroes:
            return []
        if not html and texto:
            html = texto_para_html(texto)
        if not html:
            return []
        soup = BeautifulSoup(html, "html.parser")
        for t in soup(["style", "script", "head"]):
            t.decompose()

        grupos: dict[str, list] = {}
        for a in soup.find_all("a", href=True):
            href = a["href"].strip()
            if self.reconhece_link(href):
                grupos.setdefault(_id_link(href), []).append(a)

        vagas = []
        for chave, ancoras in grupos.items():
            v = self._extrair_grupo(chave, ancoras, set(grupos))
            if v:
                vagas.append(v)
        return vagas

    def _extrair_grupo(self, chave: str, ancoras: list, todas_chaves: set[str]) -> VagaExtraida | None:
        textos = [_limpar(a.get_text(" ")) for a in ancoras]
        titulos = [t for t in textos if t and not TEXTOS_GENERICOS.match(t) and len(t) <= 150]
        titulo = max(titulos, key=len) if titulos else ""

        # Sobe na árvore até ao maior bloco que só contém links desta vaga.
        bloco = ancoras[0]
        while bloco.parent is not None and bloco.parent.name not in ("body", "[document]", "html"):
            pai = bloco.parent
            chaves_pai = {_id_link(a["href"]) for a in pai.find_all("a", href=True) if self.reconhece_link(a["href"])}
            if chaves_pai - {chave}:
                break
            bloco = pai
        linhas = [_limpar(s) for s in bloco.stripped_strings]
        linhas = [l for l in linhas if l and not TEXTOS_GENERICOS.match(l)]
        if not titulo and linhas:
            titulo = linhas[0]
        if not titulo:
            return None
        resto = [l for l in linhas if l != titulo]
        empresa, localizacao = self._empresa_local(resto)
        avisos = []
        if not empresa:
            avisos.append("empresa não identificada")
        return VagaExtraida(
            cargo=titulo,
            link=ancoras[0]["href"].strip(),
            empresa=empresa,
            localizacao=localizacao,
            resumo=" · ".join(linhas[:6]),
            avisos=avisos,
        )

    def _empresa_local(self, linhas: list[str]) -> tuple[str, str]:
        empresa, local = "", ""
        # Formato comum: "Empresa · Localização"
        for l in linhas[:3]:
            partes = [p.strip() for p in re.split(r"\s+[·•|–-]\s+", l) if p.strip()]
            if len(partes) >= 2 and LOCAL.search(partes[-1]):
                return partes[0], partes[-1]
        candidatos = linhas[:4]
        for l in candidatos:
            if not local and LOCAL.search(l) and l != empresa:
                local = l
            elif not empresa and not LOCAL.search(l):
                empresa = l
        if not empresa:
            empresa = self.empresa_por_defeito
        return empresa, local
