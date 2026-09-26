#!/usr/bin/env node
/**
 * Accessibilité et responsive, dans un vrai navigateur, sur 9 largeurs.
 *
 * Complète audit-ui.mjs (débordements et cibles tactiles) par ce qu'aucun test
 * de HTML ne peut voir :
 *  - contraste réel de chaque texte sur son fond calculé (WCAG 1.4.3) ;
 *  - marque de focus visible sur tout ce qui s'atteint au clavier ;
 *  - rendu sans JavaScript, où les blocs à apparition resteraient invisibles
 *    sans public/sans-javascript.css ;
 *  - rôles, noms accessibles et repères de page ;
 *  - décalage de mise en page (CLS) et défilement horizontal à 200 % de zoom.
 *
 * Trois défauts réels trouvés le 18/09/2026 : pages vides sans JavaScript,
 * accent rouille à 4,16:1 sur le petit texte, pied de page à 2,84:1.
 *
 * Prérequis : un serveur sur le port 4321, par exemple
 *   node scripts/apache.mjs -- node scripts/audit-a11y.mjs
 *
 * Le seuil de cible tactile est 44 px (confort, WCAG 2.5.5) ; en dessous de
 * 24 px c'est un manquement au niveau AA de WCAG 2.2.
 */
import puppeteer from 'puppeteer';

const BASE = process.env.BASE || 'http://localhost:4321';
const PAGES = ['/', '/reparation', '/vente', '/galerie-photos', '/contact', '/mentions-legales'];
const LARGEURS = [320, 360, 390, 414, 768, 1024, 1280, 1440, 1920];
const problemes = [];
const confort = new Set();
const note = (t) => problemes.push(t);

const navigateur = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--lang=fr-FR'],
});

const neutraliserScroll = `document.documentElement.style.scrollBehavior='auto';`;

// --- 1. Débordements, cibles tactiles, chevauchements, sur 9 largeurs ---------
{
  const page = await navigateur.newPage();
  for (const largeur of LARGEURS) {
    await page.setViewport({ width: largeur, height: 900 });
    for (const chemin of PAGES) {
      await page.goto(BASE + chemin, { waitUntil: 'networkidle0' });
      await page.evaluate(neutraliserScroll);
      const r = await page.evaluate(() => {
        const out = { debordements: [], petites: [], serrees: [], confort: [] };
        const largeurVue = document.documentElement.clientWidth;
        if (document.documentElement.scrollWidth > largeurVue + 1) {
          for (const el of document.querySelectorAll('body *')) {
            const b = el.getBoundingClientRect();
            if (b.width === 0) continue;
            if (b.right > largeurVue + 1 || b.left < -1) {
              out.debordements.push(`${el.tagName.toLowerCase()}.${(el.className || '').toString().split(' ')[0]} ${Math.round(b.left)}..${Math.round(b.right)}`);
            }
          }
        }
        const cibles = [...document.querySelectorAll('a[href], button, [role="button"], input, select')]
          .filter((el) => el.offsetParent !== null || getComputedStyle(el).position === 'fixed');
        const boites = [];
        for (const el of cibles) {
          const b = el.getBoundingClientRect();
          if (b.width < 1 || b.height < 1) continue;
          boites.push({ el, b });
          if (el.classList.contains('sr-only')) continue; // visible seulement au focus
          // 24 px est le minimum exigé par WCAG 2.2 niveau AA (2.5.8) ; 44 px est
          // la taille confortable au doigt (2.5.5, niveau AAA).
          const etiquette = `${el.tagName.toLowerCase()} "${(el.innerText || el.getAttribute('aria-label') || '').trim().slice(0, 30)}" ${Math.round(b.width)}x${Math.round(b.height)}`;
          if (b.height < 24 || b.width < 24) out.petites.push(etiquette);
          else if (b.height < 44) out.confort.push(etiquette);
        }
        for (let i = 0; i < boites.length; i++) {
          for (let j = i + 1; j < boites.length; j++) {
            const a = boites[i].b;
            const c = boites[j].b;
            if (boites[i].el.contains(boites[j].el) || boites[j].el.contains(boites[i].el)) continue;
            const dx = Math.max(0, Math.max(a.left, c.left) - Math.min(a.right, c.right));
            const dy = Math.max(0, Math.max(a.top, c.top) - Math.min(a.bottom, c.bottom));
            const distance = Math.hypot(dx, dy);
            // L'écartement ne compte que pour les cibles sous 24 px : au-dessus,
            // le critère AA est déjà satisfait par la taille (WCAG 2.5.8).
            const petite = (r) => r.height < 24 || r.width < 24;
            if (distance > 0 && distance < 8 && (petite(a) || petite(c))) {
              out.serrees.push(`${boites[i].el.tagName.toLowerCase()} et ${boites[j].el.tagName.toLowerCase()} à ${distance.toFixed(1)} px`);
            }
          }
        }
        return out;
      });
      const etiquette = `${chemin} @${largeur}`;
      if (r.debordements.length) note(`DÉBORDEMENT ${etiquette} : ${r.debordements.slice(0, 3).join(' | ')}`);
      for (const p of new Set(r.petites)) note(`CIBLE ${etiquette} : ${p} (minimum AA : 24 px)`);
      for (const p of new Set(r.confort)) confort.add(`${p}`);
      for (const p of new Set(r.serrees.slice(0, 2))) note(`ESPACEMENT ${etiquette} : ${p}`);
    }
  }
  await page.close();
}

// --- 2. Contrastes ------------------------------------------------------------
{
  const page = await navigateur.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  for (const chemin of PAGES) {
    await page.goto(BASE + chemin, { waitUntil: 'networkidle0' });
    // Les blocs à apparition démarrent à opacity 0 : on force l'état final.
    await page.evaluate(() => document.querySelectorAll('.reveal').forEach((e) => e.classList.add('is-visible')));
    const faibles = await page.evaluate(() => {
      const lum = (c) => {
        const v = c.map((x) => {
          const s = x / 255;
          return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
      };
      const rgb = (s) => (s.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
      const alpha = (s) => {
        const m = s.match(/[\d.]+/g);
        return m && m.length === 4 ? Number(m[3]) : 1;
      };
      const fond = (el) => {
        let n = el;
        while (n && n !== document.documentElement) {
          const st = getComputedStyle(n);
          if (st.backgroundImage !== 'none') return null; // photo ou dégradé : non calculable
          const a = alpha(st.backgroundColor);
          if (a === 1) return rgb(st.backgroundColor);
          if (a > 0) return null;
          n = n.parentElement;
        }
        return [255, 255, 255];
      };
      const out = [];
      const vus = new Set();
      for (const el of document.querySelectorAll('body *')) {
        const texte = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(' ').trim();
        if (!texte) continue;
        const st = getComputedStyle(el);
        if (st.visibility === 'hidden' || st.display === 'none' || Number(st.opacity) === 0) continue;
        const b = el.getBoundingClientRect();
        if (b.width < 2 || b.height < 2) continue;
        const f = fond(el);
        if (!f) continue;
        const c = rgb(st.color);
        const l1 = lum(c);
        const l2 = lum(f);
        const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
        const taille = parseFloat(st.fontSize);
        const gras = Number(st.fontWeight) >= 700;
        const seuil = taille >= 24 || (gras && taille >= 18.66) ? 3 : 4.5;
        if (ratio < seuil) {
          const cle = `${st.color}|${st.fontSize}|${texte.slice(0, 20)}`;
          if (vus.has(cle)) continue;
          vus.add(cle);
          out.push(`${ratio.toFixed(2)}:1 (seuil ${seuil}) ${st.color} sur rgb(${f.join(',')}) ${Math.round(taille)}px « ${texte.slice(0, 40)} »`);
        }
      }
      return out;
    });
    for (const f of faibles) note(`CONTRASTE ${chemin} : ${f}`);
  }
  await page.close();
}

// --- 3. Focus clavier ---------------------------------------------------------
{
  const page = await navigateur.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  for (const chemin of PAGES) {
    await page.goto(BASE + chemin, { waitUntil: 'networkidle0' });
    await page.evaluate(neutraliserScroll);
    const invisibles = [];
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press('Tab');
      const r = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return null;
        const st = getComputedStyle(el);
        const visible =
          (st.outlineStyle !== 'none' && parseFloat(st.outlineWidth) > 0) ||
          st.boxShadow !== 'none' ||
          st.textDecorationLine !== 'none';
        const b = el.getBoundingClientRect();
        return {
          visible,
          dansEcran: b.width > 0 && b.height > 0,
          nom: `${el.tagName.toLowerCase()} "${(el.innerText || el.getAttribute('aria-label') || '').trim().slice(0, 25)}"`,
        };
      });
      if (!r) break;
      if (!r.visible && r.dansEcran) invisibles.push(r.nom);
    }
    for (const n of new Set(invisibles)) note(`FOCUS ${chemin} : pas de marque visible sur ${n}`);
  }
  await page.close();
}

// --- 4. Sans JavaScript -------------------------------------------------------
{
  const page = await navigateur.newPage();
  await page.setJavaScriptEnabled(false);
  await page.setViewport({ width: 1280, height: 900 });
  for (const chemin of PAGES) {
    await page.goto(BASE + chemin, { waitUntil: 'networkidle0' });
    const r = await page.evaluate(() => {
      const caches = [...document.querySelectorAll('.reveal')].filter((e) => Number(getComputedStyle(e).opacity) < 0.9).length;
      const total = document.querySelectorAll('.reveal').length;
      const liensZoom = [...document.querySelectorAll('[data-zoom]')].filter((a) => a.tagName === 'A' && a.getAttribute('href')).length;
      const zoomTotal = document.querySelectorAll('[data-zoom]').length;
      return { caches, total, liensZoom, zoomTotal, texte: document.body.innerText.trim().length };
    });
    if (r.caches) note(`SANS JS ${chemin} : ${r.caches}/${r.total} blocs restent invisibles`);
    if (r.zoomTotal !== r.liensZoom) note(`SANS JS ${chemin} : ${r.zoomTotal - r.liensZoom} déclencheurs de zoom sans lien`);
    if (r.texte < 300) note(`SANS JS ${chemin} : seulement ${r.texte} caractères de texte`);
  }
  await page.close();
}

// --- 5. Sémantique et ARIA ----------------------------------------------------
{
  const page = await navigateur.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  for (const chemin of PAGES) {
    await page.goto(BASE + chemin, { waitUntil: 'networkidle0' });
    const r = await page.evaluate(() => {
      const out = [];
      if (document.querySelectorAll('main').length !== 1) out.push(`${document.querySelectorAll('main').length} <main>`);
      if (!document.querySelector('header')) out.push('pas de <header>');
      if (!document.querySelector('footer')) out.push('pas de <footer>');
      if (!document.querySelector('nav')) out.push('pas de <nav>');
      for (const el of document.querySelectorAll('a[href], button')) {
        const nom = (el.getAttribute('aria-label') || el.innerText || el.getAttribute('title') || '').trim();
        const b = el.getBoundingClientRect();
        if (!nom && b.width > 0) out.push(`${el.tagName.toLowerCase()} sans nom accessible (${el.getAttribute('href') || el.className})`);
      }
      for (const el of document.querySelectorAll('[aria-hidden="true"]')) {
        if (el.querySelector('a[href], button, input')) out.push('élément focusable dans un aria-hidden');
      }
      const dialogues = [...document.querySelectorAll('dialog')].map((d) => ({
        modal: d.hasAttribute('aria-modal') || true,
        label: d.getAttribute('aria-label') || d.getAttribute('aria-labelledby'),
      }));
      for (const d of dialogues) if (!d.label) out.push('dialogue sans nom accessible');
      const img = [...document.images].filter((i) => !i.hasAttribute('alt'));
      if (img.length) out.push(`${img.length} images sans alt`);
      return out;
    });
    for (const p of new Set(r)) note(`ARIA ${chemin} : ${p}`);
  }
  await page.close();
}

// --- 6. Décalage de mise en page (CLS) ----------------------------------------
{
  const page = await navigateur.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true, deviceScaleFactor: 2 });
  for (const chemin of PAGES) {
    await page.evaluateOnNewDocument(() => {
      window.__cls = 0;
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value;
      }).observe({ type: 'layout-shift', buffered: true });
    });
    await page.goto(BASE + chemin, { waitUntil: 'networkidle0' });
    await new Promise((r) => setTimeout(r, 1200));
    const cls = await page.evaluate(() => window.__cls);
    if (cls > 0.1) note(`CLS ${chemin} : ${cls.toFixed(3)} (seuil 0,1)`);
    else console.log(`  cls ${chemin} : ${cls.toFixed(3)}`);
  }
  await page.close();
}

// --- 7. Zoom 200 % ------------------------------------------------------------
{
  const page = await navigateur.newPage();
  // 1280 CSS px à 200 % de zoom équivaut à une fenêtre de 640 px de large.
  await page.setViewport({ width: 640, height: 512 });
  for (const chemin of PAGES) {
    await page.goto(BASE + chemin, { waitUntil: 'networkidle0' });
    const r = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      vue: document.documentElement.clientWidth,
    }));
    if (r.scroll > r.vue + 1) note(`ZOOM 200 % ${chemin} : défilement horizontal (${r.scroll} > ${r.vue})`);
  }
  await page.close();
}

await navigateur.close();
console.log(`\n${problemes.length} point(s) relevé(s)`);
for (const p of problemes) console.log('  -', p);
if (confort.size) {
  console.log(`\n${confort.size} cible(s) entre 24 et 44 px : conformes au niveau AA, moins confortables au doigt.`);
  for (const c of [...confort].slice(0, 8)) console.log('  .', c);
}
process.exit(problemes.length ? 1 : 0);
