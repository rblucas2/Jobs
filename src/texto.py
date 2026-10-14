"""Utilitários de normalização de texto partilhados pelos módulos."""
from __future__ import annotations

import re
import unicodedata


def sem_acentos(s: str) -> str:
    s = unicodedata.normalize("NFKD", s or "")
    return "".join(c for c in s if not unicodedata.combining(c))


def normalizar(s: str) -> str:
    """Minúsculas, sem acentos, só alfanuméricos e espaços simples."""
    s = sem_acentos(s).lower()
    s = re.sub(r"[^a-z0-9&+#]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def slug(s: str, sep: str = "_") -> str:
    s = re.sub(r"[^a-z0-9]+", sep, sem_acentos(s).lower())
    return s.strip(sep) or "item"


def sinonimos(entrada: str) -> list[str]:
    """'Lisboa|Lisbon' -> ['Lisboa', 'Lisbon']"""
    return [p.strip() for p in str(entrada).split("|") if p.strip()]


def regex_termo(termo: str, sensivel: bool | None = None) -> re.Pattern:
    """Expressão regular que encontra o termo como palavra inteira (texto sem acentos).

    Termos curtos (até 3 caracteres, ex.: 'R', 'SAP', 'CIA') são procurados com
    distinção de maiúsculas para evitar falsos positivos com palavras comuns.
    """
    t = sem_acentos(termo).strip()
    if sensivel is None:
        sensivel = len(t) <= 3
    corpo = r"\s+".join(re.escape(p) for p in t.split())
    flags = 0 if sensivel else re.IGNORECASE
    return re.compile(r"(?<![\w&])" + corpo + r"(?![\w&])", flags)


def contem_termo(texto: str, termo: str) -> bool:
    return bool(regex_termo(termo).search(sem_acentos(texto or "")))


def frases(texto: str) -> list[str]:
    partes = re.split(r"(?<=[.!?;])\s+|\n+|•", texto or "")
    return [p.strip() for p in partes if p and p.strip()]
