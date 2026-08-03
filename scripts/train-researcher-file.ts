import { config } from "dotenv";
import { pipeline } from "@huggingface/transformers";
import { createClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
import path from "node:path";

config({ path: ".env.local" });

async function main(): Promise<void> {
  const inputPath = process.argv[2];
  if (!inputPath) throw new Error("A processed Researcher JSON file is required.");

  const projectRoot = process.cwd();
  const allowedDirectory = path.resolve(projectRoot, "knowledge", "processed", "researcher");
  const absoluteInput = path.resolve(projectRoot, inputPath);
  if (path.relative(allowedDirectory, absoluteInput).startsWith("..")) {
    throw new Error("The processed file is outside the Researcher directory.");
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SECRET_KEY;
  if (!supabaseUrl || !supabaseKey) throw new Error("Supabase configuration is missing.");

  const parsed = JSON.parse(await readFile(absoluteInput, "utf8")) as {
    chunks?: Array<Record<string, unknown>>;
  };
  if (!Array.isArray(parsed.chunks) || parsed.chunks.length === 0) {
    throw new Error("No Researcher chunks were found.");
  }

  const extractor = await pipeline("feature-extraction", "Supabase/gte-small", {
    dtype: "fp32",
  });
  const rows = [];

  for (const chunk of parsed.chunks) {
    const text = [chunk.title, chunk.section, chunk.content].filter(Boolean).join("\n\n");
    const result = await extractor(text, { pooling: "mean", normalize: true });
    const embedding = Array.from(result.data, Number);

    rows.push({
      chunk_id: chunk.id,
      title: chunk.title,
      content: chunk.content,
      source_file: chunk.source_file,
      file_type: chunk.file_type,
      section: chunk.section,
      page_number: chunk.page_number,
      slide_number: chunk.slide_number,
      image_paths: chunk.image_paths,
      should_display_image: chunk.should_display_image,
      metadata: {
        ...(typeof chunk.metadata === "object" && chunk.metadata ? chunk.metadata : {}),
        researcher_upload: true,
      },
      embedding,
    });
  }

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  for (let index = 0; index < rows.length; index += 20) {
    const { error } = await supabase.from("documents").upsert(
      rows.slice(index, index + 20),
      { onConflict: "chunk_id" },
    );
    if (error) throw new Error(error.message);
  }

  console.log(`Trained ${rows.length} chunk(s).`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
