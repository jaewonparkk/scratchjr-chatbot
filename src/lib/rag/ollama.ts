import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

const OLLAMA_BASE_URL =
  process.env.OLLAMA_BASE_URL ??
  "http://127.0.0.1:11434";

const OLLAMA_MODEL =
  process.env.OLLAMA_MODEL ??
  "qwen3:4b-instruct";

const OLLAMA_VISION_MODEL =
  process.env.OLLAMA_VISION_MODEL ??
  "qwen2.5vl:3b";

const TEXT_TIMEOUT_MS = 120_000;
const VISION_TIMEOUT_MS = 180_000;

type GenerateAnswerInput = {
  question: string;
  context: string;
};

type GenerateVisionAnswerInput = {
  question: string;
  context: string;
  imagePath: string;
};

type OllamaMessage = {
  role: "system" | "user";
  content: string;
  images?: string[];
};

type OllamaChatResponse = {
  message?: {
    role?: string;
    content?: string;
  };
  error?: string;
};

type RequestOllamaInput = {
  model: string;
  messages: OllamaMessage[];
  timeoutMs: number;
  think?: boolean;
};

async function requestOllama({
  model,
  messages,
  timeoutMs,
  think,
}: RequestOllamaInput): Promise<string> {
  const controller =
    new AbortController();

  const timeout = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetch(
      `${OLLAMA_BASE_URL}/api/chat`,
      {
        method: "POST",
        headers: {
          "Content-Type":
            "application/json",
        },
        body: JSON.stringify({
          model,
          stream: false,

          ...(typeof think === "boolean"
            ? { think }
            : {}),

          options: {
            temperature: 0.1,
          },

          messages,
        }),
        cache: "no-store",
        signal: controller.signal,
      },
    );

    const data =
      (await response.json()) as
        OllamaChatResponse;

    if (!response.ok) {
      throw new Error(
        data.error ??
          `Ollama returned status ${response.status}.`,
      );
    }

    const answer =
      data.message?.content?.trim();

    if (!answer) {
      throw new Error(
        "Ollama returned an empty answer.",
      );
    }

    return answer;
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      error.name === "AbortError"
    ) {
      throw new Error(
        "The local Ollama model timed out.",
      );
    }

    if (
      error instanceof TypeError
    ) {
      throw new Error(
        "Could not connect to Ollama. Make sure Ollama is running on port 11434.",
      );
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function generateGroundedAnswer({
  question,
  context,
}: GenerateAnswerInput): Promise<string> {
  return requestOllama({
    model: OLLAMA_MODEL,
    timeoutMs: TEXT_TIMEOUT_MS,
    think: false,

    messages: [
      {
        role: "system",
        content: [
          "You are the Blocks and Bots Assistant.",
          "",
          "Answer questions for teachers, parents, facilitators, and learners using only the approved curriculum context.",
          "",
          "Response rules:",
          "1. Always answer in English.",
          "2. Answer the user's exact question.",
          "3. Do not summarize an entire document or lesson unless the user explicitly requests a summary or overview.",
          "4. Ignore context that is unrelated to the specific question.",
          "5. Give the direct answer first.",
          "6. Provide enough explanation to be useful. Do not reduce an answer to a bare title or one vague sentence.",
          "7. For a normal question, use one or two focused paragraphs.",
          "8. Use numbered steps only for procedures or when the user requests step-by-step instructions.",
          "9. When explaining a lesson, describe its main purpose and the activities directly related to the question. Do not dump every detail from the lesson.",
          "10. Never invent wiring instructions, pin numbers, component names, curriculum directions, safety claims, or troubleshooting steps.",
          "11. If the approved context is insufficient, clearly say that the approved materials do not provide enough verified information.",
          "12. Do not mention the retrieval process, database, context window, or language model.",
          "13. Do not invent citations or source names.",
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          "APPROVED CONTEXT",
          "================",
          context,
          "",
          "USER QUESTION",
          "=============",
          question,
          "",
          "Answer the exact question using only the relevant approved information.",
          "Provide a useful explanation rather than copying or broadly summarizing the source.",
        ].join("\n"),
      },
    ],
  });
}

function resolveApprovedImagePath(
  imagePath: string,
): string {
  const projectRoot =
    process.cwd();

  const allowedDirectory =
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
      allowedDirectory,
      absoluteImagePath,
    );

  if (
    relativePath.startsWith("..") ||
    path.isAbsolute(relativePath)
  ) {
    throw new Error(
      "The requested image path is outside the approved image directory.",
    );
  }

  return absoluteImagePath;
}

export async function generateGroundedVisionAnswer({
  question,
  context,
  imagePath,
}: GenerateVisionAnswerInput): Promise<string> {
  const absoluteImagePath =
    resolveApprovedImagePath(
      imagePath,
    );

  const imageBuffer =
    await readFile(
      absoluteImagePath,
    );

  const base64Image =
    imageBuffer.toString(
      "base64",
    );

  return requestOllama({
    model: OLLAMA_VISION_MODEL,
    timeoutMs: VISION_TIMEOUT_MS,

    messages: [
      {
        role: "system",
        content: [
          "You are the Blocks and Bots Assistant.",
          "",
          "Explain the exact approved curriculum step using both the provided text and the attached approved image.",
          "",
          "Rules:",
          "1. Always answer in English.",
          "2. Begin with the exact step title.",
          "3. Explain the purpose of the step.",
          "4. Clearly explain what the learner should connect or do.",
          "5. Use three to six useful sentences after the title.",
          "6. Refer to visible parts and connections in the image when they help explain the step.",
          "7. Do not merely repeat the title, OCR text, or image caption.",
          "8. Do not summarize the entire build or explain unrelated steps.",
          "9. Do not invent wire colors, pin numbers, component names, safety instructions, or connections that are not clearly visible or stated.",
          "10. When an important detail is unclear, say which detail is unclear rather than guessing.",
          "11. Do not say that no image was provided. The approved image is attached.",
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          "APPROVED TEXT",
          "=============",
          context,
          "",
          "USER QUESTION",
          "=============",
          question,
          "",
          "Explain this exact step using the approved text and attached image.",
          "Give the learner a practical explanation, not a summary or transcription.",
        ].join("\n"),

        images: [
          base64Image,
        ],
      },
    ],
  });
}