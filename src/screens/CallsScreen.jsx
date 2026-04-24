import { Phone, PhoneIncoming, PhoneOutgoing, PhoneMissed, Plus } from 'lucide-react';
import { useApp } from '@/context/AppContext';
import Av from '@/components/Av';

const CALL_ICONS = {
  incoming: { Icon: PhoneIncoming, color: '#22c55e' },
  outgoing: { Icon: PhoneOutgoing, color: '#3b82f6' },
  missed: { Icon: PhoneMissed, color: '#ff003c' },
};

export default function CallsScreen() {
  const { calls, contacts, startCall } = useApp();

  const handleCall = (contact) => {
    startCall({
      name: contact.name,
      contactId: contact.id,
    });
  };

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
          className="flex items-center justify-center rounded-full transition-all duration-300 hover:scale-105 active:scale-95"
          style={{ width: 36, height: 36, backgroundColor: 'rgba(255, 0, 60, 0.15)', boxShadow: '0 0 12px rgba(255,0,60,0.3)' }}
        >
          <Plus size={18} style={{ color: '#ff003c' }} />
        </button>
      </div>

      {/* Call list */}
      <div className="flex-1 overflow-y-auto px-4 pb-28 pt-4" style={{ scrollbarWidth: 'none' }}>
        {dateGroups.map((date) => {
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
        })}
      </div>
    </div>
  );
}
