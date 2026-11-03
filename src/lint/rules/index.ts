import type { Rule } from "../types.js";
import { awaitMisuse } from "./await-misuse.js";
import { connectWithoutDisconnect } from "./connect-without-disconnect.js";
import { deltaMisuse } from "./delta-misuse.js";
import { floatGridEquality } from "./float-grid-equality.js";
import { getNodeInProcess } from "./get-node-in-process.js";
import { missingOnready } from "./missing-onready.js";
import { removedApiUsage } from "./removed-api-usage.js";
import { stringlyNodepath } from "./stringly-nodepath.js";
import { untypedDeclaration } from "./untyped-declaration.js";

/** The default GDScript ruleset, in stable reporting order. */
export const DEFAULT_RULES: Rule[] = [
  deltaMisuse,
  getNodeInProcess,
  missingOnready,
  untypedDeclaration,
  awaitMisuse,
  stringlyNodepath,
  connectWithoutDisconnect,
  floatGridEquality,
  removedApiUsage,
];

export const RULES_BY_ID: Map<string, Rule> = new Map(DEFAULT_RULES.map((r) => [r.id, r]));
