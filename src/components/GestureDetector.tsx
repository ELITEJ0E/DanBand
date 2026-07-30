import { useEffect, useRef, useState } from 'react';
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import { classifyHandGesture, GestureDiagnostic } from '../utils/classifier';
import { GestureType, GESTURES } from '../types';
import { Camera, RefreshCw, AlertTriangle, CheckCircle, Info } from 'lucide-react';

interface GestureDetectorProps {
  onGestureTriggered: (gestureId: GestureType) => void;
  activeChord: string;
}

export default function GestureDetector({ onGestureTriggered, activeChord }: GestureDetectorProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  
  const [landmarker, setLandmarker] = useState<HandLandmarker | null>(null);
  const [loadingState, setLoadingState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loadingProgress, setLoadingProgress] = useState<string>('Initializing vision tasks...');
  const [cameraFacing, setCameraFacing] = useState<'user' | 'environment'>('user');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [showDiagnostics, setShowDiagnostics] = useState<boolean>(false);
  
  const [diagnostic, setDiagnostic] = useState<GestureDiagnostic | null>(null);
  const [rawGesture, setRawGesture] = useState<GestureType>('none');
  const [debouncedGesture, setDebouncedGesture] = useState<GestureType>('none');
  
  // Ref for tracking debouncing state
  const rawGestureRef = useRef<GestureType>('none');
  const lastChangeTimeRef = useRef<number>(performance.now());
  const triggeredGestureRef = useRef<GestureType>('none');
  const animationFrameRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Load MediaPipe Hand Landmarker
  useEffect(() => {
    let active = true;
    async function loadModel() {
      try {
        setLoadingProgress('Loading WebAssembly Fileset (cached for offline)...');
        const vision = await FilesetResolver.forVisionTasks(
          'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.8/wasm'
        );
        
        if (!active) return;
        
        setLoadingProgress('Downloading Hand Landmarker Task Model...');
        const handLandmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
            delegate: 'GPU',
          },
          runningMode: 'VIDEO',
          numHands: 1,
        });

        if (!active) return;
        
        setLandmarker(handLandmarker);
        setLoadingState('ready');
      } catch (error) {
        console.error('Failed to load MediaPipe hand landmarker:', error);
        if (active) {
          setLoadingState('error');
          setLoadingProgress('Could not load Hand Landmarker model. Verify internet connection for initial cache.');
        }
      }
    }

    loadModel();
    return () => {
      active = false;
    };
  }, []);

  // Control camera stream
  useEffect(() => {
    if (loadingState !== 'ready') return;

    let active = true;
    
    async function startCamera() {
      // Clean up previous stream
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
      setCameraError(null);

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: cameraFacing,
            width: { ideal: 640 },
            height: { ideal: 480 },
          },
          audio: false,
        });

        if (!active) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.onloadedmetadata = () => {
            if (videoRef.current) {
              videoRef.current.play();
            }
          };
        }
      } catch (err: any) {
        console.error('Camera access failed:', err);
        if (active) {
          setCameraError(
            err.name === 'NotAllowedError'
              ? 'Camera permission denied. Please allow camera access in your browser.'
              : 'Could not access camera. Make sure no other app is using it.'
          );
        }
      }
    }

    startCamera();

    return () => {
      active = false;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, [loadingState, cameraFacing]);

  // Main processing and overlay rendering loop
  useEffect(() => {
    if (loadingState !== 'ready' || !landmarker) return;

    let active = true;

    function processVideoFrame() {
      if (!active) return;

      const video = videoRef.current;
      const canvas = canvasRef.current;
      
      if (video && canvas && video.readyState === 4) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          // Sync dimensions
          if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
          }

          // Clear previous canvas
          ctx.clearRect(0, 0, canvas.width, canvas.height);

          // Draw the video frame to canvas
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

          // Mirror the canvas if front camera to make it intuitive
          if (cameraFacing === 'user') {
            ctx.save();
            ctx.translate(canvas.width, 0);
            ctx.scale(-1, 1);
            // Redraw video mirrored
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          }

          // Run Hand Landmarker
          const startTimeMs = performance.now();
          const results = landmarker.detectForVideo(video, startTimeMs);

          // Draw landmarks and process classification
          if (results.landmarks && results.landmarks.length > 0) {
            const firstHandLandmarks = results.landmarks[0];
            
            // Draw skeleton dots and lines
            ctx.fillStyle = '#00FF41'; 
            ctx.strokeStyle = '#00FF41'; 
            ctx.lineWidth = 4;
 
            // Draw connections
            const connections = [
              [0, 1], [1, 2], [2, 3], [3, 4], // Thumb
              [0, 5], [5, 6], [6, 7], [7, 8], // Index
              [0, 9], [9, 10], [10, 11], [11, 12], // Middle
              [0, 13], [13, 14], [14, 15], [15, 16], // Ring
              [0, 17], [17, 18], [18, 19], [19, 20], // Pinky
              [5, 9], [9, 13], [13, 17] // Palm bridge
            ];
 
            // Helper to get X position (mirrored if front camera)
            const getX = (normalizedX: number) => {
              return cameraFacing === 'user' 
                ? (1 - normalizedX) * canvas.width 
                : normalizedX * canvas.width;
            };
 
            connections.forEach(([p1, p2]) => {
              const pt1 = firstHandLandmarks[p1];
              const pt2 = firstHandLandmarks[p2];
              if (pt1 && pt2) {
                ctx.beginPath();
                ctx.moveTo(getX(pt1.x), pt1.y * canvas.height);
                ctx.lineTo(getX(pt2.x), pt2.y * canvas.height);
                ctx.stroke();
              }
            });
 
            // Draw joint joints
            firstHandLandmarks.forEach((landmark) => {
              ctx.beginPath();
              ctx.arc(getX(landmark.x), landmark.y * canvas.height, 6, 0, 2 * Math.PI);
              ctx.fillStyle = '#FFFFFF'; // joint center white highlights
              ctx.fill();
            });

            // Run Gesture Classification
            const diagResult = classifyHandGesture(firstHandLandmarks);
            setDiagnostic(diagResult);
            
            const currentGesture = diagResult.gesture;
            setRawGesture(currentGesture);

            // Debounce processing:
            // Must be held steady for 150ms for lightning-fast, snappy updates
            if (currentGesture !== rawGestureRef.current) {
              rawGestureRef.current = currentGesture;
              lastChangeTimeRef.current = performance.now();
            } else {
              const duration = performance.now() - lastChangeTimeRef.current;
              if (duration >= 150) {
                if (currentGesture !== triggeredGestureRef.current) {
                  triggeredGestureRef.current = currentGesture;
                  setDebouncedGesture(currentGesture);
                  
                  if (currentGesture !== 'none') {
                    onGestureTriggered(currentGesture);
                  }
                }
              }
            }
          } else {
            // No hands visible
            setDiagnostic(null);
            setRawGesture('none');
            rawGestureRef.current = 'none';
          }

          // Restore canvas transform context if mirrored
          if (cameraFacing === 'user') {
            ctx.restore();
          }
        }
      }

      animationFrameRef.current = requestAnimationFrame(processVideoFrame);
    }

    animationFrameRef.current = requestAnimationFrame(processVideoFrame);

    return () => {
      active = false;
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [loadingState, landmarker, cameraFacing, onGestureTriggered]);

  const toggleCamera = () => {
    setCameraFacing((prev) => (prev === 'user' ? 'environment' : 'user'));
  };

  if (loadingState === 'loading') {
    return (
      <div id="gesture_loader" className="flex flex-col lg:flex-row gap-6 w-full max-w-5xl mx-auto animate-pulse select-none">
        {/* Left Column: Camera Live Feed Skeleton Mockup */}
        <div className="flex-1 flex flex-col bg-white/[0.01] border border-white/5 rounded-2xl overflow-hidden relative shadow-2xl min-h-[300px] md:min-h-[350px]">
          {/* Header Mockup */}
          <div className="p-3.5 bg-black/20 flex items-center justify-between border-b border-white/5">
            <div className="flex items-center gap-2 text-zinc-500 text-xs font-mono font-bold uppercase tracking-wider">
              <span className="w-2 h-2 rounded-full bg-[#00FF41]/40 animate-ping" />
              <span>INITIALIZING SYSTEM...</span>
            </div>
            <div className="w-20 h-5 bg-white/5 rounded-lg border border-white/10" />
          </div>

          {/* Large Feed Area with active laser scanner scan lines */}
          <div className="relative flex-1 bg-[#050508]/60 flex flex-col items-center justify-center p-6 overflow-hidden min-h-[220px]">
            {/* Horizontal glowing laser scan bar */}
            <div className="absolute left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-[#00FF41]/45 to-transparent shadow-[0_0_10px_rgba(0,255,65,0.4)] pointer-events-none animate-scan" />

            {/* Matrix HUD Corner Elements */}
            <div className="absolute top-4 left-4 w-3.5 h-3.5 border-t-2 border-l-2 border-white/10" />
            <div className="absolute top-4 right-4 w-3.5 h-3.5 border-t-2 border-r-2 border-white/10" />
            <div className="absolute bottom-4 left-4 w-3.5 h-3.5 border-b-2 border-l-2 border-white/10" />
            <div className="absolute bottom-4 right-4 w-3.5 h-3.5 border-b-2 border-r-2 border-white/10" />

            {/* Futuristic Skeleton Loader Display Box */}
            <div className="bg-[#12121A]/90 border border-[#00FF41]/15 rounded-2xl p-5 max-w-sm w-full relative z-10 text-center shadow-[0_0_30px_rgba(0,255,65,0.03)] backdrop-blur-md">
              <div className="flex items-center justify-center gap-2 mb-3">
                <span className="w-1.5 h-1.5 bg-[#00FF41] rounded-full animate-pulse" />
                <span className="text-[9px] font-mono text-[#00FF41] uppercase tracking-widest font-extrabold">BOOT SEQUENCE ACTIVE</span>
              </div>
              <h3 className="font-mono font-extrabold text-xs text-white uppercase tracking-wider mb-2">[ GESTURE ENGINE COLD-START ]</h3>
              
              {/* Dynamic skeleton progress loading bar */}
              <div className="w-full bg-white/5 h-1 rounded-full overflow-hidden mb-3 relative">
                <div className="bg-[#00FF41] h-full rounded-full absolute top-0 left-0 w-3/5 overflow-hidden">
                  <div className="w-full h-full bg-gradient-to-r from-transparent via-white/40 to-transparent animate-progress" />
                </div>
              </div>

              <p className="text-[#8E9299] text-[9px] font-mono uppercase tracking-widest leading-relaxed truncate px-1">
                {loadingProgress}
              </p>
            </div>

            {/* Futuristic terminal labels */}
            <div className="absolute bottom-3 left-4 text-[7px] font-mono text-zinc-600 flex gap-4 uppercase">
              <span>SYS_INIT: OK</span>
              <span>GPU_ACCEL: REQ</span>
            </div>
            <div className="absolute bottom-3 right-4 text-[7px] font-mono text-zinc-600 flex gap-4 uppercase">
              <span>WASM_LOAD: COMPILING</span>
            </div>
          </div>
        </div>

        {/* Right Column: Skeleton of Detected Gesture & Diagnostic Sidebar Panel */}
        <div className="w-full lg:w-80 flex flex-col gap-3">
          {/* Detected Gesture Skeleton */}
          <div className="p-4 bg-white/[0.01] border border-white/5 rounded-2xl flex flex-col gap-2.5 relative">
            <div className="w-20 h-2 bg-white/5 rounded-sm" />
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-white/[0.02] border border-white/5 rounded-xl flex items-center justify-center">
                <div className="w-5 h-5 bg-white/5 rounded-full" />
              </div>
              <div className="flex-1 space-y-1.5">
                <div className="w-2/3 h-3 bg-white/5 rounded-sm" />
                <div className="w-1/2 h-2 bg-white/5 rounded-sm" />
              </div>
            </div>
            <div className="border-t border-white/5 pt-2.5 mt-0.5 flex justify-between">
              <div className="space-y-1">
                <div className="w-14 h-2 bg-white/5 rounded-sm" />
                <div className="w-10 h-3 bg-white/5 rounded-sm" />
              </div>
              <div className="w-14 h-4 bg-[#00FF41]/10 border border-[#00FF41]/20 rounded-full" />
            </div>
          </div>

          {/* Toggle Diagnostics Button Skeleton */}
          <div className="w-full h-8 bg-white/5 border border-white/5 rounded-xl" />

          {/* System Calibration Skeleton */}
          <div className="p-4 bg-white/[0.01] border border-white/5 rounded-2xl flex flex-col gap-2.5">
            <div className="w-24 h-2 bg-white/5 rounded-sm" />
            <div className="space-y-2">
              <div className="w-full h-6 bg-white/5 rounded-lg" />
              <div className="grid grid-cols-2 gap-1.5">
                <div className="h-6 bg-white/[0.02] border border-white/5 rounded-lg" />
                <div className="h-6 bg-white/[0.02] border border-white/5 rounded-lg" />
                <div className="h-6 bg-white/[0.02] border border-white/5 rounded-lg" />
                <div className="h-6 bg-white/[0.02] border border-white/5 rounded-lg" />
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (loadingState === 'error') {
    return (
      <div id="gesture_error" className="flex flex-col items-center justify-center p-6 bg-[#12121A] border-2 border-[#FF4444]/40 rounded-xl max-w-md mx-auto text-center gap-4 shadow-xl">
        <AlertTriangle className="w-10 h-10 text-[#FF4444]" />
        <div>
          <h3 className="font-mono font-bold text-sm text-[#FF4444] uppercase tracking-wider">Gesture Engine Error</h3>
          <p className="text-zinc-400 text-xs mt-2 font-mono uppercase leading-relaxed">{loadingProgress}</p>
          <button 
            onClick={() => window.location.reload()}
            className="mt-4 px-4 py-2 bg-[#FF4444]/15 border-2 border-[#FF4444]/30 text-[#FF4444] hover:bg-[#FF4444]/25 rounded-lg text-xs font-mono font-bold transition cursor-pointer uppercase tracking-wider"
          >
            REBOOT SYSTEM
          </button>
        </div>
      </div>
    );
  }

  // Get matching gesture details
  const activeGestureDetails = GESTURES.find((g) => g.id === debouncedGesture);

  return (
    <div id="gesture_detector_panel" className="flex flex-col lg:flex-row gap-6 w-full max-w-5xl mx-auto">
      {/* Camera Live Feed */}
      <div className="flex-1 flex flex-col bg-white/[0.01] backdrop-blur-md border border-white/5 rounded-2xl overflow-hidden relative shadow-2xl">
        <div className="p-3.5 bg-black/20 flex items-center justify-between border-b border-white/5">
          <div className="flex items-center gap-2 text-zinc-300 text-xs font-mono font-bold uppercase tracking-wider">
            <Camera className="w-4 h-4 text-[#00FF41]" />
            <span>CONDUCTOR FEED</span>
          </div>
          <button
            onClick={toggleCamera}
            className="flex items-center gap-1.5 px-3 py-1 bg-white/5 hover:bg-white/10 active:scale-95 text-3xs text-zinc-200 font-mono font-bold uppercase tracking-widest rounded-lg border border-white/10 hover:border-[#00FF41]/40 transition-all duration-200 cursor-pointer"
            title="Toggle camera front/rear"
          >
            <RefreshCw className="w-2.5 h-2.5 text-[#00FF41]" />
            <span>{cameraFacing === 'user' ? 'FRONT' : 'REAR'}</span>
          </button>
        </div>

        <div className="relative aspect-video bg-[#050508]/60 flex items-center justify-center">
          {cameraError ? (
            <div className="p-4 text-center max-w-xs text-[#FF4444] text-xs font-mono flex flex-col items-center gap-2">
              <AlertTriangle className="w-8 h-8 text-[#FF4444]" />
              <span>{cameraError}</span>
            </div>
          ) : (
            <>
              {/* Invisible video element that feeds the detector */}
              <video
                ref={videoRef}
                playsInline
                muted
                className="hidden"
              />
              {/* Visible overlay canvas where we draw video + skeleton dots */}
              <canvas
                ref={canvasRef}
                className="w-full h-full object-cover max-h-[380px]"
              />
              
              {!diagnostic && (
                <div className="absolute inset-0 bg-black/60 backdrop-blur-3xs flex items-center justify-center pointer-events-none">
                  <div className="bg-[#12121A]/95 border border-white/10 rounded-xl px-4 py-2.5 text-zinc-300 text-3xs font-mono uppercase tracking-wider flex items-center gap-2 shadow-lg">
                    <Info className="w-4 h-4 text-[#00FF41] animate-pulse" />
                    <span>POSITION HAND CLEARLY IN CAMERA FRAME</span>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Diagnostics / Mapping Status */}
      <div className="w-full lg:w-80 flex flex-col gap-3">
        {/* Active Gesture & Chord Block */}
        <div className="p-4 bg-white/[0.02] backdrop-blur-md border border-white/5 rounded-2xl shadow-lg flex flex-col gap-2.5 relative">
          <div className="absolute top-0 left-4 right-4 h-[1px] bg-gradient-to-r from-transparent via-white/10 to-transparent" />
          <span className="text-[#8E9299] text-4xs font-mono font-bold uppercase tracking-wider">Detected Gesture</span>
          <div className="flex items-center gap-2.5">
            <div className="text-2xl bg-black/40 p-2 rounded-xl border border-white/5 min-w-[3rem] text-center shadow-inner">
              {activeGestureDetails?.emoji || '❓'}
            </div>
            <div>
              <div className="font-mono font-bold text-xs text-white uppercase tracking-wide">{activeGestureDetails?.name || 'NO GESTURE'}</div>
              <div className="text-[#8E9299] text-[9px] font-mono leading-tight mt-0.5">{activeGestureDetails?.description || 'ALIGN HAND TO PRESETS'}</div>
            </div>
          </div>

          <div className="border-t border-white/5 pt-2.5 mt-0.5 flex items-center justify-between">
            <div>
              <span className="text-[#8E9299] text-4xs font-mono uppercase tracking-wider block">Active broadcast</span>
              <span className="font-mono text-[#00FF41] font-bold text-xl tracking-tighter uppercase drop-shadow-[0_0_10px_rgba(0,255,65,0.25)]">{activeChord}</span>
            </div>
            {debouncedGesture !== 'none' ? (
              <span className="bg-[#00FF41]/15 text-[#00FF41] border border-[#00FF41]/30 text-4xs px-2 py-0.5 rounded-full font-mono font-bold uppercase tracking-widest flex items-center gap-1 shadow-sm">
                <CheckCircle className="w-2.5 h-2.5" />
                HELD
              </span>
            ) : (
              <span className="bg-white/5 text-zinc-500 border border-white/5 text-4xs px-2 py-0.5 rounded-full font-mono uppercase tracking-widest">
                WAITING
              </span>
            )}
          </div>
        </div>

        {/* Toggle Diagnostics Button */}
        <button
          onClick={() => setShowDiagnostics(!showDiagnostics)}
          className="w-full py-2 bg-white/5 hover:bg-white/10 text-zinc-400 hover:text-white text-4xs font-mono font-bold uppercase tracking-widest rounded-xl border border-white/10 transition-all duration-200 cursor-pointer active:scale-98"
        >
          {showDiagnostics ? '▲ HIDE SYSTEM DIAGNOSTICS' : '▼ SHOW CALIBRATION TOOLS'}
        </button>

        {/* Live Calibration Dashboard */}
        {showDiagnostics && (
          <div className="p-4 bg-white/[0.01] backdrop-blur-md border border-white/5 rounded-2xl flex flex-col gap-2.5 relative animate-fade-in">
            <div className="absolute top-0 left-4 right-4 h-[1px] bg-gradient-to-r from-transparent via-white/5 to-transparent" />
            <span className="text-white text-4xs font-mono font-bold uppercase tracking-widest flex items-center gap-1 select-none">
              <span className="w-1.5 h-1.5 rounded-full bg-[#00FF41] animate-pulse" />
              CALIBRATION DIAGNOSTICS
            </span>
            
            <div className="text-xs space-y-2 text-zinc-300">
              <div className="flex justify-between items-center bg-black/20 border border-white/5 px-2 py-1.5 rounded-xl text-[9px] font-mono uppercase tracking-wider">
                <span>Finger tracking:</span>
                <span className={diagnostic ? 'text-[#00FF41] font-bold' : 'text-zinc-600'}>
                  {diagnostic ? 'ACTIVE' : 'OFFLINE'}
                </span>
              </div>

              <div className="pt-1 font-mono font-bold text-4xs text-[#8E9299] uppercase tracking-widest">Extension Matrix</div>
              <div className="grid grid-cols-2 gap-1">
                {[
                  { label: 'Thumb', active: diagnostic?.thumb },
                  { label: 'Index', active: diagnostic?.index },
                  { label: 'Middle', active: diagnostic?.middle },
                  { label: 'Ring', active: diagnostic?.ring },
                  { label: 'Pinky', active: diagnostic?.pinky },
                ].map((finger) => (
                  <div 
                    key={finger.label} 
                    className={`flex justify-between items-center px-2 py-1 rounded-lg border text-[8px] font-mono transition ${
                      finger.active 
                        ? 'bg-[#00FF41]/10 border-[#00FF41]/35 text-[#00FF41]' 
                        : 'bg-white/[0.02] border-white/5 text-zinc-600'
                    }`}
                  >
                    <span className="uppercase">{finger.label}</span>
                    <span className="font-bold">{finger.active ? 'EXT' : 'FOLD'}</span>
                  </div>
                ))}
              </div>

              <div className="pt-1.5 font-mono font-bold text-4xs text-[#8E9299] uppercase tracking-widest">Palm orientation</div>
              <div className="grid grid-cols-2 gap-1">
                <div 
                  className={`flex justify-between items-center px-2 py-1 rounded-lg border text-[8px] font-mono ${
                    diagnostic?.isUpright 
                      ? 'bg-[#00FF41]/10 border-[#00FF41]/35 text-[#00FF41]' 
                      : 'bg-white/[0.02] border-white/5 text-zinc-600'
                  }`}
                >
                  <span>UPRIGHT</span>
                  <span className="font-bold">{diagnostic?.isUpright ? 'YES' : 'NO'}</span>
                </div>
                <div 
                  className={`flex justify-between items-center px-2 py-1 rounded-lg border text-[8px] font-mono ${
                    diagnostic?.isSideways 
                      ? 'bg-amber-500/10 border-amber-500/35 text-amber-500' 
                      : 'bg-white/[0.02] border-white/5 text-zinc-600'
                  }`}
                >
                  <span>SIDEWAYS</span>
                  <span className="font-bold">{diagnostic?.isSideways ? 'YES' : 'NO'}</span>
                </div>
              </div>

              <div className="mt-2 text-[8px] text-zinc-500 font-mono uppercase tracking-wider leading-relaxed text-center select-none">
                * HOLD GESTURE STEADY FOR 300MS TO TRANSMIT
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
