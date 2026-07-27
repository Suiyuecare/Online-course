import { localProvidersAllowed } from "@/domain/identity";
import { serverConfig } from "@/infrastructure/config";

type CertificateAccreditationState =
  | {
      certificateKind: "completion";
      officialAccreditationCredited: false;
      accreditationReference: null;
      accreditationPoints: null;
      accreditationAuthority: null;
    }
  | {
      certificateKind: "accreditation";
      officialAccreditationCredited: true;
      accreditationReference: string;
      accreditationPoints: number;
      accreditationAuthority: string;
    };

export type CertificateRenderContext = CertificateAccreditationState & {
  enrollmentId: string;
  learnerName: string;
  courseTitle: string;
  courseVersion: number;
  completedOn: string;
  requirements: {
    requiredWatchSeconds: number;
    livePresencePercent: number | null;
    liveCameraPercent: number | null;
    quizPassingScore: number;
    surveyRequired: boolean;
  };
  liveSessions: Array<{
    sessionId: string;
    title: string;
    startsAt: string;
    denominatorSeconds: number;
    presenceThreshold: number;
    cameraThreshold: number;
    presencePercent: number;
    cameraPercent: number;
  }>;
  verificationUrl: string;
};

export interface CertificateRenderer {
  render(context: CertificateRenderContext): Promise<Uint8Array>;
}

function assertPdf(bytes: Uint8Array) {
  if (
    bytes.byteLength < 100 ||
    bytes.byteLength > 10_000_000 ||
    Buffer.from(bytes.subarray(0, 5)).toString("ascii") !== "%PDF-"
  ) {
    throw new Error("CERTIFICATE_RENDERER_RESPONSE_INVALID");
  }
  return bytes;
}

export class RemoteCertificateRenderer implements CertificateRenderer {
  private readonly config = serverConfig();

  async render(context: CertificateRenderContext) {
    const endpoint = this.config.CERTIFICATE_RENDERER_ENDPOINT;
    const token = this.config.CERTIFICATE_RENDERER_TOKEN;
    if (!endpoint || !token) {
      throw new Error("CERTIFICATE_RENDERER_UNAVAILABLE");
    }
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(context),
      cache: "no-store",
    });
    if (
      !response.ok ||
      response.headers.get("content-type")?.split(";")[0] !== "application/pdf"
    ) {
      throw new Error("CERTIFICATE_RENDERER_FAILED");
    }
    return assertPdf(new Uint8Array(await response.arrayBuffer()));
  }
}

export class LocalCertificateRenderer implements CertificateRenderer {
  async render(context: CertificateRenderContext) {
    if (
      !localProvidersAllowed({
        nodeEnv: process.env.NODE_ENV,
        appEnv: process.env.APP_ENV,
        allowMocks: process.env.ALLOW_LOCAL_MOCK_PROVIDERS,
      })
    ) {
      throw new Error("LOCAL_CERTIFICATE_RENDERER_DISABLED");
    }
    const safeId = context.enrollmentId.replace(/[^a-zA-Z0-9-]/g, "");
    const stream = `BT /F1 16 Tf 72 700 Td (Suiyue Academy completion ${safeId}) Tj ET`;
    const objects = [
      "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
      "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj",
      "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >> endobj",
      `4 0 obj << /Length ${stream.length} >> stream\n${stream}\nendstream endobj`,
      "5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj",
    ];
    let pdf = "%PDF-1.4\n";
    const offsets = [0];
    for (const object of objects) {
      offsets.push(Buffer.byteLength(pdf));
      pdf += `${object}\n`;
    }
    const xref = Buffer.byteLength(pdf);
    pdf += `xref\n0 6\n0000000000 65535 f \n${offsets
      .slice(1)
      .map((offset) => `${offset.toString().padStart(10, "0")} 00000 n `)
      .join(
        "\n",
      )}\ntrailer << /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    return assertPdf(Buffer.from(pdf));
  }
}

export function certificateRenderer(): CertificateRenderer {
  return serverConfig().CERTIFICATE_RENDERER_ENDPOINT
    ? new RemoteCertificateRenderer()
    : new LocalCertificateRenderer();
}
