import { ServerOff } from "lucide-react";

import type { ApiError } from "@/lib/api";
import { UNREACHABLE_MESSAGE } from "@/lib/api";

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
      className="panel mx-auto flex max-w-2xl flex-col gap-3 p-6 sm:p-8"
    >
      <div className="flex items-center gap-2.5 text-[var(--color-verified)]">
        <ServerOff className="size-5 shrink-0" aria-hidden="true" />
        <h2 className="text-lg">
          {unreachable ? "The database server is not responding" : "That request did not work"}
        </h2>
      </div>

      <p className="text-[var(--color-ink-2)]">
        {unreachable ? UNREACHABLE_MESSAGE : error.message}
      </p>

      {unreachable ? (
        <p className="text-sm text-[var(--color-ink-2)]">
          Start it with{" "}
          <code className="rounded-sm bg-[var(--color-wash)] px-1.5 py-0.5 font-[family-name:var(--font-mono)] text-xs">
            python -m hdi.api
          </code>{" "}
          from the project root, then reload this page.
        </p>
      ) : null}

      {what ? (
        <p className="text-sm text-[var(--color-ink-2)]">
          Nothing is shown for {what} rather than a blank or a placeholder, because an
          empty list here would read as a finding.
        </p>
      ) : null}
    </div>
  );
}
