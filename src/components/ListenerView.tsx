import { useState, useEffect, useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Html5Qrcode } from 'html5-qrcode';
import { RTC_CONFIG, decompressSDP, compressSDP, waitForIceGathering } from '../utils/webrtc';
import { WebRTCMessage, ConnectionStatus } from '../types';
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
  Sparkles
} from 'lucide-react';

export default function ListenerView() {
  // Local Settings
  const [displayName, setDisplayName] = useState<string>(() => {
    return localStorage.getItem('banddan_display_name') || 'Keys';
  });

  // Pairing States
  const [pairingStep, setPairingStep] = useState<'name_entry' | 'scanning_conductor' | 'generating_answer' | 'show_answer_qr' | 'listening'>('name_entry');
  const [scannedOffer, setScannedOffer] = useState<RTCSessionDescriptionInit | null>(null);
  const [answerQRValue, setAnswerQRValue] = useState<string>('');
  const [pairingError, setPairingError] = useState<string | null>(null);

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
              const size = Math.min(width, height) * 0.7;
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
  };

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

      {/* 1. Name Entry & Setup */}
      {pairingStep === 'name_entry' && (
        <div id="listener_setup_card" className="flex-1 flex flex-col items-center justify-center max-w-sm mx-auto w-full gap-6 relative z-10">
          <div className="text-center flex flex-col items-center gap-3">
            <div className="bg-white/5 border border-white/10 p-4.5 rounded-2xl shadow-xl backdrop-blur-md">
              <Smartphone className="w-10 h-10 text-[#00FF41]" />
            </div>
            <div>
              <h1 className="text-xl md:text-2xl font-extrabold tracking-tighter text-white uppercase select-none">
                JOIN AS <span className="text-[#00FF41] drop-shadow-[0_0_12px_rgba(0,255,65,0.3)]">LISTENER</span>
              </h1>
              <p className="text-[10px] font-mono uppercase tracking-widest text-[#8E9299] max-w-[280px] mt-1.5 leading-relaxed">
                RECEIVE VISUAL CHORDS & HAPTIC VIBRATIONS DIRECTLY FROM CONDUCTOR
              </p>
            </div>
          </div>

          <div className="w-full bg-white/[0.02] backdrop-blur-md border border-white/10 p-6 rounded-2xl flex flex-col gap-4.5 shadow-2xl relative">
            <div className="absolute top-0 left-6 right-6 h-[1px] bg-gradient-to-r from-transparent via-white/15 to-transparent" />
            <div className="flex flex-col gap-1.5">
              <label htmlFor="displayName" className="text-4xs font-mono font-bold uppercase tracking-widest text-[#8E9299] select-none">
                Instrument / Member Name
              </label>
              <input
                id="displayName"
                type="text"
                placeholder="e.g. Drums, Keys, Bass"
                maxLength={16}
                value={displayName}
                onChange={(e) => handleNameChange(e.target.value)}
                className="w-full bg-[#050508]/60 border border-white/10 focus:border-[#00FF41] rounded-xl px-4 py-3 text-sm font-mono font-bold text-[#00FF41] placeholder-zinc-700 focus:outline-hidden uppercase tracking-wide transition-all"
              />
            </div>

            <button
              onClick={startConductorScanner}
              disabled={!displayName.trim()}
              className="w-full py-3.5 bg-[#00FF41] hover:bg-[#22ff5a] disabled:bg-[#12121A]/50 disabled:text-zinc-650 disabled:border-white/5 disabled:shadow-none active:scale-97 text-black text-xs font-mono font-bold rounded-xl shadow-[0_4px_16px_rgba(0,255,65,0.2)] transition-all duration-200 flex items-center justify-center gap-2 cursor-pointer uppercase tracking-wider"
            >
              <Camera className="w-4 h-4" />
              <span>SCAN CONDUCTOR QR</span>
            </button>
          </div>

          <div className="text-4xs text-zinc-650 font-mono text-center max-w-xs uppercase tracking-wider leading-relaxed">
            * Peer connection works directly over local Wi-Fi / Hotspot. No cellular internet required.
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
          <div className="w-full aspect-square bg-[#050508] border-2 border-[#2D2D3F] rounded-lg overflow-hidden relative flex items-center justify-center">
            {scannerActive ? (
              <div id="conductor-reader" className="w-full h-full" />
            ) : (
              <span className="text-3xs text-[#8E9299] font-mono uppercase">Initializing camera...</span>
            )}
            <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 border-t-2 border-[#00FF41]/60 pointer-events-none animate-pulse" />
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
        <div id="listener_generating_card" className="flex-1 flex flex-col items-center justify-center max-w-sm mx-auto w-full gap-3 text-center">
          <RefreshCw className="w-8 h-8 animate-spin text-[#00FF41]" />
          <h3 className="font-mono font-bold text-white text-xs uppercase tracking-wider">Processing Network Offer</h3>
          <p className="text-[#8E9299] text-4xs font-mono uppercase tracking-widest mt-1">Generating hand-shaking QR answer...</p>
        </div>
      )}

      {/* 4. Show Answer QR Code */}
      {pairingStep === 'show_answer_qr' && (
        <div id="listener_show_answer_card" className="flex-1 flex flex-col items-center justify-center max-w-sm mx-auto w-full gap-6">
          <div className="text-center flex flex-col items-center gap-1.5">
            <h2 className="text-sm font-extrabold uppercase tracking-widest text-[#00FF41] font-mono">Pairing Step 2</h2>
            <p className="text-xs text-zinc-200 font-mono uppercase tracking-wide">Show this QR back to the Conductor</p>
            <p className="text-4xs text-[#8E9299] font-mono max-w-[260px] uppercase tracking-wider mt-1.5 leading-relaxed">
              The Conductor must scan this code using their screen scanner to activate peer broadcast.
            </p>
          </div>

          <div className="bg-white p-4 rounded-lg shadow-2xl border-2 border-[#2D2D3F]">
            <QRCodeSVG
              value={answerQRValue}
              size={230}
              level="L"
              includeMargin={false}
            />
          </div>

          <div className="flex items-center gap-2.5 px-3 py-1.5 bg-[#12121A] border border-[#2D2D3F] rounded-lg text-4xs uppercase tracking-widest font-mono font-bold text-zinc-400">
            <RefreshCw className="w-3 h-3 animate-spin text-[#00FF41]" />
            <span>Awaiting peer verification...</span>
          </div>

          <button
            onClick={disconnectAndReset}
            className="px-4 py-2 bg-[#FF4444]/15 border-2 border-[#FF4444]/30 text-[#FF4444] hover:bg-[#FF4444]/25 text-xs font-mono font-bold rounded-lg transition cursor-pointer uppercase tracking-wider"
          >
            Cancel & Disconnect
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
                  {connectionStatus === 'connected' ? 'P2P CHORD CHANNEL' : 'DISCONNECTED'}
                </span>
              </div>
            </div>

            <button
              onClick={disconnectAndReset}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#FF4444]/15 border border-[#FF4444]/35 text-[#FF4444] hover:bg-[#FF4444]/25 rounded-lg text-4xs uppercase tracking-widest font-mono font-bold transition cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Leave</span>
            </button>
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
          <div className="border-t border-[#2D2D3F] pt-3 text-center text-4xs text-zinc-500 font-mono uppercase tracking-widest leading-normal">
            * Keep screen active. Device will haptic-vibrate on each transition.
          </div>

        </div>
      )}

    </div>
  );
}
