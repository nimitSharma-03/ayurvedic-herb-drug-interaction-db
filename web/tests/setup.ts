import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
});

/**
 * Two browser APIs jsdom does not implement, stubbed so the components that use
 * them can be rendered and their output scanned.
 *
 * Both are presentation only: the count-up animation and the measured
 * connector lines. Stubbing them changes nothing about what text a component
 * renders, which is what the honesty scans read.
 */
if (!("IntersectionObserver" in globalThis)) {
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
      root = null;
      rootMargin = "";
      thresholds: number[] = [];
    },
  );
}

if (!("ResizeObserver" in globalThis)) {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
}
