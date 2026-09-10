import type {
  ContentEditorPanelContext,
  PluginAdminModule,
} from "@emdash-cms/admin";
import { RelinkApp } from "./app.js";
import "./styles.css";

export const pages = { "/": RelinkApp };
export const widgets = {
  overview: function Overview() {
    return <RelinkApp compact />;
  },
};
export const contentEditorPanels = [
  {
    id: "links",
    title: "Relink",
    minRole: 10,
    order: 50,
    component: function LinkPanel(context: ContentEditorPanelContext) {
      return (
        <RelinkApp
          compact
          contentId={context.entry.id}
          collection={context.collection}
        />
      );
    },
  },
] satisfies PluginAdminModule["contentEditorPanels"];
export { RelinkApp } from "./app.js";
