import { describe, it, expect } from "vitest";
import {
  getSectionAndLessonNumberFromPath,
  getChangedFiles,
  notFound,
} from "../src/internal/update-cvm.js";

describe("update-cvm", () => {
  describe("PRD: CVM extracts lesson info from git diff paths", () => {
    it("should extract section and lesson numbers from standard lesson path", () => {
      // User commits changes to a lesson file
      // CVM needs to identify which lesson was modified to update its database
      const result = getSectionAndLessonNumberFromPath(
        "exercises/1-basics/2-variables/problem/main.ts"
      );

      expect(result).not.toBe(notFound);
      if (result !== notFound) {
        expect(result.sectionNumber).toBe(1);
        expect(result.lessonNumber).toBe(2);
        expect(result.sectionPathWithNumber).toBe("1-basics");
        expect(result.lessonPathWithNumber).toBe("2-variables");
      }
    });
  });

  describe("PRD: CVM parses git diff to identify created lessons", () => {
    it("should extract created lesson paths from git diff --summary output", () => {
      // User creates new lesson files and commits
      // CVM needs to parse git diff output to identify which lessons were added
      const gitDiffOutput = `
 create mode 100644 exercises/1-basics/3-functions/problem/main.ts
 create mode 100644 exercises/1-basics/3-functions/problem/readme.md
 create mode 100644 exercises/1-basics/3-functions/solution/main.ts
      `;

      const result = getChangedFiles(gitDiffOutput);

      // Should identify the lesson path (section/lesson) for created files
      expect(result.created).toContain("1-basics/3-functions");
      // Should dedupe multiple files in same lesson
      expect(
        result.created.filter((p) => p === "1-basics/3-functions")
      ).toHaveLength(1);
      expect(result.deleted).toHaveLength(0);
      expect(Object.keys(result.renamed)).toHaveLength(0);
    });
  });

  describe("PRD: CVM parses git diff to identify renamed lessons", () => {
    it("should track renamed lessons so CVM can update references instead of delete/create", () => {
      // User renames a lesson (e.g., renumbering from 2 to 3)
      // CVM needs to know it was renamed to preserve metadata, not treat as delete + create
      const gitDiffOutput = `
 rename exercises/1-basics/{2-variables => 3-variables}/problem/main.ts (100%)
 rename exercises/1-basics/{2-variables => 3-variables}/solution/main.ts (95%)
      `;

      const result = getChangedFiles(gitDiffOutput);

      // Should map old path to new path for renamed lessons
      expect(result.renamed).toEqual({
        "1-basics/2-variables": "1-basics/3-variables",
      });
      expect(result.created).toHaveLength(0);
      expect(result.deleted).toHaveLength(0);
    });
  });

  describe("PRD: CVM parses git diff to identify deleted lessons", () => {
    it("should extract deleted lesson paths from git diff --summary output", () => {
      // User deletes lesson files and commits
      // CVM needs to know which lessons were removed to clean up its database
      const gitDiffOutput = `
 delete mode 100644 exercises/2-advanced/4-async/problem/main.ts
 delete mode 100644 exercises/2-advanced/4-async/problem/readme.md
 delete mode 100644 exercises/2-advanced/4-async/solution/main.ts
      `;

      const result = getChangedFiles(gitDiffOutput);

      // Should identify the lesson path (section/lesson) for deleted files
      expect(result.deleted).toContain("2-advanced/4-async");
      // Should dedupe multiple files in same lesson
      expect(
        result.deleted.filter((p) => p === "2-advanced/4-async")
      ).toHaveLength(1);
      expect(result.created).toHaveLength(0);
      expect(Object.keys(result.renamed)).toHaveLength(0);
    });
  });

  describe("PRD: CVM ignores non-lesson files in git diff", () => {
    it("should ignore renamed files that don't match lesson path format", () => {
      // User renames a config file (not a lesson) alongside lesson changes
      // CVM should ignore non-lesson files rather than error
      const gitDiffOutput = `
 rename {old-config => new-config}/settings.json (100%)
 rename exercises/1-basics/{2-variables => 3-variables}/problem/main.ts (100%)
      `;

      const result = getChangedFiles(gitDiffOutput);

      // Should only include the valid lesson rename, not the config file rename
      expect(result.renamed).toEqual({
        "1-basics/2-variables": "1-basics/3-variables",
      });
      expect(Object.keys(result.renamed)).toHaveLength(1);
    });
  });
});
