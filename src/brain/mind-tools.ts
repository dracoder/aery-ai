import type {
  ConfirmExtras, GateGuard, LogCmd, MindDeps, MindTool, MindTools, MindVerbText,
} from './mind-tools-api';

export const mindTools: MindTools = {
  tools(_deps: MindDeps): { afterWorkflows: MindTool[]; afterAgents: MindTool[] } {
    return { afterWorkflows: [], afterAgents: [] };
  },

  logHandlers(_log: LogCmd): Record<string, (msg: any) => void> {
    return {};
  },

  askGuard(_via: string, _laneId: string): GateGuard {
    return null;
  },

  confirmExtras(_toolName: string, _input: Record<string, unknown>, _laneId: string): ConfirmExtras {
    return undefined;
  },

  via(_raw: unknown): string | null {
    return null;
  },

  verbText(): MindVerbText {
    return {
      scopeHelp:
        'scope (optional) proposes a STANDING ORDER: lane patterns this workflow\'s runs may ' +
        'execute unattended once the user approves with Windows Hello — e.g. fs.scratch (its ' +
        'own scratch folder under data/scratch/), fs.write:workspace. Include the :tainted variant ' +
        'of a lane if the run will read the web first. Propose the SMALLEST scope that covers ' +
        'the routine — governance, self-modify and dangerous-shell lanes can never be scoped, ' +
        'and a run needing anything outside its scope still raises a confirm (which times out ' +
        'to a deny when nobody is home).',
      runners: [],
      runnerNote: '',
      lensShow:
        'Put a panel on the Lens (the owner\'s canvas at /lens) showing something you already ' +
        'have: a hoard page as a document, or one of the stores as a table. This shows the ' +
        'owner what exists — it fetches nothing, follows no links, approves nothing, and ' +
        'cannot open arbitrary files or URLs. document: id is a hoard page (user.md, ' +
        'learned.md, persona.md). table: id is workflows. Class 1.',
      lensId: 'what to show: a hoard page or a table name — never a path or URL',
    };
  },
};
