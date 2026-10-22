import React from 'react';

interface LogoProps {
  variant?: 'full' | 'icon';
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

export const Logo: React.FC<LogoProps> = ({
  variant = 'full',
  size = 'md',
  className = '',
}) => {
  // Dimensions for the icon
  const iconDimensions = {
    sm: 'w-7 h-7',
    md: 'w-9 h-9',
    lg: 'w-12 h-12',
    xl: 'w-16 h-16',
  }[size];

  // Font sizes for the wordmark
  const textSizes = {
    sm: 'text-lg',
    md: 'text-2xl',
    lg: 'text-3xl',
    xl: 'text-4xl',
  }[size];

  return (
    <div className={`flex items-center gap-2.5 select-none ${className}`}>
      {/* SVG Icon */}
      <svg
        className={`${iconDimensions} shrink-0 drop-shadow-sm transition-transform duration-200 hover:scale-105`}
        viewBox="0 0 160 140"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-label="TextFromClip logo"
      >
        <defs>
          <linearGradient id="tfGradient" x1="10%" y1="10%" x2="90%" y2="90%">
            <stop offset="0%" stopColor="#3B82F6" />
            <stop offset="100%" stopColor="#6D28D9" />
          </linearGradient>
          <filter id="shadow" x="-10%" y="-10%" width="130%" height="130%">
            <feDropShadow dx="0" dy="4" stdDeviation="6" floodColor="#3B82F6" floodOpacity="0.25" />
          </filter>
        </defs>

        {/* Rounded Triangle Play Shield */}
        <path
          d="M 28 22 C 20 16, 12 21, 12 32 L 12 108 C 12 119, 20 124, 28 118 L 88 78 C 96 73, 96 67, 88 62 Z"
          fill="url(#tfGradient)"
          rx="18"
        />

        {/* White Play Triangle */}
        <path
          d="M 36 46 L 66 70 L 36 94 Z"
          fill="#FFFFFF"
        />

        {/* 3 Horizontal Speed/Text Lines */}
        <rect x="88" y="44" width="38" height="9" rx="4.5" fill="url(#tfGradient)" />
        <rect x="78" y="66" width="54" height="9" rx="4.5" fill="url(#tfGradient)" />
        <rect x="88" y="88" width="42" height="9" rx="4.5" fill="url(#tfGradient)" />
      </svg>

      {/* Wordmark */}
      {variant === 'full' && (
        <span className={`font-black tracking-tight leading-none ${textSizes}`}>
          <span className="text-slate-900 dark:text-white transition-colors duration-200">
            TextFrom
          </span>
          <span className="bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
            Clip
          </span>
        </span>
      )}
    </div>
  );
};
