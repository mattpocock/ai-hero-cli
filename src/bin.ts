#!/usr/bin/env node

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as Effect from "effect/Effect";
import { run } from "./Cli.js";
import { layerLive } from "./layer.js";

run(process.argv).pipe(
  Effect.provide(layerLive),
  Effect.scoped,
  NodeRuntime.runMain({}) as any
);
