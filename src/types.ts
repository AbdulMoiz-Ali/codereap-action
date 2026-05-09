export type Severity = "critical" | "high" | "medium" | "low";
export type Grade = "A" | "B" | "C" | "D" | "F";

export interface Finding {
  ruleId: string;
  severity: Severity;
  title: string;
  message: string;
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
  snippet: string;
  fix?: {
    mode?: "auto" | "manual";
    label: string;
    replacement: string;
    instructions?: string[];
  };
}

export interface ScanResult {
  findings: Finding[];
  summary: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    total: number;
  };
  grade: Grade;
  score: number;
  language: string;
  loc: number;
  durationMs: number;
}

export interface FileScan {
  path: string;
  result: ScanResult;
}

export interface SkippedFile {
  path: string;
  reason: string;
}
