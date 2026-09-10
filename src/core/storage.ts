import type { PluginContext, StorageCollection } from "emdash";
import type { z } from "zod";
import {
  commandSchema,
  historySchema,
  initialState,
  linkSchema,
  occurrenceSchema,
  settingsSchema,
  stateSchema,
} from "./schema.js";
import type { Settings, WorkerState } from "./schema.js";
type QueryOptions = NonNullable<Parameters<StorageCollection["query"]>[0]>;

export class ValidatedCollection<T> {
  constructor(
    private readonly source: StorageCollection,
    private readonly schema: z.ZodType<T>,
  ) {}
  async get(id: string): Promise<T | null> {
    const raw: unknown = await this.source.get(id);
    return raw === null ? null : this.schema.parse(raw);
  }
  async put(id: string, value: T): Promise<void> {
    await this.source.put(id, this.schema.parse(value));
  }
  async delete(id: string): Promise<void> {
    await this.source.delete(id);
  }
  async page(
    options: QueryOptions = {},
  ): Promise<{ items: T[]; cursor: string | null }> {
    const result = await this.source.query(options);
    return {
      items: result.items.map((item) => this.schema.parse(item.data)),
      cursor: result.hasMore ? (result.cursor ?? null) : null,
    };
  }
  async all(options: QueryOptions = {}): Promise<T[]> {
    const items: T[] = [];
    let cursor: string | null = null;
    do {
      const page = await this.page({
        ...options,
        limit: 1000,
        ...(cursor ? { cursor } : {}),
      });
      items.push(...page.items);
      cursor = page.cursor;
    } while (cursor);
    return items;
  }
}

export class RelinkStore {
  readonly links: ValidatedCollection<z.infer<typeof linkSchema>>;
  readonly occurrences: ValidatedCollection<z.infer<typeof occurrenceSchema>>;
  readonly history: ValidatedCollection<z.infer<typeof historySchema>>;
  readonly commands: ValidatedCollection<z.infer<typeof commandSchema>>;
  constructor(
    private readonly context: Pick<PluginContext, "storage" | "kv">,
    private readonly defaults: Settings,
  ) {
    const collection = (name: string): StorageCollection => {
      const result = context.storage[name];
      if (!result) throw new Error(`Missing Relink storage: ${name}`);
      return result;
    };
    this.links = new ValidatedCollection(collection("links"), linkSchema);
    this.occurrences = new ValidatedCollection(
      collection("occurrences"),
      occurrenceSchema,
    );
    this.history = new ValidatedCollection(
      collection("history"),
      historySchema,
    );
    this.commands = new ValidatedCollection(
      collection("commands"),
      commandSchema,
    );
  }
  async settings(): Promise<Settings> {
    const raw: unknown = await this.context.kv.get("settings:v1");
    return raw === null || raw === undefined
      ? this.defaults
      : settingsSchema.parse(raw);
  }
  async saveSettings(value: Settings): Promise<void> {
    await this.context.kv.set("settings:v1", settingsSchema.parse(value));
  }
  async state(): Promise<WorkerState> {
    const raw: unknown = await this.context.kv.get("worker:v1");
    return raw === null || raw === undefined
      ? initialState()
      : stateSchema.parse(raw);
  }
  async saveState(state: WorkerState): Promise<void> {
    await this.context.kv.set("worker:v1", stateSchema.parse(state));
  }
}

export const storageDefinition = {
  links: { indexes: ["host", "nextCheckAt", "active", "excluded"] },
  occurrences: {
    indexes: ["linkId", "contentId", "collection", "pagePath", "generation"],
  },
  history: { indexes: ["linkId", "at"] },
  commands: { indexes: ["createdAt"] },
};
