import { getChatGPTUser } from "@/app/chatgpt-auth";
import { ApiError } from "./api-errors.ts";
import { getRuntimeValue } from "./server-config.ts";
import { allowsLocalDemoIdentity } from "./server-auth-policy.ts";

export async function requireApiOwner(request: Request): Promise<string> {
  const user = await getChatGPTUser();
  if (user) return user.userId;
  if (allowsLocalDemoIdentity({
    isDev: (import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV === true,
    nodeEnv: typeof process === "undefined" ? undefined : process.env.NODE_ENV,
    enabled: getRuntimeValue("ALLOW_LOCAL_DEMO_AUTH"),
    hostname: new URL(request.url).hostname,
  })) return "local-owner";
  throw new ApiError(401, "AUTH_REQUIRED", "Sign in with ChatGPT to access your CommonGround workspace.");
}
