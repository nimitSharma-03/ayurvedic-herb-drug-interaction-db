import { ExternalLink } from "lucide-react";

import { pmidsIn, pubmedUrl } from "@/lib/text";

/**
 * A PMID, set in the mono face, linking to its PubMed record.
 *
 * The mono face is used here and nowhere else: a PMID is an identifier the
 * reader may want to copy or compare digit by digit, which is a different job
 * from reading prose.
 */
export function PmidLink({ pmid, className }: { pmid: string; className?: string }) {
  return (
    <a
      href={pubmedUrl(pmid)}
      target="_blank"
      rel="noreferrer noopener"
      className={`inline-flex items-center gap-1 font-[family-name:var(--font-mono)] text-xs text-[var(--color-ink)] underline decoration-[var(--color-line)] underline-offset-3 hover:decoration-[var(--color-herb)] ${className ?? ""}`}
    >
      PMID {pmid}
      <ExternalLink className="size-3" aria-hidden="true" />
      <span className="sr-only"> on PubMed, opens in a new tab</span>
    </a>
  );
}

/**
 * Every PMID named in a source note, each linked.
 *
 * The note itself is rendered by the caller; this adds the links beside it. A
 * note with no PMID in it produces nothing, which is the honest outcome for a
 * row sourced from a drug label or from general pharmacology.
 */
export function SourceNotePmids({ note }: { note: string | null | undefined }) {
  const pmids = pmidsIn(note);
  if (pmids.length === 0) return null;
  return (
    <span className="inline-flex flex-wrap gap-x-3 gap-y-1">
      {pmids.map((pmid) => (
        <PmidLink key={pmid} pmid={pmid} />
      ))}
    </span>
  );
}
