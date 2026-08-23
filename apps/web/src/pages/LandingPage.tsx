import { useEffect, useRef, type ReactNode, memo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  absoluteLocaleUrl,
  normalizeI18nLang,
} from '@/i18n/localePath';
import { LandingPageView } from '@/components/landing/LandingPageView';

const SITE_ORIGIN_PROD = 'https://recombyn.com';

function siteOrigin(): string {
  if (typeof window === 'undefined') return SITE_ORIGIN_PROD;
  const host = window.location.hostname;
  if (host === 'localhost' || host === '127.0.0.1') return window.location.origin;
  return SITE_ORIGIN_PROD;
}

function upsertMeta(attr: 'name' | 'property', key: string, content: string) {
  let el = document.head.querySelector(`meta[${attr}="${key}"]`) as HTMLMetaElement | null;
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.content = content;
}

function upsertLink(rel: string, href: string) {
  let el = document.head.querySelector(`link[rel="${rel}"]`) as HTMLLinkElement | null;
  if (!el) {
    el = document.createElement('link');
    el.rel = rel;
    document.head.appendChild(el);
  }
  el.href = href;
}

function upsertJsonLd(id: string, data: Record<string, unknown>) {
  let el = document.getElementById(id) as HTMLScriptElement | null;
  if (!el) {
    el = document.createElement('script');
    el.id = id;
    el.type = 'application/ld+json';
    document.head.appendChild(el);
  }
  el.textContent = JSON.stringify(data);
}

type LandingSeoProps = {
  title: string;
  description: string;
  locale: string;
};

const OG_LOCALE: Record<string, string> = {
  'zh-TW': 'zh_TW',
  'zh-CN': 'zh_CN',
  ja: 'ja_JP',
  en: 'en_US',
};

const HTML_LANG: Record<string, string> = {
  'zh-TW': 'zh-Hant',
  'zh-CN': 'zh-CN',
  ja: 'ja',
  en: 'en',
};

/** Document head for marketing `/` — title, OG/Twitter, canonical, JSON-LD. */
function applyLandingSeo({ title, description, locale }: LandingSeoProps) {
  const origin = siteOrigin();
  const lang = normalizeI18nLang(locale);
  const url = absoluteLocaleUrl(origin, lang, '/');
  const image = `${origin}/logo-mark.png`;
  const ogLocale = OG_LOCALE[lang] || OG_LOCALE.en;
  const htmlLang = HTML_LANG[lang] || HTML_LANG.en;

  document.title = title;
  document.documentElement.lang = htmlLang;

  upsertMeta('name', 'description', description);
  upsertMeta('name', 'robots', 'index,follow,max-image-preview:large');
  upsertMeta('name', 'keywords', 'Recombyn,AI设计,Agent设计,无限画布,海报设计,UI设计,智能设计工具');
  upsertMeta('property', 'og:type', 'website');
  upsertMeta('property', 'og:site_name', 'Recombyn');
  upsertMeta('property', 'og:title', title);
  upsertMeta('property', 'og:description', description);
  upsertMeta('property', 'og:url', url);
  upsertMeta('property', 'og:image', image);
  upsertMeta('property', 'og:locale', ogLocale);
  upsertMeta('name', 'twitter:card', 'summary_large_image');
  upsertMeta('name', 'twitter:title', title);
  upsertMeta('name', 'twitter:description', description);
  upsertMeta('name', 'twitter:image', image);
  upsertLink('canonical', url);

  // hreflang: en unprefixed; others /zh /zh-tw /ja.
  for (const [hreflang, i18nCode] of [
    ['en', 'en'],
    ['zh-CN', 'zh-CN'],
    ['zh-TW', 'zh-TW'],
    ['ja', 'ja'],
    ['x-default', 'en'],
  ] as const) {
    const href = absoluteLocaleUrl(origin, i18nCode, '/');
    let el = document.head.querySelector(
      `link[rel="alternate"][hreflang="${hreflang}"]`
    ) as HTMLLinkElement | null;
    if (!el) {
      el = document.createElement('link');
      el.rel = 'alternate';
      el.hreflang = hreflang;
      document.head.appendChild(el);
    }
    el.href = href;
  }

  upsertJsonLd('recombyn-ld-org', {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'Recombyn',
    url: origin,
    logo: image,
    sameAs: [],
  });
  upsertJsonLd('recombyn-ld-app', {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: 'Recombyn',
    url,
    applicationCategory: 'DesignApplication',
    operatingSystem: 'Web',
    description,
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'CNY',
    },
  });
  upsertJsonLd('recombyn-ld-website', {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'Recombyn',
    url: origin,
    description,
    inLanguage: ['en', 'zh-CN', 'zh-TW', 'ja'],
  });
}

function useRevealOnScroll() {
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const nodes = root.querySelectorAll<HTMLElement>('[data-reveal]');
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add('rcb-is-visible');
            io.unobserve(entry.target);
          }
        }
      },
      { root: null, threshold: 0.14, rootMargin: '0px 0px -8% 0px' }
    );
    nodes.forEach((n) => io.observe(n));
    return () => io.disconnect();
  }, []);
  return rootRef;
}

/** Public marketing homepage — brand-first, SEO-ready, scrollable. */
function LandingPage(): ReactNode {
  const { t, i18n } = useTranslation();
  const revealRef = useRevealOnScroll();
  const lang = i18n.resolvedLanguage || i18n.language || 'zh-CN';

  useEffect(() => {
    applyLandingSeo({
      title: t('landing.seoTitle'),
      description: t('landing.seoDescription'),
      locale: lang,
    });
  }, [t, lang]);

  // Unlock window scroll — app shell locks html/body/#root for the editor.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add('rcb-landing-scroll');
    return () => root.classList.remove('rcb-landing-scroll');
  }, []);

  return <LandingPageView revealRef={revealRef} />;
}

export default memo(LandingPage);
