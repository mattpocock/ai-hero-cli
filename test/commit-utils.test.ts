import { describe, expect, it } from "@effect/vitest";
import {
  normalizeLessonId,
  parseCommits,
} from "../src/commit-utils.js";

describe("parseCommits", () => {
  it("extracts a slug id as the token before the first ': '", () => {
    const [c] = parseCommits(
      "abc123 add-settings-json: Add settings.json"
    );
    expect(c!.lessonId).toBe("add-settings-json");
    expect(c!.message).toBe("Add settings.json");
  });

  it("treats a numeric id as just another slug token", () => {
    const [c] = parseCommits("abc123 06.06.01: Arrays intro");
    expect(c!.lessonId).toBe("06.06.01");
    expect(c!.message).toBe("Arrays intro");
  });

  it("returns a null id for a commit with no ': ' boundary", () => {
    const [c] = parseCommits("abc123 WIP fix stuff later");
    expect(c!.lessonId).toBeNull();
    expect(c!.message).toBe("WIP fix stuff later");
  });

  it("splits on the first ': ' when the title contains more colons", () => {
    const [c] = parseCommits(
      "abc123 add-error-handling: Fix: swallow the error"
    );
    expect(c!.lessonId).toBe("add-error-handling");
    expect(c!.message).toBe("Fix: swallow the error");
  });

  it("parses a conventional-commit prefix as an id — fencing is the range's job, not this parser's", () => {
    const [c] = parseCommits(
      "abc123 chore: reconcile pnpm-lock.yaml"
    );
    expect(c!.lessonId).toBe("chore");
  });

  it("does not treat a bare leading ': ' as an id", () => {
    const [c] = parseCommits("abc123 : orphaned colon");
    expect(c!.lessonId).toBeNull();
  });
});

describe("normalizeLessonId", () => {
  it("pads a numeric id to NN.NN.NN", () => {
    expect(normalizeLessonId("1.1.1")).toBe("01.01.01");
    expect(normalizeLessonId("1-2-3")).toBe("01.02.03");
  });

  it("returns null for a slug so it passes through untouched", () => {
    expect(normalizeLessonId("add-settings-json")).toBeNull();
    expect(normalizeLessonId("chore")).toBeNull();
  });
});
