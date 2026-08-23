import { useEffect, useRef, useState, type ReactNode, type Ref } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  HiOutlineArrowRight,
  HiOutlineGlobeAlt,
  HiOutlineChevronDown,
} from 'react-icons/hi2';
import { SUPPORTED_LANGS } from '@/i18n';
import { buildLocaleSwitchUrl, normalizeI18nLang, writeStoredI18nLang } from '@/i18n/localePath';
import { Icon } from '@/components/base/icon';
import { docsUrl } from '@/utils/docsUrl';
import { cn } from '@/utils/classnames';
import '@/pages/LandingPage.css';

function normalizeLandingLang(raw: string | undefined): string {
  return normalizeI18nLang(raw);
}

/** Compact language menu — switches URL prefix (`/`, `/zh`, `/zh-tw`, `/ja`). */
function LandingLangSwitcher(): ReactNode {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const current = normalizeLandingLang(i18n.resolvedLanguage || i18n.language);
  const currentLabel = t(`lang.${current}`);

  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="rcb-landing-lang" ref={rootRef}>
      <button
        type="button"
        className="rcb-landing-lang-trigger"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={t('lang.label')}
        onClick={() => setOpen((v) => !v)}
      >
        <HiOutlineGlobeAlt className="h-4 w-4" strokeWidth={1.75} aria-hidden />
        <span className="rcb-landing-lang-label">{currentLabel}</span>
        <HiOutlineChevronDown
          className={cn('rcb-landing-lang-chevron h-3.5 w-3.5 transition-transform', open && 'rotate-180')}
          strokeWidth={2}
          aria-hidden
        />
      </button>
      {open ? (
        <ul className="rcb-landing-lang-menu" role="listbox" aria-label={t('lang.label')}>
          {SUPPORTED_LANGS.map((item) => {
            const active = item.code === current;
            return (
              <li key={item.code} role="option" aria-selected={active}>
                <button
                  type="button"
                  className={cn('rcb-landing-lang-item', active && 'rcb-is-active')}
                  onClick={() => {
                    setOpen(false);
                    if (item.code === current) return;
                    writeStoredI18nLang(item.code);
                    // Full navigation remounts BrowserRouter with the new basename.
                    window.location.assign(buildLocaleSwitchUrl(item.code));
                  }}
                >
                  {t(item.labelKey)}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

type LandingPageViewProps = {
  revealRef: Ref<HTMLDivElement>;
};

/** Marketing homepage chrome — nav, hero, sections, footer. */
export function LandingPageView({ revealRef }: LandingPageViewProps): ReactNode {
  const { t } = useTranslation();
  const year = new Date().getFullYear();
  const features = [
    {
      tone: 'chat',
      icon: 'landing-chat',
      title: t('landing.featureChatTitle'),
      body: t('landing.featureChatBody'),
    },
    {
      tone: 'canvas',
      icon: 'landing-canvas',
      title: t('landing.featureCanvasTitle'),
      body: t('landing.featureCanvasBody'),
    },
    {
      tone: 'layers',
      icon: 'landing-layers',
      title: t('landing.featureEditTitle'),
      body: t('landing.featureEditBody'),
    },
  ] as const;

  const steps = [
    { n: '01', title: t('landing.step1Title'), body: t('landing.step1Body') },
    { n: '02', title: t('landing.step2Title'), body: t('landing.step2Body') },
    { n: '03', title: t('landing.step3Title'), body: t('landing.step3Body') },
  ] as const;

  const scenes = [
    { tone: 'poster', icon: 'landing-poster', label: t('homeCategories.poster') },
    { tone: 'mobile', icon: 'landing-mobile', label: t('homeCategories.mobile') },
    { tone: 'website', icon: 'landing-website', label: t('homeCategories.website') },
    { tone: 'image', icon: 'landing-image', label: t('homeCategories.image') },
  ] as const;

  return (
    <div className="rcb-landing-page" ref={revealRef}>
      <a href="#main" className="rcb-landing-skip">
        {t('landing.skipToContent')}
      </a>

      <header className="rcb-landing-nav">
        <div className="rcb-landing-nav-inner">
          <div className="rcb-landing-nav-start">
            <Link to="/" className="rcb-landing-brand" aria-label="Recombyn">
              <img src="/logo-mark.svg" alt="" width={26} height={26} className="rcb-landing-brand-mark" />
              <span className="rcb-landing-brand-word">recombyn</span>
            </Link>
            <nav className="rcb-landing-nav-links" aria-label={t('landing.navLabel')}>
              <a href="#features">{t('landing.navFeatures')}</a>
              <a href="#workflow">{t('landing.navWorkflow')}</a>
              <a href="#scenes">{t('landing.navScenes')}</a>
            </nav>
          </div>
          <div className="rcb-landing-nav-actions">
            <LandingLangSwitcher />
            <Link to="/home" className="rcb-landing-link-quiet">
              {t('landing.navOpenApp')}
            </Link>
            <span className="rcb-landing-nav-divider" aria-hidden />
            <Link to="/home?login=1" className="rcb-landing-btn rcb-landing-btn-primary rcb-landing-btn-nav">
              {t('landing.ctaStart')}
            </Link>
          </div>
        </div>
      </header>

      <main id="main">
        <section className="rcb-landing-hero" aria-labelledby="landing-hero-title">
          <div className="rcb-landing-hero-atmosphere" aria-hidden>
            <span className="rcb-landing-orb rcb-landing-orb-a" />
            <span className="rcb-landing-orb rcb-landing-orb-b" />
            <span className="rcb-landing-grid" />
            <span className="rcb-landing-grain" />
          </div>

          <div className="rcb-landing-hero-inner">
            <div className="rcb-landing-hero-copy">
              <p className="rcb-landing-eyebrow rcb-landing-fade-in">{t('landing.eyebrow')}</p>
              <h1 id="landing-hero-title" className="rcb-landing-h1 rcb-landing-fade-in rcb-landing-delay-1">
                <span className="rcb-landing-h1-brand">Recombyn</span>
                <span className="rcb-landing-h1-rest">{t('landing.heroRest')}</span>
              </h1>
              <p className="rcb-landing-hero-lead rcb-landing-fade-in rcb-landing-delay-2">
                {t('landing.heroLead')}
              </p>
              <div className="rcb-landing-hero-cta rcb-landing-fade-in rcb-landing-delay-3">
                <Link to="/home" className="rcb-landing-btn rcb-landing-btn-primary rcb-landing-btn-lg">
                  {t('landing.ctaPrimary')}
                  <HiOutlineArrowRight className="h-4 w-4" aria-hidden />
                </Link>
                <a href="#features" className="rcb-landing-btn rcb-landing-btn-ghost rcb-landing-btn-lg">
                  {t('landing.ctaSecondary')}
                </a>
              </div>
            </div>

            <div className="rcb-landing-hero-stage rcb-landing-fade-in rcb-landing-delay-4">
              <img
                className="rcb-landing-ink-visual"
                src="/landing-hero-pen.png?v=cutout"
                alt=""
                width={1024}
                height={1024}
                decoding="async"
                fetchPriority="high"
              />
            </div>
          </div>
        </section>

        <section id="features" className="rcb-landing-section" aria-labelledby="features-title">
          <div className="rcb-landing-section-inner">
            <header className="rcb-landing-section-head" data-reveal>
              <h2 id="features-title">{t('landing.featuresTitle')}</h2>
              <p>{t('landing.featuresLead')}</p>
            </header>
            <ul className="rcb-landing-feature-grid">
              {features.map((f, i) => (
                <li
                  key={f.title}
                  className="rcb-landing-feature-card"
                  data-reveal
                  style={{ transitionDelay: `${i * 80}ms` }}
                >
                  <span className={cn('rcb-landing-feature-icon', `rcb-is-${f.tone}`)}>
                    <Icon name={f.icon} className="rcb-landing-glyph" />
                  </span>
                  <h3>{f.title}</h3>
                  <p>{f.body}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section id="workflow" className="rcb-landing-section rcb-landing-section-soft" aria-labelledby="workflow-title">
          <div className="rcb-landing-section-inner">
            <header className="rcb-landing-section-head" data-reveal>
              <h2 id="workflow-title">{t('landing.workflowTitle')}</h2>
              <p>{t('landing.workflowLead')}</p>
            </header>
            <ol className="rcb-landing-steps">
              {steps.map((s, i) => (
                <li
                  key={s.n}
                  className="rcb-landing-step"
                  data-reveal
                  style={{ transitionDelay: `${i * 90}ms` }}
                >
                  <span className="rcb-landing-step-n">{s.n}</span>
                  <div>
                    <h3>{s.title}</h3>
                    <p>{s.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="scenes" className="rcb-landing-section" aria-labelledby="scenes-title">
          <div className="rcb-landing-section-inner">
            <header className="rcb-landing-section-head" data-reveal>
              <h2 id="scenes-title">{t('landing.scenesTitle')}</h2>
              <p>{t('landing.scenesLead')}</p>
            </header>
            <ul className="rcb-landing-scenes" data-reveal>
              {scenes.map((s) => (
                <li key={s.label} className={cn('rcb-landing-scene-pill', `rcb-is-${s.tone}`)}>
                  <span className="rcb-landing-scene-icon">
                    <Icon name={s.icon} className="rcb-landing-glyph" />
                  </span>
                  <span>{s.label}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="rcb-landing-closing" aria-labelledby="closing-title">
          <div className="rcb-landing-closing-inner" data-reveal>
            <h2 id="closing-title">{t('landing.closingTitle')}</h2>
            <p>{t('landing.closingLead')}</p>
            <Link to="/home" className={cn('rcb-landing-btn', 'rcb-landing-btn-primary', 'rcb-landing-btn-lg')}>
              {t('landing.ctaPrimary')}
              <HiOutlineArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </div>
        </section>
      </main>

      <footer className="rcb-landing-footer">
        <div className="rcb-landing-footer-inner">
          <div className="rcb-landing-footer-brand">
            <img src="/logo-mark.svg" alt="" width={22} height={22} />
            <span>recombyn</span>
          </div>
          <nav className="rcb-landing-footer-links" aria-label={t('landing.footerNav')}>
            <a href={docsUrl('/guide/getting-started')} target="_blank" rel="noopener noreferrer">
              {t('landing.footerGuide')}
            </a>
            <a href={docsUrl('/legal/privacy')} target="_blank" rel="noopener noreferrer">
              {t('landing.footerPrivacy')}
            </a>
            <a href={docsUrl('/legal/terms')} target="_blank" rel="noopener noreferrer">
              {t('landing.footerTerms')}
            </a>
            <Link to="/home">{t('landing.navOpenApp')}</Link>
          </nav>
          <p className="rcb-landing-footer-copy">{t('landing.footerCopy', { year })}</p>
        </div>
      </footer>
    </div>
  );
}
