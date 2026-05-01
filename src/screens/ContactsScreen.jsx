import { useState, useEffect } from 'react';
import {
  Search, MessageCircle, Phone, Video, ChevronLeft,
  UserPlus, Check, Shield, ShieldCheck, Ban
} from 'lucide-react';
import { useApp } from '@/context/AppContext';
import { useWebRTC } from '@/context/WebRTCContext';
import { supabase } from '@/lib/supabase';
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
      <div className="flex items-center px-4 pt-12 pb-5" style={{ borderBottom: '1px solid rgba(255,0,60,0.08)' }}>
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
// ============================================
// Add Contact Modal (Premium Redesign)
// ============================================
function AddContactModal({ onClose, onSave }) {
  const [pseudoSearch, setPseudoSearch] = useState('');
  const [foundProfile, setFoundProfile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSearch = async () => {
    const clean = pseudoSearch.toLowerCase().replace(/[^a-z0-9_]/g, '');
    if (!clean || clean.length < 3) {
      setError('Entrez un pseudo d\'au moins 3 caractères');
      return;
    }
    
    setLoading(true);
    setError('');
    setFoundProfile(null);
    
    try {
      const { data, error: sbError } = await supabase
        .from('profiles')
        .select('id, name, pseudo, phone')
        .eq('pseudo', clean)
        .maybeSingle();
      
      if (!sbError && data) {
        setFoundProfile(data);
        setLoading(false);
        return;
      }
    } catch (err) {
      console.error('Search error:', err);
      setError('Erreur de recherche. Veuillez réessayer.');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = () => {
    if (!foundProfile) return;
    onSave({ 
      id: foundProfile.id,
      name: foundProfile.name, 
      phone: foundProfile.pseudo, 
    });
    onClose();
  };

  return (
    <div className="absolute inset-0 z-[60] flex flex-col animate-in fade-in zoom-in-95 duration-200">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-3xl" />
      
      <div 
        className="relative flex items-center px-4 py-3 z-10" 
        style={{ borderBottom: '1px solid rgba(255,0,60,0.15)', backgroundColor: 'rgba(10, 0, 5, 0.6)' }}
      >
        <button onClick={onClose} className="p-2 -ml-2 text-white/60 hover:text-white transition-colors active:scale-90">
          <ChevronLeft size={24} />
        </button>
        <h2 className="flex-1 text-center text-[17px] font-semibold text-white pr-8">Ajouter un contact</h2>
      </div>

      <div className="relative flex-1 px-4 pt-8 space-y-6 z-10">
        <div className="animate-in slide-in-from-bottom-4 duration-500">
          <label className="text-[10px] uppercase font-bold tracking-[0.15em] mb-3 ml-1 block" style={{ color: 'rgba(255,255,255,0.4)' }}>
            Pseudo de l'utilisateur
          </label>
          <div className="flex gap-3">
            <div className="relative flex-1 group">
              <span className="absolute left-4 top-3.5 text-[#ff003c] font-bold opacity-50 group-focus-within:opacity-100 transition-opacity">@</span>
              <input
                value={pseudoSearch}
                onChange={(e) => setPseudoSearch(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                placeholder="pseudo"
                className="w-full bg-white/5 rounded-2xl pl-9 pr-4 py-3.5 text-[15px] text-white placeholder:text-white/20 outline-none transition-all focus:bg-white/[0.08]"
                style={{ border: '1px solid rgba(255,0,60,0.1)' }}
              />
            </div>
            <button
              onClick={handleSearch}
              disabled={loading || pseudoSearch.length < 3}
              className="px-5 py-3 rounded-2xl text-[13px] font-bold uppercase tracking-wider text-white transition-all disabled:opacity-30 flex items-center justify-center min-w-[110px] gap-2 active:scale-95"
              style={{ 
                backgroundColor: 'rgba(255,0,60,0.15)', 
                border: '1px solid rgba(255,0,60,0.3)', 
                color: '#ff003c',
              }}
            >
              {loading ? <div className="w-4 h-4 border-2 border-[#ff003c]/30 border-t-[#ff003c] rounded-full animate-spin" /> : <Search size={16} />}
              <span>Chercher</span>
            </button>
          </div>
          {error && <p className="text-[13px] font-medium mt-3 text-center" style={{ color: '#ff003c' }}>{error}</p>}
        </div>

        {foundProfile && (
          <div 
            className="mt-4 p-6 rounded-[28px] flex flex-col items-center animate-in zoom-in-95 duration-500" 
            style={{ 
              backgroundColor: 'rgba(255,255,255,0.03)', 
              border: '1px solid rgba(255,255,255,0.08)',
              backdropFilter: 'blur(20px)'
            }}
          >
            <Av name={foundProfile.name} size={84} />
            <h3 className="text-xl font-bold text-white tracking-tight mt-4">{foundProfile.name}</h3>
            <p className="text-[14px] font-medium mt-1" style={{ color: '#ff003c' }}>@{foundProfile.pseudo}</p>
            
            <button
              onClick={handleSave}
              className="w-full mt-8 py-3.5 rounded-2xl text-[14px] font-bold uppercase tracking-widest text-white transition-all active:scale-95"
              style={{ backgroundColor: '#ff003c', boxShadow: '0 8px 32px rgba(255, 0, 60, 0.4)' }}
            >
              Ajouter aux contacts
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================
// Main Contacts Screen
// ============================================
export default function ContactsScreen() {
  const { 
    contacts, 
    conversations, 
    contactsFilter, 
    setContactsFilter, 
    addContact, 
    setActiveChat, 
    setTab,
    createConversation 
  } = useApp();
  const { initiateCall } = useWebRTC();
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
    const existing = conversations.find((c) => c.contactId === contact.id);
    if (existing) {
      setActiveChat(existing.id);
    } else {
      const newId = createConversation(contact.id);
      setActiveChat(newId);
    }
    setTab('chats');
  };

  const handleCall = (contact) => {
    setSelectedContact(null);
    initiateCall(contact.id);
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
