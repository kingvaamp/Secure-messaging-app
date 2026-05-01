import { AuthProvider, useAuth } from '@/context/AuthContext';
import { AppProvider, useApp } from '@/context/AppContext';
import { WebRTCProvider, useWebRTC } from '@/context/WebRTCContext';
import { DemoBanner } from '@/components/DemoBanner';
import PlasmaBackground from '@/components/PlasmaBackground';
import TabBar from '@/components/TabBar';
import Notifs from '@/components/Notifs';
import CallOverlay from '@/components/CallOverlay';
import SecurityGuard from '@/components/SecurityGuard';
import LoginScreen from '@/screens/LoginScreen';
import ProfileSetupScreen from '@/screens/ProfileSetupScreen';
import ChatsScreen from '@/screens/ChatsScreen';
import CallsScreen from '@/screens/CallsScreen';
import ContactsScreen from '@/screens/ContactsScreen';
import ProfileScreen from '@/screens/ProfileScreen';
import IncomingCallModal from '@/components/IncomingCallModal';
import { supabase } from '@/lib/supabase';
import './App.css';

function AppContent() {
  const { user, loading: authLoading } = useAuth();
  const { currentUser, loadingProfile } = useApp();

  if (authLoading || (user && loadingProfile)) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-black">
        <PlasmaBackground opacity={1} />
        <div className="relative z-10 flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-[#ff003c] border-t-transparent rounded-full animate-spin" />
          <div className="text-white/40 text-[10px] font-black uppercase tracking-[0.3em] animate-pulse">Vanish Securing...</div>
        </div>
      </div>
    );
  }

  // 1. Google Auth Gate
  if (!user) {
    return (
      <>
        <PlasmaBackground opacity={1} />
        <LoginScreen />
      </>
    );
  }

  // 2. Profile Setup Gate
  const isProfileComplete = currentUser?.pseudo && currentUser?.pseudo.length >= 3;
  const forceSetup = localStorage.getItem('vanish_force_setup') === 'true';

  if (!isProfileComplete || forceSetup) {
    return (
      <>
        <PlasmaBackground opacity={1} />
        <ProfileSetupScreen />
      </>
    );
  }

  // 3. Chatbox (Authenticated App)
  return <AuthenticatedApp />;
}

function AuthenticatedApp() {
  return <AuthenticatedAppContent />;
}

function AuthenticatedAppContent() {
  const { activeTab } = useApp();
  const { activeCall, ringingCall, acceptCall, endCall } = useWebRTC();

  return (
    <SecurityGuard>
      <DemoBanner />
      <PlasmaBackground opacity={1} />

      {/* Main content */}
      <main className="relative w-full h-full overflow-hidden">
        {activeTab === 'chats' && <ChatsScreen />}
        {activeTab === 'calls' && <CallsScreen />}
        {activeTab === 'contacts' && <ContactsScreen />}
        {activeTab === 'profile' && <ProfileScreen />}
      </main>

      {/* Tab bar */}
      {!activeCall && <TabBar />}

      {/* Call overlay */}
      <CallOverlay />

      {/* Incoming Call Gate */}
      {ringingCall && (
        <IncomingCallModal 
          onAccept={acceptCall} 
          onDecline={() => {
            supabase.channel(`vanish:signaling:${ringingCall.from}`).send({
              type: 'broadcast',
              event: 'call-rejected',
              payload: {}
            });
          }} 
        />
      )}

      {/* Notifications */}
      <Notifs />
    </SecurityGuard>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppProvider>
        <WebRTCProvider>
          <div className="w-full h-full bg-[#050000]">
            <AppContent />
          </div>
        </WebRTCProvider>
      </AppProvider>
    </AuthProvider>
  );
}