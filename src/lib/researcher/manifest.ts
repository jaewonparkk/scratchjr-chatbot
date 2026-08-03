import "server-only";

import { promises as fs } from "node:fs";
import path from "node:path";

type Entry = {
  fileName: string;
  status: "trained" | "untrained";
  trainedAt: string | null;
  updatedAt: string;
  corrections: Array<{ content: string; savedAt: string }>;
};

type Manifest = {
  version: 1;
  updatedAt: string;
  files: Entry[];
};

const manifestPath = path.join(
  process.cwd(),
  "knowledge",
  "approved",
  "researcher-manifest.json",
);

async function readManifest(): Promise<Manifest> {
  try {
    return JSON.parse(await fs.readFile(manifestPath, "utf8")) as Manifest;
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return { version: 1, updatedAt: "", files: [] };
    }
    throw error;
  }
}

export async function getResearcherManifestEntries(): Promise<Entry[]> {
  return (await readManifest()).files;
}

async function writeManifest(manifest: Manifest): Promise<void> {
  const temporaryPath = `${manifestPath}.tmp`;
  await fs.mkdir(path.dirname(manifestPath), { recursive: true });
  await fs.writeFile(temporaryPath, JSON.stringify(manifest, null, 2), "utf8");
  await fs.rename(temporaryPath, manifestPath);
}

export async function updateResearcherManifest(
  fileName: string,
  action: "trained" | "untrained" | "deleted",
  correction?: string,
): Promise<void> {
  const manifest = await readManifest();
  const now = new Date().toISOString();
  const existing = manifest.files.find((entry) => entry.fileName === fileName);

  if (action === "deleted") {
    manifest.files = manifest.files.filter((entry) => entry.fileName !== fileName);
  } else if (existing) {
    existing.status = action;
    existing.updatedAt = now;
    if (action === "trained") existing.trainedAt = now;
    if (correction) existing.corrections.push({ content: correction, savedAt: now });
  } else {
    manifest.files.push({
      fileName,
      status: action,
      trainedAt: action === "trained" ? now : null,
      updatedAt: now,
      corrections: correction ? [{ content: correction, savedAt: now }] : [],
    });
  }

  manifest.updatedAt = now;
  await writeManifest(manifest);
}
