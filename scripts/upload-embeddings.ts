import { config } from "dotenv";
import { pipeline } from "@huggingface/transformers";
import { createClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
import path from "node:path";

config({
  path: ".env.local",
});

const MODEL_NAME = "Supabase/gte-small";
const EXPECTED_DIMENSIONS = 384;
const UPLOAD_BATCH_SIZE = 20;

const REVIEWED_DOCUMENTS_PATH = path.join(
  process.cwd(),
  "knowledge",
  "processed",
  "reviewed_documents.json",
);

type ReviewedChunk = {
  id: string;
  title: string;
  content: string;
  source_file: string;
  file_type: "docx" | "pdf" | "pptx" | "image";
  section: string;
  page_number: number | null;
  slide_number: number | null;
  image_paths: string[];
  should_display_image: boolean;
  metadata: Record<string, unknown>;
};

type ReviewedDocumentsFile = {
  included_chunk_count: number;
  chunks: ReviewedChunk[];
};

type FeatureExtractionResult = {
    data: ArrayLike<number>;
  };
  
  type FeatureExtractor = (
    input: string,
    options: {
      pooling: "mean";
      normalize: boolean;
    },
  ) => Promise<FeatureExtractionResult>;
  
  type FeatureExtractorFactory = (
    task: "feature-extraction",
    model: string,
    options?: {
      dtype?: "fp32";
    },
  ) => Promise<FeatureExtractor>;
  
  const createFeatureExtractor =
    pipeline as unknown as FeatureExtractorFactory;

type DatabaseRow = {
  chunk_id: string;
  title: string;
  content: string;
  source_file: string;
  file_type: ReviewedChunk["file_type"];
  section: string;
  page_number: number | null;
  slide_number: number | null;
  image_paths: string[];
  should_display_image: boolean;
  metadata: Record<string, unknown>;
  embedding: number[];
};

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseSecretKey =
  process.env.SUPABASE_SECRET_KEY;

if (!supabaseUrl) {
  throw new Error(
    "SUPABASE_URL is missing from .env.local.",
  );
}

if (!supabaseSecretKey) {
  throw new Error(
    "SUPABASE_SECRET_KEY is missing from .env.local.",
  );
}

const supabase = createClient(
  supabaseUrl,
  supabaseSecretKey,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  },
);

async function loadReviewedChunks(): Promise<
  ReviewedChunk[]
> {
  const rawFile = await readFile(
    REVIEWED_DOCUMENTS_PATH,
    "utf8",
  );

  const parsedFile = JSON.parse(
    rawFile,
  ) as ReviewedDocumentsFile;

  if (!Array.isArray(parsedFile.chunks)) {
    throw new Error(
      "reviewed_documents.json does not contain a chunks array.",
    );
  }

  if (
    parsedFile.included_chunk_count !==
    parsedFile.chunks.length
  ) {
    throw new Error(
      "included_chunk_count does not match the number of chunks.",
    );
  }

  if (parsedFile.chunks.length === 0) {
    throw new Error(
      "There are no reviewed chunks to upload.",
    );
  }

  return parsedFile.chunks;
}

function createEmbeddingText(
  chunk: ReviewedChunk,
): string {
  return [
    `Title: ${chunk.title}`,
    `Section: ${chunk.section}`,
    chunk.content,
  ]
    .filter(Boolean)
    .join("\n\n");
}

async function createEmbedding(
    extractor: FeatureExtractor,
    text: string,
  ): Promise<number[]> {
    const result = await extractor(text, {
      pooling: "mean",
      normalize: true,
    });

  const embedding = Array.from(
    result.data,
  );

  if (
    embedding.length !==
    EXPECTED_DIMENSIONS
  ) {
    throw new Error(
      `Expected ${EXPECTED_DIMENSIONS} embedding dimensions, ` +
        `but received ${embedding.length}.`,
    );
  }

  if (
    embedding.some(
      (value) => !Number.isFinite(value),
    )
  ) {
    throw new Error(
      "Embedding contains a non-finite value.",
    );
  }

  return embedding;
}

async function clearExistingDocuments(): Promise<void> {
  console.log(
    "Removing existing database documents...",
  );

  const { error } = await supabase
    .from("documents")
    .delete()
    .neq("chunk_id", "");

  if (error) {
    throw new Error(
      `Could not clear existing documents: ${error.message}`,
    );
  }
}

async function uploadRows(
  rows: DatabaseRow[],
): Promise<void> {
  const { error } = await supabase
    .from("documents")
    .upsert(rows, {
      onConflict: "chunk_id",
    });

  if (error) {
    throw new Error(
      `Could not upload document batch: ${error.message}`,
    );
  }
}

async function verifyUpload(
  expectedCount: number,
): Promise<void> {
  const {
    count,
    error,
  } = await supabase
    .from("documents")
    .select("*", {
      count: "exact",
      head: true,
    });

  if (error) {
    throw new Error(
      `Could not verify uploaded documents: ${error.message}`,
    );
  }

  if (count !== expectedCount) {
    throw new Error(
      `Expected ${expectedCount} database rows, but found ${count}.`,
    );
  }

  console.log(
    `Verified ${count} database document(s).`,
  );
}

async function main(): Promise<void> {
  const chunks =
    await loadReviewedChunks();

  console.log(
    `Loaded ${chunks.length} reviewed chunk(s).`,
  );

  console.log(
    `Loading local embedding model: ${MODEL_NAME}`,
  );

  console.log(
    "The first run may take longer because the model must be downloaded.",
  );

  const extractor = await pipeline(
    "feature-extraction",
    MODEL_NAME,
    {
      dtype: "fp32",
    },
  );

  console.log(
    "Embedding model loaded.",
  );

  await clearExistingDocuments();

  let pendingRows: DatabaseRow[] = [];
  let completedCount = 0;

  for (const chunk of chunks) {
    const embeddingText =
      createEmbeddingText(chunk);

    const embedding =
      await createEmbedding(
        extractor,
        embeddingText,
      );

    pendingRows.push({
      chunk_id: chunk.id,
      title: chunk.title,
      content: chunk.content,
      source_file: chunk.source_file,
      file_type: chunk.file_type,
      section: chunk.section,
      page_number: chunk.page_number,
      slide_number: chunk.slide_number,
      image_paths: chunk.image_paths,
      should_display_image:
        chunk.should_display_image,
      metadata: {
        ...chunk.metadata,
        embedding: {
          model: MODEL_NAME,
          dimensions:
            EXPECTED_DIMENSIONS,
          pooling: "mean",
          normalized: true,
        },
      },
      embedding,
    });

    completedCount += 1;

    console.log(
      `Embedded ${completedCount}/${chunks.length}: ${chunk.title}`,
    );

    if (
      pendingRows.length >=
      UPLOAD_BATCH_SIZE
    ) {
      await uploadRows(pendingRows);

      console.log(
        `Uploaded ${completedCount}/${chunks.length}.`,
      );

      pendingRows = [];
    }
  }

  if (pendingRows.length > 0) {
    await uploadRows(pendingRows);

    console.log(
      `Uploaded ${completedCount}/${chunks.length}.`,
    );
  }

  await verifyUpload(chunks.length);

  console.log();
  console.log(
    "Embedding upload completed successfully.",
  );
}

main().catch((error: unknown) => {
  console.error();
  console.error(
    "Embedding upload failed.",
  );

  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(error);
  }

  process.exit(1);
});