import { useState, useEffect, useRef } from 'react';
import { Mic, Volume2, Video, PhoneOff } from 'lucide-react';
import { useApp } from '@/context/AppContext';
import { useWebRTC } from '@/context/WebRTCContext';
import Av from './Av';
import RadialDataRings from './RadialDataRings';
import { supabase } from '@/lib/supabase';

export default function CallOverlay() {
  const { addNotification } = useApp();
  const { activeCall, localStream, remoteStream, cleanup } = useWebRTC();
  const [seconds, setSeconds] = useState(0);

  const [muted, setMuted] = useState(false);
  const [speaker, setSpeaker] = useState(false);
  const [isVideo, setIsVideo] = useState(false);

  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);

  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  useEffect(() => {
    if (!activeCall || activeCall.status !== 'active') return;
    const interval = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(interval);
  }, [activeCall]);

  if (!activeCall) return null;

  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  const timeStr = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;

  const handleEndCall = () => {
    // Notify target that we ended the call
    supabase.channel(`vanish:signaling:${activeCall.id}`).send({
      type: 'broadcast',
      event: 'call-ended',
      payload: {}
    });
    
    cleanup();
    addNotification({
      type: 'message',
      text: `📞 Appel terminé · Durée: ${timeStr}`,
    });
    setSeconds(0);
  };

  const toggleMute = () => {
    if (localStream) {
      localStream.getAudioTracks().forEach(track => {
        track.enabled = muted;
      });
      setMuted(!muted);
    }
  };

  const toggleVideo = () => {
    if (localStream) {
      localStream.getVideoTracks().forEach(track => {
        track.enabled = isVideo;
      });
      setIsVideo(!isVideo);
    }
  };

  const controls = [
    { icon: Mic, active: muted, onClick: toggleMute, label: 'Muet' },
    { icon: Volume2, active: speaker, onClick: () => setSpeaker(!speaker), label: 'HP' },
    { icon: Video, active: isVideo, onClick: toggleVideo, label: 'Vidéo' },
  ];

  const statusStr = activeCall.status === 'ringing' ? 'Appel en cours…' : 'Connecté · E2E Chiffré';

  return (
    <div
      className="absolute inset-0 z-[80] flex flex-col items-center justify-center overflow-hidden"
      style={{ backgroundColor: 'rgba(5, 0, 0, 0.98)' }}
    >
      {/* Remote Video Background */}
      {remoteStream && remoteStream.getVideoTracks().length > 0 && (
        <video
          ref={remoteVideoRef}
          autoPlay
          playsInline
          className="absolute inset-0 w-full h-full object-cover opacity-60"
        />
      )}

      {/* Radial rings behind avatar */}
      {!remoteStream && <RadialDataRings />}

      {/* Status */}
      <p className="text-xs tracking-[0.15em] uppercase mb-8 z-10" style={{ color: '#ff003c' }}>
        {statusStr}
      </p>

      {/* Avatar or Local Video */}
      <div className="relative z-10 mb-6">
        {localStream && localStream.getVideoTracks().length > 0 ? (
          <div className="relative w-32 h-44 rounded-2xl overflow-hidden border-2 border-[#ff003c]/30 shadow-2xl">
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover scale-x-[-1]"
            />
          </div>
        ) : (
          <div className="relative">
            <Av name={activeCall.name} size={92} online={false} />
            <div
              className="absolute inset-0 rounded-full"
              style={{
                border: '2px solid rgba(255, 0, 60, 0.5)',
                animation: 'ring-pulse 2s infinite ease-out',
                transform: 'scale(1.2)',
              }}
            />
          </div>
        )}
      </div>

      {/* Name */}
      <h2 className="text-xl font-medium text-white mb-2 z-10">{activeCall.name}</h2>

      {/* Timer */}
      {activeCall.status === 'active' && (
        <p className="text-2xl font-mono text-white/80 mb-10 z-10">{timeStr}</p>
      )}

      {/* Controls */}
      <div className="grid grid-cols-4 gap-6 z-10 mt-4">
        {controls.map((ctrl) => (
          <button
            key={ctrl.label}
            onClick={ctrl.onClick}
            className="flex flex-col items-center gap-1.5"
          >
            <div
              className="flex items-center justify-center rounded-full transition-colors"
              style={{
                width: 56,
                height: 56,
                backgroundColor: ctrl.active ? '#ff003c' : 'rgba(255,255,255,0.08)',
              }}
            >
              <ctrl.icon size={22} className="text-white" />
            </div>
            <span className="text-[10px] text-white/50">{ctrl.label}</span>
          </button>
        ))}

        {/* End call */}
        <button onClick={handleEndCall} className="flex flex-col items-center gap-1.5">
          <div
            className="flex items-center justify-center rounded-full"
            style={{
              width: 56,
              height: 56,
              backgroundColor: '#cc0000',
              boxShadow: '0 0 20px rgba(204, 0, 0, 0.4)',
            }}
          >
            <PhoneOff size={22} className="text-white" />
          </div>
          <span className="text-[10px] text-white/50">Raccrocher</span>
        </button>
      </div>
    </div>
  );
}
