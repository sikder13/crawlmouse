import { ImageResponse } from 'next/og';

// Favicon, generated so it stays on-brand without a binary asset. Next auto-links it.
export const size = { width: 32, height: 32 };
export const contentType = 'image/png';

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#ff7849',
          color: '#fdfaf5',
          fontSize: 22,
          fontWeight: 800,
          borderRadius: 7,
          fontFamily: 'sans-serif',
        }}
      >
        C
      </div>
    ),
    { ...size },
  );
}
