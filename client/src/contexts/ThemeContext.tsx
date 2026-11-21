import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

type Theme = "light" | "dark";

/**
 * How much larger the interface is drawn.
 *
 * Applied to `<html>` as `data-font-scale`, which the stylesheet turns into a
 * root font size (100% / 112.5% / 125%). Everything is sized in rem or in
 * Tailwind's spacing, so one root size enlarges the whole interface without
 * touching a component.
 */
export type FontScale = 1 | 1.125 | 1.25;

/** The accessibility settings, and where they are kept. */
export interface AccessibilitySettings {
  fontScale: FontScale;
  /** A higher-contrast palette, for people who cannot read the soft one. */
  contrast: boolean;
  /**
   * Stop animations and transitions, in the app as well as the system.
   *
   * The operating system setting is respected already (`MotionConfig
   * reducedMotion="user"` and the stylesheet's `prefers-reduced-motion`
   * rules); this is the switch for somebody who wants it only in here.
   */
  reduceMotion: boolean;
}

const ACCESSIBILITY_KEY = "mirrai-a11y";

const DEFAULT_ACCESSIBILITY: AccessibilitySettings = {
  fontScale: 1,
  contrast: false,
  reduceMotion: false,
};

/** The three font sizes a person can pick, in the order they are offered. */
export const FONT_SCALES: readonly FontScale[] = [1, 1.125, 1.25];

/**
 * The stored accessibility settings, validated.
 *
 * The storage can hold anything — an old version's shape, a hand edit — and
 * the state it feeds ends up in a `data-` attribute, so each field is checked
 * against its allowed values instead of trusted.
 */
function readStoredAccessibility(): AccessibilitySettings {
  if (typeof window === "undefined") return DEFAULT_ACCESSIBILITY;
  try {
    const raw = localStorage.getItem(ACCESSIBILITY_KEY);
    if (!raw) return DEFAULT_ACCESSIBILITY;
    const parsed = JSON.parse(raw) as Partial<AccessibilitySettings> | null;
    if (!parsed || typeof parsed !== "object") return DEFAULT_ACCESSIBILITY;
    const fontScale = FONT_SCALES.includes(parsed.fontScale as FontScale)
      ? (parsed.fontScale as FontScale)
      : DEFAULT_ACCESSIBILITY.fontScale;
    return {
      fontScale,
      contrast: parsed.contrast === true,
      reduceMotion: parsed.reduceMotion === true,
    };
  } catch {
    return DEFAULT_ACCESSIBILITY;
  }
}

/**
 * The browser-chrome colour for each theme.
 *
 * The install manifest can only carry one `theme_color`, but the address bar
 * on an installed app follows the `<meta name="theme-color">` tag — so the
 * two themes each get their own value there.
 */
const THEME_COLORS: Record<Theme, string> = {
  dark: "#6E5AC8",
  light: "#f3eee3",
};

interface ThemeContextType {
  theme: Theme;
  toggleTheme?: () => void;
  switchable: boolean;
  /** The interface's font size, contrast and motion settings. */
  fontScale: FontScale;
  contrast: boolean;
  reduceMotion: boolean;
  setFontScale: (value: FontScale) => void;
  setContrast: (value: boolean) => void;
  setReduceMotion: (value: boolean) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

interface ThemeProviderProps {
  children: React.ReactNode;
  defaultTheme?: Theme;
  switchable?: boolean;
}

/**
 * The stored theme, if there is one and it is one of the two.
 *
 * The storage can refuse — private mode, cookies disabled, a full
 * quota — and it used to be read without a guard, in the state
 * initialiser of the outermost provider: the whole app failed to mount.
 *
 * And any rubbish in the storage was taken as the theme, so the browser
 * chrome was told its colour was "undefined".
 */
function readStoredTheme(): Theme | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = localStorage.getItem("theme");
    return stored === "dark" || stored === "light" ? stored : null;
  } catch {
    return null;
  }
}

export function ThemeProvider({
  children,
  defaultTheme = "light",
  switchable = false,
}: ThemeProviderProps) {
  /**
   * The accessibility settings.
   *
   * They are read on mount and written whenever they change, and the
   * attributes they produce are applied by the effect below — so a reload
   * keeps them, and the interface is already at the stored size before the
   * first paint of any component that reads them.
   */
  const [accessibility, setAccessibility] =
    useState<AccessibilitySettings>(readStoredAccessibility);

  const [theme, setTheme] = useState<Theme>(() => {
    if (!switchable) return defaultTheme;
    const stored = readStoredTheme();
    if (stored) return stored;
    // The theme follows the operating system.
    //
    // It did not: the provider was mounted with a hard-coded "light",
    // and nothing ever asked the system what it wanted. So a user whose
    // machine is in dark mode got a bright cream app on the first run
    // and had to find the theme button by hand — while the stylesheet's
    // own header claimed the themes follow the system.
    if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
      try {
        if (window.matchMedia("(prefers-color-scheme: dark)").matches) return "dark";
      } catch {
        // The system will not say; the default stands.
      }
    }
    return defaultTheme;
  });

  /**
   * Applies the accessibility settings to `<html>`.
   *
   * The stylesheet reads them: the font size from `data-font-scale`, the
   * higher-contrast palette from `data-contrast="high"`, and the motion rules
   * from `data-reduce-motion="true"`. Attributes that mean "off" are removed
   * rather than set to "false", so the default document has neither attribute
   * and the existing look is untouched.
   */
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-font-scale", String(accessibility.fontScale));
    if (accessibility.contrast) {
      root.setAttribute("data-contrast", "high");
    } else {
      root.removeAttribute("data-contrast");
    }
    if (accessibility.reduceMotion) {
      root.setAttribute("data-reduce-motion", "true");
    } else {
      root.removeAttribute("data-reduce-motion");
    }
    try {
      localStorage.setItem(ACCESSIBILITY_KEY, JSON.stringify(accessibility));
    } catch {
      // A browser that will not keep the choice is not a problem: the
      // settings still apply for this session.
    }
  }, [accessibility]);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }

    // Keep the browser chrome in step with the theme.
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.setAttribute("content", THEME_COLORS[theme]);
    }

    if (switchable) {
      try {
        localStorage.setItem("theme", theme);
      } catch {
        // A browser that will not keep the choice is not a problem: the
        // theme still changes for this session.
      }
    }
  }, [theme, switchable]);

  /**
   * The toggle.
   *
   * It used to be a new function on every render — so a consumer that
   * had it in a dependency list saw it change every time, and did its
   * work again for nothing.
   */
  const toggleTheme = useMemo(
    () =>
      switchable
        ? () => {
            setTheme((prev) => (prev === "light" ? "dark" : "light"));
          }
        : undefined,
    [switchable],
  );

  /**
   * The value.
   *
   * It used to be a new object on every render — so every consumer of
   * `useTheme()` re-rendered whenever the provider did, whatever had
   * changed. The toast bar is one of them, and it is at the top of the
   * app.
   */
  const setFontScale = useCallback((fontScale: FontScale) => {
    setAccessibility((previous) => ({ ...previous, fontScale }));
  }, []);
  const setContrast = useCallback((contrast: boolean) => {
    setAccessibility((previous) => ({ ...previous, contrast }));
  }, []);
  const setReduceMotion = useCallback((reduceMotion: boolean) => {
    setAccessibility((previous) => ({ ...previous, reduceMotion }));
  }, []);

  const value = useMemo(
    () => ({
      theme,
      toggleTheme,
      switchable,
      fontScale: accessibility.fontScale,
      contrast: accessibility.contrast,
      reduceMotion: accessibility.reduceMotion,
      setFontScale,
      setContrast,
      setReduceMotion,
    }),
    [
      theme,
      toggleTheme,
      switchable,
      accessibility,
      setFontScale,
      setContrast,
      setReduceMotion,
    ],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return context;
}
