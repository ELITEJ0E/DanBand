import { GestureType } from '../types';

interface Point3D {
  x: number;
  y: number;
  z: number;
}

function getDistance(p1: Point3D, p2: Point3D): number {
  return Math.sqrt((p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2 + (p1.z - p2.z) ** 2);
}

export interface GestureDiagnostic {
  gesture: GestureType;
  thumb: boolean;
  index: boolean;
  middle: boolean;
  ring: boolean;
  pinky: boolean;
  isSideways: boolean;
  isUpright: boolean;
}

/**
 * Classifies 21 MediaPipe hand landmarks into a specific static hand gesture.
 * Uses orientation-resilient relative joint distances.
 */
export function classifyHandGesture(landmarks: Point3D[]): GestureDiagnostic {
  if (!landmarks || landmarks.length < 21) {
    return {
      gesture: 'none',
      thumb: false,
      index: false,
      middle: false,
      ring: false,
      pinky: false,
      isSideways: false,
      isUpright: false,
    };
  }

  const wrist = landmarks[0];
  const thumbTip = landmarks[4];
  const thumbBase = landmarks[2];
  const indexTip = landmarks[8];
  const indexBase = landmarks[5];
  const indexPip = landmarks[6];
  const middleTip = landmarks[12];
  const middleBase = landmarks[9];
  const middlePip = landmarks[10];
  const ringTip = landmarks[16];
  const ringBase = landmarks[13];
  const ringPip = landmarks[14];
  const pinkyTip = landmarks[20];
  const pinkyBase = landmarks[17];
  const pinkyPip = landmarks[18];

  // Calculate hand scale for adaptive, distance-invariant thresholds
  const handScale = getDistance(wrist, middleBase);

  // Finger extension: is the distance from the base (MCP joint) to the tip
  // significantly larger than the distance from the base to the intermediate (PIP joint)?
  // Using a 1.20x threshold is very reliable.
  const indexExtended = getDistance(indexBase, indexTip) > getDistance(indexBase, indexPip) * 1.15;
  const middleExtended = getDistance(middleBase, middleTip) > getDistance(middleBase, middlePip) * 1.15;
  const ringExtended = getDistance(ringBase, ringTip) > getDistance(ringBase, ringPip) * 1.15;
  const pinkyExtended = getDistance(pinkyBase, pinkyTip) > getDistance(pinkyBase, pinkyPip) * 1.15;

  // Thumb extension: check thumb base to tip distance and make sure it is not pressed close to index base
  const thumbExtended =
    getDistance(thumbBase, thumbTip) > getDistance(thumbBase, landmarks[3]) * 1.12 &&
    getDistance(thumbTip, indexBase) > Math.max(0.04, handScale * 0.3);

  // Let's determine hand orientation using the wrist-to-middle-base vector.
  const dy = middleBase.y - wrist.y; // Y values are upside down in image space (0 is top)
  const dx = middleBase.x - wrist.x;

  const isUpright = dy < -0.05 && Math.abs(dx) < Math.abs(dy) * 1.5;
  const isSideways = Math.abs(dx) > 0.05 && Math.abs(dy) < Math.abs(dx) * 1.5;

  let gesture: GestureType = 'none';

  // Specific finger matching for exact finger counts 0 to 5 and variations
  if (indexExtended && middleExtended && ringExtended && pinkyExtended) {
    if (thumbExtended) {
      if (isSideways) {
        gesture = 'sideways';
      } else {
        gesture = 'open_palm';
      }
    } else {
      gesture = 'four_fingers';
    }
  } else if (indexExtended && middleExtended && ringExtended && !pinkyExtended) {
    gesture = 'three_fingers';
  } else if (indexExtended && pinkyExtended && !middleExtended && !ringExtended) {
    gesture = 'rock_on';
  } else if (indexExtended && middleExtended && !ringExtended && !pinkyExtended) {
    gesture = 'peace';
  } else if (indexExtended && !middleExtended && !ringExtended && !pinkyExtended && !thumbExtended) {
    gesture = 'pointing_index';
  } else if (thumbExtended && !indexExtended && !middleExtended && !ringExtended && !pinkyExtended) {
    if (thumbTip.y < thumbBase.y) {
      gesture = 'thumbs_up';
    }
  } else if (!indexExtended && !middleExtended && !ringExtended && !pinkyExtended && !thumbExtended) {
    gesture = 'fist';
  }

  return {
    gesture,
    thumb: thumbExtended,
    index: indexExtended,
    middle: middleExtended,
    ring: ringExtended,
    pinky: pinkyExtended,
    isSideways,
    isUpright,
  };
}
