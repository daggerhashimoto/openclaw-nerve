/*
 * Nerve theme boot. Runs in <head> before the stylesheet paints, so a reload or the
 * login page never flashes another theme's ground first. It only marks the root;
 * the app (src/lib/themes.ts) applies the full theme and owns storage writes.
 * Keep the names, schemes, worlds and grounds in step with themes.ts
 * (src/lib/themeBoot.test.ts checks them).
 */
(function () {
  var themes = {
    'nerve-dark': ['dark', 'night-light', '#06080E'],
    'nerve-light': ['light', 'night-light', '#F3F5F9'],
    'workbench-night': ['dark', 'workbench', '#111318'],
    'workbench-paper': ['light', 'workbench', '#F4F4F2'],
  };
  var fallback = 'workbench-night';
  var name = null;
  var moved = false;
  try {
    name = localStorage.getItem('oc-theme');
    moved = localStorage.getItem('oc-theme-default') === 'workbench-night-2026-11';
  } catch (e) {
    name = null;
  }
  if (name === 'light' || name === 'classic-light') name = 'nerve-light';
  // A stored Night moves to Workbench Night once, when it became the default
  if (name === 'nerve-dark' && !moved) name = fallback;
  var theme = themes[name] || themes[fallback];
  var root = document.documentElement;
  root.setAttribute('data-theme', theme[0]);
  root.setAttribute('data-world', theme[1]);
  root.style.colorScheme = theme[0];
  root.style.setProperty('--color-background', theme[2]);
  root.style.setProperty('--background', theme[2]);
})();
