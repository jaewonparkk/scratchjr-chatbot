import path from "node:path";

import {
  extractStepNumber,
  searchBuildSteps,
  searchDocuments,
  type SearchResult,
} from "@/lib/rag/search";

import {
  parseUserIntent,
  type IntentTopic,
  type ParsedIntent,
} from "@/lib/rag/intent";

import {
  GEMINI_MODEL_NAME,
  generateGroundedAnswer,
  generateGroundedBuildGuide,
  generateGroundedLessonAnswer,
  generateGroundedStepAnswer,
  generateGroundedTroubleshootingAnswer,
  type ChatHistoryMessage,
} from "@/lib/rag/gemini";

import {
  searchLessonBundle,
} from "@/lib/rag/lessons";

import {
  supabaseAdmin,
} from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

type GuideTopic =
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

function findLastReferencedStep(
  history: ChatHistoryMessage[],
): number | null {
  for (
    let index =
      history.length - 1;
    index >= 0;
    index -= 1
  ) {
    const number =
      extractStepNumber(
        history[index].content,
      );

    if (number !== null) {
      return number;
    }
  }

  return null;
}

function inferTopicFromHistory(
  history: ChatHistoryMessage[],
): GuideTopic {
  for (
    let index =
      history.length - 1;
    index >= 0;
    index -= 1
  ) {
    const text =
      history[index].content
        .toLowerCase();

    if (
      text.includes(
        "micro:bit building guide",
      ) ||
      text.includes(
        "microbit building guide",
      ) ||
      /\b(breadboard|alligator clip|gnd|socket\/socket|plug\/plug|motor wire)\b/.test(
        text,
      )
    ) {
      return "microbit-build";
    }

    if (
      text.includes(
        "download instructions",
      ) ||
      /\b(home screen|apps screen|install the app)\b/.test(
        text,
      )
    ) {
      return "download-instructions";
    }

    if (
      /\b(pair|pairing)\b/.test(
        text,
      ) &&
      /\bmicro\s*:?\s*bit\b/.test(
        text,
      )
    ) {
      return "pairing";
    }

    if (
      /\blesson\s*\d+\b/.test(
        text,
      ) ||
      text.includes(
        "curriculum lesson",
      )
    ) {
      return "lesson";
    }
  }

  return null;
}

function resolveGuideTopic(
  intent: ParsedIntent,
  history: ChatHistoryMessage[],
): GuideTopic {
  if (
    intent.topic ===
      "microbit-build" ||
    intent.topic ===
      "download-instructions" ||
    intent.topic ===
      "pairing" ||
    intent.topic ===
      "lesson"
  ) {
    return intent.topic;
  }

  return inferTopicFromHistory(
    history,
  );
}

function readNumberFromImageSubject(
  value: string | null,
): number | null {
  if (!value) {
    return null;
  }

  const match =
    value.match(
      /\b(?:step|image|picture|photo)?\s*#?\s*(\d{1,3})\b/i,
    );

  if (!match) {
    return null;
  }

  const number =
    Number(match[1]);

  return (
    Number.isInteger(number) &&
    number >= 1
  )
    ? number
    : null;
}

function resolveRequestedStep(
  intent: ParsedIntent,
  history: ChatHistoryMessage[],
): number | null {
  if (
    intent.stepNumber !== null
  ) {
    return intent.stepNumber;
  }

  const imageNumber =
    readNumberFromImageSubject(
      intent.imageSubject,
    );

  if (imageNumber !== null) {
    return imageNumber;
  }

  const previousStep =
    findLastReferencedStep(
      history,
    );

  if (previousStep === null) {
    return null;
  }

  if (
    intent.action ===
    "next-step"
  ) {
    return previousStep + 1;
  }

  if (
    intent.action ===
    "previous-step"
  ) {
    return Math.max(
      1,
      previousStep - 1,
    );
  }

  return null;
}

function sortAndDeduplicateSteps(
  results: SearchResult[],
): SearchResult[] {
  const sorted =
    [...results]
      .map((result) => ({
        result,
        number:
          extractStepNumber(
            [
              result.title,
              result.section,
            ].join(" "),
          ),
      }))
      .filter(
        (
          item,
        ): item is {
          result: SearchResult;
          number: number;
        } =>
          item.number !== null,
      )
      .sort(
        (first, second) =>
          first.number -
          second.number,
      );

  const seen =
    new Set<number>();

  const unique:
    SearchResult[] = [];

  for (const item of sorted) {
    if (
      seen.has(item.number)
    ) {
      continue;
    }

    seen.add(item.number);
    unique.push(item.result);
  }

  return unique;
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

function buildRetrievalQuestion(
  intent: ParsedIntent,
): string {
  const topicDescriptions:
    Record<IntentTopic, string> = {
      "microbit-build":
        "micro:bit physical build, wiring, connectors, breadboard, motor, LEDs, and battery",
      "download-instructions":
        "Blocks and Bots app download and installation instructions",
      pairing:
        "pairing a micro:bit with the Blocks and Bots app",
      lesson:
        "Blocks and Bots curriculum lesson",
      virtues:
        "collaboration virtues and the virtues palette",
      scratchjr:
        "ScratchJr programming and classroom activities",
      general:
        "Blocks and Bots curriculum",
      unknown:
        "Blocks and Bots curriculum",
    };

  const parts = [
    intent.normalizedQuestion,
    `Topic: ${topicDescriptions[intent.topic]}`,
  ];

  if (
    intent.components.length > 0
  ) {
    parts.push(
      `Components: ${intent.components.join(
        ", ",
      )}`,
    );
  }

  return parts.join("\n");
}

function chooseTextContextResults(
  results: SearchResult[],
  action: ParsedIntent["action"],
): SearchResult[] {
  if (results.length === 0) {
    return [];
  }

  if (
    action ===
    "troubleshoot"
  ) {
    return results.slice(0, 6);
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
  intent: ParsedIntent,
  limit = 2,
): SearchResult[] {
  const queryTerms = [
    intent.normalizedQuestion,
    intent.imageSubject ?? "",
    ...intent.components,
  ]
    .join(" ")
    .toLowerCase()
    .replace(
      /[^\p{L}\p{N}]+/gu,
      " ",
    )
    .split(/\s+/)
    .filter(
      (term) =>
        term.length >= 3,
    );

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
          const term
          of queryTerms
        ) {
          if (
            firstText.includes(
              term,
            )
          ) {
            firstScore += 0.04;
          }

          if (
            secondText.includes(
              term,
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

    for (
      const imagePath
      of result.image_paths
    ) {
      if (
        !imagePath ||
        seenPaths.has(
          imagePath,
        )
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
        return images;
      }
    }
  }

  return images;
}

function clarificationResponse(
  answer: string,
) {
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

function insufficientAnswer(): string {
  return "I could not find enough verified information in the approved materials to answer that question.";
}

function guideClarification(): string {
  return "Which guide do you mean: the micro:bit building guide or the Blocks and Bots download instructions?";
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

    const intent =
      await parseUserIntent({
        question,
        history,
      });

    if (
      intent.needsClarification ||
      intent.action ===
        "clarify"
    ) {
      return clarificationResponse(
        intent.clarificationQuestion ??
        "Could you clarify which guide, lesson, step, or image you mean?",
      );
    }

    const resolvedTopic =
      resolveGuideTopic(
        intent,
        history,
      );

    const requestedStep =
      resolveRequestedStep(
        intent,
        history,
      );

    /*
     * Exact curriculum lesson.
     *
     * Combines the main lesson plan, that Lesson's
     * supplement slides, and that Lesson's journal
     * materials. Only matching supplement/journal
     * visuals are displayed.
     */
    if (
      intent.action ===
        "exact-lesson" ||
      intent.lessonNumber !==
        null
    ) {
      const lessonNumber =
        intent.lessonNumber;

      if (lessonNumber === null) {
        return clarificationResponse(
          "Which lesson number do you mean?",
        );
      }

      const lessonBundle =
        await searchLessonBundle(
          lessonNumber,
        );

      if (
        lessonBundle.all.length ===
        0
      ) {
        const answer =
          `I could not find Lesson ${lessonNumber} in the approved curriculum materials.`;

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

      const lessonImages =
        buildImages(
          lessonBundle.visualResults,
          6,
        );

      const answer =
        await generateGroundedLessonAnswer({
          question:
            intent.normalizedQuestion,

          lessonNumber,

          context:
            buildContext(
              lessonBundle.all,
            ),

          history,

          primaryCount:
            lessonBundle.primary.length,

          supplementCount:
            lessonBundle.supplements.length,

          journalCount:
            lessonBundle.journal.length,

          visualCount:
            lessonImages.length,
        });

      return Response.json({
        answer,
        reply: answer,
        grounded: true,

        sources:
          buildSources(
            lessonBundle.all,
          ),

        /*
         * Exact Lesson questions automatically show
         * that Lesson's approved supplement/journal
         * visuals, even when the user did not type
         * the word "image".
         */
        images:
          lessonImages,

        generation:
          geminiGeneration(),
      });
    }

    /*
     * All step images, optionally beginning at a
     * specific step and continuing through the end.
     */
    if (
      intent.action ===
      "show-image-sequence"
    ) {
      if (
        resolvedTopic !==
          "microbit-build" &&
        resolvedTopic !==
          "download-instructions"
      ) {
        return clarificationResponse(
          guideClarification(),
        );
      }

      const procedureSteps =
        resolvedTopic ===
        "microbit-build"
          ? await searchBuildSteps()
          : await searchDownloadSteps();

      const startStep =
        requestedStep ?? 1;

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
          Math.max(
            selectedSteps.length,
            1,
          ),
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
          selectedSteps[0]?.title ??
          "",
        );

      const lastNumber =
        extractStepNumber(
          selectedSteps[
            selectedSteps.length - 1
          ]?.title ?? "",
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
     * One exact step, a next/previous follow-up, or
     * a request for one numbered step image.
     */
    if (
      intent.action ===
        "exact-step" ||
      intent.action ===
        "next-step" ||
      intent.action ===
        "previous-step" ||
      (
        intent.action ===
          "show-image" &&
        requestedStep !== null
      )
    ) {
      if (requestedStep === null) {
        return clarificationResponse(
          "Which step number do you mean?",
        );
      }

      if (
        resolvedTopic !==
          "microbit-build" &&
        resolvedTopic !==
          "download-instructions"
      ) {
        return clarificationResponse(
          guideClarification(),
        );
      }

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

      /*
       * A pure image request does not need a second
       * Gemini call. Return the approved image directly.
       */
      if (
        intent.action ===
        "show-image"
      ) {
        const images =
          buildImages(
            [exactStep],
            1,
          );

        if (images.length === 0) {
          const answer =
            `I found ${exactStep.title}, but no approved image was available for it.`;

          return Response.json({
            answer,
            reply: answer,
            grounded: false,
            sources:
              buildSources([
                exactStep,
              ]),
            images: [],
            generation:
              approvedGeneration(),
          });
        }

        const answer =
          `Here is the approved image for ${exactStep.title}.`;

        return Response.json({
          answer,
          reply: answer,
          grounded: true,

          sources:
            buildSources([
              exactStep,
            ]),

          images,

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
          question:
            intent.normalizedQuestion,

          guideName,

          title:
            exactStep.title,

          context:
            buildContext([
              exactStep,
            ]),

          /*
           * Gemini may use the approved image to
           * understand the step, but the frontend only
           * displays it when the user requested an image.
           */
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

        /*
         * Exact build/download steps are inherently visual.
         * Always display the approved image when one exists so
         * equivalent phrasings produce the same response.
         */
        images:
          buildImages(
            [exactStep],
            1,
          ),

        generation:
          geminiGeneration(),
      });
    }

    /*
     * Complete guide.
     */
    if (
      intent.action ===
      "full-guide"
    ) {
      if (
        resolvedTopic !==
          "microbit-build" &&
        resolvedTopic !==
          "download-instructions"
      ) {
        return clarificationResponse(
          guideClarification(),
        );
      }

      const guideSteps =
        resolvedTopic ===
        "microbit-build"
          ? await searchBuildSteps()
          : await searchDownloadSteps();

      if (
        guideSteps.length === 0
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
        resolvedTopic ===
        "microbit-build"
          ? await generateGroundedBuildGuide({
              question:
                intent.normalizedQuestion,

              steps:
                guideSteps.map(
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
            })
          : await generateGroundedAnswer({
              question:
                intent.normalizedQuestion,

              context:
                buildContext(
                  guideSteps,
                ),

              history,
            });

      return Response.json({
        answer,
        reply: answer,
        grounded: true,

        sources:
          buildSources(
            guideSteps,
          ),

        images:
          intent.wantsImage
            ? buildImages(
                guideSteps,
                guideSteps.length,
              )
            : [],

        generation:
          geminiGeneration(),
      });
    }

    /*
     * General grounded retrieval, including
     * misspelled troubleshooting questions.
     */
    const retrievalQuestion =
      buildRetrievalQuestion(
        intent,
      );

    const searchResults =
      await searchDocuments(
        retrievalQuestion,
        {
          matchCount:
            intent.action ===
            "troubleshoot"
              ? 20
              : 12,

          matchThreshold:
            intent.wantsImage ||
            intent.action ===
              "troubleshoot"
              ? 0.2
              : 0.3,
        },
      );

    /*
     * A non-numbered image request uses semantic
     * retrieval, but only returns approved images.
     */
    if (
      intent.action ===
        "show-image" ||
      intent.wantsImage
    ) {
      const imageResults =
        chooseImageResults(
          searchResults,
          intent,
          2,
        );

      const images =
        buildImages(
          imageResults,
          2,
        );

      if (images.length === 0) {
        const answer =
          "I found related approved information, but no approved image was available to display.";

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
        intent.action,
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
      intent.action ===
        "troubleshoot"
        ? await generateGroundedTroubleshootingAnswer({
            question:
              intent.normalizedQuestion,

            context:
              buildContext(
                contextResults,
              ),

            history,
          })
        : await generateGroundedAnswer({
            question:
              intent.normalizedQuestion,

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

      /*
       * Never display images for an ordinary text
       * answer unless the user explicitly requested one.
       */
      images: [],

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
