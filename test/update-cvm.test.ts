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
});
