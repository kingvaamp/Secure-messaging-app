import { useRef } from 'react';
import {
  Smartphone, Key, Info, LogOut, Trash2,
  Shield, Eye, Fingerprint, Bell, Volume2,
  ChevronRight, Edit3
} from 'lucide-react';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/context/AuthContext';
import Av from '@/components/Av';
import Tog from '@/components/Tog';

const SECURITY_ITEMS = [
  { key: 'blockScreenshots', label: 'Bloquer les captures', desc: 'Empêcher les captures dans les chats', icon: Shield },
  { key: 'readReceipts', label: 'Accusés de lecture', desc: 'Alerter quand le message est ouvert', icon: Eye },
  { key: 'faceIdLock', label: 'Verrou Face ID', desc: 'Requis à l\'ouverture', icon: Fingerprint },
  { key: 'screenshotAlerts', label: 'Alertes captures', desc: 'Notifier quand un contact capture', icon: Bell },
  { key: 'notificationSounds', label: 'Sons de notification', desc: 'Son pour nouveaux messages', icon: Volume2 },
];

const ACCOUNT_ITEMS = [
  { label: 'Numéro de téléphone', icon: Smartphone, value: '+221 77 999 0000' },
  { label: 'Clé de chiffrement', icon: Key, value: 'Vérifié ✓' },
  { label: 'À propos de VanishText', icon: Info, value: 'v2.0' },
];

export default function ProfileScreen() {
  const { currentUser, securitySettings, updateSecurity, stats, updateCurrentUser, addNotification } = useApp();
  const { signOut } = useAuth();
  const fileInputRef = useRef(null);

  const handleLogout = () => {
    signOut();
  };

  const handleAvatarClick = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      addNotification({ type: 'error', text: 'Veuillez sélectionner une image' });
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      addNotification({ type: 'error', text: 'Image trop lourde (max 5 Mo)' });
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      updateCurrentUser({ avatar: event.target.result });
      addNotification({ type: 'success', text: 'Photo de profil mise à jour' });
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  return (
    <div className="h-full flex flex-col overflow-y-auto" style={{ scrollbarWidth: 'none' }}>
      {/* Header with avatar */}
      <div className="flex flex-col items-center pt-8 pb-6 px-4">
        <div className="relative cursor-pointer transition-transform active:scale-95" onClick={handleAvatarClick}>
          <Av name={currentUser.name} src={currentUser.avatar} size={80} online={false} />
          <button
            className="absolute bottom-0 right-0 flex items-center justify-center rounded-full"
            style={{
              width: 28,
              height: 28,
              backgroundColor: '#ff003c',
              border: '2px solid #050000',
            }}
          >
            <Edit3 size={12} className="text-white" />
          </button>
          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleFileChange} 
            accept="image/*" 
            className="hidden" 
          />
        </div>

        <h2 className="text-xl font-medium text-white mt-4">{currentUser.name}</h2>
        <p className="text-[13px] mt-1" style={{ color: 'rgba(255,255,255,0.4)' }}>
          {currentUser.phone}
        </p>
        <p className="text-[11px] italic mt-1" style={{ color: 'rgba(255,255,255,0.25)' }}>
          🔒 Privacy first.
        </p>
      </div>

      {/* Stats */}
      <div
        className="flex items-center justify-around mx-4 py-4 rounded-xl mb-6"
        style={{ backgroundColor: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,0,60,0.06)' }}
      >
        <div className="flex flex-col items-center">
          <span className="text-xl font-semibold" style={{ color: '#ff003c' }}>{stats.messages}</span>
          <span className="text-[10px] uppercase tracking-wider mt-1" style={{ color: 'white' }}>Messages</span>
        </div>
        <div
          className="w-px h-8"
          style={{ backgroundColor: 'rgba(255,255,255,0.06)' }}
        />
        <div className="flex flex-col items-center">
          <span className="text-xl font-semibold" style={{ color: '#ff003c' }}>{stats.chats}</span>
          <span className="text-[10px] uppercase tracking-wider mt-1" style={{ color: 'white' }}>Chats</span>
        </div>
        <div
          className="w-px h-8"
          style={{ backgroundColor: 'rgba(255,255,255,0.06)' }}
        />
        <div className="flex flex-col items-center">
          <span className="text-xl font-semibold" style={{ color: '#ff003c' }}>{stats.calls}</span>
          <span className="text-[10px] uppercase tracking-wider mt-1" style={{ color: 'white' }}>Appels</span>
        </div>
      </div>

      {/* Security Section */}
      <div className="px-4 mb-6">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider mb-3 px-1" style={{ color: 'rgba(255,255,255,0.3)' }}>
          Sécurité
        </h3>
        <div
          className="rounded-xl overflow-hidden"
          style={{ backgroundColor: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,0,60,0.05)' }}
        >
          {SECURITY_ITEMS.map((item, i) => (
            <div
              key={item.key}
              className="flex items-center gap-3 px-4 py-3.5"
              style={{
                borderBottom: i < SECURITY_ITEMS.length - 1 ? '1px solid rgba(255,0,60,0.04)' : 'none',
              }}
            >
              <item.icon size={18} style={{ color: 'rgba(255,255,255,0.4)' }} />
              <div className="flex-1 min-w-0">
                <p className="text-[14px] text-white/90">{item.label}</p>
                <p className="text-[11px]" style={{ color: 'rgba(255,255,255,0.3)' }}>{item.desc}</p>
              </div>
              <Tog
                checked={securitySettings[item.key]}
                onChange={(v) => updateSecurity({ [item.key]: v })}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Account Section */}
      <div className="px-4 mb-6">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider mb-3 px-1" style={{ color: 'rgba(255,255,255,0.3)' }}>
          Compte
        </h3>
        <div
          className="rounded-xl overflow-hidden"
          style={{ backgroundColor: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,0,60,0.05)' }}
        >
          {ACCOUNT_ITEMS.map((item, i) => (
            <div
              key={item.label}
              className="flex items-center gap-3 px-4 py-3.5"
              style={{
                borderBottom: i < ACCOUNT_ITEMS.length - 1 ? '1px solid rgba(255,0,60,0.04)' : 'none',
              }}
            >
              <item.icon size={18} style={{ color: 'rgba(255,255,255,0.4)' }} />
              <div className="flex-1 min-w-0">
                <p className="text-[14px] text-white/90">{item.label}</p>
              </div>
              <span className="text-[13px] mr-1" style={{ color: 'rgba(255,255,255,0.35)' }}>
                {item.value}
              </span>
              <ChevronRight size={14} style={{ color: 'rgba(255,255,255,0.2)' }} />
            </div>
          ))}
        </div>
      </div>

      {/* Danger Zone */}
      <div className="px-4 mb-6">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider mb-3 px-1" style={{ color: 'rgba(255,255,255,0.3)' }}>
          Danger
        </h3>
        <div
          className="rounded-xl overflow-hidden"
          style={{ backgroundColor: 'rgba(255,0,60,0.02)', border: '1px solid rgba(255,0,60,0.08)' }}
        >
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-4 py-3.5 text-left"
            style={{ borderBottom: '1px solid rgba(255,0,60,0.04)' }}
          >
            <LogOut size={18} style={{ color: '#ff003c' }} />
            <span className="text-[14px]" style={{ color: '#ff003c' }}>Se déconnecter</span>
          </button>
          <button className="w-full flex items-center gap-3 px-4 py-3.5 text-left">
            <Trash2 size={18} style={{ color: '#ff003c' }} />
            <span className="text-[14px]" style={{ color: '#ff003c' }}>Supprimer le compte</span>
          </button>
        </div>
      </div>

      {/* Footer */}
      <div className="text-center pb-8 pt-2">
        <p className="text-[9px]" style={{ color: 'rgba(255,255,255,0.15)' }}>
          VanishText v2.0 · Signal Protocol X3DH + Double Ratchet · AES-256-GCM
        </p>
      </div>
    </div>
  );
}
