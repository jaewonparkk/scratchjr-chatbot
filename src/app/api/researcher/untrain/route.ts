import { promises as fs } from "node:fs";
import path from "node:path";

import { updateResearcherManifest } from "@/lib/researcher/manifest";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { fileName?: unknown; filePath?: unknown };
    if (
      typeof body.fileName !== "string" ||
      path.basename(body.fileName) !== body.fileName ||
      typeof body.filePath !== "string"
    ) {
      return Response.json({ error: "Choose a valid Researcher file." }, { status: 400 });
    }

    const processedPath = path.join(
      process.cwd(), "knowledge", "processed", "researcher", `${path.parse(body.fileName).name}.json`,
    );
    let chunkIds: string[] = [];
    try {
      const parsed = JSON.parse(await fs.readFile(processedPath, "utf8")) as {
        chunks?: Array<{ id?: unknown }>;
      };
      chunkIds = (parsed.chunks ?? []).map((chunk) => chunk.id).filter((id): id is string => typeof id === "string");
    } catch (error: unknown) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }

    if (chunkIds.length > 0) {
      const { error } = await supabaseAdmin.from("documents").delete().in("chunk_id", chunkIds);
      if (error) throw new Error(error.message);
    } else {
      const { data, error: lookupError } = await supabaseAdmin
        .from("documents")
        .select("chunk_id, source_file");
      if (lookupError) throw new Error(lookupError.message);

      const matchingIds = (data ?? [])
        .filter((row) => path.basename(String(row.source_file ?? "")) === body.fileName)
        .map((row) => String(row.chunk_id ?? ""))
        .filter(Boolean);

      if (matchingIds.length === 0) {
        return Response.json(
          { error: "No trained chunks were found for this file." },
          { status: 404 },
        );
      }

      const { error } = await supabaseAdmin
        .from("documents")
        .delete()
        .in("chunk_id", matchingIds);
      if (error) throw new Error(error.message);
    }

    await updateResearcherManifest(body.fileName, "untrained");
    return Response.json({ success: true });
  } catch (error: unknown) {
    console.error("Researcher untrain failed:", error);
    return Response.json({ error: "Could not remove this file from the assistant." }, { status: 500 });
  }
}
