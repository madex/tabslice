import React from 'react';

interface MetronomeIconProps {
  className?: string;
  /** Optional beat polarity to gently swing the pendulum visually while playing */
  tickRight?: boolean;
}

/**
 * Clean geometric classic pyramid metronome icon with pendulum & counterweight.
 */
export const MetronomeIcon: React.FC<MetronomeIconProps> = ({
  className = 'w-4 h-4',
  tickRight = true,
}) => {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {/* Classic trapezoid metronome body */}
      <path d="M5.5 20.5L9.4 4.4A1.5 1.5 0 0 1 10.86 3.25h2.28A1.5 1.5 0 0 1 14.6 4.4l3.9 16.1a1 1 0 0 1-.97 1.25H6.47a1 1 0 0 1-.97-1.25Z" />
      {/* Base divider line */}
      <path d="M7.2 16.5h9.6" />
      {/* Center scale tick */}
      <path d="M12 7v9.5" strokeOpacity={0.4} strokeWidth={1.3} />
      {/* Pendulum arm swinging left or right */}
      {tickRight ? (
        <>
          <path d="M12 16.5L18.5 5.5" strokeWidth={2} />
          <circle cx="16.4" cy="9" r="1.4" fill="currentColor" stroke="none" />
        </>
      ) : (
        <>
          <path d="M12 16.5L5.5 5.5" strokeWidth={2} />
          <circle cx="7.6" cy="9" r="1.4" fill="currentColor" stroke="none" />
        </>
      )}
    </svg>
  );
};
