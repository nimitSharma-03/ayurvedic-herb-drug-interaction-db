/**
 * Theatre Studio, in development only.
 *
 * Studio is the panel the entrance was authored in: it draws a timeline over
 * the running page so the keyframes can be dragged against the real scene
 * rather than guessed at. The shipped app must not carry it -- it is a large
 * editor, and nothing in production has anything to author -- so it is a dev
 * dependency and it is loaded from inside a branch that the bundler folds away
 * at build time.
 *
 * That shape matters. `process.env.NODE_ENV` is replaced with a literal during
 * the build, so in a production build this becomes `if (false) { ... }` and the
 * import inside is never recorded as a dependency: no chunk for it, and no
 * resolution of a package that is not installed on a production machine. An
 * early `return` above the import would not do the same thing, because the
 * import would still be parsed and bundled.
 *
 * After scrubbing in Studio, use its export button and put the downloaded state
 * over hero-sheet.json, or edit scripts/build-hero-sheet.mjs and re-run it. The
 * running app only ever reads the checked-in file.
 */
export async function initHeroStudio(): Promise<void> {
  if (process.env.NODE_ENV === "development") {
    const studio = (await import("@theatre/studio")).default;
    studio.initialize();
  }
}
