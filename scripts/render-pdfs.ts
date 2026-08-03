import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { createCanvas } from "canvas";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const RAW_PDF_DIRECTORY = path.join(
  process.cwd(),
  "knowledge",
  "raw",
  "microbit",
);

const OUTPUT_DIRECTORY = path.join(
  process.cwd(),
  "knowledge",
  "processed",
  "images",
);

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/\.pdf$/i, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function renderPdf(fileName: string): Promise<void> {
  const filePath = path.join(
    RAW_PDF_DIRECTORY,
    fileName,
  );

  const fileBuffer = await readFile(filePath);

  const loadingTask = getDocument({
    data: new Uint8Array(fileBuffer),
  });

  try {
    const pdf = await loadingTask.promise;
    const fileSlug = slugify(fileName);

    const pdfOutputDirectory = path.join(
      OUTPUT_DIRECTORY,
      fileSlug,
    );

    await mkdir(pdfOutputDirectory, {
      recursive: true,
    });

    console.log(
      `Rendering ${fileName} (${pdf.numPages} pages)...`,
    );

    for (
      let pageNumber = 1;
      pageNumber <= pdf.numPages;
      pageNumber += 1
    ) {
      const page = await pdf.getPage(pageNumber);

      const viewport = page.getViewport({
        scale: 2,
      });

      const canvas = createCanvas(
        Math.ceil(viewport.width),
        Math.ceil(viewport.height),
      );

      const context = canvas.getContext("2d");

      await page.render({
        canvasContext: context as never,
        viewport,
      }).promise;

      const outputPath = path.join(
        pdfOutputDirectory,
        `page-${String(pageNumber).padStart(2, "0")}.png`,
      );

      await writeFile(
        outputPath,
        canvas.toBuffer("image/png"),
      );

      console.log(
        `  Rendered page ${pageNumber}/${pdf.numPages}`,
      );
    }
  } finally {
    await loadingTask.destroy();
  }
}

async function main(): Promise<void> {
  await mkdir(OUTPUT_DIRECTORY, {
    recursive: true,
  });

  const entries = await readdir(
    RAW_PDF_DIRECTORY,
    {
      withFileTypes: true,
    },
  );

  const pdfFiles = entries
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

  for (const pdfFile of pdfFiles) {
    await renderPdf(pdfFile);
  }

  console.log();
  console.log(
    `Rendered PDF pages to ${OUTPUT_DIRECTORY}`,
  );
}

main().catch((error: unknown) => {
  console.error();
  console.error("PDF rendering failed.");

  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(error);
  }

  process.exit(1);
});