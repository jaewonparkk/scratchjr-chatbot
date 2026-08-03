import { config } from "dotenv";
import { GoogleGenAI } from "@google/genai";
import {
  mkdir,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import crypto from "node:crypto";

config({
  path: ".env.local",
});

const execFileAsync = promisify(execFile);

const GEMINI_API_KEY =
  process.env.GEMINI_API_KEY;

const GEMINI_MODEL =
  process.env.GEMINI_MODEL ??
  "gemini-2.5-flash";

const RAW_DIRECTORY = path.join(
  process.cwd(),
  "knowledge",
  "raw",
  "microbit",
);

const PROCESSED_DIRECTORY = path.join(
  process.cwd(),
  "knowledge",
  "processed",
);

const PUBLIC_IMAGE_DIRECTORY = path.join(
  process.cwd(),
  "public",
  "generated-docs",
);

const OUTPUT_PATH = path.join(
  PROCESSED_DIRECTORY,
  "reviewed_documents.json",
);

if (!GEMINI_API_KEY) {
  throw new Error(
    "GEMINI_API_KEY is missing from .env.local.",
  );
}

const ai = new GoogleGenAI({
  apiKey: GEMINI_API_KEY,
});

type DocumentType =
  | "build-guide"
  | "pairing-guide"
  | "troubleshooting-guide"
  | "parts-guide"
  | "programming-guide"
  | "general-reference";

type Topic =
  | "microbit-build"
  | "pairing"
  | "troubleshooting"
  | "parts"
  | "programming"
  | "general";

type ContentType =
  | "build-step"
  | "final-preview"
  | "parts-list"
  | "pairing-step"
  | "troubleshooting"
  | "reference";

type GeminiPage = {
  page_number: number;
  title: string;
  content: string;

  document_type: DocumentType;
  topic: Topic;
  content_type: ContentType;

  step_number: number | null;

  keywords: string[];
  components: string[];

  should_display_image: boolean;
};

type GeminiDocumentResult = {
  document_title: string;
  pages: GeminiPage[];
};

type ReviewedChunk = {
  id: string;
  title: string;
  content: string;
  source_file: string;
  file_type: "pdf";
  section: string;
  page_number: number;
  slide_number: null;
  image_paths: string[];
  should_display_image: boolean;
  metadata: Record<string, unknown>;
};

type ReviewedDocumentsFile = {
  included_chunk_count: number;
  chunks: ReviewedChunk[];
};

function createDocumentId(
  fileName: string,
): string {
  const hash = crypto
    .createHash("sha256")
    .update(fileName)
    .digest("hex")
    .slice(0, 10);

  const readableName = fileName
    .toLowerCase()
    .replace(/\.pdf$/i, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);

  return `${readableName}-${hash}`;
}

function removeMarkdownFence(
  value: string,
): string {
  return value
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function parseGeminiJson(
  responseText: string,
): GeminiDocumentResult {
  const parsed = JSON.parse(
    removeMarkdownFence(responseText),
  ) as GeminiDocumentResult;

  if (
    !parsed ||
    typeof parsed !== "object" ||
    !Array.isArray(parsed.pages)
  ) {
    throw new Error(
      "Gemini returned an invalid document result.",
    );
  }

  return parsed;
}

function buildPrompt(): string {
  return `
You are analyzing a PDF for a micro:bit and educational robotics help assistant.

The PDF may be fully image-based. Carefully inspect all text, screenshots, photographs, diagrams, arrows, wires, connectors, labels, buttons, batteries, motors, LEDs, breadboards, and micro:bit pins.

Do not classify the document using its filename. Classify it only from the actual PDF content.

Create one entry for every physical PDF page.

For each page, determine:

document_type:
- build-guide
- pairing-guide
- troubleshooting-guide
- parts-guide
- programming-guide
- general-reference

topic:
- microbit-build
- pairing
- troubleshooting
- parts
- programming
- general

content_type:
- build-step
- final-preview
- parts-list
- pairing-step
- troubleshooting
- reference

Rules:
- step_number must be the printed construction or pairing step number when one exists.
- Otherwise step_number must be null.
- Preserve exact wire colors, connector types, polarity, pin numbers, component names, and ordering.
- Do not invent information.
- content must be understandable without seeing another page.
- should_display_image must be true when the page contains a useful photo, diagram, screenshot, wiring layout, parts image, final result, or build step.
- Return valid JSON only.
- Do not use Markdown.

Return exactly this structure:

{
  "document_title": "string",
  "pages": [
    {
      "page_number": 1,
      "title": "string",
      "content": "string",
      "document_type": "build-guide",
      "topic": "microbit-build",
      "content_type": "build-step",
      "step_number": 1,
      "keywords": ["micro:bit", "LED"],
      "components": ["micro:bit", "LED"],
      "should_display_image": true
    }
  ]
}
`.trim();
}

async function renderPdfPages(
  filePath: string,
  documentId: string,
): Promise<Map<number, string>> {
  const outputDirectory = path.join(
    PUBLIC_IMAGE_DIRECTORY,
    documentId,
  );

  await rm(outputDirectory, {
    recursive: true,
    force: true,
  });

  await mkdir(outputDirectory, {
    recursive: true,
  });

  const outputPrefix = path.join(
    outputDirectory,
    "page",
  );

  try {
    await execFileAsync("pdftoppm", [
      "-png",
      "-r",
      "150",
      filePath,
      outputPrefix,
    ]);
  } catch (error) {
    throw new Error(
      "Could not render PDF pages. Make sure Poppler is installed with: brew install poppler",
      {
        cause: error,
      },
    );
  }

  const renderedFiles = (
    await readdir(outputDirectory)
  )
    .filter((fileName) =>
      /^page-\d+\.png$/i.test(fileName),
    )
    .sort((a, b) => {
      const aNumber = Number(
        a.match(/\d+/)?.[0] ?? 0,
      );

      const bNumber = Number(
        b.match(/\d+/)?.[0] ?? 0,
      );

      return aNumber - bNumber;
    });

  const pathsByPage =
    new Map<number, string>();

  for (const fileName of renderedFiles) {
    const pageNumber = Number(
      fileName.match(/\d+/)?.[0],
    );

    if (
      !Number.isInteger(pageNumber) ||
      pageNumber < 1
    ) {
      continue;
    }

    pathsByPage.set(
      pageNumber,
      `/generated-docs/${documentId}/${fileName}`,
    );
  }

  return pathsByPage;
}

function normalizeContent(
  value: string,
): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function deduplicateChunks(
  chunks: ReviewedChunk[],
): ReviewedChunk[] {
  const seen = new Set<string>();
  const result: ReviewedChunk[] = [];

  for (const chunk of chunks) {
    const key = normalizeContent(
      chunk.content,
    );

    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(chunk);
  }

  return result;
}

async function processPdf(
  fileName: string,
): Promise<ReviewedChunk[]> {
  const filePath = path.join(
    RAW_DIRECTORY,
    fileName,
  );

  const fileBuffer =
    await readFile(filePath);

  const documentId =
    createDocumentId(fileName);

  console.log(
    `Rendering ${fileName}...`,
  );

  const pageImagePaths =
    await renderPdfPages(
      filePath,
      documentId,
    );

  console.log(
    `Analyzing ${fileName} with Gemini...`,
  );

  const response =
    await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: [
        {
          inlineData: {
            mimeType: "application/pdf",
            data: fileBuffer.toString(
              "base64",
            ),
          },
        },
        {
          text: buildPrompt(),
        },
      ],
      config: {
        responseMimeType:
          "application/json",
        temperature: 0,
      },
    });

  const responseText =
    response.text?.trim();

  if (!responseText) {
    throw new Error(
      `Gemini returned no result for ${fileName}.`,
    );
  }

  const document =
    parseGeminiJson(responseText);

  const chunks: ReviewedChunk[] = [];

  for (const page of document.pages) {
    if (
      !Number.isInteger(
        page.page_number,
      ) ||
      page.page_number < 1 ||
      !page.title?.trim() ||
      !page.content?.trim()
    ) {
      continue;
    }

    const imagePath =
      pageImagePaths.get(
        page.page_number,
      );

    const shouldDisplayImage =
      Boolean(
        page.should_display_image &&
          imagePath,
      );

    chunks.push({
      id: [
        documentId,
        `page-${page.page_number}`,
      ].join("-"),

      title: page.title.trim(),

      content:
        page.content.trim(),

      source_file: fileName,

      file_type: "pdf",

      section:
        `Page ${page.page_number}`,

      page_number:
        page.page_number,

      slide_number: null,

      image_paths:
        shouldDisplayImage &&
        imagePath
          ? [imagePath]
          : [],

      should_display_image:
        shouldDisplayImage,

      metadata: {
        document_id: documentId,

        document_title:
          document.document_title,

        document_type:
          page.document_type,

        topic: page.topic,

        content_type:
          page.content_type,

        step_number:
          page.step_number,

        keywords: Array.isArray(
          page.keywords,
        )
          ? page.keywords
          : [],

        components: Array.isArray(
          page.components,
        )
          ? page.components
          : [],

        ingestion: {
          provider: "gemini",
          model: GEMINI_MODEL,
          source_type:
            "native-pdf",
        },
      },
    });
  }

  console.log(
    `Created ${chunks.length} chunk(s) from ${fileName}.`,
  );

  return chunks;
}

async function main(): Promise<void> {
  await mkdir(PROCESSED_DIRECTORY, {
    recursive: true,
  });

  await mkdir(PUBLIC_IMAGE_DIRECTORY, {
    recursive: true,
  });

  const entries = await readdir(
    RAW_DIRECTORY,
    {
      withFileTypes: true,
    },
  );

  const pdfFiles = entries
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name
          .toLowerCase()
          .endsWith(".pdf"),
    )
    .map((entry) => entry.name)
    .sort();

  if (pdfFiles.length === 0) {
    throw new Error(
      `No PDF files found in ${RAW_DIRECTORY}.`,
    );
  }

  console.log(
    `Found ${pdfFiles.length} PDF file(s).`,
  );

  const allChunks: ReviewedChunk[] = [];

  for (const fileName of pdfFiles) {
    const chunks =
      await processPdf(fileName);

    allChunks.push(...chunks);
  }

  const uniqueChunks =
    deduplicateChunks(allChunks);

  const output: ReviewedDocumentsFile = {
    included_chunk_count:
      uniqueChunks.length,

    chunks: uniqueChunks,
  };

  await writeFile(
    OUTPUT_PATH,
    JSON.stringify(
      output,
      null,
      2,
    ),
    "utf8",
  );

  console.log();
  console.log(
    `Generated ${uniqueChunks.length} unique chunk(s).`,
  );

  console.log(
    `Created ${OUTPUT_PATH}`,
  );
}

main().catch(
  (error: unknown) => {
    console.error();
    console.error(
      "PDF ingestion failed.",
    );

    if (error instanceof Error) {
      console.error(error.message);
    } else {
      console.error(error);
    }

    process.exit(1);
  },
);