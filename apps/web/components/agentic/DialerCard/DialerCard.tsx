// Source: https://www.figma.com/design/Pc8p5kBLcXx4wwc7iWQXHC/GENIUS-DESIGN-SYSTEM-V.1?node-id=8007-10646
// Extracted: 2026-04-09
// Tokens: color-bg-primary, color-bg-secondary, color-bg-attention, color-content-primary,
//         color-content-secondary, color-content-warning-text, color-content-success,
//         color-border-subtle, color-border-strong, color-border-attention,
//         color-button-primary, color-button-secondary, color-content-on-primary,
//         color-badge-bg-gray, color-badge-label-gray, shadow-elevation-1, shadow-inset-bottom

'use client';

import { useState } from 'react';
import { Icon } from '../Icon/Icon';
import styles from './DialerCard.module.css';
import type {
  DialerCardProps,
  AvatarData,
  ContactData,
  ParticipantData,
  CallMetadata,
} from './DialerCard.types';

export function DialerCard({
  callerName,
  callDuration,
  callStatus,
  statusLabel,
  avatars,
  contacts,
  participants,
  metadata,
  onMuteToggle,
  onPause,
  onEndCall,
  onAddUser,
  onTransfer,
  onAddContact,
  onParticipantMuteToggle,
  onDropParticipant,
  className,
}: DialerCardProps) {
  const [searchQuery, setSearchQuery] = useState('');

  const filteredContacts = contacts?.filter(
    (c) =>
      c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.role.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  return (
    <div className={`${styles.card} ${className ?? ''}`}>
      {/* Header — Avatar(s), Timer, Caller Info */}
      <div className={styles.header}>
        <div className={styles.headerInfo}>
          {/* Avatar area */}
          {avatars.length === 1 ? (
            <SingleAvatar avatar={avatars[0]} />
          ) : (
            <AvatarGroup avatars={avatars} />
          )}

          {/* Timer */}
          <div className={styles.timer}>{callDuration}</div>

          {/* Caller name + status */}
          <div className={styles.callerInfo}>
            <div className={styles.callerName}>{callerName}</div>
            <div
              className={`${styles.callStatus} ${
                callStatus === 'on-hold' ? styles.statusOnHold : styles.statusInProgress
              }`}
            >
              {statusLabel}
            </div>
          </div>
        </div>

        {/* Action bar */}
        <ActionBar
          callStatus={callStatus}
          onMuteToggle={onMuteToggle}
          onPause={onPause}
          onEndCall={onEndCall}
          onAddUser={onAddUser}
          onTransfer={onTransfer}
        />
      </div>

      {/* Divider */}
      <hr className={styles.divider} />

      {/* On-hold view: search + contacts */}
      {callStatus === 'on-hold' && contacts && (
        <div className={styles.searchContainer}>
          <SearchInput value={searchQuery} onChange={setSearchQuery} />
          <ContactList
            contacts={filteredContacts ?? []}
            onAddContact={onAddContact}
          />
        </div>
      )}

      {/* In-progress view: participants + metadata */}
      {callStatus === 'in-progress' && (
        <>
          <ParticipantsSection
            participants={participants ?? []}
            onMuteToggle={onParticipantMuteToggle}
            onDrop={onDropParticipant}
          />

          {metadata && (
            <>
              <hr className={styles.divider} />
              <MetadataSection metadata={metadata} />
            </>
          )}
        </>
      )}
    </div>
  );
}

/* --------------------------------------------------------------------------
   Sub-components
   -------------------------------------------------------------------------- */

function SingleAvatar({ avatar }: { avatar: AvatarData }) {
  return (
    <div className={styles.avatarSingle}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={avatar.src} alt={avatar.alt} />
    </div>
  );
}

function AvatarGroup({ avatars }: { avatars: AvatarData[] }) {
  return (
    <div className={styles.avatarGroup}>
      {avatars.map((avatar, i) => (
        <div key={i} className={styles.avatarGroupItem}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={avatar.src} alt={avatar.alt} />
        </div>
      ))}
    </div>
  );
}

function ActionBar({
  callStatus,
  onMuteToggle,
  onPause,
  onEndCall,
  onAddUser,
  onTransfer,
}: {
  callStatus: string;
  onMuteToggle?: () => void;
  onPause?: () => void;
  onEndCall?: () => void;
  onAddUser?: () => void;
  onTransfer?: () => void;
}) {
  return (
    <div className={styles.actionBar}>
      <button
        type="button"
        className={styles.actionButtonSecondary}
        onClick={onMuteToggle}
        aria-label="Toggle mute"
      >
        <Icon name="microphone-off" size={20} />
      </button>

      <button
        type="button"
        className={styles.actionButtonSecondary}
        onClick={onPause}
        aria-label="Pause call"
      >
        <Icon name="pause" size={20} />
      </button>

      <button
        type="button"
        className={styles.actionButtonDestructive}
        onClick={onEndCall}
        aria-label="End call"
      >
        <Icon name="phone-hang-up" size={16} />
      </button>

      <button
        type="button"
        className={
          callStatus === 'on-hold'
            ? styles.actionButtonPrimary
            : styles.actionButtonSecondary
        }
        onClick={onAddUser}
        aria-label="Add user to call"
      >
        <Icon name="user-plus" size={20} />
      </button>

      <button
        type="button"
        className={styles.actionButtonSecondary}
        onClick={onTransfer}
        aria-label="Transfer call"
      >
        <Icon name="transfer" size={20} />
      </button>
    </div>
  );
}

function SearchInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className={styles.searchInputWrapper}>
      <span className={styles.searchIcon}>
        <Icon name="search" size={14} />
      </span>
      <input
        type="text"
        className={styles.searchInput}
        placeholder="Search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Search contacts"
      />
      <div className={styles.searchShortcut}>
        <span className={styles.searchShortcutText}>&#x2318;S</span>
      </div>
    </div>
  );
}

function ContactList({
  contacts,
  onAddContact,
}: {
  contacts: ContactData[];
  onAddContact?: (id: string) => void;
}) {
  return (
    <div className={styles.userList}>
      {contacts.map((contact) => (
        <div key={contact.id} className={styles.userRow}>
          <div className={styles.userCard}>
            <div className={styles.userAvatar}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={contact.avatarSrc} alt={contact.name} />
            </div>
            <div className={styles.userInfo}>
              <div className={styles.userName}>{contact.name}</div>
              <div className={styles.userRole}>{contact.role}</div>
            </div>
          </div>
          <button
            type="button"
            className={styles.addToCallButton}
            onClick={() => onAddContact?.(contact.id)}
          >
            Add to call
          </button>
        </div>
      ))}
    </div>
  );
}

function ParticipantsSection({
  participants,
  onMuteToggle,
  onDrop,
}: {
  participants: ParticipantData[];
  onMuteToggle?: (id: string) => void;
  onDrop?: (id: string) => void;
}) {
  return (
    <div className={styles.participantsSection}>
      <div className={styles.participantsLabel}>Call Participants</div>
      <div className={styles.userList}>
        {participants.map((participant) => (
          <div key={participant.id} className={styles.userRow}>
            <div className={styles.userCard}>
              <div className={styles.userAvatar}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={participant.avatarSrc} alt={participant.name} />
                {participant.isMuted && (
                  <span className={styles.userAvatarMutedBadge}>
                    <Icon name="microphone-off" size={8} />
                  </span>
                )}
              </div>
              <div className={styles.userInfo}>
                <div className={styles.userName}>
                  {participant.isSelf ? 'You' : participant.name}
                </div>
                <div className={styles.userRole}>{participant.role}</div>
              </div>
            </div>
            <div className={styles.participantActions}>
              {participant.isSelf && participant.isMuted ? (
                <button
                  type="button"
                  className={styles.unmuteButton}
                  onClick={() => onMuteToggle?.(participant.id)}
                >
                  Unmute
                </button>
              ) : (
                <button
                  type="button"
                  className={styles.muteButton}
                  onClick={() => onMuteToggle?.(participant.id)}
                >
                  Mute
                </button>
              )}
              <button
                type="button"
                className={styles.dropButton}
                onClick={() => onDrop?.(participant.id)}
              >
                Drop
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MetadataSection({ metadata }: { metadata: CallMetadata }) {
  const rows = [
    { label: 'Duration:', value: metadata.duration },
    { label: 'Contacts:', value: metadata.contacts },
    { label: 'Voicemail:', value: String(metadata.voicemail) },
    { label: 'Text sent', value: String(metadata.textSent) },
  ];

  return (
    <div className={styles.metadataSection}>
      {rows.map((row) => (
        <div key={row.label} className={styles.metadataRow}>
          <span className={styles.metadataLabel}>{row.label}</span>
          <span className={styles.metadataBadge}>{row.value}</span>
        </div>
      ))}
    </div>
  );
}
