import type { SupabaseClient } from "@supabase/supabase-js";
import {
  learnerCartMutationSchema,
  learnerCartResponseSchema,
  type LearnerCartMutation,
  type LearnerCartResponse,
} from "@/domain/learner-cart";

export async function readOwnLearnerCart(
  client: SupabaseClient,
): Promise<LearnerCartResponse> {
  const { data, error } = await client.rpc("read_own_learner_cart");
  const parsed = learnerCartResponseSchema.safeParse(data);
  if (error || !parsed.success) {
    throw new Error("LEARNER_CART_UNAVAILABLE");
  }
  return parsed.data;
}

export async function syncOwnLearnerCart(
  client: SupabaseClient,
  input: LearnerCartMutation,
): Promise<LearnerCartResponse> {
  const parsedInput = learnerCartMutationSchema.parse(input);
  const { data, error } = await client.rpc("sync_own_learner_cart", {
    p_operation: parsedInput.operation,
    p_course_version_ids: parsedInput.courseVersionIds,
  });
  const parsed = learnerCartResponseSchema.safeParse(data);
  if (error || !parsed.success) {
    const code = error?.message.match(/LEARNER_CART_[A-Z_]+/)?.[0];
    throw new Error(code ?? "LEARNER_CART_UNAVAILABLE");
  }
  return parsed.data;
}
