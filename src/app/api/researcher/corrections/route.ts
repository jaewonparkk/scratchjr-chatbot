import { GoogleGenAI } from "@google/genai";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const run = promisify(execFile);

function normalizeQuestion(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function GET() {
  try {
    const feedbackPath = path.join(
      process.cwd(),
      "knowledge",
      "processed",
      "researcher",
      "teacher-feedback.json",
    );
    const parsed = JSON.parse(await fs.readFile(feedbackPath, "utf8")) as {
      chunks?: Array<{ metadata?: Record<string, unknown> }>;
    };
    const corrections: Record<string, string> = {};
    for (const chunk of parsed.chunks ?? []) {
      const question = chunk.metadata?.tested_question;
      const answer = chunk.metadata?.corrected_answer;
      if (typeof question === "string" && typeof answer === "string") {
        corrections[normalizeQuestion(question)] = answer.trim();
      }
    }
    return Response.json({ corrections });
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return Response.json({ corrections: {} });
    }
    return Response.json({ error: "Could not load teacher corrections." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  let temporaryPath = "";
  let operation: "preview" | "save" = "save";

  try {
    const body = (await request.json()) as {
      question?: unknown;
      assistantAnswer?: unknown;
      correctedAnswer?: unknown;
      feedbackInstruction?: unknown;
      mode?: unknown;
      history?: unknown;
    };

    const mode = body.mode === "preview" ? "preview" : "save";
    operation = mode;

    const feedbackInstruction = typeof body.feedbackInstruction === "string"
      ? body.feedbackInstruction
      : body.correctedAnswer;

    if (
      (mode === "preview" && (
        typeof feedbackInstruction !== "string" ||
        feedbackInstruction.trim().length < 1 ||
        feedbackInstruction.trim().length > 10_000
      )) ||
      (mode === "save" && (
        typeof body.question !== "string" ||
        body.question.trim().length < 1 ||
        body.question.trim().length > 2_000 ||
        typeof body.assistantAnswer !== "string" ||
        body.assistantAnswer.trim().length < 1 ||
        body.assistantAnswer.trim().length > 10_000 ||
        typeof body.correctedAnswer !== "string" ||
        body.correctedAnswer.trim().length < 1 ||
        body.correctedAnswer.trim().length > 10_000
      ))
    ) {
      return Response.json(
        { error: "Test an answer and tell the assistant what you want changed." },
        { status: 400 },
      );
    }

    const projectRoot = process.cwd();
    const processedDirectory = path.join(
      projectRoot,
      "knowledge",
      "processed",
      "researcher",
    );
    const processedPath = path.join(
      processedDirectory,
      "teacher-feedback.json",
    );
    await fs.mkdir(processedDirectory, { recursive: true });

    let parsed: { chunks?: Array<Record<string, unknown>> };

    try {
      parsed = JSON.parse(await fs.readFile(processedPath, "utf8")) as {
        chunks?: Array<Record<string, unknown>>;
      };
    } catch (error: unknown) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
        throw error;
      }

      parsed = { chunks: [] };
    }
    if (!Array.isArray(parsed.chunks)) throw new Error("The trained file data is invalid.");

    let question = typeof body.question === "string" ? body.question.trim() : "";
    let assistantAnswer = typeof body.assistantAnswer === "string" ? body.assistantAnswer.trim() : "";
    const teacherInstruction = typeof feedbackInstruction === "string"
      ? feedbackInstruction.trim()
      : "Teacher approved this revised answer.";
    let correctedAnswer: string;

    if (mode === "preview") {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) throw new Error("GEMINI_API_KEY is missing.");
      const client = new GoogleGenAI({ apiKey });
      const hasSelectedAnswer = Boolean(question && assistantAnswer);
      const history = Array.isArray(body.history)
        ? body.history.slice(-100).map((item) => JSON.stringify(item)).join("\n")
        : "No saved chat history was supplied.";
      const revision = await client.models.generateContent({
        model: process.env.GEMINI_MODEL ?? "gemini-2.5-flash",
        contents: [{
          role: "user",
          parts: [{ text: hasSelectedAnswer ? [
            `QUESTION:\n${question}`,
            `CURRENT ANSWER:\n${assistantAnswer}`,
            `TEACHER FEEDBACK:\n${teacherInstruction}`,
          ].join("\n\n") : [
            `SAVED CHAT HISTORY:\n${history}`,
            `TEACHER FEEDBACK:\n${teacherInstruction}`,
            "Identify the answer the teacher is referring to, even if they describe or quote it informally.",
          ].join("\n\n") }],
        }],
        config: {
          temperature: 0.1,
          maxOutputTokens: 4096,
          systemInstruction: "Return exactly three sections using these delimiter lines: <<<QUESTION>>>, <<<ORIGINAL_ANSWER>>>, and <<<CORRECTED_ANSWER>>>. Put the matching content after each delimiter. Do not use JSON and do not add any other sections or commentary. If a question and current answer are supplied, preserve them in the first two sections. Otherwise, infer the referenced question and assistant answer from the saved chat history and teacher feedback. Revise that answer according to the teacher's conversational feedback. The corrected section must contain only the complete final answer teachers should receive. Preserve accurate facts unless explicitly corrected. If no target can be identified, leave the first two sections empty.",
        },
      });
      const previewText = revision.text?.trim() ?? "";
      const questionMatch = previewText.match(
        /<<<QUESTION>>>\s*([\s\S]*?)\s*<<<ORIGINAL_ANSWER>>>/,
      );
      const originalMatch = previewText.match(
        /<<<ORIGINAL_ANSWER>>>\s*([\s\S]*?)\s*<<<CORRECTED_ANSWER>>>/,
      );
      const correctedMatch = previewText.match(
        /<<<CORRECTED_ANSWER>>>\s*([\s\S]*)$/,
      );
      question = questionMatch?.[1]?.trim() ?? "";
      assistantAnswer = originalMatch?.[1]?.trim() ?? "";
      correctedAnswer = correctedMatch?.[1]?.trim() ?? "";
      if (!question || !assistantAnswer || !correctedAnswer) {
        return Response.json(
          { error: "I couldn't tell which earlier answer you meant. Include a few words from that answer or describe the earlier question." },
          { status: 400 },
        );
      }
      return Response.json({ question, assistantAnswer, correctedAnswer });
    }

    correctedAnswer = (body.correctedAnswer as string).trim();
    const content = `Question: ${question}\n\nCorrect answer: ${correctedAnswer}`;
    const id = `researcher-correction-${createHash("sha256")
      .update(question.normalize("NFKC").toLocaleLowerCase())
      .digest("hex")
      .slice(0, 24)}`;

    const normalizedQuestion = question
      .normalize("NFKC")
      .toLocaleLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
    const withoutDuplicate = parsed.chunks.filter((chunk) => {
      if (chunk.id === id) return false;
      const metadata = chunk.metadata;
      if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return true;
      const testedQuestion = (metadata as Record<string, unknown>).tested_question;
      return typeof testedQuestion !== "string" ||
        testedQuestion
          .normalize("NFKC")
          .toLocaleLowerCase()
          .replace(/[^\p{L}\p{N}]+/gu, " ")
          .replace(/\s+/g, " ")
          .trim() !== normalizedQuestion;
    });
    const sourceFile = "knowledge/approved/teacher-feedback.md";
    const corrected = {
      chunks: [
        ...withoutDuplicate,
        {
          id,
          title: "Authoritative teacher correction",
          content,
          source_file: sourceFile,
          file_type: "markdown",
          section: "Teacher correction",
          chunk_index: withoutDuplicate.length,
          page_number: null,
          slide_number: null,
          image_paths: [],
          ocr_applied: false,
          requires_visual_review: false,
          should_display_image: false,
          status: "ready",
          metadata: {
            researcher_upload: true,
            researcher_correction: true,
            tested_question: question,
            assistant_answer: assistantAnswer,
            teacher_feedback_instruction: teacherInstruction,
            corrected_answer: correctedAnswer,
            corrected_at: new Date().toISOString(),
          },
        },
      ],
    };

    temporaryPath = path.join(
      processedDirectory,
      `teacher-feedback.correction-${Date.now()}.json`,
    );
    await fs.writeFile(temporaryPath, JSON.stringify(corrected, null, 2), "utf8");
    await fs.rename(temporaryPath, processedPath);
    temporaryPath = "";

    let embeddingSynced = true;
    try {
      await run(
        process.execPath,
        [
          path.join(projectRoot, "node_modules", "tsx", "dist", "cli.mjs"),
          "scripts/train-researcher-file.ts",
          path.relative(projectRoot, processedPath),
        ],
        {
          cwd: projectRoot,
          timeout: 10 * 60_000,
          maxBuffer: 4 * 1024 * 1024,
        },
      );
    } catch (embeddingError: unknown) {
      embeddingSynced = false;
      console.error("Teacher feedback embedding sync failed:", embeddingError);
    }

    return Response.json({
      success: true,
      embeddingSynced,
      correctedAnswer,
      message: embeddingSynced
        ? "Your feedback was applied, saved, and retrained."
        : "Your feedback was applied and is active for this question.",
    });
  } catch (error: unknown) {
    console.error("Researcher correction failed:", error);
    const detail = error instanceof Error ? error.message : "Unknown server error";
    return Response.json(
      {
        error: operation === "preview"
          ? `The improved answer preview could not be generated: ${detail}`
          : `The correction could not be saved: ${detail}`,
      },
      { status: 500 },
    );
  } finally {
    if (temporaryPath) {
      await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
    }
  }
}
