import React from 'react';
import { Download, Smartphone, Zap, ShieldCheck, X, Share, PlusSquare } from 'lucide-react';

interface PWAInstallModalProps {
  isOpen: boolean;
  onClose: () => void;
  onInstall: () => void;
  isIOS: boolean;
  hasDeferredPrompt: boolean;
}

export const PWAInstallModal: React.FC<PWAInstallModalProps> = ({
  isOpen,
  onClose,
  onInstall,
  isIOS,
  hasDeferredPrompt,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in" onClick={onClose}>
      <div 
        className="relative w-full max-w-md bg-[#0A0D14] border border-[#00FF41]/30 rounded-3xl p-5 sm:p-6 shadow-[0_0_50px_rgba(0,255,65,0.15)] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        
        {/* Glow ambient background accents */}
        <div className="absolute -top-24 -right-24 w-48 h-48 rounded-full bg-[#00FF41]/10 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -left-24 w-48 h-48 rounded-full bg-[#00FF41]/5 blur-3xl pointer-events-none" />

        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 text-zinc-400 hover:text-white bg-white/5 hover:bg-white/10 rounded-full transition-colors cursor-pointer"
          title="Close"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Header Icon & Title */}
        <div className="flex items-center gap-3.5 mb-5">
          <div className="w-12 h-12 rounded-2xl bg-[#00FF41]/10 border border-[#00FF41]/40 flex items-center justify-center shrink-0 shadow-[0_0_15px_rgba(0,255,65,0.2)]">
            <Download className="w-6 h-6 text-[#00FF41]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-extrabold tracking-tight text-white uppercase font-mono">
                INSTALL BAND<span className="text-[#00FF41]">DAN</span>
              </h2>
              <span className="px-2 py-0.5 bg-[#00FF41]/10 border border-[#00FF41]/30 text-[#00FF41] text-[8px] font-mono font-bold rounded-full">
                PWA
              </span>
            </div>
            <p className="text-3xs text-zinc-400 font-mono uppercase tracking-wider mt-0.5">
              Add to Home Screen for Live Performance
            </p>
          </div>
        </div>

        {/* Value Proposition List */}
        <div className="space-y-2.5 mb-6">
          <div className="p-3 bg-white/[0.02] border border-white/5 rounded-2xl flex items-start gap-3">
            <div className="p-1.5 bg-[#00FF41]/10 rounded-xl shrink-0 mt-0.5">
              <Zap className="w-4 h-4 text-[#00FF41]" />
            </div>
            <div>
              <h3 className="text-2xs font-mono font-bold text-white uppercase">Full-Screen Conducting</h3>
              <p className="text-3xs text-zinc-400 font-mono leading-relaxed mt-0.5">
                Zero browser URL bar clutter during live hand gesture synth performances.
              </p>
            </div>
          </div>

          <div className="p-3 bg-white/[0.02] border border-white/5 rounded-2xl flex items-start gap-3">
            <div className="p-1.5 bg-[#00FF41]/10 rounded-xl shrink-0 mt-0.5">
              <Smartphone className="w-4 h-4 text-[#00FF41]" />
            </div>
            <div>
              <h3 className="text-2xs font-mono font-bold text-white uppercase">Instant 1-Tap Access</h3>
              <p className="text-3xs text-zinc-400 font-mono leading-relaxed mt-0.5">
                Launch BandDan like a native mobile or desktop application anytime.
              </p>
            </div>
          </div>

          <div className="p-3 bg-white/[0.02] border border-white/5 rounded-2xl flex items-start gap-3">
            <div className="p-1.5 bg-[#00FF41]/10 rounded-xl shrink-0 mt-0.5">
              <ShieldCheck className="w-4 h-4 text-[#00FF41]" />
            </div>
            <div>
              <h3 className="text-2xs font-mono font-bold text-white uppercase">Low-Latency Wireless Sync</h3>
              <p className="text-3xs text-zinc-400 font-mono leading-relaxed mt-0.5">
                Optimized browser runtime privileges for real-time sound synthesis.
              </p>
            </div>
          </div>
        </div>

        {/* iOS Specific Instructions */}
        {isIOS && !hasDeferredPrompt && (
          <div className="mb-6 p-3.5 bg-[#00FF41]/5 border border-[#00FF41]/20 rounded-2xl space-y-2 text-3xs font-mono text-zinc-300">
            <div className="text-2xs font-bold text-[#00FF41] uppercase flex items-center gap-1.5">
              <Share className="w-3.5 h-3.5" />
              <span>iOS / Safari Installation Steps:</span>
            </div>
            <ol className="list-decimal list-inside space-y-1 text-zinc-300">
              <li>Tap the <span className="text-white font-bold inline-flex items-center gap-1">Share button <Share className="w-3 h-3 text-[#00FF41] inline" /></span> at the bottom of Safari.</li>
              <li>Scroll down and tap <span className="text-white font-bold inline-flex items-center gap-1">Add to Home Screen <PlusSquare className="w-3 h-3 text-[#00FF41] inline" /></span>.</li>
              <li>Tap <span className="text-[#00FF41] font-bold">Add</span> in the top right corner.</li>
            </ol>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex flex-col gap-2">
          {!isIOS && (
            <button
              onClick={onInstall}
              className="w-full py-3 bg-[#00FF41] hover:bg-[#22ff5a] active:scale-98 text-black font-mono font-bold text-xs uppercase tracking-wider rounded-xl transition-all duration-200 cursor-pointer shadow-[0_4px_20px_rgba(0,255,65,0.25)] flex items-center justify-center gap-2"
            >
              <Download className="w-4 h-4 text-black" />
              <span>INSTALL APP</span>
            </button>
          )}

          {isIOS && (
            <button
              onClick={onClose}
              className="w-full py-3 bg-[#00FF41] hover:bg-[#22ff5a] text-black font-mono font-bold text-xs uppercase tracking-wider rounded-xl transition-all duration-200 cursor-pointer flex items-center justify-center gap-2"
            >
              <span>GOT IT, THANKS</span>
            </button>
          )}
        </div>

      </div>
    </div>
  );
};
