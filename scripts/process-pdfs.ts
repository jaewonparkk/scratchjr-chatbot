import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const RAW_PDF_DIRECTORY = path.join(
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

const MAX_CHUNK_CHARACTERS = 2200;
const CHUNK_OVERLAP_CHARACTERS = 250;

type PdfTextItem = {
  str?: string;
  hasEOL?: boolean;
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

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/\.pdf$/i, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeText(value: string): string {
  return value
    .replace(/\u0000/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractPageText(items: PdfTextItem[]): string {
  const parts: string[] = [];

  for (const item of items) {
    if (typeof item.str !== "string") {
      continue;
    }

    const text = item.str.trim();

    if (text) {
      parts.push(text);
    }

    if (item.hasEOL) {
      parts.push("\n");
    }
  }

  return normalizeText(
    parts
      .join(" ")
      .replace(/ \n /g, "\n"),
  );
}

function choosePageTitle(
  text: string,
  fileName: string,
  pageNumber: number,
): string {
  const firstUsefulLine = text
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length >= 3);

  if (firstUsefulLine) {
    return firstUsefulLine.slice(0, 140);
  }

  return `${fileName} — Page ${pageNumber}`;
}

function splitTextIntoChunks(text: string): string[] {
  if (text.length <= MAX_CHUNK_CHARACTERS) {
    return [text];
  }

  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    let end = Math.min(
      start + MAX_CHUNK_CHARACTERS,
      text.length,
    );

    if (end < text.length) {
      const paragraphBreak = text.lastIndexOf(
        "\n\n",
        end,
      );

      const sentenceBreak = text.lastIndexOf(
        ". ",
        end,
      );

      const preferredBreak = Math.max(
        paragraphBreak,
        sentenceBreak,
      );

      if (
        preferredBreak >
        start + MAX_CHUNK_CHARACTERS * 0.55
      ) {
        end = preferredBreak + 1;
      }
    }

    const chunk = text.slice(start, end).trim();

    if (chunk) {
      chunks.push(chunk);
    }

    if (end >= text.length) {
      break;
    }

    start = Math.max(
      end - CHUNK_OVERLAP_CHARACTERS,
      start + 1,
    );
  }

  return chunks;
}

async function processPdf(
  fileName: string,
): Promise<ReviewedChunk[]> {
  const filePath = path.join(
    RAW_PDF_DIRECTORY,
    fileName,
  );

  const fileBuffer = await readFile(filePath);

  const loadingTask = getDocument({
    data: new Uint8Array(fileBuffer),
  });

  const pdf = await loadingTask.promise;
  const fileSlug = slugify(fileName);
  const chunks: ReviewedChunk[] = [];

  console.log(
    `Processing ${fileName} (${pdf.numPages} pages)...`,
  );

  for (
    let pageNumber = 1;
    pageNumber <= pdf.numPages;
    pageNumber += 1
  ) {
    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent();

    const pageText = extractPageText(
      textContent.items as PdfTextItem[],
    );

    if (!pageText) {
      console.warn(
        `Skipped ${fileName}, page ${pageNumber}: no extractable text.`,
      );

      continue;
    }

    const pageTitle = choosePageTitle(
      pageText,
      fileName,
      pageNumber,
    );

    const pageChunks = splitTextIntoChunks(
      pageText,
    );

    for (
      let chunkIndex = 0;
      chunkIndex < pageChunks.length;
      chunkIndex += 1
    ) {
      const chunkNumber = chunkIndex + 1;

      chunks.push({
        id: [
          fileSlug,
          `page-${pageNumber}`,
          `chunk-${chunkNumber}`,
        ].join("-"),

        title:
          pageChunks.length === 1
            ? pageTitle
            : `${pageTitle} — Part ${chunkNumber}`,

        content: pageChunks[chunkIndex],

        source_file: fileName,

        file_type: "pdf",

        section: `Page ${pageNumber}`,

        page_number: pageNumber,

        slide_number: null,

        image_paths: [],

        should_display_image: false,

        metadata: {
          ingestion: {
            source: "pdfjs-dist",
            page: pageNumber,
            chunk: chunkNumber,
            total_chunks_on_page:
              pageChunks.length,
          },
        },
      });
    }

    console.log(
      `  Page ${pageNumber}/${pdf.numPages}: ${pageChunks.length} chunk(s)`,
    );
  }
  await loadingTask.destroy();

  return chunks;
}

async function main(): Promise<void> {
  await mkdir(PROCESSED_DIRECTORY, {
    recursive: true,
  });

  const directoryEntries = await readdir(
    RAW_PDF_DIRECTORY,
    {
      withFileTypes: true,
    },
  );

  const pdfFiles = directoryEntries
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.toLowerCase().endsWith(".pdf"),
    )
    .map((entry) => entry.name)
    .sort();

  if (pdfFiles.length === 0) {
    throw new Error(
      `No PDF files found in ${RAW_PDF_DIRECTORY}`,
    );
  }

  console.log(
    `Found ${pdfFiles.length} PDF file(s).`,
  );

  const allChunks: ReviewedChunk[] = [];

  for (const pdfFile of pdfFiles) {
    const chunks = await processPdf(pdfFile);
    allChunks.push(...chunks);
  }

  if (allChunks.length === 0) {
    throw new Error(
      "No text chunks were extracted from the PDFs.",
    );
  }

  const output: ReviewedDocumentsFile = {
    included_chunk_count: allChunks.length,
    chunks: allChunks,
  };

  await writeFile(
    OUTPUT_PATH,
    JSON.stringify(output, null, 2),
    "utf8",
  );

  console.log();
  console.log(
    `Created ${OUTPUT_PATH}`,
  );
  console.log(
    `Generated ${allChunks.length} reviewed chunk(s).`,
  );
}

main().catch((error: unknown) => {
  console.error();
  console.error("PDF processing failed.");

  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(error);
  }

  process.exit(1);
});