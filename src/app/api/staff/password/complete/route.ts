import { mutation, readJson } from "@/app/api/_shared/route-helpers";
import {
  completeStaffPasswordSchema,
  isProtectedStaffMetadata,
  mustChangeStaffPassword,
} from "@/domain/staff-password";
import { requireUser, serviceSupabase } from "@/infrastructure/supabase/server";

export async function POST(request: Request) {
  return mutation(request, async () => {
    const input = await readJson(request, completeStaffPasswordSchema);
    const { user } = await requireUser();
    if (!isProtectedStaffMetadata(user.app_metadata)) {
      throw new Error("STAFF_ACCOUNT_REQUIRED");
    }
    if (!mustChangeStaffPassword(user.app_metadata)) {
      throw new Error("STAFF_PASSWORD_ALREADY_COMPLETED");
    }

    const { data, error } = await serviceSupabase().auth.admin.updateUserById(
      user.id,
      {
        password: input.password,
        app_metadata: {
          ...user.app_metadata,
          must_change_password: false,
        },
      },
    );
    if (error || !data.user) {
      throw new Error("STAFF_PASSWORD_CHANGE_REJECTED");
    }
    return { completed: true };
  });
}
