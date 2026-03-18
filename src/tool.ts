import { SentryClient } from "./sentry-client.js";
import { PatrolStateManager } from "./state.js";
import type { SentryConfig, ParsedIssue, StackFrame } from "./types.js";

interface ToolResult {
  content: Array<{ type: string; text: string }>;
}

export function createSentryTool(sentryConfig: SentryConfig, stateManager: PatrolStateManager) {
  const client = new SentryClient(sentryConfig);
  const defaultLookback = sentryConfig.lookbackMinutes ?? 15;
  const defaultLimit = sentryConfig.maxIssuesPerQuery ?? 10;
  const projectListStr = sentryConfig.projects.join(", ");

  return {
    name: "watchtower_sentry",
    label: "Sentry Issue Query",
    description:
      `Query recent unresolved issues from Sentry with stack traces. ` +
      `Use this tool to check for new errors in online services. ` +
      `Monitored projects: ${projectListStr}. ` +
      `Returns structured issue data including exception type, message, and key stack frames from application code.`,
    parameters: {
      type: "object" as const,
      properties: {
        project: {
          type: "string" as const,
          enum: sentryConfig.projects,
          description: `Sentry project to query. Available: ${projectListStr}. If omitted, queries all projects.`,
        },
        minutes: {
          type: "integer" as const,
          description: `Look back N minutes for issues. Default: ${defaultLookback}`,
        },
        limit: {
          type: "integer" as const,
          description: `Max issues to return. Default: ${defaultLimit}`,
        },
        query: {
          type: "string" as const,
          description: "Custom Sentry search query. Default: is:unresolved",
        },
        include_seen: {
          type: "boolean" as const,
          description: "Include previously reported issues. Default: false (only new/re-occurred issues)",
        },
      },
      required: [],
    },

    async execute(_toolCallId: string, args: Record<string, unknown>): Promise<ToolResult> {
      const minutes = (args.minutes as number) ?? defaultLookback;
      const limit = (args.limit as number) ?? defaultLimit;
      const query = (args.query as string) ?? undefined;
      const includeSeen = (args.include_seen as boolean) ?? false;
      const targetProjects = args.project
        ? [args.project as string]
        : sentryConfig.projects;

      try {
        const allIssues: ParsedIssue[] = [];

        for (const proj of targetProjects) {
          const issues = await client.getIssuesWithStacktrace(proj, {
            lookbackMinutes: minutes,
            limit,
            query,
          });
          allIssues.push(...issues);
        }

        const filtered = includeSeen
          ? allIssues
          : allIssues.filter((i) => stateManager.shouldReport(i.id, i.lastSeen));

        if (filtered.length === 0) {
          return {
            content: [{
              type: "text",
              text: `No new issues found in the last ${minutes} minutes across projects: ${targetProjects.join(", ")}`,
            }],
          };
        }

        for (const issue of filtered) {
          stateManager.markAnalyzed(issue.id, issue.lastSeen);
        }
        stateManager.updatePatrolTime();
        stateManager.save();

        const output = formatIssuesForAgent(filtered);
        return { content: [{ type: "text", text: output }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Sentry query failed: ${msg}` }],
        };
      }
    },
  };
}

function formatIssuesForAgent(issues: ParsedIssue[]): string {
  const lines: string[] = [];
  lines.push(`Found ${issues.length} issue(s):\n`);

  for (let i = 0; i < issues.length; i++) {
    const issue = issues[i]!;
    lines.push(`--- Issue ${i + 1} ---`);
    lines.push(`Project: ${issue.project}`);
    lines.push(`Title: ${issue.title}`);
    lines.push(`Level: ${issue.level}`);
    lines.push(`Count: ${issue.count} events, ${issue.userCount} users affected`);
    lines.push(`Culprit: ${issue.culprit}`);
    lines.push(`First seen: ${issue.firstSeen}`);
    lines.push(`Last seen: ${issue.lastSeen}`);
    lines.push(`Link: ${issue.permalink}`);

    if (issue.exceptionType) {
      lines.push(`Exception: ${issue.exceptionType}: ${issue.exceptionMessage ?? ""}`);
    }

    const appFrames = issue.stackFrames.filter((f) => f.inApp);
    if (appFrames.length > 0) {
      lines.push(`Stack trace (application code only):`);
      for (const frame of appFrames.slice(0, 8)) {
        lines.push(`  ${formatFrame(frame)}`);
      }
    } else if (issue.stackFrames.length > 0) {
      lines.push(`Stack trace (top frames):`);
      for (const frame of issue.stackFrames.slice(0, 5)) {
        lines.push(`  ${formatFrame(frame)}`);
      }
    }

    lines.push("");
  }

  return lines.join("\n");
}

function formatFrame(frame: StackFrame): string {
  const location = frame.line ? `${frame.file}:${frame.line}` : frame.file;
  return `at ${frame.function} (${location})`;
}
