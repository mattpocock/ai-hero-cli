import { describe, it, expect } from "vitest";
import {
  getSectionAndLessonNumberFromPath,
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
});
