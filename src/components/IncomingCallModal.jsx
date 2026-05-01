import { Phone, PhoneOff, Video } from 'lucide-react';
import { useWebRTC } from '@/context/WebRTCContext';
import Av from './Av';

export default function IncomingCallModal({ onAccept, onDecline }) {
  const { ringingCall } = useWebRTC();

  if (!ringingCall) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center px-6">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-md" />
      
      <div className="relative w-full max-w-sm bg-[#0a0004] border border-[#ff003c]/20 rounded-[32px] p-8 flex flex-col items-center shadow-[0_20px_50px_rgba(0,0,0,0.8)]">
        <div className="absolute -top-12">
          <Av name={ringingCall.fromName} size={96} online={true} borderColor="#ff003c" />
          <div className="absolute inset-0 rounded-full bg-[#ff003c]/20 animate-ping" />
        </div>

        <div className="mt-14 text-center">
          <h2 className="text-2xl font-bold text-white mb-1">{ringingCall.fromName}</h2>
          <p className="text-[#ff003c] text-xs font-black uppercase tracking-[0.2em] animate-pulse">
            Appel Entrant...
          </p>
        </div>

        <div className="flex gap-12 mt-10">
          <button
            onClick={onDecline}
            className="group flex flex-col items-center gap-3"
          >
            <div className="w-16 h-16 rounded-full bg-[#cc0000]/10 border border-[#cc0000]/30 flex items-center justify-center transition-all group-active:scale-90 group-hover:bg-[#cc0000] group-hover:shadow-[0_0_20px_rgba(204,0,0,0.5)]">
              <PhoneOff className="text-[#cc0000] group-hover:text-white" size={28} />
            </div>
            <span className="text-[10px] text-white/40 font-bold uppercase tracking-widest">Refuser</span>
          </button>

          <button
            onClick={onAccept}
            className="group flex flex-col items-center gap-3"
          >
            <div className="w-16 h-16 rounded-full bg-[#22c55e]/10 border border-[#22c55e]/30 flex items-center justify-center transition-all group-active:scale-90 group-hover:bg-[#22c55e] group-hover:shadow-[0_0_20px_rgba(34,197,94,0.5)]">
              {ringingCall.isVideo ? (
                <Video className="text-[#22c55e] group-hover:text-white" size={28} />
              ) : (
                <Phone className="text-[#22c55e] group-hover:text-white" size={28} />
              )}
            </div>
            <span className="text-[10px] text-white/40 font-bold uppercase tracking-widest">Répondre</span>
          </button>
        </div>
      </div>
    </div>
  );
}
