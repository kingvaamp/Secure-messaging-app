import { useState, useEffect } from 'react';
import {
  Search, MessageCircle, Phone, Video, ChevronLeft,
  UserPlus, Check, Shield, ShieldCheck, Ban
} from 'lucide-react';
import { useApp } from '@/context/AppContext';
import Av from '@/components/Av';
import { computeSafetyNumber } from '@/crypto/safetyNumber';
import { getMyPublicB64, getContactPublicB64 } from '@/crypto/sessionManager';

// ============================================
// Contact Detail Sheet
// ============================================
function ContactSheet({ contact, onClose, onMessage, onCall }) {
  const [safetyNumber, setSafetyNumber] = useState('');
  const [verified, setVerified] = useState(false);

  // Compute safety number from REAL ECDH public keys
  // Phase 3: uses actual key material instead of hardcoded strings
  useEffect(() => {
    async function computeSN() {
      try {
        const myKey = await getMyPublicB64();            // real P-256 public key
        const theirKey = await getContactPublicB64(contact.id); // real P-256 public key
        const sn = await computeSafetyNumber(myKey, theirKey);
        setSafetyNumber(sn);
      } catch {
        setSafetyNumber('—'); // graceful failure
      }
    }
    computeSN();
  }, [contact.id]);

  return (
    <div className="absolute inset-0 z-[60] flex flex-col" style={{ backgroundColor: '#050000' }}>
      {/* Header */}
      <div className="flex items-center px-4 py-3" style={{ borderBottom: '1px solid rgba(255,0,60,0.08)' }}>
        <button onClick={onClose} className="text-white/60 hover:text-white transition-colors">
          <ChevronLeft size={24} />
        </button>
        <h2 className="flex-1 text-center text-[15px] font-medium text-white pr-8">Contact</h2>
      </div>

      {/* Profile */}
      <div className="flex flex-col items-center py-8 px-4">
        <Av name={contact.name} size={76} online={contact.online} />
        <h3 className="text-xl font-medium text-white mt-4">{contact.name}</h3>
        <p className="text-[13px] mt-1" style={{ color: 'rgba(255,255,255,0.45)' }}>
          {contact.phone}
        </p>

        {/* Action buttons */}
        <div className="flex items-center gap-6 mt-6">
          <button
            onClick={onMessage}
            className="flex flex-col items-center gap-1.5"
          >
            <div
              className="flex items-center justify-center rounded-xl"
              style={{ width: 52, height: 52, backgroundColor: '#ff003c' }}
            >
              <MessageCircle size={22} className="text-white" />
            </div>
            <span className="text-[10px] text-white/50">Message</span>
          </button>

          <button onClick={onCall} className="flex flex-col items-center gap-1.5">
            <div
              className="flex items-center justify-center rounded-xl"
              style={{ width: 52, height: 52, backgroundColor: '#22c55e' }}
            >
              <Phone size={22} className="text-white" />
            </div>
            <span className="text-[10px] text-white/50">Appel</span>
          </button>

          <button className="flex flex-col items-center gap-1.5">
            <div
              className="flex items-center justify-center rounded-xl"
              style={{ width: 52, height: 52, backgroundColor: '#3b82f6' }}
            >
              <Video size={22} className="text-white" />
            </div>
            <span className="text-[10px] text-white/50">Vidéo</span>
          </button>
        </div>
      </div>

      {/* Safety Number */}
      <div className="mx-4 p-4 rounded-xl" style={{ backgroundColor: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,0,60,0.06)' }}>
        <div className="flex items-center gap-2 mb-3">
          {verified ? <ShieldCheck size={14} style={{ color: '#22c55e' }} /> : <Shield size={14} style={{ color: '#ff003c' }} />}
          <span className="text-[11px] font-medium uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.5)' }}>
            Safety Number
          </span>
          {verified && <span className="text-[10px] ml-auto" style={{ color: '#22c55e' }}>Vérifié</span>}
        </div>
        <p className="text-[13px] font-mono tracking-wider text-center leading-loose" style={{ color: '#ff003c', opacity: 0.8 }}>
          {safetyNumber || 'Chargement…'}
        </p>

        <button
          onClick={() => setVerified(!verified)}
          className="w-full mt-3 py-2 rounded-lg text-[12px] font-medium transition-colors"
          style={{
            backgroundColor: verified ? 'rgba(34, 197, 94, 0.1)' : 'rgba(255, 0, 60, 0.08)',
            color: verified ? '#22c55e' : '#ff003c',
            border: `1px solid ${verified ? 'rgba(34, 197, 94, 0.2)' : 'rgba(255, 0, 60, 0.15)'}`,
          }}
        >
          {verified ? (
            <span className="flex items-center justify-center gap-1.5">
              <Check size={12} /> Marqué comme vérifié
            </span>
          ) : (
            'Marquer comme vérifié'
          )}
        </button>
      </div>

      {/* Block */}
      <div className="mt-auto px-4 pb-8">
        <button
          className="w-full flex items-center justify-center gap-2 py-3 rounded-lg text-[13px] font-medium transition-colors"
          style={{ backgroundColor: 'rgba(255, 0, 60, 0.08)', color: '#ff003c' }}
        >
          <Ban size={14} />
          Bloquer le contact
        </button>
      </div>
    </div>
  );
}

// ============================================
// Add Contact Modal
// ============================================
function AddContactModal({ onClose, onSave }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');

  const handleSave = () => {
    if (!name.trim() || !phone.trim()) return;
    onSave({ name: name.trim(), phone: phone.trim() });
    onClose();
  };

  return (
    <div className="absolute inset-0 z-[60] flex flex-col" style={{ backgroundColor: '#050000' }}>
      <div className="flex items-center px-4 py-3" style={{ borderBottom: '1px solid rgba(255,0,60,0.08)' }}>
        <button onClick={onClose} className="text-white/60 hover:text-white transition-colors">
          <ChevronLeft size={24} />
        </button>
        <h2 className="flex-1 text-center text-[15px] font-medium text-white pr-8">Nouveau contact</h2>
      </div>

      <div className="flex-1 px-4 pt-6 space-y-5">
        <div>
          <label className="text-[11px] uppercase tracking-wider mb-2 block" style={{ color: 'rgba(255,255,255,0.4)' }}>
            Nom
          </label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Prénom Nom"
            className="w-full bg-white/5 rounded-xl px-4 py-3 text-[15px] text-white placeholder:text-white/20 outline-none"
          />
        </div>

        <div>
          <label className="text-[11px] uppercase tracking-wider mb-2 block" style={{ color: 'rgba(255,255,255,0.4)' }}>
            Téléphone
          </label>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+221 77 000 0000"
            type="tel"
            className="w-full bg-white/5 rounded-xl px-4 py-3 text-[15px] text-white placeholder:text-white/20 outline-none"
          />
        </div>

        <button
          onClick={handleSave}
          disabled={!name.trim() || !phone.trim()}
          className="w-full py-3 rounded-xl text-sm font-medium text-white transition-all disabled:opacity-30"
          style={{ backgroundColor: '#ff003c' }}
        >
          Enregistrer le contact
        </button>
      </div>
    </div>
  );
}

// ============================================
// Main Contacts Screen
// ============================================
export default function ContactsScreen() {
  const { contacts, contactsFilter, setContactsFilter, addContact, setActiveChat, setTab, startCall } = useApp();
  const [selectedContact, setSelectedContact] = useState(null);
  const [showAddContact, setShowAddContact] = useState(false);

  // Filter contacts
  const filtered = contacts.filter(
    (c) =>
      c.name.toLowerCase().includes(contactsFilter.toLowerCase()) ||
      c.phone.includes(contactsFilter)
  );

  // Group by first letter
  const grouped = filtered.reduce((acc, c) => {
    const letter = c.name[0].toUpperCase();
    if (!acc[letter]) acc[letter] = [];
    acc[letter].push(c);
    return acc;
  }, {});

  const sortedLetters = Object.keys(grouped).sort();

  const handleMessage = (contact) => {
    setSelectedContact(null);
    setTab('chats');
    // Find or create conversation would go here
  };

  const handleCall = (contact) => {
    setSelectedContact(null);
    startCall({ name: contact.name, contactId: contact.id });
  };

  if (selectedContact) {
    return (
      <ContactSheet
        contact={selectedContact}
        onClose={() => setSelectedContact(null)}
        onMessage={() => handleMessage(selectedContact)}
        onCall={() => handleCall(selectedContact)}
      />
    );
  }

  if (showAddContact) {
    return (
      <AddContactModal
        onClose={() => setShowAddContact(false)}
        onSave={(data) => {
          const newContact = {
            id: `contact-${Date.now()}`,
            ...data,
            online: false,
            avatarColor: '#6b0018',
            initials: data.name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase(),
          };
          addContact(newContact);
        }}
      />
    );
  }

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
        <h1 className="text-[20px] font-semibold text-white tracking-wide">Contacts</h1>
        <button
          onClick={() => setShowAddContact(true)}
          className="flex items-center justify-center rounded-full transition-all duration-300 hover:scale-105 active:scale-95"
          style={{ width: 36, height: 36, backgroundColor: 'rgba(255, 0, 60, 0.15)', boxShadow: '0 0 12px rgba(255,0,60,0.3)' }}
        >
          <UserPlus size={18} style={{ color: '#ff003c' }} />
        </button>
      </div>

      {/* Search */}
      <div className="px-4 py-3 flex-shrink-0 z-20" style={{ background: 'linear-gradient(to bottom, rgba(8,0,4,0.75) 0%, transparent 100%)' }}>
        <div 
          className="flex items-center gap-2 px-4 py-2.5 rounded-2xl backdrop-blur-xl transition-all"
          style={{ 
            backgroundColor: 'rgba(255,255,255,0.06)', 
            border: '1px solid rgba(255, 0, 60, 0.08)',
            boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.2)'
          }}
        >
          <Search size={18} style={{ color: 'rgba(255,255,255,0.4)' }} />
          <input
            value={contactsFilter}
            onChange={(e) => setContactsFilter(e.target.value)}
            placeholder="Rechercher des contacts…"
            className="flex-1 bg-transparent text-[15px] font-medium text-white placeholder:text-white/30 outline-none"
          />
        </div>
      </div>

      {/* Contact list */}
      <div className="flex-1 overflow-y-auto px-4 pb-28 pt-2" style={{ scrollbarWidth: 'none' }}>
        {sortedLetters.map((letter) => (
          <div key={letter} className="mb-6">
            {/* Stylish letter header */}
            <div
              className="text-[13px] font-bold uppercase tracking-[0.1em] mb-2.5 ml-2"
              style={{
                color: '#ff003c',
                textShadow: '0 0 10px rgba(255,0,60,0.4)',
              }}
            >
              {letter}
            </div>

            {/* Glassmorphic Contact Card Group */}
            <div 
              className="rounded-[20px] overflow-hidden backdrop-blur-2xl" 
              style={{ 
                backgroundColor: 'rgba(10, 0, 5, 0.55)', 
                border: '1px solid rgba(255, 0, 60, 0.1)',
                boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)'
              }}
            >
              {grouped[letter].map((contact, index) => (
                <div
                  key={contact.id}
                  className="flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-white/5 group"
                  style={{ 
                    borderBottom: index < grouped[letter].length - 1 ? '1px solid rgba(255, 0, 60, 0.05)' : 'none' 
                  }}
                >
                  <button
                    onClick={() => setSelectedContact(contact)}
                    className="flex items-center gap-3.5 flex-1 min-w-0 text-left outline-none"
                  >
                    <Av name={contact.name} size={44} online={contact.online} borderColor="rgba(255,0,60,0.15)" />
                    <div className="flex-1 min-w-0">
                      <p className="text-[16px] font-medium text-white/95 truncate">{contact.name}</p>
                      <p className="text-[13px] tracking-wide" style={{ color: 'rgba(255,255,255,0.45)' }}>
                        {contact.phone}
                      </p>
                    </div>
                  </button>

                  <div className="flex items-center gap-1.5 flex-shrink-0 opacity-80 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => handleMessage(contact)}
                      className="p-2.5 rounded-full transition-all duration-300 hover:bg-[rgba(255,0,60,0.15)] active:scale-95"
                    >
                      <MessageCircle size={20} style={{ color: '#ff003c' }} />
                    </button>
                    <button
                      onClick={() => handleCall(contact)}
                      className="p-2.5 rounded-full transition-all duration-300 hover:bg-[rgba(34,197,94,0.15)] active:scale-95"
                    >
                      <Phone size={20} style={{ color: '#22c55e' }} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="text-center py-10">
            <UserPlus size={48} className="mx-auto mb-4 opacity-20" color="#ff003c" />
            <p className="text-white/40 text-[14px]">Aucun contact trouvé.</p>
          </div>
        )}
      </div>
    </div>
  );
}
