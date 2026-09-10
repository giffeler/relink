// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { I18nProvider } from "@lingui/react";
import { setupI18n } from "@lingui/core";
import { useRelinkLocale } from "../src/admin/i18n.js";

afterEach(cleanup);

it("updates an already mounted Relink surface when EmDash activates another locale", () => {
  const host = setupI18n({
    locale: "en",
    messages: { en: {}, "de-AT": {}, ar: {} },
  });
  function Surface(): React.JSX.Element {
    const { t, locale } = useRelinkLocale();
    return <output lang={locale}>{t("linkCount", { count: 2 })}</output>;
  }
  render(
    <I18nProvider i18n={host}>
      <Surface />
    </I18nProvider>,
  );
  expect(screen.getByRole("status").textContent).toBe("2 links");
  act(() => host.activate("de-AT"));
  expect(screen.getByRole("status").textContent).toBe("2 Links");
  expect(screen.getByRole("status").lang).toBe("de-AT");
  act(() => host.activate("ar"));
  expect(screen.getByRole("status").textContent).toBe("2 links");
  expect(screen.getByRole("status").lang).toBe("en");
  expect(host.locale).toBe("ar");
});
