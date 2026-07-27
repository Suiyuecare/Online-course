import { z } from "zod";
import { localProvidersAllowed } from "@/domain/identity";
import { serviceSupabase } from "@/infrastructure/supabase/server";

export async function POST(request: Request) {
  if (
    !localProvidersAllowed({
      nodeEnv: process.env.NODE_ENV,
      appEnv: process.env.APP_ENV,
      allowMocks: process.env.ALLOW_LOCAL_MOCK_PROVIDERS,
    })
  ) {
    return new Response(null, { status: 404 });
  }
  const uid = z
    .string()
    .uuid()
    .parse(new URL(request.url).searchParams.get("uid"));
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File) || file.size < 1 || file.size > 2_000_000_000) {
    return Response.json({ ok: false }, { status: 400 });
  }
  const { error } = await serviceSupabase().rpc("record_local_stream_ready", {
    p_provider_uid: uid,
  });
  return error
    ? Response.json({ ok: false }, { status: 409 })
    : Response.json({ ok: true }, { status: 200 });
}
