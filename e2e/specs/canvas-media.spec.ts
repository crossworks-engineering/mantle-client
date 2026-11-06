import type { FrameLocator, Page } from '@playwright/test';
import { expect, test } from '../lib/fixtures';

/**
 * Canvas media from Files (mantle task a265178d, client P4): a canvas that
 * declares a sound file plays it through `mantle.media`, in the app (the
 * owner frame, the brain's file route through this client's credential) and
 * on its open link (`/s/<token>`, the link's asset route, no login). The
 * canvas reports each step into its own page, so the spec reads the frame:
 * the blob URL it was handed, the audio's metadata (the bytes decode as
 * sound) and `playing` after a click inside the frame.
 */

/** A 0.5 s, 909-byte mp3 beep (ffmpeg sine 440 Hz, 8 kHz mono). */
const BEEP_MP3 = Buffer.from(
  'SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjYyLjEyLjEwMAAAAAAAAAAAAAAA/+M4wAAAAAAAAAAAAEluZm8AAAAPAAAACQAAA2AAVVVVVVVVVVVVVVVqampqampqampqaoCAgICAgICAgICAlZWVlZWVlZWVlZWqqqqqqqqqqqqqqsDAwMDAwMDAwMDA1dXV1dXV1dXV1dXq6urq6urq6urq6v//////////////AAAAAExhdmM2Mi4yOAAAAAAAAAAAAAAAACQCYAAAAAAAAANgezxi+wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/+MYxAAMSJKUeU8AAAQJKAL3ve973vSlKUpSlL3u/f337xKp8t4t4m4uZc1WGxACAYrB9//+U9/R/gQ5z/QqJoc4WcQ3/GVE/+MYxAkO8PKQAZRQACo5Qhb/Bt4P1A9yADKiJOAfEwHMjrA71MPfAlAKgKisIoRX/5CPR6RD4fAr/hIGhKEgauAgACHD/76v/+MYxAgMkJaOedUAAv//UpJ0hyhZQW6ANVQAwMEHEWN0wV/2BMp+7//+1d/0sXZ9WUq1///e2mr///fVSoGATChjLmDULzq6/+MYxBAK0KYwAAa8RAw3hfTfVtzNFwScwtwTjA+APKAFk2y6yQqw1ioAC2iX4SJwBH3sQ3MEAKMURnPYubN3RNMQgKAwRlrF/+MYxB8MYKJMeAC6QABncMRP////o/1f/Z//2//+nuoYAAADAW7/L//c7FndVtGQDnR0JowGlEDABB0KgC6SjA37eyT0T////+MYxCgMiKJWWA48YP/R/////d7///TVEAAAAggY/1//5gMoREVuGWAtSBh8agZFQ4H07uB0YjAHAAQqIBjHk8aEx////7v//+MYxDANQKZiWVUAAu34///o/////2GMssLk/////axIonIXg92zrlUaA+s8OPnkRErDAhA361d39/gG+Aaxlifhex5//+Tx/+MYxDYXcaqEAZtoAIcpnR7m50v///5uiXzdEvm6IP//gMPA+Aw8D//+NNExpom7//80lyFwpuQAD/9mZf2ZmZS4wZgwooGA/+MYxBMM0Lq1GcMYA4CbUBAm/qqAsN+KChT+goMd+IKN/8QYK/oKFHfiDHf/VUxBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVV',
  'base64',
);

/** A canvas declaring `fileId` that loads it and plays it on a click. */
const canvasSource = (title: string, fileId: string) => `<!doctype html>
<html><head><title>${title}</title>
<meta name="canvas:assets" content="${fileId}"></head>
<body>
<p id="out">waiting</p>
<button id="play">Play</button>
<script type="module">
  const out = document.getElementById('out');
  const player = new Audio();
  player.addEventListener('loadedmetadata', () => { out.textContent = 'loaded'; });
  player.addEventListener('playing', () => { out.textContent = 'playing'; });
  player.addEventListener('error', () => { out.textContent = 'audio error'; });
  document.getElementById('play').addEventListener('click', () => {
    player.play().catch((e) => { out.textContent = 'play refused ' + e.name; });
  });
  try {
    const url = await mantle.media.url('${fileId}');
    out.textContent = url.startsWith('blob:') ? 'url' : 'not a blob url';
    player.src = url;
  } catch (e) {
    out.textContent = 'refused ' + (e && e.message);
  }
</script>
</body></html>`;

/** The canvas frame on `page`, once it shows its first step. */
async function playsTheClip(page: Page, frame: FrameLocator) {
  const out = frame.locator('#out');
  await expect(out).toHaveText('loaded', { timeout: 30_000 });
  await frame.locator('#play').click();
  await expect(out).toHaveText('playing', { timeout: 15_000 });
  void page;
}

test.describe('canvas media from Files', () => {
  test('a canvas plays a clip from Files in the app and on its open link', async ({
    ownerApi,
    ownerPage,
    visitorPage,
    clientURL,
    serverURL,
  }) => {
    const stamp = Date.now();
    const up = await ownerApi.post('/api/files/files', {
      multipart: {
        parentPath: 'files',
        file: { name: `e2e-beep-${stamp}.mp3`, mimeType: 'audio/mpeg', buffer: BEEP_MP3 },
      },
    });
    expect(up.ok(), await up.text()).toBeTruthy();
    const upBody = (await up.json()) as { file?: { id?: string }; id?: string };
    const fileId = (upBody.file?.id ?? upBody.id ?? '').toLowerCase();
    expect(fileId).toBeTruthy();

    const title = `E2E canvas media ${stamp}`;
    const made = await ownerApi.post('/api/presents', {
      data: { title, source: canvasSource(title, fileId) },
    });
    expect(made.status(), await made.text()).toBe(201);
    const { present, assetProblems } = (await made.json()) as {
      present: { id: string; meta: { assets?: string[] } };
      assetProblems: string[];
    };
    try {
      // The save kept the file, and said nothing is missing.
      expect(present.meta.assets).toEqual([fileId]);
      expect(assetProblems).toEqual([]);

      // In the app: the owner frame, through this client's credential.
      await ownerPage.goto(`${clientURL}/present/${present.id}`);
      await playsTheClip(ownerPage, ownerPage.frameLocator(`iframe[title="${title}"]`));

      // On its open link: no login, the link's asset route.
      const share = await ownerApi.post('/api/shares', { data: { nodeId: present.id } });
      expect(share.ok(), await share.text()).toBeTruthy();
      const { share: link } = (await share.json()) as { share: { token: string } };
      await visitorPage.goto(`${serverURL}/s/${link.token}`);
      await playsTheClip(visitorPage, visitorPage.frameLocator('iframe').first());
    } finally {
      await ownerApi.delete(`/api/presents/${present.id}`);
      await ownerApi.delete(`/api/files/files/${fileId}`);
    }
  });
});
