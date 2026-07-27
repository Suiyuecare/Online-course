import { z } from "zod";
import { mutation, readJson } from "@/app/api/_shared/route-helpers";
import { videoMasterBackupAdapter } from "@/infrastructure/adapters/video-master-backup";
import { requireUser, serviceSupabase } from "@/infrastructure/supabase/server";

export async function POST(
  request: Request,
  context: { params: Promise<{ videoAssetId: string }> },
) {
  return mutation(request, async () => {
    const { videoAssetId } = await context.params;
    z.uuid().parse(videoAssetId);
    const input = await readJson(
      request,
      z.object({
        reference: z.string().trim().min(3).max(1000),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
      }),
    );
    const { supabase } = await requireUser();
    const { data: actorId, error } = await supabase.rpc(
      "authorize_video_master_backup",
      { p_video_asset_id: videoAssetId },
    );
    const actor = z.uuid().safeParse(actorId);
    if (error || !actor.success) {
      throw new Error("VIDEO_BACKUP_AUTHORIZATION_REJECTED");
    }
    const verified = await videoMasterBackupAdapter().verify(input);
    const { data: status, error: finalizeError } = await serviceSupabase().rpc(
      "confirm_video_master_backup",
      {
        p_video_asset_id: videoAssetId,
        p_actor_id: actor.data,
        p_reference: verified.immutableReference,
        p_sha256: verified.sha256,
      },
    );
    if (finalizeError) throw new Error("VIDEO_MASTER_BACKUP_REJECTED");
    return { status };
  });
}
