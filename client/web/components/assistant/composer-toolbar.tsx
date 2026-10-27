import { Loader2, MapPin, Mic, MicOff, Paperclip, SquareDashedMousePointer } from 'lucide-react';
import { Button } from '@mantle/web-ui/ui/button';

/**
 * The composer's controls: attach, pick, share-location, mic, a row at the
 * left of the action row along the bottom of the box (Send at its right).
 *
 * Lifted out of `assistant-client` when converting it off raw `<button>` —
 * kit components are more lines than the hand-rolled elements they replace,
 * and the file was four lines under the `max-lines` ratchet. Extracting the
 * one self-contained group was the honest way under it; shaving comments to
 * fit would have been gaming a rule whose whole point is that the number means
 * what `wc -l` says.
 *
 * Every control is `icon-xs` — 32px, the same square, so the row lines up,
 * and ghost, like the messenger composer's emoji and mention buttons.
 */
export function ComposerToolbar({
  agentReady,
  sending,
  onAttachClick,
  onPick,
  shareLocation,
  onToggleShareLocation,
  recording,
  transcribing,
  onStartRecording,
  onStopRecording,
}: {
  agentReady: boolean;
  sending: boolean;
  /** null: no attach button (a chat that takes text only, W7c). */
  onAttachClick: (() => void) | null;
  /** null: no pick button (pick mode is an Admin user's). */
  onPick: (() => void) | null;
  shareLocation: boolean;
  onToggleShareLocation: () => void;
  recording: boolean;
  transcribing: boolean;
  onStartRecording: () => void;
  onStopRecording: () => void;
}) {
  return (
    <div className="flex items-center gap-1">
      {/* Attach picker — images + documents, one or several. Triggers the
                      hidden file input. The first file is read inline with the
                      message; further ones are uploaded and linked as context. */}
      {onAttachClick && (
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => onAttachClick()}
          disabled={!agentReady || sending}
          className="text-muted-foreground"
          title="Attach images or documents (or paste them with Ctrl/Cmd+V)"
          aria-label="Attach images or documents"
        >
          <Paperclip aria-hidden />
        </Button>
      )}
      {/* Marker — enter pick mode (minimises the chat) to attach
                      files, pages, notes… as context for the next turn. */}
      {onPick && (
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onPick}
          disabled={!agentReady || sending}
          className="text-muted-foreground"
          title="Pick content to attach (files, pages, notes…)"
          aria-label="Pick content to attach"
        >
          <SquareDashedMousePointer aria-hidden />
        </Button>
      )}
      {/* Share-location toggle — sticky opt-in. When on, each send
                      attaches a fresh browser geolocation fix so the assistant
                      knows where you are (directions, "what's nearby"). */}
      <Button
        variant={shareLocation ? 'default' : 'ghost'}
        size="icon-xs"
        onClick={() => onToggleShareLocation()}
        disabled={!agentReady || sending}
        aria-pressed={shareLocation}
        aria-label="Share your location with the assistant"
        className={shareLocation ? undefined : 'text-muted-foreground'}
        title={
          shareLocation
            ? 'Sharing your location with the assistant — click to stop'
            : 'Share your location with the assistant'
        }
      >
        <MapPin aria-hidden />
      </Button>
      {/* Mic toggle — push-to-talk style. Recording state
                      shows a red destructive button; transcribing shows
                      a spinner. */}
      {recording ? (
        <Button
          variant="destructive"
          size="icon-xs"
          onClick={onStopRecording}
          title="Stop recording"
          aria-label="Stop recording"
        >
          <MicOff aria-hidden />
        </Button>
      ) : (
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onStartRecording}
          disabled={!agentReady || sending || transcribing}
          className="text-muted-foreground"
          title={transcribing ? 'Transcribing…' : 'Record voice note'}
          aria-label={transcribing ? 'Transcribing' : 'Record voice note'}
        >
          {transcribing ? <Loader2 className="animate-spin" aria-hidden /> : <Mic aria-hidden />}
        </Button>
      )}
    </div>
  );
}
