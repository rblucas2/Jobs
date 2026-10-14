"""Deduplicação: link canónico (sem parâmetros de rastreio) e chave empresa + cargo + localização."""
from __future__ import annotations

import re
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from ..texto import normalizar

PARAMS_RASTREIO = re.compile(
    r"^(utm_.*|trk.*|tracking.*|refid|ref|lipi|midtoken|midsig|eid|otptoken|ssid|from|"
    r"alid|tk|advn|adid|sjdu|acatk|pub|xpse|xfps|xkcb|camk|vjtk|cmp|mc_.*|gclid|fbclid|"
    r"source|src|origin|campaign|position|pagenum|cid|sid|_hs.*|hs.*|ga|_ga|sc_cid|iis|iisn)$",
    re.IGNORECASE,
)


def link_canonico(url: str | None) -> str | None:
    if not url:
        return None
    url = url.strip()
    if not re.match(r"^https?://", url, re.I):
        return None
    p = urlsplit(url)
    host = p.netloc.lower()
    caminho = re.sub(r"/+$", "", p.path) or "/"
    query = parse_qsl(p.query, keep_blank_values=False)

    # LinkedIn: o ID da vaga identifica-a de forma única.
    m = re.search(r"/jobs/view/(?:[^/]*?-)?(\d{6,})", p.path)
    if "linkedin." in host and m:
        return f"https://www.linkedin.com/jobs/view/{m.group(1)}/"

    # Indeed: o parâmetro jk identifica a vaga.
    if "indeed." in host:
        jk = dict(query).get("jk") or dict(query).get("vjk")
        if jk:
            dominio = host if host.endswith(("indeed.com", "indeed.pt", "indeed.lu")) and not host.startswith("cts.") else "www.indeed.com"
            return f"https://{dominio}/viewjob?jk={jk}"

    # Net-Empregos: o caminho /<id>/<slug>/ basta.
    if "net-empregos." in host:
        return urlunsplit(("https", "www.net-empregos.com", caminho + "/", "", ""))

    limpos = [(k, v) for k, v in query if not PARAMS_RASTREIO.match(k)]
    return urlunsplit(("https", host, caminho, urlencode(sorted(limpos)), ""))


def chave_normalizada(empresa: str, cargo: str, localizacao: str) -> str:
    # Só a cidade conta: "Lisboa, Portugal (Híbrido)" e "Lisboa" são a mesma localização.
    cidade = re.split(r"[,(·|/–-]", localizacao or "", maxsplit=1)[0]
    loc = normalizar(cidade)
    loc = re.sub(r"\b(hibrido|hybrid|remoto|remote|presencial|on site|area metropolitana de|distrito de)\b", "", loc)
    return "|".join([normalizar(empresa), normalizar(cargo), re.sub(r"\s+", " ", loc).strip()])
