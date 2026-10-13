"""Render attached proposals for visual inspection without changing originals."""
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "generated-artifacts" / "pdf-preview"
OUT.mkdir(parents=True, exist_ok=True)

FILES = [
    ("Yamile_Hayes_Propuestas_Alta_Calidad_1791906252824.pdf", "propuestas"),
    ("Triplico_Yamile_Hayes_Alta_Calidad_1791906252825.pdf", "triptico"),
]

try:
    import fitz
except ImportError:
    fitz = None

for filename, label in FILES:
    source = ROOT / "attached_assets" / filename
    if fitz:
        with fitz.open(source) as document:
            for index, page in enumerate(document):
                page.get_pixmap(matrix=fitz.Matrix(2, 2)).save(OUT / f"{label}-{index + 1}.png")
    else:
        # PyMuPDF installation is unavailable in this imported runtime.
        subprocess.run(
            ["mutool", "draw", "-r", "144", "-o", str(OUT / f"{label}-%d.png"), str(source)],
            check=True,
        )
    print(label, OUT)
