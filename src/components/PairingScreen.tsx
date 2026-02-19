// ═══════════════════════════════════════════════════════════
// PairingScreen — Auto-Pair with OpenClaw Gateway
//
// Shows a pairing code and waits for the user to approve
// the device in OpenClaw Gateway (CLI or web UI).
// Polls every 3 seconds until approved or cancelled.
// ═══════════════════════════════════════════════════════════

import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ShieldCheck, RefreshCw, X, Loader2, Key, CheckCircle2, AlertTriangle } from 'lucide-react';

interface PairingScreenProps {
  /** HTTP base URL of the Gateway (derived from WS URL) */
  gatewayHttpUrl: string;
  /** Called when pairing is approved with the new token */
  onPaired: (token: string) => void;
  /** Called when user cancels pairing */
  onCancel: () => void;
  /** The scope/auth error message that triggered pairing */
  errorMessage?: string;
}

type PairingState = 'idle' | 'requesting' | 'waiting' | 'approved' | 'error';

export function PairingScreen({ gatewayHttpUrl, onPaired, onCancel, errorMessage }: PairingScreenProps) {
  const { t, i18n } = useTranslation();
  const isRTL = i18n.dir() === 'rtl';

  const [state, setState] = useState<PairingState>('idle');
  const [code, setCode] = useState<string>('');
  const [deviceId, setDeviceId] = useState<string>('');
  const [error, setError] = useState<string>('');
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

  // Cleanup on unmount
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, []);

  // Start pairing automatically on mount
  useEffect(() => {
    requestPairing();
  }, []);

  const requestPairing = useCallback(async () => {
    // Stop any existing polling
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }

    setState('requesting');
    setError('');
    setCode('');
    setDeviceId('');

    try {
      let result: { code: string; deviceId: string };

      // Try IPC first (Electron main process), fallback to direct fetch
      if (window.aegis?.pairing?.requestPairing) {
        result = await window.aegis.pairing.requestPairing(gatewayHttpUrl);
      } else {
        const res = await fetch(`${gatewayHttpUrl}/v1/pair`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clientId: 'openclaw-control-ui',
            clientName: 'AEGIS Desktop',
            platform: 'windows',
            scopes: ['operator.read', 'operator.write', 'operator.admin'],
          }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        result = await res.json();
      }

      if (!mountedRef.current) return;

      setCode(result.code);
      setDeviceId(result.deviceId);
      setState('waiting');

      // Start polling for approval
      startPolling(result.deviceId);
    } catch (err: any) {
      if (!mountedRef.current) return;
      console.error('[Pairing] Request failed:', err);
      setError(err.message || 'Failed to request pairing');
      setState('error');
    }
  }, [gatewayHttpUrl]);

  const startPolling = useCallback((devId: string) => {
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);

    pollTimerRef.current = setInterval(async () => {
      try {
        let result: { status: string; token?: string };

        if (window.aegis?.pairing?.poll) {
          result = await window.aegis.pairing.poll(gatewayHttpUrl, devId);
        } else {
          const res = await fetch(`${gatewayHttpUrl}/v1/pair/${encodeURIComponent(devId)}/status`);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          result = await res.json();
        }

        if (!mountedRef.current) return;

        if (result.status === 'approved' && result.token) {
          // Stop polling
          if (pollTimerRef.current) {
            clearInterval(pollTimerRef.current);
            pollTimerRef.current = null;
          }

          setState('approved');

          // Save token via IPC
          if (window.aegis?.pairing?.saveToken) {
            await window.aegis.pairing.saveToken(result.token);
          }

          // Notify parent after a brief success animation
          setTimeout(() => {
            if (mountedRef.current) {
              onPaired(result.token!);
            }
          }, 1200);
        } else if (result.status === 'rejected') {
          if (pollTimerRef.current) {
            clearInterval(pollTimerRef.current);
            pollTimerRef.current = null;
          }
          setState('error');
          setError('Pairing was rejected. Please try again.');
        }
        // 'pending' → keep polling
      } catch (err: any) {
        // Network errors during poll are non-fatal — keep trying
        console.warn('[Pairing] Poll error (will retry):', err.message);
      }
    }, 3000);
  }, [gatewayHttpUrl, onPaired]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#0a0a14]"
      dir={isRTL ? 'rtl' : 'ltr'}
    >
      {/* Background pattern */}
      <div className="absolute inset-0 opacity-5">
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: 'radial-gradient(circle at 25% 25%, rgb(var(--aegis-primary)) 1px, transparent 1px)',
            backgroundSize: '40px 40px',
          }}
        />
      </div>

      {/* Main card */}
      <div className="relative w-full max-w-md mx-4 rounded-2xl bg-[#12121e] border border-[#1e1e30] shadow-2xl overflow-hidden">
        {/* Top gradient bar */}
        <div className="h-1 bg-gradient-to-r from-aegis-primary via-aegis-accent to-aegis-primary" />

        {/* Cancel button */}
        <button
          onClick={onCancel}
          className="absolute top-4 end-4 p-1.5 rounded-lg text-gray-500 hover:text-gray-300 hover:bg-[#1e1e30] transition-colors"
          title="Cancel"
        >
          <X size={18} />
        </button>

        <div className="p-8 flex flex-col items-center text-center">
          {/* Icon */}
          <div className={`
            w-16 h-16 rounded-2xl flex items-center justify-center mb-6
            ${state === 'approved'
              ? 'bg-emerald-500/20 text-emerald-400'
              : state === 'error'
                ? 'bg-red-500/20 text-red-400'
                : 'bg-aegis-primary/20 text-aegis-primary'}
            transition-colors duration-500
          `}>
            {state === 'approved' ? (
              <CheckCircle2 size={32} className="animate-pulse" />
            ) : state === 'error' ? (
              <AlertTriangle size={32} />
            ) : state === 'requesting' ? (
              <Loader2 size={32} className="animate-spin" />
            ) : (
              <Key size={32} />
            )}
          </div>

          {/* Title */}
          <h2 className="text-xl font-bold text-aegis-text mb-2">
            {state === 'approved'
              ? (isRTL ? 'تم الربط بنجاح!' : 'Paired Successfully!')
              : state === 'error'
                ? (isRTL ? 'خطأ في الربط' : 'Pairing Error')
                : (isRTL ? 'ربط مع Gateway' : 'Pair with Gateway')}
          </h2>

          {/* Subtitle / Error */}
          {errorMessage && state === 'idle' && (
            <p className="text-sm text-amber-400/80 mb-4 font-mono bg-amber-500/10 px-3 py-1.5 rounded-lg">
              {errorMessage}
            </p>
          )}

          {state === 'error' && error && (
            <p className="text-sm text-red-400/80 mb-4">{error}</p>
          )}

          {/* Pairing code display */}
          {(state === 'waiting' || state === 'approved') && code && (
            <div className="w-full mb-6">
              <p className="text-sm text-gray-400 mb-3">
                {isRTL ? 'أدخل هذا الكود في Gateway:' : 'Enter this code in Gateway:'}
              </p>

              {/* Code display */}
              <div className={`
                py-4 px-6 rounded-xl bg-[#0a0a14] border-2 transition-colors duration-500
                ${state === 'approved' ? 'border-emerald-500/50' : 'border-aegis-primary/30'}
              `}>
                <span className="text-4xl font-mono font-bold tracking-[0.3em] text-white select-all">
                  {code}
                </span>
              </div>

              {/* Instructions */}
              {state === 'waiting' && (
                <div className="mt-5 space-y-2 text-start">
                  <p className="text-xs text-gray-500 flex items-center gap-2">
                    <ShieldCheck size={14} className="text-aegis-primary shrink-0" />
                    <span>
                      {isRTL
                        ? 'افتح Terminal وشغّل: openclaw gateway approve'
                        : 'Open Terminal and run: openclaw gateway approve'}
                    </span>
                  </p>
                  <p className="text-xs text-gray-500 flex items-center gap-2">
                    <ShieldCheck size={14} className="text-aegis-primary shrink-0" />
                    <span>
                      {isRTL
                        ? 'أو وافق من واجهة OpenClaw الرئيسية'
                        : 'Or approve from the OpenClaw dashboard'}
                    </span>
                  </p>
                </div>
              )}

              {/* Polling indicator */}
              {state === 'waiting' && (
                <div className="mt-4 flex items-center justify-center gap-2 text-xs text-gray-500">
                  <Loader2 size={12} className="animate-spin text-aegis-primary" />
                  <span>{isRTL ? 'في انتظار الموافقة...' : 'Waiting for approval...'}</span>
                </div>
              )}
            </div>
          )}

          {/* Requesting state */}
          {state === 'requesting' && (
            <div className="my-6 flex items-center gap-2 text-sm text-gray-400">
              <Loader2 size={16} className="animate-spin text-aegis-primary" />
              <span>{isRTL ? 'جاري طلب الربط...' : 'Requesting pairing...'}</span>
            </div>
          )}

          {/* Approved state */}
          {state === 'approved' && (
            <div className="my-4 flex items-center gap-2 text-sm text-emerald-400">
              <CheckCircle2 size={16} />
              <span>{isRTL ? 'جاري إعادة الاتصال...' : 'Reconnecting...'}</span>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex gap-3 w-full mt-2">
            {state === 'error' && (
              <button
                onClick={requestPairing}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl
                  bg-aegis-primary hover:bg-[#3db89f] text-black font-semibold text-sm
                  transition-colors"
              >
                <RefreshCw size={16} />
                <span>{isRTL ? 'إعادة المحاولة' : 'Retry'}</span>
              </button>
            )}
            {(state === 'error' || state === 'idle') && (
              <button
                onClick={onCancel}
                className="flex-1 py-2.5 px-4 rounded-xl border border-[#2a2a3e]
                  text-gray-400 hover:text-white hover:border-[#3a3a5e] text-sm
                  transition-colors"
              >
                {isRTL ? 'إلغاء' : 'Cancel'}
              </button>
            )}
          </div>
        </div>

        {/* Bottom info */}
        <div className="px-8 pb-6">
          <div className="text-[10px] text-gray-600 text-center leading-relaxed">
            {isRTL
              ? 'يحتاج AEGIS Desktop إلى token صالح للاتصال بـ OpenClaw Gateway. هذا الربط يتم مرة واحدة فقط.'
              : 'AEGIS Desktop needs a valid token to connect to OpenClaw Gateway. This pairing is a one-time setup.'}
          </div>
        </div>
      </div>
    </div>
  );
}
