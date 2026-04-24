import React, { createContext, useContext, useReducer, useCallback } from 'react';
import { DEFAULT_SECURITY_SETTINGS } from '@/data/demoData';
import { useDemoData } from '@/data/useDemoData';

const AppContext = createContext(null);

// ============================================
// Actions
// ============================================
export const ACTIONS = {
  SET_TAB: 'SET_TAB',
  SET_ACTIVE_CHAT: 'SET_ACTIVE_CHAT',
  CLOSE_CHAT: 'CLOSE_CHAT',
  SEND_MESSAGE: 'SEND_MESSAGE',
  DECRYPT_MESSAGE: 'DECRYPT_MESSAGE',
  DELETE_MESSAGE: 'DELETE_MESSAGE',
  START_CALL: 'START_CALL',
  END_CALL: 'END_CALL',
  ADD_NOTIFICATION: 'ADD_NOTIFICATION',
  DISMISS_NOTIFICATION: 'DISMISS_NOTIFICATION',
  TOGGLE_USER: 'TOGGLE_USER',
  UPDATE_SECURITY: 'UPDATE_SECURITY',
  ADD_CONTACT: 'ADD_CONTACT',
  SET_CONTACTS_FILTER: 'SET_CONTACTS_FILTER',
};

// ============================================
// Reducer
// ============================================
function appReducer(state, action) {
  switch (action.type) {
    case ACTIONS.SET_TAB:
      return { ...state, activeTab: action.payload, activeChatId: null };

    case ACTIONS.SET_ACTIVE_CHAT:
      return { ...state, activeChatId: action.payload };

    case ACTIONS.CLOSE_CHAT:
      return { ...state, activeChatId: null };

    case ACTIONS.SEND_MESSAGE: {
      const { convId, message } = action.payload;
      const conversations = state.conversations.map((c) => {
        if (c.id !== convId) return c;
        return {
          ...c,
          messages: [...c.messages, message],
          lastMessage: message.locked ? '🔒 Message chiffré' : message.text,
          timestamp: message.time,
        };
      });
      return { ...state, conversations };
    }

    case ACTIONS.DECRYPT_MESSAGE: {
      const { convId, msgId, text } = action.payload;
      const conversations = state.conversations.map((c) => {
        if (c.id !== convId) return c;
        return {
          ...c,
          messages: c.messages.map((m) =>
            m.id === msgId ? { ...m, locked: false, text, isRead: true, ttl: 180, expiresAt: Date.now() + 180000 } : m
          ),
        };
      });
      return { ...state, conversations };
    }

    case ACTIONS.DELETE_MESSAGE: {
      const { convId, msgId } = action.payload;
      const conversations = state.conversations.map((c) => {
        if (c.id !== convId) return c;
        return {
          ...c,
          messages: c.messages.filter((m) => m.id !== msgId),
        };
      });
      return { ...state, conversations };
    }

    case ACTIONS.START_CALL:
      return { ...state, activeCall: action.payload };

    case ACTIONS.END_CALL:
      return { ...state, activeCall: null };

    case ACTIONS.ADD_NOTIFICATION:
      return {
        ...state,
        // Cryptographically random ID — not predictable like Date.now()
        notifications: [...state.notifications, {
          id: Array.from(crypto.getRandomValues(new Uint8Array(8)), b => b.toString(16).padStart(2, '0')).join(''),
          ...action.payload,
        }],
      };

    case ACTIONS.DISMISS_NOTIFICATION:
      return {
        ...state,
        notifications: state.notifications.filter((n) => n.id !== action.payload),
      };

    case ACTIONS.TOGGLE_USER:
      // demoUserBob is null in production (no demo data) — fall back to current user
      return {
        ...state,
        currentUser: state._demoUserBob
          ? (state.currentUser.id === 'demo-alice' ? state._demoUserBob : state._demoUser)
          : state.currentUser,
      };

    case ACTIONS.UPDATE_SECURITY:
      return {
        ...state,
        securitySettings: { ...state.securitySettings, ...action.payload },
      };

    case ACTIONS.ADD_CONTACT:
      return {
        ...state,
        contacts: [...state.contacts, action.payload],
      };

    case ACTIONS.SET_CONTACTS_FILTER:
      return { ...state, contactsFilter: action.payload };

    case 'TICK_TTL': {
      let changed = false;
      const now = Date.now();
      const conversations = state.conversations.map((c) => {
        let convChanged = false;
        const messages = c.messages.filter((m) => {
          if (m.expiresAt && now >= m.expiresAt) {
            convChanged = true;
            changed = true;
            return false;
          }
          return true;
        });

        if (convChanged) {
          const lastMsg = messages[messages.length - 1];
          return {
            ...c,
            messages,
            lastMessage: lastMsg ? (lastMsg.locked ? '🔒 Message chiffré' : lastMsg.text) : 'Conversation vide',
          };
        }
        return c;
      });

      return changed ? { ...state, conversations } : state;
    }

    default:
      return state;
  }
}

// ============================================
// Initial State — built at runtime via useDemoData() gate
// ============================================
function buildInitialState(demoData) {
  return {
    activeTab: 'chats',
    activeChatId: null,
    activeCall: null,
    notifications: [],
    contacts:         demoData.contacts,
    conversations:    demoData.conversations,
    calls:            demoData.calls,
    currentUser:      demoData.currentUser,
    _demoUser:        demoData.currentUser,      // kept for TOGGLE_USER
    _demoUserBob:     demoData.currentUserBob,   // kept for TOGGLE_USER
    securitySettings: demoData.securitySettings,
    stats:            demoData.stats,
    contactsFilter: '',
  };
}

// ============================================
// Provider
// ============================================
export function AppProvider({ children }) {
  const demoData = useDemoData();
  const [state, dispatch] = useReducer(appReducer, undefined, () => buildInitialState(demoData));

  React.useEffect(() => {
    const interval = setInterval(() => {
      dispatch({ type: 'TICK_TTL' });
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const setTab = useCallback((tab) => dispatch({ type: ACTIONS.SET_TAB, payload: tab }), []);
  const setActiveChat = useCallback((id) => dispatch({ type: ACTIONS.SET_ACTIVE_CHAT, payload: id }), []);
  const closeChat = useCallback(() => dispatch({ type: ACTIONS.CLOSE_CHAT }), []);
  const sendMessage = useCallback((convId, message) => dispatch({ type: ACTIONS.SEND_MESSAGE, payload: { convId, message } }), []);
  const decryptMessage = useCallback((convId, msgId, text) => dispatch({ type: ACTIONS.DECRYPT_MESSAGE, payload: { convId, msgId, text } }), []);
  const deleteMessage = useCallback((convId, msgId) => dispatch({ type: ACTIONS.DELETE_MESSAGE, payload: { convId, msgId } }), []);
  const startCall = useCallback((call) => dispatch({ type: ACTIONS.START_CALL, payload: call }), []);
  const endCall = useCallback(() => dispatch({ type: ACTIONS.END_CALL }), []);
  const addNotification = useCallback((notif) => dispatch({ type: ACTIONS.ADD_NOTIFICATION, payload: notif }), []);
  const dismissNotification = useCallback((id) => dispatch({ type: ACTIONS.DISMISS_NOTIFICATION, payload: id }), []);
  const toggleUser = useCallback(() => dispatch({ type: ACTIONS.TOGGLE_USER }), []);
  const updateSecurity = useCallback((settings) => dispatch({ type: ACTIONS.UPDATE_SECURITY, payload: settings }), []);
  const addContact = useCallback((contact) => dispatch({ type: ACTIONS.ADD_CONTACT, payload: contact }), []);
  const setContactsFilter = useCallback((filter) => dispatch({ type: ACTIONS.SET_CONTACTS_FILTER, payload: filter }), []);

  const value = {
    ...state,
    setTab,
    setActiveChat,
    closeChat,
    sendMessage,
    decryptMessage,
    deleteMessage,
    startCall,
    endCall,
    addNotification,
    dismissNotification,
    toggleUser,
    updateSecurity,
    addContact,
    setContactsFilter,
  };

  return (
    <AppContext.Provider value={value}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be inside AppProvider');
  return ctx;
}
