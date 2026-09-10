# Translation and RTL contributions

All documentation, comments and release notes are written in English. The admin currently ships English and German. It listens to the active EmDash Lingui instance; browser language detection and user language changes remain owned by EmDash. Relink has no separate language selector.

`src/admin/messages.ts` contains both catalogs. German regional variants resolve to the German messages and English variants to English; other languages use English. Valid supported regional locales are retained for date/number formatting. Every key is required in both catalogs at compile time, and tests verify completeness and plural forms. Lingui's compiled plural representation is used for counts. Host catalogs are not overwritten.

To contribute a translation:

1. Add the catalog with exactly the keys of the English catalog, including errors, notifications, empty states, reasons and accessibility labels.
2. Extend the explicit locale resolver and supported catalog map.
3. Add regional/fallback/plural tests and an actual browser language-switch test.
4. Review long text, keyboard order, dialog focus and both colour themes.

Keep article language separate from interface language. Switching the UI to English must not make an English replacement eligible for a German article.

## Direction

Settings offers **Automatic / Left-to-right / Right-to-left**. Automatic inherits EmDash's direction. An override sets direction on Relink's root and its local Kumo direction provider. Dialogs are native modal dialogs inside that root; select menus inherit the same direction. Relink never changes the host document's `dir` or its language.

CSS uses logical dimensions, margins, padding, borders and text alignment. URLs are displayed with `<bdi dir="ltr">`; identifiers are isolated as well. Native dialog behaviour supplies a focus trap, Escape dismissal and focus return. Visible focus styles are supplied for interactive elements and horizontally scrollable tables. The browser suite checks forced RTL, readable URLs, keyboard navigation and dialog focus.

Forced RTL is layout support only. This version does not claim Arabic or Hebrew translation coverage.
