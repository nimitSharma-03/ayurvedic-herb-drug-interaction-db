import { Info } from "lucide-react";

/**
 * The API's own disclaimer, shown verbatim.
 *
 * Every response that carries medical content carries a `disclaimer` string,
 * and this renders that string. It is not retyped, shortened or paraphrased
 * anywhere in this app: the backend's wording is the wording its own tests
 * check.
 */
export function Disclaimer({ text }: { text: string }) {
  return (
    <aside
      data-testid="disclaimer"
      className="flex gap-3 rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-wash)] px-6 py-5 text-sm text-[var(--color-ink-2)]"
    >
      <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <p>{text}</p>
    </aside>
  );
}

/** A short note that every row in this project is unreviewed, with the API's text. */
export function EvidenceNote({ text }: { text: string }) {
  return (
    <p data-testid="evidence-note" className="text-sm text-[var(--color-ink-2)]">
      {text}
    </p>
  );
}
