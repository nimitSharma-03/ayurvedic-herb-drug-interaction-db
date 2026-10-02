import { DiscMark } from "@/components/disc-mark";
import { NOT_RECORDED } from "@/lib/text";

/**
 * A labelled field that says so when this project holds nothing for it.
 *
 * Never a dash, a zero or an invented placeholder. An absent value here means
 * no file in this repository sources it, which the backend spells out in every
 * medicine's `data_completeness`, and the reader is told that rather than left
 * to read the gap as a negative finding.
 */
export function Field({
  label,
  value,
  children,
  note,
}: {
  label: string;
  /** Rendered when present; `children` is used instead when given. */
  value?: string | null;
  children?: React.ReactNode;
  note?: string;
}) {
  const hasChildren = children !== undefined && children !== null && children !== false;
  const hasValue = typeof value === "string" && value.trim().length > 0;

  return (
    <div>
      <dt className="text-sm font-semibold text-[var(--color-ink-2)]">{label}</dt>
      <dd className="mt-1">
        {hasChildren ? (
          children
        ) : hasValue ? (
          <p>{value}</p>
        ) : (
          <p className="text-[var(--color-insufficient)]" data-testid="not-recorded">
            {NOT_RECORDED}
            {note ? <span className="block text-sm">{note}</span> : null}
          </p>
        )}
      </dd>
    </div>
  );
}

/**
 * The same message for a whole section that has no rows.
 *
 * With a small disc beside it, because an empty dashed box on its own reads as
 * something that failed to load rather than as a section this project has
 * nothing sourced for.
 */
export function EmptySection({ children }: { children: React.ReactNode }) {
  return (
    <div
      data-testid="empty-section"
      className="flex items-center gap-4 rounded-[var(--radius-card)] border border-dashed border-[var(--color-ink)]/25 px-5 py-4 text-sm text-[var(--color-ink-2)]"
    >
      <DiscMark className="size-4" />
      <p>{children}</p>
    </div>
  );
}
