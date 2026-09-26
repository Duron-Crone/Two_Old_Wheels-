
/**
 * Ce qui ne se modifie pas depuis l'administration : nom, domaine, adresse et
 * position. L'adresse est liée aux mentions légales et à la fiche Google ; la
 * changer relève d'une démarche, pas d'une saisie.
 *
 * Tout le reste (téléphone, email, horaires, réseaux, textes, photos) se trouve
 * dans src/content/ et s'édite depuis /admin.
 */
export const SITE = {
  name: 'Two Old Wheels',
  url: 'https://www.twooldwheels.fr',
  address: {
    street: '500 Chemin du Meffrey',
    postalCode: '38410',
    city: "Saint-Martin-d'Uriage",
    region: 'Auvergne-Rhône-Alpes',
    country: 'FR',
  },
  // Position de la fiche Google de l'atelier (relevée le 14/09/2026). L'ancienne
  // valeur était décalée de 1,3 km : sur une recherche locale, l'écart entre les
  // données structurées et la fiche Google brouille le signal de proximité.
  geo: {
    latitude: 45.14632,
    longitude: 5.84163,
  },
} as const;

// Identité légale, relevée au registre des entreprises le 14/09/2026 et recoupée
// avec la fiche Google (adresse, téléphone). Clés de contrôle vérifiées : SIREN
// et SIRET par l'algorithme de Luhn, clé TVA recalculée à partir du SIREN.
export const LEGAL = {
  name: 'Guillaume Duron',
  form: 'Entrepreneur individuel (EI)',
  rcs: 'RCS Grenoble 900 094 590',
  siret: '900 094 590 00016',
  vat: 'FR13900094590',
  activity: 'Commerce et réparation de motocycles (NAF 45.40Z)',
  // Hébergeur : identité relevée le 17/09/2026 dans les mentions légales
  // d'ovhcloud.com ; téléphone du support OVHcloud (équivalent du 1007).
  host: {
    name: 'OVH SAS',
    address: '2 rue Kellermann, 59100 Roubaix, France',
    phone: '09 72 10 10 07',
    url: 'https://www.ovhcloud.com',
  },
} as const;

// Image de partage par défaut (Open Graph / Twitter). Les dimensions sont
// déclarées dans le <head> : sans elles, les aperçus Facebook et LinkedIn
// attendent le téléchargement de l'image avant de dessiner la carte.
export const OG_IMAGE = {
  path: '/og-default.jpg',
  width: 1200,
  height: 630,
  alt: "Atelier moto Two Old Wheels à Saint-Martin-d'Uriage",
} as const;

export const NAV_LINKS = [
  { href: '/', label: 'Accueil' },
  { href: '/reparation', label: 'Réparation' },
  { href: '/vente', label: 'Vente' },
  { href: '/galerie-photos', label: 'Galerie photos' },
  { href: '/contact', label: 'Contact' },
] as const;
