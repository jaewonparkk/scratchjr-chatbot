import "server-only";

import { GoogleGenAI } from "@google/genai";
import { readFile } from "node:fs/promises";
import path from "node:path";

const GEMINI_MODEL =
  process.env.GEMINI_MODEL ??
  "gemini-2.5-flash";

const MAX_INLINE_IMAGE_BYTES =
  18 * 1024 * 1024;

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

type GenerateGroundedAnswerInput = {
  question: string;
  context: string;
};

type GenerateGroundedStepAnswerInput = {
  question: string;
  title: string;
  context: string;
  imagePath: string | null;
};

export type GeminiBuildStep = {
  title: string;
  content: string;
  imagePath: string | null;
};

type GenerateGroundedBuildGuideInput = {
  question: string;
  steps: GeminiBuildStep[];
};

type LoadedImage = {
  part: GeminiImagePart;
  byteLength: number;
};

let geminiClient:
  | GoogleGenAI
  | null = null;

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

function resolveApprovedImagePath(
  imagePath: string,
): string {
  const projectRoot =
    process.cwd();

  const approvedImageDirectory =
    path.resolve(
      projectRoot,
      "knowledge",
      "processed",
      "images",
    );

  const absoluteImagePath =
    path.resolve(
      projectRoot,
      imagePath,
    );

  const relativePath =
    path.relative(
      approvedImageDirectory,
      absoluteImagePath,
    );

  if (
    relativePath.startsWith("..") ||
    path.isAbsolute(relativePath)
  ) {
    throw new Error(
      "The requested image is outside the approved image directory.",
    );
  }

  return absoluteImagePath;
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
      `Unsupported image type: ${extension}`,
    );
  }

  return mimeType;
}

async function loadImage(
  imagePath: string,
): Promise<LoadedImage> {
  const absoluteImagePath =
    resolveApprovedImagePath(
      imagePath,
    );

  const imageBuffer =
    await readFile(
      absoluteImagePath,
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
  contents: GeminiPart[],
): Promise<string> {
  const client =
    getGeminiClient();

  const response =
    await client.models.generateContent({
      model: GEMINI_MODEL,

      contents,

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

  return answer;
}

export async function generateGroundedAnswer({
  question,
  context,
}: GenerateGroundedAnswerInput): Promise<string> {
  const systemInstruction = [
    "You are the Blocks and Bots Assistant.",
    "",
    "Answer teachers, parents, facilitators, and learners using only the approved curriculum information supplied by the application.",
    "",
    "Rules:",
    "1. Always answer in English.",
    "2. Answer the user's exact question.",
    "3. Do not summarize an entire lesson or document unless the user explicitly requests a summary or overview.",
    "4. Ignore retrieved information that is unrelated to the question.",
    "5. Give a direct but useful answer.",
    "6. Normally use one or two focused paragraphs.",
    "7. Use numbered steps only for procedures or when the user explicitly asks for step-by-step instructions.",
    "8. Do not copy large portions of the source text.",
    "9. Do not invent wiring connections, pin numbers, colors, parts, curriculum directions, safety claims, or troubleshooting instructions.",
    "10. When the approved information is insufficient, clearly say so.",
    "11. Do not mention prompts, context windows, retrieval, embeddings, databases, Ollama, Gemini, or other models.",
    "12. Do not invent citations or source names.",
  ].join("\n");

  return callGemini(
    systemInstruction,
    [
      {
        text: [
          "APPROVED CURRICULUM INFORMATION",
          "===============================",
          context,
          "",
          "USER QUESTION",
          "=============",
          question,
          "",
          "Answer the exact question using only the relevant approved information.",
          "Give a useful explanation instead of copying or broadly summarizing the document.",
        ].join("\n"),
      },
    ],
  );
}

export async function generateGroundedStepAnswer({
  question,
  title,
  context,
  imagePath,
}: GenerateGroundedStepAnswerInput): Promise<string> {
  const contents: GeminiPart[] = [
    {
      text: [
        `EXACT STEP TITLE: ${title}`,
        "",
        "APPROVED STEP TEXT",
        "==================",
        context,
        "",
        "USER QUESTION",
        "=============",
        question,
        "",
        "Explain this exact build step.",
      ].join("\n"),
    },
  ];

  if (imagePath) {
    const loadedImage =
      await loadImage(
        imagePath,
      );

    contents.push({
      text:
        "The following approved image belongs to this exact step.",
    });

    contents.push(
      loadedImage.part,
    );
  }

  const systemInstruction = [
    "You are the Blocks and Bots Assistant.",
    "",
    "Explain one exact approved micro:bit build step using its approved text and attached image.",
    "",
    "Rules:",
    "1. Always answer in English.",
    "2. Begin with the exact step title.",
    "3. Explain the purpose of the step.",
    "4. Explain what the learner should connect or do in three to six useful sentences.",
    "5. Use the attached image to identify visible parts and connections.",
    "6. Refer to the image when it helps the learner locate a connection.",
    "7. Do not merely repeat the title, OCR text, image caption, or the phrase 'Image of Step'.",
    "8. Do not explain unrelated steps or summarize the entire build.",
    "9. Do not invent wire colors, pins, components, connections, or safety instructions.",
    "10. If an important visual detail is unclear, say exactly what is unclear instead of guessing.",
    "11. Do not claim that an image is missing when an image is attached.",
  ].join("\n");

  return callGemini(
    systemInstruction,
    contents,
  );
}

export async function generateGroundedBuildGuide({
  question,
  steps,
}: GenerateGroundedBuildGuideInput): Promise<string> {
  if (steps.length === 0) {
    throw new Error(
      "No approved build steps were supplied.",
    );
  }

  const contents: GeminiPart[] = [
    {
      text: [
        "USER QUESTION",
        "=============",
        question,
        "",
        "The approved build steps follow in numerical order.",
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

    contents.push({
      text: [
        "",
        `APPROVED BUILD STEP ${index + 1}`,
        "========================",
        `Exact title: ${step.title}`,
        "",
        "Approved text:",
        step.content,
      ].join("\n"),
    });

    if (!step.imagePath) {
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

    contents.push({
      text:
        `The following approved image belongs to ${step.title}.`,
    });

    contents.push(
      loadedImage.part,
    );
  }

  contents.push({
    text: [
      "",
      `Attached approved step images: ${attachedImageCount}`,
      `Total approved steps: ${steps.length}`,
      "",
      "Explain every approved step in the supplied numerical order.",
    ].join("\n"),
  });

  const systemInstruction = [
    "You are the Blocks and Bots Assistant.",
    "",
    "Create a practical step-by-step explanation of the approved micro:bit build.",
    "",
    "Rules:",
    "1. Always answer in English.",
    "2. Include every approved build step exactly once.",
    "3. Preserve the supplied numerical order.",
    "4. Use each exact step title as a heading.",
    "5. Explain each step in two to four useful sentences.",
    "6. Explain what the learner connects or does and why that action matters for the build.",
    "7. Use each attached image only for the step immediately preceding it.",
    "8. Do not output phrases such as 'Image of Step' or merely say 'parts from the previous step'.",
    "9. Do not copy OCR text without explaining it.",
    "10. Do not omit later steps.",
    "11. Do not invent colors, pins, components, connections, or safety instructions.",
    "12. Preserve explicit safety directions that appear in the approved material, but do not create new ones.",
    "13. If an image or text does not clearly show an important detail, say what is unclear rather than guessing.",
    "14. Do not include an unrelated lesson summary.",
  ].join("\n");

  return callGemini(
    systemInstruction,
    contents,
  );
}