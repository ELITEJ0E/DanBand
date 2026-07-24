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

  // Finger extension: is the distance from the base (MCP joint) to the tip
  // significantly larger than the distance from the base to the intermediate (PIP joint)?
  // Using a 1.20x threshold is very reliable.
  const indexExtended = getDistance(indexBase, indexTip) > getDistance(indexBase, indexPip) * 1.2;
  const middleExtended = getDistance(middleBase, middleTip) > getDistance(middleBase, middlePip) * 1.2;
  const ringExtended = getDistance(ringBase, ringTip) > getDistance(ringBase, ringPip) * 1.2;
  const pinkyExtended = getDistance(pinkyBase, pinkyTip) > getDistance(pinkyBase, pinkyPip) * 1.2;

  // Thumb extension: check thumb base to tip distance and make sure it is not pressed close to index base
  const thumbExtended =
    getDistance(thumbBase, thumbTip) > getDistance(thumbBase, landmarks[3]) * 1.2 &&
    getDistance(thumbTip, indexBase) > 0.07;

  // Let's determine hand orientation using the wrist-to-middle-base vector.
  const dy = middleBase.y - wrist.y; // Y values are upside down in image space (0 is top)
  const dx = middleBase.x - wrist.x;

  const isUpright = dy < -0.1 && Math.abs(dx) < Math.abs(dy) * 1.4;
  const isSideways = Math.abs(dx) > 0.1 && Math.abs(dy) < Math.abs(dx) * 1.4;

  let gesture: GestureType = 'none';

  // Count standard fingers extended
  const fingersExtendedCount =
    (indexExtended ? 1 : 0) +
    (middleExtended ? 1 : 0) +
    (ringExtended ? 1 : 0) +
    (pinkyExtended ? 1 : 0);

  if (fingersExtendedCount === 4 && thumbExtended) {
    if (isSideways) {
      gesture = 'sideways';
    } else {
      gesture = 'open_palm';
    }
  } else if (fingersExtendedCount === 0 && !thumbExtended) {
    gesture = 'fist';
  } else if (fingersExtendedCount === 1 && indexExtended && !middleExtended && !ringExtended && !pinkyExtended) {
    gesture = 'pointing_index';
  } else if (fingersExtendedCount === 2 && indexExtended && middleExtended && !ringExtended && !pinkyExtended) {
    gesture = 'peace';
  } else if (thumbExtended && fingersExtendedCount === 0) {
    // If only thumb is out and points higher than base
    if (thumbTip.y < thumbBase.y) {
      gesture = 'thumbs_up';
    }
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
