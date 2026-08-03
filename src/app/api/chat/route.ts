import { GoogleGenAI } from "@google/genai";
import { promises as fs } from "node:fs";
import path from "node:path";

import {
  searchDocuments,
  type SearchResult,
} from "@/lib/rag/search";
import { parseUserIntent } from "@/lib/rag/intent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GEMINI_MODEL =
  process.env.GEMINI_MODEL ??
  "gemini-2.5-flash";

type ChatHistoryMessage = {
  role: "user" | "assistant";
  content: string;
};

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

type SearchIntent = {
  stepNumber: number | null;
  wantsImage: boolean;
  isGreeting: boolean;
  choiceNumber: number | null;
  topic: "microbit-build" | "pairing" | null;
  wantsFullGuide: boolean;
};

type DocumentGroup = {
  key: string;
  label: string;
  results: SearchResult[];
};

type PendingClarification = {
  stepNumber: number;
  originalQuestion: string;
};

let geminiClient: GoogleGenAI | null =
  null;

function getGeminiClient(): GoogleGenAI {
  const apiKey =
    process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY is missing from .env.local.",
    );
  }

  if (!geminiClient) {
    geminiClient =
      new GoogleGenAI({
        apiKey,
      });
  }

  return geminiClient;
}

function readQuestion(
  body: ChatRequestBody,
): string {
  if (
    typeof body.question === "string" &&
    body.question.trim()
  ) {
    return body.question.trim();
  }

  if (
    typeof body.message === "string" &&
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

  const history: ChatHistoryMessage[] =
    [];

  for (const item of value.slice(-16)) {
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

    const content =
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
      !content.trim()
    ) {
      continue;
    }

    history.push({
      role,
      content:
        content
          .trim()
          .slice(0, 6000),
    });
  }

  return history;
}

function analyzeQuestion(
  question: string,
): SearchIntent {
  const normalized =
    question
      .trim()
      .toLowerCase();

  const isGreeting =
    /^(hi|hello|hey|hiya|howdy|good morning|good afternoon|good evening|ㅗㅑ|ㅎㅇ|안녕|안녕하세요)[!?.\s]*$/i.test(
      normalized,
    );

  const wantsImage =
    /\b(image|images|picture|pictures|photo|photos|diagram|diagrams|visual|visuals|look like|looks like)\b/i.test(
      normalized,
    );

  const stepMatch =
    normalized.match(
      /\bstep\s*#?\s*(\d{1,3})\b/i,
    );

  const rawStepNumber =
    stepMatch
      ? Number(stepMatch[1])
      : null;

  const stepNumber =
    Number.isInteger(rawStepNumber) &&
    Number(rawStepNumber) >= 1
      ? rawStepNumber
      : null;

  /*
   * Handles:
   * 1
   * 1.
   * 1)
   * 1. Document name
   */
  const choiceMatch =
    normalized.match(
      /^\s*(\d{1,2})(?:\s*[.)]\s*|\s+|$)/,
    );

  const rawChoiceNumber =
    choiceMatch
      ? Number(choiceMatch[1])
      : null;

  const choiceNumber =
    Number.isInteger(
      rawChoiceNumber,
    ) &&
    Number(rawChoiceNumber) >= 1
      ? rawChoiceNumber
      : null;

  const mentionsPairing =
    /\b(pair|pairing|connect(?:ing|ion)?)\b/i.test(
      normalized,
    );

  const mentionsBuild =
    /\b(build|building|construct(?:ion|ing)?|breadboard|alligator|motor|led|battery|wire|wiring)\b/i.test(
      normalized,
    );

  const topic =
    mentionsPairing && !mentionsBuild
      ? "pairing"
      : mentionsBuild
        ? "microbit-build"
        : null;

  const wantsFullGuide =
    /\b(step[- ]by[- ]step|all (?:the )?steps|every step|full (?:build|guide|instructions?)|complete (?:build|guide|instructions?)|from start to finish)\b/i.test(
      normalized,
    );

  return {
    stepNumber,
    wantsImage,
    isGreeting,
    choiceNumber,
    topic,
    wantsFullGuide,
  };
}

function casualResponse(
  question: string,
): string | null {
  const normalized = question.trim().toLowerCase();

  if (
    /^(thanks|thank you|thx|ty|고마워|고마워요|감사|감사합니다)[!?.\s]*$/i.test(
      normalized,
    )
  ) {
    return "You're welcome! Ask me anytime about ScratchJr, micro:bit, or robotics.";
  }

  if (
    /^(ok|okay|k|got it|cool|nice|bye|goodbye|응|웅|넵|네|ㅇㅋ|ㅋㅋ+|ㅎㅎ+)[!?.\s]*$/i.test(
      normalized,
    )
  ) {
    return "Okay! What would you like to explore next?";
  }

  const mentionsLearningTopic =
    /\b(scratchjr|scratch|micro:?bit|robot|robotics|step|build|pair|motor|led|battery|wire|breadboard|lesson)\b/i.test(
      normalized,
    );

  if (
    !mentionsLearningTopic &&
    [...normalized].length <= 3
  ) {
    return "What would you like help with in ScratchJr, micro:bit, or robotics?";
  }

  return null;
}

function isIdentityQuestion(
  question: string,
): boolean {
  return /^(who are you|what are you|what(?:'s| is) your name|너 누구야|누구세요|넌 누구야)[!?.\s]*$/i.test(
    question.trim(),
  );
}

function needsConversationResolution(
  question: string,
  history: ChatHistoryMessage[],
): boolean {
  if (history.length === 0) {
    return false;
  }

  const normalized =
    question.trim().toLowerCase();

  return (
    /\b(it|that|this|those|these|one|ones|them|they|its|their)\b/i.test(
      normalized,
    ) ||
    /^(what|how)\s+about\b/i.test(
      normalized,
    ) ||
    /^(and|so|then)\b/i.test(
      normalized,
    )
  );
}

function readMetadataString(
  result: SearchResult,
  key: string,
): string | null {
  const value =
    result.metadata[key];

  return (
    typeof value === "string" &&
    value.trim()
  )
    ? value.trim()
    : null;
}

function readMetadataNumber(
  result: SearchResult,
  key: string,
): number | null {
  const value =
    result.metadata[key];

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
    const parsed =
      Number(value);

    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

function humanizeLabel(
  value: string,
): string {
  return value
    .replace(/[-_]+/g, " ")
    .replace(
      /\b\w/g,
      (character) =>
        character.toUpperCase(),
    );
}

function getDocumentGroupKey(
  result: SearchResult,
): string {
  return (
    readMetadataString(
      result,
      "document_id",
    ) ??
    readMetadataString(
      result,
      "document_title",
    ) ??
    result.source_file ??
    result.chunk_id
  );
}

function getDocumentGroupLabel(
  result: SearchResult,
): string {
  const documentTitle =
    readMetadataString(
      result,
      "document_title",
    );

  if (documentTitle) {
    return documentTitle;
  }

  const topic =
    readMetadataString(
      result,
      "topic",
    );

  if (topic) {
    return humanizeLabel(topic);
  }

  const documentType =
    readMetadataString(
      result,
      "document_type",
    );

  if (documentType) {
    return humanizeLabel(
      documentType,
    );
  }

  return (
    result.source_file ||
    result.title
  );
}

function groupResultsByDocument(
  results: SearchResult[],
): DocumentGroup[] {
  const groupMap =
    new Map<
      string,
      DocumentGroup
    >();

  for (const result of results) {
    const key =
      getDocumentGroupKey(
        result,
      );

    const existingGroup =
      groupMap.get(key);

    if (existingGroup) {
      existingGroup.results.push(
        result,
      );

      continue;
    }

    groupMap.set(key, {
      key,
      label:
        getDocumentGroupLabel(
          result,
        ),
      results: [result],
    });
  }

  return Array.from(
    groupMap.values(),
  );
}

function normalizeSearchText(
  value: string,
): string {
  return value
    .toLowerCase()
    .replace(
      /[^\p{L}\p{N}]+/gu,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
}

function getMeaningfulTerms(
  value: string,
): string[] {
  const ignoredTerms =
    new Set([
      "show",
      "step",
      "image",
      "picture",
      "photo",
      "diagram",
      "please",
      "need",
      "look",
      "want",
      "give",
      "tell",
      "from",
      "this",
      "that",
      "the",
      "and",
      "for",
    ]);

  return normalizeSearchText(value)
    .split(/\s+/)
    .filter(
      (term) =>
        term.length >= 3 &&
        !ignoredTerms.has(term),
    );
}

function scoreGroupAgainstText(
  group: DocumentGroup,
  text: string,
): number {
  const terms =
    getMeaningfulTerms(text);

  if (terms.length === 0) {
    return 0;
  }

  const searchableText =
    normalizeSearchText(
      [
        group.label,
        ...group.results.flatMap(
          (result) => [
            result.title,
            result.content,
            result.source_file,
            JSON.stringify(
              result.metadata,
            ),
          ],
        ),
      ].join(" "),
    );

  let score = 0;

  for (const term of terms) {
    if (
      searchableText.includes(term)
    ) {
      score += 1;
    }
  }

  return score;
}

function findGroupFromConversation(
  groups: DocumentGroup[],
  question: string,
  history: ChatHistoryMessage[],
): DocumentGroup | null {
  const conversationText = [
    ...history
      .slice(-6)
      .map(
        (message) =>
          message.content,
      ),
    question,
  ].join("\n");

  const scoredGroups =
    groups.map((group) => ({
      group,
      score:
        scoreGroupAgainstText(
          group,
          conversationText,
        ),
    }));

  scoredGroups.sort(
    (first, second) =>
      second.score -
      first.score,
  );

  const best =
    scoredGroups[0];

  const second =
    scoredGroups[1];

  if (
    !best ||
    best.score <= 0
  ) {
    return null;
  }

  if (
    second &&
    best.score === second.score
  ) {
    return null;
  }

  return best.group;
}

function findPendingClarification(
  history: ChatHistoryMessage[],
): PendingClarification | null {
  for (
    let index =
      history.length - 1;
    index >= 0;
    index -= 1
  ) {
    const message =
      history[index];

    if (
      message.role !== "assistant"
    ) {
      continue;
    }

    const match =
      message.content.match(
        /I found Step\s+(\d{1,3})\s+in more than one uploaded document/i,
      );

    if (!match) {
      continue;
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

    for (
      let earlierIndex =
        index - 1;
      earlierIndex >= 0;
      earlierIndex -= 1
    ) {
      const earlierMessage =
        history[earlierIndex];

      if (
        earlierMessage.role ===
        "user"
      ) {
        return {
          stepNumber,
          originalQuestion:
            earlierMessage.content,
        };
      }
    }
  }

  return null;
}

function createClarificationAnswer(
  stepNumber: number,
  groups: DocumentGroup[],
): string {
  const choices =
    groups
      .map(
        (group, index) => {
          const firstResult =
            group.results[0];

          return [
            `${index + 1}. ${group.label}`,
            `   ${firstResult.title}`,
          ].join("\n");
        },
      )
      .join("\n\n");

  return [
    `I found Step ${stepNumber} in more than one uploaded document.`,
    "",
    "Which one do you mean?",
    "",
    choices,
    "",
    "Reply with the number or document name.",
  ].join("\n");
}

function formatHistory(
  history: ChatHistoryMessage[],
): string {
  if (history.length === 0) {
    return "No earlier conversation.";
  }

  return history
    .slice(-12)
    .map((message) => {
      const label =
        message.role === "user"
          ? "USER"
          : "ASSISTANT";

      return [
        `${label}:`,
        message.content,
      ].join("\n");
    })
    .join("\n\n");
}

function buildContext(
  results: SearchResult[],
): string {
  if (results.length === 0) {
    return "No directly relevant uploaded document content was found.";
  }

  return results
    .map((result, index) => {
      const location =
        result.page_number !== null
          ? `Page ${result.page_number}`
          : result.slide_number !==
              null
            ? `Slide ${result.slide_number}`
            : "Document";

      return [
        `[DOCUMENT ${index + 1}]`,
        `Title: ${result.title}`,
        `Source: ${result.source_file}`,
        `Location: ${location}`,
        `Section: ${result.section}`,
        `Metadata: ${JSON.stringify(
          result.metadata,
        )}`,
        "Content:",
        result.content,
      ].join("\n");
    })
    .join(
      "\n\n--------------------\n\n",
    );
}

function buildSources(
  results: SearchResult[],
): ChatSource[] {
  return results.map((result) => ({
    chunkId:
      result.chunk_id,
    title:
      result.title,
    file:
      result.source_file,
    page:
      result.page_number,
    slide:
      result.slide_number,
    section:
      result.section,
    similarity:
      result.similarity,
  }));
}

function buildImages(
  results: SearchResult[],
): ChatImage[] {
  for (const result of results) {
    if (
      !result.should_display_image ||
      result.image_paths.length === 0
    ) {
      continue;
    }

    const imagePath =
      result.image_paths[0];

    if (!imagePath) {
      continue;
    }

    return [
      {
        url:
          imagePath.startsWith("/")
            ? imagePath
            : `/${imagePath}`,
        path:
          imagePath,
        caption:
          result.title,
        sourceFile:
          result.source_file,
        page:
          result.page_number,
        slide:
          result.slide_number,
      },
    ];
  }

  return [];
}

function buildRelevantImages(
  results: SearchResult[],
  intent: SearchIntent,
): ChatImage[] {
  if (results.length === 0) {
    return [];
  }

  const hasStructuredContext =
    intent.wantsImage ||
    intent.stepNumber !== null ||
    intent.wantsFullGuide ||
    intent.topic !== null;

  const eligibleResults =
    hasStructuredContext
      ? results
      : results.filter(
          (result) =>
            result.similarity >= 0.45,
        );

  return buildImages(
    eligibleResults,
  );
}

function chooseBestResult(
  results: SearchResult[],
  stepNumber?: number,
): SearchResult | null {
  let candidates =
    [...results];

  if (
    stepNumber !== undefined
  ) {
    candidates =
      candidates.filter(
        (result) =>
          readMetadataNumber(
            result,
            "step_number",
          ) === stepNumber,
      );
  }

  if (
    candidates.length === 0
  ) {
    return null;
  }

  candidates.sort(
    (first, second) =>
      second.similarity -
      first.similarity,
  );

  return candidates[0];
}

async function searchExactStep(
  question: string,
  stepNumber: number,
  topic?: SearchIntent["topic"],
): Promise<SearchResult[]> {
  return searchDocuments(
    question,
    {
      matchCount: 20,
      matchThreshold: 0.01,
      filters: {
        stepNumber,
        ...(topic
          ? { topic }
          : {}),
      },
    },
  );
}

async function retrieveGeneralResults(
  question: string,
  wantsImage: boolean,
): Promise<SearchResult[]> {
  if (wantsImage) {
    const imageResults =
      await searchDocuments(
        question,
        {
          matchCount: 12,
          matchThreshold: 0.05,
          filters: {
            wantsImage: true,
          },
        },
      );

    const bestImageResult =
      chooseBestResult(
        imageResults,
      );

    return bestImageResult
      ? [bestImageResult]
      : [];
  }

  return searchDocuments(
    question,
    {
      matchCount: 6,
      matchThreshold: 0.15,
    },
  );
}

async function retrieveFullGuide(
  question: string,
  topic: Exclude<SearchIntent["topic"], null>,
): Promise<SearchResult[]> {
  const contentType =
    topic === "microbit-build"
      ? "build-step"
      : "pairing-step";

  const results =
    await searchDocuments(
      `${question} ${topic} complete guide all numbered steps`,
      {
        matchCount: 20,
        matchThreshold: -1,
        filters: {
          topic,
          contentType,
        },
      },
    );

  return results.sort((first, second) => {
    const firstStep =
      readMetadataNumber(
        first,
        "step_number",
      ) ?? Number.MAX_SAFE_INTEGER;

    const secondStep =
      readMetadataNumber(
        second,
        "step_number",
      ) ?? Number.MAX_SAFE_INTEGER;

    return firstStep - secondStep;
  });
}

async function retrieveNamedResearcherFile(
  question: string,
): Promise<SearchResult[] | null> {
  const directory = path.join(
    process.cwd(),
    "knowledge",
    "processed",
    "researcher",
  );

  let names: string[];
  try {
    names = await fs.readdir(directory);
  } catch {
    return null;
  }

  const normalizedQuestion = question.toLowerCase();
  const matchedName = names.find((name) => {
    if (!name.endsWith(".json")) return false;
    const stem = path.parse(name).name.toLowerCase();
    return normalizedQuestion.includes(stem) || normalizedQuestion.includes(`${stem}.pdf`);
  });

  if (!matchedName) return null;

  const parsed = JSON.parse(
    await fs.readFile(path.join(directory, matchedName), "utf8"),
  ) as { chunks?: Array<Partial<SearchResult>> };

  if (!Array.isArray(parsed.chunks)) return null;

  return parsed.chunks
    .map((chunk, index): SearchResult => ({
      id: Number(chunk.id ?? index),
      chunk_id: typeof chunk.chunk_id === "string" ? chunk.chunk_id : String(chunk.id ?? index),
      title: typeof chunk.title === "string" ? chunk.title : path.parse(matchedName).name,
      content: typeof chunk.content === "string" ? chunk.content : "",
      source_file: typeof chunk.source_file === "string" ? chunk.source_file : matchedName,
      file_type: chunk.file_type === "docx" || chunk.file_type === "pptx" || chunk.file_type === "image" ? chunk.file_type : "pdf",
      section: typeof chunk.section === "string" ? chunk.section : "",
      page_number: typeof chunk.page_number === "number" ? chunk.page_number : null,
      slide_number: typeof chunk.slide_number === "number" ? chunk.slide_number : null,
      image_paths: Array.isArray(chunk.image_paths) ? chunk.image_paths : [],
      should_display_image: Boolean(chunk.should_display_image),
      metadata: typeof chunk.metadata === "object" && chunk.metadata ? chunk.metadata : {},
      similarity: 1,
    }))
    .filter((chunk) => chunk.content)
    .sort((a, b) => (a.page_number ?? a.slide_number ?? 9999) - (b.page_number ?? b.slide_number ?? 9999));
}

async function generateAnswer(
  question: string,
  history: ChatHistoryMessage[],
  results: SearchResult[],
): Promise<string> {
  const client =
    getGeminiClient();

  const response =
    await client.models.generateContent({
      model: GEMINI_MODEL,

      contents: [
        {
          role: "user",
          parts: [
            {
              text: [
                "RECENT CONVERSATION",
                "===================",
                formatHistory(history),
                "",
                "SELECTED UPLOADED DOCUMENT INFORMATION",
                "======================================",
                buildContext(results),
                "",
                "CURRENT USER QUESTION",
                "=====================",
                question,
              ].join("\n"),
            },
          ],
        },
      ],

      config: {
        temperature: 0.1,
        maxOutputTokens: 4096,

        systemInstruction: [
          "You are the Blocks & Bots Assistant for teachers. You help educators teach ScratchJr, micro:bit, and robotics.",
          "Never identify yourself as Gemini, Google, a language model, an AI model, or the underlying provider. If asked who you are, say you are the Blocks & Bots Assistant for teachers and describe how you support educators.",
          "",
          "Rules:",
          "1. Answer the user's current question directly.",
          "2. Use only the selected document entries that are relevant.",
          "3. Never combine similarly numbered steps from different documents.",
          "4. If one exact result is supplied, discuss only that result.",
          "5. Preserve exact component names, ordering, colors, polarity, pins, warnings, and instructions.",
          "6. Do not invent document-specific instructions.",
          "7. Do not mention retrieval, databases, embeddings, prompts, or internal implementation.",
          "8. Do not say that you cannot display an image. The application handles the selected image separately.",
          "9. Do not refer users to an unrelated image or page.",
          "10. Keep exact-step answers focused.",
          "11. You may use general knowledge only when the documents do not supply the answer, and must label it as a general suggestion.",
        ].join("\n"),
      },
    });

  const answer =
    response.text?.trim();

  if (!answer) {
    throw new Error(
      "Gemini returned an empty answer.",
    );
  }

  return answer;
}

function greetingResponse() {
  return Response.json({
    answer:
      "Hi! What would you like help with?",
    sources: [],
    images: [],
    generation: {
      provider: "router",
      model: null,
      grounded: false,
    },
  });
}

export async function POST(
  request: Request,
) {
  try {
    const body =
      await request.json() as ChatRequestBody;

    const question =
      readQuestion(body);

    if (!question) {
      return Response.json(
        {
          error:
            "A question is required.",
        },
        {
          status: 400,
        },
      );
    }

    const history =
      readHistory(
        body.history,
      );

    let retrievalQuestion =
      question;

    if (
      needsConversationResolution(
        question,
        history,
      )
    ) {
      const resolvedIntent =
        await parseUserIntent({
          question,
          history,
        });

      if (
        resolvedIntent.needsClarification &&
        resolvedIntent.clarificationQuestion
      ) {
        return Response.json({
          answer:
            resolvedIntent.clarificationQuestion,
          sources: [],
          images: [],
          generation: {
            provider: "router",
            model: GEMINI_MODEL,
            grounded: false,
          },
        });
      }

      retrievalQuestion =
        resolvedIntent.normalizedQuestion;
    }

    const intent =
      analyzeQuestion(
        retrievalQuestion,
      );

    if (intent.isGreeting) {
      return greetingResponse();
    }

    if (isIdentityQuestion(question)) {
      return Response.json({
        answer:
          "I'm the Blocks & Bots Assistant for teachers. I help educators teach ScratchJr, micro:bit, and robotics with lessons, builds, and troubleshooting support.",
        sources: [],
        images: [],
        generation: {
          provider: "router",
          model: null,
          grounded: false,
        },
      });
    }

    const casualAnswer =
      casualResponse(question);

    if (casualAnswer) {
      return Response.json({
        answer: casualAnswer,
        sources: [],
        images: [],
        generation: {
          provider: "router",
          model: null,
          grounded: false,
        },
      });
    }

    let results: SearchResult[] =
      [];

    /*
     * Resolve a user's reply to a previous
     * clarification:
     *
     * 1
     * 1.
     * 1. Document name
     */
    const pendingClarification =
      findPendingClarification(
        history,
      );

    const namedResearcherResults =
      await retrieveNamedResearcherFile(
        retrievalQuestion,
      );

    if (
      namedResearcherResults &&
      namedResearcherResults.length > 0
    ) {
      results = namedResearcherResults;
    } else if (
      intent.wantsFullGuide &&
      intent.topic !== null
    ) {
      results =
        await retrieveFullGuide(
          retrievalQuestion,
          intent.topic,
        );
    } else if (
      pendingClarification &&
      intent.choiceNumber !== null
    ) {
      const exactResults =
        await searchExactStep(
          pendingClarification.originalQuestion,
          pendingClarification.stepNumber,
          analyzeQuestion(
            pendingClarification.originalQuestion,
          ).topic,
        );

      const groups =
        groupResultsByDocument(
          exactResults,
        );

      const selectedGroup =
        groups[
          intent.choiceNumber - 1
        ];

      if (!selectedGroup) {
        return Response.json({
          answer:
            `Please choose a number between 1 and ${groups.length}.`,
          sources: [],
          images: [],
          generation: {
            provider: "router",
            model: null,
            grounded: false,
          },
        });
      }

      const bestResult =
        chooseBestResult(
          selectedGroup.results,
          pendingClarification.stepNumber,
        );

      results =
        bestResult
          ? [bestResult]
          : [];
    } else if (
      intent.stepNumber !== null
    ) {
      const exactResults =
        await searchExactStep(
          retrievalQuestion,
          intent.stepNumber,
          intent.topic,
        );

      const groups =
        groupResultsByDocument(
          exactResults,
        );

      if (groups.length > 1) {
        const conversationGroup =
          findGroupFromConversation(
            groups,
            question,
            history,
          );

        if (!conversationGroup) {
          return Response.json({
            answer:
              createClarificationAnswer(
                intent.stepNumber,
                groups,
              ),
            sources: [],
            images: [],
            generation: {
              provider: "router",
              model: null,
              grounded: false,
            },
          });
        }

        const bestResult =
          chooseBestResult(
            conversationGroup.results,
            intent.stepNumber,
          );

        results =
          bestResult
            ? [bestResult]
            : [];
      } else if (
        groups.length === 1
      ) {
        const bestResult =
          chooseBestResult(
            groups[0].results,
            intent.stepNumber,
          );

        results =
          bestResult
            ? [bestResult]
            : [];
      }
    } else {
      results =
        await retrieveGeneralResults(
          retrievalQuestion,
          intent.wantsImage,
        );
    }

    const answer =
      await generateAnswer(
        question,
        history,
        results,
      );

    return Response.json({
      answer,
      sources:
        buildSources(results),
      images:
        buildRelevantImages(
          results,
          intent,
        ),
      generation: {
        provider: "gemini",
        model: GEMINI_MODEL,
        grounded:
          results.length > 0,
      },
    });
  } catch (error: unknown) {
    console.error(
      "[Chat] Request failed:",
      error,
    );

    return Response.json(
      {
        error:
          "The assistant could not answer this question.",
        details:
          process.env.NODE_ENV ===
          "development" &&
          error instanceof Error
            ? error.message
            : undefined,
      },
      {
        status: 500,
      },
    );
  }
}
