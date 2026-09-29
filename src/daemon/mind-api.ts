import type * as http from 'node:http';
import type { LensPanel, LensTarget } from './lens';
import type { TtsLoader } from './speech';
import type { Workflow } from './workflows';

export type MicMode = 'ptt' | 'wake' | 'always' | 'off';
export type ModelName = 'opus' | 'sonnet' | 'haiku' | 'fable';

export interface MindDeps {
  root: string;
  dataDir: string;
  memoryDir: string;
  brainToken: string;
  windowsOnly: string[];
  log(scope: string, msg: string): void;
  mkLog(type: string): (lane: string, detail: string, verdict: string) => void;
  broadcast(event: Record<string, unknown>): void;
  sendBrain(obj: Record<string, unknown>): boolean;
  readConfigRaw(): any;
  writeConfig(cfg: unknown): void;
  isHalted(): boolean;
  haltReason(): string;
  localOnly(): boolean;
  localOnlyMsg: string;
  isLocalAddress(addr: string | undefined): boolean;
  brainTokenOk(expected: string, got: string): boolean;
  daemonHello(message: string): Promise<'verified' | 'declined' | 'unavailable'>;
  helloRefusal(what: string): string;
  gatedFetch(url: string, init: { headers: Record<string, string>; timeoutMs: number }): Promise<globalThis.Response | { error: string }>;
  json(res: http.ServerResponse, code: number, body: unknown): void;
  readBody(req: http.IncomingMessage): Promise<any>;
  sendStatic(req: http.IncomingMessage, res: http.ServerResponse, file: string): void;
  readAudit(limit: number): { rows: any[]; chainIntact: boolean | null };
  workflows: any;
  agents: any;
  notices: any;
  workflowLog(lane: string, detail: string, verdict: string): void;
  withWords(wf: Workflow): any;
  pendingConfirms: Map<string, { question: string; ts: number; riskClass: number; laneId: string; timeoutMs: number; extra?: Record<string, unknown> }>;
  patchConfirm(id: string, patch: Record<string, unknown>): void;
  speak(text: string): Promise<void>;
  cancelSpeech(): void;
  voiceResume(): void;
  setMicMode(m: MicMode): void;
  wakeCue: string;
  touchContinuity(): void;
  recordLocalExchange(question: string, answer: string): void;
  newsCategories(): Record<string, any[]>;
  runsOrgan(capability: string): boolean;
  role: string;
  desk(): { port: number; callbackToken: string } | null;
  deskCapability(capability: string): { ok: true } | { ok: false; reason: string };
  deskAttached(): boolean;
  dbPath: string;
  edgeTtsLoader(): Promise<TtsLoader>;
  newsFetchedAt(): string | null;
  openLensPanel(template: string, id: unknown, opened: 'conversation' | 'initiative'): LensPanel | { error: string };
  routeAsk(text: string, via: string): boolean;
}

export interface MindApi {
  handleRoute(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<boolean>;
  routeTiers(text: string, via: string, face?: 'aeri'): boolean;
  noteAsk(text: string): void;
  onBrainMessage(msg: any): void;
  onBrainExit(): void;
  onHalt(): Promise<void>;
  confirmExtra(msg: any): Record<string, unknown> | undefined;
  onConfirm(id: string, extra: Record<string, unknown> | undefined): void;
  runWorkflow(wf: Workflow, runId: number, trigger: string): boolean;
  lensTables(): readonly string[];
  lensBriefs(): boolean;
  lensResolve(target: LensTarget, opened: 'conversation' | 'initiative', ts: string): LensPanel | { error: string } | null;
  humanOnly(pathname: string): boolean;
  statusFields(): Record<string, unknown>;
  pendingProposals(): Record<string, number>;
  auditTools(): readonly string[];
  windowsOnly(): readonly string[];
  assetFile(pathname: string): string | null;
  quietNow(): boolean;
  start(): void;
  close(): void;
}

export const NO_MIND: MindApi = {
  handleRoute: async () => false,
  routeTiers: () => false,
  noteAsk: () => {},
  onBrainMessage: () => {},
  onBrainExit: () => {},
  onHalt: async () => {},
  confirmExtra: () => undefined,
  onConfirm: () => {},
  runWorkflow: () => false,
  lensTables: () => [],
  lensBriefs: () => false,
  lensResolve: () => null,
  humanOnly: () => false,
  statusFields: () => ({}),
  pendingProposals: () => ({}),
  auditTools: () => [],
  windowsOnly: () => [],
  assetFile: () => null,
  quietNow: () => false,
  start: () => {},
  close: () => {},
};
