from __future__ import annotations

import re
from pathlib import Path

from docx import Document
from docx.oxml.ns import qn
from docx.table import Table
from docx.text.paragraph import Paragraph

from ingestion.models import SourceUnit
from ingestion.utils import (
    clean_text,
    relative_path,
    safe_filename,
)


TOP_LEVEL_SECTIONS = {
    "warm up",
    "opening tech circle",
    "scratchjr time",
    "scratchjr blocks time",
    "scratchjr bots time",
    "circuits time",
    "unplugged time",
    "word time",
    "closing tech circle",
    "opportunities for differentiation",
    "steps with breadboard",
    "steps without full breadboard",
    "steps with ceibal’s board",
    "steps with ceibal's board",
    "converting to scratchjr project",
}

SUBSECTIONS = {
    "structured challenge",
    "expressive exploration",
    "parts checklist",
    "teacher preparation",
    "group organization",
    "vocabulary",
    "children will be able to…",
    "children will be able to...",
}


def _heading_level(
    text: str,
    style_name: str,
    has_section: bool,
) -> int | None:
    normalized = text.strip()
    lowercase = normalized.lower()

    style_match = re.match(
        r"heading\s*(\d+)",
        style_name.lower(),
    )

    if style_match:
        return min(int(style_match.group(1)), 4)

    if re.match(
        r"^lesson\s+\d+\s*:",
        normalized,
        flags=re.IGNORECASE,
    ):
        return 1

    if lowercase in TOP_LEVEL_SECTIONS:
        return 2

    if lowercase in SUBSECTIONS:
        return 3

    if re.match(
        r"^steps\s+(with|without)\b",
        normalized,
        flags=re.IGNORECASE,
    ):
        return 1

    if re.match(
        r"^\d+\.\s+[A-Za-z][A-Za-z &/'’()-]{0,60}$",
        normalized,
    ):
        return 3

    if not has_section and len(normalized) <= 120:
        return 1

    return None


def _update_section_path(
    current_path: list[str],
    heading: str,
    level: int,
) -> list[str]:
    desired_parent_count = max(level - 1, 0)

    updated = current_path[:desired_parent_count]
    updated.append(heading)

    return updated


def _extract_paragraph_images(
    paragraph: Paragraph,
    document: Document,
    output_directory: Path,
    project_root: Path,
    file_prefix: str,
    paragraph_number: int,
) -> list[str]:
    image_paths: list[str] = []

    blips = paragraph._element.xpath(
        ".//a:blip"
    )

    for image_number, blip in enumerate(
        blips,
        start=1,
    ):
        relationship_id = blip.get(
            qn("r:embed")
        )

        if not relationship_id:
            continue

        image_part = (
            document.part.related_parts.get(
                relationship_id
            )
        )

        if image_part is None:
            continue

        extension = Path(
            str(image_part.partname)
        ).suffix

        if not extension:
            extension = ".bin"

        output_path = output_directory / (
            f"{file_prefix}-paragraph-"
            f"{paragraph_number:04d}-"
            f"image-{image_number:02d}"
            f"{extension}"
        )

        output_path.write_bytes(
            image_part.blob
        )

        image_paths.append(
            relative_path(
                output_path,
                project_root,
            )
        )

    return image_paths


def _table_to_text(table: Table) -> str:
    rows: list[str] = []

    for row in table.rows:
        cell_values = [
            clean_text(cell.text)
            for cell in row.cells
        ]

        if any(cell_values):
            rows.append(
                " | ".join(cell_values)
            )

    return "\n".join(rows)


def parse_docx(
    file_path: Path,
    image_directory: Path,
    project_root: Path,
) -> list[SourceUnit]:
    document = Document(file_path)

    source_file = relative_path(
        file_path,
        project_root,
    )

    file_prefix = safe_filename(
        file_path.stem
    )

    document_image_directory = (
        image_directory / file_prefix
    )

    document_image_directory.mkdir(
        parents=True,
        exist_ok=True,
    )

    units: list[SourceUnit] = []
    section_path: list[str] = []

    paragraph_number = 0
    table_number = 0

    for item in document.iter_inner_content():
        if isinstance(item, Paragraph):
            paragraph_number += 1

            text = clean_text(item.text)

            style_name = (
                item.style.name
                if item.style is not None
                else ""
            )

            image_paths = (
                _extract_paragraph_images(
                    paragraph=item,
                    document=document,
                    output_directory=(
                        document_image_directory
                    ),
                    project_root=project_root,
                    file_prefix=file_prefix,
                    paragraph_number=(
                        paragraph_number
                    ),
                )
            )

            if text:
                heading_level = _heading_level(
                    text=text,
                    style_name=style_name,
                    has_section=bool(section_path),
                )

                if heading_level is not None:
                    section_path = (
                        _update_section_path(
                            current_path=(
                                section_path
                            ),
                            heading=text,
                            level=heading_level,
                        )
                    )

                    if image_paths:
                        units.append(
                            SourceUnit(
                                title=section_path[0],
                                content="",
                                source_file=(
                                    source_file
                                ),
                                file_type="docx",
                                section_path=list(
                                    section_path
                                ),
                                image_paths=(
                                    image_paths
                                ),
                                kind=(
                                    "heading-image"
                                ),
                                requires_visual_review=(
                                    True
                                ),
                                metadata={
                                    "paragraph_number": (
                                        paragraph_number
                                    ),
                                    "style": (
                                        style_name
                                    ),
                                },
                            )
                        )

                    continue

                title = (
                    section_path[0]
                    if section_path
                    else file_path.stem
                )

                units.append(
                    SourceUnit(
                        title=title,
                        content=text,
                        source_file=source_file,
                        file_type="docx",
                        section_path=list(
                            section_path
                        ),
                        image_paths=image_paths,
                        kind="paragraph",
                        requires_visual_review=(
                            bool(image_paths)
                        ),
                        should_display_image=bool(image_paths),
                        metadata={
                            "paragraph_number": (
                                paragraph_number
                            ),
                            "style": style_name,
                        },
                    )
                )

            elif image_paths:
                title = (
                    section_path[0]
                    if section_path
                    else file_path.stem
                )

                units.append(
                    SourceUnit(
                        title=title,
                        content="",
                        source_file=source_file,
                        file_type="docx",
                        section_path=list(
                            section_path
                        ),
                        image_paths=image_paths,
                        kind="image",
                        requires_visual_review=True,
                        should_display_image=True,
                        metadata={
                            "paragraph_number": (
                                paragraph_number
                            ),
                            "style": style_name,
                        },
                    )
                )

        elif isinstance(item, Table):
            table_number += 1

            table_text = _table_to_text(item)

            if not table_text:
                continue

            title = (
                section_path[0]
                if section_path
                else file_path.stem
            )

            units.append(
                SourceUnit(
                    title=title,
                    content=table_text,
                    source_file=source_file,
                    file_type="docx",
                    section_path=list(
                        section_path
                    ),
                    kind="table",
                    metadata={
                        "table_number": (
                            table_number
                        ),
                    },
                )
            )

    return units