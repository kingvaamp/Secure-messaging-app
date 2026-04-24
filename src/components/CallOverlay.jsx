import { useState, useEffect } from 'react';
import { Mic, Volume2, Video, PhoneOff } from 'lucide-react';
import { useApp } from '@/context/AppContext';
import Av from './Av';
import RadialDataRings from './RadialDataRings';

export default function CallOverlay() {
  const { activeCall, endCall, addNotification } = useApp();
  const [status, setStatus] = useState('Appel…');
  const [seconds, setSeconds] = useState(0);
  const [muted, setMuted] = useState(false);
  const [speaker, setSpeaker] = useState(false);

  useEffect(() => {
    if (!activeCall) return;
    // Simulate connection after 2s
    const connectTimer = setTimeout(() => {
      setStatus('Connecté · E2E Chiffré');
    }, 2000);

    return () => clearTimeout(connectTimer);
  }, [activeCall]);

  useEffect(() => {
    if (!activeCall || status !== 'Connecté · E2E Chiffré') return;
    const interval = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(interval);
  }, [activeCall, status]);

  if (!activeCall) return null;

  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  const timeStr = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;

  const handleEndCall = () => {
    endCall();
    addNotification({
      type: 'message',
      text: `📞 Appel terminé · Durée: ${timeStr}`,
    });
    setStatus('Appel…');
    setSeconds(0);
  };

  const controls = [
    { icon: Mic, active: muted, onClick: () => setMuted(!muted), label: 'Muet' },
    { icon: Volume2, active: speaker, onClick: () => setSpeaker(!speaker), label: 'HP' },
    { icon: Video, active: false, onClick: () => {}, label: 'Vidéo' },
  ];

  return (
    <div
      className="absolute inset-0 z-[80] flex flex-col items-center justify-center"
      style={{ backgroundColor: 'rgba(5, 0, 0, 0.98)' }}
    >
      {/* Radial rings behind avatar */}
      <RadialDataRings />

      {/* Status */}
      <p className="text-xs tracking-[0.15em] uppercase mb-8 z-10" style={{ color: '#ff003c' }}>
        {status}
      </p>

      {/* Avatar with pulse rings */}
      <div className="relative z-10 mb-6">
        <Av name={activeCall.name} size={92} online={false} />
        {/* Pulsing ring */}
        <div
          className="absolute inset-0 rounded-full"
          style={{
            border: '2px solid rgba(255, 0, 60, 0.5)',
            animation: 'ring-pulse 2s infinite ease-out',
            transform: 'scale(1.2)',
          }}
        />
      </div>

      {/* Name */}
      <h2 className="text-xl font-medium text-white mb-2 z-10">{activeCall.name}</h2>

      {/* Timer */}
      {status === 'Connecté · E2E Chiffré' && (
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
