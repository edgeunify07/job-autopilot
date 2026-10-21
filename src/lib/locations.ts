/**
 * Location matching, written for the case this tool exists to serve: a candidate
 * in India looking at employers worldwide who hire *into* India.
 *
 * The naive version of this ("does the text mention Bengaluru") is wrong twice
 * over. It matches a US role whose description mentions a Bengaluru office, and
 * it lets "Remote - U.S." through to someone who cannot take a US-remote job.
 * So: match on the posting's own location field, and read the scope of a remote
 * role rather than treating every "remote" as open to everyone.
 */

const INDIA_PLACES = [
  "india",
  "bharat",
  "bengaluru",
  "bangalore",
  "blr",
  "hyderabad",
  "hyd",
  "pune",
  "mumbai",
  "bombay",
  "navi mumbai",
  "thane",
  "chennai",
  "madras",
  "kolkata",
  "calcutta",
  "delhi",
  "new delhi",
  "ncr",
  "gurgaon",
  "gurugram",
  "noida",
  "ghaziabad",
  "faridabad",
  "ahmedabad",
  "gandhinagar",
  "jaipur",
  "indore",
  "bhopal",
  "chandigarh",
  "mohali",
  "lucknow",
  "kanpur",
  "nagpur",
  "coimbatore",
  "kochi",
  "cochin",
  "trivandrum",
  "thiruvananthapuram",
  "mysore",
  "mysuru",
  "visakhapatnam",
  "vizag",
  "bhubaneswar",
  "goa",
  "karnataka",
  "maharashtra",
  "telangana",
  "tamil nadu",
  "kerala",
  "gujarat",
  "haryana",
  "uttar pradesh",
  "west bengal",
  "rajasthan",
  "punjab",
  "andhra pradesh",
];

/** Places that mean "not open to someone based in India". */
const FOREIGN_SCOPES = [
  "u.s.",
  "u.s",
  "us only",
  "usa",
  "united states",
  "america",
  "canada",
  "canadian",
  "mexico",
  "brazil",
  "latam",
  "uk",
  "u.k.",
  "united kingdom",
  "england",
  "scotland",
  "ireland",
  "emea",
  "europe",
  "european",
  "germany",
  "france",
  "spain",
  "portugal",
  "poland",
  "netherlands",
  "sweden",
  "israel",
  "australia",
  "new zealand",
  "anz",
  "japan",
  "china",
  "singapore",
  "philippines",
  "indonesia",
  "vietnam",
  "korea",
  "uae",
  "dubai",
  "nigeria",
  "kenya",
  "south africa",
];

const norm = (v: string) => ` ${v.toLowerCase().replace(/[^a-z0-9.]+/g, " ").replace(/\s+/g, " ").trim()} `;

/** Word-boundary-ish containment, so "us" does not match "customer". */
function mentions(haystack: string, needle: string): boolean {
  return haystack.includes(` ${needle} `);
}

export function isIndiaLocation(location: string): boolean {
  const h = norm(location);
  return INDIA_PLACES.some((p) => mentions(h, p));
}

export function isRemote(location: string): boolean {
  return /\b(remote|anywhere|work from home|wfh|distributed)\b/i.test(location);
}

export type RemoteScope = "india" | "foreign" | "unscoped";

/**
 * A remote role's reach. "Remote - India" is ours, "Remote U.S." is not, and a
 * bare "Remote" is genuinely ambiguous — most are quietly country-locked, so it
 * is treated as a separate case the caller decides on.
 */
export function remoteScope(location: string): RemoteScope {
  const h = norm(location);
  if (INDIA_PLACES.some((p) => mentions(h, p))) return "india";
  if (FOREIGN_SCOPES.some((p) => mentions(h, p))) return "foreign";
  return "unscoped";
}

export interface LocationFilter {
  /** Cities/regions the candidate will work in. Empty means no constraint. */
  wanted: string[];
  /** Only remote roles. */
  remoteOnly: boolean;
  /** Reject anything not in India, including foreign-remote. */
  indiaOnly: boolean;
  /** Treat a bare "Remote" with no country as acceptable. */
  allowUnscopedRemote: boolean;
}

/**
 * Decide whether a posting's location is one the candidate can actually take.
 * Only the posting's own location field is consulted — never the description.
 */
export function locationMatches(location: string, f: LocationFilter): boolean {
  const loc = location.trim();
  const remote = isRemote(loc);

  if (f.remoteOnly && !remote) return false;

  if (remote) {
    const scope = remoteScope(loc);
    if (scope === "foreign") return false;
    if (scope === "india") return true;
    // Unscoped remote: allowed only if the candidate opted in.
    if (!f.allowUnscopedRemote) return false;
    return true;
  }

  if (f.indiaOnly && !isIndiaLocation(loc)) return false;

  if (!f.wanted.length) return true;

  const h = norm(loc);
  if (f.wanted.some((w) => w.trim() && mentions(h, w.trim().toLowerCase()))) return true;

  // "Bengaluru" in prefs should also match a posting that just says "India".
  if (f.indiaOnly && isIndiaLocation(loc)) return true;

  return false;
}
