import Link from "next/link";
import { ScanSearch, UserCheck } from "lucide-react";

import { ApiUnreachable } from "@/components/api-unreachable";
import { AskForm } from "@/components/ask-form";
import { CountUp } from "@/components/count-up";
import { HeroArt } from "@/components/home/hero-art";
import { HeroParticles } from "@/components/home/hero-particles";
import { SceneMotion } from "@/components/home/scene-motion";
import { VelocityBand } from "@/components/home/velocity-band";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { loadConditions, loadStats } from "@/lib/server-data";
import { FOOTER_DISCLAIMER, NOT_RECORDED, formatCount } from "@/lib/text";
import type { StatsResponse } from "@/lib/types";

const SCENES_ID = "scenes";

/**
 * The home page: a scroll story in four night scenes, then the problem form.
 *
 * 01 Describe a problem -- the hero, with both calls to action.
 * 02 Search the literature -- the live /stats figures.
 * 03 Curated by hand -- what a curator does, with two placeholder rows.
 * 04 Check a pair -- the way into the pair check, and the disclaimer.
 *
 * The scenes are always dark: they sit inside `.night`, whatever the theme.
 * The form after them follows the theme like every other tool on the site.
 */
export default async function HomePage() {
  // The conditions come down with the counts so the form, its supported-condition
  // chips and the figures all arrive in the first response: a reader can start
  // typing their problem here without a page in between.
  const [stats, conditions] = await Promise.all([loadStats(), loadConditions()]);

  return (
    <>
      <div id={SCENES_ID} className="scenes night">
        <div className="scenes-rule" aria-hidden="true" />
        <SceneMotion rootId={SCENES_ID} />

        <Hero />
        <VelocityBand />

        {stats.ok ? (
          <Figures stats={stats.data} />
        ) : (
          <section className="bg-[var(--color-charred)] py-24">
            <div className="scene-inner">
              <ApiUnreachable error={stats.error} what="the pipeline counts" />
            </div>
          </section>
        )}

        <Curation />
        <CheckScene />
      </div>

      {/*
        The problem form, full width: its answer lays options out in two columns
        with a combination panel beside them.
      */}
      <section className="border-t border-[var(--color-line)]" aria-labelledby="describe-heading">
        <div className="page-shell section-pad">
          <h2 id="describe-heading" className="heading-rule text-2xl sm:text-[2rem]">
            Describe a problem
          </h2>
          <p className="mt-4 max-w-[70ch] text-[var(--color-ink-2)]">
            In your own words, in English or Hinglish. Or{" "}
            <Link
              href="/check"
              className="text-[var(--color-ink)] underline decoration-[var(--color-line)] underline-offset-4 hover:decoration-[var(--color-primary)]"
            >
              check a pair
            </Link>{" "}
            if you already have both names.
          </p>

          {conditions.ok ? (
            <AskForm
              supportedConditions={conditions.data.results}
              note={conditions.data.note}
            />
          ) : (
            <div className="mt-8">
              <ApiUnreachable error={conditions.error} what="the supported conditions" />
            </div>
          )}
        </div>
      </section>
    </>
  );
}

/** "01 — Describe a problem", with its mark on the chapter rule. */
function Chapter({ number, children }: { number: string; children: React.ReactNode }) {
  return (
    <p className="chapter-label flex items-center">
      <span className="chapter-mark" aria-hidden="true" />
      {number} — {children}
    </p>
  );
}

/* ------------------------------------------------------------------ 01 */

/**
 * The hero: one screen, with the header lying over its top. The disc sits
 * behind the top of the headline, so the subhead and both buttons are on
 * night rather than on vermilion.
 */
function Hero() {
  return (
    <section
      data-testid="hero"
      aria-labelledby="hero-heading"
      className="hero-scene relative -mt-[var(--nav-h)] flex flex-col overflow-hidden"
    >
      <HeroParticles />
      <HeroArt />

      <div className="scene-inner relative z-10 pt-8">
        <Chapter number="01">Describe a problem</Chapter>
      </div>

      <div className="relative z-10 flex flex-1 flex-col items-center justify-center px-[var(--scene-inset)] pt-[16svh] pb-[10svh] text-center">
        <div className="relative">
          <div
            aria-hidden="true"
            className="parallax pointer-events-none absolute top-0 left-1/2"
            style={{ "--depth": 0.4 } as React.CSSProperties}
          >
            <div className="hero-disc -translate-x-1/2 -translate-y-[74%]" />
          </div>
          <h1 id="hero-heading" className="relative max-w-[24ch] text-balance">
            Describe a problem. See what the literature records.
          </h1>
        </div>

        <p className="mt-5 max-w-[52ch] text-[var(--color-ink-2)]">
          A literature-grounded database of herbs and medicines, with a PubMed citation on
          every record.
        </p>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Button asChild size="lg">
            <Link href="/ask">Describe a problem</Link>
          </Button>
          <Button asChild size="lg" variant="secondary">
            <Link href="/check">Check a pair</Link>
          </Button>
        </div>
      </div>

      <div
        aria-hidden="true"
        className="absolute bottom-6 left-1/2 z-10 hidden -translate-x-1/2 flex-col items-center gap-2 text-sm tracking-[0.18em] text-[var(--color-ink-2)] uppercase sm:flex"
      >
        Scroll
        <span className="scroll-cue-line block h-10 w-px bg-[var(--color-ink-2)]" />
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ 02 */

/**
 * The figures, every one of them from /stats, which counts it from this
 * repository's own files; nothing here is written down. A count the backend
 * reports as absent shows as absent.
 *
 * Five in a row: the scope (herbs, drugs) and the pipeline (pairs searched,
 * abstracts read, documented interactions), each group with the figure that
 * did not earn a place in the row set under it.
 */
function Figures({ stats }: { stats: StatsResponse }) {
  const { literature, scope } = stats;

  return (
    <section className="relative bg-[var(--color-charred)] py-24 lg:py-32" aria-labelledby="search-heading">
      <div className="scene-inner">
        <div className="reveal">
          <Chapter number="02">Search the literature</Chapter>
          <h2 id="search-heading" className="scene-heading mt-6 max-w-[22ch]">
            One fixed PubMed search for every herb and drug pair.
          </h2>
        </div>

        <div className="reveal mt-14 flex flex-col gap-10 border-y border-[var(--color-line)] py-10 xl:flex-row xl:gap-0">
          <div data-testid="scope-strip" className="flex flex-col gap-4">
            <dl className="grid grid-cols-2 gap-6 md:flex md:gap-0">
              <Figure label="Ayurvedic herbs" value={scope.herbs} first />
              <Figure label="conventional drugs" value={scope.drugs} />
            </dl>
            <p className="text-[0.9375rem] text-[var(--color-ink-2)]">
              {scope.drug_classes} drug classes · {scope.conditions} conditions
            </p>
          </div>

          <div
            data-testid="pipeline-card"
            className="flex flex-col gap-4 xl:border-l xl:border-[var(--color-line)] xl:pl-8"
          >
            <dl className="grid grid-cols-2 gap-6 md:flex md:gap-0">
              <Figure label="pairs searched" value={literature.pairs_searched} first />
              <Figure label="abstracts read" value={literature.abstracts_harvested} />
              <Figure
                label="documented interactions"
                value={literature.documented_pairs}
                accent
              />
            </dl>
            <p className="text-[0.9375rem] text-[var(--color-ink-2)]">
              {formatCount(literature.candidate_sentences)} candidate sentences
            </p>
          </div>
        </div>

        {/* Kept: without it, the figures read as "the rest of the pairs are fine". */}
        <p className="reveal mt-8 max-w-[70ch] text-[0.9375rem] text-[var(--color-ink-2)]">
          Most searched pairs turned up nothing, which this database records as a search
          with no finding rather than as a result.{" "}
          <Link
            href="/how-it-works"
            className="text-[var(--color-ink)] underline decoration-[var(--color-ink-2)] underline-offset-4 hover:decoration-[var(--color-primary)]"
          >
            How it works
          </Link>
        </p>
      </div>
    </section>
  );
}

function Figure({
  label,
  value,
  first = false,
  accent = false,
}: {
  label: string;
  value: number | null;
  first?: boolean;
  accent?: boolean;
}) {
  return (
    <div
      className={
        first
          ? "flex flex-col-reverse md:pr-8"
          : "flex flex-col-reverse md:border-l md:border-[var(--color-line)] md:px-8"
      }
    >
      <dt className="mt-2 text-[0.9375rem] text-[var(--color-ink-2)]">{label}</dt>
      <dd
        className={
          accent
            ? "text-[clamp(2.25rem,3.6vw,3.25rem)] leading-none font-light text-[var(--color-primary)] tabular-nums"
            : "text-[clamp(2.25rem,3.6vw,3.25rem)] leading-none font-light tabular-nums"
        }
      >
        {value === null ? (
          <span className="text-base text-[var(--color-ink-2)]">{NOT_RECORDED}</span>
        ) : (
          <CountUp value={value} />
        )}
      </dd>
    </div>
  );
}

/* ------------------------------------------------------------------ 03 */

/**
 * What curation means here, with two placeholder rows. The rows name no
 * medicine and no PMID on purpose: they show the two states a sentence can be
 * in, not a record from the database.
 */
function Curation() {
  return (
    <section
      className="relative bg-[var(--color-night)] py-24 lg:py-32"
      aria-labelledby="curation-heading"
    >
      <div className="scene-inner grid gap-14 lg:grid-cols-2 lg:gap-20">
        <div className="reveal">
          <Chapter number="03">Curated by hand</Chapter>
          <h2 id="curation-heading" className="scene-heading mt-6 max-w-[20ch]">
            NLP finds the sentences. A person checks each one.
          </h2>
          <p className="mt-6 text-[var(--color-ink-2)]">
            Nothing unchecked is shown as verified.
          </p>
        </div>

        <ul aria-label="Example rows" className="reveal ruled-list self-end border-y border-[var(--color-line)]">
          <ExampleRow
            badge={
              <Badge className="border-[var(--color-ink)]/40 bg-transparent text-[var(--color-ink)]">
                <UserCheck aria-hidden="true" />
                Verified by a curator
              </Badge>
            }
          />
          <ExampleRow
            badge={
              <Badge className="border-dashed border-[var(--color-ink-2)] bg-transparent text-[var(--color-ink-2)]">
                <ScanSearch aria-hidden="true" />
                Auto-extracted, not yet reviewed
              </Badge>
            }
          />
        </ul>
      </div>
    </section>
  );
}

function ExampleRow({ badge }: { badge: React.ReactNode }) {
  return (
    <li className="flex flex-col gap-3 py-6 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <div>
        <p className="text-[var(--color-ink)]">[Medicine name] with [Herb name]</p>
        <p className="mt-1 font-[family-name:var(--font-mono)] text-[0.9375rem] text-[var(--color-ink-2)]">
          PubMed [PMID]
        </p>
      </div>
      <div className="shrink-0">{badge}</div>
    </li>
  );
}

/* ------------------------------------------------------------------ 04 */

function CheckScene() {
  return (
    <section
      className="relative bg-[linear-gradient(to_bottom,var(--color-night),var(--color-charred))] py-24 lg:py-36"
      aria-labelledby="check-heading"
    >
      <div className="scene-inner">
        <div className="reveal">
          <Chapter number="04">Check a pair</Chapter>
        </div>

        <div className="reveal mx-auto mt-14 flex max-w-2xl flex-col items-center text-center">
          <svg viewBox="0 0 96 96" aria-hidden="true" className="ring-motif size-20">
            <circle cx="48" cy="48" r="40" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <circle cx="48" cy="48" r="7" fill="currentColor" />
          </svg>
          <h2 id="check-heading" className="scene-heading mt-10">
            Pick a herb and a medicine.
          </h2>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
            <Button asChild size="lg">
              <Link href="/check">Check a pair</Link>
            </Button>
            <Button asChild size="lg" variant="secondary">
              <Link href="/ask">Describe a problem</Link>
            </Button>
          </div>
          <p className="mt-12 max-w-[60ch] text-[0.9375rem] text-[var(--color-ink-2)]">
            {FOOTER_DISCLAIMER}
          </p>
        </div>
      </div>
    </section>
  );
}
