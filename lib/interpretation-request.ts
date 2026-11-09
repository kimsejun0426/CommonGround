export interface InterpretationRequestToken {
  readonly revision: number;
  readonly text: string;
}

/** A changed input invalidates both a pending response and an already reviewed result. */
export function createInterpretationRequestGuard() {
  let revision = 0;
  return {
    begin(text: string): InterpretationRequestToken {
      return { revision: ++revision, text };
    },
    invalidate(): void {
      revision += 1;
    },
    isCurrent(token: InterpretationRequestToken | null, text: string): boolean {
      return token !== null && token.revision === revision && token.text === text;
    },
  };
}
