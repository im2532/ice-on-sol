// Source: https://www.figma.com/design/Pc8p5kBLcXx4wwc7iWQXHC/GENIUS-DESIGN-SYSTEM-V.1?node-id=8007-10646
// Extracted: 2026-04-09
// Tokens: color-bg-primary, color-bg-secondary, color-bg-attention, color-content-primary,
//         color-content-secondary, color-content-warning-text, color-content-success,
//         color-border-subtle, color-border-strong, color-border-attention,
//         color-button-primary, color-button-secondary, color-content-on-primary,
//         color-badge-bg-gray, color-badge-label-gray, shadow-elevation-1, shadow-inset-bottom

export interface AvatarData {
  src: string;
  alt: string;
}

export interface ContactData {
  id: string;
  name: string;
  role: string;
  avatarSrc: string;
}

export interface ParticipantData {
  id: string;
  name: string;
  role: string;
  avatarSrc: string;
  isSelf?: boolean;
  isMuted?: boolean;
}

export interface CallMetadata {
  duration: string;
  contacts: string;
  voicemail: number;
  textSent: number;
}

export type CallStatus = 'on-hold' | 'in-progress';

export interface DialerCardProps {
  /** Primary caller/contact name */
  callerName: string;
  /** Formatted call duration (e.g. "02:11") */
  callDuration: string;
  /** Current call status */
  callStatus: CallStatus;
  /** Display text for status (e.g. "On hold", "Call in progress") */
  statusLabel: string;
  /** Avatar(s) to display — single for on-hold, multiple for in-progress */
  avatars: AvatarData[];
  /** Contact list for on-hold/add-user view */
  contacts?: ContactData[];
  /** Participants for in-progress view */
  participants?: ParticipantData[];
  /** Call metadata for in-progress view */
  metadata?: CallMetadata;
  /** Callback when mute button is clicked */
  onMuteToggle?: () => void;
  /** Callback when pause button is clicked */
  onPause?: () => void;
  /** Callback when end call button is clicked */
  onEndCall?: () => void;
  /** Callback when add user button is clicked */
  onAddUser?: () => void;
  /** Callback when transfer button is clicked */
  onTransfer?: () => void;
  /** Callback when a contact's "Add to call" is clicked */
  onAddContact?: (contactId: string) => void;
  /** Callback when a participant's mute is toggled */
  onParticipantMuteToggle?: (participantId: string) => void;
  /** Callback when a participant is dropped */
  onDropParticipant?: (participantId: string) => void;
  /** Additional CSS class */
  className?: string;
}
