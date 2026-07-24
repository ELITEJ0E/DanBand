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
  Volume2
} from 'lucide-react';

export default function ConductorView() {
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
      <div className="w-full border-b border-white/5 bg-black/40 backdrop-blur-md px-4 py-4 md:px-6 sticky top-0 z-30 shadow-md">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="w-2.5 h-2.5 rounded-full bg-[#00FF41] animate-ping shrink-0" />
            <h1 className="text-xl md:text-2xl font-extrabold tracking-tighter text-white uppercase select-none">
              BAND<span className="text-[#00FF41] drop-shadow-[0_0_12px_rgba(0,255,65,0.35)]">DAN</span>
            </h1>
            <div className="px-2.5 py-0.5 bg-white/5 border border-white/10 rounded-full text-[9px] font-mono tracking-widest text-[#00FF41]">
              CONDUCTOR MODE
            </div>
          </div>

          <div className="flex flex-wrap gap-4 md:gap-6 font-mono text-[10px]">
            <div className="flex flex-col">
              <span className="text-[#8E9299] uppercase text-[9px]">Session Mode</span>
              <span className="text-white font-bold">GESTURE Broadcaster</span>
            </div>
            <div className="flex flex-col">
              <span className="text-[#8E9299] uppercase text-[9px]">Protocol</span>
              <span className="text-[#00FF41] font-bold">WebRTC P2P</span>
            </div>
            <div className="flex flex-col">
              <span className="text-[#8E9299] uppercase text-[9px]">Active Listeners</span>
              <span className="text-[#00FF41] font-bold">
                {connections.filter((c) => c.status === 'connected').length.toString().padStart(2, '0')}
              </span>
            </div>
          </div>
        </div>
      </div>

      <main className="flex-1 max-w-5xl w-full mx-auto p-4 md:p-6 flex flex-col gap-6 relative z-10">
        
        {/* Quick control actions */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 bg-white/[0.02] backdrop-blur-md border border-white/5 p-4 rounded-2xl shadow-xl">
          <span className="text-3xs uppercase font-mono font-bold tracking-widest text-[#8E9299] pl-1 select-none">
            CONDUX CTRL PANEL • v1.1
          </span>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <button
              onClick={() => startPairingFlow()}
              className="flex-1 sm:flex-initial flex items-center justify-center gap-1.5 px-4 py-2.5 bg-[#00FF41] hover:bg-[#22ff5a] active:scale-97 text-black text-xs font-mono font-bold rounded-xl transition-all duration-200 cursor-pointer shadow-[0_4px_12px_rgba(0,255,65,0.2)]"
            >
              <Plus className="w-4 h-4" />
              <span>ADD LISTENER DEVICE</span>
            </button>
            
            <button
              onClick={() => setShowSettings(!showSettings)}
              className={`flex-1 sm:flex-initial flex items-center justify-center gap-1.5 px-4 py-2.5 text-xs border rounded-xl font-mono font-bold transition-all duration-200 cursor-pointer active:scale-97 ${
                showSettings 
                  ? 'bg-[#00FF41]/10 border-[#00FF41] text-[#00FF41]' 
                  : 'bg-white/5 border-white/10 text-zinc-300 hover:text-white hover:border-white/20'
              }`}
            >
              <Settings className="w-4 h-4" />
              <span>{showSettings ? 'CLOSE MAPPINGS' : 'EDIT CHORD MAP'}</span>
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
                <div className="text-center py-6 border border-dashed border-white/10 rounded-2xl bg-white/[0.01]">
                  <Smartphone className="w-7 h-7 text-[#8E9299]/50 mx-auto mb-2" />
                  <h3 className="font-mono font-bold text-3xs text-[#8E9299] uppercase tracking-wider">No Devices Connected</h3>
                  <p className="text-4xs text-zinc-500 mt-1.5 max-w-[180px] mx-auto font-sans leading-relaxed uppercase tracking-tight">
                    No active cell or internet signal is required. Tap Add Listener above.
                  </p>
                </div>
              )}
            </section>

            {/* Manual Keyboard & Chord Board Fallback */}
            <section id="manual_chord_board" className="bg-white/[0.01] backdrop-blur-lg border border-white/5 rounded-2xl p-5 shadow-2xl flex flex-col gap-4 relative w-full">
              <div className="absolute top-0 left-4 right-4 h-[1px] bg-gradient-to-r from-transparent via-white/5 to-transparent" />
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between border-b border-white/5 pb-3 gap-2">
                <div className="flex items-center gap-2">
                  <Volume2 className="w-4 h-4 text-[#00FF41]" />
                  <div>
                    <h2 className="font-mono font-bold text-2xs uppercase tracking-wider text-white">MANUAL BOARD</h2>
                    <p className="text-4xs text-[#8E9299]">Force transmit active chord instantly.</p>
                  </div>
                </div>

                {lastBroadcastTime > 0 && (
                  <span className="text-[9px] font-mono text-[#00FF41]/80 uppercase tracking-widest bg-[#00FF41]/10 px-2.5 py-0.5 border border-[#00FF41]/25 rounded-full">
                    {new Date(lastBroadcastTime).toLocaleTimeString()}
                  </span>
                )}
              </div>

              {/* Quick manual button grid from current mappings */}
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2.5">
                {activePreset.mappings.map((mapping) => {
                  const gesture = GESTURES.find((g) => g.id === mapping.gestureId);
                  const isCurrent = activeChord === mapping.chord;
                  return (
                    <button
                      key={mapping.gestureId}
                      onClick={() => broadcastChord(mapping.chord)}
                      disabled={!mapping.chord}
                      className={`group flex flex-col items-center justify-center p-3 border transition-all duration-300 cursor-pointer rounded-xl active:scale-95 ${
                        isCurrent
                          ? 'border-[#00FF41] bg-[#00FF41]/15 text-white shadow-[0_0_20px_rgba(0,255,65,0.25)] font-extrabold'
                          : 'border-white/5 bg-black/20 hover:bg-white/5 text-zinc-300 hover:border-white/20'
                      } disabled:opacity-10`}
                    >
                      <span className={`text-sm font-black font-mono tracking-tight block ${isCurrent ? 'text-[#00FF41] drop-shadow-[0_0_8px_rgba(0,255,65,0.3)]' : ''}`}>
                        {mapping.chord || '—'}
                      </span>
                      <span className="text-[9px] font-mono text-[#8E9299] uppercase mt-1 block tracking-wider">
                        {gesture?.name.split(' ')[0] || 'BTN'}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Silent custom chord trigger input */}
              <div className="border-t border-white/5 pt-3.5 flex flex-col gap-2.5">
                <span className="text-4xs text-[#8E9299] font-mono uppercase tracking-widest">CUSTOM DIRECT CHORD SHIELD BYPASS:</span>
                <div className="flex gap-2 w-full">
                  <input
                    type="text"
                    id="custom_chord_tx"
                    placeholder="e.g. F#m7"
                    maxLength={8}
                    className="flex-1 bg-black/40 border border-white/10 px-3.5 py-2.5 rounded-xl text-xs font-mono font-bold text-[#00FF41] placeholder-zinc-700 focus:outline-hidden focus:border-[#00FF41] uppercase tracking-wide text-center"
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
                    className="px-4 py-2.5 bg-white/5 hover:bg-white/10 active:scale-97 text-zinc-200 hover:text-white text-xs font-mono font-bold rounded-xl border border-white/15 hover:border-[#00FF41]/40 transition-all duration-200 cursor-pointer"
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
                <div className="py-8 flex flex-col items-center justify-center gap-3">
                  <RotateCcw className="w-8 h-8 animate-spin text-[#00FF41]" />
                  <div>
                    <h3 className="font-mono font-bold text-white text-xs uppercase tracking-wider">Generating Offer</h3>
                    <p className="text-[#8E9299] text-3xs mt-1 font-mono">{loadingProgress}</p>
                  </div>
                </div>
              )}

              {pairingStep === 'show_offer_qr' && (
                <div className="flex flex-col items-center gap-4 w-full">
                  <div className="text-zinc-300 text-xs max-w-[280px] font-mono uppercase tracking-tight">
                    <span className="font-bold text-[#00FF41]">Step 1:</span> Have <span className="font-bold text-white">{currentPairingName}</span> scan the QR code below.
                  </div>

                  <div className="bg-white p-4.5 rounded-2xl shadow-inner border border-white/10">
                    <QRCodeSVG
                      value={offerQRValue}
                      size={240}
                      level="L" // L is smaller matrix size, much easier to scan
                      includeMargin={false}
                    />
                  </div>

                  <button
                    onClick={copyOfferToClipboard}
                    className={`w-full py-2.5 border transition-all duration-200 text-3xs font-mono font-bold rounded-xl flex items-center justify-center gap-2 cursor-pointer uppercase tracking-wider ${
                      copiedOffer
                        ? 'border-[#00FF41] bg-[#00FF41]/15 text-[#00FF41]'
                        : 'border-white/10 bg-white/5 hover:bg-white/10 text-zinc-300 hover:text-white'
                    }`}
                  >
                    {copiedOffer ? 'OFFER COPIED!' : 'COPY CONNECTION CODE'}
                  </button>

                  {pairingError && (
                    <div className="flex items-center gap-1.5 text-[#FF4444] text-3xs bg-[#FF4444]/10 border border-[#FF4444]/20 px-3 py-1.5 rounded-xl max-w-[260px]">
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      <span>{pairingError}</span>
                    </div>
                  )}

                  <button
                    onClick={startAnswerScanner}
                    className="w-full py-3.5 bg-[#00FF41] hover:bg-[#22ff5a] active:scale-95 text-black text-xs font-mono font-bold rounded-xl shadow-[0_4px_16px_rgba(0,255,65,0.2)] transition-all duration-200 cursor-pointer uppercase tracking-wider"
                  >
                    Next: Scan Listener&apos;s Answer
                  </button>
                </div>
              )}

              {pairingStep === 'scanning_answer' && (
                <div className="flex flex-col items-center gap-4 w-full">
                  <div className="text-zinc-300 text-xs max-w-[280px] font-mono uppercase tracking-tight">
                    <span className="font-bold text-[#00FF41]">Step 2:</span> Scan the answer QR code shown on the listener&apos;s phone.
                  </div>

                  {/* QR Camera Reader Node */}
                  <div className="w-full aspect-square max-w-[220px] rounded-2xl overflow-hidden border border-white/10 bg-[#050508]/60 relative flex items-center justify-center">
                    {scannerActive ? (
                      <div id="answer-reader" className="w-full h-full" />
                    ) : (
                      <span className="text-3xs text-[#8E9299] font-mono uppercase">Starting camera scanner...</span>
                    )}
                    <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 border-t-2 border-[#00FF41]/60 pointer-events-none animate-pulse" />
                  </div>

                  <div className="flex items-center gap-2 my-1 w-full">
                    <div className="flex-1 h-[1px] bg-white/10" />
                    <span className="text-[9px] font-mono text-[#8E9299] uppercase tracking-wider">OR PASTE ANSWER</span>
                    <div className="flex-1 h-[1px] bg-white/10" />
                  </div>

                  <div className="flex flex-col gap-2 w-full">
                    <textarea
                      placeholder="PASTE LISTENER'S ANSWER CODE HERE..."
                      rows={2}
                      className="w-full bg-black/40 border border-white/10 focus:border-[#00FF41] rounded-xl px-3 py-2 text-[10px] font-mono text-[#00FF41] placeholder-zinc-700 focus:outline-hidden uppercase tracking-wide transition-all resize-none"
                      value={manualAnswerInput}
                      onChange={(e) => setManualAnswerInput(e.target.value)}
                    />
                    <button
                      onClick={handleManualAnswerSubmit}
                      disabled={!manualAnswerInput.trim()}
                      className="w-full py-2.5 bg-[#00FF41] hover:bg-[#22ff5a] disabled:bg-white/5 disabled:text-zinc-600 text-black text-3xs font-mono font-bold rounded-xl transition-all duration-200 uppercase tracking-widest cursor-pointer"
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

                  <div className="grid grid-cols-2 gap-3 w-full">
                    <button
                      onClick={() => {
                        stopScanner();
                        setPairingStep('show_offer_qr');
                      }}
                      className="py-2.5 border border-white/10 bg-white/5 hover:bg-white/10 active:scale-95 text-zinc-300 text-2xs font-mono font-bold rounded-xl transition-all uppercase tracking-wider"
                    >
                      Back to QR
                    </button>
                    <button
                      onClick={cancelPairing}
                      className="py-2.5 bg-[#FF4444]/15 border border-[#FF4444]/25 hover:bg-[#FF4444]/25 active:scale-95 text-[#FF4444] text-2xs font-mono font-bold rounded-xl transition-all uppercase tracking-wider"
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

    </div>
  );
}
