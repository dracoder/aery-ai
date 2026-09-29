export interface MindTool {
  name: string;
  description: string;
  inputSchema: any;
  annotations?: any;
  _meta?: Record<string, unknown>;
  handler(args: any, extra: unknown): Promise<any>;
}

export type TextReply = { content: { type: 'text'; text: string }[] };

export interface MindDeps {
  daemonUrl: string;
  token(): string;
  daemonCall(method: string, route: string, body?: unknown): Promise<unknown>;
  asText(v: unknown): TextReply;
}

export type LogCmd = (
  tool: string, lane: string, riskClass: number, detail: string, verdict: string,
) => void;

export type GateGuard =
  | { kind: 'deny'; verdict: string; reason: string; message: string }
  | { kind: 'allow'; verdict: string }
  | null;

export type ConfirmExtras = Record<string, unknown> | undefined;

export interface MindVerbText {
  scopeHelp: string;
  runners: readonly string[];
  runnerNote: string;
  lensShow: string;
  lensId: string;
}

export interface MindTools {
  tools(deps: MindDeps): { afterWorkflows: MindTool[]; afterAgents: MindTool[] };
  logHandlers(log: LogCmd): Record<string, (msg: any) => void>;
  askGuard(via: string, laneId: string): GateGuard;
  confirmExtras(
    toolName: string, input: Record<string, unknown>, laneId: string,
  ): ConfirmExtras;
  via(raw: unknown): string | null;
  verbText(): MindVerbText;
}
