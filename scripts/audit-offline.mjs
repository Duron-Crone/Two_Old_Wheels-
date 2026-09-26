#!/usr/bin/env node
/**
 * Teste le fichier unique de dist-offline/ tel qu'un destinataire l'ouvrira :
 * par double-clic, en file://, sans serveur. Aucune requête réseau n'est
 * tolérée, et tout ce qui marche sur le site doit marcher ici.
 */
import puppeteer from 'puppeteer';
import { fileURLToPath } from 'node:url';

const FILE = 'file://' + fileURLToPath(new URL('../dist-offline/two-old-wheels-apercu.html', import.meta.url));
const results = [];
const ok = (c, l) => results.push({ c, l });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });

async function open(width, height) {
  const page = await browser.newPage();
  const errors = [];
  const network = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 140)));
  page.on('pageerror', (e) => errors.push('pageerror: ' + String(e).slice(0, 140)));
  page.on('request', (r) => { if (!/^(file|data|blob):/.test(r.url())) network.push(r.url().slice(0, 80)); });
  await page.setViewport({ width, height });
  await page.goto(FILE, { waitUntil: 'load' });
  await wait(500);
  return { page, errors, network };
}
const title = (p) => p.title();
const h1 = (p) => p.$eval('main h1', (e) => e.textContent.trim());
const scrollAll = (p) => p.evaluate(async () => {
  document.documentElement.style.scrollBehavior = 'auto';
  for (let y = 0; y < document.documentElement.scrollHeight; y += 400) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 90)); }
  window.scrollTo(0, 0);
});
const clickVisible = (p, sel) => p.evaluate((s) => {
  const el = [...document.querySelectorAll(s)].find((e) => e.getBoundingClientRect().width > 0);
  el.click();
  return !!el;
}, sel);

// ---------------- bureau ----------------
{
  const { page, errors, network } = await open(1280, 860);
  ok((await h1(page)).includes('motos anciennes'), `accueil affiché : « ${await h1(page)} »`);
  await scrollAll(page);
  await wait(800);
  const imgs = await page.evaluate(() => [...document.images].map((i) => i.naturalWidth > 0));
  ok(imgs.length > 10 && imgs.every(Boolean), `images : ${imgs.filter(Boolean).length}/${imgs.length} affichées`);
  const rev = await page.evaluate(() => { const r = [...document.querySelectorAll('.reveal')]; return [r.filter((e) => e.classList.contains('is-in')).length, r.length]; });
  ok(rev[0] === rev[1] && rev[1] > 5, `blocs à apparition révélés : ${rev[0]}/${rev[1]}`);
  // Les polices ne se chargent qu'à la demande : on vérifie que celles que la
  // page utilise sont chargées depuis le fichier, et qu'aucune n'a échoué.
  const fonts = await page.evaluate(async () => {
    await document.fonts.ready;
    const list = [...document.fonts];
    return {
      loaded: [...new Set(list.filter((f) => f.status === 'loaded').map((f) => f.family))],
      failed: list.filter((f) => f.status === 'error').length,
    };
  });
  ok(['Oswald', 'Work Sans', 'IBM Plex Mono'].every((f) => fonts.loaded.includes(f)) && fonts.failed === 0,
     `polices intégrées chargées : ${fonts.loaded.join(', ')}`);

  await clickVisible(page, 'nav[aria-label="Navigation principale"] a[href="#/reparation"]');
  await wait(700);
  ok((await title(page)).startsWith('Réparation'), `navigation vers Réparation : « ${await title(page)} »`);
  const active = await page.$eval('nav[aria-label="Navigation principale"] a[aria-current="page"]', (e) => e.getAttribute('href')).catch(() => null);
  ok(active === '#/reparation', `onglet actif dans le menu : ${active}`);
  const moto = await page.$eval('#moto', (e) => e.className);
  ok(moto.includes('roule'), 'la moto traverse après la navigation');

  await page.goBack();
  await wait(700);
  ok((await h1(page)).includes('motos anciennes'), 'bouton Retour du navigateur : retour à l accueil');

  await clickVisible(page, 'a[href="#/reparation/carrosserie"]');
  await wait(1200);
  const anchorTop = await page.$eval('#carrosserie', (e) => Math.round(e.getBoundingClientRect().top));
  ok(anchorTop >= 0 && anchorTop < 200, `carte Carrosserie : page Réparation ouverte à la bonne section (${anchorTop}px du haut)`);

  await page.evaluate(() => { location.hash = '#/galerie-photos'; });
  await wait(700);
  await clickVisible(page, '[data-zoom]');
  await wait(300);
  ok(await page.$eval('#lightbox', (d) => d.open), 'galerie : une photo s ouvre en grand');
  const caption = await page.$eval('#lightbox-caption', (e) => e.textContent.trim());
  ok(caption.length > 5, `galerie : description affichée (« ${caption} »)`);
  await page.keyboard.press('Escape');
  await wait(300);
  ok(!(await page.$eval('#lightbox', (d) => d.open)), 'galerie : on en sort avec Échap');
  await clickVisible(page, '[data-zoom]');
  await wait(300);
  await page.mouse.click(640, 850);
  await wait(300);
  ok(!(await page.$eval('#lightbox', (d) => d.open)), 'galerie : on en sort en cliquant à côté');

  await page.evaluate(() => { location.hash = '#/contact'; });
  await wait(700);
  const ctaHidden = await page.$$eval('[data-astro-transition-persist^="cta-appel"]', (els) => els.every((e) => getComputedStyle(e).display === 'none'));
  ok(ctaHidden, 'contact : le bouton d appel flottant est masqué, comme sur le site');

  await page.evaluate(() => { location.hash = '#/mentions-legales'; });
  await wait(700);
  const legal = await page.$eval('main', (e) => e.textContent);
  ok(legal.includes('900 094 590 00016') && legal.includes('OVH SAS'), 'mentions légales complètes');

  ok(network.length === 0, `aucune requête réseau${network.length ? ' -> ' + network[0] : ''}`);
  ok(errors.length === 0, `aucune erreur console${errors.length ? ' -> ' + errors[0] : ''}`);
  await page.close();
}

// ---------------- mobile ----------------
{
  const { page, errors } = await open(390, 844);
  await page.click('#menu-toggle');
  await wait(200);
  ok(await page.$eval('#mobile-menu', (m) => !m.classList.contains('hidden')), 'mobile : le menu s ouvre');
  await page.evaluate(() => [...document.querySelectorAll('#mobile-menu a')].find((a) => a.getAttribute('href') === '#/vente').click());
  await wait(800);
  ok((await title(page)).startsWith('Vente'), `mobile : navigation depuis le menu (« ${await title(page)} »)`);
  ok(await page.$eval('#mobile-menu', (m) => m.classList.contains('hidden')), 'mobile : le menu se referme après navigation');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok(overflow <= 1, `mobile : pas de défilement horizontal (${overflow}px)`);
  ok(errors.length === 0, `mobile : aucune erreur console${errors.length ? ' -> ' + errors[0] : ''}`);
  await page.close();
}

await browser.close();
for (const r of results) console.log(`  ${r.c ? 'ok   ' : 'ÉCHEC'} ${r.l}`);
const failed = results.filter((r) => !r.c).length;
console.log(`\n${results.length - failed}/${results.length} réussis`);
process.exit(failed ? 1 : 0);
