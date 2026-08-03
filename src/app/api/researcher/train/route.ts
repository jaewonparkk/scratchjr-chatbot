import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

import { updateResearcherManifest } from "@/lib/researcher/manifest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const run = promisify(execFile);

let pythonSetupPromise: Promise<string> | null =
  null;

async function preparePython(
  projectRoot: string,
): Promise<string> {
  const configuredPython =
    process.env.PYTHON_BIN;

  if (configuredPython) {
    return configuredPython;
  }

  const virtualEnvironment = path.join(
    projectRoot,
    ".venv",
  );

  const virtualPython = path.join(
    virtualEnvironment,
    "bin",
    "python",
  );

  try {
    await run(
      virtualPython,
      [
        "-c",
        "import docx, fitz, pptx",
      ],
      {
        cwd: projectRoot,
        timeout: 30_000,
      },
    );

    return virtualPython;
  } catch {
    await run(
      "python3",
      ["-m", "venv", virtualEnvironment],
      {
        cwd: projectRoot,
        timeout: 2 * 60_000,
      },
    );

    await run(
      virtualPython,
      [
        "-m",
        "pip",
        "install",
        "--disable-pip-version-check",
        "-r",
        path.join(
          projectRoot,
          "ingestion",
          "requirements.txt",
        ),
      ],
      {
        cwd: projectRoot,
        timeout: 10 * 60_000,
        maxBuffer: 4 * 1024 * 1024,
      },
    );

    return virtualPython;
  }
}

function getPython(
  projectRoot: string,
): Promise<string> {
  if (!pythonSetupPromise) {
    pythonSetupPromise =
      preparePython(
        projectRoot,
      ).catch((error: unknown) => {
        pythonSetupPromise = null;
        throw error;
      });
  }

  return pythonSetupPromise;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { fileName?: unknown; filePath?: unknown };
    if (
      typeof body.fileName !== "string" ||
      path.basename(body.fileName) !== body.fileName ||
      typeof body.filePath !== "string"
    ) {
      return Response.json({ error: "Choose a valid saved file." }, { status: 400 });
    }

    const projectRoot = process.cwd();
    const absoluteSource = path.resolve(projectRoot, body.filePath);
    const allowedRoots = [
      path.resolve(projectRoot, "knowledge", "raw", "researcher"),
      path.resolve(projectRoot, "knowledge", "raw", "microbit"),
    ];
    const isAllowed = allowedRoots.some((root) => {
      const relative = path.relative(root, absoluteSource);
      return !relative.startsWith("..") && !path.isAbsolute(relative);
    });
    if (!isAllowed || path.basename(absoluteSource) !== body.fileName) {
      return Response.json({ error: "That file is outside the active library." }, { status: 403 });
    }

    const python = await getPython(
      projectRoot,
    );

    const parsed = await run(
      python,
      ["-m", "ingestion.researcher_ingest", path.relative(projectRoot, absoluteSource)],
      { cwd: projectRoot, timeout: 5 * 60_000, maxBuffer: 2 * 1024 * 1024 },
    );

    const processedPath = parsed.stdout.trim().split(/\r?\n/).at(-1);
    if (!processedPath) throw new Error("Ingestion did not return an output file.");

    const trained = await run(
      process.execPath,
      [path.join(projectRoot, "node_modules", "tsx", "dist", "cli.mjs"), "scripts/train-researcher-file.ts", processedPath],
      { cwd: projectRoot, timeout: 10 * 60_000, maxBuffer: 4 * 1024 * 1024 },
    );

    await updateResearcherManifest(body.fileName, "trained");
    return Response.json({ success: true, message: trained.stdout.trim() || "Training complete." });
  } catch (error: unknown) {
    console.error("Researcher training failed:", error);
    return Response.json(
      {
        error:
          "Training could not start. The server could not prepare or run the document processor.",
      },
      { status: 500 },
    );
  }
}
