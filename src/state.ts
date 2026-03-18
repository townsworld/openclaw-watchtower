import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { PatrolState, AnalyzedIssueRecord } from "./types.js";

const RENOTIFY_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

export class PatrolStateManager {
  private state: PatrolState;
  private filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
    this.state = this.load();
  }

  private load(): PatrolState {
    if (!existsSync(this.filePath)) {
      return { analyzedIssues: {} };
    }
    try {
      const raw = readFileSync(this.filePath, "utf-8");
      return JSON.parse(raw) as PatrolState;
    } catch {
      return { analyzedIssues: {} };
    }
  }

  save(): void {
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(this.state, null, 2) + "\n");
  }

  shouldReport(issueId: string, lastSeen: string): boolean {
    const record = this.state.analyzedIssues[issueId];
    if (!record) return true;

    if (record.lastSeenAt !== lastSeen) {
      const elapsed = Date.now() - new Date(record.lastAnalyzedAt).getTime();
      return elapsed > RENOTIFY_INTERVAL_MS;
    }

    return false;
  }

  markAnalyzed(issueId: string, lastSeen: string): void {
    const existing = this.state.analyzedIssues[issueId];
    this.state.analyzedIssues[issueId] = {
      lastAnalyzedAt: new Date().toISOString(),
      lastSeenAt: lastSeen,
      reportedCount: (existing?.reportedCount ?? 0) + 1,
    };
  }

  updatePatrolTime(): void {
    this.state.lastPatrolAt = new Date().toISOString();
  }

  getLastPatrolAt(): string | undefined {
    return this.state.lastPatrolAt;
  }

  cleanup(maxAgeDays: number = 7): void {
    const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
    for (const [id, record] of Object.entries(this.state.analyzedIssues)) {
      if (new Date(record.lastAnalyzedAt).getTime() < cutoff) {
        delete this.state.analyzedIssues[id];
      }
    }
  }
}
