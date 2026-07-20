from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any


@dataclass(slots=True)
class SourceUnit:
    title: str
    content: str
    source_file: str
    file_type: str

    section_path: list[str] = field(default_factory=list)

    page_number: int | None = None
    slide_number: int | None = None

    image_paths: list[str] = field(default_factory=list)

    kind: str = "paragraph"

    ocr_applied: bool = False
    requires_visual_review: bool = False
    should_display_image: bool = False

    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(slots=True)
class DocumentChunk:
    id: str
    title: str
    content: str
    source_file: str
    file_type: str
    section: str

    chunk_index: int

    page_number: int | None = None
    slide_number: int | None = None

    image_paths: list[str] = field(default_factory=list)

    ocr_applied: bool = False
    requires_visual_review: bool = False
    should_display_image: bool = False

    status: str = "ready"

    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)