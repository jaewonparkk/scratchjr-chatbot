from __future__ import annotations

import json
import sys
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


PROJECT_ROOT = Path(
    __file__
).resolve().parents[1]

PROCESSED_DIRECTORY = (
    PROJECT_ROOT
    / "knowledge"
    / "processed"
)

DOCUMENTS_PATH = (
    PROCESSED_DIRECTORY
    / "documents.json"
)

REVIEW_REQUIRED_PATH = (
    PROCESSED_DIRECTORY
    / "review_required.json"
)

REVIEW_DECISIONS_PATH = (
    PROCESSED_DIRECTORY
    / "review_decisions.json"
)

REVIEWED_DOCUMENTS_PATH = (
    PROCESSED_DIRECTORY
    / "reviewed_documents.json"
)

REJECTED_DOCUMENTS_PATH = (
    PROCESSED_DIRECTORY
    / "rejected_documents.json"
)


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
    temporary_path = file_path.with_suffix(
        f"{file_path.suffix}.tmp"
    )

    temporary_path.write_text(
        json.dumps(
            data,
            indent=2,
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    temporary_path.replace(file_path)


def require_list(
    data: dict[str, Any],
    key: str,
    file_name: str,
) -> list[Any]:
    value = data.get(key)

    if not isinstance(value, list):
        raise TypeError(
            f"{file_name} does not contain "
            f"a valid '{key}' list."
        )

    return value


def build_decision_map(
    decisions: list[Any],
) -> dict[str, dict[str, Any]]:
    decision_map: dict[
        str,
        dict[str, Any],
    ] = {}

    for index, decision in enumerate(
        decisions
    ):
        if not isinstance(decision, dict):
            raise TypeError(
                "Review decision at index "
                f"{index} is not an object."
            )

        chunk_id = decision.get("chunkId")

        if (
            not isinstance(chunk_id, str)
            or not chunk_id.strip()
        ):
            raise ValueError(
                "Review decision at index "
                f"{index} has no valid chunkId."
            )

        if chunk_id in decision_map:
            raise ValueError(
                "Duplicate review decision for "
                f"chunk ID: {chunk_id}"
            )

        decision_value = decision.get(
            "decision"
        )

        if decision_value not in {
            "pending",
            "approved",
            "rejected",
        }:
            raise ValueError(
                "Invalid review decision "
                f"'{decision_value}' for "
                f"chunk ID: {chunk_id}"
            )

        decision_map[chunk_id] = decision

    return decision_map


def validate_review_completion(
    review_chunks: list[Any],
    decision_map: dict[
        str,
        dict[str, Any],
    ],
) -> None:
    review_chunk_ids: set[str] = set()

    for index, chunk in enumerate(
        review_chunks
    ):
        if not isinstance(chunk, dict):
            raise TypeError(
                "Review chunk at index "
                f"{index} is not an object."
            )

        chunk_id = chunk.get("id")

        if (
            not isinstance(chunk_id, str)
            or not chunk_id.strip()
        ):
            raise ValueError(
                "Review chunk at index "
                f"{index} has no valid ID."
            )

        review_chunk_ids.add(chunk_id)

    missing_decisions = sorted(
        review_chunk_ids
        - set(decision_map.keys())
    )

    pending_decisions = sorted(
        chunk_id
        for chunk_id in review_chunk_ids
        if (
            decision_map.get(
                chunk_id,
                {},
            ).get("decision")
            == "pending"
        )
    )

    unknown_decisions = sorted(
        set(decision_map.keys())
        - review_chunk_ids
    )

    if missing_decisions:
        raise ValueError(
            "Some review items do not have "
            "saved decisions:\n- "
            + "\n- ".join(
                missing_decisions
            )
        )

    if pending_decisions:
        raise ValueError(
            "Some review items are still "
            "pending:\n- "
            + "\n- ".join(
                pending_decisions
            )
        )

    if unknown_decisions:
        raise ValueError(
            "review_decisions.json contains "
            "decisions for chunks that are no "
            "longer in review_required.json:\n- "
            + "\n- ".join(
                unknown_decisions
            )
        )


def approved_chunk(
    original_chunk: dict[str, Any],
    decision: dict[str, Any],
) -> dict[str, Any]:
    updated_chunk = deepcopy(
        original_chunk
    )

    edited_content = decision.get(
        "editedContent"
    )

    if (
        not isinstance(
            edited_content,
            str,
        )
        or not edited_content.strip()
    ):
        raise ValueError(
            "Approved chunk has empty edited "
            f"content: {original_chunk.get('id')}"
        )

    notes = decision.get("notes")

    if not isinstance(notes, str):
        notes = ""

    reviewed_at = decision.get(
        "reviewedAt"
    )

    if not isinstance(
        reviewed_at,
        str,
    ):
        reviewed_at = ""

    updated_chunk["content"] = (
        edited_content.strip()
    )

    updated_chunk["status"] = "ready"

    updated_chunk[
        "requires_visual_review"
    ] = False

    metadata = updated_chunk.get(
        "metadata"
    )

    if not isinstance(metadata, dict):
        metadata = {}

    updated_chunk["metadata"] = {
        **metadata,
        "review": {
            "required": True,
            "completed": True,
            "decision": "approved",
            "notes": notes.strip(),
            "reviewed_at": reviewed_at,
            "original_content": (
                original_chunk.get(
                    "content",
                    "",
                )
            ),
        },
    }

    return updated_chunk


def automatically_ready_chunk(
    original_chunk: dict[str, Any],
) -> dict[str, Any]:
    updated_chunk = deepcopy(
        original_chunk
    )

    metadata = updated_chunk.get(
        "metadata"
    )

    if not isinstance(metadata, dict):
        metadata = {}

    updated_chunk["metadata"] = {
        **metadata,
        "review": {
            "required": False,
            "completed": True,
            "decision": (
                "not_required"
            ),
        },
    }

    return updated_chunk


def rejected_record(
    original_chunk: dict[str, Any],
    decision: dict[str, Any],
) -> dict[str, Any]:
    notes = decision.get("notes")

    if not isinstance(notes, str):
        notes = ""

    reviewed_at = decision.get(
        "reviewedAt"
    )

    if not isinstance(
        reviewed_at,
        str,
    ):
        reviewed_at = ""

    return {
        "id": original_chunk.get("id"),
        "title": original_chunk.get(
            "title"
        ),
        "source_file": (
            original_chunk.get(
                "source_file"
            )
        ),
        "page_number": (
            original_chunk.get(
                "page_number"
            )
        ),
        "slide_number": (
            original_chunk.get(
                "slide_number"
            )
        ),
        "section": original_chunk.get(
            "section"
        ),
        "original_content": (
            original_chunk.get(
                "content",
                "",
            )
        ),
        "notes": notes.strip(),
        "reviewed_at": reviewed_at,
    }


def main() -> None:
    try:
        documents_data = load_json(
            DOCUMENTS_PATH
        )

        review_required_data = load_json(
            REVIEW_REQUIRED_PATH
        )

        review_decisions_data = load_json(
            REVIEW_DECISIONS_PATH
        )

        document_chunks = require_list(
            documents_data,
            "chunks",
            "documents.json",
        )

        review_chunks = require_list(
            review_required_data,
            "chunks",
            "review_required.json",
        )

        decisions = require_list(
            review_decisions_data,
            "decisions",
            "review_decisions.json",
        )

        decision_map = build_decision_map(
            decisions
        )

        validate_review_completion(
            review_chunks=review_chunks,
            decision_map=decision_map,
        )

        final_chunks: list[
            dict[str, Any]
        ] = []

        rejected_chunks: list[
            dict[str, Any]
        ] = []

        auto_ready_count = 0
        approved_count = 0
        rejected_count = 0

        for chunk_index, chunk in enumerate(
            document_chunks
        ):
            if not isinstance(chunk, dict):
                raise TypeError(
                    "Document chunk at index "
                    f"{chunk_index} is not "
                    "an object."
                )

            chunk_id = chunk.get("id")

            if (
                not isinstance(
                    chunk_id,
                    str,
                )
                or not chunk_id.strip()
            ):
                raise ValueError(
                    "Document chunk at index "
                    f"{chunk_index} has no "
                    "valid ID."
                )

            original_status = chunk.get(
                "status"
            )

            if original_status == "ready":
                final_chunks.append(
                    automatically_ready_chunk(
                        chunk
                    )
                )

                auto_ready_count += 1
                continue

            decision = decision_map.get(
                chunk_id
            )

            if decision is None:
                raise ValueError(
                    "No review decision was "
                    "found for non-ready chunk: "
                    f"{chunk_id}"
                )

            decision_value = decision.get(
                "decision"
            )

            if decision_value == "approved":
                final_chunks.append(
                    approved_chunk(
                        original_chunk=chunk,
                        decision=decision,
                    )
                )

                approved_count += 1

            elif (
                decision_value
                == "rejected"
            ):
                rejected_chunks.append(
                    rejected_record(
                        original_chunk=chunk,
                        decision=decision,
                    )
                )

                rejected_count += 1

            else:
                raise ValueError(
                    "Unexpected pending decision "
                    f"for chunk: {chunk_id}"
                )

        final_chunk_ids = [
            chunk["id"]
            for chunk in final_chunks
        ]

        if len(final_chunk_ids) != len(
            set(final_chunk_ids)
        ):
            raise ValueError(
                "Final reviewed documents "
                "contain duplicate chunk IDs."
            )

        generated_at = datetime.now(
            timezone.utc
        ).isoformat()

        final_sources = sorted(
            {
                str(
                    chunk.get(
                        "source_file",
                        "",
                    )
                )
                for chunk in final_chunks
                if chunk.get(
                    "source_file"
                )
            }
        )

        reviewed_payload = {
            "version": 1,
            "generated_at": generated_at,
            "source_count": len(
                final_sources
            ),
            "original_chunk_count": len(
                document_chunks
            ),
            "included_chunk_count": len(
                final_chunks
            ),
            "auto_ready_count": (
                auto_ready_count
            ),
            "approved_review_count": (
                approved_count
            ),
            "rejected_review_count": (
                rejected_count
            ),
            "sources": final_sources,
            "chunks": final_chunks,
        }

        rejected_payload = {
            "version": 1,
            "generated_at": generated_at,
            "rejected_count": len(
                rejected_chunks
            ),
            "chunks": rejected_chunks,
        }

        write_json(
            REVIEWED_DOCUMENTS_PATH,
            reviewed_payload,
        )

        write_json(
            REJECTED_DOCUMENTS_PATH,
            rejected_payload,
        )

        print()
        print("=" * 80)
        print(
            "REVIEW FINALIZATION PASSED"
        )
        print("=" * 80)
        print(
            "Original chunks:",
            len(document_chunks),
        )
        print(
            "Automatically ready:",
            auto_ready_count,
        )
        print(
            "Approved after review:",
            approved_count,
        )
        print(
            "Rejected:",
            rejected_count,
        )
        print(
            "Final searchable chunks:",
            len(final_chunks),
        )
        print()
        print("Output:")
        print(
            f"  {REVIEWED_DOCUMENTS_PATH}"
        )
        print(
            f"  {REJECTED_DOCUMENTS_PATH}"
        )

    except (
        FileNotFoundError,
        ValueError,
        TypeError,
    ) as error:
        print()
        print("=" * 80)
        print(
            "REVIEW FINALIZATION FAILED"
        )
        print("=" * 80)
        print(str(error))
        print()

        sys.exit(1)


if __name__ == "__main__":
    main()