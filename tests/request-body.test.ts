import { describe, expect, it } from "vitest";
import {
  readMultipartFormDataWithLimit,
  readRequestTextWithLimit,
} from "@/domain/request-body";

describe("bounded request body reads", () => {
  it("rejects a declared oversized request before reading", async () => {
    const request = new Request("https://class.suiyuecare.com/api/test", {
      method: "POST",
      headers: { "content-length": "101" },
      body: "small",
    });
    await expect(readRequestTextWithLimit(request, 100)).rejects.toThrow(
      "REQUEST_BODY_TOO_LARGE",
    );
  });

  it("rejects a chunked request once the byte cap is crossed", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("12345"));
        controller.enqueue(new TextEncoder().encode("67890"));
        controller.close();
      },
    });
    const request = new Request("https://class.suiyuecare.com/api/test", {
      method: "POST",
      body: stream,
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    await expect(readRequestTextWithLimit(request, 9)).rejects.toThrow(
      "REQUEST_BODY_TOO_LARGE",
    );
  });

  it("returns a valid UTF-8 body within the cap", async () => {
    const body = JSON.stringify({ name: "歲悅" });
    const request = new Request("https://class.suiyuecare.com/api/test", {
      method: "POST",
      body,
    });
    await expect(readRequestTextWithLimit(request, 100)).resolves.toBe(body);
  });

  it("rejects chunked multipart before form-data parsing can exceed the cap", async () => {
    const boundary = "bounded-upload";
    const prefix = new TextEncoder().encode(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="large.pdf"\r\nContent-Type: application/pdf\r\n\r\n`,
    );
    const payload = new Uint8Array(10_500_001);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(prefix);
        controller.enqueue(payload.subarray(0, 5_250_000));
        controller.enqueue(payload.subarray(5_250_000));
        controller.close();
      },
    });
    const request = new Request(
      "https://class.suiyuecare.com/api/uploads/quarantine",
      {
        method: "POST",
        headers: {
          "content-type": `multipart/form-data; boundary=${boundary}`,
        },
        body: stream,
        duplex: "half",
      } as RequestInit & { duplex: "half" },
    );
    await expect(
      readMultipartFormDataWithLimit(request, 10_500_000),
    ).rejects.toThrow("REQUEST_BODY_TOO_LARGE");
  });
});
