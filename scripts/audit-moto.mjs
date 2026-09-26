#!/usr/bin/env node
/**
 * Test de la moto qui traverse l'écran entre deux pages, dans un vrai navigateur.
 *
 * Ce qui est vérifié : elle ne roule pas au premier chargement, elle fait bien
 * 2 cm, elle ne capte ni le pointeur ni les lecteurs d'écran, elle part après
 * une navigation, elle est réellement visible pendant sa traversée, elle ne
 * crée pas de barre de défilement horizontale en sortant par la droite, elle se
 * cabre en fin de traversée pendant que le pilote lève la main en V, et elle
 * reste immobile quand le mouvement réduit est demandé.
 *
 * Prérequis : `npm run serve:prod` dans un autre terminal.
 */
import puppeteer from 'puppeteer';

const BASE = process.env.BASE || 'http://localhost:4321';
const results = [];
const ok = (cond, label) => results.push({ cond, label });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Premier lien visible vers une page : sur mobile, la navigation de bureau est masquée.
const clickVisible = (page, href) =>
  page.evaluate((h) => {
    const a = [...document.querySelectorAll(`a[href="${h}"]`)].find((el) => el.getBoundingClientRect().width > 0);
    a.click();
  }, href);

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });

for (const vp of [{ width: 1280, height: 860, name: 'bureau' }, { width: 390, height: 844, name: 'mobile' }]) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 120)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 120)));
  await page.setViewport({ width: vp.width, height: vp.height });
  await page.goto(BASE + '/', { waitUntil: 'networkidle0' });
  await wait(600);

  const initial = await page.$eval('#moto', (e) => {
    const r = e.getBoundingClientRect();
    return {
      cls: e.className,
      w: Math.round(r.width),
      pointer: getComputedStyle(e).pointerEvents,
      hidden: e.getAttribute('aria-hidden'),
    };
  });
  ok(!initial.cls.includes('roule'), `${vp.name} : immobile au premier chargement`);
  ok(initial.w >= 70 && initial.w <= 82, `${vp.name} : ${initial.w} px de large (2 cm = 76 px)`);
  ok(initial.pointer === 'none', `${vp.name} : ne capte pas le pointeur`);
  ok(initial.hidden === 'true', `${vp.name} : ignorée par les lecteurs d'écran`);

  await clickVisible(page, '/reparation');

  // Relevé pendant toute la traversée.
  // Relevé jusqu'à la fin réelle de la traversée, sans supposer sa durée.
  const frames = [];
  for (let i = 0; i < 60; i++) {
    await wait(110);
    frames.push(
      await page.evaluate(() => {
        const e = document.getElementById('moto');
        // L'angle du châssis dit si la roue avant est levée ; l'opacité du bras
        // levé dit si le pilote fait son V. Les deux doivent arriver ensemble.
        const matrice = new DOMMatrixReadOnly(getComputedStyle(e.querySelector('.chassis')).transform);
        return {
          cls: e.className,
          x: Math.round(e.getBoundingClientRect().left),
          op: +getComputedStyle(e).opacity,
          angle: Math.round((Math.atan2(matrice.b, matrice.a) * 180) / Math.PI),
          brasV: +getComputedStyle(e.querySelector('.bras-v')).opacity,
          brasGuidon: +getComputedStyle(e.querySelector('.bras-guidon')).opacity,
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
      }),
    );
    const seenRolling = frames.some((f) => f.cls.includes('roule'));
    if (seenRolling && !frames[frames.length - 1].cls.includes('roule')) break;
  }

  const rolling = frames.filter((f) => f.cls.includes('roule'));
  ok(rolling.length > 0, `${vp.name} : part après une navigation`);
  ok(frames.some((f) => /voie-[123]/.test(f.cls)), `${vp.name} : une hauteur de passage est tirée`);
  const maxOpacity = Math.max(...frames.map((f) => f.op));
  ok(maxOpacity > 0.5, `${vp.name} : visible pendant la traversée (opacité max ${maxOpacity.toFixed(2)})`);
  const xs = rolling.map((f) => f.x);
  ok(xs.length > 1 && xs[xs.length - 1] > xs[0], `${vp.name} : avance de gauche à droite`);
  const overflow = Math.max(...frames.map((f) => f.overflow));
  ok(overflow <= 1, `${vp.name} : aucune barre horizontale en sortant de l'écran (${overflow} px)`);

  ok(rolling.length * 110 >= 2600, `${vp.name} : traversée d'environ ${(rolling.length * 0.11).toFixed(1)} s`);

  // Le cabré et le V, en fin de traversée.
  const cabre = Math.min(...rolling.map((f) => f.angle));
  ok(cabre <= -15, `${vp.name} : la roue avant se lève (${cabre} degrés)`);
  ok(rolling.some((f) => f.brasV > 0.9 && f.angle < -5), `${vp.name} : le pilote lève la main en V pendant le cabré`);
  ok(rolling.some((f) => f.brasGuidon > 0.9 && f.angle > -2), `${vp.name} : il tient le guidon le reste du temps`);
  ok(!rolling.some((f) => f.brasV > 0.5 && f.brasGuidon > 0.5), `${vp.name} : jamais deux bras à la fois`);
  await wait(200);
  const end = await page.$eval('#moto', (e) => ({ cls: e.className, op: +getComputedStyle(e).opacity }));
  ok(!end.cls.includes('roule') && end.op < 0.1, `${vp.name} : repart invisible une fois passée`);
  ok(errors.length === 0, `${vp.name} : aucune erreur console${errors.length ? ' -> ' + errors[0] : ''}`);
  await page.close();
}

// Mouvement réduit : elle ne doit pas bouger du tout.
const reduced = await browser.newPage();
await reduced.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
await reduced.setViewport({ width: 1280, height: 860 });
await reduced.goto(BASE + '/', { waitUntil: 'networkidle0' });
await clickVisible(reduced, '/vente');
await wait(600);
ok(!(await reduced.$eval('#moto', (e) => e.className)).includes('roule'), 'mouvement réduit : immobile');

await browser.close();

for (const r of results) console.log(`  ${r.cond ? 'ok   ' : 'ÉCHEC'} ${r.label}`);
const failed = results.filter((r) => !r.cond).length;
console.log(`\n${results.length - failed}/${results.length} réussis`);
process.exit(failed ? 1 : 0);
