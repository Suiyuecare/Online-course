import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

export const videoMasterBackupItemSchema = z
  .object({
    videoAssetId: z.string().uuid(),
    courseVersionId: z.string().uuid(),
    courseTitle: z.string().min(1),
    lessonTitle: z.string().min(1),
    status: z.enum(["uploading", "processing", "ready", "failed"]),
    providerReady: z.boolean(),
    masterBackupVerified: z.boolean(),
    backupVerifiedAt: z.string().nullable(),
    createdAt: z.string(),
  })
  .strict();

export type VideoMasterBackupItem = z.infer<typeof videoMasterBackupItemSchema>;

export async function readVideoMasterBackupWorklist(
  client: SupabaseClient,
  courseVersionId?: string,
) {
  const { data, error } = await client.rpc(
    "read_video_master_backup_worklist",
    {
      p_course_version_id: courseVersionId || null,
    },
  );
  if (error) throw new Error("VIDEO_BACKUP_WORKLIST_UNAVAILABLE");
  const parsed = z.array(videoMasterBackupItemSchema).safeParse(data);
  if (!parsed.success) throw new Error("VIDEO_BACKUP_WORKLIST_INVALID");
  return parsed.data;
}
