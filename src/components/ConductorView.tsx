import { useState, useEffect, useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Html5Qrcode } from 'html5-qrcode';
import { 
  GestureType, 
  ListenerConnection, 
  Preset, 
  IdentifyMessage, 
  WebRTCMessage, 
  ConnectionStatus,
  GESTURES
} from '../types';
import { RTC_CONFIG, compressSDP, decompressSDP, waitForIceGathering } from '../utils/webrtc';
import { loadActivePresetId, loadPresets } from '../utils/presets';
import { playChordSound, playDynamicSynthChord, CHROMATIC_NOTES } from '../utils/audio';
import GestureDetector from './GestureDetector';
import ChordMappingSettings from './ChordMappingSettings';
import { 
  Users, 
  Plus, 
  Video, 
  Settings, 
  Radio, 
  X, 
  HelpCircle, 
  Smartphone, 
  Wifi, 
  AlertCircle, 
  Camera, 
  RotateCcw,
  Volume2,
  VolumeX,
  ArrowLeft,
  Music,
  Download
} from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { PWAInstallModal } from './PWAInstallModal';

interface ConductorViewProps {
  onExit?: () => void;
}

export default function ConductorView({ onExit }: ConductorViewProps) {
  // PWA Install hook
  const pwa = usePWAInstall();

  // Preset state
  const [presets, setPresets] = useState<Preset[]>(loadPresets);
  const [activePreset, setActivePreset] = useState<Preset>(() => {
    const activeId = loadActivePresetId();
    return loadPresets().find((p) => p.id === activeId) || loadPresets()[0];
  });

  // Connection list state
  const [connections, setConnections] = useState<ListenerConnection[]>([]);
  const [activeChord, setActiveChord] = useState<string>('—');
  const [lastBroadcastTime, setLastBroadcastTime] = useState<number>(0);
  const [performanceMode, setPerformanceMode] = useState<'single' | 'dual'>('single');
  const [rootKey, setRootKey] = useState<string>('C');
  const [scaleMode, setScaleMode] = useState<'major' | 'minor'>('major');
  const [soundEnabled, setSoundEnabled] = useState<boolean>(() => {
    return localStorage.getItem('banddan_sound_enabled') === 'true';
  });

  const toggleSound = () => {
    const newValue = !soundEnabled;
    setSoundEnabled(newValue);
    localStorage.setItem('banddan_sound_enabled', String(newValue));
  };

  // Pairing workflow states
  const [pairingStep, setPairingStep] = useState<'idle' | 'generating_offer' | 'show_offer_qr' | 'scanning_answer'>('idle');
  const [currentPairingId, setCurrentPairingId] = useState<string>('');
  const [currentPairingName, setCurrentPairingName] = useState<string>('New Bandmate');
  const [offerQRValue, setOfferQRValue] = useState<string>('');
  const [pairingError, setPairingError] = useState<string | null>(null);

  // Manual text-pairing fallback states
  const [copiedOffer, setCopiedOffer] = useState<boolean>(false);
  const [manualAnswerInput, setManualAnswerInput] = useState<string>('');

  const copyOfferToClipboard = () => {
    if (!offerQRValue) return;
    navigator.clipboard.writeText(offerQRValue)
      .then(() => {
        setCopiedOffer(true);
        setTimeout(() => setCopiedOffer(false), 2000);
      })
      .catch((err) => console.error('Failed to copy connection code:', err));
  };

  const handleManualAnswerSubmit = async () => {
    const sdpText = manualAnswerInput.trim();
    if (!sdpText) return;
    await handleScannedAnswer(sdpText);
  };

  // Scanner state
  const [scannerActive, setScannerActive] = useState<boolean>(false);
  const scannerRef = useRef<Html5Qrcode | null>(null);

  // Expandable Settings panel
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [showCheatSheet, setShowCheatSheet] = useState<boolean>(false);

  // Handle toggling and history states for guide and settings
  const openCheatSheet = () => {
    setShowCheatSheet(true);
    window.history.pushState({ role: 'conductor', overlay: 'guide' }, '');
  };

  const closeCheatSheet = () => {
    setShowCheatSheet(false);
    if (window.history.state?.overlay === 'guide') {
      window.history.back();
    }
  };

  const toggleSettings = () => {
    const nextVal = !showSettings;
    setShowSettings(nextVal);
    if (nextVal) {
      window.history.pushState({ role: 'conductor', overlay: 'settings' }, '');
    } else {
      if (window.history.state?.overlay === 'settings') {
        window.history.back();
      }
    }
  };

  // Sync state with browser history for back-button support on mobile
  useEffect(() => {
    const handlePopState = (e: PopStateEvent) => {
      if (showCheatSheet && e.state?.overlay !== 'guide') {
        setShowCheatSheet(false);
      }
      if (showSettings && e.state?.overlay !== 'settings') {
        setShowSettings(false);
      }
      if (pairingStep !== 'idle' && e.state?.overlay !== 'pairing') {
        // Stop scanner if active
        if (scannerRef.current) {
          try {
            if (scannerRef.current.isScanning) {
              scannerRef.current.stop();
            }
          } catch (err) {
            console.error('Error stopping scanner from popstate:', err);
          }
          scannerRef.current = null;
        }
        setScannerActive(false);
        setPairingStep('idle');
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && showCheatSheet) {
        closeCheatSheet();
      }
    };

    window.addEventListener('popstate', handlePopState);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('popstate', handlePopState);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [showCheatSheet, showSettings, pairingStep]);

  // Clean up all connections on unmount
  useEffect(() => {
    return () => {
      connections.forEach((conn) => {
        if (conn.dataChannel) conn.dataChannel.close();
        conn.peerConnection.close();
      });
    };
  }, []);

  // Broadcast a chord to all connected listeners
  const broadcastChord = (chord: string) => {
    setActiveChord(chord);
    const ts = Date.now();
    setLastBroadcastTime(ts);

    if (soundEnabled && chord && chord !== '—') {
      playChordSound(chord);
    }

    const msg: WebRTCMessage = {
      type: 'chord',
      value: chord,
      ts,
    };

    const payload = JSON.stringify(msg);
    let sentCount = 0;

    connections.forEach((conn) => {
      if (conn.status === 'connected' && conn.dataChannel && conn.dataChannel.readyState === 'open') {
        try {
          conn.dataChannel.send(payload);
          sentCount++;
        } catch (err) {
          console.error(`Failed to send chord to ${conn.name}:`, err);
        }
      }
    });

    console.log(`Broadcasted chord "${chord}" to ${sentCount}/${connections.length} listeners.`);
  };

  // Callback from GestureDetector
  const handleGestureTriggered = (gestureId: GestureType) => {
    const mapping = activePreset.mappings.find((m) => m.gestureId === gestureId);
    if (mapping && mapping.chord) {
      broadcastChord(mapping.chord);
    }
  };

  // Start pairing flow for a new listener (or reconnect an existing one)
  const startPairingFlow = async (reconnectId?: string, reconnectName?: string) => {
    try {
      setPairingError(null);
      setPairingStep('generating_offer');
      if (window.history.state?.overlay !== 'pairing') {
        window.history.pushState({ role: 'conductor', overlay: 'pairing' }, '');
      }

      const id = reconnectId || 'listener_' + Math.random().toString(36).substring(2, 11);
      const name = reconnectName || `Listener #${connections.length + 1}`;
      
      setCurrentPairingId(id);
      setCurrentPairingName(name);

      // Create WebRTC Peer Connection
      const pc = new RTCPeerConnection(RTC_CONFIG);
      
      // Create Data Channel
      const dc = pc.createDataChannel('chords', { negotiated: false });

      const newConnection: ListenerConnection = {
        id,
        name,
        status: 'connecting',
        peerConnection: pc,
        dataChannel: dc,
        createdAt: Date.now(),
      };

      // Set up peer connection listeners
      pc.onconnectionstatechange = () => {
        const state = pc.connectionState;
        console.log(`PeerConnection state change for ${name}: ${state}`);
        
        let status: ConnectionStatus = 'connecting';
        if (state === 'connected') status = 'connected';
        if (state === 'disconnected' || state === 'closed') status = 'disconnected';
        if (state === 'failed') status = 'failed';

        setConnections((prev) =>
          prev.map((c) => (c.id === id ? { ...c, status } : c))
        );
      };

      // Set up data channel listeners
      dc.onopen = () => {
        console.log(`Data channel opened for ${name}`);
        // Send a ping immediately to test
        try {
          dc.send(JSON.stringify({ type: 'ping', ts: Date.now() }));
        } catch (e) {
          console.error(e);
        }
      };

      dc.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data);
          if (parsed.type === 'identify') {
            const identifyMsg = parsed as IdentifyMessage;
            setConnections((prev) =>
              prev.map((c) => (c.id === id ? { ...c, name: identifyMsg.name } : c))
            );
          }
        } catch (err) {
          console.error('Failed to parse listener message:', err);
        }
      };

      // Create offer
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // Wait for complete ICE gathering before displaying QR
      setLoadingProgress('Gathering network candidates...');
      await waitForIceGathering(pc);

      const compressedQR = compressSDP({
        type: pc.localDescription!.type,
        sdp: pc.localDescription!.sdp,
      });

      setOfferQRValue(compressedQR);
      
      // Append or replace in connections state
      setConnections((prev) => {
        const filtered = prev.filter((c) => c.id !== id);
        return [...filtered, newConnection];
      });

      setPairingStep('show_offer_qr');
    } catch (err: any) {
      console.error('Failed to initiate WebRTC pairing:', err);
      setPairingError('Could not initialize peer connection. WebRTC might be blocked.');
      setPairingStep('idle');
    }
  };

  // Helper text state during offer generation
  const [loadingProgress, setLoadingProgress] = useState('Initializing peer...');

  // Close pairing modal and clean up incomplete connections
  const cancelPairing = () => {
    // If the connection was not completed, remove it
    const activeConn = connections.find((c) => c.id === currentPairingId);
    if (activeConn && activeConn.status !== 'connected') {
      activeConn.peerConnection.close();
      if (activeConn.dataChannel) activeConn.dataConn?.close();
      setConnections((prev) => prev.filter((c) => c.id !== currentPairingId));
    }
    
    stopScanner();
    setPairingStep('idle');
    setPairingError(null);
    setManualAnswerInput('');

    if (window.history.state?.overlay === 'pairing') {
      window.history.back();
    }
  };

  // Start camera scanner to read Listener's Answer QR
  const startAnswerScanner = async () => {
    setPairingStep('scanning_answer');
    setScannerActive(true);
    setPairingError(null);

    // Give DOM 100ms to mount reader element
    setTimeout(async () => {
      try {
        const html5Qrcode = new Html5Qrcode('answer-reader');
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
            await handleScannedAnswer(decodedText);
          },
          () => {
            // Silently ignore camera frames with no QRs
          }
        );
      } catch (err) {
        console.error('Failed to start QR scanner:', err);
        setPairingError('Could not access camera for QR scanning. Check permissions.');
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

  // Handle scanned answer QR code
  const handleScannedAnswer = async (compressedSDP: string) => {
    await stopScanner();
    try {
      const decompressed = decompressSDP(compressedSDP);
      if (!decompressed || decompressed.type !== 'answer') {
        throw new Error('Scanned code is not a valid WebRTC Answer SDP.');
      }

      const activeConn = connections.find((c) => c.id === currentPairingId);
      if (!activeConn) {
        throw new Error('Active pairing connection not found.');
      }

      await activeConn.peerConnection.setRemoteDescription(decompressed);
      setPairingStep('idle');
      setManualAnswerInput('');
      if (window.history.state?.overlay === 'pairing') {
        window.history.back();
      }
      
      // Send active chord over to the newly connected listener immediately
      if (activeChord !== '—') {
        setTimeout(() => {
          if (activeConn.dataChannel && activeConn.dataChannel.readyState === 'open') {
            activeConn.dataChannel.send(
              JSON.stringify({ type: 'chord', value: activeChord, ts: Date.now() })
            );
          }
        }, 800);
      }
    } catch (err: any) {
      console.error('Error setting remote answer:', err);
      setPairingError(err.message || 'Failed to apply scanned WebRTC response.');
      setPairingStep('show_offer_qr'); // go back to show QR so they can retry
    }
  };

  // Remove listener
  const removeConnection = (id: string) => {
    const conn = connections.find((c) => c.id === id);
    if (conn) {
      if (conn.dataChannel) conn.dataChannel.close();
      conn.peerConnection.close();
    }
    setConnections((prev) => prev.filter((c) => c.id !== id));
  };

  return (
    <div id="conductor_workspace" className="min-h-screen bg-[#07070B] text-[#E0E0E0] flex flex-col relative overflow-x-hidden">
      
      {/* Ambient glass glows */}
      <div className="absolute top-0 right-0 w-[50%] aspect-square rounded-full bg-[#00FF41]/3 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-20 left-10 w-[40%] aspect-square rounded-full bg-[#3B82F6]/3 blur-[120px] pointer-events-none" />

      {/* Specialist Hardware Telemetry Header */}
      <div className="w-full border-b border-white/5 bg-black/40 backdrop-blur-md px-2.5 sm:px-4 py-2 sm:py-3 sticky top-0 z-30 shadow-md">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
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
            <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
              <img 
                src="/pwa-192x192.png" 
                alt="BandDan Icon" 
                referrerPolicy="no-referrer"
                className="w-6 h-6 sm:w-7 sm:h-7 rounded-lg border border-[#00FF41]/40 shrink-0 object-cover shadow-[0_0_10px_rgba(0,255,65,0.25)]" 
              />
              <h1 className="text-sm sm:text-base md:text-xl font-extrabold tracking-tighter text-white uppercase select-none truncate">
                BAND<span className="text-[#00FF41]">DAN</span>
              </h1>
              <div className="hidden xs:inline-block px-2 py-0.5 bg-[#00FF41]/10 border border-[#00FF41]/20 rounded-full text-[8px] font-mono tracking-wider text-[#00FF41] font-bold shrink-0">
                CONDUCTOR
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-4 shrink-0">
            {!pwa.isStandalone && (
              <button
                onClick={pwa.triggerInstall}
                className="flex items-center gap-1 sm:gap-1.5 px-2 sm:px-2.5 py-1 rounded-lg border border-[#00FF41]/30 bg-[#00FF41]/10 text-[#00FF41] hover:bg-[#00FF41]/20 text-4xs font-mono font-bold uppercase tracking-widest cursor-pointer transition-all duration-200"
                title="Install BandDan App"
              >
                <Download className="w-3 h-3 text-[#00FF41]" />
                <span className="hidden xs:inline">INSTALL</span>
              </button>
            )}

            <button
              onClick={toggleSound}
              className={`flex items-center gap-1 sm:gap-1.5 px-2 sm:px-2.5 py-1 rounded-lg border text-4xs font-mono font-bold uppercase tracking-widest cursor-pointer transition-all duration-200 ${
                soundEnabled
                  ? 'border-[#00FF41]/30 bg-[#00FF41]/10 text-[#00FF41] hover:bg-[#00FF41]/15'
                  : 'border-white/5 bg-white/5 text-zinc-400 hover:text-white hover:bg-white/10'
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

            <div className="flex font-mono shrink-0 items-center">
              <div className="flex flex-col text-right leading-none">
                <span className="text-[#8E9299] uppercase text-[7px] sm:text-[8px] tracking-wider mb-0.5">Bandmates</span>
                <span className="text-[#00FF41] font-bold text-3xs sm:text-2xs">
                  {connections.filter((c) => c.status === 'connected').length.toString().padStart(2, '0')}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <main className="flex-1 max-w-5xl w-full mx-auto p-3 sm:p-4 md:p-6 flex flex-col gap-4 md:gap-6 relative z-10">
        
        {/* Quick control actions & Key / Scale selector */}
        <div className="flex flex-wrap items-center justify-between gap-2.5 bg-white/[0.02] backdrop-blur-md border border-white/5 p-2.5 sm:p-3 rounded-2xl shadow-xl">
          <div className="flex flex-wrap items-center gap-2">
            <span className="hidden sm:inline text-4xs uppercase font-mono font-bold tracking-widest text-[#8E9299] pl-1 select-none">
              MODE:
            </span>
            <div className="flex bg-black/40 border border-white/10 rounded-xl p-1 font-mono text-3xs font-bold">
              <button
                onClick={() => setPerformanceMode('single')}
                className={`px-2.5 sm:px-3 py-1 rounded-lg transition-all duration-200 cursor-pointer whitespace-nowrap ${
                  performanceMode === 'single'
                    ? 'bg-[#00FF41] text-black font-black'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                1-HAND
              </button>
              <button
                onClick={() => setPerformanceMode('dual')}
                className={`px-2.5 sm:px-3 py-1 rounded-lg transition-all duration-200 cursor-pointer whitespace-nowrap ${
                  performanceMode === 'dual'
                    ? 'bg-[#00FF41] text-black font-black'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                2-HAND
              </button>
            </div>

            {/* Key & Scale selector when 2-Hand Synth mode is active */}
            {performanceMode === 'dual' && (
              <div className="flex items-center gap-1.5 sm:border-l sm:border-white/10 sm:pl-2">
                <select
                  value={rootKey}
                  onChange={(e) => setRootKey(e.target.value)}
                  className="bg-black/60 border border-[#00FF41]/30 rounded-lg px-2 py-1 text-3xs font-mono font-bold text-[#00FF41] focus:outline-none cursor-pointer"
                >
                  {CHROMATIC_NOTES.map((k) => (
                    <option key={k} value={k} className="bg-zinc-900 text-white">KEY: {k}</option>
                  ))}
                </select>
                <button
                  onClick={() => setScaleMode(scaleMode === 'major' ? 'minor' : 'major')}
                  className="px-2 py-1 bg-[#00FF41]/10 border border-[#00FF41]/30 rounded-lg text-3xs font-mono font-bold text-[#00FF41] hover:bg-[#00FF41]/20 cursor-pointer uppercase"
                >
                  {scaleMode}
                </button>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto justify-between sm:justify-end">
            <button
              onClick={openCheatSheet}
              className="flex-1 sm:flex-initial flex items-center justify-center gap-1 px-2.5 py-1.5 text-3xs border border-[#00FF41]/25 bg-[#00FF41]/5 text-[#00FF41] hover:bg-[#00FF41]/10 rounded-xl font-mono font-bold transition-all duration-200 cursor-pointer active:scale-97"
            >
              <HelpCircle className="w-3.5 h-3.5 text-[#00FF41]" />
              <span>GUIDE</span>
            </button>

            <button
              onClick={() => startPairingFlow()}
              className="flex-1 sm:flex-initial flex items-center justify-center gap-1 px-3 py-1.5 bg-[#00FF41] hover:bg-[#22ff5a] active:scale-97 text-black text-3xs font-mono font-bold rounded-xl transition-all duration-200 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>CONNECT</span>
            </button>

            <button
              onClick={toggleSettings}
              className={`flex-1 sm:flex-initial flex items-center justify-center gap-1 px-2.5 py-1.5 text-3xs border rounded-xl font-mono font-bold transition-all duration-200 cursor-pointer active:scale-97 ${
                showSettings 
                  ? 'bg-[#00FF41]/10 border-[#00FF41] text-[#00FF41]' 
                  : 'bg-white/5 border-white/10 text-zinc-300 hover:text-white hover:border-white/20'
              }`}
            >
              <Settings className="w-3.5 h-3.5" />
              <span>{showSettings ? 'CLOSE' : 'EDIT'}</span>
            </button>
          </div>
        </div>

        {/* Expandable settings section */}
        {showSettings && (
          <div className="border border-white/5 bg-white/[0.02] backdrop-blur-md p-5 rounded-2xl shadow-2xl relative">
            <div className="absolute top-0 left-6 right-6 h-[1px] bg-gradient-to-r from-transparent via-white/10 to-transparent" />
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xs font-mono font-bold uppercase tracking-wider text-[#8E9299] flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-[#00FF41]" />
                [ GESTURE PRESET MAPPINGS ]
              </h2>
              <button 
                onClick={() => setShowSettings(false)}
                className="text-zinc-500 hover:text-white transition-colors cursor-pointer p-1 rounded-lg hover:bg-white/5"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <ChordMappingSettings 
              activePreset={activePreset} 
              onActivePresetChange={setActivePreset} 
            />
          </div>
        )}

        {/* Responsive Desktop/Laptop Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start w-full">
          {/* Left Column: Visual Performance Stream (Gesture Detector) */}
          <div className="lg:col-span-7 xl:col-span-8 flex flex-col gap-6 w-full">
            {/* Gesture Recognition Component */}
            <section id="gesture_section" className="w-full">
              <GestureDetector 
                onGestureTriggered={handleGestureTriggered} 
                activeChord={activeChord}
                gestureSynthMode={performanceMode === 'dual'}
                rootKey={rootKey}
                scaleMode={scaleMode}
                onModeToggle={(m) => setPerformanceMode(m)}
                onSynthChordChange={(chord, params) => {
                  if (chord !== '—') {
                    broadcastChord(chord);
                    if (soundEnabled && params) {
                      playDynamicSynthChord(rootKey, scaleMode, params.degree, {
                        inversion: params.inversion,
                        seventhType: params.seventhType,
                        octaveOffset: params.octaveOffset,
                        filterCutoff: params.filterCutoff,
                        volume: params.volume
                      });
                    }
                  } else {
                    setActiveChord('—');
                  }
                }}
              />
            </section>
          </div>

          {/* Right Column: Connected Bandmates & Manual Control Board */}
          <div className="lg:col-span-5 xl:col-span-4 flex flex-col gap-6 w-full">
            {/* Connected Bandmates Panel */}
            <section id="bandmates_list" className="bg-white/[0.01] backdrop-blur-lg border border-white/5 rounded-2xl p-5 shadow-xl relative w-full">
              <div className="absolute top-0 left-4 right-4 h-[1px] bg-gradient-to-r from-transparent via-white/5 to-transparent" />
              <div className="flex items-center justify-between border-b border-white/5 pb-3 mb-3">
                <div className="flex items-center gap-2">
                  <Users className="w-4 h-4 text-[#00FF41]" />
                  <h2 className="font-mono font-bold text-2xs uppercase tracking-wider text-[#8E9299]">BAND MEMBERS ({connections.length})</h2>
                </div>
                {connections.length === 0 && (
                  <span className="text-[9px] text-[#8E9299] font-mono uppercase tracking-wider">NO CONNECTIONS</span>
                )}
              </div>

              {connections.length > 0 ? (
                <div className="flex flex-col gap-2.5">
                  {connections.map((conn) => {
                    let dotColor = 'bg-zinc-500';
                    if (conn.status === 'connected') dotColor = 'bg-[#00FF41] animate-pulse';
                    if (conn.status === 'connecting') dotColor = 'bg-amber-500 animate-pulse';
                    if (conn.status === 'disconnected' || conn.status === 'failed') dotColor = 'bg-[#FF4444]';

                    return (
                      <div
                        key={conn.id}
                        className="flex items-center justify-between p-3.5 bg-white/[0.02] backdrop-blur-md border border-white/5 rounded-xl shadow-md"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className={`w-2 h-2 rounded-full ${dotColor}`} />
                          <div className="min-w-0">
                            <div className="text-xs font-bold text-white truncate font-mono uppercase tracking-wide">{conn.name}</div>
                            <div className="text-[10px] text-[#8E9299] uppercase tracking-wider font-mono mt-0.5">
                              {conn.status === 'connected' ? 'TX READY' : conn.status}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5">
                          {(conn.status === 'disconnected' || conn.status === 'failed') && (
                            <button
                              onClick={() => startPairingFlow(conn.id, conn.name)}
                              className="px-2 py-1 bg-[#FF4444]/10 border border-[#FF4444]/20 text-[#FF4444] rounded-lg hover:bg-[#FF4444]/20 active:scale-95 text-4xs font-mono font-bold transition flex items-center gap-1 cursor-pointer"
                            >
                              <RotateCcw className="w-3 h-3" />
                              <span>RETRY</span>
                            </button>
                          )}
                          <button
                            onClick={() => removeConnection(conn.id)}
                            className="p-1 hover:text-[#FF4444] text-zinc-500 hover:bg-white/5 rounded-lg transition-colors cursor-pointer"
                            title="Remove member"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center py-4 border border-dashed border-white/5 rounded-xl bg-white/[0.01]">
                  <h3 className="font-mono text-3xs text-[#8E9299] uppercase tracking-wider">No bandmates added</h3>
                </div>
              )}
            </section>

            {/* Manual Keyboard & Chord Board Fallback */}
            <section id="manual_chord_board" className="bg-white/[0.01] backdrop-blur-lg border border-white/5 rounded-2xl p-4 shadow-2xl flex flex-col gap-3 relative w-full">
              <div className="absolute top-0 left-4 right-4 h-[1px] bg-gradient-to-r from-transparent via-white/5 to-transparent" />
              <div className="flex items-center justify-between border-b border-white/5 pb-2 gap-2">
                <div className="flex items-center gap-1.5">
                  <Volume2 className="w-3.5 h-3.5 text-[#00FF41]" />
                  <div>
                    <h2 className="font-mono font-bold text-3xs uppercase tracking-wider text-white">MANUAL BOARD</h2>
                    <p className="text-[9px] text-[#8E9299]">Tap to transmit chord instantly.</p>
                  </div>
                </div>

                {lastBroadcastTime > 0 && (
                  <span className="text-[8px] font-mono text-[#00FF41]/80 uppercase tracking-widest bg-[#00FF41]/10 px-2 py-0.5 border border-[#00FF41]/25 rounded-full">
                    {new Date(lastBroadcastTime).toLocaleTimeString()}
                  </span>
                )}
              </div>

              {/* Quick manual button grid from current mappings */}
              <div className="grid grid-cols-4 gap-1.5">
                {activePreset.mappings.map((mapping) => {
                  const gesture = GESTURES.find((g) => g.id === mapping.gestureId);
                  const isCurrent = activeChord === mapping.chord;
                  return (
                    <button
                      key={mapping.gestureId}
                      onClick={() => broadcastChord(mapping.chord)}
                      disabled={!mapping.chord}
                      className={`group flex flex-col items-center justify-center p-2 border transition-all duration-300 cursor-pointer rounded-xl active:scale-95 ${
                        isCurrent
                          ? 'border-[#00FF41] bg-[#00FF41]/15 text-white shadow-[0_0_15px_rgba(0,255,65,0.25)] font-extrabold'
                          : 'border-white/5 bg-black/20 hover:bg-white/5 text-zinc-300 hover:border-white/20'
                      } disabled:opacity-10`}
                    >
                      <span className={`text-xs font-black font-mono tracking-tight block ${isCurrent ? 'text-[#00FF41] drop-shadow-[0_0_8px_rgba(0,255,65,0.3)]' : ''}`}>
                        {mapping.chord || '—'}
                      </span>
                      <span className="text-[8px] font-mono text-[#8E9299]/80 uppercase mt-0.5 block tracking-wider truncate max-w-full">
                        {gesture?.name.split(' ')[0] || 'BTN'}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Silent custom chord trigger input */}
              <div className="border-t border-white/5 pt-2.5 flex flex-col gap-2">
                <span className="text-[9px] text-[#8E9299] font-mono uppercase tracking-widest">DIRECT TX CHORD:</span>
                <div className="flex gap-1.5 w-full">
                  <input
                    type="text"
                    id="custom_chord_tx"
                    placeholder="e.g. F#m7"
                    maxLength={8}
                    className="flex-1 bg-black/40 border border-white/10 px-3 py-2 rounded-xl text-xs font-mono font-bold text-[#00FF41] placeholder-zinc-700 focus:outline-hidden focus:border-[#00FF41] uppercase tracking-wide text-center"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        const val = (e.currentTarget as HTMLInputElement).value.trim();
                        if (val) {
                          broadcastChord(val);
                          (e.currentTarget as HTMLInputElement).value = '';
                        }
                      }
                    }}
                  />
                  <button
                    onClick={() => {
                      const el = document.getElementById('custom_chord_tx') as HTMLInputElement;
                      const val = el ? el.value.trim() : '';
                      if (val) {
                        broadcastChord(val);
                        el.value = '';
                      }
                    }}
                    className="px-3 py-2 bg-white/5 hover:bg-white/10 active:scale-97 text-zinc-200 hover:text-white text-3xs font-mono font-bold rounded-xl border border-white/15 hover:border-[#00FF41]/40 transition-all duration-200 cursor-pointer"
                  >
                    SEND
                  </button>
                </div>
              </div>
            </section>
          </div>
        </div>
      </main>

      {/* PAIRING MODAL WIZARD */}
      {pairingStep !== 'idle' && (
        <div id="pairing_modal" className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md">
          <div className="bg-[#12121A]/90 backdrop-blur-2xl border border-white/10 rounded-3xl w-full max-w-sm overflow-hidden flex flex-col shadow-[0_24px_64px_rgba(0,0,0,0.6)] relative">
            <div className="absolute top-0 left-6 right-6 h-[1px] bg-gradient-to-r from-transparent via-white/10 to-transparent" />
            
            <div className="p-4.5 bg-white/5 border-b border-white/5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Wifi className="w-4 h-4 text-[#00FF41]" />
                <span className="text-xs font-mono font-bold text-white uppercase tracking-wider">PAIRING: {currentPairingName}</span>
              </div>
              <button 
                onClick={cancelPairing}
                className="text-zinc-500 hover:text-white transition-colors cursor-pointer p-1 rounded-lg hover:bg-white/5"
                title="Cancel Pairing"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 flex flex-col items-center text-center gap-5">
              
              {pairingStep === 'generating_offer' && (
                <div className="w-full py-6 flex flex-col items-center justify-center gap-5">
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
                      GENERATING QR CODE...
                    </h3>
                    <div className="w-48 bg-white/5 h-1 rounded-full overflow-hidden mx-auto relative">
                      <div className="bg-[#00FF41] h-full rounded-full absolute top-0 left-0 w-3/4 overflow-hidden">
                        <div className="w-full h-full bg-gradient-to-r from-transparent via-white/40 to-transparent animate-progress" />
                      </div>
                    </div>
                    <p className="text-zinc-500 text-[9px] font-mono uppercase tracking-widest max-w-[240px] mx-auto leading-relaxed truncate px-1">
                      {loadingProgress || 'Initializing WebRTC loop...'}
                    </p>
                  </div>
                </div>
              )}

              {pairingStep === 'show_offer_qr' && (
                <div className="flex flex-col items-center gap-4.5 w-full">
                  <div className="text-zinc-300 text-xs max-w-[280px] font-mono uppercase tracking-tight">
                    <span className="font-bold text-[#00FF41]">Step 1:</span> Bandmate scans the QR code below
                  </div>

                  <div className="bg-white p-3 rounded-xl shadow-inner border border-white/10">
                    <QRCodeSVG
                      value={offerQRValue}
                      size={220}
                      level="L" // L is smaller matrix size, much easier to scan
                      includeMargin={true}
                    />
                  </div>

                  <button
                    onClick={copyOfferToClipboard}
                    className={`w-full py-2 border transition-all duration-200 text-3xs font-mono font-bold rounded-xl flex items-center justify-center gap-2 cursor-pointer uppercase tracking-wider ${
                      copiedOffer
                        ? 'border-[#00FF41] bg-[#00FF41]/15 text-[#00FF41]'
                        : 'border-white/10 bg-white/5 hover:bg-white/10 text-zinc-300 hover:text-white'
                    }`}
                  >
                    {copiedOffer ? 'OFFER COPIED!' : 'COPY CODE'}
                  </button>

                  {pairingError && (
                    <div className="flex items-center gap-1.5 text-[#FF4444] text-3xs bg-[#FF4444]/10 border border-[#FF4444]/20 px-3 py-1.5 rounded-xl max-w-[260px]">
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      <span>{pairingError}</span>
                    </div>
                  )}

                  <button
                    onClick={startAnswerScanner}
                    className="w-full py-3 bg-[#00FF41] hover:bg-[#22ff5a] active:scale-95 text-black text-xs font-mono font-bold rounded-xl shadow-[0_4px_16px_rgba(0,255,65,0.15)] transition-all duration-200 cursor-pointer uppercase tracking-wider"
                  >
                    Next: Scan Answer QR
                  </button>
                </div>
              )}

              {pairingStep === 'scanning_answer' && (
                <div className="flex flex-col items-center gap-4.5 w-full">
                  <div className="text-zinc-300 text-xs max-w-[280px] font-mono uppercase tracking-tight">
                    <span className="font-bold text-[#00FF41]">Step 2:</span> Scan response QR shown on bandmate device
                  </div>

                  {/* QR Camera Reader Node */}
                  <div className="w-full aspect-square max-w-[280px] rounded-3xl overflow-hidden border border-white/10 bg-[#050508]/60 relative flex items-center justify-center shadow-[0_0_24px_rgba(0,255,65,0.15)]">
                    {scannerActive ? (
                      <div id="answer-reader" className="w-full h-full" />
                    ) : (
                      <span className="text-3xs text-[#8E9299] font-mono uppercase">Starting camera...</span>
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

                  <div className="flex items-center gap-2 my-1 w-full">
                    <div className="flex-1 h-[1px] bg-white/10" />
                    <span className="text-[9px] font-mono text-[#8E9299] uppercase tracking-wider">OR ENTER MANUAL CODE</span>
                    <div className="flex-1 h-[1px] bg-white/10" />
                  </div>

                  <div className="flex flex-col gap-2 w-full">
                    <textarea
                      placeholder="PASTE BANDMATE'S ANSWER CODE HERE..."
                      rows={2}
                      className="w-full bg-black/40 border border-white/10 focus:border-[#00FF41] rounded-xl px-3 py-2 text-[10px] font-mono text-[#00FF41] placeholder-zinc-700 focus:outline-hidden uppercase tracking-wide transition-all resize-none"
                      value={manualAnswerInput}
                      onChange={(e) => setManualAnswerInput(e.target.value)}
                    />
                    <button
                      onClick={handleManualAnswerSubmit}
                      disabled={!manualAnswerInput.trim()}
                      className="w-full py-2 bg-[#00FF41] hover:bg-[#22ff5a] disabled:bg-white/5 disabled:text-zinc-650 text-black text-3xs font-mono font-bold rounded-xl transition-all duration-200 uppercase tracking-widest cursor-pointer"
                    >
                      VERIFY & CONNECT
                    </button>
                  </div>

                  {pairingError && (
                    <div className="flex items-center gap-1.5 text-[#FF4444] text-3xs bg-[#FF4444]/10 border border-[#FF4444]/20 px-3 py-1.5 rounded-xl max-w-[260px]">
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      <span>{pairingError}</span>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-3.5 w-full">
                    <button
                      onClick={() => {
                        stopScanner();
                        setPairingStep('show_offer_qr');
                      }}
                      className="py-2.5 border border-white/10 bg-white/5 hover:bg-white/10 active:scale-95 text-zinc-300 text-3xs font-mono font-bold rounded-xl transition-all uppercase tracking-wider cursor-pointer"
                    >
                      Back
                    </button>
                    <button
                      onClick={cancelPairing}
                      className="py-2.5 bg-[#FF4444]/15 border border-[#FF4444]/25 hover:bg-[#FF4444]/25 active:scale-95 text-[#FF4444] text-3xs font-mono font-bold rounded-xl transition-all uppercase tracking-wider cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

            </div>
          </div>
        </div>
      )}

      {/* Interactive Modal / Dialog Component Guide for Conductors */}
      {showCheatSheet && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4 animate-fade-in cursor-pointer" 
          role="dialog" 
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              closeCheatSheet();
            }
          }}
        >
          <div className="bg-[#0b0b12] border-2 border-[#00FF41]/20 rounded-3xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col shadow-[0_0_50px_rgba(0,255,65,0.12)] cursor-default">
            {/* Header */}
            <div className="p-5 border-b border-white/5 bg-black/40 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="p-1.5 bg-[#00FF41]/10 border border-[#00FF41]/20 rounded-lg">
                  <HelpCircle className="w-5 h-5 text-[#00FF41]" />
                </div>
                <div>
                  <h2 className="text-sm md:text-base font-extrabold tracking-tight text-white uppercase font-mono">
                    [ CONDUCTOR GUIDE & REFERENCE ]
                  </h2>
                  <p className="text-4xs text-[#8E9299] font-mono uppercase tracking-widest mt-0.5">
                    Interactive handbook for gesture detection and band connection
                  </p>
                </div>
              </div>
              <button
                onClick={closeCheatSheet}
                className="p-1.5 border border-white/10 hover:border-white/20 hover:bg-white/5 rounded-xl text-zinc-400 hover:text-white transition duration-200 cursor-pointer"
                title="Close guide"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Scrollable Content */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-white/10 hover:[&::-webkit-scrollbar-thumb]:bg-white/20 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-track]:bg-transparent scroll-smooth">
              
              {/* Mode Explanation Sections */}
              <div className="space-y-6">
                
                {/* 1-Hand Preset Mode Section */}
                <div className="p-4 bg-white/[0.02] border border-white/10 rounded-2xl space-y-4">
                  <div className="flex items-center gap-2.5 border-b border-white/5 pb-3">
                    <div className="p-1.5 bg-[#00FF41]/10 rounded-lg border border-[#00FF41]/20">
                      <Camera className="w-4 h-4 text-[#00FF41]" />
                    </div>
                    <div>
                      <h3 className="text-xs font-mono font-bold text-[#00FF41] uppercase tracking-wider">
                        1-Hand Preset Mode
                      </h3>
                      <p className="text-3xs text-zinc-400 font-mono uppercase tracking-wide mt-0.5">
                        Raise single-hand gestures to trigger mapped chord presets instantly.
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5">
                    {GESTURES.map((gesture) => {
                      const mappedChord = activePreset.mappings.find((m) => m.gestureId === gesture.id)?.chord || '—';
                      return (
                        <div 
                          key={gesture.id}
                          className="p-3 bg-black/30 border border-white/5 rounded-xl flex items-center justify-between gap-3"
                        >
                          <div className="flex items-center gap-2.5">
                            <span className="text-2xl bg-black/40 p-1.5 rounded-lg border border-white/5 min-w-[2.5rem] text-center">
                              {gesture.emoji}
                            </span>
                            <div>
                              <div className="font-mono font-bold text-2xs text-white uppercase tracking-wider">
                                {gesture.name}
                              </div>
                              <div className="text-[10px] font-mono text-zinc-500 uppercase leading-tight mt-0.5">
                                {gesture.description}
                              </div>
                            </div>
                          </div>

                          <span className="px-2 py-0.5 bg-[#00FF41]/10 border border-[#00FF41]/30 rounded-lg font-mono text-[#00FF41] font-bold text-2xs shrink-0">
                            {mappedChord}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* 2-Hand Dual Synth Performance Tutorial Section */}
                <div className="p-4 bg-[#0A1A0F]/60 border border-[#00FF41]/30 rounded-2xl space-y-4 shadow-[0_0_20px_rgba(0,255,65,0.08)]">
                  <div className="flex items-center gap-2.5 border-b border-[#00FF41]/20 pb-3">
                    <div className="p-1.5 bg-[#00FF41]/15 rounded-lg border border-[#00FF41]/30">
                      <Music className="w-4 h-4 text-[#00FF41]" />
                    </div>
                    <div>
                      <h3 className="text-xs font-mono font-bold text-[#00FF41] uppercase tracking-wider">
                        2-Hand Dual Synth Performance Mode
                      </h3>
                      <p className="text-3xs text-zinc-300 font-mono uppercase tracking-wide mt-0.5">
                        Perform live expressive harmony with dual hands in real time.
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Left Hand Tutorial Card */}
                    <div className="p-3.5 bg-black/40 border border-[#00FF41]/20 rounded-xl space-y-2.5">
                      <div className="flex items-center justify-between border-b border-white/10 pb-2">
                        <span className="text-[#00FF41] text-2xs font-mono font-bold uppercase tracking-wider flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full bg-[#00FF41]" />
                          LEFT HAND: DIATONIC HARMONY
                        </span>
                      </div>
                      <ul className="space-y-1.5 text-3xs font-mono text-zinc-300 leading-relaxed">
                        <li className="flex justify-between border-b border-white/5 pb-1">
                          <span className="text-zinc-400">☝️ 1 Finger:</span>
                          <span className="text-[#00FF41] font-bold">Degree I (Tonic)</span>
                        </li>
                        <li className="flex justify-between border-b border-white/5 pb-1">
                          <span className="text-zinc-400">✌️ 2 Fingers:</span>
                          <span className="text-[#00FF41] font-bold">Degree II (Supertonic)</span>
                        </li>
                        <li className="flex justify-between border-b border-white/5 pb-1">
                          <span className="text-zinc-400">🤟 3 Fingers:</span>
                          <span className="text-[#00FF41] font-bold">Degree III (Mediant)</span>
                        </li>
                        <li className="flex justify-between border-b border-white/5 pb-1">
                          <span className="text-zinc-400">🖐️ 4 Fingers:</span>
                          <span className="text-[#00FF41] font-bold">Degree IV (Subdominant)</span>
                        </li>
                        <li className="flex justify-between border-b border-white/5 pb-1">
                          <span className="text-zinc-400">🖐️ 5 Fingers:</span>
                          <span className="text-[#00FF41] font-bold">Degree V (Dominant)</span>
                        </li>
                        <li className="flex justify-between border-b border-white/5 pb-1">
                          <span className="text-zinc-400">🤙 Shaka / 🤘 Rock:</span>
                          <span className="text-[#00FF41] font-bold">Degrees VI / VII</span>
                        </li>
                        <li className="flex justify-between pt-0.5">
                          <span className="text-zinc-400">🔄 Wrist Tilt:</span>
                          <span className="text-amber-400 font-bold">Major ↔ Minor Mode</span>
                        </li>
                      </ul>
                    </div>

                    {/* Right Hand Tutorial Card */}
                    <div className="p-3.5 bg-black/40 border border-[#39FF14]/20 rounded-xl space-y-2.5">
                      <div className="flex items-center justify-between border-b border-white/10 pb-2">
                        <span className="text-[#39FF14] text-2xs font-mono font-bold uppercase tracking-wider flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full bg-[#39FF14]" />
                          RIGHT HAND: MODULATOR & EXPRESSION
                        </span>
                      </div>
                      <ul className="space-y-1.5 text-3xs font-mono text-zinc-300 leading-relaxed">
                        <li className="flex justify-between border-b border-white/5 pb-1">
                          <span className="text-zinc-400">☝️ 1 Finger:</span>
                          <span className="text-[#39FF14] font-bold">Root Position</span>
                        </li>
                        <li className="flex justify-between border-b border-white/5 pb-1">
                          <span className="text-zinc-400">✌️ 2 Fingers:</span>
                          <span className="text-[#39FF14] font-bold">1st Inversion</span>
                        </li>
                        <li className="flex justify-between border-b border-white/5 pb-1">
                          <span className="text-zinc-400">🤟 3 Fingers:</span>
                          <span className="text-[#39FF14] font-bold">7th Chord Extension</span>
                        </li>
                        <li className="flex justify-between border-b border-white/5 pb-1">
                          <span className="text-zinc-400">👍 Thumb Extended/Folded:</span>
                          <span className="text-[#39FF14] font-bold">High / Low Octave</span>
                        </li>
                        <li className="flex justify-between border-b border-white/5 pb-1">
                          <span className="text-zinc-400">↕️ Vertical Height:</span>
                          <span className="text-[#39FF14] font-bold">Synth Volume Modulation</span>
                        </li>
                        <li className="flex justify-between pt-0.5">
                          <span className="text-zinc-400">🔄 Wrist Angle:</span>
                          <span className="text-[#39FF14] font-bold">Filter Cutoff Sweep</span>
                        </li>
                      </ul>
                    </div>
                  </div>
                </div>

                {/* Performance Tips */}
                <div className="p-4 bg-white/[0.02] border border-white/5 rounded-2xl space-y-2">
                  <h4 className="text-3xs font-mono font-bold text-[#8E9299] uppercase tracking-wider">
                    💡 Performance Tips for Clear Gesture Tracking:
                  </h4>
                  <ul className="grid grid-cols-1 md:grid-cols-3 gap-2 text-3xs font-mono text-zinc-300 leading-relaxed">
                    <li className="bg-black/30 p-2.5 rounded-xl border border-white/5">
                      <strong className="text-[#00FF41] block mb-1">1. Frame Placement</strong>
                      Keep hands clearly inside camera view and separate from your chest or face.
                    </li>
                    <li className="bg-black/30 p-2.5 rounded-xl border border-white/5">
                      <strong className="text-[#00FF41] block mb-1">2. Stable Lighting</strong>
                      Ensure bright, front-facing light so finger joints remain clearly visible.
                    </li>
                    <li className="bg-black/30 p-2.5 rounded-xl border border-white/5">
                      <strong className="text-[#00FF41] block mb-1">3. Clear Extensions</strong>
                      Spread extended fingers distinctly to prevent joint overlap detection.
                    </li>
                  </ul>
                </div>

              </div>

            </div>

            {/* Footer */}
            <div className="p-4 bg-black/40 border-t border-white/5 flex justify-end">
              <button
                onClick={closeCheatSheet}
                className="px-6 py-2 bg-[#00FF41] hover:bg-[#22ff5a] active:scale-97 text-black text-3xs font-mono font-bold rounded-xl transition-all duration-200 uppercase tracking-widest cursor-pointer"
              >
                GOT IT
              </button>
            </div>
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
