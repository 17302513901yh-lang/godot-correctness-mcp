import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { validateNodePaths } from "../scenes/node-paths.js";
import { projectReport } from "../scenes/report.js";
import {
  validateProjectConfig,
  validateRegistries,
  validateScenes,
} from "../scenes/validate.js";
import { requireDir } from "../project/walk.js";
import { guard } from "./result.js";

const ROOT_ARG = { path: z.string().min(1).describe("Path to the Godot project root") };
const READ_ONLY = { readOnlyHint: true, openWorldHint: false } as const;

/** Register the scene / resource / registry static-analysis tools. */
export function registerSceneTools(server: McpServer): void {
  server.registerTool(
    "validate_scenes",
    {
      description:
        "Validate every .tscn under a project root: ext_resource paths resolve, " +
        "ExtResource/SubResource references are declared, there are no duplicate resource " +
        "ids, node parent paths exist, [connection] targets have the named method, and " +
        "literal $Path/get_node() paths in attached scripts exist in the scene.",
      inputSchema: ROOT_ARG,
      annotations: READ_ONLY,
    },
    async ({ path }) =>
      guard(async () => {
        requireDir(path);
        const findings = [...validateScenes(path), ...(await validateNodePaths(path))];
        return { root: path, findings, count: findings.length };
      }),
  );

  server.registerTool(
    "validate_project_config",
    {
      description:
        "Validate project.godot: the main scene exists, autoload paths exist, input " +
        "actions are well-formed, and input action names used in scripts are defined.",
      inputSchema: ROOT_ARG,
      annotations: READ_ONLY,
    },
    async ({ path }) =>
      guard(() => {
        requireDir(path);
        const findings = validateProjectConfig(path);
        return { root: path, findings, count: findings.length };
      }),
  );

  server.registerTool(
    "validate_registries",
    {
      description:
        "Deep-validate data-driven .tres registries in the configured registryDirs: " +
        "each parses, its script resolves (recording class_name), and every " +
        "resource-path property points at an existing file (the dangling-path check).",
      inputSchema: ROOT_ARG,
      annotations: READ_ONLY,
    },
    async ({ path }) =>
      guard(() => {
        requireDir(path);
        return { root: path, ...validateRegistries(path) };
      }),
  );

  server.registerTool(
    "project_report",
    {
      description:
        "Aggregate all static checks (scenes, project config, registries, and " +
        "GDScript lint) into one report with severity counts.",
      inputSchema: ROOT_ARG,
      annotations: READ_ONLY,
    },
    async ({ path }) =>
      guard(() => {
        requireDir(path);
        return projectReport(path);
      }),
  );
}
