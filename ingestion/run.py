from __future__ import annotations

import json
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

from ingestion.chunker import chunk_source_units
from ingestion.models import SourceUnit
from ingestion.config import (
    IMAGE_EXTENSIONS,
)
from ingestion.parsers import (
    parse_docx,
    parse_image,
    parse_pdf,
    parse_pptx,
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

IMAGE_DIRECTORY = (
    PROCESSED_DIRECTORY
    / "images"
)

DOCUMENTS_OUTPUT_PATH = (
    PROCESSED_DIRECTORY
    / "documents.json"
)

REVIEW_OUTPUT_PATH = (
    PROCESSED_DIRECTORY
    / "review_required.json"
)

ERROR_OUTPUT_PATH = (
    PROCESSED_DIRECTORY
    / "parse_errors.json"
)


ParserFunction = Callable[
    [Path, Path, Path],
    list[SourceUnit],
]


PARSERS: dict[str, ParserFunction] = {
    ".docx": parse_docx,
    ".pdf": parse_pdf,
    ".pptx": parse_pptx,
    **{
        extension: parse_image
        for extension
        in IMAGE_EXTENSIONS
    },
}


def _find_source_files() -> list[Path]:
    return sorted(
        path
        for path in RAW_DIRECTORY.rglob("*")
        if (
            path.is_file()
            and path.suffix.lower() in PARSERS
        )
    )


def _write_json(
    output_path: Path,
    data: object,
) -> None:
    output_path.write_text(
        json.dumps(
            data,
            indent=2,
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )


def _validate_source_units(
    units: list[SourceUnit],
    source_file: str,
) -> tuple[
    list[SourceUnit],
    list[dict[str, object]],
]:
    """
    Parser 결과에 None이나 잘못된 객체가 들어갔는지 검사한다.

    잘못된 항목은 chunking 단계로 보내지 않고,
    parse_errors.json에 기록한다.
    """

    valid_units: list[SourceUnit] = []
    validation_errors: list[
        dict[str, object]
    ] = []

    for unit_index, unit in enumerate(units):
        if unit is None:
            validation_errors.append(
                {
                    "source_file": source_file,
                    "error_type": (
                        "InvalidSourceUnit"
                    ),
                    "unit_index": unit_index,
                    "message": (
                        "Parser returned None "
                        "instead of SourceUnit."
                    ),
                }
            )

            print(
                "  Warning: skipped None "
                f"at unit index {unit_index}."
            )

            continue

        if not isinstance(unit, SourceUnit):
            validation_errors.append(
                {
                    "source_file": source_file,
                    "error_type": (
                        "InvalidSourceUnit"
                    ),
                    "unit_index": unit_index,
                    "received_type": (
                        type(unit).__name__
                    ),
                    "message": (
                        "Parser returned an object "
                        "that is not a SourceUnit."
                    ),
                }
            )

            print(
                "  Warning: skipped invalid "
                f"{type(unit).__name__} "
                f"at unit index {unit_index}."
            )

            continue

        valid_units.append(unit)

    return valid_units, validation_errors


def main() -> None:
    PROCESSED_DIRECTORY.mkdir(
        parents=True,
        exist_ok=True,
    )

    if IMAGE_DIRECTORY.exists():
        shutil.rmtree(
            IMAGE_DIRECTORY
        )

    IMAGE_DIRECTORY.mkdir(
        parents=True,
        exist_ok=True,
    )

    source_files = _find_source_files()

    if not source_files:
        print(
            "No supported files were found in "
            f"{RAW_DIRECTORY}"
        )

        print(
            "Add .docx, .pdf, or .pptx files "
            "and run the command again."
        )

        return

    print(
        f"Found {len(source_files)} "
        "source file(s)."
    )

    all_units: list[SourceUnit] = []

    errors: list[
        dict[str, object]
    ] = []

    source_summaries: list[
        dict[str, object]
    ] = []

    for source_path in source_files:
        extension = (
            source_path.suffix.lower()
        )

        parser = PARSERS[extension]

        relative_source = (
            source_path
            .relative_to(PROJECT_ROOT)
            .as_posix()
        )

        print(
            f"Parsing {relative_source}..."
        )

        try:
            parsed_units = parser(
                source_path,
                IMAGE_DIRECTORY,
                PROJECT_ROOT,
            )

            if parsed_units is None:
                raise TypeError(
                    "Parser returned None instead "
                    "of a list of SourceUnit objects."
                )

            if not isinstance(
                parsed_units,
                list,
            ):
                raise TypeError(
                    "Parser returned "
                    f"{type(parsed_units).__name__} "
                    "instead of a list."
                )

            valid_units, unit_errors = (
                _validate_source_units(
                    units=parsed_units,
                    source_file=relative_source,
                )
            )

            errors.extend(unit_errors)
            all_units.extend(valid_units)

            source_summaries.append(
                {
                    "source_file": (
                        relative_source
                    ),
                    "file_type": (
                        extension.lstrip(".")
                    ),
                    "raw_source_unit_count": (
                        len(parsed_units)
                    ),
                    "valid_source_unit_count": (
                        len(valid_units)
                    ),
                    "invalid_source_unit_count": (
                        len(parsed_units)
                        - len(valid_units)
                    ),
                }
            )

            print(
                f"  Extracted "
                f"{len(parsed_units)} "
                "source unit(s)."
            )

            if unit_errors:
                print(
                    f"  Skipped "
                    f"{len(unit_errors)} "
                    "invalid source unit(s)."
                )

        except Exception as error:
            error_record = {
                "source_file": (
                    relative_source
                ),
                "error_type": (
                    type(error).__name__
                ),
                "message": str(error),
            }

            errors.append(error_record)

            print(
                f"  Failed: {error}"
            )

    print()
    print(
        f"Preparing to chunk "
        f"{len(all_units)} valid "
        "source unit(s)..."
    )

    chunks = chunk_source_units(
        all_units
    )

    review_chunks = [
        chunk
        for chunk in chunks
        if chunk.status != "ready"
    ]

    generated_at = datetime.now(
        timezone.utc
    ).isoformat()

    documents_payload = {
        "version": 1,
        "generated_at": generated_at,
        "source_count": (
            len(source_files)
        ),
        "source_unit_count": (
            len(all_units)
        ),
        "chunk_count": len(chunks),
        "sources": source_summaries,
        "chunks": [
            chunk.to_dict()
            for chunk in chunks
        ],
    }

    review_payload = {
        "version": 1,
        "generated_at": generated_at,
        "review_count": (
            len(review_chunks)
        ),
        "chunks": [
            chunk.to_dict()
            for chunk in review_chunks
        ],
    }

    error_payload = {
        "version": 1,
        "generated_at": generated_at,
        "error_count": len(errors),
        "errors": errors,
    }

    _write_json(
        DOCUMENTS_OUTPUT_PATH,
        documents_payload,
    )

    _write_json(
        REVIEW_OUTPUT_PATH,
        review_payload,
    )

    _write_json(
        ERROR_OUTPUT_PATH,
        error_payload,
    )

    print()
    print(
        "Ingestion parsing finished."
    )

    print(
        f"Sources: {len(source_files)}"
    )

    print(
        f"Valid source units: "
        f"{len(all_units)}"
    )

    print(
        f"Chunks: {len(chunks)}"
    )

    print(
        "Visual/manual review required: "
        f"{len(review_chunks)}"
    )

    print(
        f"Warnings/errors recorded: "
        f"{len(errors)}"
    )

    print()
    print("Output:")

    print(
        f"  {DOCUMENTS_OUTPUT_PATH}"
    )

    print(
        f"  {REVIEW_OUTPUT_PATH}"
    )

    print(
        f"  {ERROR_OUTPUT_PATH}"
    )


if __name__ == "__main__":
    main()