import fs from "node:fs";
import path from "node:path";

const root = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.resolve(process.cwd(), "data");

export const paths = {
  root,
  resumes: path.join(root, "resumes"),
  variants: path.join(root, "resumes", "variants"),
  profiles: path.join(root, "browser-profiles"),
  screenshots: path.join(root, "screenshots"),
  exports: path.join(root, "exports"),
  logs: path.join(root, "logs"),
};

export function ensureDirs() {
  for (const dir of Object.values(paths)) fs.mkdirSync(dir, { recursive: true });
}

/** Strip anything that could escape a directory or upset a filesystem. */
export function safeSlug(input: string, max = 60) {
  return (
    input
      .normalize("NFKD")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .slice(0, max)
      .toLowerCase() || "untitled"
  );
}
