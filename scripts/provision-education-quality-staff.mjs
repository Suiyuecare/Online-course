import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { loadEnvFile } from "node:process";
import { createClient } from "@supabase/supabase-js";

const staffEmail = "edu.control@suiyuecare.com";
const environmentFile =
  process.env.SUIYUE_PROVISION_ENV_FILE ?? ".env.production.local";

if (existsSync(environmentFile)) loadEnvFile(environmentFile);

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseSecret = process.env.SUPABASE_SECRET_KEY;
const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://class.suiyuecare.com";

if (!supabaseUrl || !supabaseSecret) {
  throw new Error("SUPABASE_PROVISIONING_CONFIGURATION_MISSING");
}

const service = createClient(supabaseUrl, supabaseSecret, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function findExistingUser(email) {
  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await service.auth.admin.listUsers({
      page,
      perPage: 1000,
    });
    if (error) throw new Error("STAFF_USER_LOOKUP_FAILED");
    const match = data.users.find(
      (user) => user.email?.trim().toLowerCase() === email,
    );
    if (match) return match;
    if (data.users.length < 1000) return null;
  }
  throw new Error("STAFF_USER_LOOKUP_LIMIT_REACHED");
}

const temporaryPassword = `${randomBytes(24).toString("base64url")}!Aa7`;
const protectedMetadata = {
  provider: "email",
  providers: ["email"],
  account_type: "staff",
  staff_login: true,
  staff_role: "course_admin",
  must_change_password: true,
};

const existingUser = await findExistingUser(staffEmail);
let authUser;

if (existingUser) {
  if (
    existingUser.app_metadata?.account_type !== "staff" ||
    existingUser.app_metadata?.staff_login !== true ||
    existingUser.app_metadata?.staff_role !== "course_admin"
  ) {
    throw new Error("STAFF_EMAIL_ALREADY_BELONGS_TO_ANOTHER_ACCOUNT");
  }
  const { data, error } = await service.auth.admin.updateUserById(
    existingUser.id,
    {
      password: temporaryPassword,
      email_confirm: true,
      app_metadata: {
        ...existingUser.app_metadata,
        ...protectedMetadata,
      },
      user_metadata: {
        ...existingUser.user_metadata,
        display_name: "教學品管部",
      },
    },
  );
  if (error || !data.user) throw new Error("STAFF_USER_UPDATE_FAILED");
  authUser = data.user;
} else {
  const { data, error } = await service.auth.admin.createUser({
    email: staffEmail,
    password: temporaryPassword,
    email_confirm: true,
    app_metadata: protectedMetadata,
    user_metadata: { display_name: "教學品管部" },
  });
  if (error || !data.user) throw new Error("STAFF_USER_CREATION_FAILED");
  authUser = data.user;
}

const { data: roleProvisioning, error: roleError } = await service.rpc(
  "provision_education_quality_staff",
  {
    p_auth_user_id: authUser.id,
    p_expected_email: staffEmail,
  },
);

if (roleError || !roleProvisioning) {
  throw new Error("STAFF_ROLE_PROVISIONING_FAILED");
}

const credentials = [
  "歲悅學苑｜教學品管部後台",
  `登入網址：${new URL("/staff/login", siteUrl).toString()}`,
  `帳號：${staffEmail}`,
  `一次性臨時密碼：${temporaryPassword}`,
  "首次登入後，系統會立即要求更換密碼並設定驗證器。",
].join("\n");

const clipboard = spawnSync("pbcopy", [], {
  input: credentials,
  encoding: "utf8",
  stdio: ["pipe", "ignore", "ignore"],
});

if (clipboard.status !== 0) {
  throw new Error(
    "STAFF_CREDENTIAL_CLIPBOARD_FAILED_RERUN_TO_ROTATE_TEMPORARY_PASSWORD",
  );
}

console.log("Teaching-quality staff account is ready.");
console.log("The one-time credentials were copied to the macOS clipboard.");
console.log("No password was printed or written to the repository.");
