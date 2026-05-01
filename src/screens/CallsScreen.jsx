import { Phone, PhoneIncoming, PhoneOutgoing, PhoneMissed, Plus, ChevronLeft, Search, PhoneCall } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '@/context/AppContext';
import { useWebRTC } from '@/context/WebRTCContext';
import Av from '@/components/Av';

const CALL_ICONS = {
  incoming: { Icon: PhoneIncoming, color: '#22c55e' },
  outgoing: { Icon: PhoneOutgoing, color: '#3b82f6' },
  missed: { Icon: PhoneMissed, color: '#ff003c' },
};

// ============================================
// New Call Modal (Premium Redesign)
// ============================================
function NewCallModal({ onClose, onStartCall }) {
  const { contacts } = useApp();
  const [search, setSearch] = useState('');

  const filtered = contacts.filter(c => 
    c.name.toLowerCase().includes(search.toLowerCase()) || 
    c.phone.includes(search)
  );

  return (
    <div className="absolute inset-0 z-[60] flex flex-col animate-in fade-in zoom-in-95 duration-200">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-3xl" />
      
      {/* Header */}
      <div 
        className="relative flex items-center justify-between px-4 py-3 z-10" 
        style={{ borderBottom: '1px solid rgba(255,0,60,0.15)', backgroundColor: 'rgba(10, 0, 5, 0.6)' }}
      >
        <button onClick={onClose} className="p-2 -ml-2 text-white/60 hover:text-white transition-colors active:scale-90">
          <ChevronLeft size={24} />
        </button>
        <h2 className="text-[17px] font-semibold tracking-tight text-white">Nouvel appel</h2>
        <div className="w-10" />
      </div>

      {/* Search Bar */}
      <div className="relative px-4 py-4 z-10">
        <div 
          className="flex items-center gap-3 px-4 py-2.5 rounded-2xl transition-all"
          style={{ 
            backgroundColor: 'rgba(255,255,255,0.04)', 
            border: '1px solid rgba(255,0,60,0.1)',
          }}
        >
          <Search size={18} className="text-white/30" />
          <input 
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher un contact..."
            className="flex-1 bg-transparent text-[15px] text-white placeholder:text-white/20 outline-none"
          />
        </div>
      </div>

      {/* Contact list */}
      <div className="relative flex-1 overflow-y-auto px-4 pb-10 z-10" style={{ scrollbarWidth: 'none' }}>
        <div 
          className="rounded-[24px] overflow-hidden" 
          style={{ 
            backgroundColor: 'rgba(255, 255, 255, 0.02)', 
            border: '1px solid rgba(255, 0, 60, 0.08)',
            backdropFilter: 'blur(20px)'
          }}
        >
          {filtered.map((contact, index) => (
            <div
              key={contact.id}
              className="w-full flex items-center gap-4 px-5 py-4 text-left transition-all hover:bg-white/[0.04] group"
              style={{ borderBottom: index < filtered.length - 1 ? '1px solid rgba(255,0,60,0.05)' : 'none' }}
            >
              <Av name={contact.name} size={42} online={contact.online} />
              <div className="flex-1 min-w-0">
                <p className="text-[16px] text-white/90 font-medium">{contact.name}</p>
                <p className="text-[12px] opacity-40">{contact.phone}</p>
              </div>
              <button 
                onClick={() => onStartCall(contact)}
                className="p-3 rounded-full bg-[#ff003c]/10 text-[#ff003c] transition-all hover:bg-[#ff003c] hover:text-white active:scale-90 shadow-[0_0_15px_rgba(255,0,60,0.2)]"
              >
                <PhoneCall size={18} />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function CallsScreen() {
  const { calls, contacts } = useApp();
  const { initiateCall } = useWebRTC();
  const [showNewCall, setShowNewCall] = useState(false);

  const handleCall = (contact) => {
    setShowNewCall(false);
    // Start WebRTC call
    initiateCall(contact.id, contact.name, false);
  };

  if (showNewCall) {
    return <NewCallModal onClose={() => setShowNewCall(false)} onStartCall={handleCall} />;
  }

  const dateGroups = [...new Set(calls.map(c => c.date))];

  return (
    <div className="h-full flex flex-col bg-black/40">
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 flex-shrink-0 z-20"
        style={{
          backgroundColor: 'rgba(8, 0, 4, 0.75)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          borderBottom: '1px solid rgba(255, 0, 60, 0.1)',
        }}
      >
        <h1 className="text-[20px] font-semibold text-white tracking-wide">Appels</h1>
        <button
          onClick={() => setShowNewCall(true)}
          className="flex items-center justify-center rounded-full transition-all duration-300 hover:scale-105 active:scale-95"
          style={{ width: 36, height: 36, backgroundColor: 'rgba(255, 0, 60, 0.15)', boxShadow: '0 0 12px rgba(255,0,60,0.3)' }}
        >
          <Plus size={18} style={{ color: '#ff003c' }} />
        </button>
      </div>

      {/* Call list */}
      <div className="flex-1 overflow-y-auto px-4 pb-28 pt-4" style={{ scrollbarWidth: 'none' }}>
        {calls.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full opacity-30 text-center px-10">
            <div className="p-6 rounded-full bg-[#ff003c]/5 border border-[#ff003c]/10 mb-6">
              <Phone size={42} className="text-[#ff003c]" />
            </div>
            <h2 className="text-[18px] font-bold text-white mb-2 tracking-tight">Aucun appel récent</h2>
            <p className="text-[13px] text-white/60 leading-relaxed">
              Vos communications vocales et vidéo sécurisées apparaîtront ici.
            </p>
          </div>
        ) : (
          dateGroups.map((date) => {
            const groupCalls = calls.filter((c) => c.date === date);

            return (
              <div key={date} className="mb-6">
                {/* Stylish letter/date header */}
                <div
                  className="text-[13px] font-bold uppercase tracking-[0.1em] mb-2.5 ml-2"
                  style={{
                    color: '#ff003c',
                    textShadow: '0 0 10px rgba(255,0,60,0.4)',
                  }}
                >
                  {date}
                </div>

                {/* Glassmorphic Call Card Group */}
                <div 
                  className="rounded-[20px] overflow-hidden backdrop-blur-2xl" 
                  style={{ 
                    backgroundColor: 'rgba(10, 0, 5, 0.55)', 
                    border: '1px solid rgba(255, 0, 60, 0.1)',
                    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)'
                  }}
                >
                  {groupCalls.map((call, index) => {
                    const contact = contacts.find((c) => c.id === call.contactId);
                    if (!contact) return null;

                    const { Icon, color } = CALL_ICONS[call.type];
                    const isMissed = call.type === 'missed';

                    return (
                      <div
                        key={call.id}
                        className="flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-white/5 group"
                        style={{ 
                          borderBottom: index < groupCalls.length - 1 ? '1px solid rgba(255, 0, 60, 0.05)' : 'none' 
                        }}
                      >
                        <Av 
                          name={contact.name} 
                          size={44} 
                          online={false} 
                          borderColor={isMissed ? 'rgba(255,0,60,0.3)' : 'rgba(255,0,60,0.15)'} 
                        />

                        <div className="flex-1 min-w-0 flex flex-col justify-center">
                          <h3 className={`text-[16px] font-medium truncate ${isMissed ? 'text-[#ff003c] drop-shadow-[0_0_8px_rgba(255,0,60,0.4)]' : 'text-white/95'}`}>
                            {contact.name}
                          </h3>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <Icon size={14} style={{ color }} />
                            <span className="text-[13px] tracking-wide capitalize" style={{ color: 'rgba(255,255,255,0.45)' }}>
                              {call.type === 'incoming' ? 'Entrant' : call.type === 'outgoing' ? 'Sortant' : 'Manqué'}
                              {call.duration && ` · ${call.duration}`}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-3.5 flex-shrink-0">
                          <span className="text-[12px] font-medium" style={{ color: 'rgba(255,255,255,0.3)' }}>
                            {call.time}
                          </span>
                          <button
                            onClick={() => handleCall(contact)}
                            className="flex items-center justify-center rounded-full transition-all duration-300 hover:bg-[rgba(255,0,60,0.25)] active:scale-95 opacity-80 group-hover:opacity-100"
                            style={{ width: 38, height: 38, backgroundColor: 'rgba(255, 0, 60, 0.12)' }}
                          >
                            <Phone size={18} style={{ color: '#ff003c' }} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
