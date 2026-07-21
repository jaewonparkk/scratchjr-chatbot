import path from "node:path";

import {
  searchDocuments,
  type SearchResult,
} from "@/lib/rag/search";

import {
  generateGroundedAnswer,
  generateGroundedBuildGuide,
  generateGroundedStepAnswer,
} from "@/lib/rag/gemini";

import {
  supabaseAdmin,
} from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BUILD_SOURCE_PATTERN =
  "%BotsBuildFeb2026.pdf%";

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

type ChatRequestBody = {
  question?: unknown;
  message?: unknown;
};

type ChatSource = {
  chunkId: string;
  title: string;
  file: string;
  page: number | null;
  slide: number | null;
  section: string;
  similarity: number;
};

type ChatImage = {
  url: string;
  path: string;
  caption: string;
  sourceFile: string;
  page: number | null;
  slide: number | null;
};

function readQuestion(
  body: ChatRequestBody,
): string {
  if (
    typeof body.question ===
      "string" &&
    body.question.trim()
  ) {
    return body.question.trim();
  }

  if (
    typeof body.message ===
      "string" &&
    body.message.trim()
  ) {
    return body.message.trim();
  }

  return "";
}

function normalizeQuestion(
  question: string,
): string {
  return question
    .toLowerCase()
    .replace(
      /\bmicro\s*:\s*bit\b/g,
      "microbit",
    )
    .replace(
      /\bmicro\s+bit\b/g,
      "microbit",
    )
    .replace(
      /\bsteop\b/g,
      "step",
    )
    .replace(/\s+/g, " ")
    .trim();
}

function extractStepNumber(
  text: string,
): number | null {
  const normalized =
    normalizeQuestion(text);

  const match =
    normalized.match(
      /\bstep\s*#?\s*(\d{1,2})\b/,
    );

  if (!match) {
    return null;
  }

  const stepNumber =
    Number(match[1]);

  if (
    !Number.isInteger(
      stepNumber,
    ) ||
    stepNumber < 1
  ) {
    return null;
  }

  return stepNumber;
}

function normalizeSearchResult(
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
      result.file_type ?? "docx",

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

async function searchBuildSteps(): Promise<
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
      BUILD_SOURCE_PATTERN,
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

  const results =
    data
      .map((item) =>
        normalizeSearchResult(
          item as Partial<SearchResult>,
        ),
      )
      .filter(
        (result) =>
          extractStepNumber(
            result.title,
          ) !== null,
      );

  results.sort(
    (first, second) => {
      const firstNumber =
        extractStepNumber(
          first.title,
        ) ??
        Number.MAX_SAFE_INTEGER;

      const secondNumber =
        extractStepNumber(
          second.title,
        ) ??
        Number.MAX_SAFE_INTEGER;

      return (
        firstNumber -
        secondNumber
      );
    },
  );

  const uniqueByStep =
    new Map<number, SearchResult>();

  for (const result of results) {
    const stepNumber =
      extractStepNumber(
        result.title,
      );

    if (
      stepNumber === null ||
      uniqueByStep.has(
        stepNumber,
      )
    ) {
      continue;
    }

    uniqueByStep.set(
      stepNumber,
      result,
    );
  }

  return Array.from(
    uniqueByStep.values(),
  );
}

function isMicrobitBuildQuestion(
  question: string,
): boolean {
  const normalized =
    normalizeQuestion(question);

  const mentionsMicrobit =
    normalized.includes(
      "microbit",
    );

  const mentionsBuild =
    /\b(build|building|assemble|assembly|circuit|breadboard|wire|wiring|step)\b/.test(
      normalized,
    );

  return (
    mentionsMicrobit &&
    mentionsBuild
  );
}

function isFullBuildGuideRequest(
  question: string,
): boolean {
  const normalized =
    normalizeQuestion(question);

  if (
    extractStepNumber(
      normalized,
    ) !== null
  ) {
    return false;
  }

  if (
    !isMicrobitBuildQuestion(
      normalized,
    )
  ) {
    return false;
  }

  return (
    /\bstep[\s-]*by[\s-]*step\b/.test(
      normalized,
    ) ||
    /\ball steps\b/.test(
      normalized,
    ) ||
    /\bevery step\b/.test(
      normalized,
    ) ||
    /\bhow\b.*\bbuild\b/.test(
      normalized,
    ) ||
    /\bbuild\b.*\bmicrobit\b/.test(
      normalized,
    ) ||
    /\bbuilding\b.*\bmicrobit\b/.test(
      normalized,
    )
  );
}

function isImageRequest(
  question: string,
): boolean {
  const normalized =
    normalizeQuestion(question);

  return (
    /\b(image|images|picture|pictures|photo|photos|preview|visual|visuals)\b/.test(
      normalized,
    ) ||
    /\blook like\b/.test(
      normalized,
    ) ||
    /\blooks like\b/.test(
      normalized,
    ) ||
    /\bshow me\b/.test(
      normalized,
    ) ||
    /\blet me see\b/.test(
      normalized,
    ) ||
    /\bwant to see\b/.test(
      normalized,
    )
  );
}

function isBuildImageSequenceRequest(
  question: string,
): boolean {
  const normalized =
    normalizeQuestion(question);

  const asksForImages =
    /\b(image|images|picture|pictures|photo|photos|visual|visuals)\b/.test(
      normalized,
    );

  const asksForSequence =
    /\bto (the )?end\b/.test(
      normalized,
    ) ||
    /\ball steps\b/.test(
      normalized,
    ) ||
    /\bevery step\b/.test(
      normalized,
    ) ||
    /\bstep[\s-]*by[\s-]*step\b/.test(
      normalized,
    ) ||
    /\bfrom (the )?(start|beginning)\b/.test(
      normalized,
    );

  return (
    asksForImages &&
    asksForSequence
  );
}

function requestedImageStartStep(
  question: string,
): number {
  const normalized =
    normalizeQuestion(question);

  const numberedMatch =
    normalized.match(
      /\bfrom\s+step\s*(\d{1,2})\s+to\s+(?:the\s+)?end\b/,
    );

  if (numberedMatch) {
    return Number(
      numberedMatch[1],
    );
  }

  return 1;
}

function getSearchableText(
  result: SearchResult,
): string {
  return [
    result.title,
    result.section,
    result.content,
    result.source_file,
  ]
    .join(" ")
    .toLowerCase();
}

function scoreImageResult(
  result: SearchResult,
  question: string,
): number {
  let score =
    result.similarity;

  const normalizedQuestion =
    normalizeQuestion(question);

  const searchableText =
    getSearchableText(result);

  if (
    result.file_type ===
    "image"
  ) {
    score += 0.2;
  }

  if (
    result.should_display_image &&
    result.image_paths.length > 0
  ) {
    score += 0.05;
  }

  const keywords =
    normalizedQuestion
      .replace(
        /[^\p{L}\p{N}]+/gu,
        " ",
      )
      .split(/\s+/)
      .filter(
        (word) =>
          word.length >= 4,
      );

  for (const keyword of keywords) {
    if (
      searchableText.includes(
        keyword,
      )
    ) {
      score += 0.025;
    }
  }

  if (
    normalizedQuestion.includes(
      "final",
    ) &&
    searchableText.includes(
      "final",
    )
  ) {
    score += 0.2;
  }

  if (
    normalizedQuestion.includes(
      "palette",
    ) &&
    searchableText.includes(
      "palette",
    )
  ) {
    score += 0.2;
  }

  if (
    normalizedQuestion.includes(
      "virtue",
    ) &&
    searchableText.includes(
      "virtue",
    )
  ) {
    score += 0.15;
  }

  return score;
}

function chooseImageResults(
  results: SearchResult[],
  question: string,
  limit = 2,
): SearchResult[] {
  return [...results]
    .filter(
      (result) =>
        result.should_display_image &&
        result.image_paths.length > 0,
    )
    .sort(
      (first, second) =>
        scoreImageResult(
          second,
          question,
        ) -
        scoreImageResult(
          first,
          question,
        ),
    )
    .slice(0, limit);
}

function chooseTextContextResults(
  results: SearchResult[],
): SearchResult[] {
  if (
    results.length === 0
  ) {
    return [];
  }

  const highestSimilarity =
    results[0].similarity;

  const cutoff =
    Math.max(
      0.45,
      highestSimilarity - 0.07,
    );

  return results
    .filter(
      (result) =>
        result.similarity >=
        cutoff,
    )
    .slice(0, 5);
}

function buildContext(
  results: SearchResult[],
): string {
  return results
    .map(
      (result, index) => {
        const location =
          result.page_number !==
          null
            ? `Page ${result.page_number}`
            : result.slide_number !==
                null
              ? `Slide ${result.slide_number}`
              : "Document";

        return [
          `[CONTEXT ${index + 1}]`,
          `Title: ${result.title}`,
          `Source: ${path.basename(
            result.source_file,
          )}`,
          `Location: ${location}`,
          `Section: ${result.section}`,
          "Content:",
          result.content,
        ].join("\n");
      },
    )
    .join(
      "\n\n--------------------\n\n",
    );
}

function buildSources(
  results: SearchResult[],
): ChatSource[] {
  const seen =
    new Set<string>();

  const sources:
    ChatSource[] = [];

  for (const result of results) {
    const key = [
      result.chunk_id,
      result.source_file,
      result.page_number,
      result.slide_number,
    ].join("|");

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);

    sources.push({
      chunkId:
        result.chunk_id,

      title:
        result.title,

      file:
        path.basename(
          result.source_file,
        ),

      page:
        result.page_number,

      slide:
        result.slide_number,

      section:
        result.section,

      similarity:
        result.similarity,
    });
  }

  return sources;
}

function buildImages(
  results: SearchResult[],
  maxImages = 2,
): ChatImage[] {
  const seenPaths =
    new Set<string>();

  const images:
    ChatImage[] = [];

  for (const result of results) {
    if (
      !result.should_display_image ||
      result.image_paths.length === 0
    ) {
      continue;
    }

    const imagePath =
      result.image_paths[0];

    if (
      !imagePath ||
      seenPaths.has(imagePath)
    ) {
      continue;
    }

    seenPaths.add(imagePath);

    const sourceFile =
      path.basename(
        result.source_file,
      );

    const location =
      result.page_number !== null
        ? `page ${result.page_number}`
        : result.slide_number !== null
          ? `slide ${result.slide_number}`
          : "document";

    images.push({
      url:
        `/api/source-image?path=${encodeURIComponent(
          imagePath,
        )}`,

      path:
        imagePath,

      caption:
        `${result.title} — ${sourceFile}, ${location}`,

      sourceFile,

      page:
        result.page_number,

      slide:
        result.slide_number,
    });

    if (
      images.length >=
      maxImages
    ) {
      break;
    }
  }

  return images;
}

function insufficientAnswer(): string {
  return "I could not find enough verified information in the approved materials to answer that question.";
}

function missingImageAnswer(): string {
  return "I found related approved information, but I could not find an approved image to display.";
}

export async function POST(
  request: Request,
) {
  try {
    const body =
      (await request.json()) as
        ChatRequestBody;

    const question =
      readQuestion(body);

    if (!question) {
      return Response.json(
        {
          error:
            "question or message must be a non-empty string.",
        },
        {
          status: 400,
        },
      );
    }

    const requestedStep =
      extractStepNumber(
        question,
      );

    /*
     * Exact numbered build step.
     */
    if (
      requestedStep !== null &&
      (
        isMicrobitBuildQuestion(
          question,
        ) ||
        isImageRequest(
          question,
        )
      )
    ) {
      const buildSteps =
        await searchBuildSteps();

      const exactStep =
        buildSteps.find(
          (step) =>
            extractStepNumber(
              step.title,
            ) ===
            requestedStep,
        );

      if (!exactStep) {
        const answer =
          `I could not find Step ${requestedStep} in the approved micro:bit build guide.`;

        return Response.json({
          answer,
          reply: answer,
          grounded: false,
          sources: [],
          images: [],
        });
      }

      const answer =
        await generateGroundedStepAnswer({
          question,

          title:
            exactStep.title,

          context:
            buildContext([
              exactStep,
            ]),

          imagePath:
            exactStep.image_paths[0] ??
            null,
        });

      return Response.json({
        answer,
        reply: answer,
        grounded: true,

        sources:
          buildSources([
            exactStep,
          ]),

        images:
          buildImages(
            [exactStep],
            1,
          ),
      });
    }

    /*
     * Request for build images from a step through the end.
     */
    if (
      isBuildImageSequenceRequest(
        question,
      )
    ) {
      const buildSteps =
        await searchBuildSteps();

      const startStep =
        requestedImageStartStep(
          question,
        );

      const selectedSteps =
        buildSteps.filter(
          (step) => {
            const stepNumber =
              extractStepNumber(
                step.title,
              );

            return (
              stepNumber !== null &&
              stepNumber >=
                startStep
            );
          },
        );

      const images =
        buildImages(
          selectedSteps,
          selectedSteps.length,
        );

      if (
        selectedSteps.length === 0 ||
        images.length === 0
      ) {
        const answer =
          missingImageAnswer();

        return Response.json({
          answer,
          reply: answer,
          grounded: false,
          sources: [],
          images: [],
        });
      }

      const firstNumber =
        extractStepNumber(
          selectedSteps[0].title,
        );

      const finalNumber =
        extractStepNumber(
          selectedSteps[
            selectedSteps.length - 1
          ].title,
        );

      const answer =
        `Here are the approved build images from Step ${firstNumber} through Step ${finalNumber}.`;

      return Response.json({
        answer,
        reply: answer,
        grounded: true,

        sources:
          buildSources(
            selectedSteps,
          ),

        images,
      });
    }

    /*
     * Complete build-guide explanation.
     */
    if (
      isFullBuildGuideRequest(
        question,
      )
    ) {
      const buildSteps =
        await searchBuildSteps();

      if (
        buildSteps.length === 0
      ) {
        const answer =
          insufficientAnswer();

        return Response.json({
          answer,
          reply: answer,
          grounded: false,
          sources: [],
          images: [],
        });
      }

      const answer =
        await generateGroundedBuildGuide({
          question,

          steps:
            buildSteps.map(
              (step) => ({
                title:
                  step.title,

                content:
                  step.content,

                imagePath:
                  step.image_paths[0] ??
                  null,
              }),
            ),
        });

      return Response.json({
        answer,
        reply: answer,
        grounded: true,

        sources:
          buildSources(
            buildSteps,
          ),

        images:
          buildImages(
            buildSteps,
            buildSteps.length,
          ),
      });
    }

    /*
     * General RAG search.
     */
    const imageRequest =
      isImageRequest(
        question,
      );

    const searchResults =
      await searchDocuments(
        question,
        {
          matchCount: 20,

          matchThreshold:
            imageRequest
              ? 0.2
              : 0.3,
        },
      );

    /*
     * General direct image request.
     */
    if (imageRequest) {
      const imageResults =
        chooseImageResults(
          searchResults,
          question,
          2,
        );

      const images =
        buildImages(
          imageResults,
          2,
        );

      if (
        images.length === 0
      ) {
        const answer =
          missingImageAnswer();

        return Response.json({
          answer,
          reply: answer,
          grounded: false,
          sources: [],
          images: [],
        });
      }

      const answer =
        images.length === 1
          ? "Here is the approved reference image from the curriculum materials."
          : "Here are the approved reference images from the curriculum materials.";

      return Response.json({
        answer,
        reply: answer,
        grounded: true,

        sources:
          buildSources(
            imageResults,
          ),

        images,
      });
    }

    /*
     * General text answer using retrieved context.
     */
    const contextResults =
      chooseTextContextResults(
        searchResults,
      );

    if (
      contextResults.length === 0
    ) {
      const answer =
        insufficientAnswer();

      return Response.json({
        answer,
        reply: answer,
        grounded: false,
        sources: [],
        images: [],
      });
    }

    const answer =
      await generateGroundedAnswer({
        question,

        context:
          buildContext(
            contextResults,
          ),
      });

    return Response.json({
      answer,
      reply: answer,
      grounded: true,

      sources:
        buildSources(
          contextResults,
        ),

      images:
        buildImages(
          contextResults,
          2,
        ),
    });
  } catch (error: unknown) {
    console.error(
      "Chat request failed:",
      error,
    );

    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "The chat request failed.",
      },
      {
        status: 500,
      },
    );
  }

  
}