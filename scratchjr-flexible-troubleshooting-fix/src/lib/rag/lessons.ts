import "server-only";

import type {
  SearchResult,
} from "@/lib/rag/search";

import {
  supabaseAdmin,
} from "@/lib/supabase/admin";

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

const PRIMARY_LESSON_PATTERNS = [
  "%Lessons_01-36_REVISED.docx%",
];

const SUPPLEMENT_PATTERNS = [
  "%Lesson_Supplements%",
  "%Lesson Supplements%",
  "%Lesson%Supplement%ScratchJr%Blocks%Bots%",
];

const JOURNAL_PATTERNS = [
  "%Journal%",
];

export type LessonBundle = {
  lessonNumber: number;
  primary: SearchResult[];
  supplements: SearchResult[];
  journal: SearchResult[];
  all: SearchResult[];
  visualResults: SearchResult[];
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

  return "docx";
}

function normalizeResult(
  result: Partial<SearchResult>,
): SearchResult {
  return {
    id:
      Number(result.id ?? 0),

    chunk_id:
      result.chunk_id ?? "",

    title:
      result.title ??
      "Untitled document",

    content:
      result.content ?? "",

    source_file:
      result.source_file ?? "",

    file_type:
      normalizeFileType(
        result.file_type,
      ),

    section:
      result.section ?? "",

    page_number:
      result.page_number ?? null,

    slide_number:
      result.slide_number ?? null,

    image_paths:
      Array.isArray(
        result.image_paths,
      )
        ? result.image_paths
        : [],

    should_display_image:
      Boolean(
        result.should_display_image,
      ),

    metadata:
      result.metadata &&
      typeof result.metadata ===
        "object"
        ? result.metadata
        : {},

    similarity:
      Number(
        result.similarity ?? 1,
      ),
  };
}

function readPositiveInteger(
  value: unknown,
): number | null {
  if (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1
  ) {
    return value;
  }

  if (
    typeof value === "string"
  ) {
    const match =
      value.match(/\d{1,3}/);

    if (match) {
      const number =
        Number(match[0]);

      if (
        Number.isInteger(number) &&
        number >= 1
      ) {
        return number;
      }
    }
  }

  return null;
}

function extractLessonNumber(
  text: string,
): number | null {
  const match =
    text.match(
      /\blesson\s*#?\s*(\d{1,3})\b/i,
    );

  if (!match) {
    return null;
  }

  return readPositiveInteger(
    match[1],
  );
}

function getMetadataLessonNumber(
  metadata: Record<string, unknown>,
): number | null {
  const keys = [
    "lesson_number",
    "lessonNumber",
    "lesson",
    "unit_number",
    "unitNumber",
  ];

  for (const key of keys) {
    const number =
      readPositiveInteger(
        metadata[key],
      );

    if (number !== null) {
      return number;
    }
  }

  return null;
}

function getStructuralLessonNumber(
  result: SearchResult,
): number | null {
  const metadataLesson =
    getMetadataLessonNumber(
      result.metadata,
    );

  if (metadataLesson !== null) {
    return metadataLesson;
  }

  const headingLesson =
    extractLessonNumber(
      [
        result.title,
        result.section,
      ].join(" "),
    );

  if (headingLesson !== null) {
    return headingLesson;
  }

  /*
   * Some PPTX slides place the lesson marker in
   * the opening slide text rather than the title.
   */
  return extractLessonNumber(
    result.content
      .trim()
      .slice(0, 260),
  );
}

function resultOrder(
  result: SearchResult,
): number {
  if (
    result.slide_number !== null
  ) {
    return result.slide_number;
  }

  if (
    result.page_number !== null
  ) {
    return result.page_number;
  }

  return result.id;
}

function deduplicate(
  results: SearchResult[],
): SearchResult[] {
  const seen =
    new Set<string>();

  const unique:
    SearchResult[] = [];

  for (const result of results) {
    const key =
      result.chunk_id ||
      [
        result.source_file,
        result.page_number,
        result.slide_number,
        result.title,
        result.section,
      ].join("|");

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(result);
  }

  return unique;
}

function trimContentToLesson(
  content: string,
  lessonNumber: number,
): string {
  const markerPattern =
    /\blesson\s*#?\s*(\d{1,3})\b/gi;

  const matches =
    Array.from(
      content.matchAll(
        markerPattern,
      ),
    );

  if (matches.length === 0) {
    return content;
  }

  const requestedIndex =
    matches.findIndex(
      (match) =>
        Number(match[1]) ===
        lessonNumber,
    );

  if (requestedIndex < 0) {
    return content;
  }

  const start =
    matches[requestedIndex]
      .index ?? 0;

  let end =
    content.length;

  for (
    let index =
      requestedIndex + 1;
    index < matches.length;
    index += 1
  ) {
    const nextNumber =
      Number(
        matches[index][1],
      );

    if (
      nextNumber !==
      lessonNumber
    ) {
      end =
        matches[index].index ??
        content.length;
      break;
    }
  }

  return content
    .slice(start, end)
    .trim();
}

function trimResultToLesson(
  result: SearchResult,
  lessonNumber: number,
): SearchResult {
  return {
    ...result,
    content:
      trimContentToLesson(
        result.content,
        lessonNumber,
      ),
  };
}

async function fetchPattern(
  sourcePattern: string,
): Promise<SearchResult[]> {
  const {
    data,
    error,
  } = await supabaseAdmin
    .from("documents")
    .select(
      DOCUMENT_COLUMNS,
    )
    .ilike(
      "source_file",
      sourcePattern,
    )
    .order(
      "id",
      {
        ascending: true,
      },
    )
    .limit(1000);

  if (error) {
    throw new Error(
      `Lesson material search failed: ${error.message}`,
    );
  }

  if (!Array.isArray(data)) {
    return [];
  }

  return data.map(
    (item) =>
      normalizeResult(
        item as Partial<SearchResult>,
      ),
  );
}

async function fetchPatterns(
  patterns: string[],
): Promise<SearchResult[]> {
  const responses =
    await Promise.all(
      patterns.map(
        fetchPattern,
      ),
    );

  return deduplicate(
    responses.flat(),
  );
}

function selectLessonSegment(
  results: SearchResult[],
  lessonNumber: number,
): SearchResult[] {
  const groupedByFile =
    new Map<
      string,
      SearchResult[]
    >();

  for (const result of results) {
    const existing =
      groupedByFile.get(
        result.source_file,
      ) ?? [];

    existing.push(result);

    groupedByFile.set(
      result.source_file,
      existing,
    );
  }

  const selected:
    SearchResult[] = [];

  for (
    const fileResults
    of groupedByFile.values()
  ) {
    const sorted =
      [...fileResults].sort(
        (first, second) =>
          resultOrder(first) -
          resultOrder(second),
      );

    const hasMarkers =
      sorted.some(
        (result) =>
          getStructuralLessonNumber(
            result,
          ) !== null,
      );

    if (!hasMarkers) {
      /*
       * Last-resort fallback for files whose extractor
       * did not preserve slide headings.
       */
      for (const result of sorted) {
        const combinedText = [
          result.title,
          result.section,
          result.content,
        ].join(" ");

        if (
          extractLessonNumber(
            combinedText,
          ) === lessonNumber
        ) {
          selected.push(
            trimResultToLesson(
              result,
              lessonNumber,
            ),
          );
        }
      }

      continue;
    }

    let insideRequestedLesson =
      false;

    for (const result of sorted) {
      const marker =
        getStructuralLessonNumber(
          result,
        );

      if (marker !== null) {
        if (
          marker ===
          lessonNumber
        ) {
          insideRequestedLesson =
            true;
        } else if (
          insideRequestedLesson
        ) {
          break;
        } else {
          insideRequestedLesson =
            false;
        }
      }

      if (
        insideRequestedLesson
      ) {
        selected.push(
          trimResultToLesson(
            result,
            lessonNumber,
          ),
        );
      }
    }
  }

  return deduplicate(
    selected,
  );
}

export async function searchLessonBundle(
  lessonNumber: number,
): Promise<LessonBundle> {
  const [
    primaryDocuments,
    supplementDocuments,
    journalDocuments,
  ] =
    await Promise.all([
      fetchPatterns(
        PRIMARY_LESSON_PATTERNS,
      ),

      fetchPatterns(
        SUPPLEMENT_PATTERNS,
      ),

      fetchPatterns(
        JOURNAL_PATTERNS,
      ),
    ]);

  const primary =
    selectLessonSegment(
      primaryDocuments,
      lessonNumber,
    );

  const supplements =
    selectLessonSegment(
      supplementDocuments,
      lessonNumber,
    );

  const journal =
    selectLessonSegment(
      journalDocuments,
      lessonNumber,
    );

  const all =
    deduplicate([
      ...primary,
      ...supplements,
      ...journal,
    ]);

  /*
   * Exact Lesson responses automatically display only
   * visuals that belong to that Lesson's supplement or
   * journal segment. Main-document images stay hidden.
   */
  const visualResults =
    deduplicate([
      ...supplements,
      ...journal,
    ]).filter(
      (result) =>
        result.should_display_image &&
        result.image_paths.length >
          0,
    );

  return {
    lessonNumber,
    primary,
    supplements,
    journal,
    all,
    visualResults,
  };
}
