import { apiFetch } from "emdash/plugin-utils";
import { z } from "zod";
import { detailSchema, snapshotSchema } from "../core/api.js";
import type { AdminSnapshot, LinkDetail } from "../core/api.js";
import type { CommandInput } from "../core/schema.js";

export interface AdminClient {
  snapshot(query: URLSearchParams): Promise<AdminSnapshot>;
  detail(id: string): Promise<LinkDetail>;
  command(input: CommandInput): Promise<void>;
}
async function request<T>(
  path: string,
  schema: z.ZodType<T>,
  init?: RequestInit,
): Promise<T> {
  const response = await apiFetch(`/_emdash/api/plugins/relink${path}`, init);
  if (!response.ok) throw new Error(`Relink API ${response.status}`);
  const raw: unknown = await response.json();
  return z.object({ success: z.literal(true), data: schema }).parse(raw).data;
}
export const adminClient: AdminClient = {
  snapshot: async (query) =>
    request(`/snapshot?${query.toString()}`, snapshotSchema),
  detail: async (id) =>
    request(`/detail?id=${encodeURIComponent(id)}`, detailSchema),
  command: async (input) => {
    await request("/commands", z.object({ queued: z.string() }), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
  },
};
