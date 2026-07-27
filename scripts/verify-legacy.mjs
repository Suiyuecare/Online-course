import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";

const roots = [
  "src",
  "tests",
  "supabase/migrations",
  "supabase/seed.sql",
  "package.json",
  "next.config.ts",
  "vercel.json",
];
const textExtensions = new Set([".ts", ".tsx", ".js", ".mjs", ".json", ".sql"]);
const forbidden = [
  [/\bECPay\b/i, "automated ECPay payments"],
  [/\bStripe\b/i, "card processor"],
  [/\bLINE\s*(?:Login|OAuth|Auth)\b/i, "LINE authentication"],
  [/\bGoogle\s*(?:Login|OAuth|Auth)\b/i, "Google authentication"],
  [/\bsignInWithPassword\b/i, "password authentication"],
  [/\bemail[_ -]?password\b/i, "email/password authentication"],
  [/\bcredit[_ -]?card\b/i, "credit-card checkout"],
  [/\bvirtual[_ -]?atm\b/i, "virtual ATM"],
  [/\bseat[_ -]?lot(?:s)?\b/i, "legacy seat-lot semantics"],
  [/\bsubscription(?:s)?\b/i, "subscriptions"],
  [/\bdemo.{0,30}unlock|unlock.{0,30}demo\b/i, "demo unlock"],
];
const cleanupOnlyLegacyObjects = new Map([
  [
    "supabase/migrations/20260724011617_reset_legacy_application.sql",
    new Set(["legacy seat-lot semantics", "subscriptions"]),
  ],
]);

function filesAt(path) {
  const stat = statSync(path);
  if (stat.isFile()) return [path];
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) =>
    filesAt(join(path, entry.name)),
  );
}

const failures = [];
for (const file of roots.flatMap(filesAt)) {
  if (!textExtensions.has(extname(file))) continue;
  const relativePath = relative(process.cwd(), file);
  const source = readFileSync(file, "utf8");
  for (const [pattern, capability] of forbidden) {
    if (cleanupOnlyLegacyObjects.get(relativePath)?.has(capability)) continue;
    if (pattern.test(source)) {
      failures.push(`${relativePath}: ${capability}`);
    }
  }
}

if (failures.length) {
  console.error("Forbidden legacy capability proof: FAIL");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("Forbidden legacy capability proof: PASS");
console.log(`Scanned roots: ${roots.join(", ")}`);
console.log(
  "Cleanup-only allowlist: the guarded reset migration may name retired tables solely to drop them",
);
