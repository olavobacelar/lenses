import type { VideoTime } from "../../types/transcript";

interface SeekButtonProps {
  stamp: VideoTime;
  className: string;
  onSeek: (seconds: number) => void;
}

export function SeekButton({ stamp, className, onSeek }: SeekButtonProps) {
  return (
    <button
      type="button"
      className={className}
      title={`Jump to ${stamp.formatted}`}
      aria-label={`Jump to ${stamp.formatted}`}
      onClick={() => onSeek(stamp.seconds)}
    >
      {stamp.formatted}
    </button>
  );
}
