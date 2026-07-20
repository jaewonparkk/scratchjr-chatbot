from __future__ import annotations

import json
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pymupdf
from pptx import Presentation

from ingestion.config import (
    ALLOWED_FILE_TYPES,
    SUPPORTED_EXTENSIONS,
)

PROJECT_ROOT = Path(__file__).resolve().parents[1]

RAW_DIRECTORY = (
    PROJECT_ROOT
    / "knowledge"
    / "raw"
)

PROCESSED_DIRECTORY = (
    PROJECT_ROOT
    / "knowledge"
    / "processed"
)

DOCUMENTS_PATH = (
    PROCESSED_DIRECTORY
    / "documents.json"
)

REVIEW_PATH = (
    PROCESSED_DIRECTORY
    / "review_required.json"
)

PARSE_ERRORS_PATH = (
    PROCESSED_DIRECTORY
    / "parse_errors.json"
)

VALIDATION_REPORT_PATH = (
    PROCESSED_DIRECTORY
    / "validation_report.json"
)



ALLOWED_STATUSES = {
    "ready",
    "needs_visual_review",
    "needs_manual_transcription",
}

REQUIRED_CHUNK_FIELDS = {
    "id",
    "title",
    "content",
    "source_file",
    "file_type",
    "section",
    "chunk_index",
    "page_number",
    "slide_number",
    "image_paths",
    "ocr_applied",
    "requires_visual_review",
    "should_display_image",
    "status",
    "metadata",
}

MAXIMUM_EXPECTED_CHUNK_CHARACTERS = 2300
MINIMUM_SEARCHABLE_TEXT_CHARACTERS = 20


def load_json(
    file_path: Path,
) -> dict[str, Any]:
    if not file_path.exists():
        raise FileNotFoundError(
            f"Required file was not found: "
            f"{file_path}"
        )

    try:
        with file_path.open(
            encoding="utf-8",
        ) as file:
            data = json.load(file)

    except json.JSONDecodeError as error:
        raise ValueError(
            f"Invalid JSON in {file_path}: "
            f"{error}"
        ) from error

    if not isinstance(data, dict):
        raise TypeError(
            f"Expected a JSON object in "
            f"{file_path}, but received "
            f"{type(data).__name__}."
        )

    return data


def write_json(
    file_path: Path,
    data: object,
) -> None:
    file_path.write_text(
        json.dumps(
            data,
            indent=2,
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )


def relative_project_path(
    file_path: Path,
) -> str:
    return (
        file_path.resolve()
        .relative_to(PROJECT_ROOT.resolve())
        .as_posix()
    )


def resolve_project_path(
    path_value: str,
) -> Path:
    path = Path(path_value)

    if path.is_absolute():
        return path.resolve()

    return (
        PROJECT_ROOT
        / path
    ).resolve()


def find_raw_files() -> list[Path]:
    if not RAW_DIRECTORY.exists():
        return []

    return sorted(
        path
        for path in RAW_DIRECTORY.rglob("*")
        if (
            path.is_file()
            and path.suffix.lower()
            in SUPPORTED_EXTENSIONS
        )
    )


def add_issue(
    issues: list[dict[str, Any]],
    *,
    code: str,
    message: str,
    chunk: dict[str, Any] | None = None,
    source_file: str | None = None,
) -> None:
    issue: dict[str, Any] = {
        "code": code,
        "message": message,
    }

    if source_file is not None:
        issue["source_file"] = source_file

    if chunk is not None:
        issue["chunk_id"] = chunk.get("id")
        issue["source_file"] = chunk.get(
            "source_file"
        )
        issue["page_number"] = chunk.get(
            "page_number"
        )
        issue["slide_number"] = chunk.get(
            "slide_number"
        )
        issue["section"] = chunk.get(
            "section"
        )

    issues.append(issue)


def validate_parse_errors(
    parse_error_data: dict[str, Any],
    errors: list[dict[str, Any]],
) -> None:
    declared_count = parse_error_data.get(
        "error_count"
    )

    parse_errors = parse_error_data.get(
        "errors"
    )

    if not isinstance(parse_errors, list):
        add_issue(
            errors,
            code="INVALID_PARSE_ERRORS_FILE",
            message=(
                "parse_errors.json does not "
                "contain an errors list."
            ),
        )

        return

    if declared_count != len(parse_errors):
        add_issue(
            errors,
            code="PARSE_ERROR_COUNT_MISMATCH",
            message=(
                "parse_errors.json error_count "
                "does not match the number of "
                "error records."
            ),
        )

    if parse_errors:
        add_issue(
            errors,
            code="PARSING_ERRORS_PRESENT",
            message=(
                f"The latest ingestion contains "
                f"{len(parse_errors)} parsing "
                "error(s)."
            ),
        )


def validate_chunk_fields(
    chunks: list[dict[str, Any]],
    errors: list[dict[str, Any]],
    warnings: list[dict[str, Any]],
) -> None:
    for list_index, chunk in enumerate(chunks):
        if not isinstance(chunk, dict):
            add_issue(
                errors,
                code="INVALID_CHUNK_TYPE",
                message=(
                    f"Chunk at index {list_index} "
                    "is not a JSON object."
                ),
            )

            continue

        missing_fields = sorted(
            REQUIRED_CHUNK_FIELDS
            - set(chunk.keys())
        )

        if missing_fields:
            add_issue(
                errors,
                code="MISSING_CHUNK_FIELDS",
                message=(
                    "Chunk is missing required "
                    f"fields: {missing_fields}"
                ),
                chunk=chunk,
            )

        chunk_id = chunk.get("id")

        if (
            not isinstance(chunk_id, str)
            or not chunk_id.strip()
        ):
            add_issue(
                errors,
                code="INVALID_CHUNK_ID",
                message=(
                    "Chunk ID must be a "
                    "non-empty string."
                ),
                chunk=chunk,
            )

        title = chunk.get("title")

        if (
            not isinstance(title, str)
            or not title.strip()
        ):
            add_issue(
                errors,
                code="INVALID_TITLE",
                message=(
                    "Chunk title must be a "
                    "non-empty string."
                ),
                chunk=chunk,
            )

        section = chunk.get("section")

        if (
            not isinstance(section, str)
            or not section.strip()
        ):
            add_issue(
                errors,
                code="INVALID_SECTION",
                message=(
                    "Chunk section must be a "
                    "non-empty string."
                ),
                chunk=chunk,
            )

        source_file = chunk.get(
            "source_file"
        )

        if (
            not isinstance(source_file, str)
            or not source_file.strip()
        ):
            add_issue(
                errors,
                code="INVALID_SOURCE_FILE",
                message=(
                    "source_file must be a "
                    "non-empty string."
                ),
                chunk=chunk,
            )
        else:
            resolved_source = (
                resolve_project_path(
                    source_file
                )
            )

            if not resolved_source.exists():
                add_issue(
                    errors,
                    code="SOURCE_FILE_NOT_FOUND",
                    message=(
                        "The original source file "
                        "does not exist."
                    ),
                    chunk=chunk,
                )

        file_type = chunk.get("file_type")

        if file_type not in ALLOWED_FILE_TYPES:
            add_issue(
                errors,
                code="INVALID_FILE_TYPE",
                message=(
                    "Unsupported file type: "
                    f"{file_type}"
                ),
                chunk=chunk,
            )

        status = chunk.get("status")

        if status not in ALLOWED_STATUSES:
            add_issue(
                errors,
                code="INVALID_STATUS",
                message=(
                    "Unsupported chunk status: "
                    f"{status}"
                ),
                chunk=chunk,
            )

        chunk_index = chunk.get(
            "chunk_index"
        )

        if (
            not isinstance(chunk_index, int)
            or chunk_index < 0
        ):
            add_issue(
                errors,
                code="INVALID_CHUNK_INDEX",
                message=(
                    "chunk_index must be a "
                    "non-negative integer."
                ),
                chunk=chunk,
            )

        content = chunk.get("content")

        if not isinstance(content, str):
            add_issue(
                errors,
                code="INVALID_CONTENT_TYPE",
                message=(
                    "Chunk content must be "
                    "a string."
                ),
                chunk=chunk,
            )

            content = ""

        if (
            not content.strip()
            and status
            != "needs_manual_transcription"
        ):
            add_issue(
                errors,
                code="EMPTY_CONTENT",
                message=(
                    "Chunk content is empty, but "
                    "the chunk is not marked for "
                    "manual transcription."
                ),
                chunk=chunk,
            )

        if (
            content
            and len(content)
            > MAXIMUM_EXPECTED_CHUNK_CHARACTERS
        ):
            add_issue(
                warnings,
                code="CHUNK_TOO_LONG",
                message=(
                    f"Chunk contains "
                    f"{len(content)} characters. "
                    "Its split boundaries may "
                    "need review."
                ),
                chunk=chunk,
            )

        if (
            content.strip()
            and len(content.strip())
            < MINIMUM_SEARCHABLE_TEXT_CHARACTERS
        ):
            add_issue(
                warnings,
                code="VERY_SHORT_CONTENT",
                message=(
                    "Chunk contains fewer than "
                    f"{MINIMUM_SEARCHABLE_TEXT_CHARACTERS} "
                    "searchable characters."
                ),
                chunk=chunk,
            )

        page_number = chunk.get(
            "page_number"
        )

        if file_type == "pdf":
            if (
                not isinstance(
                    page_number,
                    int,
                )
                or page_number < 1
            ):
                add_issue(
                    errors,
                    code="PDF_WITHOUT_VALID_PAGE",
                    message=(
                        "PDF chunk does not have "
                        "a valid page number."
                    ),
                    chunk=chunk,
                )

        slide_number = chunk.get(
            "slide_number"
        )

        if file_type == "pptx":
            if (
                not isinstance(
                    slide_number,
                    int,
                )
                or slide_number < 1
            ):
                add_issue(
                    errors,
                    code="PPTX_WITHOUT_VALID_SLIDE",
                    message=(
                        "PPTX chunk does not have "
                        "a valid slide number."
                    ),
                    chunk=chunk,
                )

        image_paths = chunk.get(
            "image_paths"
        )

        if not isinstance(image_paths, list):
            add_issue(
                errors,
                code="INVALID_IMAGE_PATHS",
                message=(
                    "image_paths must be a list."
                ),
                chunk=chunk,
            )

            image_paths = []

        for image_path in image_paths:
            if not isinstance(
                image_path,
                str,
            ):
                add_issue(
                    errors,
                    code="INVALID_IMAGE_PATH",
                    message=(
                        "Image path must be a "
                        "string."
                    ),
                    chunk=chunk,
                )

                continue

            resolved_image = (
                resolve_project_path(
                    image_path
                )
            )

            if not resolved_image.exists():
                add_issue(
                    errors,
                    code="IMAGE_NOT_FOUND",
                    message=(
                        "Referenced image does "
                        "not exist: "
                        f"{image_path}"
                    ),
                    chunk=chunk,
                )

        should_display_image = bool(
            chunk.get(
                "should_display_image"
            )
        )

        if (
            should_display_image
            and not image_paths
        ):
            add_issue(
                errors,
                code="DISPLAY_IMAGE_WITHOUT_PATH",
                message=(
                    "Chunk is marked to display "
                    "an image but has no image "
                    "path."
                ),
                chunk=chunk,
            )

        ocr_applied = bool(
            chunk.get("ocr_applied")
        )

        if (
            ocr_applied
            and file_type != "pdf"
        ):
            add_issue(
                warnings,
                code="OCR_ON_NON_PDF",
                message=(
                    "OCR is marked as applied "
                    "to a non-PDF chunk."
                ),
                chunk=chunk,
            )

        if ocr_applied and not image_paths:
            add_issue(
                errors,
                code="OCR_WITHOUT_IMAGE",
                message=(
                    "OCR chunk does not contain "
                    "its original page image."
                ),
                chunk=chunk,
            )

        requires_visual_review = bool(
            chunk.get(
                "requires_visual_review"
            )
        )

        if (
            requires_visual_review
            and status == "ready"
        ):
            add_issue(
                errors,
                code="VISUAL_REVIEW_STATUS_MISMATCH",
                message=(
                    "Chunk requires visual review "
                    "but is marked ready."
                ),
                chunk=chunk,
            )

        if (
            status == "needs_visual_review"
            and not requires_visual_review
        ):
            add_issue(
                errors,
                code="STATUS_REVIEW_FLAG_MISMATCH",
                message=(
                    "Chunk is marked for visual "
                    "review but the visual-review "
                    "flag is false."
                ),
                chunk=chunk,
            )


def validate_duplicate_ids(
    chunks: list[dict[str, Any]],
    errors: list[dict[str, Any]],
) -> None:
    chunk_ids = [
        chunk.get("id")
        for chunk in chunks
        if (
            isinstance(chunk, dict)
            and chunk.get("id")
        )
    ]

    counts = Counter(chunk_ids)

    for chunk_id, count in counts.items():
        if count > 1:
            add_issue(
                errors,
                code="DUPLICATE_CHUNK_ID",
                message=(
                    f"Chunk ID {chunk_id} "
                    f"appears {count} times."
                ),
            )


def validate_chunk_indexes(
    chunks: list[dict[str, Any]],
    warnings: list[dict[str, Any]],
) -> None:
    grouped_indexes: dict[
        tuple[Any, ...],
        list[int],
    ] = defaultdict(list)

    for chunk in chunks:
        if not isinstance(chunk, dict):
            continue

        chunk_index = chunk.get(
            "chunk_index"
        )

        if not isinstance(chunk_index, int):
            continue

        group_key = (
            chunk.get("source_file"),
            chunk.get("page_number"),
            chunk.get("slide_number"),
            chunk.get("section"),
        )

        grouped_indexes[
            group_key
        ].append(chunk_index)

    for group_key, indexes in (
        grouped_indexes.items()
    ):
        sorted_indexes = sorted(indexes)

        expected_indexes = list(
            range(len(sorted_indexes))
        )

        if sorted_indexes != expected_indexes:
            add_issue(
                warnings,
                code="NON_SEQUENTIAL_CHUNK_INDEX",
                message=(
                    "Chunk indexes are not "
                    "sequential. Received "
                    f"{sorted_indexes}; expected "
                    f"{expected_indexes}."
                ),
                source_file=str(
                    group_key[0]
                ),
            )


def build_chunks_by_source(
    chunks: list[dict[str, Any]],
) -> dict[str, list[dict[str, Any]]]:
    chunks_by_source: dict[
        str,
        list[dict[str, Any]],
    ] = defaultdict(list)

    for chunk in chunks:
        if not isinstance(chunk, dict):
            continue

        source_file = chunk.get(
            "source_file"
        )

        if isinstance(source_file, str):
            normalized_source = (
                resolve_project_path(
                    source_file
                )
            )

            chunks_by_source[
                str(normalized_source)
            ].append(chunk)

    return chunks_by_source


def validate_raw_file_coverage(
    raw_files: list[Path],
    chunks: list[dict[str, Any]],
    errors: list[dict[str, Any]],
) -> None:
    chunks_by_source = (
        build_chunks_by_source(chunks)
    )

    raw_file_paths = {
        str(path.resolve())
        for path in raw_files
    }

    processed_source_paths = set(
        chunks_by_source.keys()
    )

    for raw_file in raw_files:
        resolved_raw_file = str(
            raw_file.resolve()
        )

        source_label = (
            relative_project_path(
                raw_file
            )
        )

        source_chunks = chunks_by_source.get(
            resolved_raw_file,
            [],
        )

        if not source_chunks:
            add_issue(
                errors,
                code="RAW_FILE_NOT_PROCESSED",
                message=(
                    "A supported file exists in "
                    "knowledge/raw but produced "
                    "no chunks."
                ),
                source_file=source_label,
            )

    for processed_source in (
        processed_source_paths
        - raw_file_paths
    ):
        try:
            source_label = (
                Path(processed_source)
                .relative_to(PROJECT_ROOT)
                .as_posix()
            )
        except ValueError:
            source_label = processed_source

        add_issue(
            errors,
            code="PROCESSED_SOURCE_NOT_IN_RAW",
            message=(
                "documents.json references a "
                "source that is no longer present "
                "in knowledge/raw. Run ingestion "
                "again or restore the source."
            ),
            source_file=source_label,
        )


def validate_pdf_page_coverage(
    raw_files: list[Path],
    chunks: list[dict[str, Any]],
    errors: list[dict[str, Any]],
) -> None:
    chunks_by_source = (
        build_chunks_by_source(chunks)
    )

    pdf_files = [
        path
        for path in raw_files
        if path.suffix.lower() == ".pdf"
    ]

    for pdf_path in pdf_files:
        source_label = (
            relative_project_path(
                pdf_path
            )
        )

        try:
            with pymupdf.open(
                pdf_path
            ) as document:
                actual_page_count = (
                    document.page_count
                )

        except Exception as error:
            add_issue(
                errors,
                code="PDF_COULD_NOT_BE_OPENED",
                message=(
                    "Validator could not open "
                    f"the PDF: {error}"
                ),
                source_file=source_label,
            )

            continue

        source_chunks = chunks_by_source.get(
            str(pdf_path.resolve()),
            [],
        )

        processed_pages = {
            chunk.get("page_number")
            for chunk in source_chunks
            if isinstance(
                chunk.get("page_number"),
                int,
            )
        }

        expected_pages = set(
            range(
                1,
                actual_page_count + 1,
            )
        )

        missing_pages = sorted(
            expected_pages
            - processed_pages
        )

        extra_pages = sorted(
            processed_pages
            - expected_pages
        )

        if missing_pages:
            add_issue(
                errors,
                code="PDF_MISSING_PAGES",
                message=(
                    "Some PDF pages were not "
                    f"processed: {missing_pages}"
                ),
                source_file=source_label,
            )

        if extra_pages:
            add_issue(
                errors,
                code="PDF_EXTRA_PAGES",
                message=(
                    "Processed page numbers do "
                    "not exist in the source PDF: "
                    f"{extra_pages}"
                ),
                source_file=source_label,
            )


def validate_pptx_slide_coverage(
    raw_files: list[Path],
    chunks: list[dict[str, Any]],
    errors: list[dict[str, Any]],
) -> None:
    chunks_by_source = (
        build_chunks_by_source(chunks)
    )

    pptx_files = [
        path
        for path in raw_files
        if path.suffix.lower() == ".pptx"
    ]

    for pptx_path in pptx_files:
        source_label = (
            relative_project_path(
                pptx_path
            )
        )

        try:
            presentation = Presentation(
                pptx_path
            )

            actual_slide_count = len(
                presentation.slides
            )

        except Exception as error:
            add_issue(
                errors,
                code="PPTX_COULD_NOT_BE_OPENED",
                message=(
                    "Validator could not open "
                    f"the PowerPoint: {error}"
                ),
                source_file=source_label,
            )

            continue

        source_chunks = chunks_by_source.get(
            str(pptx_path.resolve()),
            [],
        )

        processed_slides = {
            chunk.get("slide_number")
            for chunk in source_chunks
            if isinstance(
                chunk.get("slide_number"),
                int,
            )
        }

        expected_slides = set(
            range(
                1,
                actual_slide_count + 1,
            )
        )

        missing_slides = sorted(
            expected_slides
            - processed_slides
        )

        extra_slides = sorted(
            processed_slides
            - expected_slides
        )

        if missing_slides:
            add_issue(
                errors,
                code="PPTX_MISSING_SLIDES",
                message=(
                    "Some PowerPoint slides were "
                    f"not processed: "
                    f"{missing_slides}"
                ),
                source_file=source_label,
            )

        if extra_slides:
            add_issue(
                errors,
                code="PPTX_EXTRA_SLIDES",
                message=(
                    "Processed slide numbers do "
                    "not exist in the original "
                    f"PowerPoint: {extra_slides}"
                ),
                source_file=source_label,
            )


def validate_review_file(
    chunks: list[dict[str, Any]],
    review_data: dict[str, Any],
    errors: list[dict[str, Any]],
) -> None:
    review_chunks = review_data.get(
        "chunks"
    )

    if not isinstance(review_chunks, list):
        add_issue(
            errors,
            code="INVALID_REVIEW_FILE",
            message=(
                "review_required.json does not "
                "contain a chunks list."
            ),
        )

        return

    expected_review_ids = {
        chunk.get("id")
        for chunk in chunks
        if (
            isinstance(chunk, dict)
            and chunk.get("status")
            != "ready"
        )
    }

    actual_review_ids = {
        chunk.get("id")
        for chunk in review_chunks
        if isinstance(chunk, dict)
    }

    missing_review_ids = sorted(
        expected_review_ids
        - actual_review_ids
    )

    extra_review_ids = sorted(
        actual_review_ids
        - expected_review_ids
    )

    if missing_review_ids:
        add_issue(
            errors,
            code="MISSING_REVIEW_CHUNKS",
            message=(
                "Some non-ready chunks are "
                "missing from "
                "review_required.json: "
                f"{missing_review_ids}"
            ),
        )

    if extra_review_ids:
        add_issue(
            errors,
            code="EXTRA_REVIEW_CHUNKS",
            message=(
                "review_required.json contains "
                "chunks that are marked ready: "
                f"{extra_review_ids}"
            ),
        )

    declared_review_count = (
        review_data.get("review_count")
    )

    if declared_review_count != len(
        review_chunks
    ):
        add_issue(
            errors,
            code="REVIEW_COUNT_MISMATCH",
            message=(
                "review_count does not match "
                "the number of chunks in "
                "review_required.json."
            ),
        )


def validate_document_counts(
    documents_data: dict[str, Any],
    raw_files: list[Path],
    chunks: list[dict[str, Any]],
    errors: list[dict[str, Any]],
) -> None:
    declared_chunk_count = (
        documents_data.get(
            "chunk_count"
        )
    )

    if declared_chunk_count != len(chunks):
        add_issue(
            errors,
            code="CHUNK_COUNT_MISMATCH",
            message=(
                "documents.json chunk_count "
                "does not match the actual "
                "chunks list."
            ),
        )

    declared_source_count = (
        documents_data.get(
            "source_count"
        )
    )

    if declared_source_count != len(
        raw_files
    ):
        add_issue(
            errors,
            code="SOURCE_COUNT_MISMATCH",
            message=(
                "documents.json source_count is "
                f"{declared_source_count}, but "
                f"knowledge/raw currently "
                f"contains {len(raw_files)} "
                "supported files."
            ),
        )


def build_source_summary(
    raw_files: list[Path],
    chunks: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    chunks_by_source = (
        build_chunks_by_source(chunks)
    )

    source_summary: list[
        dict[str, Any]
    ] = []

    for raw_file in raw_files:
        source_chunks = chunks_by_source.get(
            str(raw_file.resolve()),
            [],
        )

        pages = sorted(
            {
                chunk.get("page_number")
                for chunk in source_chunks
                if isinstance(
                    chunk.get(
                        "page_number"
                    ),
                    int,
                )
            }
        )

        slides = sorted(
            {
                chunk.get("slide_number")
                for chunk in source_chunks
                if isinstance(
                    chunk.get(
                        "slide_number"
                    ),
                    int,
                )
            }
        )

        source_summary.append(
            {
                "source_file": (
                    relative_project_path(
                        raw_file
                    )
                ),
                "file_type": (
                    raw_file.suffix
                    .lower()
                    .lstrip(".")
                ),
                "chunk_count": len(
                    source_chunks
                ),
                "ready_count": sum(
                    1
                    for chunk in source_chunks
                    if chunk.get("status")
                    == "ready"
                ),
                "review_count": sum(
                    1
                    for chunk in source_chunks
                    if chunk.get("status")
                    != "ready"
                ),
                "ocr_chunk_count": sum(
                    1
                    for chunk in source_chunks
                    if chunk.get(
                        "ocr_applied"
                    )
                ),
                "image_chunk_count": sum(
                    1
                    for chunk in source_chunks
                    if chunk.get(
                        "image_paths"
                    )
                ),
                "pages": pages,
                "slides": slides,
            }
        )

    return source_summary


def print_source_summary(
    source_summary: list[
        dict[str, Any]
    ],
) -> None:
    print()
    print("Source summary")
    print("-" * 80)

    for source in source_summary:
        print(
            Path(
                source["source_file"]
            ).name
        )

        print(
            "  Chunks:",
            source["chunk_count"],
        )

        print(
            "  Ready:",
            source["ready_count"],
        )

        print(
            "  Review:",
            source["review_count"],
        )

        print(
            "  OCR:",
            source["ocr_chunk_count"],
        )

        print(
            "  Image chunks:",
            source["image_chunk_count"],
        )

        if source["pages"]:
            print(
                "  Pages:",
                source["pages"],
            )

        if source["slides"]:
            print(
                "  Slides:",
                source["slides"],
            )


def main() -> None:
    errors: list[dict[str, Any]] = []
    warnings: list[dict[str, Any]] = []

    try:
        documents_data = load_json(
            DOCUMENTS_PATH
        )

        review_data = load_json(
            REVIEW_PATH
        )

        parse_error_data = load_json(
            PARSE_ERRORS_PATH
        )

    except (
        FileNotFoundError,
        ValueError,
        TypeError,
    ) as error:
        report = {
            "version": 1,
            "generated_at": datetime.now(
                timezone.utc
            ).isoformat(),
            "passed": False,
            "error_count": 1,
            "warning_count": 0,
            "errors": [
                {
                    "code": (
                        "VALIDATION_SETUP_ERROR"
                    ),
                    "message": str(error),
                }
            ],
            "warnings": [],
            "sources": [],
        }

        write_json(
            VALIDATION_REPORT_PATH,
            report,
        )

        print()
        print("=" * 80)
        print("VALIDATION FAILED")
        print("=" * 80)
        print(str(error))
        print()
        print(
            "Full report:",
            VALIDATION_REPORT_PATH,
        )

        sys.exit(1)

    chunks_value = documents_data.get(
        "chunks"
    )

    if not isinstance(chunks_value, list):
        add_issue(
            errors,
            code="INVALID_DOCUMENTS_FILE",
            message=(
                "documents.json does not "
                "contain a chunks list."
            ),
        )

        chunks: list[
            dict[str, Any]
        ] = []
    else:
        chunks = chunks_value

    raw_files = find_raw_files()

    if not raw_files:
        add_issue(
            errors,
            code="NO_RAW_FILES",
            message=(
                "No supported .docx, .pdf, or "
                ".pptx files were found in "
                "knowledge/raw."
            ),
        )

    validate_parse_errors(
        parse_error_data=parse_error_data,
        errors=errors,
    )

    validate_chunk_fields(
        chunks=chunks,
        errors=errors,
        warnings=warnings,
    )

    validate_duplicate_ids(
        chunks=chunks,
        errors=errors,
    )

    validate_chunk_indexes(
        chunks=chunks,
        warnings=warnings,
    )

    validate_raw_file_coverage(
        raw_files=raw_files,
        chunks=chunks,
        errors=errors,
    )

    validate_pdf_page_coverage(
        raw_files=raw_files,
        chunks=chunks,
        errors=errors,
    )

    validate_pptx_slide_coverage(
        raw_files=raw_files,
        chunks=chunks,
        errors=errors,
    )

    validate_review_file(
        chunks=chunks,
        review_data=review_data,
        errors=errors,
    )

    validate_document_counts(
        documents_data=documents_data,
        raw_files=raw_files,
        chunks=chunks,
        errors=errors,
    )

    source_summary = build_source_summary(
        raw_files=raw_files,
        chunks=chunks,
    )

    report = {
        "version": 2,
        "generated_at": datetime.now(
            timezone.utc
        ).isoformat(),
        "passed": len(errors) == 0,
        "error_count": len(errors),
        "warning_count": len(warnings),
        "chunk_count": len(chunks),
        "source_count": len(
            source_summary
        ),
        "errors": errors,
        "warnings": warnings,
        "sources": source_summary,
    }

    write_json(
        VALIDATION_REPORT_PATH,
        report,
    )

    print()
    print("=" * 80)

    if errors:
        print("VALIDATION FAILED")
    else:
        print("VALIDATION PASSED")

    print("=" * 80)

    print(
        "Sources:",
        len(source_summary),
    )

    print(
        "Chunks:",
        len(chunks),
    )

    print(
        "Errors:",
        len(errors),
    )

    print(
        "Warnings:",
        len(warnings),
    )

    print_source_summary(
        source_summary
    )

    if errors:
        print()
        print("Errors")
        print("-" * 80)

        for index, error in enumerate(
            errors,
            start=1,
        ):
            print(
                f"{index}. "
                f"[{error['code']}] "
                f"{error['message']}"
            )

            if error.get("source_file"):
                print(
                    "   Source:",
                    error["source_file"],
                )

            if error.get("page_number"):
                print(
                    "   Page:",
                    error["page_number"],
                )

            if error.get("slide_number"):
                print(
                    "   Slide:",
                    error["slide_number"],
                )

    if warnings:
        print()
        print("Warnings")
        print("-" * 80)

        for index, warning in enumerate(
            warnings,
            start=1,
        ):
            print(
                f"{index}. "
                f"[{warning['code']}] "
                f"{warning['message']}"
            )

            if warning.get("source_file"):
                print(
                    "   Source:",
                    warning["source_file"],
                )

    print()
    print(
        "Full report:",
        VALIDATION_REPORT_PATH,
    )

    if errors:
        sys.exit(1)


if __name__ == "__main__":
    main()