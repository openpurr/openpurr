// Which project an admin API or MCP request is about.
//
// Customers, grants and secret keys belong to one project, so those requests name it with
// ?project=<id> (the MCP tools take a `project` argument). When the caller can see only one
// project, it may be left out, so single-project deployments, and clients written before projects
// existed, keep working unchanged.

import type { Config, ProjectConfig } from "../config";
import { canSeeApp, type Principal } from "./principal";

/** An operator limited to some apps sees the projects those apps belong to. */
export function canSeeProject(principal: Principal, project: ProjectConfig) {
  return principal.apps === null || [...project.apps.keys()].some((id) => canSeeApp(principal, id));
}

export function visibleProjects(config: Config, principal: Principal) {
  return [...config.projects.values()].filter((p) => canSeeProject(principal, p));
}

export type ProjectChoice = { project: ProjectConfig } | { status: 400 | 404; message: string };

/** The requested project, or the only one the caller can see. */
export function chooseProject(config: Config, principal: Principal, requested: string | undefined | null): ProjectChoice {
  if (requested) {
    const project = config.projects.get(requested);
    if (!project || !canSeeProject(principal, project)) return { status: 404, message: `Project ${requested} not found.` };
    return { project };
  }
  const visible = visibleProjects(config, principal);
  if (visible.length === 1) return { project: visible[0]! };
  if (!visible.length) return { status: 404, message: "There are no projects yet. Add one to the config first." };
  return { status: 400, message: `This deployment has several projects; say which with project: ${visible.map((p) => p.id).join(", ")}.` };
}
