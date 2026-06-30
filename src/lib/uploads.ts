import { writeFile, mkdir } from "fs/promises";
import { join } from "path";

const UPLOADS_DIR = join(process.cwd(), "uploads");

export async function saveUpload(id: string, buffer: Buffer, ext: string): Promise<string> {
  await mkdir(UPLOADS_DIR, { recursive: true });
  const filename = `${id}.${ext}`;
  await writeFile(join(UPLOADS_DIR, filename), buffer);
  return `uploads/${filename}`;
}

export function uploadAbsPath(relativePath: string): string {
  return join(process.cwd(), relativePath);
}
