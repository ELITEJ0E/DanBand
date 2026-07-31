import { useEffect, useRef, useState } from 'react';
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import { classifyHandGesture, GestureDiagnostic } from '../utils/classifier';
import { GestureType, GESTURES } from '../types';
import { Camera, RefreshCw, AlertTriangle, CheckCircle, Info } from 'lucide-react';
import { getDiatonicChordName } from '../utils/audio';

interface GestureDetectorProps {
  onGestureTriggered: (gestureId: GestureType) => void;
  activeChord: string;
  // Advanced Gesture Synth Mode
  gestureSynthMode?: boolean;
  rootKey?: string;
  scaleMode?: 'major' | 'minor';
  onSynthChordChange?: (chord: string, params: any) => void;
  onModeToggle?: (mode: 'single' | 'dual') => void;
}

export default function GestureDetector({ 
  onGestureTriggered, 
  activeChord,
  gestureSynthMode = false,
  rootKey = 'C',
  scaleMode = 'major',
  onSynthChordChange,
  onModeToggle
}: GestureDetectorProps) {
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
  
  // Real-time HUD states for advanced synth
  const [synthHUDState, setSynthHUDState] = useState<{
    leftHand: { visible: boolean; degreeNum: number; degreeLabel: string; mode: 'major' | 'minor'; angle: number; tilt: string };
    rightHand: { visible: boolean; quality: string; inversion: number; seventhType: string; octave: string; filterCutoff: number; volume: number };
    currentSynthChord: string;
  }>({
    leftHand: { visible: false, degreeNum: 0, degreeLabel: '—', mode: 'major', angle: 0, tilt: 'NEUTRAL' },
    rightHand: { visible: false, quality: 'Root', inversion: 0, seventhType: 'none', octave: 'lower', filterCutoff: 1500, volume: 0.15 },
    currentSynthChord: '—'
  });

  // Ref for tracking debouncing state
  const rawGestureRef = useRef<GestureType>('none');
  const lastChangeTimeRef = useRef<number>(performance.now());
  const triggeredGestureRef = useRef<GestureType>('none');
  const animationFrameRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const lastHUDFrameTimeRef = useRef<number>(0);

  // Keep a ref of current synth parameters to avoid redundant rendering states and triggers
  const lastSynthParamsRef = useRef({
    chord: '—',
    degree: 0,
    mode: 'major' as 'major' | 'minor',
    inversion: 0,
    seventhType: 'none' as 'none' | 'maj7' | 'dom7',
    octaveOffset: -1,
    filterCutoff: 2000,
    volume: 0.15
  });

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
          numHands: 2, // Always support up to 2 hands for advanced performance synthesis
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

    // Helper to calculate Euclidean distance
    const getDistance = (p1: any, p2: any) => {
      return Math.sqrt((p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2 + (p1.z - p2.z) ** 2);
    };

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

          // Helper to get X position (mirrored if front camera)
          const getX = (normalizedX: number) => {
            return cameraFacing === 'user' 
              ? (1 - normalizedX) * canvas.width 
              : normalizedX * canvas.width;
          };

          if (gestureSynthMode) {
            // ==========================================
            // ADVANCED DUAL-HAND GESTURE SYNTH MODE
            // ==========================================
            let detectedLeft = false;
            let detectedRight = false;

            let leftDegreeNum = 0;
            let leftDegreeLabel = '—';
            let leftMode: 'major' | 'minor' = scaleMode;
            let leftAngle = 0;
            let leftTiltLabel = 'NEUTRAL';

            let rightQuality = 'Root Position';
            let rightInversion = 0;
            let rightSeventhType: 'none' | 'maj7' | 'dom7' = 'none';
            let rightOctaveLabel = 'higher';
            let rightOctaveOffset = 0;
            let rightFilterCutoff = 1800;
            let rightVolume = 0.16;
            let rightAngle = 0;

            if (results.landmarks && results.landmarks.length > 0) {
              // OPTIMIZATION & ACCURACY: Sort hands spatially by screen X coordinate
              // Left side of camera screen = Left Hand (Degree Controller)
              // Right side of camera screen = Right Hand (Synth Modulator)
              const handsWithPos = results.landmarks.map((lm, idx) => {
                const wrist = lm[0];
                const screenX = wrist ? getX(wrist.x) : canvas.width / 2;
                const rawHandType = results.handednesses?.[idx]?.[0]?.categoryName || 'Left';
                return { landmarks: lm, screenX, rawHandType, index: idx };
              }).sort((a, b) => a.screenX - b.screenX);

              const numHands = handsWithPos.length;

              handsWithPos.forEach((handObj) => {
                const { landmarks, screenX } = handObj;
                const wrist = landmarks[0];
                const mBase = landmarks[9];
                const mTip = landmarks[12];
                if (!wrist || !mBase || !mTip) return;

                const handScale = getDistance(wrist, mBase);

                // High-precision Finger Extension Metrics
                const isExt = (tipIdx: number, pipIdx: number, mcpIdx: number) => {
                  const tip = landmarks[tipIdx];
                  const pip = landmarks[pipIdx];
                  const mcp = landmarks[mcpIdx];
                  return getDistance(tip, wrist) > getDistance(pip, wrist) * 1.08 &&
                         getDistance(tip, mcp) > handScale * 0.42;
                };

                const idx = isExt(8, 6, 5);
                const mid = isExt(12, 10, 9);
                const rng = isExt(16, 14, 13);
                const pnk = isExt(20, 18, 17);
                const t = getDistance(landmarks[4], landmarks[5]) > getDistance(landmarks[3], landmarks[5]) * 1.15 &&
                          getDistance(landmarks[4], landmarks[17]) > handScale * 0.50;

                // Hand tilt angle (degrees)
                const angle = Math.atan2(mTip.x - mBase.x, mBase.y - mTip.y) * (180 / Math.PI);

                // Determine role by screen space position:
                // If 2 hands: left screen hand is Left, right screen hand is Right
                // If 1 hand: if in left 65% of screen, treat as Left Hand (Degree player)
                let isLeftHand = false;
                if (numHands === 2) {
                  isLeftHand = (screenX < canvas.width / 2);
                } else {
                  isLeftHand = (screenX < canvas.width * 0.65);
                }

                // UNIFIED MATRIX GREEN THEME (Left: Matrix Green #00FF41, Right: Neon Spring Green #39FF14)
                const handColor = isLeftHand ? '#00FF41' : '#39FF14';
                ctx.fillStyle = handColor;
                ctx.strokeStyle = handColor;
                ctx.lineWidth = 3.5;

                const skeletonConnections = [
                  [0, 1], [1, 2], [2, 3], [3, 4],
                  [0, 5], [5, 6], [6, 7], [7, 8],
                  [0, 9], [9, 10], [10, 11], [11, 12],
                  [0, 13], [13, 14], [14, 15], [15, 16],
                  [0, 17], [17, 18], [18, 19], [19, 20],
                  [5, 9], [9, 13], [13, 17]
                ];

                skeletonConnections.forEach(([p1, p2]) => {
                  const pt1 = landmarks[p1];
                  const pt2 = landmarks[p2];
                  if (pt1 && pt2) {
                    ctx.beginPath();
                    ctx.moveTo(getX(pt1.x), pt1.y * canvas.height);
                    ctx.lineTo(getX(pt2.x), pt2.y * canvas.height);
                    ctx.stroke();
                  }
                });

                landmarks.forEach((landmark) => {
                  ctx.beginPath();
                  ctx.arc(getX(landmark.x), landmark.y * canvas.height, 4.5, 0, 2 * Math.PI);
                  ctx.fillStyle = '#FFFFFF';
                  ctx.fill();
                });

                // HUD overlay above hand base
                const hudX = getX(mBase.x);
                const hudY = mBase.y * canvas.height - 38;

                ctx.save();
                if (cameraFacing === 'user') {
                  ctx.scale(-1, 1);
                  ctx.translate(-canvas.width, 0);
                }

                const screenHUDX = cameraFacing === 'user' ? (canvas.width - hudX) : hudX;

                // Glass box backdrop in unified matrix green style
                ctx.fillStyle = 'rgba(7, 15, 9, 0.88)';
                ctx.strokeStyle = handColor;
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.roundRect(screenHUDX - 65, hudY - 15, 130, 42, 6);
                ctx.fill();
                ctx.stroke();

                ctx.font = 'bold 9px monospace';
                ctx.fillStyle = '#FFFFFF';
                ctx.textAlign = 'center';

                if (isLeftHand) {
                  detectedLeft = true;
                  leftAngle = angle;

                  if (angle < -7) {
                    leftMode = 'major';
                    leftTiltLabel = 'INWARD (MAJOR)';
                  } else if (angle > 7) {
                    leftMode = 'minor';
                    leftTiltLabel = 'OUTWARD (MINOR)';
                  } else {
                    leftMode = scaleMode;
                    leftTiltLabel = 'NEUTRAL';
                  }

                  const extCount = (idx ? 1 : 0) + (mid ? 1 : 0) + (rng ? 1 : 0) + (pnk ? 1 : 0) + (t ? 1 : 0);

                  if (idx && !mid && !rng && !pnk && !t) {
                    leftDegreeNum = 1; leftDegreeLabel = 'I';
                  } else if (idx && mid && !rng && !pnk && !t) {
                    leftDegreeNum = 2; leftDegreeLabel = 'II';
                  } else if (idx && mid && rng && !pnk && !t) {
                    leftDegreeNum = 3; leftDegreeLabel = 'III';
                  } else if (idx && mid && rng && pnk && !t) {
                    leftDegreeNum = 4; leftDegreeLabel = 'IV';
                  } else if (idx && mid && rng && pnk && t) {
                    leftDegreeNum = 5; leftDegreeLabel = 'V';
                  } else if (idx && pnk && !mid && !rng) {
                    leftDegreeNum = 6; leftDegreeLabel = 'VI';
                  } else if (idx && pnk && t && !mid && !rng) {
                    leftDegreeNum = 7; leftDegreeLabel = 'VII';
                  } else {
                    if (extCount === 1) { leftDegreeNum = 1; leftDegreeLabel = 'I'; }
                    else if (extCount === 2) { leftDegreeNum = 2; leftDegreeLabel = 'II'; }
                    else if (extCount === 3) { leftDegreeNum = 3; leftDegreeLabel = 'III'; }
                    else if (extCount === 4) { leftDegreeNum = 4; leftDegreeLabel = 'IV'; }
                    else if (extCount === 5) { leftDegreeNum = 5; leftDegreeLabel = 'V'; }
                  }

                  ctx.fillStyle = '#00FF41';
                  ctx.fillText(`L: DEGREE ${leftDegreeLabel}`, screenHUDX, hudY - 4);
                  ctx.font = '8px monospace';
                  ctx.fillStyle = '#A0A0A8';
                  ctx.fillText(leftTiltLabel, screenHUDX, hudY + 6);
                  ctx.fillText(`TILT: ${Math.round(angle)}°`, screenHUDX, hudY + 16);

                } else {
                  detectedRight = true;
                  rightAngle = angle;

                  const rCount = (idx ? 1 : 0) + (mid ? 1 : 0) + (rng ? 1 : 0) + (pnk ? 1 : 0);
                  if (rCount === 1) {
                    rightQuality = 'Root Position';
                    rightInversion = 0;
                    rightSeventhType = 'none';
                  } else if (rCount === 2) {
                    rightQuality = '1st Inversion';
                    rightInversion = 1;
                    rightSeventhType = 'none';
                  } else if (rCount === 3) {
                    rightQuality = 'Major/Minor 7th';
                    rightInversion = 0;
                    rightSeventhType = 'maj7';
                  } else if (rCount === 4) {
                    rightQuality = 'Dom/Dim 7th';
                    rightInversion = 1;
                    rightSeventhType = 'dom7';
                  }

                  if (t) {
                    rightOctaveLabel = 'LOWER OCT';
                    rightOctaveOffset = -1;
                  } else {
                    rightOctaveLabel = 'HIGHER OCT';
                    rightOctaveOffset = 0;
                  }

                  if (angle > 7) {
                    rightFilterCutoff = Math.max(300, 1600 - (angle - 7) * 110);
                  } else if (angle < -7) {
                    rightFilterCutoff = Math.min(6000, 1600 + (-angle - 7) * 160);
                  } else {
                    rightFilterCutoff = 1600;
                  }

                  rightVolume = Math.max(0.01, Math.min(0.28, (1 - mBase.y) * 0.35));

                  ctx.fillStyle = '#39FF14';
                  ctx.fillText(`R: ${rightQuality.split(' ')[0]}`, screenHUDX, hudY - 4);
                  ctx.font = '8px monospace';
                  ctx.fillStyle = '#A0A0A8';
                  ctx.fillText(rightOctaveLabel, screenHUDX, hudY + 6);
                  ctx.fillText(`FLT: ${Math.round(rightFilterCutoff)}Hz`, screenHUDX, hudY + 16);
                }

                ctx.restore();
              });
            }

            // Fallback right hand default if only left hand is in view (one-handed play support)
            if (detectedLeft && !detectedRight) {
              rightInversion = 0;
              rightSeventhType = 'none';
              rightOctaveOffset = -1;
              rightFilterCutoff = 1800;
              rightVolume = 0.16;
            }

            // Resolve target diatonic chord name if left hand is playing
            const resolvedChord = detectedLeft && leftDegreeNum >= 1 
              ? getDiatonicChordName(rootKey, leftMode, leftDegreeNum, rightSeventhType)
              : '—';

            // Trigger real-time chord update on change or continuous parameter sweeps
            if (detectedLeft && leftDegreeNum >= 1) {
              const lastParams = lastSynthParamsRef.current;
              const chordChanged = resolvedChord !== lastParams.chord;
              const filterChanged = Math.abs(rightFilterCutoff - lastParams.filterCutoff) > 200;
              const volumeChanged = Math.abs(rightVolume - lastParams.volume) > 0.03;

              if (chordChanged || filterChanged || volumeChanged) {
                const newParams = {
                  degree: leftDegreeNum,
                  mode: leftMode,
                  inversion: rightInversion,
                  seventhType: rightSeventhType,
                  octaveOffset: rightOctaveOffset,
                  filterCutoff: rightFilterCutoff,
                  volume: rightVolume,
                  chord: resolvedChord
                };
                lastSynthParamsRef.current = newParams;
                onSynthChordChange?.(resolvedChord, newParams);
              }
            } else if (!detectedLeft) {
              if (lastSynthParamsRef.current.chord !== '—') {
                lastSynthParamsRef.current.chord = '—';
                onSynthChordChange?.('—', null);
              }
            }

            // Throttled HUD State updates (max 20fps) to keep UI buttery smooth without React re-render lag
            const nowMs = performance.now();
            if (nowMs - lastHUDFrameTimeRef.current > 45) {
              lastHUDFrameTimeRef.current = nowMs;
              setSynthHUDState({
                leftHand: {
                  visible: detectedLeft,
                  degreeNum: leftDegreeNum,
                  degreeLabel: leftDegreeLabel,
                  mode: leftMode,
                  angle: leftAngle,
                  tilt: leftTiltLabel
                },
                rightHand: {
                  visible: detectedRight,
                  quality: rightQuality,
                  inversion: rightInversion,
                  seventhType: rightSeventhType,
                  octave: rightOctaveLabel,
                  filterCutoff: rightFilterCutoff,
                  volume: rightVolume
                },
                currentSynthChord: resolvedChord
              });
            }

          } else {
            // ==========================================
            // ORIGINAL SINGLE-HAND PRESET MAPPING MODE
            // ==========================================
            if (results.landmarks && results.landmarks.length > 0) {
              const firstHandLandmarks = results.landmarks[0];
              
              // Draw skeleton dots and lines
              ctx.fillStyle = '#00FF41'; 
              ctx.strokeStyle = '#00FF41'; 
              ctx.lineWidth = 4;
   
              const connections = [
                [0, 1], [1, 2], [2, 3], [3, 4], // Thumb
                [0, 5], [5, 6], [6, 7], [7, 8], // Index
                [0, 9], [9, 10], [10, 11], [11, 12], // Middle
                [0, 13], [13, 14], [14, 15], [15, 16], // Ring
                [0, 17], [17, 18], [18, 19], [19, 20], // Pinky
                [5, 9], [9, 13], [13, 17] // Palm bridge
              ];
   
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
  }, [loadingState, landmarker, cameraFacing, onGestureTriggered, gestureSynthMode, rootKey, scaleMode, onSynthChordChange]);

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
        <div className="p-3.5 bg-black/20 flex flex-wrap items-center justify-between gap-2 border-b border-white/5">
          <div className="flex items-center gap-2 text-zinc-300 text-xs font-mono font-bold uppercase tracking-wider">
            <Camera className="w-4 h-4 text-[#00FF41]" />
            <span>
              {gestureSynthMode ? 'DUAL-HAND SYNTH PERFORMANCE' : '1-HAND GESTURE CONDUCTOR'}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={toggleCamera}
              className="flex items-center gap-1.5 px-2.5 py-1 bg-white/5 hover:bg-white/10 active:scale-95 text-3xs text-zinc-200 font-mono font-bold uppercase tracking-widest rounded-lg border border-white/10 hover:border-[#00FF41]/40 transition-all duration-200 cursor-pointer"
              title="Toggle camera front/rear"
            >
              <RefreshCw className="w-2.5 h-2.5 text-[#00FF41]" />
              <span>{cameraFacing === 'user' ? 'FRONT' : 'REAR'}</span>
            </button>
          </div>
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
            </>
          )}
        </div>
      </div>

      {/* Diagnostics / Mapping Status */}
      <div className="w-full lg:w-80 flex flex-col gap-3">
        {gestureSynthMode ? (
          // ===============================================
          // ADVANCED GESTURE SYNTH HUD SIDEBAR
          // ===============================================
          <div className="flex flex-col gap-3">
            {/* Live Chord Output Status */}
            <div className="p-4 bg-white/[0.02] backdrop-blur-md border border-[#00FF41]/20 rounded-2xl shadow-lg flex flex-col gap-2 relative">
              <div className="absolute top-0 left-4 right-4 h-[1px] bg-gradient-to-r from-transparent via-[#00FF41]/40 to-transparent" />
              <span className="text-[#8E9299] text-4xs font-mono font-bold uppercase tracking-wider">Dynamic Synth Output</span>
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-zinc-500 text-4xs font-mono uppercase">TRANSMITTING CHORD</span>
                  <span className="font-mono text-[#00FF41] font-bold text-2xl tracking-tighter uppercase block drop-shadow-[0_0_15px_rgba(0,255,65,0.35)] mt-0.5">
                    {activeChord !== '—' ? activeChord : '—'}
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-zinc-500 text-4xs font-mono uppercase block">SCALE ROOT</span>
                  <span className="font-mono text-white font-black text-sm uppercase block mt-1">
                    {rootKey} {scaleMode.toUpperCase()}
                  </span>
                </div>
              </div>
            </div>

            {/* Left Hand Controller Block */}
            <div className="p-3.5 bg-[#0A1A0F]/60 border border-[#00FF41]/25 rounded-2xl flex flex-col gap-2 relative shadow-md">
              <div className="flex items-center justify-between border-b border-[#00FF41]/15 pb-1.5">
                <span className="text-[#00FF41] text-4xs font-mono font-extrabold uppercase tracking-widest flex items-center gap-1.5">
                  <span className={`w-1.5 h-1.5 rounded-full ${synthHUDState.leftHand.visible ? 'bg-[#00FF41] animate-pulse shadow-[0_0_8px_#00FF41]' : 'bg-zinc-700'}`} />
                  LEFT: DIATONIC HARMONY
                </span>
                <span className="text-zinc-500 text-4xs font-mono">
                  {synthHUDState.leftHand.visible ? 'TRACKING' : 'OFFLINE'}
                </span>
              </div>

              {synthHUDState.leftHand.visible ? (
                <div className="space-y-1.5 font-mono text-3xs">
                  <div className="flex justify-between">
                    <span className="text-zinc-400">SCALE DEGREE:</span>
                    <span className="text-[#00FF41] font-bold text-xs">{synthHUDState.leftHand.degreeLabel}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-400">HARMONIC MODE:</span>
                    <span className="text-white font-bold">{synthHUDState.leftHand.mode.toUpperCase()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-400">HAND TILT / VECTOR:</span>
                    <span className="text-zinc-300">{synthHUDState.leftHand.tilt}</span>
                  </div>
                </div>
              ) : (
                <span className="text-zinc-600 text-[9px] font-mono uppercase text-center py-2 border border-dashed border-zinc-800 rounded-lg bg-black/10">
                  Awaiting Left Hand (Scale Degree)
                </span>
              )}
            </div>

            {/* Right Hand Modulators Block */}
            <div className="p-3.5 bg-[#0A1A0F]/40 border border-[#39FF14]/25 rounded-2xl flex flex-col gap-2 relative shadow-md">
              <div className="flex items-center justify-between border-b border-[#39FF14]/15 pb-1.5">
                <span className="text-[#39FF14] text-4xs font-mono font-extrabold uppercase tracking-widest flex items-center gap-1.5">
                  <span className={`w-1.5 h-1.5 rounded-full ${synthHUDState.rightHand.visible ? 'bg-[#39FF14] animate-pulse shadow-[0_0_8px_#39FF14]' : 'bg-zinc-700'}`} />
                  RIGHT: SYNTH MODULATOR
                </span>
                <span className="text-zinc-500 text-4xs font-mono">
                  {synthHUDState.rightHand.visible ? 'TRACKING' : 'OFFLINE'}
                </span>
              </div>

              {synthHUDState.rightHand.visible ? (
                <div className="space-y-1.5 font-mono text-3xs">
                  <div className="flex justify-between">
                    <span className="text-zinc-400">CHORD POSITION:</span>
                    <span className="text-[#39FF14] font-bold">{synthHUDState.rightHand.quality}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-400">OCTAVE SHIFT:</span>
                    <span className="text-zinc-200 uppercase">{synthHUDState.rightHand.octave}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-400">FILTER CUTOFF:</span>
                    <span className="text-[#39FF14] font-bold">{synthHUDState.rightHand.filterCutoff} Hz</span>
                  </div>
                  <div className="space-y-1 pt-1 border-t border-white/5">
                    <div className="flex justify-between text-[9px]">
                      <span className="text-zinc-500">DYNAMIC GAIN (VOLUME)</span>
                      <span className="text-white font-bold">{Math.round(synthHUDState.rightHand.volume * 350)}%</span>
                    </div>
                    <div className="w-full bg-zinc-800 h-1.5 rounded-full overflow-hidden relative">
                      <div 
                        className="bg-[#39FF14] h-full rounded-full transition-all duration-150 shadow-[0_0_6px_#39FF14]" 
                        style={{ width: `${Math.min(100, synthHUDState.rightHand.volume * 350)}%` }} 
                      />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-center py-2.5 bg-black/10 border border-dashed border-zinc-800 rounded-lg flex flex-col gap-1">
                  <span className="text-zinc-600 text-[9px] font-mono uppercase">
                    Awaiting Right Hand (Modulator)
                  </span>
                  <span className="text-zinc-600 text-[8px] font-mono uppercase">
                    * Defaults: Root Position, Higher Octave
                  </span>
                </div>
              )}
            </div>
          </div>
        ) : (
          // ===============================================
          // STANDARD PRESET GESTURE BLOCK
          // ===============================================
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
        )}

        {/* Toggle Diagnostics Button (Only for Standard mode or for generic details) */}
        {!gestureSynthMode && (
          <>
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
          </>
        )}
      </div>
    </div>
  );
}

