"""Schemas do CV adaptado e da carta de apresentação.

Os cabeçalhos (cargo, empresa, datas, formação, línguas...) nunca são gerados pelo modelo:
são lidos diretamente do perfil-base pelos IDs. O modelo só escreve o texto dos pontos,
e cada ponto tem de citar os itens de origem (source_ids).
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

VERIFICADO = "verificado"
NAO_VERIFICADO = "nao_verificado"


class Ponto(BaseModel):
    texto: str
    source_ids: list[str] = Field(default_factory=list)
    estado: Literal["verificado", "nao_verificado"] = NAO_VERIFICADO
    motivos: list[str] = Field(default_factory=list)


class BlocoExperiencia(BaseModel):
    experiencia_id: str
    pontos: list[Ponto] = Field(default_factory=list)


class CVAdaptado(BaseModel):
    idioma: str = "pt"
    resumo: list[Ponto] = Field(default_factory=list)
    experiencia: list[BlocoExperiencia] = Field(default_factory=list)
    formacao_ids: list[str] = Field(default_factory=list)
    competencias_ids: list[str] = Field(default_factory=list)
    linguas_ids: list[str] = Field(default_factory=list)
    certificacoes_ids: list[str] = Field(default_factory=list)
    erros: list[str] = Field(default_factory=list)
    metodo: str = "regras"

    def pontos(self) -> list[Ponto]:
        return list(self.resumo) + [p for b in self.experiencia for p in b.pontos]


class Carta(BaseModel):
    idioma: str = "pt"
    paragrafos: list[Ponto] = Field(default_factory=list)
    erros: list[str] = Field(default_factory=list)
    metodo: str = "regras"

    def pontos(self) -> list[Ponto]:
        return list(self.paragrafos)


# ---- versões "limpas" para o modelo local (sem campos de estado, que só o validador define)

class PontoLLM(BaseModel):
    texto: str
    source_ids: list[str]


class BlocoLLM(BaseModel):
    experiencia_id: str
    pontos: list[PontoLLM]


class CVLLM(BaseModel):
    resumo: list[PontoLLM]
    experiencia: list[BlocoLLM]
    formacao_ids: list[str]
    competencias_ids: list[str]
    linguas_ids: list[str]
    certificacoes_ids: list[str]


class CartaLLM(BaseModel):
    paragrafos: list[PontoLLM]
