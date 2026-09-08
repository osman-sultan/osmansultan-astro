/**
 * Theme is a `.dark` class on <html> (see global.css). The initial class is
 * applied before first paint by the inline script in theme-script.astro; this
 * helper is the single place that flips it and persists the choice.
 */
export const THEME_STORAGE_KEY = "theme"

export function toggleTheme() {
  const dark = document.documentElement.classList.toggle("dark")
  localStorage.setItem(THEME_STORAGE_KEY, dark ? "dark" : "light")
  return dark
}
