import { Command as CLICommand, Options } from "@effect/cli";
import { Command } from "@effect/platform";
import { Console, Effect } from "effect";
import { existsSync } from "node:fs";
import * as path from "node:path";

export const notFound = Symbol("notFound");

const getNumberFromPathSegment = (path: string) => {
  const numberSegment = path.split("-")[0];

  return Number.isNaN(Number(numberSegment))
    ? notFound
    : Number(numberSegment);
};

type SectionAndLessonNumber = {
  sectionNumber: number;
  lessonNumber: number;
  lessonPathWithNumber: string;
  sectionPathWithNumber: string;
};

const startsWithNumber = (segment: string): boolean => {
  const numberSegment = segment.split("-")[0];

  if (numberSegment === undefined) {
    return false;
  }

  return !Number.isNaN(Number(numberSegment));
};

const splitFilePath = (filePath: string) =>
  filePath.split(path.sep);

export const getSectionAndLessonNumberFromPath = (
  filePath: string
): SectionAndLessonNumber | typeof notFound => {
  const segments = splitFilePath(filePath);

  const lastSegmentWithNumber =
    segments.findLastIndex(startsWithNumber);

  if (lastSegmentWithNumber === -1) {
    return notFound;
  }

  const exerciseSegment = segments[lastSegmentWithNumber]!;

  const sectionSegment = segments[lastSegmentWithNumber - 1];

  if (sectionSegment === undefined) {
    return notFound;
  }

  const sectionNumber = getNumberFromPathSegment(sectionSegment);

  if (sectionNumber === notFound) {
    return notFound;
  }

  const lessonNumber = getNumberFromPathSegment(exerciseSegment);

  if (lessonNumber === notFound) {
    return notFound;
  }

  return {
    sectionNumber,
    lessonNumber,
    lessonPathWithNumber: exerciseSegment,
    sectionPathWithNumber: sectionSegment,
  };
};

const unique = <T>(arr: Array<T>) => [...new Set(arr)];

const mapToLessonPath = (filePath: string) => {
  const sectionAndLessonNumber =
    getSectionAndLessonNumberFromPath(filePath);

  if (sectionAndLessonNumber === notFound) {
    return notFound;
  }

  return `${sectionAndLessonNumber.sectionPathWithNumber}${path.sep}${sectionAndLessonNumber.lessonPathWithNumber}`;
};

const getChangedFiles = (rawDiffOutput: string) => {
  const splitDiffOutput = rawDiffOutput
    .trim()
    .split("\n")
    .filter(Boolean);

  const renamedFiles = splitDiffOutput
    .filter((line) => line.includes("rename"))
    .map((line) => {
      // Remove the percentage at the end of the line
      line = line.replace(/\s*\(\d+%\)$/, "");

      const match = line.match(
        /rename (.*?){(.+?) => (.+?)}(.*)/
      );
      if (!match) return null;
      const [, prefix, oldSegment, newSegment, suffix] = match;
      const oldPath = prefix! + oldSegment + suffix;
      const newPath = prefix! + newSegment + suffix;

      return { oldPath, newPath };
    })
    .filter((m) => m !== null);

  const createdFiles = splitDiffOutput
    .filter((line) => line.includes("create"))
    .map((line) => line.replace(/^create mode \d+/, "").trim());

  const deletedFiles = splitDiffOutput
    .filter((line) => line.includes("delete"))
    .map((line) => line.replace(/^delete mode \d+/, "").trim());

  return {
    created: unique(
      createdFiles
        .map(mapToLessonPath)
        .filter((m) => m !== notFound)
    ),
    deleted: unique(
      deletedFiles
        .map(mapToLessonPath)
        .filter((m) => m !== notFound)
    ),
    renamed: renamedFiles.reduce((acc, m) => {
      const oldPath = mapToLessonPath(m.oldPath);
      const newPath = mapToLessonPath(m.newPath);

      if (oldPath === notFound || newPath === notFound) {
        return acc;
      }

      acc[oldPath] = newPath;
      return acc;
    }, {} as Record<string, string>),
  };
};

export const updateCVM = CLICommand.make(
  "update-cvm",
  {
    root: Options.text("root").pipe(
      Options.withDescription(
        "The root directory of the exercises"
      ),
      Options.withDefault(path.join(process.cwd(), "exercises"))
    ),
  },
  ({ root }) =>
    Effect.gen(function* () {
      if (!process.env.ALWAYS_UPDATE_CVM) {
        yield* Effect.log(
          "[update-cvm] Skipping CVM update because ALWAYS_UPDATE_CVM is not set in the environment"
        );
        return;
      }

      const diffCommand = Command.make(
        "git",
        "diff",
        "--summary",
        "--cached"
      );

      const diff = yield* Command.string(diffCommand);

      const changedFiles = getChangedFiles(diff);

      if (
        changedFiles.created.length === 0 &&
        changedFiles.deleted.length === 0 &&
        Object.keys(changedFiles.renamed).length === 0
      ) {
        yield* Effect.log("[update-cvm] No changes to the CVM");
        return;
      }

      const filteredDeletedLessons = changedFiles.deleted.filter(
        (lesson) => {
          const lessonPath = path.join(root, lesson);
          return !existsSync(lessonPath);
        }
      );

      const wasPingSuccessful = yield* Effect.promise(() =>
        fetch("http://localhost:5173/api/ping")
      ).pipe(Effect.map((res) => res.ok));

      if (!wasPingSuccessful) {
        yield* Effect.logError(
          "[update-cvm] Failed to ping the CVM - is the CVM running?"
        );
        return;
      }

      const updateResponse = yield* Effect.promise(() =>
        fetch("http://localhost:5173/api/repos/update", {
          method: "POST",
          body: JSON.stringify({
            filePath: root,
            modifiedLessons: changedFiles.renamed,
            addedLessons: changedFiles.created,
            deletedLessons: filteredDeletedLessons,
          }),
        })
      );

      if (!updateResponse.ok) {
        const output = yield* Effect.promise(() =>
          updateResponse.text()
        );

        yield* Effect.logError(
          "[update-cvm] Failed to update the CVM: " + output
        );
        return;
      }

      yield* Effect.log(
        "[update-cvm] Successfully updated the CVM"
      );
    })
);
