import type { Classification, Guardrails, GateState } from './gateway';

export function classifyMindTool(
  _toolName: string,
  _input: Record<string, unknown>,
  _g: Guardrails,
  _state: GateState,
): Classification | null {
  return null;
}

export function talonPreviewPoint(
  _toolName: string,
  _input: Record<string, unknown>,
): { verb: string; x?: number; y?: number } | null {
  return null;
}
