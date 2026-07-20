import { promises as fs } from "node:fs";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const projectRoot = process.cwd();

const allowedImageDirectory =
  path.resolve(
    projectRoot,
    "knowledge",
    "processed",
    "images",
  );

const contentTypes: Record<
  string,
  string
> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
};

export async function GET(
  request: Request,
) {
  try {
    const requestUrl = new URL(
      request.url,
    );

    const requestedPath =
      requestUrl.searchParams.get(
        "path",
      );

    if (!requestedPath) {
      return Response.json(
        {
          error:
            "An image path is required.",
        },
        {
          status: 400,
        },
      );
    }

    const absoluteImagePath =
      path.resolve(
        projectRoot,
        requestedPath,
      );

    const allowedPrefix =
      `${allowedImageDirectory}${path.sep}`;

    if (
      !absoluteImagePath.startsWith(
        allowedPrefix,
      )
    ) {
      return Response.json(
        {
          error:
            "The requested image path is not allowed.",
        },
        {
          status: 403,
        },
      );
    }

    const fileInformation =
      await fs.stat(
        absoluteImagePath,
      );

    if (!fileInformation.isFile()) {
      return Response.json(
        {
          error:
            "The requested path is not a file.",
        },
        {
          status: 404,
        },
      );
    }

    const extension = path
      .extname(absoluteImagePath)
      .toLowerCase();

    const contentType =
      contentTypes[extension] ??
      "application/octet-stream";

    const imageBuffer =
      await fs.readFile(
        absoluteImagePath,
      );

    return new Response(
      new Uint8Array(imageBuffer),
      {
        status: 200,
        headers: {
          "Content-Type": contentType,
          "Cache-Control":
            "no-store, max-age=0",
        },
      },
    );
  } catch (error: unknown) {
    console.error(
      "Could not load review image:",
      error,
    );

    return Response.json(
      {
        error:
          "The requested image could not be loaded.",
      },
      {
        status: 404,
      },
    );
  }
}