import { NodeContext } from "@effect/platform-node";
import { Layer } from "effect";
import { GitService } from "./git-service.js";
import { LessonParserService } from "./lesson-parser-service.js";

export const layerLive = Layer.mergeAll(
  NodeContext.layer,
  GitService.Default,
  LessonParserService.Default
);
