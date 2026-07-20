from __future__ import annotations


DOCUMENT_EXTENSIONS = {
    ".docx",
    ".pdf",
    ".pptx",
}

IMAGE_EXTENSIONS = {
    ".png",
    ".jpg",
    ".jpeg",
    ".webp",
    ".bmp",
    ".tif",
    ".tiff",
}

SUPPORTED_EXTENSIONS = (
    DOCUMENT_EXTENSIONS
    | IMAGE_EXTENSIONS
)

ALLOWED_FILE_TYPES = {
    "docx",
    "pdf",
    "pptx",
    "image",
}