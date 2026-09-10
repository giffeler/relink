import type { AuthProviderModule } from "emdash";

/** Isolated browser-test fixture. Never used by either distributable example. */
export const authenticate: AuthProviderModule["authenticate"] = async (
  request,
) => {
  const url = new URL(request.url);
  if (!["localhost", "127.0.0.1"].includes(url.hostname))
    throw new Error("Test authentication only permits loopback hosts");
  const cookie = request.headers.get("cookie") ?? "";
  if (!cookie.includes("relink-fixture=admin"))
    throw new Error("Test session required");
  return { email: "admin@relink.test", name: "Test administrator", role: 50 };
};
