import LZString from 'lz-string';

export const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

/**
 * Super-minifies a WebRTC SDP for DataChannel by extracting only the absolute essentials.
 * This filters out all non-essential lines and compresses the fingerprint and candidates.
 */
function extractSDPParams(sdp: string) {
  let ufrag = '';
  let pwd = '';
  let fingerprint = '';
  const candidates: Array<[string, number, string]> = []; // [ip, port, type]

  const lines = sdp.split('\n');
  for (let rawLine of lines) {
    const line = rawLine.trim();
    if (line.startsWith('a=ice-ufrag:')) {
      ufrag = line.substring('a=ice-ufrag:'.length);
    } else if (line.startsWith('a=ice-pwd:')) {
      pwd = line.substring('a=ice-pwd:'.length);
    } else if (line.startsWith('a=fingerprint:')) {
      // Remove 'sha-256 ' and colons to save huge space
      const fp = line.substring('a=fingerprint:'.length).replace('sha-256 ', '');
      fingerprint = fp.replace(/:/g, '').toLowerCase();
    } else if (line.startsWith('a=candidate:')) {
      const lower = line.toLowerCase();
      // Skip obvious IPv6 lines
      if (lower.includes('ip6')) continue;

      const parts = line.split(' ');
      if (parts.length >= 8) {
        const ip = parts[4];
        const port = parseInt(parts[5], 10);
        const type = parts[7]; // e.g. 'host', 'srflx'
        
        // Skip IPv6 addresses (which contain colons)
        if (ip.includes(':')) continue;
        
        // Skip duplicate candidates to save space
        if (ip && port && !candidates.some(c => c[0] === ip && c[1] === port)) {
          candidates.push([ip, port, type]);
        }
      }
    }
  }

  // Prioritize typical local IPv4 addresses (192.168.x.x, 10.x.x.x, 172.16-31.x.x)
  candidates.sort((a, b) => {
    const ipA = a[0];
    const ipB = b[0];
    const isLocalA = ipA.startsWith('192.168.') || ipA.startsWith('10.') || ipA.startsWith('172.');
    const isLocalB = ipB.startsWith('192.168.') || ipB.startsWith('10.') || ipB.startsWith('172.');
    if (isLocalA && !isLocalB) return -1;
    if (!isLocalA && isLocalB) return 1;
    return 0;
  });

  // Limit to 3 candidates to guarantee connectivity across local WiFi and public cellular/internet (STUN) networks
  const limitedCandidates = candidates.slice(0, 3);

  return { ufrag, pwd, fingerprint, candidates: limitedCandidates };
}

/**
 * Reconstructs a fully valid WebRTC DataChannel SDP from the super-minified parameters.
 */
function reconstructSDP(type: 'offer' | 'answer', params: any): string {
  const { u, p, f, c } = params;
  
  // Restore fingerprint colons: 'aabbcc...' -> 'AA:BB:CC...'
  let restoredFingerprint = '';
  if (f) {
    const upper = f.toUpperCase();
    const parts = [];
    for (let i = 0; i < upper.length; i += 2) {
      parts.push(upper.substring(i, i + 2));
    }
    restoredFingerprint = `sha-256 ${parts.join(':')}`;
  }

  const setupVal = type === 'offer' ? 'actpass' : 'active';

  const sdpLines = [
    'v=0',
    `o=- ${Math.floor(Math.random() * 1000000000000000)} 2 IN IP4 127.0.0.1`,
    's=-',
    't=0 0',
    'a=group:BUNDLE 0',
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
    'c=IN IP4 0.0.0.0',
    'a=mid:0',
    'a=sctp-port:5000',
    `a=setup:${setupVal}`,
    `a=ice-ufrag:${u}`,
    `a=ice-pwd:${p}`,
    `a=fingerprint:${restoredFingerprint}`,
  ];

  if (Array.isArray(c)) {
    c.forEach((cand: any, idx) => {
      let ip, port, type;
      if (Array.isArray(cand)) {
        ip = cand[0];
        port = cand[1];
        const t = cand[2];
        type = t === 's' || t === 'srflx' ? 'srflx' : 'host';
      } else {
        return;
      }
      // Rebuild candidate: foundation (idx), component (1), protocol (udp), priority (2130706431), ip, port, typ (type)
      sdpLines.push(`a=candidate:${idx} 1 udp 2113937151 ${ip} ${port} typ ${type}`);
    });
  }

  return sdpLines.join('\r\n') + '\r\n';
}

/**
 * Compresses an RTCSessionDescriptionInit object into an ultra-short alphanumeric string.
 */
export function compressSDP(desc: { type: string; sdp: string }): string {
  try {
    const params = extractSDPParams(desc.sdp);
    // Format: v4_t|u|p|f|ip1,port1,type1;ip2,port2,type2
    const t = desc.type === 'offer' ? 'o' : 'a';
    const cStr = params.candidates.map(cand => `${cand[0]},${cand[1]},${cand[2] === 'srflx' ? 's' : 'h'}`).join(';');
    return `v4_${t}|${params.ufrag}|${params.pwd}|${params.fingerprint}|${cStr}`;
  } catch (err) {
    console.warn('Failed to compress minified SDP, falling back to full SDP compression:', err);
    const payload = JSON.stringify({
      t: desc.type === 'offer' ? 'o' : 'a',
      s: desc.sdp,
    });
    return 'v1_' + LZString.compressToEncodedURIComponent(payload);
  }
}

/**
 * Decompresses an ultra-short compressed string back into an RTCSessionDescriptionInit object.
 */
export function decompressSDP(compressed: string): RTCSessionDescriptionInit | null {
  try {
    if (compressed.startsWith('v4_')) {
      const parts = compressed.substring(3).split('|');
      if (parts.length < 4) return null;
      const t = parts[0];
      const u = parts[1];
      const p = parts[2];
      const f = parts[3];
      const cStr = parts[4] || '';
      
      const c = cStr ? cStr.split(';').map(candStr => {
        const candParts = candStr.split(',');
        return [candParts[0], parseInt(candParts[1], 10), candParts[2]];
      }) : [];

      const reconstructedSdp = reconstructSDP(
        t === 'o' ? 'offer' : 'answer',
        { u, p, f, c }
      );

      return {
        type: t === 'o' ? 'offer' : 'answer',
        sdp: reconstructedSdp,
      };
    } else if (compressed.startsWith('v3_')) {
      const raw = LZString.decompressFromEncodedURIComponent(compressed.substring(3));
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      
      const reconstructedSdp = reconstructSDP(
        parsed.t === 'o' ? 'offer' : 'answer',
        parsed
      );
      
      return {
        type: parsed.t === 'o' ? 'offer' : 'answer',
        sdp: reconstructedSdp,
      };
    } else if (compressed.startsWith('v2_')) {
      const raw = LZString.decompressFromEncodedURIComponent(compressed.substring(3));
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      
      // V2 support
      const sdpLines = [
        'v=0',
        `o=- ${Math.floor(Math.random() * 1000000000000000)} 2 IN IP4 127.0.0.1`,
        's=-',
        't=0 0',
        'a=group:BUNDLE 0',
        'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
        'c=IN IP4 0.0.0.0',
        'a=mid:0',
        'a=sctp-port:5000',
        `a=setup:${parsed.s || (parsed.t === 'o' ? 'actpass' : 'active')}`,
        `a=ice-ufrag:${parsed.u}`,
        `a=ice-pwd:${parsed.p}`,
        `a=fingerprint:sha-256 ${parsed.f}`,
      ];

      if (Array.isArray(parsed.c)) {
        parsed.c.forEach((cand: string) => {
          const fullCand = cand.startsWith('a=') ? cand : `a=${cand}`;
          sdpLines.push(fullCand);
        });
      }

      return {
        type: parsed.t === 'o' ? 'offer' : 'answer',
        sdp: sdpLines.join('\r\n') + '\r\n',
      };
    } else {
      const targetStr = compressed.startsWith('v1_') ? compressed.substring(3) : compressed;
      const raw = LZString.decompressFromEncodedURIComponent(targetStr);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return {
        type: parsed.t === 'o' ? 'offer' : 'answer',
        sdp: parsed.s,
      };
    }
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
