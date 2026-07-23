import "server-only";

import { GoogleGenAI } from "@google/genai";
import { readFile } from "node:fs/promises";
import path from "node:path";

export const GEMINI_MODEL_NAME =
  process.env.GEMINI_MODEL ??
  "gemini-2.5-flash";

const MAX_INLINE_IMAGE_BYTES =
  18 * 1024 * 1024;

const MAX_BUILD_GUIDE_IMAGES = 4;

export type ChatHistoryMessage = {
  role: "user" | "assistant";
  content: string;
};

type GeminiTextPart = {
  text: string;
};

type GeminiImagePart = {
  inlineData: {
    mimeType: string;
    data: string;
  };
};

type GeminiPart =
  | GeminiTextPart
  | GeminiImagePart;

type GroundedAnswerInput = {
  question: string;
  context: string;
  history?: ChatHistoryMessage[];
};

type GroundedTroubleshootingInput = {
  question: string;
  context: string;
  history?: ChatHistoryMessage[];
};

type GroundedStepAnswerInput = {
  question: string;
  guideName: string;
  title: string;
  context: string;
  imagePath: string | null;
  history?: ChatHistoryMessage[];
};

type GroundedLessonAnswerInput = {
  question: string;
  lessonNumber: number;
  context: string;
  history?: ChatHistoryMessage[];
  primaryCount: number;
  supplementCount: number;
  journalCount: number;
  visualCount: number;
};

export type GeminiBuildStep = {
  title: string;
  content: string;
  imagePath: string | null;
};

type GroundedBuildGuideInput = {
  question: string;
  steps: GeminiBuildStep[];
  history?: ChatHistoryMessage[];
};

type LoadedImage = {
  part: GeminiImagePart;
  byteLength: number;
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

function formatHistory(
  history: ChatHistoryMessage[] = [],
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
        message.content
          .trim()
          .slice(0, 4000),
      ].join("\n");
    })
    .join("\n\n");
}

function resolveApprovedImagePath(
  imagePath: string,
): string {
  const projectRoot =
    process.cwd();

  const approvedDirectory =
    path.resolve(
      projectRoot,
      "knowledge",
      "processed",
      "images",
    );

  const absolutePath =
    path.resolve(
      projectRoot,
      imagePath,
    );

  const relativePath =
    path.relative(
      approvedDirectory,
      absolutePath,
    );

  if (
    relativePath.startsWith("..") ||
    path.isAbsolute(relativePath)
  ) {
    throw new Error(
      "The image is outside the approved image directory.",
    );
  }

  return absolutePath;
}

function getImageMimeType(
  imagePath: string,
): string {
  const extension =
    path
      .extname(imagePath)
      .toLowerCase();

  const mimeTypes:
    Record<string, string> = {
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".webp": "image/webp",
    };

  const mimeType =
    mimeTypes[extension];

  if (!mimeType) {
    throw new Error(
      `Unsupported image extension: ${extension}`,
    );
  }

  return mimeType;
}

async function loadImage(
  imagePath: string,
): Promise<LoadedImage> {
  const absolutePath =
    resolveApprovedImagePath(
      imagePath,
    );

  const imageBuffer =
    await readFile(
      absolutePath,
    );

  return {
    part: {
      inlineData: {
        mimeType:
          getImageMimeType(
            imagePath,
          ),
        data:
          imageBuffer.toString(
            "base64",
          ),
      },
    },

    byteLength:
      imageBuffer.byteLength,
  };
}

async function callGemini(
  systemInstruction: string,
  parts: GeminiPart[],
): Promise<string> {
  const client =
    getGeminiClient();

  console.info(
    `[Gemini] Calling model: ${GEMINI_MODEL_NAME}`,
  );

  const response =
    await client.models.generateContent({
      model:
        GEMINI_MODEL_NAME,

      contents: [
        {
          role: "user",
          parts,
        },
      ],

      config: {
        systemInstruction,
        temperature: 0.1,
        maxOutputTokens: 8192,
      },
    });

  const answer =
    response.text?.trim();

  if (!answer) {
    throw new Error(
      "Gemini returned an empty answer.",
    );
  }

  console.info(
    `[Gemini] Response received: ${answer.length} characters`,
  );

  return answer;
}

function exposesInternalGenerationDetails(
  answer: string,
): boolean {
  return (
    /\b(raw text of the prompt|prompt has|system instruction|context window)\b/i.test(
      answer,
    ) ||
    /https?:\/\/images\./i.test(
      answer,
    )
  );
}

export async function generateGroundedAnswer({
  question,
  context,
  history = [],
}: GroundedAnswerInput): Promise<string> {
  const systemInstruction = [
    "You are the Blocks and Bots Assistant.",
    "",
    "Answer teachers, parents, facilitators, and learners using only approved curriculum information supplied by the application.",
    "",
    "Rules:",
    "1. Always answer in English.",
    "2. Understand follow-up questions using the conversation history.",
    "3. Answer the user's exact current question.",
    "4. Treat approved information as factual evidence and safety boundaries, not as a script to copy.",
    "5. Use your reasoning to understand the learner's situation and turn relevant evidence into practical next actions.",
    "6. For troubleshooting, identify the likely mismatch, explain why it matters, say what not to do, and give the approved next action.",
    "7. Never invent a substitute connection. Only recommend one when the approved information explicitly allows it.",
    "8. Do not summarize an entire lesson or document unless explicitly requested.",
    "9. Ignore retrieved information unrelated to the question.",
    "10. Give a direct but useful explanation.",
    "11. Normally use one or two focused paragraphs.",
    "12. Use numbered steps only for procedures.",
    "13. Do not copy large portions of source material.",
    "14. Never invent wiring connections, pins, colors, parts, safety claims, curriculum instructions, or troubleshooting.",
    "15. If approved information is insufficient, clearly say so.",
    "16. Do not mention prompts, context windows, retrieval, embeddings, databases, or AI models.",
    "17. Do not invent sources.",
  ].join("\n");

  return callGemini(
    systemInstruction,
    [
      {
        text: [
          "RECENT CONVERSATION",
          "===================",
          formatHistory(history),
          "",
          "APPROVED CURRICULUM INFORMATION",
          "===============================",
          context,
          "",
          "CURRENT USER QUESTION",
          "=====================",
          question,
          "",
          "Answer the current question using only the relevant approved information.",
        ].join("\n"),
      },
    ],
  );
}

export async function generateGroundedTroubleshootingAnswer({
  question,
  context,
  history = [],
}: GroundedTroubleshootingInput): Promise<string> {
  const systemInstruction = [
    "You are the practical troubleshooting assistant for the Blocks and Bots educational robotics kit.",
    "",
    "Your job is to help the learner keep moving instead of stopping at the first mismatch.",
    "Use the approved curriculum as the source of truth for named parts, exact build steps, connector types, pin numbers, colors, and intended circuit behavior.",
    "",
    "Reasoning policy:",
    "1. You may reason from connector compatibility, the current build step, visible or described parts, and reversible low-risk checks.",
    "2. Do not say that no workaround exists merely because the curriculum does not explicitly document a substitute.",
    "3. When a practical workaround follows directly from the supplied parts and connector types, explain it as a practical suggestion rather than an official curriculum instruction.",
    "4. Preserve the intended electrical connection. A workaround must connect the same endpoints and serve the same function as the approved step.",
    "5. Never invent a pin number, voltage, polarity, wire color, or component that is not supported by the approved information.",
    "6. Never tell the learner to force connectors, cut or strip wires, splice wires, modify components, bypass the battery connection, or connect power pins blindly.",
    "7. Do not recommend an adapter or alligator-clip arrangement unless the supplied context makes the relevant endpoints and available parts clear enough to justify it.",
    "8. If the exact workaround cannot be verified, do not end with only 'get the missing part.' Give immediate checks, explain what information is missing, and ask for the current step number or a clear photo of the available parts.",
    "9. If the user has named a step, tailor every suggestion to that step.",
    "10. Use conversation history to understand short or misspelled follow-ups.",
    "",
    "Answer format:",
    "- Start by restating the mismatch in one sentence.",
    "- Then give the best practical next actions in priority order.",
    "- Clearly distinguish a confirmed curriculum instruction from a practical suggestion when relevant.",
    "- Explain why each proposed connection is or is not compatible.",
    "- Ask at most one focused clarification question when necessary.",
    "- Always answer in English.",
    "- Do not mention prompts, retrieval, embeddings, databases, or AI models.",
  ].join("\n");

  return callGemini(
    systemInstruction,
    [
      {
        text: [
          "RECENT CONVERSATION",
          "===================",
          formatHistory(history),
          "",
          "APPROVED CURRICULUM AND KIT INFORMATION",
          "=======================================",
          context,
          "",
          "CURRENT TROUBLESHOOTING QUESTION",
          "================================",
          question,
          "",
          "Provide a useful, flexible, and safe next step. Do not default to refusing a workaround simply because it is not written verbatim in the curriculum.",
        ].join("\n"),
      },
    ],
  );
}

export async function generateGroundedLessonAnswer({
  question,
  lessonNumber,
  context,
  history = [],
  primaryCount,
  supplementCount,
  journalCount,
  visualCount,
}: GroundedLessonAnswerInput): Promise<string> {
  const wantsBriefAnswer =
    /\b(brief|briefly|short|quick|summary|summarize|concise)\b/i.test(
      question,
    );

  const wantsFullPlan =
    /\b(full|complete|entire|detailed|detail|everything|all activities)\b/i.test(
      question,
    );

  const lengthInstruction =
    wantsBriefAnswer
      ? [
          "The user explicitly requested a short summary.",
          "Use approximately two to four focused paragraphs.",
        ].join("\n")
      : wantsFullPlan
        ? [
            "The user requested the full or detailed lesson plan.",
            "Give a thorough educator-facing guide, normally about 900 to 1,400 words when the approved material supports it.",
          ].join("\n")
        : [
            "The user asked generally about a numbered lesson.",
            "Give a substantial educator-facing guide, normally about 600 to 1,000 words when the approved material supports it.",
            "Do not collapse the lesson into two short summary paragraphs.",
          ].join("\n");

  const systemInstruction = [
    "You are the Blocks and Bots Assistant.",
    "",
    "Create an accurate lesson guide for teachers and facilitators using only the supplied approved curriculum materials.",
    "",
    "The supplied context may combine:",
    "- the main lesson plan",
    "- lesson supplement slides",
    "- journal or reflection materials",
    "- descriptions of approved lesson visuals",
    "",
    "Rules:",
    "1. Always answer in English.",
    `2. Cover only Lesson ${lessonNumber}.`,
    "3. Do not mix in activities, vocabulary, virtues, timings, or images from another lesson.",
    "4. Synthesize the materials instead of copying long passages verbatim.",
    "5. Preserve exact activity names, learning goals, vocabulary meanings, suggested times, teacher prompts, virtue guidance, and differentiation when supplied.",
    "6. Do not invent activities, requirements, timings, materials, visuals, or learning objectives.",
    "7. If a section is absent from the approved materials, omit it rather than guessing.",
    "8. Do not mention retrieval, databases, embeddings, prompts, context windows, or AI models.",
    "9. Do not claim that a supplement, journal, anchor chart, cut-out block sheet, or visual exists unless it appears in the supplied context.",
    "10. Do not output a markdown table.",
    "",
    lengthInstruction,
    "",
    "For a detailed answer, use the following headings when supported:",
    `Lesson ${lessonNumber}: [Exact Lesson Title]`,
    "Overview",
    "Powerful Ideas",
    "Learning Objectives",
    "Vocabulary",
    "Teacher Preparation",
    "Group Organization",
    "Lesson Flow",
    "Virtue Focus",
    "Opportunities for Differentiation",
    "Supplement and Journal Materials",
    "",
    "Lesson Flow requirements:",
    "- Preserve the activity order.",
    "- Include activity names and suggested times when supplied.",
    "- Explain what the teacher does and what children do.",
    "- Include useful teacher prompts without reproducing every sentence.",
    "",
    "Supplement and journal requirements:",
    "- Explain how the relevant slides, anchor charts, cut-out blocks, journals, reflection pages, or other visuals support this lesson.",
    "- Mention only materials confirmed in the supplied context.",
    "- Relevant approved images may be displayed beneath the answer by the application.",
  ].join("\n");

  return callGemini(
    systemInstruction,
    [
      {
        text: [
          "RECENT CONVERSATION",
          "===================",
          formatHistory(history),
          "",
          `REQUESTED LESSON: ${lessonNumber}`,
          "",
          "AVAILABLE APPROVED MATERIAL COUNTS",
          "==================================",
          `Main lesson chunks: ${primaryCount}`,
          `Supplement chunks: ${supplementCount}`,
          `Journal chunks: ${journalCount}`,
          `Approved visuals selected for display: ${visualCount}`,
          "",
          "APPROVED LESSON MATERIALS",
          "=========================",
          context,
          "",
          "CURRENT USER QUESTION",
          "=====================",
          question,
          "",
          visualCount > 0
            ? "Relevant approved supplement or journal visuals will appear below the answer. Explain their instructional purpose only when the supplied material makes that purpose clear."
            : "No approved supplement or journal visual has been selected for display.",
        ].join("\n"),
      },
    ],
  );
}

export async function generateGroundedStepAnswer({
  question,
  guideName,
  title,
  context,
  imagePath,
  history = [],
}: GroundedStepAnswerInput): Promise<string> {
  const parts: GeminiPart[] = [
    {
      text: [
        "RECENT CONVERSATION",
        "===================",
        formatHistory(history),
        "",
        `GUIDE: ${guideName}`,
        `EXACT STEP TITLE: ${title}`,
        "",
        "APPROVED STEP TEXT",
        "==================",
        context,
        "",
        "CURRENT USER QUESTION",
        "=====================",
        question,
      ].join("\n"),
    },
  ];

  if (imagePath) {
    const loadedImage =
      await loadImage(
        imagePath,
      );

    parts.push({
      text:
        "The following approved image belongs to this exact step.",
    });

    parts.push(
      loadedImage.part,
    );
  }

  const systemInstruction = [
    "You are the Blocks and Bots Assistant.",
    "",
    "Explain one exact approved procedure step using the approved text and attached image.",
    "",
    "Rules:",
    "1. Always answer in English.",
    "2. Use conversation history to understand short follow-up questions such as 'Step 2?' or 'the next one'.",
    "3. Begin with the exact step title.",
    "4. Explain the purpose of the step.",
    "5. Explain what the learner should do in three to six useful sentences.",
    "6. Use visible information from the attached image when helpful.",
    "7. Do not merely repeat the title, OCR text, or 'Image of Step'.",
    "8. Do not explain unrelated steps.",
    "9. Do not invent colors, pins, parts, connections, or safety instructions.",
    "10. Preserve explicit safety guidance from the approved material.",
    "11. If an important detail is unclear, state what is unclear instead of guessing.",
    "12. Do not say an image is unavailable when one is attached.",
  ].join("\n");

  return callGemini(
    systemInstruction,
    parts,
  );
}

export async function generateGroundedBuildGuide({
  question,
  steps,
  history = [],
}: GroundedBuildGuideInput): Promise<string> {
  if (steps.length === 0) {
    throw new Error(
      "No approved build steps were supplied.",
    );
  }

  const parts: GeminiPart[] = [
    {
      text: [
        "RECENT CONVERSATION",
        "===================",
        formatHistory(history),
        "",
        "CURRENT USER QUESTION",
        "=====================",
        question,
        "",
        "The approved build steps and images follow in numerical order.",
      ].join("\n"),
    },
  ];

  let totalImageBytes = 0;
  let attachedImageCount = 0;

  for (
    let index = 0;
    index < steps.length;
    index += 1
  ) {
    const step =
      steps[index];

    parts.push({
      text: [
        "",
        `APPROVED STEP ${index + 1}`,
        "====================",
        `Exact title: ${step.title}`,
        "",
        "Approved text:",
        step.content,
      ].join("\n"),
    });

    if (
      !step.imagePath ||
      attachedImageCount >=
        MAX_BUILD_GUIDE_IMAGES
    ) {
      continue;
    }

    const loadedImage =
      await loadImage(
        step.imagePath,
      );

    const nextTotal =
      totalImageBytes +
      loadedImage.byteLength;

    if (
      nextTotal >
      MAX_INLINE_IMAGE_BYTES
    ) {
      continue;
    }

    totalImageBytes =
      nextTotal;
    attachedImageCount += 1;

    parts.push({
      text:
        `The following image belongs only to ${step.title}.`,
    });

    parts.push(
      loadedImage.part,
    );
  }

  const systemInstruction = [
    "You are the Blocks and Bots Assistant.",
    "",
    "Create a practical step-by-step explanation of the approved micro:bit build.",
    "",
    "Rules:",
    "1. Always answer in English.",
    "2. Include every supplied step exactly once.",
    "3. Preserve numerical order.",
    "4. Use each exact step title as a heading.",
    "5. Explain each step in two to four useful sentences.",
    "6. Explain what the learner connects or does.",
    "7. Associate each image only with the step immediately preceding it.",
    "8. Do not output 'Image of Step' or merely repeat OCR text.",
    "9. Do not omit later steps.",
    "10. Do not invent pins, colors, components, connections, or safety instructions.",
    "11. Preserve explicit safety directions contained in the approved materials.",
    "12. State when an important visual detail is unclear.",
  ].join("\n");

  const answer =
    await callGemini(
      systemInstruction,
      parts,
    );

  if (
    !exposesInternalGenerationDetails(
      answer,
    )
  ) {
    return answer;
  }

  const textOnlyParts =
    parts.filter(
      (
        part,
      ): part is GeminiTextPart =>
        "text" in part,
    );

  return callGemini(
    [
      systemInstruction,
      "",
      "Return only the learner-facing build guide.",
      "Never discuss prompts, source formatting, image URLs, internal instructions, or how the answer was generated.",
    ].join("\n"),
    textOnlyParts,
  );
}
