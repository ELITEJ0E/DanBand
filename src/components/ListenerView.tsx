import { useState, useEffect, useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Html5Qrcode } from 'html5-qrcode';
import { RTC_CONFIG, decompressSDP, compressSDP, waitForIceGathering } from '../utils/webrtc';
import { WebRTCMessage, ConnectionStatus } from '../types';
import { playChordSound } from '../utils/audio';
import { 
  Smartphone, 
  Camera, 
  Wifi, 
  CheckCircle, 
  AlertTriangle, 
  X, 
  RefreshCw, 
  Radio, 
  LogOut,
  Sparkles,
  Volume2,
  VolumeX,
  ArrowLeft,
  Download
} from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { PWAInstallModal } from './PWAInstallModal';

interface ListenerViewProps {
  onExit?: () => void;
}

export default function ListenerView({ onExit }: ListenerViewProps) {
  // PWA Install hook
  const pwa = usePWAInstall();

  // Local Settings
  const [displayName, setDisplayName] = useState<string>(() => {
    return localStorage.getItem('banddan_display_name') || 'Keys';
  });
  const [soundEnabled, setSoundEnabled] = useState<boolean>(() => {
    return localStorage.getItem('banddan_listener_sound_enabled') === 'true';
  });

  const toggleSound = () => {
    const newValue = !soundEnabled;
    setSoundEnabled(newValue);
    localStorage.setItem('banddan_listener_sound_enabled', String(newValue));
  };

  const soundEnabledRef = useRef<boolean>(soundEnabled);
  useEffect(() => {
    soundEnabledRef.current = soundEnabled;
  }, [soundEnabled]);

  // Pairing States
  const [pairingStep, setPairingStep] = useState<'name_entry' | 'scanning_conductor' | 'generating_answer' | 'show_answer_qr' | 'listening'>('name_entry');
  const [scannedOffer, setScannedOffer] = useState<RTCSessionDescriptionInit | null>(null);
  const [answerQRValue, setAnswerQRValue] = useState<string>('');
  const [pairingError, setPairingError] = useState<string | null>(null);

  // Manual fallback states
  const [manualOfferInput, setManualOfferInput] = useState<string>('');
  const [copiedAnswer, setCopiedAnswer] = useState<boolean>(false);

  const copyAnswerToClipboard = () => {
    if (!answerQRValue) return;
    navigator.clipboard.writeText(answerQRValue)
      .then(() => {
        setCopiedAnswer(true);
        setTimeout(() => setCopiedAnswer(false), 2000);
      })
      .catch((err) => console.error('Failed to copy answer code:', err));
  };

  const handleManualOfferSubmit = async () => {
    const sdpText = manualOfferInput.trim();
    if (!sdpText) return;
    await handleScannedOffer(sdpText);
  };

  // Connection State
  const [peerConnection, setPeerConnection] = useState<RTCPeerConnection | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected');
  const [activeChord, setActiveChord] = useState<string>('WAIT');
  const [lastUpdateTime, setLastUpdateTime] = useState<number>(0);
  const [isPulsing, setIsPulsing] = useState<boolean>(false);

  // Scanner ref
  const [scannerActive, setScannerActive] = useState<boolean>(false);
  const scannerRef = useRef<Html5Qrcode | null>(null);

  // Save display name when modified
  const handleNameChange = (val: string) => {
    setDisplayName(val);
    localStorage.setItem('banddan_display_name', val);
  };

  // Start scanning Conductor QR
  const startConductorScanner = async () => {
    if (!displayName.trim()) {
      alert('Please enter a display name first.');
      return;
    }
    setPairingStep('scanning_conductor');
    setScannerActive(true);
    setPairingError(null);

    setTimeout(async () => {
      try {
        const html5Qrcode = new Html5Qrcode('conductor-reader');
        scannerRef.current = html5Qrcode;

        await html5Qrcode.start(
          { facingMode: 'environment' },
          {
            fps: 15,
            qrbox: (width, height) => {
              const size = Math.min(width, height) * 0.85;
              return { width: size, height: size };
            },
          },
          async (decodedText) => {
            await handleScannedOffer(decodedText);
          },
          () => {}
        );
      } catch (err) {
        console.error('Failed to start camera for scanning:', err);
        setPairingError('Could not start the QR scanner. Check browser camera permissions.');
        setScannerActive(false);
      }
    }, 150);
  };

  const stopScanner = async () => {
    if (scannerRef.current) {
      try {
        if (scannerRef.current.isScanning) {
          await scannerRef.current.stop();
        }
      } catch (e) {
        console.error('Error stopping scanner:', e);
      }
      scannerRef.current = null;
    }
    setScannerActive(false);
  };

  const cancelScanning = async () => {
    await stopScanner();
    setPairingStep('name_entry');
    setPairingError(null);
  };

  // Handle scanned Conductor offer QR
  const handleScannedOffer = async (compressedOffer: string) => {
    await stopScanner();
    setPairingStep('generating_answer');
    setPairingError(null);
    setManualOfferInput('');

    try {
      const offerDesc = decompressSDP(compressedOffer);
      if (!offerDesc || offerDesc.type !== 'offer') {
        throw new Error('Scanned code is not a valid Conductor Offer.');
      }

      setScannedOffer(offerDesc);

      // Create peer connection
      const pc = new RTCPeerConnection(RTC_CONFIG);
      setPeerConnection(pc);

      // Listener listens for incoming data channel
      pc.ondatachannel = (event) => {
        const dc = event.channel;
        console.log('Received data channel "chords" from Conductor');

        dc.onopen = () => {
          console.log('Data channel fully OPEN!');
          // Send identity back to Conductor
          const identity = { type: 'identify', name: displayName.trim() };
          try {
            dc.send(JSON.stringify(identity));
          } catch (e) {
            console.error('Error sending identity:', e);
          }
          // Shift directly to listening mode once data channel is open!
          setPairingStep('listening');
        };

        dc.onmessage = (msgEvent) => {
          try {
            const parsed = JSON.parse(msgEvent.data) as WebRTCMessage;
            if (parsed.type === 'chord') {
              setActiveChord(parsed.value);
              setLastUpdateTime(parsed.ts || Date.now());
              
              if (soundEnabledRef.current && parsed.value && parsed.value !== '—') {
                playChordSound(parsed.value);
              }

              // Trigger physical vibration
              if ('vibrate' in navigator) {
                try {
                  navigator.vibrate(120);
                } catch (vibErr) {
                  // Ignore vibrate permission errors
                }
              }

              // Trigger a visual screen flash/pulse
              setIsPulsing(true);
              setTimeout(() => setIsPulsing(false), 250);
            }
          } catch (e) {
            console.error('Error parsing data channel message on Listener:', e);
          }
        };

        dc.onclose = () => {
          console.log('Data channel closed on Listener');
        };
      };

      // Set connection state listener
      pc.onconnectionstatechange = () => {
        const state = pc.connectionState;
        console.log(`Listener peer connection state: ${state}`);
        
        let status: ConnectionStatus = 'disconnected';
        if (state === 'connected') status = 'connected';
        if (state === 'connecting') status = 'connecting';
        if (state === 'disconnected' || state === 'closed') status = 'disconnected';
        if (state === 'failed') status = 'failed';

        setConnectionStatus(status);
        if (state === 'connected') {
          setPairingStep('listening');
        }
      };

      // Set remote description
      await pc.setRemoteDescription(offerDesc);

      // Create answer
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      // Wait for complete ICE gathering before generating QR
      await waitForIceGathering(pc);

      // Compress answer SDP
      const compressedAnswer = compressSDP({
        type: pc.localDescription!.type,
        sdp: pc.localDescription!.sdp,
      });

      setAnswerQRValue(compressedAnswer);
      setPairingStep('show_answer_qr');
    } catch (err: any) {
      console.error('Failed to parse offer or generate answer:', err);
      setPairingError(err.message || 'Error configuring Peer Connection. Please try scanning again.');
      setPairingStep('name_entry');
    }
  };

  // Leave active connection and return to homepage
  const disconnectAndReset = () => {
    if (peerConnection) {
      peerConnection.close();
    }
    setPeerConnection(null);
    setConnectionStatus('disconnected');
    setPairingStep('name_entry');
    setActiveChord('WAIT');
    setManualOfferInput('');
    setCopiedAnswer(false);
  };

  // Sync state with browser history for back-button support on mobile
  useEffect(() => {
    const isSubActive = pairingStep !== 'name_entry';

    const handlePopState = () => {
      if (pairingStep !== 'name_entry') {
        if (pairingStep === 'listening') {
          disconnectAndReset();
        } else {
          // If scanning, stop camera
          if (scannerRef.current) {
            try {
              if (scannerRef.current.isScanning) {
                scannerRef.current.stop();
              }
            } catch (e) {
              console.error('Error stopping scanner from popstate:', e);
            }
            scannerRef.current = null;
          }
          setScannerActive(false);
          setPairingStep('name_entry');
        }
      }
    };

    if (isSubActive) {
      window.history.pushState({ isListenerSubActive: true }, '');
    }

    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, [pairingStep]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (peerConnection) {
        peerConnection.close();
      }
    };
  }, [peerConnection]);

  return (
    <div 
      id="listener_workspace" 
      className={`min-h-screen transition-all duration-300 ${
        isPulsing ? 'bg-[#00FF41]/20' : 'bg-[#07070B] bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-[#131128] via-[#07070B] to-[#030305]'
      } text-[#E0E0E0] flex flex-col p-5 md:p-8 pb-24 select-none relative overflow-hidden`}
    >
      
      {/* iOS-Style ambient background glows */}
      <div className="absolute top-0 left-[20%] w-[50%] aspect-square rounded-full bg-[#00FF41]/3 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[20%] right-[-10%] w-[40%] aspect-square rounded-full bg-[#3B82F6]/3 blur-[120px] pointer-events-none" />

      {/* Sleek Navigation Bar (hidden during active performance) */}
      {pairingStep !== 'listening' && (
        <div className="w-full max-w-sm mx-auto flex items-center justify-between gap-2 pb-4 relative z-10 border-b border-white/5 mb-6">
          <div className="flex items-center gap-3">
            {onExit && (
              <button
                onClick={onExit}
                className="flex items-center gap-1 px-2 py-1 bg-red-950/30 hover:bg-red-900/40 text-red-400 hover:text-red-300 border border-red-500/20 hover:border-red-500/40 text-4xs font-mono font-bold rounded-xl transition-all duration-200 cursor-pointer active:scale-95 uppercase tracking-wider shrink-0"
                title="Quit Session"
              >
                <ArrowLeft className="w-3 h-3" />
                <span>QUIT</span>
              </button>
            )}
            <div className="flex items-center gap-2">
              <img 
                src="/pwa-192x192.png" 
                alt="BandDan Icon" 
                referrerPolicy="no-referrer"
                className="w-6 h-6 rounded-lg border border-[#00FF41]/40 shrink-0 object-cover shadow-[0_0_10px_rgba(0,255,65,0.25)]" 
              />
              <span className="text-xs font-mono font-extrabold tracking-tight text-white uppercase select-none">
                BAND<span className="text-[#00FF41]">DAN</span>
              </span>
              <div className="px-1.5 py-0.5 bg-[#00FF41]/10 border border-[#00FF41]/20 rounded-full text-[7px] font-mono tracking-wider text-[#00FF41] font-bold">
                BANDMATE
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {!pwa.isStandalone && (
              <button
                onClick={pwa.triggerInstall}
                className="flex items-center gap-1 px-2 py-1 rounded-lg border border-[#00FF41]/30 bg-[#00FF41]/10 text-[#00FF41] hover:bg-[#00FF41]/20 text-4xs font-mono font-bold uppercase tracking-widest cursor-pointer transition-all duration-200"
                title="Install BandDan App"
              >
                <Download className="w-3 h-3 text-[#00FF41]" />
                <span className="hidden xs:inline">INSTALL</span>
              </button>
            )}

            {/* Local sound controls for bandmate */}
            <button
              onClick={toggleSound}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-lg border text-4xs font-mono font-bold uppercase tracking-widest cursor-pointer transition-all duration-200 ${
                soundEnabled
                  ? 'border-[#00FF41]/30 bg-[#00FF41]/10 text-[#00FF41] hover:bg-[#00FF41]/15 shadow-[0_0_10px_rgba(0,255,65,0.08)]'
                  : 'border-white/5 bg-white/5 text-zinc-400 hover:text-white hover:bg-white/10'
              }`}
              title={soundEnabled ? 'Disable Sound' : 'Enable Sound'}
            >
              {soundEnabled ? (
                <>
                  <Volume2 className="w-3 h-3 text-[#00FF41]" />
                  <span className="hidden xs:inline">ON</span>
                </>
              ) : (
                <>
                  <VolumeX className="w-3 h-3 text-zinc-500" />
                  <span className="hidden xs:inline">OFF</span>
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* 1. Name Entry & Setup */}
      {pairingStep === 'name_entry' && (
        <div id="listener_setup_card" className="flex-1 flex flex-col items-center justify-center max-w-sm mx-auto w-full gap-4 relative z-10">
          <div className="text-center flex flex-col items-center">
            <h1 className="text-2xl font-black tracking-tighter text-white uppercase select-none">
              JOIN <span className="text-[#00FF41]">BAND</span>
            </h1>
          </div>

          <div className="w-full bg-white/[0.02] backdrop-blur-md border border-white/5 p-4 rounded-xl flex flex-col gap-3 shadow-2xl relative">
            <div className="flex flex-col gap-1">
              <label htmlFor="displayName" className="text-4xs font-mono font-bold uppercase tracking-widest text-zinc-500 select-none">
                INSTRUMENT / YOUR NAME
              </label>
              <input
                id="displayName"
                type="text"
                placeholder="e.g. Drums, Keys, Bass"
                maxLength={16}
                value={displayName}
                onChange={(e) => handleNameChange(e.target.value)}
                className="w-full bg-black/80 border border-zinc-700/85 focus:border-[#00FF41] rounded-lg px-3 py-2 text-xs font-mono font-bold text-[#00FF41] placeholder-zinc-500 focus:outline-hidden uppercase tracking-wide transition-all shadow-inner"
              />
            </div>

            <button
              onClick={startConductorScanner}
              disabled={!displayName.trim()}
              className="w-full py-2.5 bg-[#00FF41] hover:bg-[#22ff5a] disabled:bg-white/5 disabled:text-zinc-600 disabled:shadow-none text-black text-2xs font-mono font-bold rounded-lg transition-all duration-200 flex items-center justify-center gap-1 cursor-pointer uppercase tracking-wider"
            >
              <span>SCAN CONDUCTOR QR</span>
            </button>

            <div className="flex items-center gap-1.5 my-0.5">
              <div className="flex-1 h-[1px] bg-white/10" />
              <span className="text-4xs font-mono text-zinc-400 uppercase tracking-wider">OR PASTE</span>
              <div className="flex-1 h-[1px] bg-white/10" />
            </div>

            <div className="flex flex-col gap-1.5">
              <textarea
                placeholder="PASTE CONNECTION CODE HERE..."
                rows={2}
                disabled={!displayName.trim()}
                className="w-full bg-black/80 border border-zinc-700/85 focus:border-[#00FF41] rounded-lg px-3 py-2 text-[10px] font-mono text-[#00FF41] placeholder-zinc-500 focus:outline-hidden uppercase tracking-wide transition-all resize-none shadow-inner"
                value={manualOfferInput}
                onChange={(e) => setManualOfferInput(e.target.value)}
              />
              <button
                onClick={handleManualOfferSubmit}
                disabled={!displayName.trim() || !manualOfferInput.trim()}
                className="w-full py-2 bg-[#00FF41]/10 hover:bg-[#00FF41]/20 disabled:bg-white/5 disabled:text-zinc-600 disabled:border-transparent active:scale-97 text-[#00FF41] text-3xs font-mono font-bold rounded-lg border border-[#00FF41]/30 hover:border-[#00FF41]/60 transition-all duration-200 uppercase tracking-widest cursor-pointer shadow-[0_2px_8px_rgba(0,255,65,0.05)]"
              >
                CONNECT WITH CODE
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 2. Scanning Conductor QR */}
      {pairingStep === 'scanning_conductor' && (
        <div id="listener_scanning_card" className="flex-1 flex flex-col items-center justify-center max-w-sm mx-auto w-full gap-5">
          <div className="text-center">
            <h2 className="text-sm font-mono font-bold text-white uppercase tracking-wider">[ SCAN CONDUCTOR SCREEN ]</h2>
            <p className="text-4xs font-mono text-[#8E9299] uppercase tracking-widest mt-1">Point camera at the Conductor QR code</p>
          </div>

          {/* QR Scanner Holder */}
          <div className="w-full aspect-square max-w-[280px] rounded-3xl overflow-hidden border border-white/10 bg-[#050508]/60 relative flex items-center justify-center shadow-[0_0_24px_rgba(0,255,65,0.15)]">
            {scannerActive ? (
              <div id="conductor-reader" className="w-full h-full" />
            ) : (
              <span className="text-3xs text-[#8E9299] font-mono uppercase">Initializing camera...</span>
            )}
            {/* Focus Overlay Reticle */}
            <div className="absolute inset-5 border border-dashed border-[#00FF41]/40 rounded-2xl pointer-events-none flex items-center justify-center">
              <div className="w-1.5 h-1.5 bg-[#00FF41] rounded-full animate-ping" />
              {/* Corner Accents */}
              <div className="absolute top-0 left-0 w-5 h-5 border-t-2 border-l-2 border-[#00FF41] rounded-tl-lg" />
              <div className="absolute top-0 right-0 w-5 h-5 border-t-2 border-r-2 border-[#00FF41] rounded-tr-lg" />
              <div className="absolute bottom-0 left-0 w-5 h-5 border-b-2 border-l-2 border-[#00FF41] rounded-bl-lg" />
              <div className="absolute bottom-0 right-0 w-5 h-5 border-b-2 border-r-2 border-[#00FF41] rounded-br-lg" />
            </div>
          </div>

          {pairingError && (
            <div className="flex items-center gap-2 p-3 bg-[#FF4444]/15 border border-[#FF4444]/40 rounded-lg text-[#FF4444] text-4xs font-mono">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{pairingError}</span>
            </div>
          )}

          <button
            onClick={cancelScanning}
            className="px-5 py-2 bg-[#12121A] border-2 border-[#2D2D3F] hover:border-[#8E9299] text-zinc-300 text-xs font-mono font-bold rounded-lg transition cursor-pointer uppercase tracking-wider"
          >
            Cancel and Back
          </button>
        </div>
      )}

      {/* 3. Generating Answer Loading State */}
      {pairingStep === 'generating_answer' && (
        <div id="listener_generating_card" className="flex-1 flex flex-col items-center justify-center max-w-sm mx-auto w-full gap-5 text-center py-6">
          <div className="relative w-16 h-16 flex items-center justify-center">
            {/* Pulsing ring outer */}
            <div className="absolute inset-0 rounded-full border border-[#00FF41]/20 animate-ping duration-1000" />
            {/* Rotating radar sweep */}
            <div className="absolute inset-1.5 rounded-full border border-dashed border-[#00FF41]/40 animate-spin [animation-duration:3s]" />
            {/* Core pulsing dot */}
            <div className="w-3.5 h-3.5 rounded-full bg-[#00FF41] shadow-[0_0_12px_rgba(0,255,65,0.65)] animate-pulse" />
          </div>
          <div className="space-y-2 w-full">
            <h3 className="font-mono font-extrabold text-white text-xs uppercase tracking-widest flex items-center justify-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[#00FF41] animate-pulse" />
              GENERATING QR ANSWER...
            </h3>
            <div className="w-48 bg-white/5 h-1 rounded-full overflow-hidden mx-auto relative">
              <div className="bg-[#00FF41] h-full rounded-full absolute top-0 left-0 w-3/4 overflow-hidden">
                <div className="w-full h-full bg-gradient-to-r from-transparent via-white/40 to-transparent animate-progress" />
              </div>
            </div>
            <p className="text-zinc-500 text-[9px] font-mono uppercase tracking-widest max-w-[240px] mx-auto leading-relaxed">
              Synthesizing local media network credentials...
            </p>
          </div>
        </div>
      )}

      {/* 4. Show Answer QR Code */}
      {pairingStep === 'show_answer_qr' && (
        <div id="listener_show_answer_card" className="flex-1 flex flex-col items-center justify-center max-w-sm mx-auto w-full gap-4">
          <div className="text-center flex flex-col items-center">
            <h2 className="text-xs font-mono font-bold uppercase tracking-wider text-zinc-400">Pairing Step 2</h2>
            <p className="text-sm font-bold text-white uppercase tracking-wide">Show QR to Conductor</p>
          </div>

          <div className="bg-white p-3 rounded-xl shadow-2xl border border-white/10">
            <QRCodeSVG
              value={answerQRValue}
              size={220}
              level="L"
              includeMargin={true}
            />
          </div>

          <button
            onClick={copyAnswerToClipboard}
            className={`w-full py-2 border transition-all duration-200 text-3xs font-mono font-bold rounded-xl flex items-center justify-center gap-1.5 cursor-pointer uppercase tracking-wider ${
              copiedAnswer
                ? 'border-[#00FF41] bg-[#00FF41]/15 text-[#00FF41]'
                : 'border-white/10 bg-white/5 hover:bg-white/10 text-zinc-300 hover:text-white'
            }`}
          >
            {copiedAnswer ? 'COPIED!' : 'COPY CODE'}
          </button>

          <div className="flex flex-col items-center gap-2.5 w-full">
            <div className="flex items-center gap-2 px-3 py-1.5 bg-[#12121A] border border-white/5 rounded-lg text-4xs uppercase tracking-widest font-mono font-bold">
              {connectionStatus === 'connecting' ? (
                <>
                  <RefreshCw className="w-2.5 h-2.5 animate-spin text-amber-500" />
                  <span className="text-amber-400">Connecting to band...</span>
                </>
              ) : connectionStatus === 'failed' ? (
                <>
                  <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
                  <span className="text-red-400">Connection Failed</span>
                </>
              ) : (
                <>
                  <RefreshCw className="w-2.5 h-2.5 animate-spin text-[#00FF41]" />
                  <span className="text-zinc-400">Awaiting verification...</span>
                </>
              )}
            </div>

            {connectionStatus === 'failed' && (
              <p className="text-red-400/80 text-[10px] font-mono uppercase tracking-wider max-w-[280px] leading-relaxed">
                Handshake failed. Ensure both devices are on the same WiFi or have cellular data, then try pairing again.
              </p>
            )}
          </div>

          <button
            onClick={disconnectAndReset}
            className="px-3 py-1.5 text-zinc-400 hover:text-white text-3xs font-mono font-bold rounded-xl transition cursor-pointer uppercase tracking-wider"
          >
            Cancel
          </button>
        </div>
      )}

      {/* 5. Active High Contrast Display */}
      {pairingStep === 'listening' && (
        <div id="listening_workspace_panel" className="flex-1 flex flex-col h-full relative justify-between">
          
          {/* Top minimal status banner */}
          <div className="flex items-center justify-between border-b border-[#2D2D3F] pb-3 mt-1">
            <div className="flex items-center gap-2">
              <div className={`w-2.5 h-2.5 rounded-full ${
                connectionStatus === 'connected' ? 'bg-[#00FF41] animate-pulse' : 'bg-[#FF4444]'
              }`} />
              <div className="text-xs">
                <span className="font-mono font-bold text-white uppercase tracking-wide">{displayName}</span>
                <span className="text-[#8E9299] text-4xs block uppercase tracking-widest font-mono mt-0.5">
                  {connectionStatus === 'connected' ? 'CONNECTED' : 'DISCONNECTED'}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={toggleSound}
                className={`flex items-center gap-1 px-2 py-1 border rounded-lg text-[9px] font-mono font-bold uppercase tracking-wider cursor-pointer transition-all duration-200 ${
                  soundEnabled
                    ? 'border-[#00FF41]/30 bg-[#00FF41]/10 text-[#00FF41]'
                    : 'border-white/5 bg-white/5 text-zinc-400 hover:text-white'
                }`}
                title={soundEnabled ? 'Disable Synth' : 'Enable Synth'}
              >
                {soundEnabled ? (
                  <>
                    <Volume2 className="w-3 h-3 text-[#00FF41]" />
                    <span className="hidden xs:inline">SOUND ON</span>
                  </>
                ) : (
                  <>
                    <VolumeX className="w-3 h-3 text-zinc-500" />
                    <span className="hidden xs:inline">SOUND OFF</span>
                  </>
                )}
              </button>

              <button
                onClick={disconnectAndReset}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-[#FF4444]/15 border border-[#FF4444]/35 text-[#FF4444] hover:bg-[#FF4444]/25 rounded-lg text-4xs uppercase tracking-widest font-mono font-bold transition cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Leave</span>
              </button>
            </div>
          </div>

          {/* Huge, absolute high contrast display occupying maximum space */}
          <div className="flex-1 flex flex-col items-center justify-center text-center">
            <div className="text-[#00FF41] font-mono tracking-tighter select-none font-black leading-none text-[8.5rem] sm:text-[14rem] md:text-[18rem] lg:text-[24rem] xl:text-[30rem] uppercase drop-shadow-[0_0_50px_rgba(0,255,65,0.45)] animate-fade-in">
              {activeChord}
            </div>
            
            {lastUpdateTime > 0 && (
              <div className="text-4xs font-mono uppercase tracking-widest text-[#8E9299] mt-2 flex items-center gap-1.5">
                <Sparkles className="w-3 h-3 text-[#00FF41]" />
                <span>Changed {new Date(lastUpdateTime).toLocaleTimeString()}</span>
              </div>
            )}
          </div>

          {/* Bottom quick indicator */}
          <div className="border-t border-white/5 pt-2.5 text-center text-4xs text-zinc-600 font-mono uppercase tracking-widest leading-none">
            * Keep screen awake • Vibrates on change
          </div>

        </div>
      )}

      {/* PWA Install Modal */}
      <PWAInstallModal
        isOpen={pwa.showModal}
        onClose={pwa.closeModal}
        onInstall={pwa.triggerInstall}
        isIOS={pwa.isIOS}
        hasDeferredPrompt={pwa.hasDeferredPrompt}
      />

    </div>
  );
}
