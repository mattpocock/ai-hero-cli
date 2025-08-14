#!/usr/bin/env node

import * as NodeContext from "@effect/platform-node/NodeContext";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as Effect from "effect/Effect";
import { run } from "./Cli.js";
import { LessonParserService } from "./lesson-parser-service.js";

run(process.argv).pipe(
  Effect.provide(LessonParserService.Default),
  Effect.provide(NodeContext.layer),
  Effect.scoped,
  NodeRuntime.runMain({ disableErrorReporting: true })
);
