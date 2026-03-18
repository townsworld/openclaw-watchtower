import type {
  SentryConfig,
  SentryIssue,
  SentryEvent,
  SentryException,
  ParsedIssue,
  StackFrame,
} from "./types.js";

export class SentryClient {
  private baseUrl: string;
  private authToken: string;
  private org: string;

  constructor(config: SentryConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.authToken = config.authToken;
    this.org = config.org;
  }

  private async request<T>(path: string): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const resp = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.authToken}`,
        "Content-Type": "application/json",
      },
    });

    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new Error(`Sentry API ${resp.status}: ${resp.statusText} — ${body.slice(0, 200)}`);
    }

    return resp.json() as Promise<T>;
  }

  async listIssues(
    project: string,
    opts: { lookbackMinutes?: number; limit?: number; query?: string } = {},
  ): Promise<SentryIssue[]> {
    const lookback = opts.lookbackMinutes ?? 15;
    const limit = opts.limit ?? 10;
    const since = new Date(Date.now() - lookback * 60 * 1000).toISOString();

    const baseQuery = opts.query ?? "is:unresolved";
    const query = `${baseQuery} lastSeen:>${since}`;
    const encoded = encodeURIComponent(query);

    return this.request<SentryIssue[]>(
      `/api/0/projects/${this.org}/${project}/issues/?query=${encoded}&sort=date&limit=${limit}`,
    );
  }

  async getLatestEvent(issueId: string): Promise<SentryEvent> {
    return this.request<SentryEvent>(`/api/0/issues/${issueId}/events/latest/`);
  }

  async getIssuesWithStacktrace(
    project: string,
    opts: { lookbackMinutes?: number; limit?: number; query?: string } = {},
  ): Promise<ParsedIssue[]> {
    const issues = await this.listIssues(project, opts);
    const results: ParsedIssue[] = [];

    for (const issue of issues) {
      let exceptionType: string | undefined;
      let exceptionMessage: string | undefined;
      let stackFrames: StackFrame[] = [];

      try {
        const event = await this.getLatestEvent(issue.id);
        const parsed = this.extractExceptionInfo(event);
        exceptionType = parsed.type;
        exceptionMessage = parsed.message;
        stackFrames = parsed.frames;
      } catch (err) {
        console.warn(`[watchtower] Failed to fetch event for issue ${issue.id}: ${err}`);
      }

      results.push({
        id: issue.id,
        project,
        title: issue.title,
        culprit: issue.culprit,
        level: issue.level,
        count: parseInt(issue.count, 10) || 0,
        userCount: issue.userCount,
        firstSeen: issue.firstSeen,
        lastSeen: issue.lastSeen,
        permalink: issue.permalink,
        exceptionType,
        exceptionMessage,
        stackFrames,
      });
    }

    return results;
  }

  private extractExceptionInfo(event: SentryEvent): {
    type?: string;
    message?: string;
    frames: StackFrame[];
  } {
    const exceptionEntry = event.entries.find((e) => e.type === "exception");
    if (!exceptionEntry?.data?.values?.length) {
      return { frames: [] };
    }

    const primary = exceptionEntry.data.values[exceptionEntry.data.values.length - 1] as SentryException;

    const rawFrames = primary.stacktrace?.frames ?? [];
    const frames: StackFrame[] = rawFrames
      .filter((f) => f.filename && f.function)
      .map((f) => ({
        file: f.absPath || f.filename,
        function: f.function,
        line: f.lineNo,
        module: f.module ?? undefined,
        inApp: f.inApp,
      }))
      .reverse();

    return {
      type: primary.type,
      message: primary.value,
      frames,
    };
  }
}
