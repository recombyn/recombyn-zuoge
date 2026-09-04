import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, memo } from 'react';
import { useSelector } from '@/store';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation, Trans } from 'react-i18next';
import { Button, Checkbox, Input, message, Dialog, Icon } from '@/components/base';
import AppLogo from '@/components/base/AppLogo';
import AppBrandWordmark from '@/components/base/AppBrandWordmark';
import {
  createSliderCaptcha,
  sendEmailCode,
  verifyEmailCode,
  verifySliderCaptcha,
  type SliderCaptchaChallenge,
} from '@/service/auth';
import { setSession } from '@/store/modules/auth';
import { cn } from '@/utils/classnames';
import { isLoginOpen, readReturnToParam } from '@/utils/authReturnTo';
import { docsUrl } from '@/utils/docsUrl';
import { startGoogleOAuthRedirect } from '@/utils/googleOAuth';
import { getToken } from '@/utils/token';
import { getHttpErrorDetail, getHttpErrorMessage, getHttpStatus } from '@/service/client';
import { HiArrowPath, HiCheck, HiChevronDoubleRight, HiOutlineXMark } from 'react-icons/hi2';

function isNeedCaptcha(err: unknown): boolean {
  if (getHttpStatus(err) === 428) return true;
  const detail = getHttpErrorDetail(err);
  if (detail && typeof detail === 'object' && (detail as { code?: string }).code === 'need_captcha') {
    return true;
  }
  return false;
}

type CaptchaStatus = 'default' | 'loading' | 'moving' | 'verify' | 'success' | 'error';

function captchaTipText(
  t: (key: string, opts?: Record<string, unknown>) => string,
  status: CaptchaStatus,
  beatPercent: number | null
): string {
  if (status === 'loading') return t('auth.captchaLoading');
  if (status === 'success' && beatPercent != null) {
    return t('auth.captchaBeat', { percent: beatPercent });
  }
  if (status === 'success') return t('auth.captchaOk');
  if (status === 'error') return t('auth.captchaFail');
  if (status === 'verify') return t('auth.captchaVerifying');
  if (status === 'moving') return '';
  return t('auth.captchaHint');
}

function captchaTrackClass(status: CaptchaStatus): string {
  if (status === 'success') return 'bg-emerald-50 ring-emerald-300';
  if (status === 'error') return 'bg-red-50 ring-red-300';
  return 'bg-[#f0f1f3] ring-[#d8dbe0]';
}

function captchaFillClass(status: CaptchaStatus): string {
  if (status === 'success') return 'bg-emerald-200/70';
  if (status === 'error') return 'bg-red-200/60';
  return 'bg-[#e4e6ea]';
}

function captchaKnobClass(status: CaptchaStatus): string {
  if (status === 'success') return 'bg-emerald-500';
  if (status === 'error') return 'bg-red-400';
  return 'bg-[#3d3f44] hover:bg-[#2c2e32]';
}

function captchaTipClass(status: CaptchaStatus): string {
  if (status === 'success') return 'text-emerald-600';
  if (status === 'error') return 'text-red-500';
  if (status === 'loading' || status === 'verify' || status === 'default') return 'text-[#8b8f96]';
  return 'invisible';
}

function LoginArtPanel() {
  const { t } = useTranslation();

  return (
    <div className="relative hidden w-[280px] shrink-0 flex-col justify-end overflow-hidden md:flex">
      {/* Brand ink base — design-studio, not purple nebula */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 90% 70% at 18% 12%, rgba(255,255,255,0.09) 0%, transparent 55%), radial-gradient(ellipse 70% 55% at 88% 78%, rgba(255,255,255,0.05) 0%, transparent 50%), linear-gradient(165deg, #1a1a1a 0%, #141414 42%, #0c0c0c 100%)',
        }}
      />
      {/* Canvas dot grid — echoes home hero */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.35]"
        style={{
          backgroundImage: 'radial-gradient(rgba(255,255,255,0.55) 1px, transparent 1px)',
          backgroundSize: '18px 18px',
        }}
      />
      {/* Sparse accent dots only — no frames / large circles */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-[18%] top-[22%] h-1.5 w-1.5 rounded-full bg-white/40" />
        <div className="absolute right-[24%] top-[38%] h-1 w-1 rounded-full bg-white/25" />
        <div className="absolute bottom-[32%] left-[36%] h-1 w-1 rounded-full bg-white/20" />
      </div>
      <div className="relative z-10 inline-flex shrink-0 items-center gap-2 self-start p-6 leading-none">
        <AppLogo size={22} scheme="light" />
        <AppBrandWordmark size={15} className="-translate-y-px text-white" />
      </div>
    </div>
  );
}

/** Self-hosted puzzle slider — UX mirrors rc-slider-captcha (embed mode). */
function LoginSliderCaptcha({
  email,
  onVerified,
  onCancel,
}: {
  email: string;
  onVerified: (captchaToken: string) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [challenge, setChallenge] = useState<SliderCaptchaChallenge | null>(null);
  const [sliderX, setSliderX] = useState(0);
  const [status, setStatus] = useState<CaptchaStatus>('loading');
  const [beatPercent, setBeatPercent] = useState<number | null>(null);
  const puzzleRef = useRef<HTMLDivElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const startClientXRef = useRef(0);
  const startSliderXRef = useRef(0);
  const pressedRef = useRef(false);
  const trajRef = useRef<Array<{ t: number; x: number }>>([]);
  const t0Ref = useRef(0);
  const [displayW, setDisplayW] = useState(0);
  const [trackW, setTrackW] = useState(0);

  const BTN = 36;
  const TRACK_PAD = 2;

  const reload = async () => {
    setStatus('loading');
    setBeatPercent(null);
    setSliderX(0);
    trajRef.current = [];
    try {
      const ch = await createSliderCaptcha();
      setChallenge(ch);
      setStatus('default');
    } catch {
      setStatus('error');
    }
  };

  // First enter captcha panel (parent only mounts when showCaptcha) — not open-listen refetch.
  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const el = puzzleRef.current;
    if (!el) return;
    const sync = () => setDisplayW(el.clientWidth);
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const sync = () => setTrackW(el.clientWidth);
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pieceW = challenge?.pieceWidth ?? challenge?.pieceSize ?? 44;
  const pieceH = challenge?.pieceHeight ?? challenge?.pieceSize ?? 44;
  const scale = challenge && displayW > 0 ? Math.max(0.01, displayW / challenge.bgWidth) : 1;
  const puzzleMax = challenge ? Math.max(0, (challenge.bgWidth - pieceW) * scale) : 0;
  const buttonMax = Math.max(0, (trackW || displayW) - BTN - TRACK_PAD * 2);
  const ratio = buttonMax > 0 ? puzzleMax / buttonMax : 1;
  const pieceX = sliderX * ratio;

  const onPointerDown = (e: ReactPointerEvent) => {
    if (!challenge || status !== 'default') return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    pressedRef.current = true;
    startClientXRef.current = e.clientX;
    startSliderXRef.current = sliderX;
    t0Ref.current = performance.now();
    trajRef.current = [{ t: 0, x: pieceX / scale }];
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    if (!pressedRef.current || !challenge) return;
    if (status !== 'default' && status !== 'moving') return;
    const dx = e.clientX - startClientXRef.current;
    const next = Math.max(0, Math.min(buttonMax, startSliderXRef.current + dx));
    if (next > 0 && status === 'default') setStatus('moving');
    setSliderX(next);
    trajRef.current.push({
      t: performance.now() - t0Ref.current,
      x: (next * ratio) / scale,
    });
  };

  const onPointerUp = async () => {
    if (!pressedRef.current || !challenge) return;
    pressedRef.current = false;
    if (status !== 'moving' && sliderX <= 0) {
      t0Ref.current = 0;
      return;
    }
    setStatus('verify');
    try {
      const res = await verifySliderCaptcha({
        captchaId: challenge.captchaId,
        x: pieceX / scale,
        email,
        trajectory: trajRef.current.slice(-40),
      });
      const pct =
        typeof res.beatPercent === 'number'
          ? Math.max(1, Math.min(99, Math.round(res.beatPercent)))
          : 80;
      setBeatPercent(pct);
      setStatus('success');
      window.setTimeout(() => onVerified(res.captchaToken), 700);
    } catch {
      setStatus('error');
      window.setTimeout(() => reload(), 500);
    } finally {
      t0Ref.current = 0;
    }
  };

  const tipInside = captchaTipText(t, status, beatPercent);

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 p-4">
      <div
        className="w-full max-w-[360px] overflow-hidden rounded-2xl bg-[var(--surface)] p-4 shadow-[0_16px_48px_rgba(0,0,0,0.18)] ring-1 ring-[var(--line)]"
        role="dialog"
        aria-modal
        aria-label={t('auth.captchaTitle')}
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-[15px] font-semibold text-[var(--ink)]">{t('auth.captchaTitle')}</h2>
          <button
            type="button"
            className="shrink-0 text-[13px] text-[var(--muted)] hover:text-[var(--ink)]"
            onClick={onCancel}
          >
            {t('common.cancel') || '取消'}
          </button>
        </div>

        <div
          ref={puzzleRef}
          className="relative w-full overflow-hidden rounded-md bg-[#f0f1f3] ring-1 ring-[var(--line)]"
          style={{ aspectRatio: '320 / 160' }}
        >
          {challenge ? (
            <>
              <img
                src={challenge.bg}
                alt=""
                className="pointer-events-none absolute inset-0 h-full w-full select-none object-fill"
                draggable={false}
              />
              <img
                src={challenge.piece}
                alt=""
                className="pointer-events-none absolute left-0 select-none"
                style={{
                  width: pieceW * scale,
                  height: pieceH * scale,
                  top: challenge.pieceY * scale,
                  transform: `translateX(${pieceX}px)`,
                  filter: 'drop-shadow(0 1px 3px rgba(0,0,0,0.45))',
                }}
                draggable={false}
              />
            </>
          ) : null}
          <button
            type="button"
            className="absolute right-1.5 top-1.5 z-[2] rounded bg-black/35 px-1.5 py-0.5 text-[11px] text-white hover:bg-black/50 disabled:opacity-40"
            onClick={() => reload()}
            disabled={status === 'verify' || status === 'success' || status === 'loading'}
            aria-label={t('auth.captchaRefresh')}
          >
            <HiArrowPath className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>

        <div
          ref={trackRef}
          className={cn(
            'relative mt-3 h-10 w-full select-none overflow-hidden rounded-full ring-1',
            captchaTrackClass(status)
          )}
        >
          <div
            className={cn(
              'pointer-events-none absolute inset-y-0 left-0 rounded-full',
              captchaFillClass(status)
            )}
            style={{
              width: Math.min(
                TRACK_PAD + sliderX + BTN / 2,
                trackW || TRACK_PAD + sliderX + BTN / 2
              ),
            }}
          />
          <button
            type="button"
            disabled={!challenge || status === 'verify' || status === 'success' || status === 'loading'}
            className={cn(
              'absolute top-0.5 flex h-9 w-9 items-center justify-center rounded-full text-[13px] font-semibold text-white shadow-sm',
              'disabled:opacity-60',
              captchaKnobClass(status)
            )}
            style={{ left: TRACK_PAD + sliderX }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={() => onPointerUp()}
            onPointerCancel={() => {
              pressedRef.current = false;
              t0Ref.current = 0;
              if (status === 'moving') {
                setSliderX(0);
                setStatus('default');
              }
            }}
            aria-label={t('auth.captchaHint')}
          >
            {status === 'success' ? (
              <HiCheck className="h-5 w-5" aria-hidden />
            ) : (
              <HiChevronDoubleRight className="h-4 w-4" aria-hidden />
            )}
          </button>
        </div>

        <p
          className={cn(
            'mt-2 min-h-[18px] text-left text-[12px] leading-[18px]',
            captchaTipClass(status)
          )}
          aria-hidden={status === 'moving'}
        >
          {status === 'moving' ? '\u00a0' : tipInside || '\u00a0'}
        </p>

        <button
          type="button"
          className="mt-3 text-[12px] text-[var(--muted)] underline-offset-2 hover:underline"
          onClick={() => reload()}
          disabled={status === 'verify' || status === 'success' || status === 'loading'}
        >
          {t('auth.captchaRefresh') || '换一张'}
        </button>
      </div>
    </div>
  );
}

type LoginDialogProps = {
  open: boolean;
  onClose: () => void;
  returnTo: string;
  onSuccess?: (returnTo: string) => void;
};

function LoginDialog({ open, onClose, returnTo, onSuccess }: LoginDialogProps) {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [resendLeft, setResendLeft] = useState(0);
  const [busy, setBusy] = useState(false);
  const [showCaptcha, setShowCaptcha] = useState(false);
  const [pendingCaptchaToken, setPendingCaptchaToken] = useState<string | null>(null);
  const [captchaResume, setCaptchaResume] = useState<'send-code' | null>(null);
  const agreedTermsRef = useRef(false);
  const [agreedTerms, setAgreedTerms] = useState(false);
  const [showAgreeModal, setShowAgreeModal] = useState(false);
  const pendingAfterAgreeRef = useRef<(() => void) | null>(null);

  const CODE_RESEND_COOLDOWN_SEC = 60;

  const startResendCooldown = () => setResendLeft(CODE_RESEND_COOLDOWN_SEC);

  // Host unmounts this dialog when closed — no useEffect([open]) reset/refetch.

  useEffect(() => {
    if (resendLeft <= 0) return;
    const id = window.setTimeout(() => setResendLeft((s) => Math.max(0, s - 1)), 1000);
    return () => window.clearTimeout(id);
  }, [resendLeft]);

  const markAgreedTerms = (next: boolean) => {
    agreedTermsRef.current = next;
    setAgreedTerms(next);
  };

  const ensureAgreedTerms = (resume?: () => void) => {
    if (agreedTermsRef.current) return true;
    pendingAfterAgreeRef.current = resume || null;
    setShowAgreeModal(true);
    return false;
  };

  const onAgreeModalCancel = () => {
    pendingAfterAgreeRef.current = null;
    setShowAgreeModal(false);
  };

  const onAgreeModalContinue = () => {
    markAgreedTerms(true);
    setShowAgreeModal(false);
    const resume = pendingAfterAgreeRef.current;
    pendingAfterAgreeRef.current = null;
    queueMicrotask(() => resume?.());
  };

  const finishLogin = (user: {
    email: string;
    name: string;
    provider: 'email' | 'google';
    avatar?: string | null;
    id?: string;
    role?: string;
  }, token: string) => {
    setSession({
        user: {
          email: user.email,
          name: user.name,
          provider: user.provider,
          avatar: user.avatar,
          id: user.id,
          role: user.role,
        },
        token,
      });
    message.success(t('auth.success'));
    onSuccess?.(returnTo);
    onClose();
  };

  const openCaptcha = (resume: 'send-code') => {
    setCaptchaResume(resume);
    setShowCaptcha(true);
    message.warning(t('auth.captchaNeed'));
  };

  const trySendCode = async (captchaToken?: string | null) => {
    const trimmed = email.trim().toLowerCase();
    const body: { email: string; captchaToken?: string } = { email: trimmed };
    if (captchaToken) body.captchaToken = captchaToken;
    await sendEmailCode(body);
    setPendingCaptchaToken(null);
    setShowCaptcha(false);
    setCaptchaResume(null);
    setEmail(trimmed);
    setCodeSent(true);
    startResendCooldown();
    message.success(t('auth.codeSent'));
  };

  const onGoogleContinue = () => {
    if (!ensureAgreedTerms(() => onGoogleContinue())) return;
    async function runGoogleLogin() {
      try {
        await startGoogleOAuthRedirect(returnTo);
      } catch {
        message.error(t('auth.googleFailed') || 'Google login failed');
      }
    }
    runGoogleLogin();
  };

  const onGetCode = async () => {
    if (!ensureAgreedTerms(() => onGetCode())) return;
    const trimmed = email.trim().toLowerCase();
    if (!trimmed || !trimmed.includes('@')) {
      message.error(t('auth.invalidEmail'));
      return;
    }
    if (resendLeft > 0) return;
    setBusy(true);
    try {
      await trySendCode(pendingCaptchaToken);
    } catch (err) {
      if (isNeedCaptcha(err)) openCaptcha('send-code');
      else message.error(getHttpErrorMessage(err, t('auth.sendFailed')));
    } finally {
      setBusy(false);
    }
  };

  const onLogin = async () => {
    if (!ensureAgreedTerms(() => onLogin())) return;
    const trimmed = email.trim().toLowerCase();
    const codeTrim = code.trim();
    if (!trimmed || !trimmed.includes('@')) {
      message.error(t('auth.invalidEmail'));
      return;
    }
    if (!/^\d{6}$/.test(codeTrim)) {
      message.error(t('auth.codeNeedSix'));
      return;
    }
    setBusy(true);
    try {
      const body: { email: string; code: string; captchaToken?: string } = {
        email: trimmed,
        code: codeTrim,
      };
      if (pendingCaptchaToken) body.captchaToken = pendingCaptchaToken;
      const res = await verifyEmailCode(body);
      setPendingCaptchaToken(null);
      finishLogin(
        {
          email: res.user.email,
          name: res.user.name,
          provider: 'email',
          avatar: res.user.avatar,
          id: res.user.id,
          role: res.user.role,
        },
        res.token
      );
    } catch (err) {
      if (isNeedCaptcha(err)) openCaptcha('send-code');
      else message.error(getHttpErrorMessage(err, t('auth.codeInvalid')));
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  return (
    <>
      {showCaptcha ? (
        <LoginSliderCaptcha
          email={email.trim().toLowerCase()}
          onCancel={() => {
            setShowCaptcha(false);
            setCaptchaResume(null);
          }}
          onVerified={(token) => {
            setPendingCaptchaToken(token);
            setShowCaptcha(false);
            setCaptchaResume(null);
            setBusy(true);
            async function retrySendCodeAfterCaptcha() {
              try {
                await trySendCode(token);
              } catch (err: unknown) {
                if (isNeedCaptcha(err)) openCaptcha('send-code');
                else message.error(getHttpErrorMessage(err, t('auth.sendFailed')));
              } finally {
                setBusy(false);
              }
            }
            retrySendCodeAfterCaptcha();
          }}
        />
      ) : null}

      <Dialog
        show={showAgreeModal}
        onClose={onAgreeModalCancel}
        width={420}
        className="!rounded-2xl !p-5"
        titleClassName="!pb-2 !text-[17px] !font-semibold"
        title={t('auth.agreeModalTitle')}
        footer={
          <>
            <Button
              type="default"
              className="!h-9 !rounded-full !px-4"
              onClick={onAgreeModalCancel}
            >
              {t('auth.agreeCancel')}
            </Button>
            <Button
              type="primary"
              className="!h-9 !rounded-full !px-4"
              onClick={onAgreeModalContinue}
            >
              {t('auth.agreeContinue')}
            </Button>
          </>
        }
      >
        <p className="text-[13px] leading-relaxed text-[var(--muted)]">
          <Trans
            i18nKey="auth.agreeTerms"
            components={{
              terms: (
                <a
                  href={docsUrl('/legal/terms')}
                  target="_blank"
                  rel="noreferrer"
                  className="text-inherit underline underline-offset-2 hover:text-[var(--ink)]"
                />
              ),
              privacy: (
                <a
                  href={docsUrl('/legal/privacy')}
                  target="_blank"
                  rel="noreferrer"
                  className="text-inherit underline underline-offset-2 hover:text-[var(--ink)]"
                />
              ),
            }}
          />
        </p>
      </Dialog>

      <div
        className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 px-8 py-10 sm:p-6 md:p-8"
        role="presentation"
        onClick={onClose}
      >
        <div
          className="relative w-full max-w-[min(100%,420px)] overflow-hidden rounded-2xl bg-white shadow-[0_24px_64px_rgba(0,0,0,0.22)] md:max-w-[660px]"
          role="dialog"
          aria-modal
          aria-labelledby="login-dialog-title"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex min-h-[min(480px,85vh)] w-full justify-center md:min-h-[480px]">
            <LoginArtPanel />

            <div className="relative flex w-full max-w-[380px] shrink-0 flex-col justify-center px-6 py-9 text-[#1a1a1a] sm:px-8 sm:py-10 md:w-[380px] md:px-9 md:py-12 [color-scheme:light]">
              <button
                type="button"
                className="absolute right-3 top-3 z-20 flex h-8 w-8 items-center justify-center rounded-lg text-[#999] transition hover:bg-[#f5f5f5] hover:text-[#333]"
                onClick={onClose}
                aria-label={t('common.close') || 'Close'}
              >
                <HiOutlineXMark className="h-5 w-5" />
              </button>

              <h2
                id="login-dialog-title"
                className="pr-8 text-[22px] font-semibold leading-tight text-[#1a1a1a]"
              >
                {t('auth.login')}
              </h2>
              <p className="mt-2 text-[13px] leading-relaxed text-[#888]">
                {t('auth.welcomeSubtitle')}
              </p>

              <div className="mt-7 space-y-4">
                <Input
                  size="large"
                  type="outlined"
                  inputType="email"
                  placeholder={t('auth.emailPlaceholder')}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') onGetCode();
                  }}
                  className="!h-11 !rounded-lg !border-[#e5e5e5] !bg-white !px-3.5 !text-[#1a1a1a] placeholder:!text-[#aaa]"
                />

                <div className="relative">
                  <Input
                    size="large"
                    type="outlined"
                    inputType="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    placeholder={t('auth.codePlaceholder')}
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') onLogin();
                    }}
                    className="!h-11 !rounded-lg !border-[#e5e5e5] !bg-white !px-3.5 !pr-24 !text-[#1a1a1a] placeholder:!text-[#aaa]"
                  />
                  <button
                    type="button"
                    disabled={busy || resendLeft > 0}
                    onClick={() => onGetCode()}
                    className={cn(
                      'absolute right-3 top-1/2 -translate-y-1/2 text-[13px] font-medium text-[#333] transition hover:text-[#111]',
                      (busy || resendLeft > 0) && 'cursor-not-allowed opacity-50 hover:text-[#333]',
                    )}
                  >
                    {busy
                      ? t('auth.sending')
                      : resendLeft > 0
                        ? t('auth.resendIn', { seconds: resendLeft })
                        : codeSent
                          ? t('auth.resend')
                          : t('auth.getCode')}
                  </button>
                </div>

                <label className="flex items-start gap-2.5 text-[12px] leading-relaxed text-[#999]">
                  <Checkbox
                    shape="circle"
                    size="small"
                    type="outlined"
                    checked={agreedTerms}
                    onChange={(e) => markAgreedTerms(e.target.checked)}
                    className="mt-0.5 shrink-0 border-[1.5px] border-[#888] bg-white text-[#888] data-checked:border-[#888] data-checked:bg-white data-checked:text-[#888] data-checked:data-hover:border-[#888] data-checked:data-hover:bg-white data-indeterminate:border-[#888] data-indeterminate:bg-white data-indeterminate:text-[#888]"
                    aria-label={t('auth.agreeRequired')}
                  />
                  <span className="min-w-0 pt-px">
                    <Trans
                      i18nKey="auth.agreeTerms"
                      components={{
                        terms: (
                          <a
                            href={docsUrl('/legal/terms')}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[#666] underline underline-offset-2 hover:text-[#333]"
                            onClick={(e) => e.stopPropagation()}
                          />
                        ),
                        privacy: (
                          <a
                            href={docsUrl('/legal/privacy')}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[#666] underline underline-offset-2 hover:text-[#333]"
                            onClick={(e) => e.stopPropagation()}
                          />
                        ),
                      }}
                    />
                  </span>
                </label>

                <Button
                  type="primary"
                  className="!h-11 !w-full !rounded-lg !border-none !bg-[#1a1a1a] !text-[14px] !font-medium !text-white hover:!bg-[#333]"
                  loading={busy}
                  onClick={() => onLogin()}
                >
                  {busy ? t('auth.sending') : t('auth.login')}
                </Button>

                <div className="flex items-center gap-3 py-1 text-[12px] text-[#bbb]">
                  <span className="h-px flex-1 bg-[#eee]" />
                  <span className="shrink-0">{t('auth.orSocial')}</span>
                  <span className="h-px flex-1 bg-[#eee]" />
                </div>

                <button
                  type="button"
                  disabled={busy}
                  onClick={onGoogleContinue}
                  className="mx-auto flex h-11 w-11 items-center justify-center rounded-lg border border-[#e5e5e5] bg-white transition hover:bg-[#fafafa] disabled:opacity-60"
                  title={t('auth.google')}
                  aria-label={t('auth.google')}
                >
                  <Icon name="auth-google" width={20} height={20} />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

/** Global host: opens when URL has `?login=1`. */
function LoginDialogHost() {
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const user = useSelector((state: { auth?: { user?: unknown } }) => state.auth?.user);
  const hasToken = Boolean(getToken());
  const open = isLoginOpen(searchParams);
  const returnTo = readReturnToParam(searchParams);

  const closeLogin = useCallback(() => {
    const next = new URLSearchParams(searchParams);
    next.delete('login');
    next.delete('from');
    const path = location.pathname === '/login' ? '/home' : location.pathname;
    const qs = next.toString();
    navigate(`${path}${qs ? `?${qs}` : ''}`, { replace: true });
  }, [location.pathname, navigate, searchParams]);

  const onSuccess = useCallback(
    (dest: string) => {
      navigate(dest, { replace: true });
    },
    [navigate]
  );

  // Already signed in while ?login=1 — bounce to returnTo (routing, not data prefetch).
  useEffect(() => {
    if (open && user && hasToken) {
      navigate(returnTo, { replace: true });
    }
  }, [open, user, hasToken, navigate, returnTo]);

  // Mount LoginDialog only while the login modal is open (click / ?login=1).
  if (!open || (user && hasToken)) return null;

  return (
    <LoginDialog open={open} onClose={closeLogin} returnTo={returnTo} onSuccess={onSuccess} />
  );
}

const MemoizedLoginDialog = memo(LoginDialog);
export { MemoizedLoginDialog as LoginDialog };
const MemoizedLoginDialogHost = memo(LoginDialogHost);
export { MemoizedLoginDialogHost as LoginDialogHost };
