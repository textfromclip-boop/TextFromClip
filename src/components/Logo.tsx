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
  // Dimensions for the icon preserving original 175:142 aspect ratio
  const iconDimensions = {
    sm: 'h-6 w-auto',
    md: 'h-8 w-auto',
    lg: 'h-11 w-auto',
    xl: 'h-14 w-auto',
  }[size];

  // Font sizes for the wordmark
  const textSizes = {
    sm: 'text-xl',
    md: 'text-2xl sm:text-[1.7rem]',
    lg: 'text-3xl',
    xl: 'text-4xl sm:text-5xl',
  }[size];

  return (
    <div className={`flex items-center gap-2.5 select-none ${className}`}>
      {/* SVG Icon matching authentic original design (Picture 2) */}
      <svg
        className={`${iconDimensions} shrink-0`}
        viewBox="0 0 175 142"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-label="TextFromClip logo"
      >
        <defs>
          <linearGradient id="tfClipGrad" x1="5%" y1="5%" x2="95%" y2="95%">
            <stop offset="0%" stopColor="#0F8CFA" />
            <stop offset="45%" stopColor="#2868F7" />
            <stop offset="100%" stopColor="#5131ED" />
          </linearGradient>
        </defs>

        {/* Unified Rounded Play Shield with integrated horizontal speed bars */}
        <path
          d="
            M 42 10
            C 75 10 102 24 120 48
            L 158 48
            C 162.5 48 166 51.5 166 55
            C 166 58.5 162.5 62 158 62
            L 118 62
            C 113.5 62 110.5 65.5 110.5 66.5
            C 110.5 67.5 113.5 71 118 71
            L 149 71
            C 153.5 71 157 74.5 157 78
            C 157 81.5 153.5 85 149 85
            L 110 85
            C 105.5 85 102.5 87.5 102.5 88.5
            C 102.5 89.5 105.5 92 110 92
            L 141 92
            C 145.5 92 149 95.5 149 98.5
            C 149 101.5 145.5 105 141 105
            L 96 105
            C 80 119 62 133 42 133
            C 18 133 8 116 8 98
            L 8 45
            C 8 27 18 10 42 10
            Z
          "
          fill="url(#tfClipGrad)"
        />

        {/* Centered White Play Triangle */}
        <path
          d="
            M 54 50
            C 52 48.5 50 49.5 50 52
            L 50 91
            C 50 93.5 52 94.5 54 93
            L 88 73.5
            C 90 72.3 90 70.7 88 69.5
            Z
          "
          fill="#FFFFFF"
        />
      </svg>

      {/* Wordmark replicating exact typography from Picture 2 */}
      {variant === 'full' && (
        <span className={`font-black tracking-tight leading-none ${textSizes}`}>
          <span className="text-[#021331]">
            TextFrom
          </span>
          <span className="text-[#5131ED]">
            Clip
          </span>
        </span>
      )}
    </div>
  );
};

