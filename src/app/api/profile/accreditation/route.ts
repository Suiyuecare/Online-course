import { mutation, readJson } from "@/app/api/_shared/route-helpers";
import {
  accreditationIdentitySchema,
  resolveActivePerson,
  storeAccreditationIdentity,
} from "@/infrastructure/security/accreditation-identity";
import { requireUser } from "@/infrastructure/supabase/server";

export async function POST(request: Request) {
  return mutation(request, async () => {
    const profile = await readJson(request, accreditationIdentitySchema);
    const { supabase, user } = await requireUser();
    if (!user.phone) throw new Error("PHONE_IDENTITY_REQUIRED");
    return storeAccreditationIdentity({
      personId: await resolveActivePerson(supabase),
      phone: user.phone,
      profile,
    });
  });
}
