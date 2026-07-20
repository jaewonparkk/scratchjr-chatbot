import { promises as fs } from "node:fs";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ReviewDecisionValue =
  | "pending"
  | "approved"
  | "rejected";

type ReviewChunk = {
  id: string;
  title: string;
  content: string;
  source_file: string;
  file_type: string;
  section: string;
  chunk_index: number;
  page_number: number | null;
  slide_number: number | null;
  image_paths: string[];
  ocr_applied: boolean;
  requires_visual_review: boolean;
  should_display_image: boolean;
  status: string;
  metadata: Record<string, unknown>;
};

type ReviewDecision = {
  chunkId: string;
  decision: ReviewDecisionValue;
  editedContent: string;
  notes: string;
  reviewedAt: string;
};

type ReviewRequiredFile = {
  version: number;
  generated_at: string;
  review_count: number;
  chunks: ReviewChunk[];
};

type ReviewDecisionsFile = {
  version: number;
  updatedAt: string;
  decisions: ReviewDecision[];
};

const projectRoot = process.cwd();

const reviewRequiredPath = path.join(
  projectRoot,
  "knowledge",
  "processed",
  "review_required.json",
);

const reviewDecisionsPath = path.join(
  projectRoot,
  "knowledge",
  "processed",
  "review_decisions.json",
);

async function readJsonFile<T>(
  filePath: string,
  fallback: T,
): Promise<T> {
  try {
    const rawFile = await fs.readFile(
      filePath,
      "utf8",
    );

    return JSON.parse(rawFile) as T;
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return fallback;
    }

    throw error;
  }
}

async function writeJsonFile(
  filePath: string,
  data: unknown,
): Promise<void> {
  const temporaryPath = `${filePath}.tmp`;

  await fs.writeFile(
    temporaryPath,
    JSON.stringify(data, null, 2),
    "utf8",
  );

  await fs.rename(
    temporaryPath,
    filePath,
  );
}

function isDecisionValue(
  value: unknown,
): value is ReviewDecisionValue {
  return (
    value === "pending" ||
    value === "approved" ||
    value === "rejected"
  );
}

export async function GET() {
  try {
    const reviewFile =
      await readJsonFile<ReviewRequiredFile>(
        reviewRequiredPath,
        {
          version: 1,
          generated_at: "",
          review_count: 0,
          chunks: [],
        },
      );

    const decisionsFile =
      await readJsonFile<ReviewDecisionsFile>(
        reviewDecisionsPath,
        {
          version: 1,
          updatedAt: "",
          decisions: [],
        },
      );

    const decisionMap = new Map(
      decisionsFile.decisions.map(
        (decision) => [
          decision.chunkId,
          decision,
        ],
      ),
    );

    const items = reviewFile.chunks.map(
      (chunk) => ({
        ...chunk,
        decision:
          decisionMap.get(chunk.id) ?? null,
      }),
    );

    const approvedCount = items.filter(
      (item) =>
        item.decision?.decision ===
        "approved",
    ).length;

    const rejectedCount = items.filter(
      (item) =>
        item.decision?.decision ===
        "rejected",
    ).length;

    const pendingCount =
      items.length -
      approvedCount -
      rejectedCount;

    return Response.json({
      items,
      summary: {
        total: items.length,
        approved: approvedCount,
        rejected: rejectedCount,
        pending: pendingCount,
      },
    });
  } catch (error: unknown) {
    console.error(
      "Could not load review data:",
      error,
    );

    return Response.json(
      {
        error:
          "Could not load review data.",
      },
      {
        status: 500,
      },
    );
  }
}

export async function POST(
  request: Request,
) {
  try {
    const body = (await request.json()) as {
      chunkId?: unknown;
      decision?: unknown;
      editedContent?: unknown;
      notes?: unknown;
    };

    if (
      typeof body.chunkId !== "string" ||
      !body.chunkId.trim()
    ) {
      return Response.json(
        {
          error:
            "chunkId must be a non-empty string.",
        },
        {
          status: 400,
        },
      );
    }

    if (
      !isDecisionValue(body.decision)
    ) {
      return Response.json(
        {
          error:
            "decision must be pending, approved, or rejected.",
        },
        {
          status: 400,
        },
      );
    }

    const editedContent =
      typeof body.editedContent ===
      "string"
        ? body.editedContent.trim()
        : "";

    const notes =
      typeof body.notes === "string"
        ? body.notes.trim()
        : "";

    if (
      body.decision === "approved" &&
      !editedContent
    ) {
      return Response.json(
        {
          error:
            "Approved content cannot be empty.",
        },
        {
          status: 400,
        },
      );
    }

    const reviewFile =
      await readJsonFile<ReviewRequiredFile>(
        reviewRequiredPath,
        {
          version: 1,
          generated_at: "",
          review_count: 0,
          chunks: [],
        },
      );

    const matchingChunk =
      reviewFile.chunks.find(
        (chunk) =>
          chunk.id === body.chunkId,
      );

    if (!matchingChunk) {
      return Response.json(
        {
          error:
            "The requested review chunk was not found.",
        },
        {
          status: 404,
        },
      );
    }

    const decisionsFile =
      await readJsonFile<ReviewDecisionsFile>(
        reviewDecisionsPath,
        {
          version: 1,
          updatedAt: "",
          decisions: [],
        },
      );

    const updatedDecision: ReviewDecision =
      {
        chunkId: body.chunkId,
        decision: body.decision,
        editedContent,
        notes,
        reviewedAt:
          new Date().toISOString(),
      };

    const existingDecisionIndex =
      decisionsFile.decisions.findIndex(
        (decision) =>
          decision.chunkId ===
          body.chunkId,
      );

    if (existingDecisionIndex >= 0) {
      decisionsFile.decisions[
        existingDecisionIndex
      ] = updatedDecision;
    } else {
      decisionsFile.decisions.push(
        updatedDecision,
      );
    }

    decisionsFile.updatedAt =
      new Date().toISOString();

    await writeJsonFile(
      reviewDecisionsPath,
      decisionsFile,
    );

    return Response.json({
      success: true,
      decision: updatedDecision,
    });
  } catch (error: unknown) {
    console.error(
      "Could not save review decision:",
      error,
    );

    return Response.json(
      {
        error:
          "Could not save review decision.",
      },
      {
        status: 500,
      },
    );
  }
}