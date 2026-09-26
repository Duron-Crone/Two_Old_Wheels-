#!/usr/bin/env node
/**
 * Mesures de chargement, page par page, sur un mobile simulé : réseau 4G lente
 * (1,6 Mb/s, 150 ms de latence) et processeur bridé quatre fois. Les en-têtes
 * et la compression sont ceux de production, puisque le serveur applique
 * public/.htaccess.
 *
 * Sont mesurés : poids et nombre de requêtes par type, plus grand élément
 * affiché (LCP) et son fichier, images servies loin de leur taille d'affichage,
 * texte non compressé.
 *
 * Prérequis : un serveur sur le port 4321, par exemple
 *   node scripts/apache.mjs -- node scripts/audit-perf.mjs
 *
 * Sort en échec au-delà de 500 ko par page ou de 2500 ms de LCP : ce sont les
 * seuils au-delà desquels un visiteur en 4G sent la différence.
 */
import puppeteer from 'puppeteer';

const BASE = process.env.BASE || 'http://localhost:4321';
const PAGES = ['/', '/reparation', '/vente', '/galerie-photos', '/contact', '/mentions-legales'];

const navigateur = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--lang=fr-FR'],
});

const ko = (o) => (o / 1024).toFixed(1).padStart(7) + ' ko';
const lignes = [];
const remarques = [];

for (const chemin of PAGES) {
  const page = await navigateur.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true, deviceScaleFactor: 2 });

  const session = await page.createCDPSession();
  await session.send('Network.enable');
  // Mobile 4G lente, processeur bridé 4x : ce que vit un client sur la route.
  await session.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 150,
    downloadThroughput: (1.6 * 1024 * 1024) / 8,
    uploadThroughput: (750 * 1024) / 8,
  });
  await session.send('Emulation.setCPUThrottlingRate', { rate: 4 });

  const requetes = [];
  page.on('response', async (r) => {
    const type = r.request().resourceType();
    let taille = 0;
    try {
      taille = Number((await r.headers())['content-length'] || 0);
    } catch {
      /* ignore */
    }
    requetes.push({
      url: r.url().replace(BASE, ''),
      type,
      statut: r.status(),
      taille,
      encodage: (await r.headers())['content-encoding'] || '',
      cache: (await r.headers())['cache-control'] || '',
    });
  });

  await page.evaluateOnNewDocument(() => {
    window.__lcp = null;
    new PerformanceObserver((l) => {
      const e = l.getEntries().at(-1);
      window.__lcp = { temps: e.startTime, element: e.element ? e.element.tagName + '.' + (e.element.className || '').toString().split(' ')[0] : '?', url: e.url || '' };
    }).observe({ type: 'largest-contentful-paint', buffered: true });
  });

  await page.goto(BASE + chemin, { waitUntil: 'networkidle0', timeout: 120000 });
  await new Promise((r) => setTimeout(r, 500));

  const lcp = await page.evaluate(() => window.__lcp);
  const images = await page.evaluate(() =>
    [...document.images].map((i) => ({
      src: i.currentSrc.split('/').pop(),
      naturelle: `${i.naturalWidth}x${i.naturalHeight}`,
      affichee: `${Math.round(i.getBoundingClientRect().width)}x${Math.round(i.getBoundingClientRect().height)}`,
      largeurAffichee: Math.round(i.getBoundingClientRect().width),
      largeurNaturelle: i.naturalWidth,
      lazy: i.loading,
      srcset: i.srcset || '',
      dpr: window.devicePixelRatio,
    })),
  );
  const perf = await page.evaluate(() => {
    const n = performance.getEntriesByType('navigation')[0];
    return { domContentLoaded: n.domContentLoadedEventEnd, charge: n.loadEventEnd, reponse: n.responseEnd };
  });

  const parType = {};
  let total = 0;
  for (const r of requetes) {
    parType[r.type] = (parType[r.type] || 0) + r.taille;
    total += r.taille;
  }
  lignes.push({
    chemin,
    requetes: requetes.length,
    total,
    document: parType.document || 0,
    css: parType.stylesheet || 0,
    js: parType.script || 0,
    images: parType.image || 0,
    polices: parType.font || 0,
    lcp: lcp ? Math.round(lcp.temps) : null,
    lcpElement: lcp ? (lcp.url ? lcp.url.split('/').pop() : lcp.element) : '?',
    charge: Math.round(perf.charge),
  });

  // Images servies beaucoup plus grandes que leur affichage (à 2x près).
  for (const i of images) {
    if (i.largeurAffichee > 0 && i.largeurNaturelle > i.largeurAffichee * i.dpr * 1.35) {
      remarques.push(`${chemin} : ${i.src} servie en ${i.naturelle} pour un affichage ${i.affichee} (écran 2x)`);
    }
    // Sans variante plus grande dans le srcset, l'image sera floue sur un écran 2x.
    if (i.largeurAffichee > 0 && i.largeurNaturelle > 0 && !i.srcset && i.largeurNaturelle < i.largeurAffichee * 1.05) {
      remarques.push(`${chemin} : ${i.src} servie en ${i.naturelle} pour un affichage ${i.affichee}, pas de marge pour un écran 2x`);
    }
  }
  // Compression manquante sur du texte.
  for (const r of requetes) {
    if (['document', 'stylesheet', 'script'].includes(r.type) && !r.encodage && r.taille > 2048) {
      remarques.push(`${chemin} : ${r.url} (${(r.taille / 1024).toFixed(1)} ko) servi sans compression`);
    }
  }
  await page.close();
}

console.log('\npage                 requêtes    poids    html     css      js   images  polices    LCP     charge');
for (const l of lignes) {
  console.log(
    l.chemin.padEnd(20),
    String(l.requetes).padStart(5),
    ko(l.total),
    ko(l.document),
    ko(l.css),
    ko(l.js),
    ko(l.images),
    ko(l.polices),
    String(l.lcp).padStart(5) + ' ms',
    String(l.charge).padStart(6) + ' ms',
    l.lcpElement,
  );
}
console.log('\nRemarques :');
for (const r of [...new Set(remarques)]) console.log('  -', r);
if (!remarques.length) console.log('  aucune');
await navigateur.close();

const lourdes = lignes.filter((l) => l.total > 500 * 1024);
const lentes = lignes.filter((l) => l.lcp > 2500);
for (const l of lourdes) console.log(`ÉCHEC ${l.chemin} : ${(l.total / 1024).toFixed(0)} ko (seuil 500 ko)`);
for (const l of lentes) console.log(`ÉCHEC ${l.chemin} : LCP ${l.lcp} ms (seuil 2500 ms)`);
process.exit(lourdes.length + lentes.length ? 1 : 0);
