"use client";

import * as React from "react";
import { Leaf, Pill } from "lucide-react";

import { WarningLevelBadge } from "@/components/evidence-badge";
import { WarningDrawer } from "@/components/warning-drawer";
import type { CombinationSummary, RecommendResponse } from "@/lib/types";
import {
  groupedWarningsFor,
  hubsFor,
  warningTotals,
  type LineStyle,
  type WarningGroup,
  type WarningHub,
} from "@/lib/warnings";
import { cn } from "@/lib/utils";

/**
 * "Combinations to avoid".
 *
 * Each medicine the reader already takes is a hub, and the things that conflict
 * with it connect to it with a line: solid red for a literature-verified
 * finding, dashed amber for a mechanism-based caution, dotted grey where there
 * is nothing to go on. Warnings that share a level, a hub and a reason collapse
 * into one row listing every medicine, which is what makes a diabetes answer
 * readable instead of eleven copies of one sentence.
 *
 * Every warning the API returned is on screen, inside exactly one row, and the
 * API's own `combination_summary` note is printed underneath so the counts can
 * be reconciled against it.
 *
 * The lines are measured from the rendered rows rather than laid out on a
 * fixed grid, so the same code draws them whether the hub sits beside the rows
 * on a wide screen or above them on a narrow one.
 */
export function WarningGraph({ response }: { response: RecommendResponse }) {
  const groups = React.useMemo(() => groupedWarningsFor(response), [response]);
  const hubs = React.useMemo(() => hubsFor(groups), [groups]);
  const totals = React.useMemo(() => warningTotals(groups), [groups]);
  const [openGroup, setOpenGroup] = React.useState<WarningGroup | null>(null);

  if (groups.length === 0) return null;

  const summary: CombinationSummary | undefined = response.combination_summary;

  return (
    <section className="panel p-5 sm:p-7" data-testid="warning-graph">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-2xl">Combinations to avoid</h2>
        <p className="text-sm text-[var(--color-ink-2)]">
          {totals.warnings} {totals.warnings === 1 ? "warning" : "warnings"} in{" "}
          {totals.groups} {totals.groups === 1 ? "row" : "rows"}
        </p>
      </div>

      <Legend />

      <div className="mt-6 flex flex-col gap-8">
        {hubs.map((hub) => (
          <HubBlock key={hub.hub.name} hub={hub} onOpen={setOpenGroup} />
        ))}
      </div>

      {summary ? (
        <div className="mt-7 border-t border-[var(--color-line)] pt-5">
          <p className="text-sm text-[var(--color-ink-2)]" data-testid="combination-summary">
            {summary.note}
          </p>
          <dl className="mt-3 flex flex-wrap gap-x-8 gap-y-2 text-sm">
            <SummaryStat label="pairs checked" value={summary.pairs_checked} />
            <SummaryStat label="warnings listed" value={summary.warnings_listed} />
            <SummaryStat
              label="pairs with no finding, counted not listed"
              value={summary.pairs_with_no_finding_not_listed}
            />
          </dl>
        </div>
      ) : null}

      <WarningDrawer group={openGroup} onClose={() => setOpenGroup(null)} />
    </section>
  );
}

function SummaryStat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-[var(--color-ink-2)]">{label}</dt>
      <dd className="font-[family-name:var(--font-heading)] text-lg font-semibold tabular-nums">
        {value}
      </dd>
    </div>
  );
}

const LINE_COLOUR: Record<LineStyle, string> = {
  solid: "var(--color-verified)",
  dashed: "var(--color-mechanism)",
  dotted: "var(--color-insufficient)",
};

function Legend() {
  const items: { style: LineStyle; label: string }[] = [
    { style: "solid", label: "Literature-verified" },
    { style: "dashed", label: "Mechanism-based, not literature-verified" },
    { style: "dotted", label: "Nothing documented or nothing to go on" },
  ];
  return (
    <ul className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm text-[var(--color-ink-2)]">
      {items.map((item) => (
        <li key={item.style} className="flex items-center gap-2">
          <svg width="28" height="8" aria-hidden="true" className="shrink-0">
            <line
              x1="1"
              y1="4"
              x2="27"
              y2="4"
              stroke={LINE_COLOUR[item.style]}
              strokeWidth="2"
              strokeLinecap="round"
              strokeDasharray={
                item.style === "dashed" ? "6 4" : item.style === "dotted" ? "2 4" : undefined
              }
            />
          </svg>
          {item.label}
        </li>
      ))}
    </ul>
  );
}

interface Line {
  id: string;
  path: string;
  length: number;
  style: LineStyle;
}

/** One hub and every row that connects to it. */
function HubBlock({
  hub,
  onOpen,
}: {
  hub: WarningHub;
  onOpen: (group: WarningGroup) => void;
}) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const hubRef = React.useRef<HTMLDivElement>(null);
  const rowRefs = React.useRef(new Map<string, HTMLElement>());
  const [lines, setLines] = React.useState<Line[]>([]);
  const [box, setBox] = React.useState({ width: 0, height: 0 });

  // Positions are read from the DOM, so a ResizeObserver is the external system
  // this component is synchronising with: it fires on the first layout and on
  // every reflow, which is exactly when the lines need redrawing.
  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const measure = () => {
      const hubNode = hubRef.current;
      if (!hubNode) return;
      const frame = container.getBoundingClientRect();
      const hubRect = hubNode.getBoundingClientRect();
      setBox({ width: frame.width, height: frame.height });

      const next: Line[] = [];
      for (const group of hub.groups) {
        const node = rowRefs.current.get(group.id);
        if (!node) continue;
        const rowRect = node.getBoundingClientRect();
        next.push({
          id: group.id,
          ...connector(frame, hubRect, rowRect),
          style: group.lineStyle,
        });
      }
      setLines(next);
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    for (const node of rowRefs.current.values()) observer.observe(node);
    return () => observer.disconnect();
  }, [hub]);

  const isHerb = hub.hub.medicineType === "herb";

  return (
    <div
      ref={containerRef}
      data-testid="warning-hub"
      className="relative grid gap-4 md:grid-cols-[minmax(0,1fr)_7rem_auto] md:items-center"
    >
      {box.width > 0 ? (
        <svg
          className="pointer-events-none absolute inset-0 hidden md:block"
          width={box.width}
          height={box.height}
          viewBox={`0 0 ${box.width} ${box.height}`}
          aria-hidden="true"
        >
          {lines.map((line) => (
            <path
              key={line.id}
              d={line.path}
              fill="none"
              stroke={LINE_COLOUR[line.style]}
              strokeWidth="2"
              strokeLinecap="round"
              strokeDasharray={
                line.style === "dashed" ? "7 5" : line.style === "dotted" ? "2 5" : undefined
              }
              className={line.style === "solid" ? "draw-line" : undefined}
              style={
                line.style === "solid"
                  ? ({ "--line-length": line.length } as React.CSSProperties)
                  : undefined
              }
            />
          ))}
        </svg>
      ) : null}

      <ul className="order-2 flex flex-col gap-3 md:order-1">
        {hub.groups.map((group) => (
          <li key={group.id}>
            <button
              type="button"
              ref={(node) => {
                if (node) rowRefs.current.set(group.id, node);
                else rowRefs.current.delete(group.id);
              }}
              onClick={() => onOpen(group)}
              data-testid="warning-row"
              data-level={group.level}
              className={cn(
                "card-surface w-full p-4 text-left transition-shadow hover:shadow-[var(--shadow-lift)]",
                group.level === "literature_verified" &&
                  "border-[var(--color-verified)]/40",
                group.level === "mechanism_based" && "border-[var(--color-mechanism)]/40",
              )}
            >
              <div className="flex flex-wrap items-center gap-2">
                <WarningLevelBadge level={group.level} label={group.label} />
                {group.againstCurrentMedicine ? (
                  <span className="text-xs font-semibold text-[var(--color-ink-2)]">
                    with something you already take
                  </span>
                ) : null}
              </div>

              <p className="mt-2.5 flex flex-wrap items-center gap-1.5">
                {group.spokes.map((side) => (
                  <span
                    key={side.name}
                    data-testid="warning-spoke"
                    className="inline-flex items-center gap-1 rounded-full bg-[var(--color-wash)] px-2.5 py-0.5 text-sm font-semibold"
                  >
                    {side.medicineType === "drug" ? (
                      <Pill
                        className="size-3 text-[var(--color-drug)]"
                        aria-hidden="true"
                      />
                    ) : (
                      <Leaf
                        className="size-3 text-[var(--color-herb)]"
                        aria-hidden="true"
                      />
                    )}
                    {side.name}
                  </span>
                ))}
              </p>

              <p className="mt-2 text-sm text-[var(--color-ink-2)]">{group.reason}</p>
            </button>
          </li>
        ))}
      </ul>

      <div className="order-1 hidden md:order-2 md:block" aria-hidden="true" />

      <div className="order-1 md:order-3 md:justify-self-end">
        <div
          ref={hubRef}
          data-testid="warning-hub-node"
          className={cn(
            "inline-flex items-center gap-2 rounded-full border-2 px-4 py-2.5 font-[family-name:var(--font-heading)] font-semibold",
            isHerb
              ? "border-[var(--color-herb)] bg-[var(--color-herb)]/10 text-[var(--color-herb)]"
              : "border-[var(--color-drug)] bg-[var(--color-drug)]/10 text-[var(--color-drug)]",
          )}
        >
          {isHerb ? (
            <Leaf className="size-4" aria-hidden="true" />
          ) : (
            <Pill className="size-4" aria-hidden="true" />
          )}
          {hub.hub.name}
        </div>
        {hub.hub.isCurrent ? (
          <p className="mt-1.5 text-right text-xs text-[var(--color-ink-2)]">
            you already take this
          </p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * A curve from a row's edge to the hub's edge, in the container's coordinates.
 *
 * Both rectangles are measured, so the same function handles the hub sitting to
 * the right of the rows and the hub sitting above them; the control points lean
 * along whichever axis the two are further apart on.
 */
function connector(
  frame: DOMRect,
  hubRect: DOMRect,
  rowRect: DOMRect,
): { path: string; length: number } {
  const horizontal =
    Math.abs(hubRect.left - rowRect.right) > Math.abs(hubRect.top - rowRect.bottom);

  const from = horizontal
    ? { x: rowRect.right - frame.left, y: rowRect.top + rowRect.height / 2 - frame.top }
    : { x: rowRect.left + rowRect.width / 2 - frame.left, y: rowRect.top - frame.top };
  const to = horizontal
    ? { x: hubRect.left - frame.left, y: hubRect.top + hubRect.height / 2 - frame.top }
    : { x: hubRect.left + hubRect.width / 2 - frame.left, y: hubRect.bottom - frame.top };

  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const control = horizontal
    ? [
        { x: from.x + dx * 0.55, y: from.y },
        { x: to.x - dx * 0.55, y: to.y },
      ]
    : [
        { x: from.x, y: from.y + dy * 0.55 },
        { x: to.x, y: to.y - dy * 0.55 },
      ];

  const path = `M ${from.x} ${from.y} C ${control[0]!.x} ${control[0]!.y} ${control[1]!.x} ${control[1]!.y} ${to.x} ${to.y}`;
  // An estimate is enough: the dash pattern only has to be at least as long as
  // the curve for the draw-in to reveal all of it.
  const length = Math.round(Math.hypot(dx, dy) * 1.35) + 8;
  return { path, length };
}
