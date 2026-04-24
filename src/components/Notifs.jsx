import { useEffect } from 'react';
import { X } from 'lucide-react';
import { useApp } from '@/context/AppContext';

export default function Notifs() {
  const { notifications, dismissNotification } = useApp();

  return (
    <div className="fixed top-4 right-4 z-[99] flex flex-col gap-2" style={{ maxWidth: 320 }}>
      {notifications.map((n) => (
        <NotificationItem key={n.id} notification={n} onDismiss={() => dismissNotification(n.id)} />
      ))}
    </div>
  );
}

function NotificationItem({ notification, onDismiss }) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, 4000);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  const bgColors = {
    message: '#1a0005',
    screenshot: '#331500',
    system: '#111',
    error: '#200000',
  };

  const borderColors = {
    message: '#ff003c',
    screenshot: '#f59e0b',
    system: '#444',
    error: '#ff0000',
  };

  return (
    <div
      className="flex items-start gap-2 px-3 py-2.5 rounded-lg shadow-lg animate-in slide-in-from-top-2"
      style={{
        backgroundColor: bgColors[notification.type] || bgColors.system,
        borderLeft: `3px solid ${borderColors[notification.type] || borderColors.system}`,
      }}
    >
      <p className="text-xs text-white/90 flex-1 leading-relaxed">{notification.text}</p>
      <button onClick={onDismiss} className="text-white/40 hover:text-white/80 transition-colors">
        <X size={14} />
      </button>
    </div>
  );
}
