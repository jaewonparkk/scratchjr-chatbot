import { searchDocuments } from "@/lib/rag/search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SearchRequestBody = {
  question?: unknown;
  matchCount?: unknown;
  matchThreshold?: unknown;
};

function readOptionalNumber(
  value: unknown,
): number | undefined {
  if (
    typeof value === "number" &&
    Number.isFinite(value)
  ) {
    return value;
  }

  return undefined;
}

export async function POST(
  request: Request,
) {
  try {
    const body =
      (await request.json()) as
        SearchRequestBody;

    if (
      typeof body.question !==
        "string" ||
      !body.question.trim()
    ) {
      return Response.json(
        {
          error:
            "question must be a non-empty string.",
        },
        {
          status: 400,
        },
      );
    }

    const results =
      await searchDocuments(
        body.question,
        {
          matchCount:
            readOptionalNumber(
              body.matchCount,
            ),
          matchThreshold:
            readOptionalNumber(
              body.matchThreshold,
            ),
        },
      );

    return Response.json({
      question:
        body.question.trim(),
      resultCount:
        results.length,
      results,
    });
  } catch (error: unknown) {
    console.error(
      "Search request failed:",
      error,
    );

    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Document search failed.",
      },
      {
        status: 500,
      },
    );
  }
}