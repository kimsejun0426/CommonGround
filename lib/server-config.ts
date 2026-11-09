import { env } from "cloudflare:workers";

type RuntimeValues = {
  PAYPAL_CLIENT_ID?: string;
  PAYPAL_CLIENT_SECRET?: string;
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
  ALLOW_LOCAL_DEMO_AUTH?: string;
};

export function getRuntimeValue(name: keyof RuntimeValues): string {
  const value = (env as unknown as RuntimeValues)[name] ?? (typeof process === "undefined" ? undefined : process.env[name]);
  return typeof value === "string" ? value.trim() : "";
}

/** Server-only. Never serialize this object. */
export function getServerConfig() {
  const paypalClientId = getRuntimeValue("PAYPAL_CLIENT_ID");
  const paypalClientSecret = getRuntimeValue("PAYPAL_CLIENT_SECRET");
  const openaiApiKey = getRuntimeValue("OPENAI_API_KEY");
  return {
    paypalClientId, paypalClientSecret, openaiApiKey,
    openaiModel: getRuntimeValue("OPENAI_MODEL") || "gpt-5.4-mini",
    paypalReady: Boolean(paypalClientId && paypalClientSecret),
    aiReady: Boolean(openaiApiKey),
    mode: "sandbox" as const,
  };
}

export function getPublicConfig() {
  const config = getServerConfig();
  return {
    aiReady: config.aiReady,
    paypalReady: config.paypalReady,
    paypalClientId: config.paypalReady ? config.paypalClientId : "",
    mode: "sandbox" as const,
    workspaceMode: "single-owner-persona-simulation" as const,
    supplierVerified: false,
  };
}
