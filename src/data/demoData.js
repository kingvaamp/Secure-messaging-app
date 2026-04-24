// ============================================
// Demo Data — Senegalese Contacts & Conversations
// French interface, +221 phone numbers
// ============================================

// Avatar color palette (8 dark red tones)
const AVATAR_COLORS = [
  '#6b0018', '#4a0010', '#8a0020', '#5c0014',
  '#72001c', '#3d000c', '#9b0028', '#66001a',
];

function getAvatarColor(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function getInitials(name) {
  return name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

export const DEMO_CONTACTS = [
  { id: 'demo-binta', name: 'Binta Diallo', phone: '+221 77 123 4567', online: true },
  { id: 'demo-cheikh', name: 'Cheikh Ndiaye', phone: '+221 78 234 5678', online: true },
  { id: 'demo-fatou', name: 'Fatou Sow', phone: '+221 76 345 6789', online: false },
  { id: 'demo-moussa', name: 'Moussa Ba', phone: '+221 70 456 7890', online: false },
  { id: 'demo-aissatou', name: 'Aïssatou Fall', phone: '+221 77 567 8901', online: true },
  { id: 'demo-ibrahima', name: 'Ibrahima Cissé', phone: '+221 78 678 9012', online: false },
  { id: 'demo-mariama', name: 'Mariama Diop', phone: '+221 76 789 0123', online: true },
  { id: 'demo-ousmane', name: 'Ousmane Sarr', phone: '+221 70 890 1234', online: false },
];

// Enrich contacts with avatar colors and initials
DEMO_CONTACTS.forEach((c) => {
  c.avatarColor = getAvatarColor(c.name);
  c.initials = getInitials(c.name);
});

// Demo call logs
export const DEMO_CALLS = [
  { id: 'call-1', contactId: 'demo-binta', type: 'incoming', duration: '2:34', time: '12:04', date: 'Aujourd\'hui' },
  { id: 'call-2', contactId: 'demo-cheikh', type: 'outgoing', duration: '8:11', time: '18:30', date: 'Hier' },
  { id: 'call-3', contactId: 'demo-fatou', type: 'missed', duration: '', time: '14:15', date: 'Hier' },
  { id: 'call-4', contactId: 'demo-moussa', type: 'outgoing', duration: '1:22', time: '09:45', date: 'Lun' },
  { id: 'call-5', contactId: 'demo-aissatou', type: 'incoming', duration: '5:48', time: '20:00', date: 'Lun' },
];

// Demo conversations with encrypted messages
export const DEMO_CONVERSATIONS = [
  {
    id: 'conv-binta',
    contactId: 'demo-binta',
    messages: [
      { id: 'm1', senderId: 'demo-binta', text: 'Salut ! Tu as reçu le document ?', time: '11:30', isRead: true, ttl: 0 },
      { id: 'm2', senderId: 'me', text: 'Oui, je viens de le regarder. C\'est parfait.', time: '11:32', isRead: true, ttl: 0 },
      { id: 'm3', senderId: 'demo-binta', text: '🔒 Message chiffré', time: '12:00', isRead: false, ttl: 180, locked: true },
    ],
    lastMessage: '🔒 Message chiffré',
    timestamp: '12:00',
    unreadCount: 1,
  },
  {
    id: 'conv-cheikh',
    contactId: 'demo-cheikh',
    messages: [
      { id: 'm4', senderId: 'demo-cheikh', text: 'On se voit demain à 14h ?', time: 'Hier', isRead: true, ttl: 0 },
      { id: 'm5', senderId: 'me', text: 'Ça marche, au café du coin.', time: 'Hier', isRead: true, ttl: 0 },
    ],
    lastMessage: 'Ça marche, au café du coin.',
    timestamp: 'Hier',
    unreadCount: 0,
  },
  {
    id: 'conv-fatou',
    contactId: 'demo-fatou',
    messages: [
      { id: 'm6', senderId: 'demo-fatou', text: '🔒 Message chiffré', time: 'Hier', isRead: false, ttl: 180, locked: true },
    ],
    lastMessage: '🔒 Message chiffré',
    timestamp: 'Hier',
    unreadCount: 1,
  },
];

// Demo current user (Alice)
export const DEMO_CURRENT_USER = {
  id: 'demo-alice',
  name: 'Alice',
  phone: '+221 77 999 0000',
  avatarColor: '#cc0000',
  initials: 'A',
};

// Demo current user (Bob) — for toggle
export const DEMO_CURRENT_USER_BOB = {
  id: 'demo-bob',
  name: 'Bob',
  phone: '+221 78 999 0000',
  avatarColor: '#8b0000',
  initials: 'B',
};

// Security toggles default state
export const DEFAULT_SECURITY_SETTINGS = {
  blockScreenshots: true,
  readReceipts: true,
  faceIdLock: false,
  screenshotAlerts: true,
  notificationSounds: true,
};

// Stats for profile
export const DEMO_STATS = {
  messages: 1247,
  chats: 23,
  calls: 56,
};
