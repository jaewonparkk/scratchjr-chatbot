import path from "node:path";

import {
  searchDocuments,
  type SearchResult,
} from "@/lib/rag/search";

import {
  GEMINI_MODEL_NAME,
  generateGroundedAnswer,
  generateGroundedBuildGuide,
  generateGroundedStepAnswer,
  type ChatHistoryMessage,
} from "@/lib/rag/gemini";

import {
  supabaseAdmin,
} from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BUILD_SOURCE_PATTERN =
  "%BotsBuildFeb2026.pdf%";

const DOWNLOAD_SOURCE_PATTERN =
  "%Blocks and Bots Download Instructions.pptx%";

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

type ConversationTopic =
  | "microbit-build"
  | "download-instructions"
  | "pairing"
  | "lesson"
  | null;

type ChatRequestBody = {
  question?: unknown;
  message?: unknown;
  history?: unknown;
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

type GenerationInfo = {
  provider:
    | "gemini"
    | "approved-materials"
    | "router";
  model: string | null;
  grounded: boolean;
};

function geminiGeneration(): GenerationInfo {
  return {
    provider: "gemini",
    model:
      GEMINI_MODEL_NAME,
    grounded: true,
  };
}

function approvedGeneration(): GenerationInfo {
  return {
    provider:
      "approved-materials",
    model: null,
    grounded: true,
  };
}

function routerGeneration(): GenerationInfo {
  return {
    provider: "router",
    model: null,
    grounded: false,
  };
}

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

function readHistory(
  value: unknown,
): ChatHistoryMessage[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const history:
    ChatHistoryMessage[] = [];

  for (
    const item
    of value.slice(-16)
  ) {
    if (
      !item ||
      typeof item !== "object"
    ) {
      continue;
    }

    const record =
      item as Record<
        string,
        unknown
      >;

    const role =
      record.role;

    const rawContent =
      typeof record.content ===
        "string"
        ? record.content
        : typeof record.text ===
            "string"
          ? record.text
          : "";

    if (
      (
        role !== "user" &&
        role !== "assistant"
      ) ||
      !rawContent.trim()
    ) {
      continue;
    }

    history.push({
      role,
      content:
        rawContent
          .trim()
          .slice(0, 5000),
    });
  }

  return history.slice(-12);
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

function extractStepNumbers(
  text: string,
): number[] {
  const normalized =
    normalizeQuestion(text);

  const matches =
    normalized.matchAll(
      /\bstep\s*#?\s*(\d{1,2})\b/g,
    );

  const numbers =
    new Set<number>();

  for (const match of matches) {
    const number =
      Number(match[1]);

    if (
      Number.isInteger(number) &&
      number >= 1
    ) {
      numbers.add(number);
    }
  }

  return Array.from(numbers);
}

function extractStepNumber(
  text: string,
): number | null {
  const numbers =
    extractStepNumbers(text);

  return numbers[0] ?? null;
}

function detectTopicInText(
  text: string,
): ConversationTopic {
  const normalized =
    normalizeQuestion(text);

  if (
    /\b(download|install|installation|home screen|apps screen|qr code)\b/.test(
      normalized,
    )
  ) {
    return "download-instructions";
  }

  if (
    /\b(pair|pairing|choose your microbit name)\b/.test(
      normalized,
    )
  ) {
    return "pairing";
  }

  const containsBuildPart =
    /\b(led|leds|breadboard|alligator|gnd|motor|battery pack|plug\/socket|socket\/socket)\b/.test(
      normalized,
    );

  const mentionsBuild =
    /\b(build|building|assemble|assembly|circuit|breadboard|wiring|step)\b/.test(
      normalized,
    );

  if (
    containsBuildPart ||
    (
      normalized.includes(
        "microbit",
      ) &&
      mentionsBuild
    )
  ) {
    return "microbit-build";
  }

  if (
    /\b(lesson|curriculum|tech circle|classroom activity)\b/.test(
      normalized,
    )
  ) {
    return "lesson";
  }

  return null;
}

function detectHistoryTopic(
  history: ChatHistoryMessage[],
): ConversationTopic {
  for (
    let index =
      history.length - 1;
    index >= 0;
    index -= 1
  ) {
    const topic =
      detectTopicInText(
        history[index].content,
      );

    if (topic) {
      return topic;
    }
  }

  return null;
}

function findLastReferencedStep(
  history: ChatHistoryMessage[],
): number | null {
  /*
   * Prefer the most recent user message.
   */
  for (
    let index =
      history.length - 1;
    index >= 0;
    index -= 1
  ) {
    const message =
      history[index];

    if (
      message.role !== "user"
    ) {
      continue;
    }

    const numbers =
      extractStepNumbers(
        message.content,
      );

    if (numbers.length === 1) {
      return numbers[0];
    }
  }

  /*
   * Use an assistant answer only when it references
   * exactly one numbered step.
   */
  for (
    let index =
      history.length - 1;
    index >= 0;
    index -= 1
  ) {
    const message =
      history[index];

    if (
      message.role !==
      "assistant"
    ) {
      continue;
    }

    const numbers =
      extractStepNumbers(
        message.content,
      );

    if (numbers.length === 1) {
      return numbers[0];
    }
  }

  return null;
}

function resolveRequestedStep(
  question: string,
  history: ChatHistoryMessage[],
): number | null {
  const explicitStep =
    extractStepNumber(
      question,
    );

  if (explicitStep !== null) {
    return explicitStep;
  }

  const normalized =
    normalizeQuestion(question);

  const previousStep =
    findLastReferencedStep(
      history,
    );

  if (previousStep === null) {
    return null;
  }

  if (
    /\b(next|following)\b/.test(
      normalized,
    )
  ) {
    return previousStep + 1;
  }

  if (
    /\b(previous|prior|before that)\b/.test(
      normalized,
    )
  ) {
    return Math.max(
      1,
      previousStep - 1,
    );
  }

  if (
    /\b(this|that|same)\b/.test(
      normalized,
    ) &&
    /\b(image|picture|photo|step)\b/.test(
      normalized,
    )
  ) {
    return previousStep;
  }

  return null;
}

function isStepFollowUp(
  question: string,
): boolean {
  const normalized =
    normalizeQuestion(question);

  return (
    extractStepNumber(
      normalized,
    ) !== null ||
    /\b(next|following|previous|prior)\b/.test(
      normalized,
    ) ||
    /\b(this|that|same)\s+(step|image|picture)\b/.test(
      normalized,
    )
  );
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

function sortAndDeduplicateSteps(
  results: SearchResult[],
): SearchResult[] {
  const sorted =
    [...results].sort(
      (first, second) => {
        const firstStep =
          extractStepNumber(
            [
              first.title,
              first.section,
            ].join(" "),
          ) ??
          Number.MAX_SAFE_INTEGER;

        const secondStep =
          extractStepNumber(
            [
              second.title,
              second.section,
            ].join(" "),
          ) ??
          Number.MAX_SAFE_INTEGER;

        return firstStep -
          secondStep;
      },
    );

  const unique =
    new Map<
      number,
      SearchResult
    >();

  for (const result of sorted) {
    const stepNumber =
      extractStepNumber(
        [
          result.title,
          result.section,
          result.content,
        ].join(" "),
      );

    if (
      stepNumber === null ||
      unique.has(stepNumber)
    ) {
      continue;
    }

    unique.set(
      stepNumber,
      result,
    );
  }

  return Array.from(
    unique.values(),
  );
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

  return sortAndDeduplicateSteps(
    data.map((item) =>
      normalizeSearchResult(
        item as Partial<SearchResult>,
      ),
    ),
  );
}

async function searchDownloadSteps(): Promise<
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
      DOWNLOAD_SOURCE_PATTERN,
    )
    .order(
      "slide_number",
      {
        ascending: true,
        nullsFirst: false,
      },
    );

  if (error) {
    throw new Error(
      `Download-step search failed: ${error.message}`,
    );
  }

  if (!Array.isArray(data)) {
    return [];
  }

  return sortAndDeduplicateSteps(
    data.map((item) =>
      normalizeSearchResult(
        item as Partial<SearchResult>,
      ),
    ),
  );
}

function isFullBuildGuideRequest(
  question: string,
  topic: ConversationTopic,
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
    topic !==
    "microbit-build"
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
    /\ball of them\b/.test(
      normalized,
    ) ||
    /\bhow\b.*\bbuild\b/.test(
      normalized,
    ) ||
    /\bbuilding\b.*\bmicrobit\b/.test(
      normalized,
    )
  );
}

function asksForImageSequence(
  question: string,
): boolean {
  const normalized =
    normalizeQuestion(question);

  const asksForImages =
    /\b(image|images|picture|pictures|photo|photos|visual|visuals)\b/.test(
      normalized,
    );

  const asksForRange =
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
    asksForRange
  );
}

function requestedImageStartStep(
  question: string,
): number {
  const normalized =
    normalizeQuestion(question);

  const match =
    normalized.match(
      /\bfrom\s+step\s*(\d{1,2})\b/,
    );

  if (match) {
    return Number(
      match[1],
    );
  }

  return 1;
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

function chooseTextContextResults(
  results: SearchResult[],
): SearchResult[] {
  if (results.length === 0) {
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

function chooseImageResults(
  results: SearchResult[],
  question: string,
  limit = 2,
): SearchResult[] {
  const normalized =
    normalizeQuestion(question);

  return [...results]
    .filter(
      (result) =>
        result.should_display_image &&
        result.image_paths.length > 0,
    )
    .sort(
      (first, second) => {
        const firstText =
          getSearchableText(first);

        const secondText =
          getSearchableText(second);

        let firstScore =
          first.similarity;

        let secondScore =
          second.similarity;

        for (
          const keyword
          of normalized.split(/\s+/)
        ) {
          if (
            keyword.length >= 4 &&
            firstText.includes(
              keyword,
            )
          ) {
            firstScore += 0.04;
          }

          if (
            keyword.length >= 4 &&
            secondText.includes(
              keyword,
            )
          ) {
            secondScore += 0.04;
          }
        }

        if (
          first.file_type ===
          "image"
        ) {
          firstScore += 0.2;
        }

        if (
          second.file_type ===
          "image"
        ) {
          secondScore += 0.2;
        }

        return (
          secondScore -
          firstScore
        );
      },
    )
    .slice(0, limit);
}

function enrichQuestionWithTopic(
  question: string,
  topic: ConversationTopic,
): string {
  if (
    topic ===
    "microbit-build"
  ) {
    return `${question}\nConversation topic: micro:bit building guide.`;
  }

  if (
    topic ===
    "download-instructions"
  ) {
    return `${question}\nConversation topic: Blocks and Bots download instructions.`;
  }

  if (topic === "pairing") {
    return `${question}\nConversation topic: pairing the micro:bit with the Blocks and Bots app.`;
  }

  if (topic === "lesson") {
    return `${question}\nConversation topic: Blocks and Bots curriculum lesson.`;
  }

  return question;
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

function clarificationAnswer(): string {
  return "Which guide do you mean: the micro:bit building guide or the Blocks and Bots download instructions?";
}

function insufficientAnswer(): string {
  return "I could not find enough verified information in the approved materials to answer that question.";
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

    const history =
      readHistory(
        body.history,
      );

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

    const currentTopic =
      detectTopicInText(
        question,
      );

    const historyTopic =
      detectHistoryTopic(
        history,
      );

    const resolvedTopic =
      currentTopic ??
      historyTopic;

    const requestedStep =
      resolveRequestedStep(
        question,
        history,
      );

    /*
     * A request for multiple step images must run
     * before the single exact-step handler.
     */
    if (
      asksForImageSequence(
        question,
      )
    ) {
      if (
        resolvedTopic !==
          "microbit-build" &&
        resolvedTopic !==
          "download-instructions"
      ) {
        const answer =
          clarificationAnswer();

        return Response.json({
          answer,
          reply: answer,
          grounded: false,
          sources: [],
          images: [],
          generation:
            routerGeneration(),
        });
      }

      const procedureSteps =
        resolvedTopic ===
        "microbit-build"
          ? await searchBuildSteps()
          : await searchDownloadSteps();

      const startStep =
        requestedImageStartStep(
          question,
        );

      const selectedSteps =
        procedureSteps.filter(
          (step) => {
            const number =
              extractStepNumber(
                [
                  step.title,
                  step.section,
                ].join(" "),
              );

            return (
              number !== null &&
              number >=
                startStep
            );
          },
        );

      const images =
        buildImages(
          selectedSteps,
          selectedSteps.length,
        );

      if (images.length === 0) {
        const answer =
          "I could not find approved images for the requested steps.";

        return Response.json({
          answer,
          reply: answer,
          grounded: false,
          sources: [],
          images: [],
          generation:
            approvedGeneration(),
        });
      }

      const firstNumber =
        extractStepNumber(
          selectedSteps[0].title,
        );

      const lastNumber =
        extractStepNumber(
          selectedSteps[
            selectedSteps.length - 1
          ].title,
        );

      const answer =
        `Here are the approved images from Step ${firstNumber} through Step ${lastNumber}.`;

      return Response.json({
        answer,
        reply: answer,
        grounded: true,

        sources:
          buildSources(
            selectedSteps,
          ),

        images,

        generation:
          approvedGeneration(),
      });
    }

    /*
     * Exact step or conversational follow-up:
     *
     * User: microbit Step 1
     * User: Step 2?
     * User: show me the next one
     */
    if (
      requestedStep !== null &&
      isStepFollowUp(
        question,
      )
    ) {
      if (
        resolvedTopic === null
      ) {
        const answer =
          clarificationAnswer();

        return Response.json({
          answer,
          reply: answer,
          grounded: false,
          sources: [],
          images: [],
          generation:
            routerGeneration(),
        });
      }

      if (
        resolvedTopic ===
          "microbit-build" ||
        resolvedTopic ===
          "download-instructions"
      ) {
        const procedureSteps =
          resolvedTopic ===
          "microbit-build"
            ? await searchBuildSteps()
            : await searchDownloadSteps();

        const exactStep =
          procedureSteps.find(
            (step) =>
              extractStepNumber(
                [
                  step.title,
                  step.section,
                ].join(" "),
              ) ===
              requestedStep,
          );

        if (!exactStep) {
          const answer =
            `I could not find Step ${requestedStep} in the approved guide.`;

          return Response.json({
            answer,
            reply: answer,
            grounded: false,
            sources: [],
            images: [],
            generation:
              approvedGeneration(),
          });
        }

        const guideName =
          resolvedTopic ===
          "microbit-build"
            ? "micro:bit building guide"
            : "Blocks and Bots download instructions";

        const answer =
          await generateGroundedStepAnswer({
            question,
            guideName,

            title:
              exactStep.title,

            context:
              buildContext([
                exactStep,
              ]),

            imagePath:
              exactStep.image_paths[0] ??
              null,

            history,
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

          generation:
            geminiGeneration(),
        });
      }
    }

    /*
     * Entire micro:bit build guide.
     */
    if (
      isFullBuildGuideRequest(
        question,
        resolvedTopic,
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
          generation:
            approvedGeneration(),
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

          history,
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

        generation:
          geminiGeneration(),
      });
    }

    /*
     * General semantic search enriched by the
     * conversation's current topic.
     */
    const retrievalQuestion =
      enrichQuestionWithTopic(
        question,
        resolvedTopic,
      );

    const imageRequest =
      isImageRequest(
        question,
      );

    const searchResults =
      await searchDocuments(
        retrievalQuestion,
        {
          matchCount: 20,

          matchThreshold:
            imageRequest
              ? 0.2
              : 0.3,
        },
      );

    /*
     * Direct image requests return approved images
     * without calling Gemini.
     */
    if (imageRequest) {
      const imageResults =
        chooseImageResults(
          searchResults,
          retrievalQuestion,
          2,
        );

      const images =
        buildImages(
          imageResults,
          2,
        );

      if (images.length === 0) {
        const answer =
          "I found related information, but no approved image was available to display.";

        return Response.json({
          answer,
          reply: answer,
          grounded: false,
          sources: [],
          images: [],
          generation:
            approvedGeneration(),
        });
      }

      const answer =
        images.length === 1
          ? "Here is the approved reference image."
          : "Here are the approved reference images.";

      return Response.json({
        answer,
        reply: answer,
        grounded: true,

        sources:
          buildSources(
            imageResults,
          ),

        images,

        generation:
          approvedGeneration(),
      });
    }

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
        generation:
          approvedGeneration(),
      });
    }

    const answer =
      await generateGroundedAnswer({
        question,

        context:
          buildContext(
            contextResults,
          ),

        history,
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

      generation:
        geminiGeneration(),
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