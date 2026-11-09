/** The local demo identity can never be enabled by a browser parameter. */
export function allowsLocalDemoIdentity(input: { isDev: boolean; nodeEnv: string | undefined; enabled: string; hostname: string }): boolean {
  return input.isDev === true && input.nodeEnv !== "production" && input.enabled === "true" &&
    (input.hostname === "localhost" || input.hostname === "127.0.0.1");
}
