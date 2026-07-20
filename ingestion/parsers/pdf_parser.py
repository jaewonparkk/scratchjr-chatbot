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


# 이보다 일반 텍스트가 적으면 이미지 PDF일 가능성이 높다고 본다.
MINIMUM_NATIVE_TEXT_CHARACTERS = 100

# OCR 후 이보다 글자가 적으면 OCR도 충분히 읽지 못한 것으로 본다.
MINIMUM_OCR_TEXT_CHARACTERS = 30

# PDF 페이지 PNG 해상도.
PAGE_IMAGE_DPI = 180

# OCR 해상도. 높을수록 정확도가 좋아질 수 있지만 느려진다.
OCR_DPI = 220

OCR_LANGUAGE = "eng"


def _find_tessdata_directory() -> Path | None:
    """
    PyMuPDF OCR에 필요한 Tesseract 언어 데이터 폴더를 찾는다.
    Apple Silicon과 Intel Mac의 Homebrew 경로를 모두 확인한다.
    """

    environment_path = os.getenv(
        "TESSDATA_PREFIX"
    )

    candidates = [
        Path(environment_path)
        if environment_path
        else None,
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


def _choose_page_title(
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

    first_line = lines[0]

    return first_line[:140]


def _extract_native_text(
    page: pymupdf.Page,
) -> str:
    return clean_text(
        page.get_text(
            "text",
            sort=True,
        )
    )


def _extract_ocr_text(
    page: pymupdf.Page,
    tessdata_directory: Path,
) -> str:
    """
    페이지 전체에 OCR을 한 번 수행한 뒤
    OCR TextPage를 사용해 인식된 텍스트를 추출한다.
    """

    text_page = page.get_textpage_ocr(
        language=OCR_LANGUAGE,
        dpi=OCR_DPI,
        full=True,
        tessdata=str(
            tessdata_directory
        ),
    )

    return clean_text(
        page.get_text(
            "text",
            textpage=text_page,
            sort=True,
        )
    )


def _render_page_image(
    page: pymupdf.Page,
    output_path: Path,
) -> None:
    pixmap = page.get_pixmap(
        dpi=PAGE_IMAGE_DPI,
        colorspace=pymupdf.csRGB,
        alpha=False,
        annots=True,
    )

    pixmap.save(str(output_path))


def parse_pdf(
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

    pdf_image_directory = (
        image_directory / file_prefix
    )

    pdf_image_directory.mkdir(
        parents=True,
        exist_ok=True,
    )

    tessdata_directory = (
        _find_tessdata_directory()
    )

    units: list[SourceUnit] = []

    with pymupdf.open(file_path) as document:
        for page_index, page in enumerate(
            document,
            start=1,
        ):
            page_image_path = (
                pdf_image_directory
                / f"page-{page_index:03d}.png"
            )

            _render_page_image(
                page=page,
                output_path=page_image_path,
            )

            native_text = (
                _extract_native_text(page)
            )

            selected_text = native_text
            ocr_text = ""
            ocr_applied = False
            ocr_error: str | None = None

            should_run_ocr = (
                len(native_text)
                < MINIMUM_NATIVE_TEXT_CHARACTERS
            )

            if should_run_ocr:
                if tessdata_directory is None:
                    ocr_error = (
                        "Tesseract tessdata directory "
                        "could not be found."
                    )
                else:
                    try:
                        ocr_text = (
                            _extract_ocr_text(
                                page=page,
                                tessdata_directory=(
                                    tessdata_directory
                                ),
                            )
                        )

                        ocr_applied = True

                        if len(ocr_text) > len(
                            native_text
                        ):
                            selected_text = (
                                ocr_text
                            )

                    except Exception as error:
                        ocr_error = str(error)

            image_count = len(
                page.get_images(full=True)
            )

            has_useful_text = (
                len(selected_text)
                >= MINIMUM_OCR_TEXT_CHARACTERS
            )

            # OCR된 페이지나 이미지 중심 페이지는
            # 화살표, 선, 핀 연결 등을 사람이 확인해야 한다.
            requires_visual_review = (
                ocr_applied
                or not has_useful_text
                or image_count > 0
            )

            # 사용자의 질문에 이 페이지가 검색되면
            # 답변 아래 원본 이미지를 보여주도록 한다.
            should_display_image = (
                ocr_applied
                or image_count > 0
            )

            fallback_title = (
                f"{file_path.stem} "
                f"— Page {page_index}"
            )

            title = _choose_page_title(
                text=selected_text,
                fallback=fallback_title,
            )

            if not has_useful_text:
                kind = "image-page"
            elif ocr_applied:
                kind = "ocr-page"
            else:
                kind = "text-page"

            units.append(
                SourceUnit(
                    title=title,
                    content=selected_text,
                    source_file=source_file,
                    file_type="pdf",
                    section_path=[title],
                    page_number=page_index,
                    image_paths=[
                        relative_path(
                            page_image_path,
                            project_root,
                        )
                    ],
                    kind=kind,
                    ocr_applied=ocr_applied,
                    requires_visual_review=(
                        requires_visual_review
                    ),
                    should_display_image=(
                        should_display_image
                    ),
                    metadata={
                        "native_text_character_count": (
                            len(native_text)
                        ),
                        "ocr_text_character_count": (
                            len(ocr_text)
                        ),
                        "selected_text_character_count": (
                            len(selected_text)
                        ),
                        "embedded_image_count": (
                            image_count
                        ),
                        "ocr_language": (
                            OCR_LANGUAGE
                        ),
                        "ocr_dpi": OCR_DPI,
                        "page_image_dpi": (
                            PAGE_IMAGE_DPI
                        ),
                        "ocr_error": ocr_error,
                        "tessdata_directory": (
                            str(
                                tessdata_directory
                            )
                            if tessdata_directory
                            else None
                        ),
                    },
                )
            )

    return units