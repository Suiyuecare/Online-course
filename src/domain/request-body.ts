export const jsonRequestBodyLimitBytes = 1024 * 1024;
export const webhookRequestBodyLimitBytes = 512 * 1024;
export const quarantineRequestBodyLimitBytes = 10_500_000;

export async function readRequestBytesWithLimit(
  request: Request,
  maximumBytes: number,
): Promise<Uint8Array> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes <= 0) {
    throw new Error("REQUEST_BODY_LIMIT_INVALID");
  }
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    if (!/^\d+$/.test(declaredLength)) {
      throw new Error("REQUEST_BODY_LENGTH_INVALID");
    }
    if (Number(declaredLength) > maximumBytes) {
      throw new Error("REQUEST_BODY_TOO_LARGE");
    }
  }
  if (!request.body) return new Uint8Array();

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maximumBytes) {
      await reader.cancel().catch(() => undefined);
      throw new Error("REQUEST_BODY_TOO_LARGE");
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function readRequestTextWithLimit(
  request: Request,
  maximumBytes: number,
): Promise<string> {
  const bytes = await readRequestBytesWithLimit(request, maximumBytes);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("REQUEST_BODY_ENCODING_INVALID");
  }
}

export async function readMultipartFormDataWithLimit(
  request: Request,
  maximumBytes: number,
): Promise<FormData> {
  const contentType = request.headers.get("content-type");
  if (!contentType?.toLowerCase().startsWith("multipart/form-data;")) {
    throw new Error("REQUEST_MULTIPART_REQUIRED");
  }
  const bytes = await readRequestBytesWithLimit(request, maximumBytes);
  const boundedRequest = new Request(request.url, {
    method: request.method,
    headers: { "content-type": contentType },
    body: bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer,
  });
  return boundedRequest.formData();
}
