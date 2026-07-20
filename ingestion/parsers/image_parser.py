from __future__ import annotations

import os
from pathlib import Path

import pymupdf

from ingestion.models import SourceUnit
from ingestion.utils import (
    clean_text,
    relative_path,
    safe_filename,
)


OCR_LANGUAGE = "eng"
OCR_DPI = 220


def _find_tessdata_directory() -> Path | None:
    environment_path = os.getenv(
        "TESSDATA_PREFIX"
    )

    candidates = [
        (
            Path(environment_path)
            if environment_path
            else None
        ),
        Path(
            "/opt/homebrew/share/tessdata"
        ),
        Path(
            "/usr/local/share/tessdata"
        ),
        Path(
            "/opt/homebrew/opt/"
            "tesseract/share/tessdata"
        ),
        Path(
            "/usr/local/opt/"
            "tesseract/share/tessdata"
        ),
    ]

    for candidate in candidates:
        if (
            candidate is not None
            and candidate.exists()
            and candidate.is_dir()
        ):
            return candidate

    return None


def _load_rgb_pixmap(
    file_path: Path,
) -> pymupdf.Pixmap:
    pixmap = pymupdf.Pixmap(
        str(file_path)
    )

    if pixmap.colorspace is None:
        raise ValueError(
            "The image has no usable color space."
        )

    if pixmap.colorspace.n != 3:
        pixmap = pymupdf.Pixmap(
            pymupdf.csRGB,
            pixmap,
        )

    if pixmap.alpha:
        pixmap = pymupdf.Pixmap(
            pixmap,
            0,
        )

    pixmap.set_dpi(
        OCR_DPI,
        OCR_DPI,
    )

    return pixmap


def _extract_ocr_text(
    pixmap: pymupdf.Pixmap,
    tessdata_directory: Path,
) -> str:
    ocr_pdf_bytes = (
        pixmap.pdfocr_tobytes(
            language=OCR_LANGUAGE,
            tessdata=str(
                tessdata_directory
            ),
        )
    )

    with pymupdf.open(
        stream=ocr_pdf_bytes,
        filetype="pdf",
    ) as ocr_document:
        page = ocr_document[0]

        return clean_text(
            page.get_text(
                "text",
                sort=True,
            )
        )


def _choose_title(
    text: str,
    fallback: str,
) -> str:
    lines = [
        line.strip()
        for line in text.splitlines()
        if line.strip()
    ]

    if not lines:
        return fallback

    return lines[0][:140]


def parse_image(
    file_path: Path,
    image_directory: Path,
    project_root: Path,
) -> list[SourceUnit]:
    source_file = relative_path(
        file_path,
        project_root,
    )

    file_prefix = safe_filename(
        file_path.stem
    )

    output_directory = (
        image_directory / file_prefix
    )

    output_directory.mkdir(
        parents=True,
        exist_ok=True,
    )

    output_image_path = (
        output_directory / "source.png"
    )

    pixmap = _load_rgb_pixmap(
        file_path
    )

    pixmap.save(
        str(output_image_path)
    )

    tessdata_directory = (
        _find_tessdata_directory()
    )

    extracted_text = ""
    ocr_applied = False
    ocr_error: str | None = None

    if tessdata_directory is None:
        ocr_error = (
            "Tesseract tessdata directory "
            "could not be found."
        )
    else:
        try:
            extracted_text = (
                _extract_ocr_text(
                    pixmap=pixmap,
                    tessdata_directory=(
                        tessdata_directory
                    ),
                )
            )

            ocr_applied = True

        except Exception as error:
            ocr_error = str(error)

    title = _choose_title(
        text=extracted_text,
        fallback=file_path.stem,
    )

    processed_image_path = relative_path(
        output_image_path,
        project_root,
    )

    unit = SourceUnit(
        title=title,
        content=extracted_text,
        source_file=source_file,
        file_type="image",
        section_path=[title],
        page_number=None,
        slide_number=None,
        image_paths=[
            processed_image_path
        ],
        kind="ocr-image",
        ocr_applied=ocr_applied,
        requires_visual_review=True,
        should_display_image=True,
        metadata={
            "original_extension": (
                file_path.suffix.lower()
            ),
            "image_width": pixmap.width,
            "image_height": pixmap.height,
            "ocr_language": OCR_LANGUAGE,
            "ocr_dpi": OCR_DPI,
            "ocr_text_character_count": (
                len(extracted_text)
            ),
            "ocr_error": ocr_error,
            "tessdata_directory": (
                str(tessdata_directory)
                if tessdata_directory
                else None
            ),
        },
    )

    return [unit]