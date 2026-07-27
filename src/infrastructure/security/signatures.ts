import { createHash, createHmac, timingSafeEqual } from "node:crypto";

function equalText(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return (
    leftBytes.length === rightBytes.length &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}

export function canonicalFingerprint(payload: unknown): string {
  return createHash("sha256").update(canonicalJson(payload)).digest("hex");
}

/**
 * Produces stable JSON without dropping nested provider fields.
 *
 * Provider webhook payloads have already passed JSON.parse, so rejecting
 * non-JSON values here is safer than silently fingerprinting two different
 * payloads as the same event.
 */
export function canonicalJson(payload: unknown): string {
  const ancestors = new Set<object>();

  function serialize(value: unknown, inArray = false): string | undefined {
    if (value === null) return "null";
    if (typeof value === "string" || typeof value === "boolean") {
      return JSON.stringify(value);
    }
    if (typeof value === "number") {
      if (!Number.isFinite(value)) {
        throw new Error("CANONICAL_JSON_NON_FINITE_NUMBER");
      }
      return JSON.stringify(value);
    }
    if (
      value === undefined ||
      typeof value === "function" ||
      typeof value === "symbol"
    ) {
      return inArray ? "null" : undefined;
    }
    if (typeof value === "bigint") {
      throw new Error("CANONICAL_JSON_BIGINT_UNSUPPORTED");
    }
    if (typeof value !== "object") {
      throw new Error("CANONICAL_JSON_UNSUPPORTED_VALUE");
    }
    if (ancestors.has(value)) throw new Error("CANONICAL_JSON_CYCLE");

    ancestors.add(value);
    try {
      if (Array.isArray(value)) {
        return `[${value
          .map((item) => serialize(item, true) ?? "null")
          .join(",")}]`;
      }
      const entries = Object.keys(value)
        .sort()
        .flatMap((key) => {
          const serialized = serialize(
            (value as Record<string, unknown>)[key],
            false,
          );
          return serialized === undefined
            ? []
            : [`${JSON.stringify(key)}:${serialized}`];
        });
      return `{${entries.join(",")}}`;
    } finally {
      ancestors.delete(value);
    }
  }

  return serialize(payload, false) ?? "null";
}

export function verifyTimestampedHmac(input: {
  body: string;
  timestamp: string | null;
  signature: string | null;
  secret: string | undefined;
  prefix?: string;
  nowMs?: number;
  toleranceMs?: number;
}): boolean {
  if (!input.timestamp || !input.signature || !input.secret) return false;
  const seconds = Number(input.timestamp);
  if (!Number.isFinite(seconds)) return false;
  const now = input.nowMs ?? Date.now();
  if (Math.abs(now - seconds * 1000) > (input.toleranceMs ?? 5 * 60_000)) {
    return false;
  }
  const prefix = input.prefix ?? "v0";
  const expected = `${prefix}=${createHmac("sha256", input.secret)
    .update(`${prefix}:${input.timestamp}:${input.body}`)
    .digest("hex")}`;
  return equalText(expected, input.signature);
}

export function verifyCloudflareStreamWebhook(input: {
  body: string;
  header: string | null;
  secret: string | undefined;
  nowSeconds?: number;
}): boolean {
  if (!input.header || !input.secret) return false;
  const fields = Object.fromEntries(
    input.header.split(",").map((item) => {
      const [key, value] = item.trim().split("=", 2);
      return [key, value];
    }),
  );
  const time = Number(fields.time);
  if (
    !Number.isFinite(time) ||
    Math.abs((input.nowSeconds ?? Date.now() / 1000) - time) > 300
  ) {
    return false;
  }
  const expected = createHmac("sha256", input.secret)
    .update(`${fields.time}.${input.body}`)
    .digest("hex");
  return Boolean(fields.sig1 && equalText(expected, fields.sig1));
}
