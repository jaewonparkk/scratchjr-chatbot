import "server-only";

import { createQueryEmbedding } from "@/lib/rag/embeddings";
import { supabaseAdmin } from "@/lib/supabase/admin";

export type SearchResult = {
  id: number;
  chunk_id: string;
  title: string;
  content: string;
  source_file: string;
  file_type:
    | "docx"
    | "pdf"
    | "pptx"
    | "image"
    | "markdown";
  section: string;
  page_number: number | null;
  slide_number: number | null;
  image_paths: string[];
  should_display_image: boolean;
  metadata: Record<string, unknown>;
  similarity: number;
};

export type SearchFilters = {
  topic?: string;
  contentType?: string;
  stepNumber?: number;
  documentType?: string;
  wantsImage?: boolean;
};

export type SearchOptions = {
  matchCount?: number;
  matchThreshold?: number;
  filters?: SearchFilters;
};

function normalizeFileType(
  value: unknown,
): SearchResult["file_type"] {
  if (
    value === "docx" ||
    value === "pdf" ||
    value === "pptx" ||
    value === "image" ||
    value === "markdown"
  ) {
    return value;
  }

  return "pdf";
}

function normalizeResult(
  result: Partial<SearchResult>,
): SearchResult {
  return {
    id: Number(result.id ?? 0),

    chunk_id:
      typeof result.chunk_id === "string"
        ? result.chunk_id
        : "",

    title:
      typeof result.title === "string" &&
      result.title.trim()
        ? result.title.trim()
        : "Untitled document",

    content:
      typeof result.content === "string"
        ? result.content.trim()
        : "",

    source_file:
      typeof result.source_file === "string"
        ? result.source_file
        : "",

    file_type: normalizeFileType(
      result.file_type,
    ),

    section:
      typeof result.section === "string"
        ? result.section
        : "",

    page_number:
      typeof result.page_number === "number"
        ? result.page_number
        : null,

    slide_number:
      typeof result.slide_number === "number"
        ? result.slide_number
        : null,

    image_paths: Array.isArray(
      result.image_paths,
    )
      ? result.image_paths.filter(
          (value): value is string =>
            typeof value === "string" &&
            value.trim().length > 0,
        )
      : [],

    should_display_image: Boolean(
      result.should_display_image,
    ),

    metadata:
      result.metadata &&
      typeof result.metadata === "object" &&
      !Array.isArray(result.metadata)
        ? result.metadata
        : {},

    similarity: Number(
      result.similarity ?? 0,
    ),
  };
}

function readMetadataString(
  metadata: Record<string, unknown>,
  key: string,
): string | null {
  const value = metadata[key];

  if (
    typeof value === "string" &&
    value.trim()
  ) {
    return value.trim();
  }

  return null;
}

function readMetadataNumber(
  metadata: Record<string, unknown>,
  key: string,
): number | null {
  const value = metadata[key];

  if (
    typeof value === "number" &&
    Number.isFinite(value)
  ) {
    return value;
  }

  if (
    typeof value === "string" &&
    value.trim()
  ) {
    const parsed = Number(value);

    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

function matchesFilters(
  result: SearchResult,
  filters?: SearchFilters,
): boolean {
  if (!filters) {
    return true;
  }

  const metadata = result.metadata;

  if (filters.topic) {
    const topic = readMetadataString(
      metadata,
      "topic",
    );

    if (topic !== filters.topic) {
      return false;
    }
  }

  if (filters.contentType) {
    const contentType =
      readMetadataString(
        metadata,
        "content_type",
      );

    if (
      contentType !==
      filters.contentType
    ) {
      return false;
    }
  }

  if (filters.documentType) {
    const documentType =
      readMetadataString(
        metadata,
        "document_type",
      );

    if (
      documentType !==
      filters.documentType
    ) {
      return false;
    }
  }

  if (
    filters.stepNumber !== undefined
  ) {
    const stepNumber =
      readMetadataNumber(
        metadata,
        "step_number",
      );

    if (
      stepNumber !==
      filters.stepNumber
    ) {
      return false;
    }
  }

  if (
    filters.wantsImage === true &&
    (
      !result.should_display_image ||
      result.image_paths.length === 0
    )
  ) {
    return false;
  }

  return true;
}

function createDeduplicationKey(
  result: SearchResult,
): string {
  const normalizedContent =
    result.content
      .toLowerCase()
      .replace(
        /[^\p{L}\p{N}]+/gu,
        " ",
      )
      .replace(/\s+/g, " ")
      .trim();

  if (normalizedContent) {
    return normalizedContent;
  }

  return [
    result.title,
    result.source_file,
    result.page_number ?? "",
    result.slide_number ?? "",
  ]
    .join("|")
    .toLowerCase();
}

function deduplicateResults(
  results: SearchResult[],
  limit: number,
): SearchResult[] {
  const seen =
    new Set<string>();

  const output:
    SearchResult[] = [];

  for (const result of results) {
    const key =
      createDeduplicationKey(
        result,
      );

    if (
      !key ||
      seen.has(key)
    ) {
      continue;
    }

    seen.add(key);
    output.push(result);

    if (
      output.length >= limit
    ) {
      break;
    }
  }

  return output;
}

function validateSearchOptions(
  options: SearchOptions,
): {
  matchCount: number;
  matchThreshold: number;
} {
  const matchCount =
    options.matchCount ?? 5;

  const matchThreshold =
    options.matchThreshold ?? 0.35;

  if (
    !Number.isInteger(matchCount) ||
    matchCount < 1 ||
    matchCount > 20
  ) {
    throw new Error(
      "matchCount must be an integer between 1 and 20.",
    );
  }

  if (
    !Number.isFinite(
      matchThreshold,
    ) ||
    matchThreshold < -1 ||
    matchThreshold > 1
  ) {
    throw new Error(
      "matchThreshold must be between -1 and 1.",
    );
  }

  return {
    matchCount,
    matchThreshold,
  };
}

export function getResultStepNumber(
  result: SearchResult,
): number | null {
  const metadataStep =
    readMetadataNumber(
      result.metadata,
      "step_number",
    );

  if (
    metadataStep !== null &&
    Number.isInteger(metadataStep) &&
    metadataStep >= 1
  ) {
    return metadataStep;
  }

  const searchableText = [
    result.title,
    result.section,
    result.content,
  ].join(" ");

  const match =
    searchableText.match(
      /\bstep\s*#?\s*(\d{1,3})\b/i,
    );

  if (!match) {
    return null;
  }

  const stepNumber =
    Number(match[1]);

  if (
    !Number.isInteger(stepNumber) ||
    stepNumber < 1
  ) {
    return null;
  }

  return stepNumber;
}

export async function searchDocuments(
  question: string,
  options: SearchOptions = {},
): Promise<SearchResult[]> {
  const normalizedQuestion =
    question.trim();

  if (!normalizedQuestion) {
    throw new Error(
      "Question cannot be empty.",
    );
  }

  const {
    matchCount,
    matchThreshold,
  } = validateSearchOptions(
    options,
  );

  const queryEmbedding =
    await createQueryEmbedding(
      normalizedQuestion,
    );

  const candidateCount =
    Math.min(
      Math.max(
        matchCount * 8,
        24,
      ),
      100,
    );

  const {
    data,
    error,
  } = await supabaseAdmin.rpc(
    "match_documents",
    {
      query_embedding:
        queryEmbedding,

      match_threshold:
        matchThreshold,

      match_count:
        candidateCount,
    },
  );

  if (error) {
    throw new Error(
      `Document search failed: ${error.message}`,
    );
  }

  if (!Array.isArray(data)) {
    return [];
  }

  const normalizedResults =
    data
      .map(
        (
          result: Partial<SearchResult>,
        ) =>
          normalizeResult(result),
      )
      .filter(
        (result) =>
          result.content.length > 0,
      );

  const filteredResults =
    normalizedResults.filter(
      (result) =>
        matchesFilters(
          result,
          options.filters,
        ),
    );

  filteredResults.sort(
    (first, second) =>
      second.similarity -
      first.similarity,
  );

  return deduplicateResults(
    filteredResults,
    matchCount,
  );
}