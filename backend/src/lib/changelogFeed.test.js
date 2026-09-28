import { describe, it, expect } from "vitest";
import { parseChangelogSection, lastPageFromLink } from "./changelogFeed.js";

describe("parseChangelogSection", () => {
  it("reads the title and the tagged lines", () => {
    const body = [
      "## What changes",
      "Some notes for reviewers.",
      "",
      "## Changelog",
      "Title: Designs and changelog",
      "- New: You can now pick a design in the settings.",
      "- Fixed: The series no longer resets on reload.",
      "- Plain line without a tag.",
      "",
      "## Checks",
      "- Lint is clean.",
    ].join("\n");
    expect(parseChangelogSection(body)).toEqual({
      title: "Designs and changelog",
      items: [
        { tag: "new", text: "You can now pick a design in the settings." },
        { tag: "fixed", text: "The series no longer resets on reload." },
        { tag: "better", text: "Plain line without a tag." },
      ],
    });
  });

  it("is null without a section, or with an empty one", () => {
    expect(parseChangelogSection("## What changes\n- a")).toBeNull();
    expect(parseChangelogSection("## Changelog\n<!-- - New: example -->\n\n## Checks")).toBeNull();
    expect(parseChangelogSection(null)).toBeNull();
  });

  it("ignores the template's comments and strips markdown", () => {
    const body = "### Changelog\r\n<!-- one line per change -->\r\n* better: **Faster** `live` [page](http://x)\r\n";
    expect(parseChangelogSection(body)).toEqual({ title: "", items: [{ tag: "better", text: "Faster live page" }] });
  });

  it("skips the template's empty lines, so an untouched template is no entry", () => {
    expect(parseChangelogSection("## Changelog\n\nTitle:\n- New:\n- Fixed:\n\n## Checks")).toBeNull();
    expect(parseChangelogSection("## Changelog\nTitle:\n- New:\n- Fixed: Real fix.")).toEqual({
      title: "",
      items: [{ tag: "fixed", text: "Real fix." }],
    });
  });

  it("caps the number of lines", () => {
    const body = "## Changelog\n" + Array.from({ length: 15 }, (_, i) => `- New: line ${i}`).join("\n");
    expect(parseChangelogSection(body).items).toHaveLength(10);
  });
});

describe("lastPageFromLink", () => {
  it("reads the last page number", () => {
    const link =
      '<https://api.github.com/repositories/1/commits?sha=main&per_page=1&page=2>; rel="next", ' +
      '<https://api.github.com/repositories/1/commits?sha=main&per_page=1&page=699>; rel="last"';
    expect(lastPageFromLink(link)).toBe(699);
  });

  it("is null without one", () => {
    expect(lastPageFromLink(null)).toBeNull();
    expect(lastPageFromLink('<https://x?page=2>; rel="next"')).toBeNull();
  });
});
