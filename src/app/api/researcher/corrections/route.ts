import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import { updateResearcherManifest } from "@/lib/researcher/manifest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const run = promisify(execFile);

export async function POST(request: Request) {
  let temporaryPath = "";

  try {
    const body = (await request.json()) as {
      fileName?: unknown;
      filePath?: unknown;
      question?: unknown;
      assistantAnswer?: unknown;
      correctedAnswer?: unknown;
    };

    if (
      typeof body.fileName !== "string" ||
      path.basename(body.fileName) !== body.fileName ||
      typeof body.filePath !== "string" ||
      typeof body.question !== "string" ||
      body.question.trim().length < 1 ||
      body.question.trim().length > 2_000 ||
      typeof body.assistantAnswer !== "string" ||
      body.assistantAnswer.trim().length < 1 ||
      body.assistantAnswer.trim().length > 10_000 ||
      typeof body.correctedAnswer !== "string" ||
      body.correctedAnswer.trim().length < 10 ||
      body.correctedAnswer.trim().length > 10_000
    ) {
      return Response.json(
        { error: "Test a trained file and enter an improved answer between 10 and 10,000 characters." },
        { status: 400 },
      );
    }

    const projectRoot = process.cwd();
    const absoluteSource = path.resolve(projectRoot, body.filePath);
    const allowedRoots = [
      path.resolve(projectRoot, "knowledge", "raw", "researcher"),
      path.resolve(projectRoot, "knowledge", "raw", "microbit"),
    ];
    if (!allowedRoots.some((root) => {
      const relative = path.relative(root, absoluteSource);
      return !relative.startsWith("..") && !path.isAbsolute(relative);
    })) {
      return Response.json({ error: "That file is outside the active library." }, { status: 403 });
    }
    const processedDirectory = path.join(
      projectRoot,
      "knowledge",
      "processed",
      "researcher",
    );
    const processedPath = path.join(
      processedDirectory,
      `${path.parse(body.fileName).name}.json`,
    );

    let parsed: { chunks?: Array<Record<string, unknown>> };

    try {
      parsed = JSON.parse(await fs.readFile(processedPath, "utf8")) as {
        chunks?: Array<Record<string, unknown>>;
      };
    } catch (error: unknown) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
        throw error;
      }

      const reviewedPath = path.join(
        projectRoot,
        "knowledge",
        "processed",
        "reviewed_documents.json",
      );
      const reviewed = JSON.parse(await fs.readFile(reviewedPath, "utf8")) as {
        chunks?: Array<Record<string, unknown> & { source_file?: string }>;
      };
      parsed = {
        chunks: (reviewed.chunks ?? []).filter(
          (chunk) => path.basename(chunk.source_file ?? "") === body.fileName,
        ),
      };
    }
    if (!Array.isArray(parsed.chunks)) throw new Error("The trained file data is invalid.");

    const question = body.question.trim();
    const assistantAnswer = body.assistantAnswer.trim();
    const correctedAnswer = body.correctedAnswer.trim();
    const content = `Question: ${question}\n\nCorrect answer: ${correctedAnswer}`;
    const feedbackRecord = [
      `Question: ${question}`,
      `Assistant answered: ${assistantAnswer}`,
      `Teacher's improved answer: ${correctedAnswer}`,
    ].join("\n\n");
    const id = `researcher-correction-${createHash("sha256")
      .update(`${body.fileName}\n${content}`)
      .digest("hex")
      .slice(0, 24)}`;

    const withoutDuplicate = parsed.chunks.filter((chunk) => chunk.id !== id);
    const sourceFile = path.relative(projectRoot, absoluteSource);
    const corrected = {
      chunks: [
        ...withoutDuplicate,
        {
          id,
          title: `Teacher correction — ${body.fileName}`,
          content,
          source_file: sourceFile,
          file_type: path.extname(body.fileName).slice(1).toLowerCase(),
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
            corrected_answer: correctedAnswer,
            corrected_at: new Date().toISOString(),
          },
        },
      ],
    };

    temporaryPath = path.join(
      processedDirectory,
      `${path.parse(body.fileName).name}.correction-${Date.now()}.json`,
    );
    await fs.writeFile(temporaryPath, JSON.stringify(corrected, null, 2), "utf8");

    const relativeTemporaryPath = path.relative(projectRoot, temporaryPath);
    await run(
      process.execPath,
      [
        path.join(projectRoot, "node_modules", "tsx", "dist", "cli.mjs"),
        "scripts/train-researcher-file.ts",
        relativeTemporaryPath,
      ],
      {
        cwd: projectRoot,
        timeout: 10 * 60_000,
        maxBuffer: 4 * 1024 * 1024,
      },
    );

    await fs.rename(temporaryPath, processedPath);
    temporaryPath = "";

    await updateResearcherManifest(body.fileName, "trained", feedbackRecord);

    return Response.json({
      success: true,
      message: "The improved answer was saved and the file was retrained.",
    });
  } catch (error: unknown) {
    console.error("Researcher correction failed:", error);
    return Response.json(
      { error: "The correction could not be saved or retrained." },
      { status: 500 },
    );
  } finally {
    if (temporaryPath) {
      await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
    }
  }
}
