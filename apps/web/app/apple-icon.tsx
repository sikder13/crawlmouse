import { ImageResponse } from 'next/og';

// 180×180 brand mark — used as the apple-touch-icon AND as the schema.org Organization/Article logo
// (Google wants a logo larger than the 32×32 favicon).
export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
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
          fontSize: 120,
          fontWeight: 800,
          borderRadius: 40,
          fontFamily: 'sans-serif',
        }}
      >
        C
      </div>
    ),
    { ...size },
  );
}
