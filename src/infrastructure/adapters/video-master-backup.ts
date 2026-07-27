import { z } from "zod";
import { localProvidersAllowed } from "@/domain/identity";
import { serverConfig } from "@/infrastructure/config";

const verifiedBackup = z.object({
  verified: z.literal(true),
  immutableReference: z.string().min(3).max(1000),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});

export interface VideoMasterBackupAdapter {
  verify(input: {
    reference: string;
    sha256: string;
  }): Promise<z.infer<typeof verifiedBackup>>;
}

export class RemoteVideoMasterBackupAdapter
  implements VideoMasterBackupAdapter
{
  private readonly config = serverConfig();

  async verify(input: { reference: string; sha256: string }) {
    const endpoint = this.config.VIDEO_MASTER_BACKUP_ENDPOINT;
    const token = this.config.VIDEO_MASTER_BACKUP_TOKEN;
    if (!endpoint || !token) {
      throw new Error("VIDEO_MASTER_BACKUP_UNAVAILABLE");
    }
    const response = await fetch(
      `${endpoint.replace(/\/$/, "")}/v1/video-masters/verify`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(input),
        cache: "no-store",
      },
    );
    const result = verifiedBackup.safeParse(
      await response.json().catch(() => null),
    );
    if (
      !response.ok ||
      !result.success ||
      result.data.sha256 !== input.sha256
    ) {
      throw new Error("VIDEO_MASTER_BACKUP_NOT_VERIFIED");
    }
    return result.data;
  }
}

export class LocalVideoMasterBackupAdapter implements VideoMasterBackupAdapter {
  async verify(input: { reference: string; sha256: string }) {
    if (
      !localProvidersAllowed({
        nodeEnv: process.env.NODE_ENV,
        appEnv: process.env.APP_ENV,
        allowMocks: process.env.ALLOW_LOCAL_MOCK_PROVIDERS,
      }) ||
      !input.reference.startsWith("local-private-backup/")
    ) {
      throw new Error("LOCAL_VIDEO_MASTER_BACKUP_DISABLED");
    }
    return verifiedBackup.parse({
      verified: true,
      immutableReference: input.reference,
      sha256: input.sha256,
    });
  }
}

export function videoMasterBackupAdapter(): VideoMasterBackupAdapter {
  return localProvidersAllowed({
    nodeEnv: process.env.NODE_ENV,
    appEnv: process.env.APP_ENV,
    allowMocks: process.env.ALLOW_LOCAL_MOCK_PROVIDERS,
  })
    ? new LocalVideoMasterBackupAdapter()
    : new RemoteVideoMasterBackupAdapter();
}
