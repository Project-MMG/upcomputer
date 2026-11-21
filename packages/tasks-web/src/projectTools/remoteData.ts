import { useEffect, useReducer, useState } from "react";

export function projectToolErrorMessage(cause: unknown) {
  return cause instanceof Error
    ? cause.message
    : "Up.computer could not load or save project tools.";
}

export function useRemoteData<A>(load: () => Promise<A>, refreshKey?: string | null) {
  const [revision, refresh] = useReducer((current: number) => current + 1, 0);
  const [result, setResult] = useState<{
    data?: A;
    error?: string;
    revision: number;
    refreshKey: string | null | undefined;
  }>();
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Read the selected environment's current RPC data.
  useEffect(() => {
    let current = true;
    void load().then(
      (data) => {
        if (current) setResult({ data, refreshKey, revision });
      },
      (error: unknown) => {
        if (current)
          setResult((previous) => ({
            ...previous,
            error: projectToolErrorMessage(error),
            refreshKey,
            revision,
          }));
      },
    );
    return () => {
      current = false;
    };
  }, [load, refreshKey, revision]);
  return {
    ...result,
    refresh,
    loading: result?.revision !== revision || result?.refreshKey !== refreshKey,
  };
}
