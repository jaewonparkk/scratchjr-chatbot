import { promises as fs } from "node:fs";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FILE_SIZE =
  25 * 1024 * 1024;

const allowedExtensions =
  new Set([
    ".pdf",
    ".docx",
    ".pptx",
    ".png",
    ".jpg",
    ".jpeg",
    ".webp",
    ".bmp",
    ".tif",
    ".tiff",
  ]);

const uploadDirectory = path.join(
  process.cwd(),
  "knowledge",
  "raw",
  "researcher",
);

function safeFileName(
  originalName: string,
): string {
  const parsed =
    path.parse(
      path.basename(originalName),
    );

  const extension =
    parsed.ext.toLowerCase();

  const baseName =
    parsed.name
      .normalize("NFKC")
      .replace(/[^\p{L}\p{N}._ -]+/gu, "-")
      .replace(/\s+/g, " ")
      .replace(/^\.+|\.+$/g, "")
      .trim()
      .slice(0, 120) || "document";

  return `${baseName}${extension}`;
}

async function availablePath(
  fileName: string,
): Promise<string> {
  const parsed = path.parse(fileName);

  for (
    let index = 0;
    index < 10_000;
    index += 1
  ) {
    const candidateName =
      index === 0
        ? fileName
        : `${parsed.name}-${index}${parsed.ext}`;

    const candidatePath = path.join(
      uploadDirectory,
      candidateName,
    );

    try {
      await fs.access(candidatePath);
    } catch {
      return candidatePath;
    }
  }

  throw new Error(
    "Could not create a unique file name.",
  );
}

export async function GET() {
  try {
    await fs.mkdir(uploadDirectory, {
      recursive: true,
    });

    const entries =
      await fs.readdir(
        uploadDirectory,
        { withFileTypes: true },
      );

    const files = await Promise.all(
      entries
        .filter((entry) => entry.isFile())
        .map(async (entry) => {
          const stats = await fs.stat(
            path.join(
              uploadDirectory,
              entry.name,
            ),
          );

          return {
            name: entry.name,
            size: stats.size,
            savedAt:
              stats.mtime.toISOString(),
          };
        }),
    );

    files.sort(
      (first, second) =>
        second.savedAt.localeCompare(
          first.savedAt,
        ),
    );

    return Response.json({ files });
  } catch (error: unknown) {
    console.error(
      "Could not list researcher files:",
      error,
    );

    return Response.json(
      {
        error:
          "Could not load researcher files.",
      },
      { status: 500 },
    );
  }
}

export async function POST(
  request: Request,
) {
  try {
    const formData =
      await request.formData();

    const uploadedFile =
      formData.get("file");

    if (!(uploadedFile instanceof File)) {
      return Response.json(
        { error: "Choose a file to upload." },
        { status: 400 },
      );
    }

    if (
      uploadedFile.size === 0 ||
      uploadedFile.size > MAX_FILE_SIZE
    ) {
      return Response.json(
        {
          error:
            "The file must be between 1 byte and 25 MB.",
        },
        { status: 400 },
      );
    }

    const fileName =
      safeFileName(uploadedFile.name);

    const extension =
      path.extname(fileName).toLowerCase();

    if (!allowedExtensions.has(extension)) {
      return Response.json(
        {
          error:
            "Supported files: PDF, DOCX, PPTX, and common images.",
        },
        { status: 400 },
      );
    }

    await fs.mkdir(uploadDirectory, {
      recursive: true,
    });

    const destination =
      await availablePath(fileName);

    const bytes = Buffer.from(
      await uploadedFile.arrayBuffer(),
    );

    await fs.writeFile(
      destination,
      bytes,
      { flag: "wx" },
    );

    return Response.json({
      success: true,
      file: {
        name: path.basename(destination),
        size: bytes.length,
        savedAt: new Date().toISOString(),
      },
      status: "saved",
      nextStep:
        "Run python -m ingestion.run before review and embedding upload.",
    });
  } catch (error: unknown) {
    console.error(
      "Could not save researcher file:",
      error,
    );

    return Response.json(
      {
        error:
          "Could not save the uploaded file.",
      },
      { status: 500 },
    );
  }
}
