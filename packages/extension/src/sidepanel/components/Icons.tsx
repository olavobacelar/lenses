import {
  CameraIcon as RadixCameraIcon,
  CopyIcon as RadixCopyIcon,
  Cross2Icon,
  FileTextIcon,
  Link2Icon,
  ReloadIcon,
  ResetIcon,
  StopIcon as RadixStopIcon,
  VideoIcon,
} from "@radix-ui/react-icons";

type IconProps = { size?: number };

export function CopyIcon({ size = 18 }: IconProps) {
  return <RadixCopyIcon width={size} height={size} aria-hidden="true" focusable="false" />;
}

export function PaperclipIcon({ size = 18 }: IconProps) {
  return <Link2Icon width={size} height={size} aria-hidden="true" focusable="false" />;
}

export function CaptureIcon({ size = 18 }: IconProps) {
  return <RadixCameraIcon width={size} height={size} aria-hidden="true" focusable="false" />;
}

export function CloseIcon({ size = 18 }: IconProps) {
  return <Cross2Icon width={size} height={size} aria-hidden="true" focusable="false" />;
}

export function RewindIcon({ size = 18 }: IconProps) {
  return (
    <ResetIcon width={size} height={size} aria-hidden="true" focusable="false" />
  );
}

export function RetryIcon({ size = 18 }: IconProps) {
  return <ReloadIcon width={size} height={size} aria-hidden="true" focusable="false" />;
}

export function SlidesIcon({ size = 18 }: IconProps) {
  return <FileTextIcon width={size} height={size} aria-hidden="true" focusable="false" />;
}

export function VideoSlidesIcon({ size = 18 }: IconProps) {
  return <VideoIcon width={size} height={size} aria-hidden="true" focusable="false" />;
}

export function StopIcon({ size = 12 }: IconProps) {
  return <RadixStopIcon width={size} height={size} aria-hidden="true" focusable="false" />;
}

// Shield-check used for the per-claim "Verify" action. Hand-rolled because Radix
// has no shield glyph; stroke="currentColor" so it inherits the button's color.
export function VerifyIcon({ size = 14 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M12 3l7 3v6c0 4-3 6.6-7 8-4-1.4-7-4-7-8V6z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  );
}

// Document with an exclamation mark, for the PDF load-failure state. Hand-rolled
// because Radix has no file-warning glyph; stroke="currentColor" so it inherits
// the surrounding state card's muted color.
export function FileWarningIcon({ size = 24 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </svg>
  );
}
