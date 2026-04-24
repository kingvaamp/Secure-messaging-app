import { MessageSquare, Phone, Users, User } from 'lucide-react';
import { useApp } from '@/context/AppContext';

const TABS = [
  { id: 'chats', label: 'Chats', Icon: MessageSquare },
  { id: 'calls', label: 'Appels', Icon: Phone },
  { id: 'contacts', label: 'Contacts', Icon: Users },
  { id: 'profile', label: 'Profil', Icon: User },
];

export default function TabBar() {
  const { activeTab, setTab, conversations } = useApp();
  const unreadTotal = conversations.reduce((sum, c) => sum + (c.unreadCount || 0), 0);

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 flex items-center justify-around z-50 pb-[env(safe-area-inset-bottom)]"
      style={{
        height: 70,
        background: 'linear-gradient(180deg, rgba(8, 0, 4, 0.85) 0%, rgba(2, 0, 1, 0.98) 100%)',
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
        borderTop: '1px solid rgba(255, 0, 60, 0.15)',
        boxShadow: '0 -8px 32px rgba(0, 0, 0, 0.8), inset 0 1px 0 rgba(255, 255, 255, 0.05)',
        maxWidth: 430,
        margin: '0 auto',
      }}
    >
      {TABS.map((tab) => {
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            onClick={() => setTab(tab.id)}
            className="relative flex-1 h-full flex flex-col items-center justify-center overflow-hidden group outline-none"
          >
            {/* Glowing top line indicator */}
            <div 
              className={`absolute top-0 w-10 h-[3px] rounded-b-md transition-all duration-300 ease-out z-20 ${
                isActive ? 'opacity-100 scale-100 translate-y-0' : 'opacity-0 scale-x-50 -translate-y-1'
              }`}
              style={{
                backgroundColor: '#ff003c',
                boxShadow: '0 2px 14px 2px rgba(255,0,60,0.8)',
              }}
            />

            {/* Background pill when active */}
            <div 
              className={`absolute inset-0 top-2 bottom-2 mx-auto w-14 bg-gradient-to-t from-[#ff003c]/20 to-transparent rounded-2xl pointer-events-none transition-opacity duration-500 ease-out blur-md ${
                isActive ? 'opacity-80' : 'opacity-0'
              }`} 
            />

            <div 
              className={`relative z-10 flex flex-col items-center justify-center gap-1.5 transition-all duration-300 ease-out ${
                isActive ? '-translate-y-0.5' : 'translate-y-1 group-hover:-translate-y-0'
              }`}
            >
              <div className="relative">
                <tab.Icon
                  size={24}
                  color={isActive ? '#ff003c' : 'rgba(255,255,255,0.45)'}
                  fill={isActive ? 'rgba(255,0,60,0.2)' : 'none'}
                  strokeWidth={isActive ? 2.2 : 1.5}
                  className="transition-all duration-300"
                />
                
                {/* Active glow surrounding the icon */}
                <div 
                  className={`absolute inset-0 bg-[#ff003c] rounded-full blur-xl transition-opacity duration-300 ${
                    isActive ? 'opacity-40 scale-150' : 'opacity-0 scale-50'
                  }`}
                />
                
                {/* Notification Badge */}
                {tab.id === 'chats' && unreadTotal > 0 && (
                  <span
                    className="absolute -top-1.5 -right-2.5 flex items-center justify-center rounded-full text-[10px] font-bold text-white z-20 shadow-[0_0_12px_rgba(255,0,60,0.8)]"
                    style={{
                      minWidth: 18,
                      height: 18,
                      padding: '0 5px',
                      backgroundColor: '#ff003c',
                      border: '2px solid rgba(12,0,4,1)',
                    }}
                  >
                    {unreadTotal}
                  </span>
                )}
              </div>
              <span
                className={`text-[10px] font-semibold tracking-wider transition-all duration-300 ${
                  isActive ? 'text-[#ff003c] opacity-100 drop-shadow-[0_0_8px_rgba(255,0,60,0.6)]' : 'text-white/40 opacity-80'
                }`}
              >
                {tab.label}
              </span>
            </div>
          </button>
        );
      })}
    </nav>
  );
}
