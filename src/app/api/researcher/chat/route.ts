import { GoogleGenAI } from "@google/genai";
import { promises as fs } from "node:fs";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Chunk = {
  title?: string;
  content?: string;
  page_number?: number | null;
  slide_number?: number | null;
  section?: string;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      fileName?: unknown;
      question?: unknown;
      history?: unknown;
    };

    if (
      typeof body.fileName !== "string" ||
      path.basename(body.fileName) !== body.fileName ||
      typeof body.question !== "string" ||
      !body.question.trim()
    ) {
      return Response.json({ error: "Choose a trained file and enter a question." }, { status: 400 });
    }

    const processedPath = path.join(
      process.cwd(),
      "knowledge",
      "processed",
      "researcher",
      `${path.parse(body.fileName).name}.json`,
    );

    let chunks: Chunk[] = [];

    try {
      const parsed = JSON.parse(await fs.readFile(processedPath, "utf8")) as { chunks?: Chunk[] };
      chunks = Array.isArray(parsed.chunks) ? parsed.chunks : [];
    } catch (error: unknown) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;

      const reviewedPath = path.join(
        process.cwd(),
        "knowledge",
        "processed",
        "reviewed_documents.json",
      );
      const reviewed = JSON.parse(await fs.readFile(reviewedPath, "utf8")) as {
        chunks?: Array<Chunk & { source_file?: string }>;
      };
      chunks = (reviewed.chunks ?? []).filter(
        (chunk) => path.basename(chunk.source_file ?? "") === body.fileName,
      );
    }

    if (chunks.length === 0) {
      throw new Error("This file has not been trained yet.");
    }

    const context = [...chunks]
      .sort((a, b) => (a.page_number ?? a.slide_number ?? 9999) - (b.page_number ?? b.slide_number ?? 9999))
      .map((chunk, index) => [
        `[PART ${index + 1}]`,
        `Title: ${chunk.title ?? "Untitled"}`,
        `Location: ${chunk.page_number ? `Page ${chunk.page_number}` : chunk.slide_number ? `Slide ${chunk.slide_number}` : "Document"}`,
        `Section: ${chunk.section ?? ""}`,
        chunk.content ?? "",
      ].join("\n"))
      .join("\n\n---\n\n");

    const history = Array.isArray(body.history)
      ? body.history.slice(-8).map((item) => JSON.stringify(item)).join("\n")
      : "No earlier Researcher conversation.";

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY is missing.");

    const client = new GoogleGenAI({ apiKey });
    const response = await client.models.generateContent({
      model: process.env.GEMINI_MODEL ?? "gemini-2.5-flash",
      contents: [{
        role: "user",
        parts: [{ text: `FILE: ${body.fileName}\n\nALL EXTRACTED CONTENT:\n${context}\n\nRECENT RESEARCHER CHAT:\n${history}\n\nQUESTION:\n${body.question}` }],
      }],
      config: {
        temperature: 0.1,
        maxOutputTokens: 4096,
        systemInstruction: "Answer only from the selected file. Use all relevant parts, preserve page order, and explain clearly. For a walkthrough or summary, cover the entire extracted file rather than selecting only the most similar part. If extraction appears incomplete, say exactly what is missing.",
      },
    });

    const answer = response.text?.trim();
    if (!answer) throw new Error("No answer was generated.");

    return Response.json({ answer, chunkCount: chunks.length });
  } catch (error: unknown) {
    console.error("Researcher chat failed:", error);
    return Response.json(
      { error: error instanceof Error && error.message.includes("not been trained") ? error.message : "Could not check this file." },
      { status: 500 },
    );
  }
}
