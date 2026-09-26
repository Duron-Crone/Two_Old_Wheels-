#!/usr/bin/env node
/**
 * Fabrique un fichier HTML unique, autonome, à envoyer par mail et à ouvrir
 * d'un double-clic. Aucun serveur, aucun dossier, aucune ressource externe.
 *
 * Pourquoi un générateur dédié : le site tel qu'il est construit ne fonctionne
 * pas ouvert depuis le disque. Le navigateur y refuse les modules chargés par
 * fichier, dont le routeur d'Astro ; sans lui l'événement `astro:page-load`
 * n'est jamais émis, et tous les blocs à apparition restent invisibles.
 *
 * Ce que fait ce fichier unique :
 *   - les six pages y sont stockées dans des <template>, et un petit routeur
 *     les échange dans <main> selon l'ancre (#/contact, #/reparation/moteur…),
 *     exactement comme le routeur d'Astro échange le DOM ;
 *   - il émet lui-même `astro:before-preparation` et `astro:page-load` : les
 *     scripts du site (menu, apparitions, visionneuse, moto) tournent tels quels ;
 *   - les transitions de page passent par `document.startViewTransition` quand
 *     le navigateur le permet, les photos partagées morphent donc aussi ;
 *   - CSS, polices et images sont intégrés ; chaque image n'est stockée qu'une
 *     fois, dans sa plus grande variante, et posée par script là où elle sert.
 *
 * Usage : npm run build && node scripts/build-offline.mjs
 */
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(ROOT, 'dist');
const OUT_DIR = join(ROOT, 'dist-offline');
const OUT = join(OUT_DIR, 'two-old-wheels-apercu.html');

const PAGES = [
  { route: '', file: 'index.html' },
  { route: 'reparation', file: 'reparation.html' },
  { route: 'vente', file: 'vente.html' },
  { route: 'galerie-photos', file: 'galerie-photos.html' },
  { route: 'contact', file: 'contact.html' },
  { route: 'mentions-legales', file: 'mentions-legales.html' },
];
const ROUTES = new Set(PAGES.map((p) => p.route));

const MIME = { webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg', svg: 'image/svg+xml', woff2: 'font/woff2' };
const dataUri = async (path) => {
  const ext = path.split('.').pop();
  return `data:${MIME[ext]};base64,${(await readFile(path)).toString('base64')}`;
};
const between = (s, start, end) => {
  const i = s.indexOf(start);
  const j = s.indexOf(end, i + start.length);
  if (i === -1 || j === -1) throw new Error(`bloc introuvable : ${start}`);
  return s.slice(i + start.length, j);
};
const escapeAttr = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

// --- lecture des pages ---
const pages = [];
for (const p of PAGES) {
  const html = await readFile(join(DIST, p.file), 'utf8');
  const title = html.match(/<title>(.*?)<\/title>/s)[1];
  pages.push({ ...p, html, title, main: between(html, '<main id="contenu">', '</main>'), hideCta: !html.includes('cta-appel-mobile') });
}

const home = pages[0].html;
const bodyOpen = home.match(/<body[^>]*>/)[0];
let beforeMain = home.slice(home.indexOf(bodyOpen) + bodyOpen.length, home.indexOf('<main id="contenu">'));
let afterMain = home.slice(home.indexOf('</main>') + '</main>'.length, home.lastIndexOf('</body>'));

// --- scripts et styles inline du site, dédoublonnés ---
const scripts = new Set();
const styles = new Set();
for (const { html } of pages) {
  for (const m of html.matchAll(/<script type="module">(.*?)<\/script>/gs)) scripts.add(m[1]);
  for (const m of html.matchAll(/<style[^>]*>(.*?)<\/style>/gs)) styles.add(m[1]);
}
afterMain = afterMain.replace(/<script\b[^>]*>.*?<\/script>/gs, '');
beforeMain = beforeMain.replace(/<script\b[^>]*>.*?<\/script>/gs, '');

// --- feuille de style, polices intégrées ---
const cssHref = home.match(/<link rel="stylesheet" href="(\/_astro\/[^"]+\.css)"/)[1];
let css = await readFile(join(DIST, cssHref), 'utf8');
// Seul le woff2 est gardé : tous les navigateurs actuels le lisent.
css = css.replace(/,\s*url\(\/_astro\/[^)]+\.woff\)\s*format\("woff"\)/g, '');
for (const m of [...css.matchAll(/url\((\/_astro\/[^)]+\.woff2)\)/g)]) {
  css = css.replace(m[0], `url(${await dataUri(join(DIST, m[1]))})`);
}
if (/url\(\/_astro\//.test(css)) throw new Error('une ressource du CSS n est pas intégrée');

// --- réécritures communes à tous les fragments ---
const images = new Map(); // clé -> { path, size }
async function rewrite(fragment) {
  // Liens internes : /contact -> #/contact, /reparation#moteur -> #/reparation/moteur
  fragment = fragment.replace(/href="\/([a-z-]*)(?:#([a-z-]+))?"/g, (whole, route, anchor) =>
    ROUTES.has(route) ? `href="#/${route}${anchor ? '/' + anchor : ''}"` : whole,
  );

  // Déclencheurs de zoom : la visionneuse intercepte le clic, le lien vers le
  // fichier image n'a plus de cible dans un document unique.
  fragment = fragment.replace(/<a\b[^>]*\bdata-zoom\b[^>]*>/g, (tag) => tag.replace(/href="[^"]*"/, 'href="#zoom"'));

  // Images : une clé par photo source, la plus grande variante retenue.
  const tags = [...fragment.matchAll(/<img\b[^>]*>/g)].map((m) => m[0]);
  for (const tag of tags) {
    const paths = new Set();
    const src = tag.match(/\ssrc="([^"]+)"/)?.[1];
    if (src) paths.add(src);
    for (const part of (tag.match(/\ssrcset="([^"]+)"/)?.[1] ?? '').split(',')) {
      const u = part.trim().split(/\s+/)[0];
      if (u) paths.add(u);
    }
    const key = basename([...paths][0]).split('.')[0];
    for (const p of paths) {
      const size = (await stat(join(DIST, p))).size;
      if (!images.has(key) || images.get(key).size < size) images.set(key, { path: p, size });
    }
    const clean = tag
      .replace(/\s(src|srcset|sizes|loading|fetchpriority)="[^"]*"/g, '')
      .replace(/^<img/, `<img data-img="${key}"`);
    fragment = fragment.replace(tag, clean);
  }
  return fragment;
}

beforeMain = await rewrite(beforeMain);
afterMain = await rewrite(afterMain);
const templates = [];
for (const p of pages) {
  templates.push(
    `<template data-route="${p.route}" data-title="${escapeAttr(p.title)}" data-hide-cta="${p.hideCta ? 1 : 0}">${await rewrite(p.main)}</template>`,
  );
}

const imageMap = {};
for (const [key, { path }] of images) imageMap[key] = await dataUri(join(DIST, path));
const favicon = await dataUri(join(DIST, 'favicon.svg'));

const router = `
(function () {
  var IMAGES = ${JSON.stringify(imageMap)};
  var main = document.getElementById('contenu');
  var templates = {};
  document.querySelectorAll('template[data-route]').forEach(function (t) { templates[t.dataset.route] = t; });

  function fillImages(root) {
    root.querySelectorAll('img[data-img]').forEach(function (img) {
      if (!img.getAttribute('src') && IMAGES[img.dataset.img]) img.src = IMAGES[img.dataset.img];
    });
  }

  // Routes : ancre vide (retour à l'adresse d'origine, bouton Précédent),
  // #/page ou #/page/section. Les autres ancres gardent leur rôle : le lien
  // d'évitement (#contenu) et les zooms (#zoom).
  function parse() {
    var h = location.hash;
    if (h === '' || h === '#') return { route: '', anchor: '' };
    if (h.indexOf('#/') !== 0) return null;
    var parts = h.slice(2).split('/');
    var route = templates.hasOwnProperty(parts[0]) ? parts[0] : '';
    return { route: route, anchor: parts[1] || '' };
  }

  function syncNav(route) {
    var target = '#/' + route;
    document.querySelectorAll('[data-nav-link]').forEach(function (link) {
      var active = link.getAttribute('href') === target;
      link.classList.toggle('text-rust-500', active);
      link.classList.toggle('text-ink-700', !active);
      if (active) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
    });
  }

  function render(target, navigation) {
    var tpl = templates[target.route];
    var hideCta = tpl.dataset.hideCta === '1';

    function swap() {
      main.replaceChildren(tpl.content.cloneNode(true));
      fillImages(main);
      document.title = tpl.dataset.title;
      document.querySelectorAll('[data-astro-transition-persist^="cta-appel"]').forEach(function (el) {
        el.classList.toggle('hors-page', hideCta);
      });
      document.body.classList.toggle('pb-16', !hideCta);
      if (target.anchor) {
        var el = document.getElementById(target.anchor);
        if (el) el.scrollIntoView();
      } else if (navigation) {
        window.scrollTo(0, 0);
      }
      document.dispatchEvent(new Event('astro:page-load'));
      syncNav(target.route);
    }

    if (navigation) document.dispatchEvent(new Event('astro:before-preparation'));
    var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (navigation && document.startViewTransition && !reduced) {
      document.startViewTransition(swap);
    } else {
      swap();
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    fillImages(document.body);
    render(parse() || { route: '', anchor: '' }, false);
  });

  window.addEventListener('hashchange', function () {
    var target = parse();
    if (target) render(target, true);
  });
})();`;

const out = `<!doctype html>
<html lang="fr" class="scroll-smooth">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex, nofollow">
<title>${pages[0].title}</title>
<link rel="icon" type="image/svg+xml" href="${favicon}">
<style>${css}</style>
${[...styles].map((s) => `<style>${s}</style>`).join('\n')}
<style>.hors-page{display:none!important}</style>
</head>
${bodyOpen}
${beforeMain}
<main id="contenu"><noscript><section class="container mx-auto px-4 py-24 max-w-xl text-center"><p class="font-display text-3xl text-ink-900 mb-4">Ouvrez ce fichier dans votre navigateur</p><p class="text-ink-700">L'aperçu de votre messagerie ne peut pas afficher ce site. Enregistrez la pièce jointe, puis ouvrez-la avec Chrome, Firefox, Safari ou Edge.</p></section></noscript></main>
${afterMain}
${templates.join('\n')}
${[...scripts].map((s) => `<script type="module">${s}</script>`).join('\n')}
<script>${router}</script>
</body>
</html>
`;

await mkdir(OUT_DIR, { recursive: true });
await writeFile(OUT, out);

const leftovers = out.match(/(?:src|href)="\/(?!\/)[^"#]*"/g);
if (leftovers) throw new Error('chemins absolus restants : ' + leftovers.slice(0, 3).join(', '));
// Le fichier est destiné à être envoyé tel quel : rien ne doit y trahir l'outil
// qui l'a produit.
const MENTIONS_INTERDITES = ['artifact', 'assistant', 'intelligence artificielle', 'généré par'];
const trouvee = MENTIONS_INTERDITES.find((mot) => new RegExp(mot, 'i').test(out));
if (trouvee) throw new Error(`mention indésirable dans le fichier : ${trouvee}`);

console.log(`Fichier unique écrit : ${OUT}`);
console.log(`  ${(out.length / 1024 / 1024).toFixed(2)} Mo, ${pages.length} pages, ${images.size} photos, ${scripts.size} scripts`);
