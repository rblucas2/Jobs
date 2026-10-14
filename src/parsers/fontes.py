"""Um parser por fonte de alertas. Os padrões podem ser estendidos em config.yaml
(parsers.padroes_link_extra), sem alterar código."""
from __future__ import annotations

import re

from .base import ParserAlerta, VagaExtraida


class LinkedInParser(ParserAlerta):
    fonte = "LinkedIn"
    padroes_link = [r"linkedin\.com/(comm/)?jobs/view/"]


class IndeedParser(ParserAlerta):
    fonte = "Indeed"
    padroes_link = [
        r"indeed\.[a-z.]+/(rc/clk|viewjob|pagead/clk|m/viewjob|rc/clk/dl)\b.*\bjk=",
        r"indeed\.[a-z.]+/(viewjob|m/viewjob)\?",
    ]


class NetEmpregosParser(ParserAlerta):
    fonte = "Net-Empregos"
    padroes_link = [r"net-empregos\.com/\d+/"]


class JobsLuParser(ParserAlerta):
    fonte = "Jobs.lu"
    padroes_link = [r"jobs\.lu/[^\s\"'<>]*\d{4,}"]


class Big4Parser(ParserAlerta):
    fonte = "Big4"
    padroes_link = [
        r"(deloitte|pwc|kpmg)[a-z.-]*\.[a-z.]+/.*(job|vaga|career|carreira|requisition|position)",
        r"(^|[/.])ey\.com/.*(job|career)",
        r"myworkdayjobs\.com/.+/job/",
        r"successfactors\.[a-z.]+/.*(career|job)",
        r"(taleo\.net|avature\.net|phenompeople\.com)/.*(job|requisition)",
    ]
    _empresas = {"deloitte": "Deloitte", "pwc": "PwC", "kpmg": "KPMG", "ey.com": "EY", "ey": "EY"}

    def _extrair_grupo(self, chave, ancoras, todas_chaves) -> VagaExtraida | None:
        v = super()._extrair_grupo(chave, ancoras, todas_chaves)
        if v and not v.empresa:
            href = v.link.lower()
            for k, nome in self._empresas.items():
                if re.search(rf"(^|[/.\-]){re.escape(k)}", href):
                    v.empresa = nome
                    v.avisos = [a for a in v.avisos if a != "empresa não identificada"]
                    break
        return v


class OutrasParser(ParserAlerta):
    """Só reconhece links definidos pelo utilizador em parsers.padroes_link_extra.Outras."""
    fonte = "Outras"
    padroes_link: list[str] = []


PARSERS = {p.fonte: p for p in (LinkedInParser, IndeedParser, NetEmpregosParser, JobsLuParser, Big4Parser, OutrasParser)}

DOMINIOS = {
    r"(^|[/.])linkedin\.": "LinkedIn",
    r"(^|[/.])indeed\.": "Indeed",
    r"(^|[/.])net-empregos\.": "Net-Empregos",
    r"(^|[/.])jobs\.lu\b": "Jobs.lu",
    r"(^|[/.])(deloitte|pwc|kpmg)[a-z-]*\.": "Big4",
    r"(^|[/.])ey\.com\b": "Big4",
}


def obter_parser(fonte: str, cfg: dict | None = None) -> ParserAlerta:
    extra = ((cfg or {}).get("parsers", {}).get("padroes_link_extra", {}) or {}).get(fonte) or []
    return PARSERS.get(fonte, OutrasParser)(extra)


def fonte_por_link(url: str) -> str:
    u = (url or "").lower()
    for padrao, fonte in DOMINIOS.items():
        if re.search(padrao, u):
            return fonte
    return "Outras" if u else "Manual"
