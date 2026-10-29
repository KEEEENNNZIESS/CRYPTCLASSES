'use strict';
(() => {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const field = document.getElementById('emberField');
  if (!field || reduceMotion) return;

  // Ambient embers are generated locally; no remote assets, trackers, or audio.
  const count = Math.min(46, Math.max(22, Math.floor(window.innerWidth / 30)));
  const fragment = document.createDocumentFragment();
  for (let i = 0; i < count; i += 1) {
    const ember = document.createElement('span');
    ember.className = 'ember';
    ember.style.setProperty('--x', `${Math.random() * 100}%`);
    ember.style.setProperty('--delay', `${Math.random() * -22}s`);
    ember.style.setProperty('--duration', `${11 + Math.random() * 15}s`);
    ember.style.setProperty('--drift', `${-70 + Math.random() * 140}px`);
    ember.style.setProperty('--size', `${1 + Math.random() * 3.2}px`);
    ember.style.setProperty('--alpha', `${0.2 + Math.random() * 0.65}`);
    fragment.appendChild(ember);
  }
  field.appendChild(fragment);

  // Navigation-safe mode: no MutationObserver or pointer-follow effects.
  // These decorative effects are intentionally omitted to keep menu changes responsive.

})();
