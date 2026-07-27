import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const paths = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard"],
  { encoding: "utf8" },
)
  .trim()
  .split("\n")
  .filter(Boolean)
  .filter(
    (path) =>
      !path.startsWith("PLAN") &&
      !path.endsWith("pnpm-lock.yaml") &&
      !path.endsWith("suiyue-milk.png"),
  );

const secretPatterns = [
  /\bsk_(?:live|test)_[A-Za-z0-9]{16,}\b/,
  /\bsk-proj-[A-Za-z0-9_-]{16,}\b/,
  /\bsb_secret_[A-Za-z0-9_-]{16,}\b/,
  /\bAC[a-fA-F0-9]{32}\b/,
  /-----BEGIN (?:RSA |EC |)PRIVATE KEY-----/,
];
for (const path of paths) {
  let content;
  try {
    content = readFileSync(path, "utf8");
  } catch {
    continue;
  }
  for (const pattern of secretPatterns) {
    if (pattern.test(content)) throw new Error(`Potential secret in ${path}`);
  }
}

const example = readFileSync(".env.example", "utf8");
for (const line of example.split("\n")) {
  if (
    /(?:SECRET|TOKEN|PRIVATE_KEY|AUTH_TOKEN|MASTER_KEY|SERVICE_ROLE|BLIND_INDEX_KEY)=.+/.test(
      line,
    )
  ) {
    throw new Error(`Secret-like value committed in .env.example: ${line}`);
  }
}
console.log(`Secret scan: PASS (${paths.length} text paths inspected)`);
