"use client";

import * as React from "react";
import Link from "next/link";
import { Leaf, Pill, Search } from "lucide-react";

import { Input } from "@/components/ui/input";
import type { MedicineSummary } from "@/lib/types";
import { cn } from "@/lib/utils";

type Filter = "all" | "herb" | "drug";

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "herb", label: "Ayurvedic herbs" },
  { value: "drug", label: "Conventional drugs" },
];

/**
 * The browse list: a herb or drug filter and a text filter over the catalogue.
 *
 * The box narrows the list already on the page by the names that are on it. It
 * is not the alias-aware search -- that one is the backend's, in the box above
 * this list and in the comboboxes -- and the empty state says so, so a reader
 * who typed a synonym and saw nothing knows where to look instead.
 */
export function MedicineBrowser({ medicines }: { medicines: MedicineSummary[] }) {
  const [filter, setFilter] = React.useState<Filter>("all");
  const [term, setTerm] = React.useState("");
  const searchId = React.useId();

  const needle = term.trim().toLowerCase();
  const shown = medicines.filter((medicine) => {
    if (filter !== "all" && medicine.medicine_type !== filter) return false;
    if (!needle) return true;
    return [
      medicine.name,
      medicine.scientific_name,
      medicine.generic_name,
      medicine.drug_class,
    ].some((value) => value?.toLowerCase().includes(needle));
  });

  return (
    <div className="mt-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div
          role="group"
          aria-label="Filter by kind"
          className="flex flex-wrap gap-2"
        >
          {FILTERS.map((option) => {
            const active = filter === option.value;
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={active}
                onClick={() => setFilter(option.value)}
                data-testid={`filter-${option.value}`}
                className={cn(
                  "rounded-[var(--radius-field)] border px-4 py-2 text-sm font-medium transition-colors",
                  active
                    ? "border-[var(--color-primary)] bg-[var(--color-primary)]/8 text-[var(--color-primary)]"
                    : "border-[var(--color-line)] bg-[var(--color-surface)] text-[var(--color-ink-2)] hover:bg-[var(--color-wash)]",
                )}
              >
                {option.label}
              </button>
            );
          })}
        </div>

        <div className="sm:w-80">
          <label htmlFor={searchId} className="mb-1.5 block text-sm font-semibold">
            Filter by name
          </label>
          <div className="search-glow flex items-center gap-2 rounded-[var(--radius-field)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3">
            <Search className="size-4 shrink-0 text-[var(--color-ink-2)]" aria-hidden="true" />
            <Input
              id={searchId}
              type="search"
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              data-testid="browse-filter"
              className="h-11 border-0 bg-transparent px-0 focus-visible:border-0 focus-visible:outline-none"
            />
          </div>
        </div>
      </div>

      <p aria-live="polite" className="mt-5 text-sm text-[var(--color-ink-2)]">
        Showing {shown.length} of {medicines.length}.
      </p>

      {shown.length === 0 ? (
        <p
          data-testid="browse-empty"
          className="mt-4 border-t border-[var(--color-line)] py-6 text-sm text-[var(--color-ink-2)]"
        >
          Nothing on this list matches that. This box filters the names on the page; other
          names are matched by the search box above.
        </p>
      ) : (
        <ul className="ruled-list mt-4 border-t border-[var(--color-line)]">
          {shown.map((medicine) => (
            <li key={medicine.id}>
              <Link
                href={`/medicines/${medicine.id}`}
                data-testid="medicine-card"
                className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-6 gap-y-1 py-3 transition-colors hover:bg-[var(--color-wash)] sm:grid-cols-[auto_minmax(0,14rem)_minmax(0,16rem)_minmax(0,1fr)]"
              >
                {medicine.medicine_type === "herb" ? (
                  <Leaf
                    className="size-4 shrink-0 translate-y-0.5 text-[var(--color-herb)]"
                    aria-hidden="true"
                  />
                ) : (
                  <Pill
                    className="size-4 shrink-0 translate-y-0.5 text-[var(--color-drug)]"
                    aria-hidden="true"
                  />
                )}
                <span className="min-w-0 font-medium">{medicine.name}</span>
                <span className="col-start-2 min-w-0 text-sm italic text-[var(--color-ink-2)] sm:col-start-3">
                  {medicine.scientific_name ?? ""}
                </span>
                <span className="col-start-2 text-sm text-[var(--color-ink-2)] sm:col-start-4">
                  {medicine.drug_class ?? ""}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
