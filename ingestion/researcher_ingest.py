from __future__ import annotations

import json
import sys
from pathlib import Path

from ingestion.chunker import chunk_source_units
from ingestion.config import IMAGE_EXTENSIONS
from ingestion.parsers import parse_docx, parse_image, parse_pdf, parse_pptx


PROJECT_ROOT = Path(__file__).resolve().parents[1]
UPLOAD_DIRECTORY = PROJECT_ROOT / "knowledge" / "raw" / "researcher"
OUTPUT_DIRECTORY = PROJECT_ROOT / "knowledge" / "processed" / "researcher"
IMAGE_DIRECTORY = PROJECT_ROOT / "knowledge" / "processed" / "images" / "researcher"

PARSERS = {
    ".docx": parse_docx,
    ".pdf": parse_pdf,
    ".pptx": parse_pptx,
    **{extension: parse_image for extension in IMAGE_EXTENSIONS},
}


def main() -> None:
    if len(sys.argv) != 2:
        raise ValueError("A Researcher file name is required.")

    source_path = (UPLOAD_DIRECTORY / Path(sys.argv[1]).name).resolve()
    source_path.relative_to(UPLOAD_DIRECTORY.resolve())

    if not source_path.is_file():
        raise FileNotFoundError("The uploaded Researcher file was not found.")

    parser = PARSERS.get(source_path.suffix.lower())
    if parser is None:
        raise ValueError("The uploaded file type is not supported.")

    OUTPUT_DIRECTORY.mkdir(parents=True, exist_ok=True)
    IMAGE_DIRECTORY.mkdir(parents=True, exist_ok=True)

    units = parser(source_path, IMAGE_DIRECTORY, PROJECT_ROOT)
    chunks = [
        chunk.to_dict()
        for chunk in chunk_source_units(units)
        if chunk.content.strip()
    ]

    if not chunks:
        raise ValueError("No searchable text could be extracted from this file.")

    output_path = OUTPUT_DIRECTORY / f"{source_path.stem}.json"
    output_path.write_text(
        json.dumps({"chunks": chunks}, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )

    print(output_path.relative_to(PROJECT_ROOT).as_posix())


if __name__ == "__main__":
    main()
