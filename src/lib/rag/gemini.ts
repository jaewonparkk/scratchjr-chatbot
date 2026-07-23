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

type GroundedStepAnswerInput = {
  question: string;
  guideName: string;
  title: string;
  context: string;
  imagePath: string | null;
  history?: ChatHistoryMessage[];
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
