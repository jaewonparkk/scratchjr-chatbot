import { config } from "dotenv";
import { GoogleGenAI } from "@google/genai";
import {
  mkdir,
  readdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

config({
  path: ".env.local",
});

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

type GeminiPage = {
  page_number: number;
  title: string;
  content: string;
  keywords?: string[];
  should_display_image?: boolean;
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

function slugify(
  value: string,
): string {
  return value
    .toLowerCase()
    .replace(/\.pdf$/i, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
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
  const cleaned =
    removeMarkdownFence(responseText);

  const parsed =
    JSON.parse(
      cleaned,
    ) as GeminiDocumentResult;

  if (
    !parsed ||
    typeof parsed !== "object"
  ) {
    throw new Error(
      "Gemini returned an invalid result.",
    );
  }

  if (
    !Array.isArray(parsed.pages)
  ) {
    throw new Error(
      "Gemini response does not contain a pages array.",
    );
  }

  return parsed;
}

function validatePage(
  page: GeminiPage,
): boolean {
  return (
    Number.isInteger(
      page.page_number,
    ) &&
    page.page_number >= 1 &&
    typeof page.title ===
      "string" &&
    page.title.trim().length > 0 &&
    typeof page.content ===
      "string" &&
    page.content.trim().length > 0
  );
}

function buildPrompt(
  fileName: string,
): string {
  return `
You are processing an official micro:bit and educational robotics PDF for a retrieval-augmented chatbot.

The PDF may contain photographs, diagrams, wiring instructions, parts lists, screenshots, arrows, labels, and very little selectable text. Read the visual content carefully.

Create one structured entry for every PDF page.

Requirements:
- Preserve the actual instructions from the document.
- Include important visual information such as wire colors, connector types, pin numbers, LED polarity, battery connections, button labels, arrows, and step order.
- Do not invent missing instructions.
- Do not add general micro:bit knowledge that is not shown in the PDF.
- Write clear standalone content so that each page can be retrieved independently.
- Use the PDF's printed page or step title when available.
- Use the physical PDF page order for page_number, starting at 1.
- Set should_display_image to true when the page contains a useful diagram, photograph, wiring layout, screenshot, or build step.
- Return valid JSON only.
- Do not wrap the JSON in Markdown.

File name: ${fileName}

Return exactly this shape:

{
  "document_title": "string",
  "pages": [
    {
      "page_number": 1,
      "title": "string",
      "content": "Complete description and instructions from this page",
      "keywords": [
        "micro:bit",
        "pairing"
      ],
      "should_display_image": true
    }
  ]
}
`.trim();
}

async function processPdf(
  fileName: string,
): Promise<ReviewedChunk[]> {
  const filePath =
    path.join(
      RAW_DIRECTORY,
      fileName,
    );

  const fileBuffer =
    await readFile(filePath);

  console.log(
    `Reading ${fileName} with Gemini...`,
  );

  const response =
    await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: [
        {
          inlineData: {
            mimeType:
              "application/pdf",
            data:
              fileBuffer.toString(
                "base64",
              ),
          },
        },
        {
          text:
            buildPrompt(
              fileName,
            ),
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
      `Gemini returned no content for ${fileName}.`,
    );
  }

  const document =
    parseGeminiJson(
      responseText,
    );

  const fileSlug =
    slugify(fileName);

  const chunks:
    ReviewedChunk[] = [];

  for (
    const page
    of document.pages
  ) {
    if (!validatePage(page)) {
      console.warn(
        `Skipped invalid page entry in ${fileName}.`,
      );
      continue;
    }

    chunks.push({
      id: [
        fileSlug,
        `page-${page.page_number}`,
      ].join("-"),

      title:
        page.title.trim(),

      content:
        page.content.trim(),

      source_file:
        fileName,

      file_type: "pdf",

      section:
        `Page ${page.page_number}`,

      page_number:
        page.page_number,

      slide_number: null,

      image_paths: [],

      should_display_image:
        Boolean(
          page.should_display_image,
        ),

      metadata: {
        document_title:
          document.document_title,

        keywords:
          Array.isArray(
            page.keywords,
          )
            ? page.keywords
            : [],

        ingestion: {
          provider: "gemini",
          model:
            GEMINI_MODEL,
          source_type:
            "native-pdf",
        },
      },
    });
  }

  if (
    chunks.length === 0
  ) {
    throw new Error(
      `No valid pages were generated for ${fileName}.`,
    );
  }

  console.log(
    `Created ${chunks.length} chunk(s) from ${fileName}.`,
  );

  return chunks;
}

async function main(): Promise<void> {
  await mkdir(
    PROCESSED_DIRECTORY,
    {
      recursive: true,
    },
  );

  const entries =
    await readdir(
      RAW_DIRECTORY,
      {
        withFileTypes: true,
      },
    );

  const pdfFiles =
    entries
      .filter(
        (entry) =>
          entry.isFile() &&
          entry.name
            .toLowerCase()
            .endsWith(
              ".pdf",
            ),
      )
      .map(
        (entry) =>
          entry.name,
      )
      .sort();

  if (
    pdfFiles.length === 0
  ) {
    throw new Error(
      `No PDF files found in ${RAW_DIRECTORY}.`,
    );
  }

  console.log(
    `Found ${pdfFiles.length} PDF file(s).`,
  );

  const allChunks:
    ReviewedChunk[] = [];

  for (
    const fileName
    of pdfFiles
  ) {
    const chunks =
      await processPdf(
        fileName,
      );

    allChunks.push(
      ...chunks,
    );
  }

  const output:
    ReviewedDocumentsFile = {
      included_chunk_count:
        allChunks.length,

      chunks:
        allChunks,
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
    `Created ${OUTPUT_PATH}`,
  );

  console.log(
    `Generated ${allChunks.length} total chunk(s).`,
  );
}

main().catch(
  (
    error: unknown,
  ) => {
    console.error();
    console.error(
      "PDF ingestion failed.",
    );

    if (
      error instanceof Error
    ) {
      console.error(
        error.message,
      );
    } else {
      console.error(
        error,
      );
    }

    process.exit(1);
  },
);