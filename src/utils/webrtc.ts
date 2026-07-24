import LZString from 'lz-string';

export const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

/**
 * Compresses an RTCSessionDescriptionInit object into a short alphanumeric string.
 */
export function compressSDP(desc: { type: string; sdp: string }): string {
  const payload = JSON.stringify({
    t: desc.type === 'offer' ? 'o' : 'a',
    s: desc.sdp,
  });
  return LZString.compressToEncodedURIComponent(payload);
}

/**
 * Decompresses a compressed string back into an RTCSessionDescriptionInit object.
 */
export function decompressSDP(compressed: string): RTCSessionDescriptionInit | null {
  try {
    const raw = LZString.decompressFromEncodedURIComponent(compressed);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return {
      type: parsed.t === 'o' ? 'offer' : 'answer',
      sdp: parsed.s,
    };
  } catch (error) {
    console.error('Failed to decompress SDP string:', error);
    return null;
  }
}

/**
 * Returns a promise that resolves when the peer connection's ICE gathering state becomes 'complete'.
 * Includes a fallback timeout so we don't stall the user interface if gathering takes too long.
 */
export function waitForIceGathering(pc: RTCPeerConnection, timeoutMs = 4000): Promise<void> {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === 'complete') {
      resolve();
      return;
    }

    let resolved = false;
    const done = () => {
      if (resolved) return;
      resolved = true;
      pc.removeEventListener('icegatheringstatechange', checkState);
      resolve();
    };

    const checkState = () => {
      if (pc.iceGatheringState === 'complete') {
        done();
      }
    };

    pc.addEventListener('icegatheringstatechange', checkState);
    setTimeout(done, timeoutMs);
  });
}
