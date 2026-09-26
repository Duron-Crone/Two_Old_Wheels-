#!/usr/bin/env node
/**
 * Audit d'interface dans un vrai navigateur (Chrome headless via Puppeteer).
 *
 * Ce que la recette statique (`scripts/verify.mjs`) ne peut pas voir : un
 * débordement horizontal, une cible tactile trop petite, une barre fixe qui
 * recouvre la fin du contenu, une erreur console. Les trois premiers bugs
 * trouvés ici ne faisaient échouer ni le build ni le typecheck :
 *   - la navigation de bureau débordait de 40 px à 768 px ;
 *   - huit liens de pied de page faisaient 20 px de haut au lieu de 44 ;
 *   - `frame-ancestors` en <meta> émettait un avertissement sur chaque page.
 *
 * Prérequis, une seule fois :
 *   npx puppeteer browsers install chrome
 *
 * Usage : lancer `npm run serve:prod` dans un terminal, puis ici
 *   node scripts/audit-ui.mjs
 */
import puppeteer from 'puppeteer';

const BASE = process.env.BASE || 'http://localhost:4321';
const PAGES = ['/', '/reparation', '/vente', '/galerie-photos', '/contact', '/mentions-legales'];
const VIEWPORTS = [
  { w: 320, h: 640, label: '320 (petit mobile)' },
  { w: 360, h: 780, label: '360 (mobile courant)' },
  { w: 390, h: 844, label: '390 (iPhone)' },
  { w: 768, h: 1024, label: '768 (tablette)' },
  { w: 1024, h: 800, label: '1024 (petit portable)' },
  { w: 1440, h: 900, label: '1440 (bureau)' },
];

const problems = [];
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });

for (const vp of VIEWPORTS) {
  for (const path of PAGES) {
    const page = await browser.newPage();
    await page.setViewport({ width: vp.w, height: vp.h, deviceScaleFactor: 1 });

    const consoleErrors = [];
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 160));
    });
    page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + String(e).slice(0, 160)));

    await page.goto(BASE + path, { waitUntil: 'networkidle0' });
    // Faire défiler jusqu'en bas pour déclencher toutes les apparitions, puis
    // laisser les animations se poser avant de mesurer.
    await page.evaluate(async () => {
      // Le site est en `scroll-behavior: smooth` : sans ça, `scrollTo` s'anime
      // et la mesure part avant que le bas de page soit atteint.
      document.documentElement.style.scrollBehavior = 'auto';
      const step = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 60)));
      for (let y = 0; y < document.documentElement.scrollHeight; y += window.innerHeight / 2) {
        window.scrollTo(0, y);
        await step();
      }
      window.scrollTo(0, document.documentElement.scrollHeight);
      await step();
    });
    await new Promise((r) => setTimeout(r, 600));

    const report = await page.evaluate((viewportWidth) => {
      const out = { overflow: null, culprits: [], smallTargets: [], ctaOverlap: null };

      const de = document.documentElement;
      if (de.scrollWidth > de.clientWidth + 1) {
        out.overflow = { scrollWidth: de.scrollWidth, clientWidth: de.clientWidth };
        for (const el of document.querySelectorAll('body *')) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          if (r.right > de.clientWidth + 1 || r.left < -1) {
            const cs = getComputedStyle(el);
            if (cs.position === 'fixed') continue;
            out.culprits.push({
              tag: el.tagName.toLowerCase(),
              cls: (el.className?.toString?.() || '').slice(0, 90),
              left: Math.round(r.left),
              right: Math.round(r.right),
              text: (el.textContent || '').trim().slice(0, 45),
            });
          }
        }
        out.culprits = out.culprits.slice(0, 6);
      }

      // Cibles tactiles : 44x44 est le minimum recommandé (WCAG 2.5.5 / Apple HIG).
      if (viewportWidth < 768) {
        for (const el of document.querySelectorAll('a[href], button')) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          if (getComputedStyle(el).visibility === 'hidden') continue;
          if (el.classList.contains('sr-only')) continue;
          if (r.height < 44 || r.width < 44) {
            out.smallTargets.push({
              tag: el.tagName.toLowerCase(),
              w: Math.round(r.width),
              h: Math.round(r.height),
              text: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 40),
            });
          }
        }
      }

      // La barre d'appel fixe recouvre-t-elle la fin du contenu ?
      const bar = document.querySelector('a[aria-label^="M\'appeler"][class*="bottom-0"]');
      const footer = document.querySelector('footer');
      if (bar && footer && getComputedStyle(bar).display !== 'none') {
        const br = bar.getBoundingClientRect();
        const last = footer.querySelector('a[href="/mentions-legales"]');
        if (last) {
          const lr = last.getBoundingClientRect();
          if (lr.bottom > br.top) out.ctaOverlap = { barTop: Math.round(br.top), lastBottom: Math.round(lr.bottom) };
        }
      }

      return out;
    }, vp.w);

    const where = `${vp.label} ${path}`;
    if (report.overflow) {
      problems.push({
        type: 'DEBORDEMENT',
        where,
        detail: `${report.overflow.scrollWidth}px de large pour ${report.overflow.clientWidth}px de viewport`,
        culprits: report.culprits,
      });
    }
    if (report.smallTargets.length) {
      const uniq = [];
      const seen = new Set();
      for (const t of report.smallTargets) {
        const k = `${t.tag}|${t.text}|${t.w}x${t.h}`;
        if (!seen.has(k)) { seen.add(k); uniq.push(t); }
      }
      problems.push({ type: 'CIBLE TACTILE', where, detail: `${uniq.length} sous 44px`, culprits: uniq.slice(0, 8) });
    }
    if (report.ctaOverlap) {
      problems.push({ type: 'CTA RECOUVRE', where, detail: JSON.stringify(report.ctaOverlap) });
    }
    if (consoleErrors.length) {
      problems.push({ type: 'CONSOLE', where, detail: consoleErrors.slice(0, 3).join(' | ') });
    }

    await page.close();
  }
}

await browser.close();

const byType = {};
for (const p of problems) (byType[p.type] ??= []).push(p);

console.log(`\n${problems.length} problème(s) relevé(s)\n`);
for (const [type, list] of Object.entries(byType)) {
  console.log(`### ${type} (${list.length})`);
  for (const p of list) {
    console.log(`  ${p.where}  ${p.detail}`);
    for (const c of p.culprits || []) {
      console.log(`      <${c.tag}> ${c.w !== undefined ? `${c.w}x${c.h}` : `${c.left}..${c.right}`}  ${JSON.stringify(c.text || c.cls)}`);
    }
  }
  console.log();
}
