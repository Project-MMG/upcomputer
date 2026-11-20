import { useEffect, useReducer, useState } from "react";

export function projectToolErrorMessage(cause: unknown) {
  return cause instanceof Error
    ? cause.message
    : "Up.computer could not load or save project tools.";
}

export function useRemoteData<A>(load: () => Promise<A>) {
  const [revision, refresh] = useReducer((current: number) => current + 1, 0);
  const [result, setResult] = useState<{ data?: A; error?: string; revision: number }>();
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Read the selected environment's current RPC data.
  useEffect(() => {
    let current = true;
    void load().then(
      (data) => {
        if (current) setResult({ data, revision });
      },
      (error: unknown) => {
        if (current)
          setResult((previous) => ({
            ...previous,
            error: projectToolErrorMessage(error),
            revision,
          }));
      },
    );
    return () => {
      current = false;
    };
  }, [load, revision]);
  return { ...result, refresh, loading: result?.revision !== revision };
}
