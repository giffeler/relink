import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Button } from "@cloudflare/kumo";
import { DirectionProvider } from "@cloudflare/kumo/primitives/direction-provider";
import { csvCell, effectiveDestination, viewSchema } from "../core/api.js";
import type { AdminSnapshot, LinkDetail } from "../core/api.js";
import { commandInputSchema, directionSchema } from "../core/schema.js";
import type {
  CommandInput,
  HistoryEntry,
  LinkRecord,
  Settings,
} from "../core/schema.js";
import { adminClient } from "./client.js";
import type { AdminClient } from "./client.js";
import { useRelinkLocale } from "./i18n.js";
import type { MessageKey } from "./messages.js";

type Translate = ReturnType<typeof useRelinkLocale>["t"];
function Dialog({
  open,
  title,
  children,
  close,
  direction,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  close: () => void;
  direction: "ltr" | "rtl";
}): ReactNode {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (open) dialog?.showModal();
    else dialog?.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="rl-dialog"
      dir={direction}
      aria-labelledby={id}
      onCancel={close}
      onClose={close}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const elements = [
          ...event.currentTarget.querySelectorAll<HTMLElement>(
            "a[href], button, input, select, textarea, [tabindex]",
          ),
        ].filter(
          (element) =>
            element.tabIndex >= 0 &&
            !element.matches(":disabled") &&
            element.getClientRects().length > 0,
        );
        const first = elements[0];
        const last = elements.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
    >
      <h2 id={id}>{title}</h2>
      {children}
    </dialog>
  );
}
function Url({ value }: { value: string }): ReactNode {
  return (
    <bdi dir="ltr" className="rl-url">
      {value}
    </bdi>
  );
}
function Status({ link, t }: { link: LinkRecord; t: Translate }): ReactNode {
  const kind = link.excluded ? "excluded" : (link.lastCheck?.kind ?? "pending");
  return (
    <span className={`rl-badge rl-${kind}`}>
      {t(kind)}
      {link.lastCheck?.kind === "broken" && link.lastCheck.status
        ? ` · ${link.lastCheck.status}`
        : ""}
    </span>
  );
}
function History({
  entries,
  t,
  date,
}: {
  entries: HistoryEntry[];
  t: Translate;
  date: (at: number | null) => string;
}): ReactNode {
  return (
    <ol className="rl-history">
      {entries.map((entry) => (
        <li key={entry.id}>
          <time>{date(entry.at)}</time>
          <strong>{t(entry.event)}</strong>
          {entry.result && (
            <span>
              {t(entry.result.kind)}
              {entry.result.kind !== "healthy"
                ? ` · ${t(entry.result.reason)}`
                : ""}
            </span>
          )}
          {entry.destination && <Url value={entry.destination} />}
        </li>
      ))}
    </ol>
  );
}

export function RelinkApp({
  client = adminClient,
  compact = false,
  contentId = "",
  collection = "",
}: {
  client?: AdminClient;
  compact?: boolean;
  contentId?: string;
  collection?: string;
}): ReactNode {
  const { t, locale } = useRelinkLocale();
  const [snapshot, setSnapshot] = useState<AdminSnapshot | null>(null);
  const [query, setQuery] = useState(
    () =>
      new URLSearchParams({
        contentId:
          contentId ||
          (typeof window !== "undefined"
            ? (new URL(window.location.href).searchParams.get("contentId") ??
              "")
            : ""),
        collection,
      }),
  );
  const [error, setError] = useState(false);
  const [notice, setNotice] = useState<MessageKey | null>(null);
  const [detail, setDetail] = useState<LinkDetail | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [form, setForm] = useState<"destination" | "reschedule" | null>(null);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [inheritedDirection, setInheritedDirection] = useState<"ltr" | "rtl">(
    "ltr",
  );
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const sync = (): void => {
      if (root.current)
        setInheritedDirection(
          getComputedStyle(root.current.parentElement ?? root.current)
            .direction === "rtl"
            ? "rtl"
            : "ltr",
        );
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["dir", "class"],
    });
    return () => observer.disconnect();
  }, [locale]);
  const selectedDirection = snapshot?.settings.direction ?? "auto";
  const direction =
    selectedDirection === "auto" ? inheritedDirection : selectedDirection;
  const date = (at: number | null): string =>
    at === null
      ? t("never")
      : new Intl.DateTimeFormat(locale, {
          dateStyle: "medium",
          timeStyle: "short",
        }).format(at);
  const number = (value: number): string =>
    new Intl.NumberFormat(locale).format(value);
  const refresh = (): void => setRevision((value) => value + 1);
  useEffect(() => {
    let active = true;
    const load = async (): Promise<void> => {
      try {
        const result = await client.snapshot(query);
        if (active) {
          setSnapshot(result);
          setError(false);
        }
      } catch {
        if (active) setError(true);
      }
    };
    const timeout = setTimeout(() => {
      void load();
    }, 200);
    const interval = setInterval(() => {
      void load();
    }, 15000);
    return () => {
      active = false;
      clearTimeout(timeout);
      clearInterval(interval);
    };
  }, [client, query, revision]);
  const filter = (key: string, value: string): void =>
    setQuery((current) => {
      const next = new URLSearchParams(current);
      if (value) next.set(key, value);
      else next.delete(key);
      if (key !== "offset") next.delete("offset");
      return next;
    });
  const command = async (input: CommandInput): Promise<void> => {
    setBusy(true);
    try {
      await client.command(commandInputSchema.parse(input));
      setNotice("queued");
      setDetail(null);
      setSettingsOpen(false);
      refresh();
    } catch {
      setNotice("commandError");
    } finally {
      setBusy(false);
    }
  };
  const openDetail = async (id: string): Promise<void> => {
    try {
      setDetail(await client.detail(id));
      setForm(null);
    } catch {
      setNotice("error");
    }
  };
  const exportCsv = async (): Promise<void> => {
    setBusy(true);
    try {
      const rows = [
        [
          t("original"),
          t("occurrences"),
          t("state"),
          t("lastCheck"),
          t("destination"),
          t("nextReview"),
        ],
      ];
      let offset = 0;
      let total = 0;
      do {
        const pageQuery = new URLSearchParams(query);
        if (pageQuery.get("view") === "history") pageQuery.set("view", "all");
        pageQuery.set("limit", "100");
        pageQuery.set("offset", String(offset));
        const page = await client.snapshot(pageQuery);
        total = page.total;
        for (const link of page.links)
          rows.push([
            link.url,
            String(
              page.occurrences.filter((entry) => entry.linkId === link.id)
                .length,
            ),
            t(link.excluded ? "excluded" : (link.lastCheck?.kind ?? "pending")),
            link.lastCheck
              ? new Date(link.lastCheck.checkedAt).toISOString()
              : "",
            effectiveDestination(link, link.url, page.settings),
            link.review ? new Date(link.review.dueAt).toISOString() : "",
          ]);
        offset += 100;
      } while (offset < total);
      const url = URL.createObjectURL(
        new Blob(
          [
            "\uFEFF",
            rows.map((row) => row.map(csvCell).join(",")).join("\r\n"),
          ],
          { type: "text/csv;charset=utf-8" },
        ),
      );
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "relink.csv";
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice("exported");
    } catch {
      setNotice("error");
    } finally {
      setBusy(false);
    }
  };
  const tab = viewSchema.catch("all").parse(query.get("view") ?? "all");
  const canManage = snapshot?.canManage ?? false;
  const offset = Number(query.get("offset") ?? 0);
  const tabs: Array<[typeof tab, MessageKey]> = [
    ["all", "all"],
    ["problems", "problems"],
    ["archives", "archiveTab"],
    ["reviews", "reviewTab"],
    ["grokipedia", "grokipedia"],
    ["history", "history"],
  ];
  const health: MessageKey = !snapshot?.scheduled
    ? "notScheduled"
    : snapshot.worker.lastError
      ? "workerError"
      : (snapshot.worker.lastCompletedAt ??
            snapshot.worker.lastStartedAt ??
            snapshot.nextRunAt ??
            0) <
          Date.now() - 600000
        ? "stalled"
        : snapshot.worker.lastStartedAt !== null &&
            (snapshot.worker.lastCompletedAt ?? 0) <
              snapshot.worker.lastStartedAt
          ? "running"
          : "ready";
  return (
    <DirectionProvider direction={direction}>
      <div
        className={`relink${compact ? " rl-compact" : ""}`}
        dir={direction}
        lang={locale}
        ref={root}
      >
        {!compact && (
          <header className="rl-header">
            <div>
              <h1>{t("title")}</h1>
              <p>{t("subtitle")}</p>
            </div>
            <div className="rl-actions">
              <Button
                disabled={busy || !canManage}
                onClick={() => {
                  void command({ action: "scan" });
                }}
              >
                {t("scan")}
              </Button>
              <Button onClick={() => setSettingsOpen(true)}>
                {t("settings")}
              </Button>
            </div>
          </header>
        )}
        {notice && (
          <p
            role={
              notice === "error" || notice === "commandError"
                ? "alert"
                : "status"
            }
            className="rl-notice"
          >
            {t(notice)}
          </p>
        )}
        {error && <p role="alert">{t("error")}</p>}
        {!snapshot && !error && <p role="status">{t("loading")}</p>}
        {snapshot && (
          <>
            {!contentId && (
              <dl className="rl-summary">
                {(
                  ["attention", "archives", "reviews", "unverifiable"] as const
                ).map((key) => (
                  <div key={key}>
                    <dt>{t(key)}</dt>
                    <dd>{number(snapshot.summary[key])}</dd>
                  </div>
                ))}
              </dl>
            )}
            {!compact && (
              <>
                <div className="rl-health">
                  <strong>{t("scheduler")}</strong>
                  <span
                    role={
                      health === "workerError" || health === "stalled"
                        ? "alert"
                        : undefined
                    }
                  >
                    {t(health)}
                  </span>
                  <span>
                    {t("lastRun")}: {date(snapshot.worker.lastCompletedAt)}
                  </span>
                  <span>
                    {t("commands")}: {number(snapshot.pendingCommands)}
                  </span>
                </div>
                <nav className="rl-tabs" aria-label={t("view")}>
                  {tabs.map(([value, label]) => (
                    <button
                      type="button"
                      key={value}
                      aria-current={tab === value ? "page" : undefined}
                      onClick={() => filter("view", value)}
                    >
                      {t(label)}
                    </button>
                  ))}
                </nav>
                <fieldset className="rl-filters">
                  <legend>{t("filters")}</legend>
                  {(
                    [
                      ["search", "search"],
                      ["domain", "domain"],
                      ["collection", "collection"],
                      ["contentId", "content"],
                      ["language", "language"],
                    ] satisfies Array<[string, MessageKey]>
                  ).map(([key, label]) => (
                    <label key={key}>
                      {t(label)}
                      <input
                        type="search"
                        value={query.get(key) ?? ""}
                        onChange={(event) =>
                          filter(key, event.currentTarget.value)
                        }
                      />
                    </label>
                  ))}
                  <label>
                    {t("state")}
                    <select
                      value={query.get("state") ?? ""}
                      onChange={(event) =>
                        filter("state", event.currentTarget.value)
                      }
                    >
                      <option value="">{t("all")}</option>
                      {(
                        [
                          "pending",
                          "healthy",
                          "broken",
                          "unverifiable",
                          "excluded",
                        ] as const
                      ).map((value) => (
                        <option value={value} key={value}>
                          {t(value)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    {t("reviewBefore")}
                    <input
                      type="date"
                      onChange={(event) =>
                        filter(
                          "reviewBefore",
                          event.currentTarget.value
                            ? String(
                                new Date(
                                  `${event.currentTarget.value}T23:59:59`,
                                ).getTime(),
                              )
                            : "",
                        )
                      }
                    />
                  </label>
                </fieldset>
                <div className="rl-list-heading">
                  <span>{t("linkCount", { count: snapshot.total })}</span>
                  <Button
                    disabled={busy}
                    onClick={() => {
                      void exportCsv();
                    }}
                  >
                    {t("export")}
                  </Button>
                </div>
              </>
            )}
            {tab === "history" ? (
              <History entries={snapshot.history} t={t} date={date} />
            ) : (
              <div
                className="rl-table-wrap"
                tabIndex={0}
                role="region"
                aria-label={t("all")}
              >
                <table>
                  <thead>
                    <tr>
                      <th scope="col">{t("original")}</th>
                      <th scope="col">{t("occurrences")}</th>
                      <th scope="col">{t("state")}</th>
                      {!compact && (
                        <>
                          <th scope="col">{t("lastCheck")}</th>
                          <th scope="col">{t("destination")}</th>
                          <th scope="col">{t("nextReview")}</th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {snapshot.links.slice(0, compact ? 5 : 50).map((link) => (
                      <tr key={link.id}>
                        <td>
                          <button
                            className="rl-link"
                            type="button"
                            onClick={() => {
                              void openDetail(link.id);
                            }}
                          >
                            <Url value={link.url} />
                          </button>
                        </td>
                        <td>
                          {number(
                            snapshot.occurrences.filter(
                              (entry) => entry.linkId === link.id,
                            ).length,
                          )}
                        </td>
                        <td>
                          <Status link={link} t={t} />
                        </td>
                        {!compact && (
                          <>
                            <td>{date(link.lastCheck?.checkedAt ?? null)}</td>
                            <td>
                              <Url
                                value={effectiveDestination(
                                  link,
                                  link.url,
                                  snapshot.settings,
                                )}
                              />
                            </td>
                            <td>
                              {link.review
                                ? date(link.review.dueAt)
                                : t("none")}
                            </td>
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {snapshot.links.length === 0 && (
                  <div className="rl-empty">
                    <h2>{t("empty")}</h2>
                    <p>{t("emptyHelp")}</p>
                  </div>
                )}
              </div>
            )}
            {compact ? (
              <p>
                {contentId && <span>{t("editorHelp")} </span>}
                <a
                  href={`/_emdash/admin/plugins/relink/?contentId=${encodeURIComponent(contentId)}`}
                >
                  {t("openRelink")}
                </a>
              </p>
            ) : (
              <footer className="rl-pagination">
                <Button
                  disabled={offset === 0}
                  onClick={() =>
                    filter("offset", String(Math.max(0, offset - 50)))
                  }
                >
                  {t("previous")}
                </Button>
                <span>
                  {t("page")} {number(Math.floor(offset / 50) + 1)}
                </span>
                <Button
                  disabled={offset + 50 >= snapshot.total}
                  onClick={() => filter("offset", String(offset + 50))}
                >
                  {t("next")}
                </Button>
              </footer>
            )}
          </>
        )}
        <Dialog
          open={detail?.link !== null && detail !== null}
          title={t("details")}
          close={() => setDetail(null)}
          direction={direction}
        >
          {detail?.link && (
            <>
              <div className="rl-actions">
                <Button onClick={() => setDetail(null)}>{t("close")}</Button>
              </div>
              <p>
                <Url value={detail.link.url} />
              </p>
              <Status link={detail.link} t={t} />
              <p>
                {t("nextCheck")}: {date(detail.link.nextCheckAt)}
              </p>
              {detail.link.automaticDisabled && <p>{t("automaticDisabled")}</p>}
              {!canManage && <p>{t("readOnly")}</p>}
              <div className="rl-actions">
                <Button
                  disabled={busy || !canManage}
                  onClick={() => {
                    if (detail.link)
                      void command({ action: "check", linkId: detail.link.id });
                  }}
                >
                  {t("check")}
                </Button>
                <Button
                  disabled={busy || !canManage}
                  onClick={() => setForm("reschedule")}
                >
                  {t("reschedule")}
                </Button>
                <Button
                  disabled={busy || !canManage}
                  onClick={() => {
                    if (detail.link)
                      void command({
                        action: "exclude",
                        linkId: detail.link.id,
                        value: !detail.link.excluded,
                      });
                  }}
                >
                  {t(detail.link.excluded ? "include" : "exclude")}
                </Button>
                <Button
                  disabled={busy || !canManage || !detail.link.replacement}
                  onClick={() => {
                    if (detail.link)
                      void command({ action: "undo", linkId: detail.link.id });
                  }}
                >
                  {t("undo")}
                </Button>
                <Button
                  disabled={busy || !canManage}
                  onClick={() => setForm("destination")}
                >
                  {t("setDestination")}
                </Button>
              </div>
              {form && (
                <form
                  className="rl-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (!detail.link) return;
                    const value = new FormData(event.currentTarget).get(
                      "value",
                    );
                    if (typeof value !== "string") return;
                    const input =
                      form === "destination"
                        ? {
                            action: "destination",
                            linkId: detail.link.id,
                            url: value,
                          }
                        : {
                            action: "reschedule",
                            linkId: detail.link.id,
                            dueAt: new Date(value).getTime(),
                          };
                    const validated = commandInputSchema.safeParse(input);
                    if (validated.success) void command(validated.data);
                    else setNotice("invalid");
                  }}
                >
                  <label>
                    {t(form === "destination" ? "destination" : "dueDate")}
                    <input
                      name="value"
                      required
                      type={form === "destination" ? "url" : "datetime-local"}
                      dir={form === "destination" ? "ltr" : undefined}
                    />
                  </label>
                  {form === "destination" && <p>{t("urlHelp")}</p>}
                  <Button type="submit" disabled={busy}>
                    {t("save")}
                  </Button>
                  <Button type="button" onClick={() => setForm(null)}>
                    {t("cancel")}
                  </Button>
                </form>
              )}
              <h3>{t("sources")}</h3>
              <ul className="rl-sources">
                {detail.occurrences.map((entry) => (
                  <li key={entry.id}>
                    <strong>{entry.title}</strong>
                    <p>{entry.text}</p>
                    <p>
                      <Url value={entry.originalUrl} />
                    </p>
                    <a
                      href={`/_emdash/admin/content/${encodeURIComponent(entry.collection)}/${encodeURIComponent(entry.contentId)}`}
                    >
                      {t("editor")}
                    </a>
                    <span>
                      {" "}
                      · <bdi>{entry.locale}</bdi>
                    </span>
                  </li>
                ))}
              </ul>
              <h3>{t("evidence")}</h3>
              {detail.link.replacement ? (
                <dl>
                  <dt>{t("destination")}</dt>
                  <dd>
                    <Url value={detail.link.replacement.url} />
                  </dd>
                  <dt>{t("reason")}</dt>
                  <dd>{t(detail.link.replacement.reason)}</dd>
                  <dt>{t("verified")}</dt>
                  <dd>{date(detail.link.replacement.verifiedAt)}</dd>
                  {detail.link.replacement.kind === "archive" && (
                    <>
                      <dt>{t("snapshot")}</dt>
                      <dd>{date(detail.link.replacement.snapshotAt)}</dd>
                    </>
                  )}
                </dl>
              ) : (
                <p>{t("none")}</p>
              )}
              {detail.link.review && (
                <p>
                  {t(detail.link.review.reason)} ·{" "}
                  {date(detail.link.review.dueAt)}
                </p>
              )}
              <h3>{t("history")}</h3>
              <History entries={detail.history} t={t} date={date} />
            </>
          )}
        </Dialog>
        <Dialog
          open={settingsOpen}
          title={t("settings")}
          close={() => setSettingsOpen(false)}
          direction={direction}
        >
          {snapshot && (
            <SettingsForm
              value={snapshot.settings}
              t={t}
              disabled={busy || !canManage}
              submit={(value) => {
                void command({ action: "settings", settings: value });
              }}
              close={() => setSettingsOpen(false)}
            />
          )}
        </Dialog>
      </div>
    </DirectionProvider>
  );
}

function SettingsForm({
  value,
  t,
  disabled,
  submit,
  close,
}: {
  value: Settings;
  t: Translate;
  disabled: boolean;
  submit: (value: Settings) => void;
  close: () => void;
}): ReactNode {
  return (
    <form
      className="rl-form"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const domains = data.get("excludedDomains");
        submit({
          ...value,
          enabled: data.has("enabled"),
          archiveEnabled: data.has("archiveEnabled"),
          grokipediaEnabled: data.has("grokipediaEnabled"),
          direction: directionSchema.parse(data.get("direction")),
          excludedDomains: (typeof domains === "string" ? domains : "")
            .split(/\s+/u)
            .filter(Boolean),
        });
      }}
    >
      <p>{t("settingsHelp")}</p>
      {(["enabled", "archiveEnabled", "grokipediaEnabled"] as const).map(
        (key) => (
          <label className="rl-checkbox" key={key}>
            <input
              type="checkbox"
              name={key}
              defaultChecked={value[key]}
              disabled={disabled}
            />
            {t(key)}
          </label>
        ),
      )}
      <label>
        {t("direction")}
        <select
          name="direction"
          defaultValue={value.direction}
          disabled={disabled}
        >
          {(["auto", "ltr", "rtl"] as const).map((direction) => (
            <option key={direction} value={direction}>
              {t(direction)}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t("excludedDomains")}
        <textarea
          name="excludedDomains"
          rows={4}
          dir="ltr"
          defaultValue={value.excludedDomains.join("\n")}
          disabled={disabled}
        />
      </label>
      <div className="rl-actions">
        <Button type="submit" disabled={disabled}>
          {t("save")}
        </Button>
        <Button type="button" onClick={close}>
          {t("close")}
        </Button>
      </div>
    </form>
  );
}
