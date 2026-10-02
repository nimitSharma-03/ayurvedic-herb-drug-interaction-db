import { DiscMark } from "@/components/disc-mark";

import type { ApiError } from "@/lib/api";

/**
 * What a page shows when the backend did not answer.
 *
 * Two different failures, said differently. Nothing answered at all is a setup
 * problem and the reader is told the command that fixes it. Something answered
 * with an error is the backend's own message, passed through, because the
 * backend already words these carefully and rewording it here would be
 * guessing at what went wrong.
 *
 * Neither case shows an empty page or a zero. An empty medicine list would read
 * as "this database holds nothing", which is a different and false statement.
 */
export function ApiUnreachable({
  error,
  what,
}: {
  error: ApiError;
  /** What could not be loaded, for example "the medicine list". */
  what?: string;
}) {
  const unreachable = error.isUnreachable;
  return (
    <div
      role="alert"
      data-testid="api-unreachable"
      className="mx-auto flex max-w-2xl flex-col gap-4 py-6"
    >
      <DiscMark />
      <h2 className="mt-4 text-2xl sm:text-[2rem]">
        {unreachable ? "The database server is not responding" : "That request did not work"}
      </h2>

      {unreachable ? (
        <p className="text-[var(--color-ink-2)]">
          Start it with{" "}
          <code className="rounded-[var(--radius-tight)] border border-[var(--color-line)] px-1.5 py-0.5 font-[family-name:var(--font-mono)] text-[0.9375rem] text-[var(--color-ink)]">
            python -m hdi.api
          </code>{" "}
          from the project root, then reload.
        </p>
      ) : (
        <p className="text-[var(--color-ink-2)]">{error.message}</p>
      )}

      {what ? (
        <p className="text-sm text-[var(--color-ink-2)]">
          Nothing is shown for {what}: an empty list here would read as a finding.
        </p>
      ) : null}
    </div>
  );
}
