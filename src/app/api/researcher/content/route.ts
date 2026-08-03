import { promises as fs } from "node:fs";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const allowedRoots = [
  path.resolve(process.cwd(), "knowledge", "raw"),
  path.resolve(process.cwd(), "knowledge", "archive", "raw"),
];

function resolveAllowed(relativePath: string): string | null {
  const absolute = path.resolve(process.cwd(), relativePath);
  return allowedRoots.some((root) => {
    const relative = path.relative(root, absolute);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  }) ? absolute : null;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const relativePath = url.searchParams.get("path");
    const download = url.searchParams.get("download") === "1";

    if (!relativePath) return Response.json({ error: "A file path is required." }, { status: 400 });
    const absolutePath = resolveAllowed(relativePath);
    if (!absolutePath) return Response.json({ error: "That file is not available." }, { status: 403 });

    const bytes = await fs.readFile(absolutePath);
    const extension = path.extname(absolutePath).toLowerCase();
    const mimeTypes: Record<string, string> = {
      ".pdf": "application/pdf",
      ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".webp": "image/webp",
    };
    const disposition = download ? "attachment" : "inline";
    const encodedName = encodeURIComponent(path.basename(absolutePath));

    return new Response(bytes, {
      headers: {
        "Content-Type": mimeTypes[extension] ?? "application/octet-stream",
        "Content-Disposition": `${disposition}; filename*=UTF-8''${encodedName}`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error: unknown) {
    console.error("Could not serve Researcher file:", error);
    return Response.json({ error: "Could not open this file." }, { status: 404 });
  }
}
