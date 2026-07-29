import { NextResponse } from "next/server";
import {
  assertExpectedAccount,
  mutation,
  readJson,
} from "@/app/api/_shared/route-helpers";
import {
  readOwnLearnerCart,
  syncOwnLearnerCart,
} from "@/application/learner-cart";
import { learnerCartMutationSchema } from "@/domain/learner-cart";
import { requireUser } from "@/infrastructure/supabase/server";

export async function GET(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    assertExpectedAccount(request, user.id);
    const data = await readOwnLearnerCart(supabase);
    return NextResponse.json(
      { ok: true, data },
      {
        status: 200,
        headers: { "cache-control": "private, no-store" },
      },
    );
  } catch (error) {
    const code =
      error instanceof Error
        ? error.message.split(":")[0]
        : "LEARNER_CART_UNAVAILABLE";
    return NextResponse.json(
      { ok: false, error: code },
      {
        status:
          code === "AUTHENTICATION_REQUIRED"
            ? 401
            : code === "LEARNER_ACCOUNT_VERSION_CONFLICT"
              ? 409
              : 503,
        headers: { "cache-control": "private, no-store" },
      },
    );
  }
}

export async function POST(request: Request) {
  return mutation(request, async () => {
    const input = await readJson(request, learnerCartMutationSchema);
    const { supabase, user } = await requireUser();
    assertExpectedAccount(request, user.id);
    return syncOwnLearnerCart(supabase, input);
  });
}
