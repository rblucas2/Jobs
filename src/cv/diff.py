"""Comparação entre o texto de origem (perfil-base) e o texto adaptado, com difflib."""
from __future__ import annotations

import html
import re
from difflib import SequenceMatcher

from ..perfil.modelo import ItemIndexado


def _palavras(t: str) -> list[str]:
    return re.findall(r"\S+|\s+", t or "")


def diff_html(origem: str, adaptado: str) -> str:
    """HTML com o texto adaptado: <ins> = palavras novas, <del> = palavras retiradas da origem."""
    a, b = _palavras(origem), _palavras(adaptado)
    out = []
    for op, i1, i2, j1, j2 in SequenceMatcher(None, a, b, autojunk=False).get_opcodes():
        if op == "equal":
            out.append(html.escape("".join(b[j1:j2])))
        if op in ("delete", "replace"):
            out.append(f"<del>{html.escape(''.join(a[i1:i2]))}</del>")
        if op in ("insert", "replace"):
            out.append(f"<ins>{html.escape(''.join(b[j1:j2]))}</ins>")
    return "".join(out)


def texto_origem(source_ids: list[str], idx: dict[str, ItemIndexado]) -> str:
    """Texto dos itens de origem com conteúdo (ignora cabeçalhos de experiência/formação)."""
    partes = [idx[i].texto for i in source_ids if i in idx and idx[i].tipo not in ("experiencia", "formacao")]
    if not partes:
        partes = [idx[i].texto for i in source_ids if i in idx]
    return " | ".join(partes)


def semelhanca(origem: str, adaptado: str) -> float:
    return SequenceMatcher(None, _palavras(origem), _palavras(adaptado), autojunk=False).ratio()


CSS = """
<style>
.diff ins { background: rgba(46,160,67,.25); text-decoration: none; border-radius: 3px; }
.diff del { background: rgba(248,81,73,.22); border-radius: 3px; }
.cvprev { font-family: Calibri, Arial, sans-serif; border: 1px solid rgba(128,128,128,.4); border-radius: 6px;
          padding: 24px 32px; max-width: 800px; }
.cvprev .nome { font-size: 1.6em; font-weight: 700; margin: 0; }
.cvprev .contactos { opacity: .8; margin-bottom: 8px; }
.cvprev .seccao { font-weight: 700; text-transform: uppercase; letter-spacing: .05em; margin-top: 14px;
                  border-bottom: 1px solid rgba(128,128,128,.5); }
.cvprev .entrada { font-weight: 600; margin-top: 8px; }
.cvprev .detalhe { opacity: .75; font-size: .92em; }
.cvprev ul { margin: 2px 0 0 18px; padding: 0; }
</style>
"""
