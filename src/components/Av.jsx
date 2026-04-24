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
  if (!name) return '?';
  return name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
}

export default function Av({ name, src, size = 36, online = false, borderColor }) {
  const color = getAvatarColor(name);
  const initials = getInitials(name);
  const fontSize = size * 0.42;

  return (
    <div className="relative inline-flex-shrink-0">
      {src ? (
        <img
          src={src}
          alt={name}
          className="rounded-full object-cover"
          style={{
            width: size,
            height: size,
            border: borderColor ? `2px solid ${borderColor}` : 'none',
          }}
        />
      ) : (
        <div
          className="flex items-center justify-center rounded-full"
          style={{
            width: size,
            height: size,
            backgroundColor: color,
            fontSize: `${fontSize}px`,
            fontWeight: 500,
            color: '#fff',
            border: borderColor ? `2px solid ${borderColor}` : 'none',
          }}
        >
          {initials}
        </div>
      )}
      {online && (
        <span
          className="absolute rounded-full border-2 border-[#050000]"
          style={{
            width: size * 0.28,
            height: size * 0.28,
            backgroundColor: '#22c55e',
            bottom: 0,
            right: 0,
          }}
        />
      )}
    </div>
  );
}
