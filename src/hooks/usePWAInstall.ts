import { useState, useEffect, useCallback } from 'react';

const DISMISS_KEY = 'banddan_pwa_dismissed_until';
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export function usePWAInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isStandalone, setIsStandalone] = useState<boolean>(false);
  const [showModal, setShowModal] = useState<boolean>(false);
  const [isIOS, setIsIOS] = useState<boolean>(false);

  useEffect(() => {
    // Check if running in standalone display mode
    const checkStandalone = () => {
      const isStandaloneMode =
        window.matchMedia('(display-mode: standalone)').matches ||
        (navigator as unknown as { standalone?: boolean }).standalone === true;
      setIsStandalone(isStandaloneMode);
    };

    checkStandalone();

    // Detect iOS device
    const ua = window.navigator.userAgent;
    const isIOSDevice = /iPhone|iPad|iPod/.test(ua) && !(window as unknown as { MSStream?: unknown }).MSStream;
    setIsIOS(isIOSDevice);

    // Listen for beforeinstallprompt
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      const promptEvent = e as BeforeInstallPromptEvent;
      setDeferredPrompt(promptEvent);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, []);

  useEffect(() => {
    if (!showModal) return;

    const handlePopState = () => {
      setShowModal(false);
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [showModal]);

  const snooze7Days = useCallback(() => {
    const nextRemind = Date.now() + SEVEN_DAYS_MS;
    localStorage.setItem(DISMISS_KEY, nextRemind.toString());
    setShowModal(false);
  }, []);

  const triggerInstall = useCallback(async () => {
    if (deferredPrompt) {
      try {
        await deferredPrompt.prompt();
        const choiceResult = await deferredPrompt.userChoice;
        if (choiceResult.outcome === 'accepted') {
          setShowModal(false);
          setDeferredPrompt(null);
        } else {
          // If they dismiss it, just close the modal
          setShowModal(false);
        }
      } catch (err) {
        console.error("Failed to prompt install", err);
      }
    } else {
      // Show modal modal instructions (iOS or manually clicked)
      setShowModal(true);
    }
  }, [deferredPrompt]);

  const openModalManually = useCallback(() => {
    setShowModal(true);
  }, []);

  const closeModal = useCallback(() => {
    snooze7Days();
  }, [snooze7Days]);

  return {
    isInstallable: !!deferredPrompt || isIOS,
    isStandalone,
    showModal,
    isIOS,
    hasDeferredPrompt: !!deferredPrompt,
    triggerInstall,
    openModalManually,
    closeModal,
    snooze7Days,
  };
}
