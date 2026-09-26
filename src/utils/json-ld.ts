import { SITE, OG_IMAGE, LEGAL } from '@/consts';
import {
  adresseComplete,
  horairesSchemaOrg,
  lirePrestations,
  lireReglages,
  telephoneInternational,
} from '@/lib/contenu';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type JsonLdSchema = Record<string, any>;

export function serializeSchema(schema: JsonLdSchema): string {
  return JSON.stringify(schema).replace(/</g, '\\u003c');
}

export async function motorcycleRepairSchema(): Promise<JsonLdSchema> {
  const reglages = await lireReglages();
  const prestations = await lirePrestations();
  const horaires = horairesSchemaOrg(reglages);
  const reseaux = [reglages.facebook, reglages.instagram].filter(Boolean);

  return {
    '@context': 'https://schema.org',
    '@type': 'MotorcycleRepair',
    '@id': `${SITE.url}/#atelier`,
    name: SITE.name,
    legalName: LEGAL.name,
    vatID: LEGAL.vat,
    description: reglages.presentation,
    url: SITE.url,
    image: {
      '@type': 'ImageObject',
      url: `${SITE.url}${OG_IMAGE.path}`,
      width: OG_IMAGE.width,
      height: OG_IMAGE.height,
    },
    logo: {
      '@type': 'ImageObject',
      url: `${SITE.url}/icon-512.png`,
      width: 512,
      height: 512,
    },
    foundingDate: '2021',
    founder: {
      '@type': 'Person',
      name: LEGAL.name,
    },
    address: {
      '@type': 'PostalAddress',
      streetAddress: SITE.address.street,
      postalCode: SITE.address.postalCode,
      addressLocality: SITE.address.city,
      addressRegion: SITE.address.region,
      addressCountry: SITE.address.country,
    },
    geo: {
      '@type': 'GeoCoordinates',
      latitude: SITE.geo.latitude,
      longitude: SITE.geo.longitude,
    },
    areaServed: [
      { '@type': 'City', name: "Saint-Martin-d'Uriage" },
      { '@type': 'City', name: 'Grenoble' },
      { '@type': 'AdministrativeArea', name: 'Isère' },
    ],
    ...(reseaux.length ? { sameAs: reseaux } : {}),
    hasMap: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(adresseComplete())}`,
    // Le catalogue reprend mot pour mot les prestations affichées : rien n'y est
    // déclaré que le site ne montre pas par ailleurs.
    hasOfferCatalog: {
      '@type': 'OfferCatalog',
      name: 'Prestations de l\'atelier',
      itemListElement: prestations.map((prestation) => ({
        '@type': 'Offer',
        itemOffered: {
          '@type': 'Service',
          name: prestation.titre,
          description: prestation.texte,
          serviceType: prestation.titre,
          provider: { '@id': `${SITE.url}/#atelier` },
          areaServed: { '@type': 'AdministrativeArea', name: 'Isère' },
        },
      })),
    },
    ...(horaires.length ? { openingHoursSpecification: horaires } : {}),
    telephone: telephoneInternational(reglages.telephone),
    // L'adresse e-mail est volontairement absente : elle ne doit pas partir
    // dans un fichier lu par les robots et les moteurs. Elle n'est montrée
    // qu'au visiteur qui la demande, cf. components/ui/EmailProtege.astro.
  };
}

export function websiteSchema(): JsonLdSchema {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': `${SITE.url}/#site`,
    name: SITE.name,
    url: `${SITE.url}/`,
    inLanguage: 'fr-FR',
    // Relie le site à l'atelier : sans ça, les deux fiches coexistent sans lien.
    publisher: { '@id': `${SITE.url}/#atelier` },
  };
}

export function faqSchema(items: readonly { question: string; reponse: string }[]): JsonLdSchema {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: item.reponse,
      },
    })),
  };
}

export function breadcrumbSchema(items: { name: string; url?: string }[]): JsonLdSchema {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      ...(item.url ? { item: `${SITE.url}${item.url}` } : {}),
    })),
  };
}
