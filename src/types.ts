// ── Plugin Config ──

export interface SentryConfig {
  baseUrl: string;
  authToken: string;
  org: string;
  projects: string[];
  lookbackMinutes?: number;
  maxIssuesPerQuery?: number;
}

export interface WatchtowerConfig {
  sentry?: SentryConfig;
}

// ── Sentry API Types ──

export interface SentryIssue {
  id: string;
  title: string;
  culprit: string;
  level: "fatal" | "error" | "warning" | "info" | "debug";
  status: string;
  count: string;
  userCount: number;
  firstSeen: string;
  lastSeen: string;
  project: { slug: string; name: string };
  shortId: string;
  permalink: string;
  metadata: {
    type?: string;
    value?: string;
    filename?: string;
    function?: string;
  };
}

export interface SentryStackFrame {
  filename: string;
  absPath?: string;
  function: string;
  module?: string;
  lineNo: number | null;
  colNo: number | null;
  context?: Array<[number, string]>;
  inApp: boolean;
}

export interface SentryException {
  type: string;
  value: string;
  module?: string;
  stacktrace?: {
    frames: SentryStackFrame[];
  };
}

export interface SentryEvent {
  eventID: string;
  title: string;
  message?: string;
  dateCreated: string;
  entries: Array<{
    type: string;
    data: {
      values?: SentryException[];
      [key: string]: unknown;
    };
  }>;
  tags: Array<{ key: string; value: string }>;
  context?: Record<string, unknown>;
}

// ── Tool Output Types ──

export interface StackFrame {
  file: string;
  function: string;
  line: number | null;
  module?: string;
  inApp: boolean;
}

export interface ParsedIssue {
  id: string;
  project: string;
  title: string;
  culprit: string;
  level: string;
  count: number;
  userCount: number;
  firstSeen: string;
  lastSeen: string;
  permalink: string;
  exceptionType?: string;
  exceptionMessage?: string;
  stackFrames: StackFrame[];
}

// ── State Types ──

export interface AnalyzedIssueRecord {
  lastAnalyzedAt: string;
  lastSeenAt: string;
  reportedCount: number;
}

export interface PatrolState {
  analyzedIssues: Record<string, AnalyzedIssueRecord>;
  lastPatrolAt?: string;
}
