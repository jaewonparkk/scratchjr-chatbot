from __future__ import annotations

from collections.abc import Iterable

from ingestion.models import (
    DocumentChunk,
    SourceUnit,
)
from ingestion.utils import stable_id


MAXIMUM_CHUNK_CHARACTERS = 2200
CHUNK_OVERLAP_CHARACTERS = 200


def _unit_group_key(
    unit: SourceUnit,
) -> tuple[object, ...]:
    return (
        unit.source_file,
        unit.page_number,
        unit.slide_number,
        tuple(unit.section_path),
    )


def _split_long_text(
    text: str,
) -> list[str]:
    if len(text) <= MAXIMUM_CHUNK_CHARACTERS:
        return [text]

    chunks: list[str] = []
    start = 0

    while start < len(text):
        proposed_end = min(
            start + MAXIMUM_CHUNK_CHARACTERS,
            len(text),
        )

        end = proposed_end

        if proposed_end < len(text):
            search_start = (
                start
                + MAXIMUM_CHUNK_CHARACTERS // 2
            )

            newline_position = text.rfind(
                "\n",
                search_start,
                proposed_end,
            )

            sentence_position = max(
                text.rfind(
                    ". ",
                    search_start,
                    proposed_end,
                ),
                text.rfind(
                    "? ",
                    search_start,
                    proposed_end,
                ),
                text.rfind(
                    "! ",
                    search_start,
                    proposed_end,
                ),
            )

            space_position = text.rfind(
                " ",
                search_start,
                proposed_end,
            )

            break_position = max(
                newline_position,
                sentence_position,
                space_position,
            )

            if break_position > start:
                end = break_position + 1

        chunk = text[start:end].strip()

        if chunk:
            chunks.append(chunk)

        if end >= len(text):
            break

        start = max(
            end - CHUNK_OVERLAP_CHARACTERS,
            start + 1,
        )

    return chunks


def _make_chunks_from_group(
    units: list[SourceUnit],
) -> list[DocumentChunk]:
    first_unit = units[0]

    combined_content = "\n\n".join(
        unit.content
        for unit in units
        if unit.content
    ).strip()

    image_paths = sorted(
        {
            image_path
            for unit in units
            for image_path in unit.image_paths
        }
    )

    ocr_applied = any(
        unit.ocr_applied
        for unit in units
    )

    requires_visual_review = any(
        unit.requires_visual_review
        for unit in units
    )

    should_display_image = any(
        unit.should_display_image
        for unit in units
    )

    section = " > ".join(
        first_unit.section_path
    )

    if not section:
        section = first_unit.title

    if combined_content:
        text_chunks = _split_long_text(
            combined_content
        )
    else:
        text_chunks = [""]

    chunks: list[DocumentChunk] = []

    for chunk_index, chunk_content in enumerate(
        text_chunks,
    ):
        if not chunk_content:
            status = (
                "needs_manual_transcription"
            )
        elif requires_visual_review:
            status = "needs_visual_review"
        else:
            status = "ready"

        chunk_id = stable_id(
            first_unit.source_file,
            first_unit.page_number,
            first_unit.slide_number,
            section,
            chunk_index,
        )

        chunks.append(
            DocumentChunk(
                id=chunk_id,
                title=first_unit.title,
                content=chunk_content,
                source_file=(
                    first_unit.source_file
                ),
                file_type=(
                    first_unit.file_type
                ),
                section=section,
                chunk_index=chunk_index,
                page_number=(
                    first_unit.page_number
                ),
                slide_number=(
                    first_unit.slide_number
                ),
                image_paths=image_paths,
                ocr_applied=ocr_applied,
                requires_visual_review=(
                    requires_visual_review
                ),
                should_display_image=(
                    should_display_image
                ),
                status=status,
                metadata={
                    "source_unit_count": (
                        len(units)
                    ),
                    "source_kinds": sorted(
                        {
                            unit.kind
                            for unit in units
                        }
                    ),
                },
            )
        )

    return chunks


def chunk_source_units(
    source_units: Iterable[SourceUnit],
) -> list[DocumentChunk]:
    units: list[SourceUnit] = []

    for unit_index, unit in enumerate(
        source_units
    ):
        if unit is None:
            print(
                "Warning: chunker skipped "
                f"None at index {unit_index}."
            )
            continue

        if not isinstance(unit, SourceUnit):
            raise TypeError(
                "chunk_source_units expected "
                "SourceUnit, but received "
                f"{type(unit).__name__} "
                f"at index {unit_index}."
            )

        units.append(unit)

    if not units:
        return []

    chunks: list[DocumentChunk] = []

    current_group: list[SourceUnit] = []
    current_key: tuple[object, ...] | None = (
        None
    )

    for unit in units:
        unit_key = _unit_group_key(unit)

        if (
            current_group
            and unit_key != current_key
        ):
            chunks.extend(
                _make_chunks_from_group(
                    current_group
                )
            )

            current_group = []

        current_group.append(unit)
        current_key = unit_key

    if current_group:
        chunks.extend(
            _make_chunks_from_group(
                current_group
            )
        )

    return chunks