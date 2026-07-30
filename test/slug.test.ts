import { describe, expect, it } from "@effect/vitest";
import type { BranchCommit } from "../src/branch-commits.js";
import {
  checkSlug,
  composeSubject,
} from "../src/internal/stack/slug.js";

const lesson = (
  lessonId: string,
  sequence: number
): BranchCommit => ({
  sha: `sha${sequence}`,
  message: `${lessonId}: A lesson`,
  lessonId,
  description: "A lesson",
  sequence,
});

const commits = [
  lesson("add-first", 1),
  lesson("add-second", 2),
];

const check = (
  slug: string,
  allowExisting?: string | undefined
) => checkSlug({ slug, commits, allowExisting });

describe("checkSlug", () => {
  it("accepts a kebab-case slug that is not taken", () => {
    expect(check("add-settings-json")).toEqual({ ok: true });
  });

  it("accepts digits", () => {
    expect(check("grill-me-2")).toEqual({ ok: true });
  });

  it("rejects an empty slug", () => {
    expect(check("  ")).toMatchObject({ ok: false });
  });

  it("rejects the parse boundary", () => {
    const result = check("broken: slug");
    expect(result.ok).toBe(false);
    expect((result as { reason: string }).reason).toContain(
      "parse boundary"
    );
  });

  it.each([
    "Add-Settings",
    "add_settings",
    "add settings",
    "-leading",
    "trailing-",
    "double--dash",
  ])("rejects %s as not kebab-case", (slug) => {
    expect(check(slug)).toMatchObject({ ok: false });
  });

  it("rejects a slug already used by another lesson", () => {
    const result = check("add-second");
    expect(result.ok).toBe(false);
    expect((result as { reason: string }).reason).toContain(
      "unique"
    );
  });

  it("allows a commit to keep its own slug when renaming", () => {
    expect(check("add-second", "add-second")).toEqual({
      ok: true,
    });
  });

  it("still rejects another lesson's slug when renaming", () => {
    expect(check("add-first", "add-second")).toMatchObject({
      ok: false,
    });
  });

  it("ignores surrounding whitespace", () => {
    expect(check("  add-third  ")).toEqual({ ok: true });
  });
});

describe("composeSubject", () => {
  it("joins slug and title at the parse boundary", () => {
    expect(
      composeSubject({ slug: "add-db", title: "Set up the DB" })
    ).toBe("add-db: Set up the DB");
  });

  it("trims both halves", () => {
    expect(
      composeSubject({ slug: " add-db ", title: " Set up " })
    ).toBe("add-db: Set up");
  });
});
