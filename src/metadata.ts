import type { PluginAdminConfig } from "emdash";
export const adminConfiguration = {
  entry: "emdash-plugin-relink/admin",
  pages: [{ path: "/", label: "Relink", icon: "link" }],
  widgets: [{ id: "overview", title: "Relink", size: "half" }],
} satisfies PluginAdminConfig;
