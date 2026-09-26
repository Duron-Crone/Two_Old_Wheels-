#!/usr/bin/env node
/**
 * Test d'interaction de la visionneuse, dans un vrai navigateur.
 *
 * Le point critique : on doit toujours pouvoir sortir d'une photo ouverte, et
 * par plusieurs chemins. Une première version testait `event.target === dialog`
 * pour fermer au clic à côté ; comme le conteneur intérieur couvre toute la
 * surface du dialogue, la cible n'était jamais le `<dialog>` et la fermeture
 * ne se déclenchait jamais. Sur mobile, sans touche Échap et avec un bouton
 * Fermer de 30 px, on pouvait rester coincé. Ce test l'aurait attrapé.
 *
 * Prérequis : `npm run serve:prod` dans un autre terminal.
 */
import puppeteer from 'puppeteer';
const B = process.env.BASE || 'http://localhost:4321';
const results = [];
const ok = (c, l) => results.push({ ok: c, l });

const browser = await puppeteer.launch({ headless:'new', args:['--no-sandbox','--disable-dev-shm-usage'] });

for (const vp of [{w:390,h:844,n:'mobile 390'}, {w:1440,h:900,n:'bureau 1440'}]) {
  const p = await browser.newPage();
  const errors = [];
  p.on('console', m => { if (m.type()==='error') errors.push(m.text().slice(0,140)); });
  p.on('pageerror', e => errors.push('pageerror: '+String(e).slice(0,140)));
  await p.setViewport({ width:vp.w, height:vp.h });
  await p.goto(B+'/galerie-photos', { waitUntil:'networkidle0' });

  const isOpen = () => p.$eval('#lightbox', d => d.open);
  const bodyLocked = () => p.$eval('body', b => b.classList.contains('overflow-hidden'));

  // --- ouverture
  await p.click('[data-zoom]');
  await new Promise(r=>setTimeout(r,200));
  ok(await isOpen(), `${vp.n} : la photo s'ouvre`);
  ok(await bodyLocked(), `${vp.n} : le fond ne défile plus`);
  const img = await p.$('#lightbox-frame img');
  ok(!!img, `${vp.n} : une image est affichée`);
  const cap = await p.$eval('#lightbox-caption', e => e.textContent.trim());
  ok(cap.length > 5, `${vp.n} : description présente (${JSON.stringify(cap.slice(0,30))})`);

  // --- SORTIE 1 : clic a cote de la photo
  await p.mouse.click(Math.round(vp.w/2), vp.h - 6);
  await new Promise(r=>setTimeout(r,250));
  ok(!(await isOpen()), `${vp.n} : SORTIE par clic a cote`);
  ok(!(await bodyLocked()), `${vp.n} : le defilement revient`);

  // --- SORTIE 2 : touche Echap
  await p.click('[data-zoom]');
  await new Promise(r=>setTimeout(r,200));
  await p.keyboard.press('Escape');
  await new Promise(r=>setTimeout(r,250));
  ok(!(await isOpen()), `${vp.n} : SORTIE par Echap`);

  // --- SORTIE 3 : bouton Fermer
  await p.click('[data-zoom]');
  await new Promise(r=>setTimeout(r,200));
  const closeBox = await p.$eval('[data-lightbox-close]', e => { const r=e.getBoundingClientRect(); return {w:Math.round(r.width),h:Math.round(r.height)}; });
  ok(closeBox.h >= 44, `${vp.n} : bouton Fermer a ${closeBox.w}x${closeBox.h} (min 44 de haut)`);
  await p.click('[data-lightbox-close]');
  await new Promise(r=>setTimeout(r,250));
  ok(!(await isOpen()), `${vp.n} : SORTIE par le bouton Fermer`);

  // --- navigation suivant/precedent
  await p.click('[data-zoom]');
  await new Promise(r=>setTimeout(r,200));
  const before = await p.$eval('#lightbox-caption', e=>e.textContent);
  const visibleNext = await p.$$eval('[data-lightbox-next]', els => {
    const v = els.find(e => e.getBoundingClientRect().width > 0);
    if (v) v.click();
    return !!v;
  });
  await new Promise(r=>setTimeout(r,250));
  const after = await p.$eval('#lightbox-caption', e=>e.textContent);
  ok(visibleNext, `${vp.n} : une fleche suivante est visible`);
  ok(before !== after, `${vp.n} : la fleche change de photo`);
  const counter = await p.$eval('#lightbox-counter', e=>e.textContent.trim());
  ok(/\d+ \/ \d+/.test(counter), `${vp.n} : compteur affiche (${counter})`);

  // --- debordement horizontal pendant que la visionneuse est ouverte
  const of = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok(of <= 1, `${vp.n} : aucun debordement visionneuse ouverte`);

  await p.keyboard.press('Escape');
  ok(errors.length === 0, `${vp.n} : aucune erreur console${errors.length?' -> '+errors[0]:''}`);
  await p.close();
}

await browser.close();
const bad = results.filter(r=>!r.ok);
for (const r of results) console.log(`  ${r.ok?'ok  ':'ECHEC'} ${r.l}`);
console.log(`\n${results.length-bad.length}/${results.length} reussis`);
process.exit(bad.length?1:0);
