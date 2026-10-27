'use client';

import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import ReactCrop, {
  centerCrop,
  convertToPixelCrop,
  makeAspectCrop,
  type Crop,
} from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';
import { Camera, X } from 'lucide-react';
import { apiFetch, apiSend } from '@mantle/web-ui/api-fetch';
import type { Shell } from '@mantle/client-types';
import { Button } from '@mantle/web-ui/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@mantle/web-ui/ui/dialog';
import { useToast } from '@mantle/web-ui/ui/toast';
import { ProfilePhoto } from '@/components/profile-photo';

/**
 * Profile PHOTO upload with an in-browser crop (react-image-crop) — PROFILE
 * ONLY, never agents: an agent's face is generated, a person's may be real.
 *
 * The crop happens client-side: the picked file (an object URL — never a
 * base64 copy in memory) is shown in a dialog with a fixed square, circular
 * selection, and only the cropped square — re-drawn to a canvas at ≤512px —
 * is uploaded. So the wire cost is a few tens of KB no matter what the
 * camera produced, and the server's 512KB cap is never the user's problem.
 *
 * The crop is held in PERCENT coordinates and converted to pixels at upload
 * time from the image's live dimensions: a pixel crop goes stale the moment
 * the displayed image resizes (device rotation, keyboard dismissal), and
 * uploading a stale pixel rect ships the wrong region of the photo.
 *
 * Reads its state (the sha8 cache-buster) from the shared ['shell'] query —
 * cache-only (staleTime Infinity): the field changes exclusively through this
 * control's own invalidations, so mounting must not refetch the whole shell.
 *
 * Precedence across the app: photo → generated seed → initials.
 */

/** Longest edge of the uploaded square. 512 keeps a 64px circle crisp on any
 *  display and encodes to a few tens of KB. */
const EXPORT_PX = 512;

/** Server cap (mirrors the photo route). The crop should land far under it. */
const MAX_UPLOAD_BYTES = 512 * 1024;

function centeredSquare(width: number, height: number): Crop {
  return centerCrop(makeAspectCrop({ unit: '%', width: 90 }, 1, width, height), width, height);
}

/** Draw the selected square to a canvas and encode. WebP first — but
 *  `toBlob` SUBSTITUTES PNG for a type it can't encode (it does not yield
 *  null), so the result's `type` is checked and Safari et al. fall back to an
 *  explicit JPEG encode; a photographic PNG would blow the server's cap. */
async function cropToBlob(image: HTMLImageElement, percentCrop: Crop): Promise<Blob> {
  const crop = convertToPixelCrop(percentCrop, image.width, image.height);
  const scaleX = image.naturalWidth / image.width;
  const scaleY = image.naturalHeight / image.height;
  const side = Math.max(1, Math.min(EXPORT_PX, Math.round(crop.width * scaleX)));
  const canvas = document.createElement('canvas');
  canvas.width = side;
  canvas.height = side;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas unavailable');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(
    image,
    crop.x * scaleX,
    crop.y * scaleY,
    crop.width * scaleX,
    crop.height * scaleY,
    0,
    0,
    side,
    side,
  );
  const encode = (type: string, quality: number) =>
    new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
  let blob = await encode('image/webp', 0.9);
  if (!blob || blob.type !== 'image/webp') blob = await encode('image/jpeg', 0.9);
  if (!blob) throw new Error('could not encode the cropped image');
  if (blob.size > MAX_UPLOAD_BYTES) {
    // Should be unreachable for a 512px JPEG/WebP; guard rather than 413.
    throw new Error('the cropped image is unexpectedly large — try a smaller photo');
  }
  return blob;
}

export function ProfilePhotoControl() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const shell = useQuery({
    queryKey: ['shell'],
    queryFn: () => apiFetch<Shell>('/api/shell'),
    staleTime: Infinity,
  });
  const version = shell.data?.avatarPhotoVersion ?? null;

  const [pickedSrc, setPickedSrc] = useState<string | null>(null);
  const [crop, setCrop] = useState<Crop>();
  const [busy, setBusy] = useState(false);

  const pick = (file: File) => setPickedSrc(URL.createObjectURL(file));

  const closeCrop = () => {
    if (pickedSrc) URL.revokeObjectURL(pickedSrc);
    setPickedSrc(null);
    setCrop(undefined);
    if (inputRef.current) inputRef.current.value = '';
  };

  const badPick = () => {
    toast.error('Could not read that image — use a PNG, JPEG or WebP file.');
    closeCrop();
  };

  const upload = async () => {
    const image = imgRef.current;
    if (!image || !crop || !crop.width) return;
    setBusy(true);
    try {
      const blob = await cropToBlob(image, crop);
      const fd = new FormData();
      fd.append('file', new File([blob], 'avatar', { type: blob.type }));
      await apiFetch('/api/profile/photo', { method: 'PUT', body: fd });
      await queryClient.invalidateQueries({ queryKey: ['shell'] });
      toast.success('Photo set — it now stands in for your generated avatar.');
      closeCrop();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed — try again.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await apiSend('/api/profile/photo', 'DELETE');
      await queryClient.invalidateQueries({ queryKey: ['shell'] });
      toast.success('Photo removed — back to the generated avatar.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not remove the photo.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-4">
      {version && <ProfilePhoto version={version} size={64} alt="Your profile photo" />}
      <div className="flex flex-col items-start gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          <Camera aria-hidden /> {version ? 'Replace photo…' : 'Upload photo…'}
        </Button>
        {version && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={remove}
            className="h-auto px-0 text-xs font-normal text-muted-foreground hover:bg-transparent hover:text-foreground"
          >
            <X aria-hidden /> Remove photo
          </Button>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) pick(f);
        }}
      />

      <Dialog open={pickedSrc !== null} onOpenChange={(o) => !o && closeCrop()}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Crop your photo</DialogTitle>
            <DialogDescription>
              Drag to frame the circle; only the framed square is uploaded.
            </DialogDescription>
          </DialogHeader>
          {pickedSrc && (
            <div className="flex justify-center">
              <ReactCrop
                // PERCENT crop on purpose — see the component comment.
                crop={crop}
                onChange={(_, percent) => setCrop(percent)}
                aspect={1}
                circularCrop
                keepSelection
                minWidth={32}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- local object URL being cropped */}
                <img
                  ref={imgRef}
                  src={pickedSrc}
                  alt="Photo to crop"
                  className="max-h-96"
                  onLoad={(e) => {
                    const el = e.currentTarget;
                    setCrop(centeredSquare(el.width, el.height));
                  }}
                  // An undecodable pick (HEIC renamed .jpg, a corrupt file)
                  // must not dead-end the dialog with a forever-disabled
                  // button and no explanation.
                  onError={badPick}
                />
              </ReactCrop>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" disabled={busy} onClick={closeCrop}>
              Cancel
            </Button>
            <Button type="button" disabled={busy || !crop} onClick={upload}>
              Use photo
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
