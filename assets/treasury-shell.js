import { initMobileTopbar } from './mobile-topbar.js';
export const THEME_KEY = 'sbs_tc_theme_treasuryhub';
export function initTreasuryShell(onThemeChange) {
  const root = document.documentElement;
  const header = document.querySelector('.topbar');
  const toggle = document.getElementById('theme');
  const syncHeight = () => root.style.setProperty('--topbar-height', `${header.getBoundingClientRect().height}px`);
  syncHeight();
  if (window.ResizeObserver) new ResizeObserver(syncHeight).observe(header);
  window.addEventListener('resize', syncHeight);
  document.fonts?.ready.then(syncHeight);
  initMobileTopbar(header);
  function apply(value, persist = false) {
    const dark = value === 'dark';
    root.dataset.theme = dark ? 'dark' : 'light';
    const label = dark ? 'Tema claro' : 'Tema oscuro';
    toggle.innerHTML = `<i class="fa-solid fa-${dark ? 'sun' : 'moon'}" aria-hidden="true"></i>`;
    toggle.title = label;
    toggle.setAttribute('aria-label', label);
    if (persist) { try { localStorage.setItem(THEME_KEY, root.dataset.theme); } catch {} }
    onThemeChange();
  }
  let initial = 'light';
  try { initial = localStorage.getItem(THEME_KEY) || localStorage.getItem('sbs-theme') || localStorage.getItem('macro:theme') || initial; } catch {}
  apply(initial);
  toggle.onclick = () => apply(root.dataset.theme === 'dark' ? 'light' : 'dark', true);
  window.addEventListener('storage', e => { if (e.key === THEME_KEY) apply(e.newValue); });
}
