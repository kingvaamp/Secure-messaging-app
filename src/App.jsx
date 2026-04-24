import { AuthProvider, useAuth } from '@/context/AuthContext';
import { AppProvider, useApp } from '@/context/AppContext';
import { DemoBanner } from '@/components/DemoBanner';
import PlasmaBackground from '@/components/PlasmaBackground';
import TabBar from '@/components/TabBar';
import Notifs from '@/components/Notifs';
import CallOverlay from '@/components/CallOverlay';
import SecurityGuard from '@/components/SecurityGuard';
import LoginScreen from '@/screens/LoginScreen';
import ChatsScreen from '@/screens/ChatsScreen';
import CallsScreen from '@/screens/CallsScreen';
import ContactsScreen from '@/screens/ContactsScreen';
import ProfileScreen from '@/screens/ProfileScreen';
import './App.css';

function AppContent() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <div className="text-[#ff003c] text-sm animate-pulse">Chargement…</div>
      </div>
    );
  }

  if (!user) {
    return (
      <>
        <PlasmaBackground opacity={1} />
        <LoginScreen />
      </>
    );
  }

  return <AuthenticatedApp />;
}

function AuthenticatedApp() {
  const { activeTab, activeCall } = useApp();

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

      {/* Notifications */}
      <Notifs />
    </SecurityGuard>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppProvider>
        <div
          className="relative w-full h-[100dvh] overflow-hidden mx-auto"
          style={{
            maxWidth: 430,
            backgroundColor: '#050000',
          }}
        >
          <AppContent />
        </div>
      </AppProvider>
    </AuthProvider>
  );
}
