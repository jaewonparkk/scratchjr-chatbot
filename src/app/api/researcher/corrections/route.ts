import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const run = promisify(execFile);

export async function POST(request: Request) {
  let temporaryPath = "";

  try {
    const body = (await request.json()) as {
      fileName?: unknown;
      content?: unknown;
    };

    if (
      typeof body.fileName !== "string" ||
      path.basename(body.fileName) !== body.fileName ||
      typeof body.content !== "string" ||
      body.content.trim().length < 10 ||
      body.content.trim().length > 10_000
    ) {
      return Response.json(
        { error: "Choose a trained file and enter a correction between 10 and 10,000 characters." },
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
      `${path.parse(body.fileName).name}.json`,
    );

    const parsed = JSON.parse(await fs.readFile(processedPath, "utf8")) as {
      chunks?: Array<Record<string, unknown>>;
    };
    if (!Array.isArray(parsed.chunks)) throw new Error("The trained file data is invalid.");

    const content = body.content.trim();
    const id = `researcher-correction-${createHash("sha256")
      .update(`${body.fileName}\n${content}`)
      .digest("hex")
      .slice(0, 24)}`;

    const withoutDuplicate = parsed.chunks.filter((chunk) => chunk.id !== id);
    const sourceFile = `knowledge/raw/researcher/${body.fileName}`;
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

    return Response.json({
      success: true,
      message: "The correction was saved and the file was retrained.",
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
