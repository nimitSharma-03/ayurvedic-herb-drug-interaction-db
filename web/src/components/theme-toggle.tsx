"use client";

import * as React from "react";
import { Moon, Sun } from "lucide-react";

import { Button } from "@/components/ui/button";

export const THEME_STORAGE_KEY = "hdi-theme";
const THEME_EVENT = "hdi-theme-change";

export type Theme = "light" | "dark";

/**
 * The inline script that applies the stored theme before first paint.
 *
 * It has to run synchronously in <head>, before the browser paints anything, or
 * a reader who chose dark sees a flash of the light page on every navigation.
 * Nothing else can do this job: a React effect runs after the first paint, and
 * a cookie would make every page uncacheable to save the same flash.
 *
 * Light is the default, so an empty or unreadable store leaves the markup
 * alone. Storage can throw in a private window, hence the try.
 */
export const themeScript = `(function(){try{var t=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});if(t==="dark"||t==="light"){document.documentElement.setAttribute("data-theme",t)}}catch(e){}})();`;

/**
 * The theme lives on <html data-theme>, written by that inline script, so the
 * DOM attribute is the source of truth and this component subscribes to it
 * rather than keeping a second copy in React state. That is what makes the
 * server's markup and the first client render agree: on the server the
 * attribute is absent, which reads as light, exactly as the markup renders.
 */
function subscribe(onChange: () => void) {
  window.addEventListener(THEME_EVENT, onChange);
  // Another tab switching theme writes to the same key.
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(THEME_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function getSnapshot(): Theme {
  return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
}

function getServerSnapshot(): Theme {
  return "light";
}

export function useTheme(): [Theme, (next: Theme) => void] {
  const theme = React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setTheme = React.useCallback((next: Theme) => {
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Private windows and blocked site data land here. The page still
      // switches; only the memory of the choice is lost.
    }
    window.dispatchEvent(new Event(THEME_EVENT));
  }, []);

  return [theme, setTheme];
}

export function ThemeToggle() {
  const [theme, setTheme] = useTheme();
  const next: Theme = theme === "dark" ? "light" : "dark";

  return (
    <Button
      type="button"
      variant="quiet"
      size="icon"
      onClick={() => setTheme(next)}
      aria-label={`Switch to the ${next} theme`}
      data-testid="theme-toggle"
      data-theme-state={theme}
    >
      {theme === "dark" ? (
        <Sun className="size-5" aria-hidden="true" />
      ) : (
        <Moon className="size-5" aria-hidden="true" />
      )}
    </Button>
  );
}
