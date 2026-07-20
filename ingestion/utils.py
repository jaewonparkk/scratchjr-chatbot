from __future__ import annotations

import hashlib
import re
from pathlib import Path


def clean_text(text: str) -> str:
    text = (
        text.replace("\r\n", "\n")
        .replace("\r", "\n")
        .replace("\v", "\n")
        .replace("\u00a0", " ")
        .replace("\u00ad", "")
    )

    cleaned_lines: list[str] = []

    for line in text.splitlines():
        cleaned_line = re.sub(r"[ \t]+", " ", line).strip()

        if cleaned_line:
            cleaned_lines.append(cleaned_line)

    return "\n".join(cleaned_lines)


def relative_path(path: Path, project_root: Path) -> str:
    try:
        return path.resolve().relative_to(
            project_root.resolve()
        ).as_posix()
    except ValueError:
        return path.resolve().as_posix()


def stable_id(*parts: object) -> str:
    raw_value = "::".join(
        str(part) for part in parts
    )

    digest = hashlib.sha1(
        raw_value.encode("utf-8"),
        usedforsecurity=False,
    ).hexdigest()[:16]

    return digest


def safe_filename(value: str) -> str:
    normalized = value.lower().strip()

    normalized = re.sub(
        r"[^a-z0-9]+",
        "-",
        normalized,
    )

    return normalized.strip("-") or "document"