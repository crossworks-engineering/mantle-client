import { describe, expect, it } from 'vitest';
import { cleanAvatar, faceFor, groupLook, keepsGroupLook, type FaceSources } from './faces';

const av = (seed: string) => ({ style: 'brain', seed, parts: null });

const src = (over: Partial<FaceSources> = {}): FaceSources => ({
  me: 'me',
  myAvatar: av('mine'),
  myPhotoVersion: 'v1',
  directory: new Map(),
  agents: new Map(),
  ...over,
});

describe('cleanAvatar', () => {
  it('keeps a seed and a map of parts', () => {
    expect(cleanAvatar({ style: 's', seed: 's', parts: { hair: 'long', glasses: null } })).toEqual({
      seed: 's',
      parts: { hair: 'long', glasses: null },
    });
  });
  it('drops parts that are not a map of strings', () => {
    expect(cleanAvatar({ seed: 's', parts: ['x'] })).toEqual({ seed: 's' });
    expect(cleanAvatar({ seed: 's', parts: { hair: 3 } })).toEqual({ seed: 's' });
    expect(cleanAvatar(av('s'))).toEqual({ seed: 's' });
  });
  it('reads no seed as no avatar', () => {
    expect(cleanAvatar(null)).toBeNull();
    expect(cleanAvatar({ seed: '  ' })).toBeNull();
    expect(cleanAvatar({ parts: {} })).toBeNull();
  });
});

describe('faceFor', () => {
  it('draws me from the shell, my own photo route first', () => {
    expect(faceFor({ kind: 'login', id: 'me' }, src())).toEqual({
      avatar: { seed: 'mine' },
      photo: { path: '/api/profile/photo', version: 'v1' },
    });
  });

  it('gives me the messenger photo when the profile route is not mine', () => {
    const face = faceFor(
      { kind: 'login', id: 'me', photoVersion: 'p2' },
      src({ myPhotoVersion: null }),
    );
    expect(face.photo).toEqual({ path: '/api/messenger/photo/me', version: 'p2' });
  });

  it('gives another person what the brain sends, photo first', () => {
    const s = src({
      directory: new Map([['ann', { avatar: av('ann-dir'), photoVersion: 'd1' }]]),
    });
    expect(
      faceFor({ kind: 'login', id: 'ann', avatar: av('ann-p'), photoVersion: 'p1' }, s),
    ).toEqual({
      avatar: { seed: 'ann-p' },
      photo: { path: '/api/messenger/photo/ann', version: 'p1' },
    });
    expect(faceFor({ kind: 'login', id: 'ann' }, s)).toEqual({
      avatar: { seed: 'ann-dir' },
      photo: { path: '/api/messenger/photo/ann', version: 'd1' },
    });
  });

  it('leaves a person with nothing sent to initials, never my photo', () => {
    expect(faceFor({ kind: 'login', id: 'bob' }, src())).toEqual({ avatar: null, photo: null });
  });

  it('draws an agent from the agents list, else its slug', () => {
    const s = src({
      agents: new Map([['a1', { avatar: av('chosen'), slug: 'sage' }]]),
      directory: new Map([['a2', { slug: 'scout' }]]),
    });
    expect(faceFor({ kind: 'agent', id: 'a1' }, s)).toEqual({
      avatar: { seed: 'chosen' },
      photo: null,
      slug: 'sage',
    });
    expect(faceFor({ kind: 'agent', id: 'a2' }, s)).toEqual({
      avatar: null,
      photo: null,
      slug: 'scout',
    });
  });

  it('never gives an agent a photo, even under my id', () => {
    expect(faceFor({ kind: 'agent', id: 'me', photoVersion: 'x' }, src()).photo).toBeNull();
  });
});

describe('groupLook', () => {
  it('keeps an icon and a known tint', () => {
    expect(groupLook({ icon: '🚀', color: 'teal' })).toEqual({ icon: '🚀', color: 'teal' });
    expect(groupLook({ icon: 'lucide:users', color: null })).toEqual({
      icon: 'lucide:users',
      color: null,
    });
  });
  it('reads a stale tint, a blank icon or nothing as unset', () => {
    expect(groupLook({ icon: '  ', color: 'mauve' })).toEqual({ icon: null, color: null });
    expect(groupLook(null)).toEqual({ icon: null, color: null });
  });
});

describe('keepsGroupLook', () => {
  it('is true once the brain sends the fields, null included', () => {
    expect(keepsGroupLook({ id: 'c', icon: null })).toBe(true);
    expect(keepsGroupLook({ id: 'c' })).toBe(false);
    expect(keepsGroupLook(null)).toBe(false);
  });
});
