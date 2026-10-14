"""Cria (ou recria) o modelo Word por defeito: python templates/criar_modelo.py

Pode depois abrir templates/cv_modelo.docx no Word e ajustar tipos de letra, cores e
margens, desde que mantenha os nomes dos estilos "CV Nome", "CV Secção", "CV Ponto", etc.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.cv.exportacao import criar_modelo  # noqa: E402

if __name__ == "__main__":
    destino = Path(__file__).resolve().parent / "cv_modelo.docx"
    if destino.exists() and "--forcar" not in sys.argv:
        sys.exit(f"{destino.name} já existe. Use --forcar para o substituir.")
    print("Modelo criado em", criar_modelo(destino))
