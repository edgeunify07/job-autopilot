import fs from "node:fs";
import path from "node:path";
import { paths, ensureDirs } from "../lib/paths";

export interface BoardList {
  greenhouse: string[];
  lever: string[];
  ashby: string[];
}

/**
 * Company board tokens for the public ATS APIs.
 *
 * This seed list is a starting point, not a universe. Add your own: the token is
 * the last path segment of a company's careers URL, e.g.
 *   boards.greenhouse.io/<token>   jobs.lever.co/<token>   jobs.ashbyhq.com/<token>
 * Unknown or renamed tokens are skipped with a warning, never fatal.
 *
 * Every token in the seed list below was checked against the live API. They are
 * mostly global companies, because most Indian employers do not publish a public
 * Greenhouse/Lever/Ashby board — for the Indian market the portal connectors
 * (Naukri, Internshala, LinkedIn) do the heavy lifting. Add the specific
 * companies you want; that is what makes this source worth having.
 */
export const SEED_BOARDS: BoardList = {
  greenhouse: [
    "stripe",
    "databricks",
    "anthropic",
    "gitlab",
    "mongodb",
    "coinbase",
    "flexport",
    "airbnb",
    "robinhood",
    "reddit",
    "figma",
  ],
  lever: ["palantir", "spotify", "matchgroup", "tala"],
  ashby: ["openai", "ramp", "notion", "cohere", "vanta", "linear", "astronomer"],
};

const FILE = () => path.join(paths.root, "boards.json");

export function loadBoards(): BoardList {
  ensureDirs();
  try {
    const raw = fs.readFileSync(FILE(), "utf8");
    const parsed = JSON.parse(raw) as Partial<BoardList>;
    return {
      greenhouse: parsed.greenhouse ?? [],
      lever: parsed.lever ?? [],
      ashby: parsed.ashby ?? [],
    };
  } catch {
    saveBoards(SEED_BOARDS);
    return SEED_BOARDS;
  }
}

export function saveBoards(boards: BoardList) {
  ensureDirs();
  fs.writeFileSync(FILE(), JSON.stringify(boards, null, 2));
}
