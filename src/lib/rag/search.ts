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
    | "image";
  section: string;
  page_number: number | null;
  slide_number: number | null;
  image_paths: string[];
  should_display_image: boolean;
  metadata: Record<string, unknown>;
  similarity: number;
};

type SearchOptions = {
  matchCount?: number;
  matchThreshold?: number;
};

const DOCUMENT_COLUMNS = [
  "id",
  "chunk_id",
  "title",
  "content",
  "source_file",
  "file_type",
  "section",
  "page_number",
  "slide_number",
  "image_paths",
  "should_display_image",
  "metadata",
].join(",");

function normalizeResult(
  result: Partial<SearchResult>,
): SearchResult {
  return {
    id: Number(result.id ?? 0),
    chunk_id: result.chunk_id ?? "",
    title:
      result.title ??
      "Untitled document",
    content: result.content ?? "",
    source_file:
      result.source_file ?? "",
    file_type:
      result.file_type ?? "docx",
    section: result.section ?? "",
    page_number:
      result.page_number ?? null,
    slide_number:
      result.slide_number ?? null,
    image_paths: Array.isArray(
      result.image_paths,
    )
      ? result.image_paths
      : [],
    should_display_image: Boolean(
      result.should_display_image,
    ),
    metadata:
      result.metadata &&
      typeof result.metadata ===
        "object"
        ? result.metadata
        : {},
    similarity: Number(
      result.similarity ?? 1,
    ),
  };
}

function createDeduplicationKey(
  result: SearchResult,
): string {
  return result.content
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function removeDuplicateResults(
  results: SearchResult[],
  limit: number,
): SearchResult[] {
  const seenContent =
    new Set<string>();

  const uniqueResults: SearchResult[] =
    [];

  for (const result of results) {
    const key =
      createDeduplicationKey(result);

    if (!key) {
      continue;
    }

    if (seenContent.has(key)) {
      continue;
    }

    seenContent.add(key);
    uniqueResults.push(result);

    if (
      uniqueResults.length >= limit
    ) {
      break;
    }
  }

  return uniqueResults;
}

export function extractStepNumber(
  text: string,
): number | null {
  const match = text.match(
    /\bstep\s*#?\s*(\d{1,2})\b/i,
  );

  if (!match) {
    return null;
  }

  const stepNumber = Number(
    match[1],
  );

  if (
    !Number.isInteger(stepNumber)
  ) {
    return null;
  }

  return stepNumber;
}

/*
 * Numbered micro:bit build steps should not rely on
 * semantic vector similarity.
 *
 * This directly fetches the approved build-guide pages
 * and orders them by their actual step numbers.
 */
export async function searchBuildSteps(): Promise<
  SearchResult[]
> {
  const {
    data,
    error,
  } = await supabaseAdmin
    .from("documents")
    .select(DOCUMENT_COLUMNS)
    .ilike(
      "source_file",
      "%BotsBuildFeb2026.pdf%",
    )
    .ilike(
      "title",
      "Step %",
    )
    .order(
      "page_number",
      {
        ascending: true,
        nullsFirst: false,
      },
    );

  if (error) {
    throw new Error(
      `Build-step search failed: ${error.message}`,
    );
  }

  if (!Array.isArray(data)) {
    return [];
  }

  const normalizedResults =
    data
      .map((result) =>
        normalizeResult(
          result as Partial<SearchResult>,
        ),
      )
      .filter(
        (result) =>
          extractStepNumber(
            result.title,
          ) !== null,
      );

  normalizedResults.sort(
    (first, second) => {
      const firstStep =
        extractStepNumber(
          first.title,
        ) ?? Number.MAX_SAFE_INTEGER;

      const secondStep =
        extractStepNumber(
          second.title,
        ) ?? Number.MAX_SAFE_INTEGER;

      return firstStep - secondStep;
    },
  );

  /*
   * Keep only one approved chunk per step.
   */
  const resultsByStep =
    new Map<number, SearchResult>();

  for (
    const result
    of normalizedResults
  ) {
    const stepNumber =
      extractStepNumber(
        result.title,
      );

    if (
      stepNumber === null ||
      resultsByStep.has(
        stepNumber,
      )
    ) {
      continue;
    }

    resultsByStep.set(
      stepNumber,
      result,
    );
  }

  return Array.from(
    resultsByStep.values(),
  );
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

  const queryEmbedding =
    await createQueryEmbedding(
      normalizedQuestion,
    );

  const candidateCount = Math.min(
    Math.max(
      matchCount * 4,
      12,
    ),
    50,
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
    data.map(
      (
        result: Partial<SearchResult>,
      ) => normalizeResult(result),
    );

  return removeDuplicateResults(
    normalizedResults,
    matchCount,
  );
}