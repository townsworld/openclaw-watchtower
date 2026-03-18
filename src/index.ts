import { resolve } from "node:path";
import { createSentryTool } from "./tool.js";
import { PatrolStateManager } from "./state.js";
import { SentryClient } from "./sentry-client.js";
import type { WatchtowerConfig } from "./types.js";

const PLUGIN_ID = "openclaw-watchtower";

export default {
  id: PLUGIN_ID,
  configSchema: { type: "object" as const },

  register(api: any) {
    const cfg: WatchtowerConfig = api.pluginConfig ?? {};
    console.log(`[${PLUGIN_ID}] initializing...`);

    const workspaceDir: string = api.workspaceDir ?? resolve(process.env.HOME ?? "", ".openclaw/workspace");
    const stateFile = resolve(workspaceDir, "watchtower-state.json");
    const stateManager = new PatrolStateManager(stateFile);

    // ── Sentry Tool ──
    if (cfg.sentry) {
      const sentryTool = createSentryTool(cfg.sentry, stateManager);
      api.registerTool(sentryTool, { name: "watchtower_sentry" });
      console.log(`[${PLUGIN_ID}] registered watchtower_sentry tool (org: ${cfg.sentry.org}, projects: ${cfg.sentry.projects.join(", ")})`);

      // ── /patrol command ──
      const client = new SentryClient(cfg.sentry);
      const sentryCfg = cfg.sentry;

      api.registerCommand({
        name: "patrol",
        description: "Manually trigger a Sentry patrol or check patrol status.",
        acceptsArgs: true,
        requireAuth: false,

        async handler(ctx: any) {
          const args = (ctx.args ?? "").trim();

          if (args === "status") {
            const lastPatrol = stateManager.getLastPatrolAt();
            return {
              text: lastPatrol
                ? `Last patrol: ${lastPatrol}`
                : "No patrol has been run yet.",
            };
          }

          if (args === "cleanup") {
            stateManager.cleanup(7);
            stateManager.save();
            return { text: "Cleaned up patrol state (removed entries older than 7 days)." };
          }

          // Default: run patrol across all configured projects
          const lookback = sentryCfg.lookbackMinutes ?? 15;
          const limit = sentryCfg.maxIssuesPerQuery ?? 10;
          const targetProjects = sentryCfg.projects;

          try {
            let totalIssues = 0;
            const summaryParts: string[] = [];

            for (const project of targetProjects) {
              const issues = await client.getIssuesWithStacktrace(project, {
                lookbackMinutes: lookback,
                limit,
              });

              const newIssues = issues.filter((i) =>
                stateManager.shouldReport(i.id, i.lastSeen),
              );

              if (newIssues.length > 0) {
                totalIssues += newIssues.length;
                summaryParts.push(`${project}: ${newIssues.length} new issue(s)`);
              }
            }

            stateManager.updatePatrolTime();
            stateManager.save();

            if (totalIssues === 0) {
              return { text: `Patrol complete. No new issues in the last ${lookback} minutes.` };
            }

            return {
              text: [
                `Patrol found ${totalIssues} new issue(s):`,
                ...summaryParts,
                "",
                `Use watchtower_sentry tool to get full details and stack traces.`,
              ].join("\n"),
            };
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return { text: `Patrol failed: ${msg}` };
          }
        },
      });
      console.log(`[${PLUGIN_ID}] registered /patrol command`);
    } else {
      console.warn(`[${PLUGIN_ID}] No sentry config found, watchtower_sentry tool not registered`);
    }

    // Future: SLS, Grafana, etc.
    // if (cfg.sls) { ... }

    console.log(`[${PLUGIN_ID}] initialization complete`);
  },
};
