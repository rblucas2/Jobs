"""Versões do perfil-base: data/perfil/perfil_base_vN.yaml.

A versão validada está marcada em config.yaml (perfil.versao_validada). Uma versão
validada é imutável: qualquer alteração cria uma versão nova, que tem de ser validada.
"""
from __future__ import annotations

import re
from pathlib import Path

import yaml

from ..config import guardar_config, resolver
from ..texto import slug
from .modelo import Perfil, todos_ids

PADRAO = re.compile(r"^perfil_base_v(\d+)\.yaml$")


class PerfilNaoValidado(RuntimeError):
    pass


def pasta(cfg: dict) -> Path:
    p = resolver(cfg, cfg["perfil"]["pasta"])
    p.mkdir(parents=True, exist_ok=True)
    return p


def caminho_versao(cfg: dict, n: int) -> Path:
    return pasta(cfg) / f"perfil_base_v{n}.yaml"


def listar_versoes(cfg: dict) -> list[int]:
    return sorted(int(m.group(1)) for f in pasta(cfg).iterdir() if (m := PADRAO.match(f.name)))


def carregar(cfg: dict, n: int) -> Perfil:
    dados = yaml.safe_load(caminho_versao(cfg, n).read_text(encoding="utf-8")) or {}
    dados["versao"] = n
    return Perfil.model_validate(dados)


def carregar_texto(cfg: dict, n: int) -> str:
    return caminho_versao(cfg, n).read_text(encoding="utf-8")


def para_yaml(p: Perfil) -> str:
    return yaml.safe_dump(p.model_dump(), allow_unicode=True, sort_keys=False, default_flow_style=False, width=100)


def de_yaml(texto: str, versao: int) -> Perfil:
    dados = yaml.safe_load(texto) or {}
    if not isinstance(dados, dict):
        raise ValueError("O YAML do perfil tem de ser um dicionário.")
    dados["versao"] = versao
    return Perfil.model_validate(dados)


def versao_validada(cfg: dict) -> int | None:
    v = cfg["perfil"].get("versao_validada")
    return int(v) if v not in (None, "") else None


def perfil_validado(cfg: dict) -> Perfil:
    v = versao_validada(cfg)
    if v is None or not caminho_versao(cfg, v).exists():
        raise PerfilNaoValidado("Ainda não há um perfil-base validado. Valide-o na página Perfil-base.")
    return carregar(cfg, v)


def guardar_nova_versao(cfg: dict, perfil: Perfil, notas: str = "") -> int:
    n = (max(listar_versoes(cfg)) if listar_versoes(cfg) else 0) + 1
    perfil = perfil.model_copy(update={"versao": n, "notas_versao": notas or perfil.notas_versao})
    atribuir_ids(perfil)
    Perfil.model_validate(perfil.model_dump())  # revalida IDs
    caminho_versao(cfg, n).write_text(para_yaml(perfil), encoding="utf-8")
    return n


def atualizar_rascunho(cfg: dict, n: int, perfil: Perfil) -> None:
    if versao_validada(cfg) == n:
        raise PermissionError("A versão validada é imutável. Crie uma nova versão.")
    perfil = perfil.model_copy(update={"versao": n})
    atribuir_ids(perfil)
    Perfil.model_validate(perfil.model_dump())
    caminho_versao(cfg, n).write_text(para_yaml(perfil), encoding="utf-8")


def validar_versao(cfg: dict, n: int) -> None:
    p = carregar(cfg, n)  # tem de passar a validação do schema
    if any(not i for i in todos_ids(p)):
        raise ValueError("Há itens sem ID. Grave a versão para atribuir IDs antes de validar.")
    cfg["perfil"]["versao_validada"] = n
    guardar_config(cfg)


# ---------------------------------------------------------------- IDs estáveis

def _proximo(prefixo: str, usados: set[str]) -> str:
    i = 1
    while f"{prefixo}_{i:02d}" in usados:
        i += 1
    novo = f"{prefixo}_{i:02d}"
    usados.add(novo)
    return novo


def atribuir_ids(p: Perfil) -> Perfil:
    """Atribui IDs só aos itens que ainda não têm. IDs existentes nunca mudam."""
    usados = set(i for i in todos_ids(p) if i)

    def novo_base(prefixo: str) -> str:
        if prefixo not in usados:
            usados.add(prefixo)
            return prefixo
        return _proximo(prefixo, usados)

    for r in p.resumo:
        if not r.id:
            r.id = _proximo("resumo", usados)
    for e in p.experiencia:
        if not e.id:
            e.id = novo_base(f"exp_{slug(e.empresa)[:30]}")
        for i in e.itens:
            if not i.id:
                i.id = _proximo(e.id, usados)
    for f in p.formacao:
        if not f.id:
            f.id = novo_base(f"form_{slug(f.instituicao or f.grau)[:30]}")
        for i in f.itens:
            if not i.id:
                i.id = _proximo(f.id, usados)
    for c in p.competencias:
        if not c.id:
            c.id = novo_base(f"comp_{slug(c.nome)[:30]}")
    for l in p.linguas:
        if not l.id:
            l.id = novo_base(f"ling_{slug(l.nome)[:30]}")
    for c in p.certificacoes:
        if not c.id:
            c.id = novo_base(f"cert_{slug(c.nome)[:30]}")
    return p
